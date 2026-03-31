import { useState, useCallback } from 'react';
import SearchPanel from './components/SearchPanel.jsx';
import ResultsTable from './components/ResultsTable.jsx';

export default function App() {
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
      return raw; // degrade gracefully — still show un-enriched cards
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
    if (keyword)       qs.set('keyword', keyword);
    if (county)        qs.set('county', county);
    if (companyType)   qs.set('companyType', companyType);
    if (status)        qs.set('status', status);
    if (registeredAfter) qs.set('registeredAfter', registeredAfter);
    qs.set('limit', limit);
    qs.set('offset', newOffset);

    try {
      const res = await fetch(`/api/search?${qs}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Search failed');

      let records = data.records || [];
      const total  = data.total  || 0;

      // Client-side director / size hints (applied before enrichment)
      if (directors === '1')   records = records.filter(c => Number(c.num_of_directors) === 1);
      if (directors === '2')   records = records.filter(c => Number(c.num_of_directors) === 2);
      if (directors === '' && records.length > 0) {
        // default: prefer 1-2 directors (owner-managed) but keep all so count is accurate
      }

      setTotal(total);
      setOffset(newOffset);
      setLoading(false);

      // Auto-enrich immediately after search
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
        />
      </div>
    </div>
  );
}
