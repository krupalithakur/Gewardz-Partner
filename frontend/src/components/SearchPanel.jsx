import { useState, useEffect } from 'react';

const SIZE_OPTIONS = [
  { value: '', label: 'All sizes' },
  { value: 'small', label: 'Small (1–50 employees)' },
  { value: 'medium', label: 'Medium (51–250 employees)' },
  { value: 'large', label: 'Large (250+ employees)' },
];

export default function SearchPanel({ onSearch, loading }) {
  const [keyword, setKeyword] = useState('');
  const [county, setCounty] = useState('');
  const [size, setSize] = useState('');
  const [counties, setCounties] = useState([]);

  useEffect(() => {
    fetch('/api/counties')
      .then(r => r.json())
      .then(d => setCounties(d.counties || []))
      .catch(() => {});
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch({ keyword: keyword.trim(), county, size });
  };

  const handleClear = () => {
    setKeyword('');
    setCounty('');
    setSize('');
    onSearch({ keyword: '', county: '', size: '' });
  };

  return (
    <aside className="sidebar">
      <div>
        <p className="sidebar-section-title">Search</p>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="form-group">
            <label className="form-label">Keyword / Company Name</label>
            <input
              className="form-input"
              type="text"
              placeholder="e.g. Tech Solutions, Pharma..."
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label className="form-label">County</label>
            <select
              className="form-select"
              value={county}
              onChange={e => setCounty(e.target.value)}
            >
              <option value="">All counties</option>
              {counties.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Company Size</label>
            <select
              className="form-select"
              value={size}
              onChange={e => setSize(e.target.value)}
            >
              {SIZE_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Applied during AI enrichment
            </span>
          </div>

          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? (
              <><span className="loading-spinner" />Searching…</>
            ) : (
              <><SearchIcon />Search Companies</>
            )}
          </button>

          <button
            className="btn btn-secondary"
            type="button"
            onClick={handleClear}
            disabled={loading}
          >
            Clear
          </button>
        </form>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <p className="sidebar-section-title">About</p>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.7 }}>
          <p>Data sourced from the <strong style={{ color: 'var(--text)' }}>Companies Registration Office Ireland</strong> Open Data API.</p>
          <br />
          <p>AI enrichment powered by <strong style={{ color: 'var(--text)' }}>Claude (Anthropic)</strong> to estimate contact details and partner fit scores for Gewardz Health.</p>
        </div>
      </div>

      <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
        <p className="sidebar-section-title">Legend</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
          {[
            { dot: 'priority-hot', label: 'Hot – strong fit, act now' },
            { dot: 'priority-warm', label: 'Warm – good fit, nurture' },
            { dot: 'priority-cold', label: 'Cold – low fit, deprioritise' },
          ].map(({ dot, label }) => (
            <div key={dot} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`priority-pill ${dot}`}>{dot.split('-')[1]}</span>
              <span style={{ color: 'var(--text-muted)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
