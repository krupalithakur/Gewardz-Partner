/**
 * Simple JSON file-based persistence for the outreach pipeline.
 * Stores prospects, email sequences, and tracking events.
 */
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'pipeline.json');

function ensureDir() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
}

function read() {
  ensureDir();
  if (!fs.existsSync(DB_PATH)) {
    const empty = { prospects: [], sequences: [], events: [], nextId: 1 };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, 'utf-8'));
  } catch {
    const empty = { prospects: [], sequences: [], events: [], nextId: 1 };
    fs.writeFileSync(DB_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
}

function write(data) {
  ensureDir();
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function nextId(db) {
  const id = db.nextId || 1;
  db.nextId = id + 1;
  return id;
}

// ─── Prospects ─────────────────────────────────────────────────────────────────

function addProspect(prospect) {
  const db = read();

  // Deduplicate by company_num
  if (prospect.companyNum && db.prospects.some(p => p.companyNum === prospect.companyNum)) {
    return db.prospects.find(p => p.companyNum === prospect.companyNum);
  }

  const id = nextId(db);
  const entry = {
    id,
    companyName: prospect.companyName || '',
    companyNum: prospect.companyNum || '',
    companyType: prospect.companyType || '',
    county: prospect.county || '',
    address: prospect.address || '',
    industry: prospect.industry || '',
    domain: prospect.domain || '',
    email: '',
    emailConfidence: 0,
    directorName: prospect.directorName || '',
    fitScore: prospect.fitScore || 0,
    fitReason: prospect.fitReason || '',
    emailStatus: 'pending',       // pending | searching | found | not_found | guessed
    sequenceStatus: 'draft',      // draft | generated | sending | step1_sent | step2_sent | step3_sent | completed | replied
    addedAt: new Date().toISOString(),
  };
  db.prospects.push(entry);
  write(db);
  return entry;
}

function getProspects(filter) {
  const db = read();
  if (!filter || filter === 'all') return db.prospects;
  if (filter === 'need_email') return db.prospects.filter(p => !p.email || p.emailStatus === 'pending');
  if (filter === 'ready') return db.prospects.filter(p => p.email && p.sequenceStatus === 'draft');
  if (filter === 'in_progress') return db.prospects.filter(p => ['generated', 'sending', 'step1_sent', 'step2_sent', 'step3_sent'].includes(p.sequenceStatus));
  if (filter === 'completed') return db.prospects.filter(p => ['completed', 'replied'].includes(p.sequenceStatus));
  return db.prospects;
}

function getProspect(id) {
  const db = read();
  return db.prospects.find(p => p.id === Number(id)) || null;
}

function updateProspect(id, updates) {
  const db = read();
  const idx = db.prospects.findIndex(p => p.id === Number(id));
  if (idx === -1) return null;
  db.prospects[idx] = { ...db.prospects[idx], ...updates };
  write(db);
  return db.prospects[idx];
}

function removeProspect(id) {
  const db = read();
  db.prospects = db.prospects.filter(p => p.id !== Number(id));
  db.sequences = db.sequences.filter(s => s.prospectId !== Number(id));
  db.events = db.events.filter(e => e.prospectId !== Number(id));
  write(db);
}

// ─── Sequences ─────────────────────────────────────────────────────────────────

function addSequence(seq) {
  const db = read();
  const id = nextId(db);
  const entry = {
    id,
    prospectId: seq.prospectId,
    step: seq.step,           // 1, 2, or 3
    subject: seq.subject,
    body: seq.body,
    status: 'pending',        // pending | scheduled | sent | opened | clicked | replied | bounced
    scheduledAt: seq.scheduledAt || null,
    sentAt: null,
    createdAt: new Date().toISOString(),
  };
  db.sequences.push(entry);
  write(db);
  return entry;
}

function getSequences(prospectId) {
  const db = read();
  return db.sequences
    .filter(s => s.prospectId === Number(prospectId))
    .sort((a, b) => a.step - b.step);
}

function getAllPendingSequences() {
  const db = read();
  const now = new Date();
  return db.sequences.filter(s =>
    s.status === 'scheduled' && s.scheduledAt && new Date(s.scheduledAt) <= now
  );
}

function updateSequence(id, updates) {
  const db = read();
  const idx = db.sequences.findIndex(s => s.id === Number(id));
  if (idx === -1) return null;
  db.sequences[idx] = { ...db.sequences[idx], ...updates };
  write(db);
  return db.sequences[idx];
}

// ─── Events / tracking ────────────────────────────────────────────────────────

function addEvent(event) {
  const db = read();
  db.events.push({
    ...event,
    timestamp: new Date().toISOString(),
  });
  write(db);
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

function getStats() {
  const db = read();
  const seqs = db.sequences;
  return {
    totalProspects: db.prospects.length,
    emailsFound: db.prospects.filter(p => p.email && p.emailStatus === 'found').length,
    emailsGuessed: db.prospects.filter(p => p.email && p.emailStatus === 'guessed').length,
    sequencesGenerated: db.prospects.filter(p => ['generated', 'sending', 'step1_sent', 'step2_sent', 'step3_sent', 'completed'].includes(p.sequenceStatus)).length,
    totalSent: seqs.filter(s => ['sent', 'opened', 'clicked', 'replied'].includes(s.status)).length,
    opened: seqs.filter(s => ['opened', 'clicked'].includes(s.status)).length,
    clicked: seqs.filter(s => s.status === 'clicked').length,
    replied: seqs.filter(s => s.status === 'replied').length,
    bounced: seqs.filter(s => s.status === 'bounced').length,
    pending: seqs.filter(s => ['pending', 'scheduled'].includes(s.status)).length,
  };
}

module.exports = {
  addProspect, getProspects, getProspect, updateProspect, removeProspect,
  addSequence, getSequences, getAllPendingSequences, updateSequence,
  addEvent, getStats,
};
