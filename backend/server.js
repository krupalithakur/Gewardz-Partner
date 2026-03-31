require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const { createObjectCsvStringifier } = require('csv-writer');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const CRO_API = 'https://opendata.cro.ie/api/3/action';
// Primary company records resource from CRO Open Data
const COMPANY_RESOURCE_ID = '3fef41bc-b8f4-4b10-8434-ce51c29b1bba';

const store = require('./store');
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const HUNTER_API_KEY = process.env.HUNTER_API_KEY || '';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const SENDER_EMAIL = process.env.SENDER_EMAIL || 'onboarding@resend.dev';

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

// ─── GET /api/fields – discover available fields in the dataset ───────────────
app.get('/api/fields', async (_req, res) => {
  try {
    const response = await axios.get(`${CRO_API}/datastore_search`, {
      params: { resource_id: COMPANY_RESOURCE_ID, limit: 1 },
      timeout: 10000,
    });
    const fields = response.data.result?.fields || [];
    res.json({ fields });
  } catch (err) {
    res.status(502).json({ error: 'Failed to fetch field schema from CRO API', detail: err.message });
  }
});

// ─── GET /api/search – proxy CRO CKAN datastore search ───────────────────────
// Query params:
//   keyword  – free-text search
//   county   – exact county filter
//   size     – "small" | "medium" | "large" (applied post-fetch via Claude hints)
//   limit    – default 20
//   offset   – default 0
// CRO type values include prefix e.g. "LTD - Private Company Limited by Shares"
const COMPANY_TYPE_MAP = {
  LTD: 'LTD - Private Company Limited by Shares',
  DAC: 'DAC - Designated Activity Company',
  CLG: 'CLG - Company Limited by Guarantee',
  PLC: 'PLC - Public Limited Company',
  UC:  'Unlimited Company',
};

app.get('/api/search', async (req, res) => {
  const { keyword, county, companyType, status, registeredAfter, limit = 20, offset = 0 } = req.query;

  const params = {
    resource_id: COMPANY_RESOURCE_ID,
    limit: Math.min(Number(limit), 100),
    offset: Number(offset),
  };

  // CKAN plain-text full-text search across all fields.
  const queryParts = [];
  if (keyword && keyword.trim()) queryParts.push(keyword.trim());
  if (county && county.trim()) queryParts.push(county.trim());
  if (queryParts.length > 0) params.q = queryParts.join(' ');

  // CKAN exact-match filters (safe to combine with q)
  const filters = {};
  // CRO data has trailing spaces in status values (e.g. "Normal ")
  if (status === 'active') filters.company_status = 'Normal ';
  if (status === 'struck') filters.company_status = 'Struck Off';
  if (companyType && COMPANY_TYPE_MAP[companyType]) filters.company_type = COMPANY_TYPE_MAP[companyType];
  if (Object.keys(filters).length > 0) params.filters = JSON.stringify(filters);

  try {
    const response = await axios.get(`${CRO_API}/datastore_search`, {
      params,
      timeout: 15000,
    });

    const result = response.data.result;
    const records = result?.records || [];
    const total = result?.total || 0;
    const fields = result?.fields || [];

    res.json({ records, total, fields, offset: Number(offset), limit: params.limit });
  } catch (err) {
    console.error('CRO API error:', err.message);
    const status = err.response?.status || 502;
    res.status(status).json({
      error: 'Failed to fetch companies from CRO Open Data',
      detail: err.message,
    });
  }
});

