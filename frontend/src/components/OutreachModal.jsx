import { useState, useRef, useEffect } from 'react';

function renderOutreachText(text) {
  // Highlight ## headings and **bold**
  const lines = text.split('\n');
  return lines.map((line, i) => {
    if (line.startsWith('## ')) {
      return (
        <div key={i} className="section-header" style={{ marginTop: i === 0 ? 0 : 16 }}>
          {line.replace('## ', '')}
        </div>
      );
    }
    // Handle **bold** inline
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <div key={i}>
        {parts.map((p, j) =>
          p.startsWith('**') && p.endsWith('**')
            ? <span key={j} className="bold-text">{p.slice(2, -2)}</span>
            : p
        )}
      </div>
    );
  });
}

export default function OutreachModal({ company, onClose }) {
  const [sequenceType, setSequenceType] = useState('email');
  const [text, setText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);
  const contentRef = useRef(null);

  const companyName =
    company.company_name || company['Company Name'] || company.name || 'Company';

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text]);

  async function generate() {
    setText('');
    setDone(false);
    setError('');
    setGenerating(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company, sequenceType }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Server error');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const payload = JSON.parse(line.slice(6));
            if (payload.error) throw new Error(payload.error);
            if (payload.done) { setDone(true); break; }
            if (payload.text) setText(prev => prev + payload.text);
          } catch (e) {
            if (e.message !== 'Unexpected end of JSON input') throw e;
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
    } finally {
      setGenerating(false);
    }
  }

  function stop() {
    abortRef.current?.abort();
    setGenerating(false);
  }

  function copy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <div style={{ fontSize: 20 }}>✉️</div>
          <div>
            <div className="modal-title">Outreach Sequence Generator</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{companyName}</div>
          </div>
          <button className="btn btn-ghost" onClick={onClose} style={{ marginLeft: 'auto' }}>✕</button>
        </div>

        <div className="modal-body">
          {/* Type toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>Sequence type</span>
            <div className="tab-group">
              <button
                className={`tab-btn ${sequenceType === 'email' ? 'active' : ''}`}
                onClick={() => { setSequenceType('email'); setText(''); setDone(false); }}
              >📧 Cold Email</button>
              <button
                className={`tab-btn ${sequenceType === 'linkedin' ? 'active' : ''}`}
                onClick={() => { setSequenceType('linkedin'); setText(''); setDone(false); }}
              >💼 LinkedIn</button>
            </div>
          </div>

          {/* Company summary card */}
          {company.enrichment && (
            <div style={{
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)',
              padding: '10px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 12,
            }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>👤 <strong>{company.enrichment.estimatedOwnerName || '—'}</strong></span>
                <span>📍 {(company.company_address_4 || company['County'] || '').split(',')[0].trim() || '—'}</span>
                <span>🏭 {company.enrichment.industryTag || '—'}</span>
                <span>👥 {company.enrichment.estimatedCompanySize || '—'}</span>
                <span>
                  Fit score:{' '}
                  <strong style={{ color: scoreFitColor(company.enrichment.partnerFitScore) }}>
                    {company.enrichment.partnerFitScore ?? '—'}/10
                  </strong>
                </span>
              </div>
              {company.enrichment.fitReason && (
                <p style={{ color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.5 }}>
                  {company.enrichment.fitReason}
                </p>
              )}
            </div>
          )}

          {/* Error */}
          {error && <div className="alert alert-error">⚠️ {error}</div>}

          {/* Output */}
          <div
            ref={contentRef}
            className="outreach-content"
            style={{ minHeight: text ? undefined : 100 }}
          >
            {!text && !generating && (
              <span style={{ color: 'var(--text-muted)' }}>
                Click "Generate" to create a personalised outreach sequence for this company.
              </span>
            )}
            {text && renderOutreachText(text)}
            {generating && <span className="outreach-cursor" />}
          </div>
        </div>

        <div className="modal-footer">
          {text && (
            <button className="btn btn-secondary btn-sm" onClick={copy}>
              {copied ? '✅ Copied!' : '📋 Copy'}
            </button>
          )}
          {generating ? (
            <button className="btn btn-danger btn-sm" onClick={stop}>⏹ Stop</button>
          ) : (
            <button className="btn btn-primary btn-sm" onClick={generate}>
              {text ? '🔄 Regenerate' : '✨ Generate'}
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function scoreFitColor(score) {
  if (!score) return 'var(--text-muted)';
  if (score >= 7) return 'var(--green)';
  if (score >= 4) return 'var(--yellow)';
  return 'var(--text-muted)';
}
