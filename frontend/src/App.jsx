import { useState, useCallback } from 'react';
import SearchPanel from './components/SearchPanel.jsx';
import ResultsTable from './components/ResultsTable.jsx';
import Pipeline from './components/Pipeline.jsx';

export default function App() {
  const [tab, setTab] = useState('discovery'); // discovery | pipeline
  const [companies, setCompanies] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [error, setError] = useState('');
  const [lastQuery, setLastQuery] = useState({
    keyword: '', county: '', size: '', companyType: '',
    status: 'active', directors: '', registeredAfter: '',
  });
  const [pipelineCount, setPipelineCount] = useState(0);

  // ─── Enrich helper ────────────────────────────────────────────────────────────
  const enrichCompanies = useCallback(async (raw, sizeFilter) => {
    if (!raw || raw.length === 0) return raw;
    setEnriching(true);
    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: raw, sizeFilter: sizeFilter || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enrichment failed');
      return data.enriched || raw;
    } catch (e) {
      console.warn('Enrichment failed, showing raw results:', e.message);
      return raw;
    } finally {
      setEnriching(false);
    }
  }, []);

  // ─── Search (+ auto-enrich) ───────────────────────────────────────────────────
  const handleSearch = useCallback(async (params, newOffset = 0) => {
    setLoading(true);
    setError('');
    setCompanies([]);

    const { keyword, county, size, companyType, status, directors, registeredAfter } = params;
    setLastQuery({ keyword, county, size, companyType, status, directors, registeredAfter });

    const qs = new URLSearchParams();
    if (keyword)         qs.set('keyword', keyword);
    if (county)          qs.set('county', county);
    if (companyType)     qs.set('companyType', companyType);
    if (status)          qs.set('status', status);
    if (registeredAfter) qs.set('registeredAfter', registeredAfter);
    qs.set('limit', limit);
    qs.set('offset', newOffset);

    try {
      const res = await fetch(`/api/search?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');

      let records = data.records || [];
      const total  = data.total  || 0;

      if (directors === '1') records = records.filter(c => Number(c.num_of_directors) === 1);
      if (directors === '2') records = records.filter(c => Number(c.num_of_directors) === 2);

      setTotal(total);
      setOffset(newOffset);
      setLoading(false);

      const enriched = await enrichCompanies(records, size);
      setCompanies(enriched);
    } catch (e) {
      setError(e.message);
      setCompanies([]);
      setTotal(0);
      setLoading(false);
    }
  }, [limit, enrichCompanies]);

  // ─── Page change ──────────────────────────────────────────────────────────────
  const handlePageChange = useCallback((newOffset) => {
    handleSearch(lastQuery, newOffset);
  }, [handleSearch, lastQuery]);

  // ─── Add to pipeline ──────────────────────────────────────────────────────────
  const handleAddToPipeline = useCallback(async (company) => {
    try {
      const res = await fetch('/api/pipeline/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company }),
      });
      if (res.ok) {
        setPipelineCount(c => c + 1);
        // Brief visual feedback
        return true;
      }
    } catch (e) {
      console.error('Add to pipeline failed:', e);
    }
    return false;
  }, []);

  // ─── Export CSV ───────────────────────────────────────────────────────────────
  const handleExportCSV = useCallback(async () => {
    const enriched = companies.filter(c => c.enrichment);
    if (enriched.length === 0) return;
    try {
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companies: enriched }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gewardz-partners-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e.message);
    }
  }, [companies]);

  // Refresh pipeline count on mount
  useState(() => {
    fetch('/api/pipeline/stats').then(r => r.json()).then(d => setPipelineCount(d.totalProspects || 0)).catch(() => {});
  });

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="header">
        <div className="header-logo">
          <div className="header-logo-icon">🏥</div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="header-title">Partner Discovery</span>
              <span className="header-divider">—</span>
              <span className="header-subtitle">Ireland's owner-managed business finder</span>
            </div>
          </div>
        </div>

        {/* Tab buttons */}
        <div style={{ display: 'flex', gap: 4, marginLeft: 32 }}>
          <button
            onClick={() => setTab('discovery')}
            style={{
              padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none',
              background: tab === 'discovery' ? 'var(--accent-dim)' : 'transparent',
              color: tab === 'discovery' ? 'var(--accent-text)' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            🔍 Discovery
          </button>
          <button
            onClick={() => { setTab('pipeline'); fetch('/api/pipeline/stats').then(r => r.json()).then(d => setPipelineCount(d.totalProspects || 0)).catch(() => {}); }}
            style={{
              padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none',
              background: tab === 'pipeline' ? 'var(--accent-dim)' : 'transparent',
              color: tab === 'pipeline' ? 'var(--accent-text)' : 'var(--text-muted)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            📧 Outreach Pipeline
            {pipelineCount > 0 && (
              <span style={{
                background: 'var(--accent)', color: 'white', fontSize: 10, fontWeight: 700,
                padding: '1px 6px', borderRadius: 999, minWidth: 18, textAlign: 'center',
              }}>
                {pipelineCount}
              </span>
            )}
          </button>
        </div>

        <div className="header-spacer" />
        <span className="header-badge">Gewardz Health</span>
      </header>

      {/* Page body */}
      <div className="page-body">
        {error && (
          <div className="alert alert-error">
            ⚠️ {error}
            <button className="btn btn-ghost btn-sm" onClick={() => setError('')} style={{ marginLeft: 'auto' }}>✕</button>
          </div>
        )}

        {tab === 'discovery' && (
          <>
            <SearchPanel onSearch={p => handleSearch(p, 0)} loading={loading} />
            <ResultsTable
              companies={companies}
              loading={loading}
              enriching={enriching}
              total={total}
              offset={offset}
              limit={limit}
              onExportCSV={handleExportCSV}
              onPageChange={handlePageChange}
              onAddToPipeline={handleAddToPipeline}
            />
          </>
        )}

        {tab === 'pipeline' && <Pipeline />}
      </div>
    </div>
  );
}