// ─── POST /api/enrich – enrich a batch of companies via Claude ────────────────
// Body: { companies: [...], sizeFilter?: "small" | "medium" | "large" }
// Returns enriched companies with: estimatedOwnerName, estimatedOwnerEmail,
//   estimatedOwnerLinkedIn, partnerFitScore (1-10), fitReason, companySize, tags
app.post('/api/enrich', async (req, res) => {
  const { companies, sizeFilter } = req.body;

  if (!Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ error: 'companies array is required' });
  }

  const sizeInstruction = sizeFilter
    ? `The user is looking specifically for ${sizeFilter} companies (small: <50 employees, medium: 50-250, large: 250+). Only assign a high fit score to companies that appear to match this size.`
    : '';

  const companiesJson = JSON.stringify(
    companies.map(c => ({
      name: c.company_name || c['Company Name'] || c.name || 'Unknown',
      number: c.company_num || c['Company Number'] || c._id || '',
      type: c.company_type || c['Company Type'] || '',
      status: c.company_status || c['Status'] || '',
      location: c.company_address_4 || c.company_address_3 || c.company_address_2 || c['County'] || '',
      address: [c.company_address_1, c.company_address_2, c.company_address_3, c.company_address_4]
        .filter(Boolean).join(', ') || c['Address'] || '',
      incorporated: c.company_reg_date || c['Incorporation Date'] || '',
      naceCode: c.nace_v2_code || '',
    })),
    null,
    2
  );

  const systemPrompt = `You are a B2B partner intelligence assistant for Gewardz Health, an Irish digital health company that provides employee wellness and health engagement platforms for corporate clients.

Gewardz Health's ideal partners are:
- Companies with 20-2000 employees in Ireland
- Industries: professional services, tech, finance, pharma, manufacturing, construction, hospitality, healthcare providers
- Companies that would benefit from employee health/wellness programmes
- HR directors, CEOs, and operations managers are key decision-makers

Your job is to analyse Irish company records and return structured enrichment data.`;

  const userPrompt = `Analyse these Irish company records and enrich each one for Gewardz Health partnership prospecting.

${sizeInstruction}

Companies to analyse:
${companiesJson}

For each company return a JSON array where every element has EXACTLY these fields:
- companyIndex: (integer, 0-based, matching the input order)
- estimatedOwnerName: (string, plausible Irish CEO/director first+last name based on company type/size; or "Unknown" if truly can't infer)
- estimatedOwnerEmail: (string, guessed email format e.g. john.smith@companyname.ie; or "" if unsure)
- estimatedOwnerPhone: (string, plausible Irish phone number for the company based on location e.g. "01 234 5678" for Dublin, "021 234 5678" for Cork; or "" if unsure)
- estimatedWebsite: (string, likely company website URL e.g. "www.companyname.ie"; or "" if unsure)
- estimatedOwnerLinkedIn: (string, guessed LinkedIn URL slug e.g. linkedin.com/in/johnsmith; or "")
- estimatedCompanySize: (string, one of: "1-10", "11-50", "51-200", "201-500", "500+")
- partnerFitScore: (integer 1-10, where 10 = perfect Gewardz Health partner fit)
- fitReason: (string, 1-2 sentences explaining why Gewardz Health should partner with this specific company — personalised to their industry/size/location)
- industryTag: (string, single best-fit industry tag e.g. "Recruitment", "Tech", "Finance", "Construction")
- priorityLevel: (string, one of: "Hot", "Warm", "Cold")
- currentHealthcareService: (string, inferred corporate health/wellness provider the company likely uses based on their size/industry/type. One of: "None Known", "VHI Corporate", "Laya Healthcare", "Irish Life Health", "Occupational Health Scheme", "EAP Provider", "Unknown". Use "None Known" if a company of this type/size is unlikely to have a provider yet — this is a key buying signal for Gewardz Health.)

Respond with ONLY the raw JSON array, no markdown, no explanation.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text response from Claude');

    let enrichmentData;
    try {
      // Strip any accidental markdown code fences
      const cleaned = textBlock.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      enrichmentData = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error('Failed to parse Claude response:', textBlock.text.slice(0, 500));
      throw new Error('Claude returned invalid JSON');
    }

    // Merge enrichment back into company records
    const enriched = companies.map((company, i) => {
      const extra = enrichmentData.find(e => e.companyIndex === i) || {};
      return { ...company, enrichment: extra };
    });

    res.json({ enriched });
  } catch (err) {
    console.error('Enrichment error:', err.message);
    res.status(500).json({ error: 'Enrichment failed', detail: err.message });
  }
});

// ─── POST /api/outreach – stream outreach sequence via Claude SSE ─────────────
// Body: { company: {...enriched company object}, sequenceType: "email" | "linkedin" }
app.post('/api/outreach', async (req, res) => {
  const { company, sequenceType = 'email' } = req.body;

  if (!company) return res.status(400).json({ error: 'company object is required' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const companyName = company['Company Name'] || company['CompanyName'] || company.name || 'the company';
  const ownerName = company.enrichment?.estimatedOwnerName || 'there';
  const county = company['County'] || company.enrichment?.county || 'Ireland';
  const fitReason = company.enrichment?.fitReason || '';
  const industryTag = company.enrichment?.industryTag || '';
  const companySize = company.enrichment?.estimatedCompanySize || '';

  const systemPrompt = `You are a senior business development representative for Gewardz Health, an Irish digital health company helping organisations improve employee wellbeing. You write warm, personalised, concise outreach that gets replies.

