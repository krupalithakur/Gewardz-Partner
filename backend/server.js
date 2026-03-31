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

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
const COMPANY_TYPE_MAP = {
  LTD: 'Private Company Limited by Shares',
  DAC: 'Designated Activity Company',
  CLG: 'Company Limited by Guarantee',
  PLC: 'Public Limited Company',
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
  if (status === 'active') filters.company_status = 'Normal';
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

// Export for Vercel serverless — listen only when running locally
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`✅ Gewardz Partner Discovery backend running on http://localhost:${PORT}`);
  });
}

module.exports = app;
