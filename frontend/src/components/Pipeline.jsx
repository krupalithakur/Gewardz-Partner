import { useState, useEffect, useCallback } from 'react';
import OutreachModal from './OutreachModal.jsx';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'need_email', label: 'Need Email' },
  { value: 'ready', label: 'Ready' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Done' },
];

function initials(name) {
  if (!name || name === 'Unknown') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function confidenceLabel(c) {
  if (c >= 90) return { text: 'Verified', cls: 'tag-green' };
  if (c >= 60) return { text: 'Likely', cls: 'tag-blue' };
  if (c >= 30) return { text: 'Guessed', cls: 'tag-amber' };
  return { text: 'Low', cls: 'tag-red' };
}

function stepBadge(seq, stepNum) {
  const s = seq.find(x => x.step === stepNum);
  if (!s) return <span className="step-dot step-pending" title="Not generated">{stepNum}</span>;
  if (s.status === 'sent' || s.status === 'opened' || s.status === 'clicked')
    return <span className="step-dot step-sent" title={`Sent ${s.sentAt ? new Date(s.sentAt).toLocaleDateString() : ''}`}>{stepNum} ✓</span>;
  if (s.status === 'replied') return <span className="step-dot step-replied" title="Replied!">{stepNum} ★</span>;
  if (s.status === 'scheduled') return <span className="step-dot step-scheduled" title={`Scheduled ${new Date(s.scheduledAt).toLocaleDateString()}`}>{stepNum} ⏱</span>;
  if (s.status === 'bounced') return <span className="step-dot step-bounced" title="Bounced">{stepNum} ✗</span>;
  return <span className="step-dot step-pending" title="Pending">{stepNum}</span>;
}

export default function Pipeline() {
  const [prospects, setProspects] = useState([]);
  const [stats, setStats] = useState({});
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [previewSeq, setPreviewSeq] = useState(null);

  const fetchPipeline = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/pipeline?filter=${filter}`);
      const data = await res.json();
      setProspects(data.prospects || []);
      setStats(data.stats || {});
    } catch (e) {
      console.error('Pipeline fetch error:', e);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchPipeline(); }, [fetchPipeline]);

  // ─── Actions ──────────────────────────────────────────────────────────────────

  const findEmail = async (prospectId) => {
    setActionLoading(`email-${prospectId}`);
    try {
      await fetch('/api/pipeline/find-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId }),
      });
      fetchPipeline();
    } finally { setActionLoading(''); }
  };

  const findAllEmails = async () => {
    setActionLoading('find-all');
    try {
      await fetch('/api/pipeline/find-all-emails', { method: 'POST' });
      fetchPipeline();
    } finally { setActionLoading(''); }
  };

  const generateSequence = async (prospectId) => {
    setActionLoading(`gen-${prospectId}`);
    try {
      await fetch('/api/pipeline/generate-sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prospectId }),
      });
      fetchPipeline();
    } finally { setActionLoading(''); }
  };

  const generateAllSequences = async () => {
    setActionLoading('gen-all');
    try {
      await fetch('/api/pipeline/generate-all-sequences', { method: 'POST' });
      fetchPipeline();
    } finally { setActionLoading(''); }
  };

  const sendStep = async (sequenceId) => {
    setActionLoading(`send-${sequenceId}`);
    try {
      const res = await fetch('/api/pipeline/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sequenceId }),
      });
      const data = await res.json();
      if (data.demo) alert('Demo mode: email marked as sent. Add RESEND_API_KEY to .env to send real emails.');
      fetchPipeline();
    } finally { setActionLoading(''); }
  };

  const sendAllStep1 = async () => {
    setActionLoading('send-all');
    try {
      const res = await fetch('/api/pipeline/send-all-step1', { method: 'POST' });
      const data = await res.json();
      if (data.results?.[0]?.demo) alert('Demo mode: emails marked as sent. Add RESEND_API_KEY for real sends.');
      fetchPipeline();
    } finally { setActionLoading(''); }
  };

  const removeProspect = async (id) => {
    await fetch(`/api/pipeline/${id}`, { method: 'DELETE' });
    fetchPipeline();
  };

  const markReplied = async (prospectId) => {
    await fetch('/api/pipeline/mark-replied', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prospectId }),
    });
    fetchPipeline();
  };

  // ─── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Stats */}
      <div className="stats-bar">
        <div className="stat-chip">
          <div className="stat-icon stat-icon-green">👥</div>
          <span className="stat-value">{stats.totalProspects || 0}</span>
          <span className="stat-label">Prospects</span>
        </div>
        <div className="stat-chip">
          <div className="stat-icon stat-icon-blue">✉</div>
          <span className="stat-value">{(stats.emailsFound || 0) + (stats.emailsGuessed || 0)}</span>
          <span className="stat-label">Emails Found</span>
        </div>
        <div className="stat-chip">
          <div className="stat-icon stat-icon-amber">📤</div>
          <span className="stat-value">{stats.totalSent || 0}</span>
          <span className="stat-label">Sent</span>
        </div>
        <div className="stat-chip">
          <div className="stat-icon stat-icon-green">👁</div>
          <span className="stat-value">{stats.opened || 0}</span>
          <span className="stat-label">Opened</span>
        </div>
        <div className="stat-chip">
          <div className="stat-icon stat-icon-purple">💬</div>
          <span className="stat-value">{stats.replied || 0}</span>
          <span className="stat-label">Replied</span>
        </div>
      </div>

      {/* Filter tabs + bulk actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {FILTERS.map(f => (
          <button
            key={f.value}
            className={`btn btn-sm ${filter === f.value ? 'btn-primary' : 'btn-secondary'}`}
            style={filter === f.value ? { padding: '5px 14px' } : { padding: '5px 14px' }}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-secondary btn-sm"
          onClick={findAllEmails}
          disabled={!!actionLoading}
          title="Find emails for all prospects without one"
        >
          {actionLoading === 'find-all' ? <><span className="loading-spinner" style={{ width: 12, height: 12 }} /> Finding…</> : '🔍 Find All Emails'}
        </button>
        <button
          className="btn btn-secondary btn-sm"
          onClick={generateAllSequences}
          disabled={!!actionLoading}
          title="Generate outreach sequences for all prospects with emails"
        >
          {actionLoading === 'gen-all' ? <><span className="loading-spinner" style={{ width: 12, height: 12 }} /> Generating…</> : '✨ Generate All'}
        </button>
        <button
          className="btn btn-primary btn-sm"
          style={{ width: 'auto' }}
          onClick={sendAllStep1}
          disabled={!!actionLoading}
          title="Send Step 1 for all generated sequences"
        >
          {actionLoading === 'send-all' ? <><span className="loading-spinner" style={{ width: 12, height: 12 }} /> Sending…</> : '📧 Send All Step 1'}
        </button>
      </div>

      {/* Prospect cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
          <span className="loading-spinner" style={{ width: 24, height: 24 }} />
        </div>
      ) : prospects.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-icon">📋</div>
          <div className="empty-state-title">Pipeline is empty</div>
          <div className="empty-state-desc">
            Go to Discovery, search for companies, and click <strong>"+ Pipeline"</strong> on the cards you want to outreach.
          </div>
        </div>
      ) : (
        <div className="cards-list">
          {prospects.map(p => {
            const seqs = p.sequences || [];
            const expanded = expandedId === p.id;
            const emailConf = p.email ? confidenceLabel(p.emailConfidence) : null;

            return (
              <div className="company-card" key={p.id}>
                <div className="card-header">
                  <div className="card-avatar">{initials(p.directorName || p.companyName)}</div>
                  <div className="card-main">
                    {/* Header row */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                      <div>
                        <div className="card-owner-name">{p.directorName || p.companyName}</div>
                        {p.directorName && <div className="card-company-name">{p.companyName}</div>}
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                        {p.fitScore >= 7 && <span className="confidence-badge badge-high">Score {p.fitScore}/10</span>}
                        {p.fitScore >= 4 && p.fitScore < 7 && <span className="confidence-badge badge-medium">Score {p.fitScore}/10</span>}
                      </div>
                    </div>

                    {/* Tags */}
                    <div className="card-tags" style={{ marginTop: 8 }}>
                      {p.county && <span className="tag tag-gray">{p.county}</span>}
                      {p.industry && <span className="tag tag-gray">{p.industry}</span>}
                      <span className="tag" style={{
                        background: p.sequenceStatus === 'replied' ? 'var(--accent-dim)' :
                          p.sequenceStatus.startsWith('step') ? 'var(--blue-dim)' :
                            p.sequenceStatus === 'generated' ? 'var(--amber-dim)' : '#f3f4f6',
                        color: p.sequenceStatus === 'replied' ? 'var(--accent-text)' :
                          p.sequenceStatus.startsWith('step') ? 'var(--blue-text)' :
                            p.sequenceStatus === 'generated' ? 'var(--amber-text)' : '#374151',
                        border: 'none',
                      }}>
                        {p.sequenceStatus === 'draft' ? 'Draft' :
                          p.sequenceStatus === 'generated' ? 'Ready to Send' :
                            p.sequenceStatus === 'replied' ? 'Replied!' :
                              p.sequenceStatus.replace('_', ' ').replace('step', 'Step ')}
                      </span>
                    </div>

                    {/* Email row */}
                    <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      {p.email ? (
                        <>
                          <span style={{ fontSize: 13, color: 'var(--text)' }}>✉ {p.email}</span>
                          {emailConf && <span className={`tag ${emailConf.cls}`} style={{ fontSize: 10 }}>{emailConf.text} ({p.emailConfidence}%)</span>}
                        </>
                      ) : (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => findEmail(p.id)}
                          disabled={!!actionLoading}
                          style={{ fontSize: 11 }}
                        >
                          {actionLoading === `email-${p.id}` ? <><span className="loading-spinner" style={{ width: 10, height: 10 }} /> Finding…</> : '🔍 Find Email'}
                        </button>
                      )}
                    </div>

                    {/* Sequence steps */}
                    {seqs.length > 0 && (
                      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginRight: 4 }}>Steps:</span>
                        {[1, 2, 3].map(n => (
                          <span key={n}>{stepBadge(seqs, n)}</span>
                        ))}
                      </div>
                    )}

                    {/* Expanded: show email previews */}
                    {expanded && seqs.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        {seqs.map(s => (
                          <div key={s.id} style={{
                            background: 'var(--surface2)', border: '1px solid var(--border)',
                            borderRadius: 8, padding: 12, marginBottom: 8, fontSize: 13,
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <strong style={{ color: 'var(--text)' }}>Step {s.step}: {s.subject}</strong>
                              {s.status === 'pending' && p.email && (
                                <button
                                  className="btn-outreach"
                                  style={{ fontSize: 11, padding: '3px 10px' }}
                                  onClick={() => sendStep(s.id)}
                                  disabled={!!actionLoading}
                                >
                                  {actionLoading === `send-${s.id}` ? '…' : 'Send'}
                                </button>
                              )}
                              {s.status === 'sent' && <span className="tag tag-green" style={{ fontSize: 10 }}>Sent ✓</span>}
                              {s.status === 'scheduled' && <span className="tag tag-amber" style={{ fontSize: 10 }}>Scheduled</span>}
                            </div>
                            <div style={{ color: 'var(--text-muted)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{s.body}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {expanded && p.fitReason && (
                      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                        <strong>Fit reason:</strong> {p.fitReason}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="card-footer">
                      <button className="btn-more" onClick={() => setExpandedId(expanded ? null : p.id)}>
                        {expanded ? '▲ Less' : '▼ More'}
                      </button>

                      {!seqs.length && p.email && (
                        <button
                          className="btn-outreach"
                          onClick={() => generateSequence(p.id)}
                          disabled={!!actionLoading}
                        >
                          {actionLoading === `gen-${p.id}` ? <><span className="loading-spinner" style={{ width: 12, height: 12, borderTopColor: 'white' }} /> Generating…</> : '✦ Generate Sequence'}
                        </button>
                      )}

                      {seqs.length > 0 && seqs.some(s => s.status === 'pending') && p.email && (
                        <button
                          className="btn-outreach"
                          onClick={() => {
                            const next = seqs.find(s => s.status === 'pending');
                            if (next) sendStep(next.id);
                          }}
                          disabled={!!actionLoading}
                        >
                          📧 Send Next Step
                        </button>
                      )}

                      {p.sequenceStatus !== 'replied' && seqs.some(s => s.status === 'sent') && (
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => markReplied(p.id)}
                          style={{ fontSize: 11 }}
                        >
                          ✓ Mark Replied
                        </button>
                      )}

                      <div style={{ flex: 1 }} />

                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeProspect(p.id)}
                        style={{ color: 'var(--red)', fontSize: 11 }}
                        title="Remove from pipeline"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