Style: Professional but conversational. Never pushy. Irish market tone. Mention specific details that show you've done your homework. Keep each message brief.`;

  const userPrompt = sequenceType === 'linkedin'
    ? `Write a 3-touch LinkedIn outreach sequence targeting ${ownerName} at ${companyName} (${county}, ${industryTag}, ~${companySize} employees).

Context: ${fitReason}

Format as:
## LinkedIn Message 1 – Connection Request (300 char limit)
[text]

## LinkedIn Message 2 – Follow-up (sent 3 days after connection, max 500 chars)
[text]

## LinkedIn Message 3 – Value Add (sent 7 days later, max 500 chars)
[text]

## Suggested LinkedIn Subject Tags
[3 hashtags]`
    : `Write a 3-touch cold email outreach sequence targeting ${ownerName} at ${companyName} (${county}, ${industryTag}, ~${companySize} employees).

Context: ${fitReason}

Format as:
## Email 1 – Initial Outreach
**Subject:** [subject line]
[body — max 120 words]

## Email 2 – Follow-up (Day 4)
**Subject:** [subject line]
[body — max 100 words]

## Email 3 – Break-up Email (Day 10)
**Subject:** [subject line]
[body — max 80 words]

## Suggested Send Times
[best day/time advice]`;

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-opus-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const data = JSON.stringify({ text: event.delta.text });
        res.write(`data: ${data}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (err) {
    console.error('Outreach stream error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
    res.end();
  }
});

// ─── POST /api/export – generate CSV download ─────────────────────────────────
// Body: { companies: [...enriched company objects] }
app.post('/api/export', (req, res) => {
  const { companies } = req.body;
  if (!Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ error: 'companies array is required' });
  }

  const csvStringifier = createObjectCsvStringifier({
    header: [
      { id: 'companyName', title: 'Company Name' },
      { id: 'companyNumber', title: 'Company Number' },
      { id: 'companyType', title: 'Company Type' },
      { id: 'status', title: 'Status' },
      { id: 'county', title: 'County' },
      { id: 'address', title: 'Address' },
      { id: 'incorporated', title: 'Incorporated' },
      { id: 'ownerName', title: 'Est. Owner Name' },
      { id: 'ownerEmail', title: 'Est. Owner Email' },
      { id: 'ownerPhone', title: 'Est. Phone' },
      { id: 'website', title: 'Est. Website' },
      { id: 'ownerLinkedIn', title: 'Est. Owner LinkedIn' },
      { id: 'companySize', title: 'Est. Company Size' },
      { id: 'industryTag', title: 'Industry' },
      { id: 'fitScore', title: 'Partner Fit Score (1-10)' },
      { id: 'fitReason', title: 'Fit Reason' },
      { id: 'priority', title: 'Priority Level' },
      { id: 'healthcareService', title: 'Current Healthcare Service' },
    ],
  });

  const records = companies.map(c => {
    const e = c.enrichment || {};
    return {
      companyName: c.company_name || c['Company Name'] || c.name || '',
      companyNumber: c.company_num || c['Company Number'] || '',
      companyType: c.company_type || c['Company Type'] || '',
      status: c.company_status || c['Status'] || '',
      county: c.company_address_4 || c.company_address_3 || c['County'] || '',
      address: [c.company_address_1, c.company_address_2, c.company_address_3, c.company_address_4]
        .filter(Boolean).join(', ') || c['Address'] || '',
      incorporated: c.company_reg_date ? c.company_reg_date.split('T')[0] : (c['Incorporation Date'] || ''),
      ownerName: e.estimatedOwnerName || '',
      ownerEmail: e.estimatedOwnerEmail || '',
      ownerPhone: e.estimatedOwnerPhone || '',
      website: e.estimatedWebsite || '',
      ownerLinkedIn: e.estimatedOwnerLinkedIn || '',
      companySize: e.estimatedCompanySize || '',
      industryTag: e.industryTag || '',
      fitScore: e.partnerFitScore || '',
      fitReason: e.fitReason || '',
      priority: e.priorityLevel || '',
      healthcareService: e.currentHealthcareService || '',
    };
  });

  const csvContent = csvStringifier.getHeaderString() + csvStringifier.stringifyRecords(records);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="gewardz-partners.csv"');
  res.send(csvContent);
});

// ─── GET /api/counties – return list of Irish counties ───────────────────────
app.get('/api/counties', (_req, res) => {
  res.json({
    counties: [
      'Carlow','Cavan','Clare','Cork','Donegal','Dublin',
      'Galway','Kerry','Kildare','Kilkenny','Laois','Leitrim',
      'Limerick','Longford','Louth','Mayo','Meath','Monaghan',
      'Offaly','Roscommon','Sligo','Tipperary','Waterford',
      'Westmeath','Wexford','Wicklow',
      'Antrim','Armagh','Down','Fermanagh','Londonderry','Tyrone',
    ],
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// OUTREACH PIPELINE ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Helper: guess company domain from name ──────────────────────────────────
function guessDomain(companyName) {
  const cleaned = companyName
    .toLowerCase()
    .replace(/\b(limited|ltd|designated activity company|dac|plc|clg|company|unlimited|the|ireland|irish)\b/gi, '')
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '');
  return cleaned ? `${cleaned}.ie` : '';
}

// ─── GET /api/pipeline — list prospects ──────────────────────────────────────
app.get('/api/pipeline', (req, res) => {
  const filter = req.query.filter || 'all';
  const prospects = store.getProspects(filter);
  // Attach sequences to each prospect
  const enriched = prospects.map(p => ({
    ...p,
    sequences: store.getSequences(p.id),
  }));
  res.json({ prospects: enriched, stats: store.getStats() });
});

// ─── GET /api/pipeline/stats — outreach stats ───────────────────────────────
app.get('/api/pipeline/stats', (_req, res) => {
  res.json(store.getStats());
});

// ─── POST /api/pipeline/add — add company to pipeline ───────────────────────
app.post('/api/pipeline/add', (req, res) => {
  const { company } = req.body;
  if (!company) return res.status(400).json({ error: 'company object required' });

  const e = company.enrichment || {};
  const addr4 = company.company_address_4 || '';
  const county = addr4 ? addr4.split(',')[0].trim() : '';

  const prospect = store.addProspect({
    companyName: company.company_name || company.name || '',
    companyNum: String(company.company_num || company._id || ''),
    companyType: company.company_type || '',
    county,
    address: [company.company_address_1, company.company_address_2, company.company_address_3, company.company_address_4]
      .filter(Boolean).join(', '),
    industry: e.industryTag || '',
    directorName: e.estimatedOwnerName || '',
    fitScore: e.partnerFitScore || 0,
    fitReason: e.fitReason || '',
    domain: guessDomain(company.company_name || ''),
  });

  res.json({ prospect });
});

// ─── DELETE /api/pipeline/:id — remove prospect ─────────────────────────────
app.delete('/api/pipeline/:id', (req, res) => {
  store.removeProspect(Number(req.params.id));
  res.json({ ok: true });
});

// ─── POST /api/pipeline/find-email — find real email via Hunter.io ──────────
app.post('/api/pipeline/find-email', async (req, res) => {
  const { prospectId } = req.body;
  const prospect = store.getProspect(prospectId);
  if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

  const domain = prospect.domain || guessDomain(prospect.companyName);

  if (!domain) {
    store.updateProspect(prospectId, { emailStatus: 'not_found' });
    return res.json({ email: null, message: 'Could not guess domain' });
  }

  // If Hunter.io API key available, use it
  if (HUNTER_API_KEY) {
    try {
      const hunterRes = await axios.get('https://api.hunter.io/v2/domain-search', {
        params: { domain, api_key: HUNTER_API_KEY },
        timeout: 10000,
      });

      const emails = hunterRes.data?.data?.emails || [];

      // Prefer senior roles
      const senior = emails.find(e =>
        ['ceo', 'director', 'founder', 'owner', 'managing', 'partner', 'principal']
          .some(role => (e.position || '').toLowerCase().includes(role))
      );
      const best = senior || emails[0];

      if (best) {
        store.updateProspect(prospectId, {
          email: best.value,
          emailConfidence: best.confidence || 50,
          directorName: [best.first_name, best.last_name].filter(Boolean).join(' ') || prospect.directorName,
          emailStatus: 'found',
          domain,
        });
        return res.json({ email: best.value, confidence: best.confidence, name: `${best.first_name} ${best.last_name}`, source: 'hunter' });
      }
    } catch (err) {
      console.warn('Hunter.io error:', err.message);
    }
  }

  // Fallback: pattern-guess using director name or company domain
  const dirName = prospect.directorName || '';
  let guessedEmail = '';

  if (dirName && dirName !== 'Unknown') {
    const parts = dirName.toLowerCase().split(/\s+/);
    if (parts.length >= 2) {
      guessedEmail = `${parts[0]}.${parts[parts.length - 1]}@${domain}`;
    } else if (parts.length === 1) {
      guessedEmail = `${parts[0]}@${domain}`;
    }
  } else {
    guessedEmail = `info@${domain}`;
  }

  store.updateProspect(prospectId, {
    email: guessedEmail,
    emailConfidence: dirName && dirName !== 'Unknown' ? 40 : 15,
    emailStatus: 'guessed',
    domain,
  });

  res.json({ email: guessedEmail, confidence: dirName ? 40 : 15, source: 'pattern_guess' });
});

// ─── POST /api/pipeline/find-all-emails — batch find ────────────────────────
app.post('/api/pipeline/find-all-emails', async (req, res) => {
  const needEmail = store.getProspects('need_email');
  const results = [];

  for (const p of needEmail) {
    try {
      store.updateProspect(p.id, { emailStatus: 'searching' });
      // Reuse the single endpoint logic via internal call
      const domain = p.domain || guessDomain(p.companyName);
      const dirName = p.directorName || '';
      let email = '';
      let confidence = 0;
      let status = 'guessed';

      if (HUNTER_API_KEY && domain) {
        try {
          const hunterRes = await axios.get('https://api.hunter.io/v2/domain-search', {
            params: { domain, api_key: HUNTER_API_KEY },
            timeout: 10000,
          });
          const emails = hunterRes.data?.data?.emails || [];
          const senior = emails.find(e =>
            ['ceo', 'director', 'founder', 'owner', 'managing']
              .some(role => (e.position || '').toLowerCase().includes(role))
          );
          const best = senior || emails[0];
          if (best) {
            email = best.value;
            confidence = best.confidence || 50;
            status = 'found';
            if (best.first_name) {
              store.updateProspect(p.id, { directorName: `${best.first_name} ${best.last_name}`.trim() });
            }
          }
        } catch (err) {
          console.warn(`Hunter.io error for ${domain}:`, err.message);
        }
      }

      // Fallback pattern guess
      if (!email && domain) {
        const parts = dirName.toLowerCase().split(/\s+/).filter(Boolean);
        if (parts.length >= 2) {
          email = `${parts[0]}.${parts[parts.length - 1]}@${domain}`;
          confidence = 40;
        } else {
          email = `info@${domain}`;
          confidence = 15;
        }
        status = 'guessed';
      }

      store.updateProspect(p.id, { email, emailConfidence: confidence, emailStatus: email ? status : 'not_found', domain });
      results.push({ id: p.id, email, confidence, status });
    } catch (err) {
      store.updateProspect(p.id, { emailStatus: 'not_found' });
      results.push({ id: p.id, error: err.message });
    }
  }

  res.json({ results, total: results.length });
});

// ─── POST /api/pipeline/generate-sequence — Claude generates 3-step email ───
app.post('/api/pipeline/generate-sequence', async (req, res) => {
  const { prospectId } = req.body;
  const prospect = store.getProspect(prospectId);
  if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

  const systemPrompt = `You are a senior business development rep for Gewardz Health, an Irish digital health company helping organisations improve employee wellbeing through corporate wellness programmes.

Write personalised cold email sequences that get replies. Style: professional but warm, Irish market tone. Mention specific company details. Keep each email concise.

IMPORTANT: Return ONLY a JSON array with exactly 3 objects. No markdown, no explanation.`;

  const userPrompt = `Generate a 3-step cold email outreach sequence for:
Company: ${prospect.companyName}
Director: ${prospect.directorName || 'the business owner'}
Location: ${prospect.county || 'Ireland'}
Industry: ${prospect.industry || 'general business'}
Fit reason: ${prospect.fitReason || 'Irish owner-managed business'}

Return a JSON array with 3 objects, each having:
- step: (1, 2, or 3)
- subject: (email subject line)
- body: (email body as plain text, keep it short — step 1 max 120 words, step 2 max 100, step 3 max 80)
- sendDay: (0 for step 1, 4 for step 2, 10 for step 3)

Step 1: warm intro referencing their specific business
Step 2: follow up with a value proposition / case study
Step 3: polite break-up email, last chance

RESPOND WITH ONLY THE JSON ARRAY.`;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const textBlock = message.content.find(b => b.type === 'text');
    if (!textBlock) throw new Error('No text response from Claude');

    const cleaned = textBlock.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    const steps = JSON.parse(cleaned);

    if (!Array.isArray(steps) || steps.length < 3) throw new Error('Invalid sequence format');

    // Store each step
    const now = new Date();
    for (const step of steps) {
      const scheduledAt = new Date(now.getTime() + (step.sendDay || 0) * 24 * 60 * 60 * 1000);
      store.addSequence({
        prospectId: prospect.id,
        step: step.step,
        subject: step.subject,
        body: step.body,
        scheduledAt: scheduledAt.toISOString(),
      });
    }

    store.updateProspect(prospect.id, { sequenceStatus: 'generated' });
    res.json({ sequences: store.getSequences(prospect.id) });
  } catch (err) {
    console.error('Sequence generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate sequence', detail: err.message });
  }
});

// ─── POST /api/pipeline/generate-all-sequences — batch generate ─────────────
app.post('/api/pipeline/generate-all-sequences', async (req, res) => {
  const ready = store.getProspects('ready');
  const results = [];

  for (const p of ready) {
    try {
      // Simple inline call
      const message = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: 'You are a senior BDR for Gewardz Health, an Irish digital health company. Write personalised cold email sequences. Return ONLY a JSON array with 3 objects.',
        messages: [{ role: 'user', content: `Generate a 3-step cold email sequence for ${p.directorName || 'the owner'} at ${p.companyName} (${p.county}, ${p.industry}). Reason: ${p.fitReason}. Return JSON array with step, subject, body, sendDay (0/4/10).` }],
      });

      const text = message.content.find(b => b.type === 'text')?.text || '';
      const steps = JSON.parse(text.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
      const now = new Date();

      for (const step of steps) {
        store.addSequence({
          prospectId: p.id,
          step: step.step,
          subject: step.subject,
          body: step.body,
          scheduledAt: new Date(now.getTime() + (step.sendDay || 0) * 24 * 60 * 60 * 1000).toISOString(),
        });
      }

      store.updateProspect(p.id, { sequenceStatus: 'generated' });
      results.push({ id: p.id, status: 'generated' });
    } catch (err) {
      results.push({ id: p.id, error: err.message });
    }
  }

  res.json({ results, total: results.length });
});

// ─── POST /api/pipeline/send — send one email step via Resend ───────────────
app.post('/api/pipeline/send', async (req, res) => {
  const { sequenceId } = req.body;
  const sequences = [];

  // Find the sequence
  const allProspects = store.getProspects('all');
  let targetSeq = null;
  let targetProspect = null;

  for (const p of allProspects) {
    const seqs = store.getSequences(p.id);
    const found = seqs.find(s => s.id === Number(sequenceId));
    if (found) { targetSeq = found; targetProspect = p; break; }
  }

  if (!targetSeq) return res.status(404).json({ error: 'Sequence not found' });
  if (!targetProspect.email) return res.status(400).json({ error: 'No email address for this prospect' });

  if (!RESEND_API_KEY) {
    // Demo mode: just mark as sent
    store.updateSequence(targetSeq.id, { status: 'sent', sentAt: new Date().toISOString() });
    store.updateProspect(targetProspect.id, { sequenceStatus: `step${targetSeq.step}_sent` });
    return res.json({ sent: true, demo: true, message: 'Demo mode — add RESEND_API_KEY to .env to send real emails' });
  }

  try {
    const emailRes = await axios.post('https://api.resend.com/emails', {
      from: SENDER_EMAIL,
      to: targetProspect.email,
      subject: targetSeq.subject,
      html: targetSeq.body.replace(/\n/g, '<br>'),
    }, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      timeout: 10000,
    });

    store.updateSequence(targetSeq.id, { status: 'sent', sentAt: new Date().toISOString(), resendId: emailRes.data?.id });
    store.updateProspect(targetProspect.id, { sequenceStatus: `step${targetSeq.step}_sent` });
    store.addEvent({ type: 'sent', prospectId: targetProspect.id, sequenceId: targetSeq.id, step: targetSeq.step });

    res.json({ sent: true, resendId: emailRes.data?.id });
  } catch (err) {
    console.error('Resend error:', err.response?.data || err.message);
    store.updateSequence(targetSeq.id, { status: 'bounced' });
    res.status(500).json({ error: 'Send failed', detail: err.response?.data?.message || err.message });
  }
});

// ─── POST /api/pipeline/send-all-step1 — send Step 1 for all generated ──────
app.post('/api/pipeline/send-all-step1', async (req, res) => {
  const generated = store.getProspects('all').filter(p => p.sequenceStatus === 'generated' && p.email);
  const results = [];

  for (const p of generated) {
    const seqs = store.getSequences(p.id);
    const step1 = seqs.find(s => s.step === 1 && s.status === 'pending');
    if (!step1) { results.push({ id: p.id, skipped: true }); continue; }

    if (!RESEND_API_KEY) {
      store.updateSequence(step1.id, { status: 'sent', sentAt: new Date().toISOString() });
      store.updateProspect(p.id, { sequenceStatus: 'step1_sent' });
      results.push({ id: p.id, sent: true, demo: true });
      continue;
    }

    try {
      await axios.post('https://api.resend.com/emails', {
        from: SENDER_EMAIL,
        to: p.email,
        subject: step1.subject,
        html: step1.body.replace(/\n/g, '<br>'),
      }, {
        headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
        timeout: 10000,
      });

      store.updateSequence(step1.id, { status: 'sent', sentAt: new Date().toISOString() });
      store.updateProspect(p.id, { sequenceStatus: 'step1_sent' });
      results.push({ id: p.id, sent: true });
    } catch (err) {
      results.push({ id: p.id, error: err.message });
    }
  }

  res.json({ results, total: results.length });
});

// ─── POST /api/pipeline/mark-replied — mark a prospect as replied ───────────
app.post('/api/pipeline/mark-replied', (req, res) => {
  const { prospectId } = req.body;
  store.updateProspect(prospectId, { sequenceStatus: 'replied' });
  const seqs = store.getSequences(prospectId);
  // Cancel remaining unsent sequences
  for (const s of seqs) {
    if (['pending', 'scheduled'].includes(s.status)) {
      store.updateSequence(s.id, { status: 'cancelled' });
    }
  }
  res.json({ ok: true });
});

// ─── Scheduler: check for due follow-ups every 30 minutes ───────────────────
setInterval(() => {
  const due = store.getAllPendingSequences();
  for (const seq of due) {
    const prospect = store.getProspect(seq.prospectId);
    if (!prospect || !prospect.email || prospect.sequenceStatus === 'replied') continue;

    if (!RESEND_API_KEY) {
      store.updateSequence(seq.id, { status: 'sent', sentAt: new Date().toISOString() });
      store.updateProspect(prospect.id, { sequenceStatus: `step${seq.step}_sent` });
      continue;
    }

    axios.post('https://api.resend.com/emails', {
      from: SENDER_EMAIL,
      to: prospect.email,
      subject: seq.subject,
      html: seq.body.replace(/\n/g, '<br>'),
    }, {
      headers: { Authorization: `Bearer ${RESEND_API_KEY}` },
      timeout: 10000,
    }).then(() => {
      store.updateSequence(seq.id, { status: 'sent', sentAt: new Date().toISOString() });
      store.updateProspect(prospect.id, { sequenceStatus: `step${seq.step}_sent` });
    }).catch(err => {
      console.error(`Auto-send failed for sequence ${seq.id}:`, err.message);
    });
  }
}, 30 * 60 * 1000); // every 30 minutes

// Export for Vercel serverless — listen only when running locally
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Gewardz Partner Discovery backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
