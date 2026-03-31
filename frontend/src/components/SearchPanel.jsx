import { useState, useEffect } from 'react';

const COMPANY_TYPES = [
  { value: '', label: 'All Types' },
  { value: 'LTD', label: 'LTD' },
  { value: 'DAC', label: 'DAC' },
  { value: 'CLG', label: 'CLG' },
  { value: 'PLC', label: 'PLC' },
];

const REGISTERED_AFTER = [
  { value: '', label: 'Any Year' },
  { value: '2020', label: 'Since 2020' },
  { value: '2018', label: 'Since 2018' },
  { value: '2015', label: 'Since 2015' },
  { value: '2010', label: 'Since 2010' },
];

const DIRECTORS = [
  { value: '', label: '1 or 2 (Owner-Managed)' },
  { value: '1', label: '1 Director' },
  { value: '2', label: '2 Directors' },
  { value: 'any', label: 'Any (All Sizes)' },
];

const SIZES = [
  { value: '', label: 'Any Size' },
  { value: 'micro', label: 'Micro (1–9)' },
  { value: 'small', label: 'Small (10–49)' },
  { value: 'medium', label: 'Medium (50–249)' },
  { value: 'large', label: 'Large (250–499)' },
  { value: 'enterprise', label: 'Enterprise (500+)' },
];

const STATUSES = [
  { value: 'active', label: 'Normal / Active' },
  { value: '', label: 'All Statuses' },
  { value: 'struck', label: 'Struck Off' },
];

export default function SearchPanel({ onSearch, loading }) {
  const [keyword, setKeyword] = useState('');
  const [county, setCounty] = useState('');
  const [companyType, setCompanyType] = useState('');
  const [registeredAfter, setRegisteredAfter] = useState('');
  const [directors, setDirectors] = useState('');
  const [size, setSize] = useState('');
  const [status, setStatus] = useState('active');
  const [counties, setCounties] = useState([]);

  useEffect(() => {
    fetch('/api/counties')
      .then(r => r.json())
      .then(d => setCounties(d.counties || []))
      .catch(() => {});
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSearch({ keyword: keyword.trim(), county, companyType, registeredAfter, directors, size, status });
  };

  return (
    <div className="filter-card">
      <div className="filter-card-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ color: 'var(--accent)' }}>
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        Search Filters
      </div>

      <form onSubmit={handleSubmit} className="filter-grid">
        {/* Keyword row */}
        <div className="form-group">
          <label className="form-label">Keyword / Industry</label>
          <input
            className="form-input"
            type="text"
            placeholder="e.g. recruitment, tech, pharma, construction..."
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
          />
        </div>

        {/* Row 1: County | Company Type | Registered After */}
        <div className="filter-row">
          <div className="form-group">
            <label className="form-label">County</label>
            <select className="form-select" value={county} onChange={e => setCounty(e.target.value)}>
              <option value="">All Counties</option>
              {counties.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Company Type</label>
            <select className="form-select" value={companyType} onChange={e => setCompanyType(e.target.value)}>
              {COMPANY_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Registered After</label>
            <select className="form-select" value={registeredAfter} onChange={e => setRegisteredAfter(e.target.value)}>
              {REGISTERED_AFTER.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Row 2: Directors | Company Size | Status */}
        <div className="filter-row-2">
          <div className="form-group">
            <label className="form-label">Directors</label>
            <select className="form-select" value={directors} onChange={e => setDirectors(e.target.value)}>
              {DIRECTORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Company Size</label>
            <select className="form-select" value={size} onChange={e => setSize(e.target.value)}>
              {SIZES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Company Status</label>
            <select className="form-select" value={status} onChange={e => setStatus(e.target.value)}>
              {STATUSES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        {/* Submit */}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          {loading ? (
            <><span className="loading-spinner" style={{ width: 16, height: 16, borderTopColor: 'white' }} />Finding Businesses…</>
          ) : (
            <><SearchIcon />Find Owner-Managed Businesses</>
          )}
        </button>
      </form>
    </div>
  );
}

function SearchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}
