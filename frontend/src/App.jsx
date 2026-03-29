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
  const [enrichingIndex, setEnrichingIndex] = useState(-1);
  const [error, setError] = useState('');
  const [lastQuery, setLastQuery] = useState({ keyword: '', county: '', size: '' });
  const [selectedIds, setSelectedIds] = useState(new Set());

  // ─── Search ─────────────────────────────────────────────────────────────────
  const handleSearch = useCallback(async (params, newOffset = 0) => {
    setLoading(true);
    setError('');
    setSelectedIds(new Set());

    const { keyword, county, size } = params;
    setLastQuery({ keyword, county, size });

    const qs = new URLSearchParams();
    if (keyword) qs.set('keyword', keyword);
    if (county) qs.set('county', county);
    qs.set('limit', limit);
    qs.set('offset', newOffset);

    try {
      const res = await fetch(`/api/search?${qs}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || 'Search failed');

      setCompanies(data.records || []);
      setTotal(data.total || 0);
      setOffset(newOffset);
    } catch (e) {
      setError(e.message);
      setCompanies([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [limit]);

  // ─── Page change ─────────────────────────────────────────────────────────────
  const handlePageChange = useCallback((newOffset) => {
    handleSearch(lastQuery, newOffset);
  }, [handleSearch, lastQuery]);

  // ─── Enrich companies ────────────────────────────────────────────────────────
  const handleEnrich = useCallback(async (targetCompanies) => {
    if (!targetCompanies || targetCompanies.length === 0) return;
    setEnriching(true);
    setError('');

    try {
      const res = await fetch('/api/enrich', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companies: targetCompanies,
          sizeFilter: lastQuery.size || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Enrichment failed');

      const enriched = data.enriched || [];

      setCompanies(prev => prev.map(c => {
        const match = enriched.find(e =>
          (e.company_name && e.company_name === c.company_name) ||
          (e.company_num && e.company_num === c.company_num) ||
          (e._id !== undefined && e._id === c._id)
        );
        return match || c;
      }));
    } catch (e) {
      setError(e.message);
    } finally {
      setEnriching(false);
      setEnrichingIndex(-1);
    }
  }, [lastQuery.size]);

  // Enrich all visible companies
  const handleEnrichAll = useCallback(() => {
    handleEnrich(companies);
  }, [companies, handleEnrich]);

  // ─── Export CSV ──────────────────────────────────────────────────────────────
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

  // ─── Selection ───────────────────────────────────────────────────────────────
  const handleToggleSelect = useCallback((id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const allIds = companies.map((c, i) => c._id || c.company_num || c['Company Number'] || i);
    const allSelected = allIds.every(id => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  }, [companies, selectedIds]);

  return (
    <div className="app-shell">
      {/* Header */}
      <header className="header">
        <div className="header-logo">
          <div className="header-logo-icon">🏥</div>
          <div>
            <div className="header-title">Gewardz Partner Discovery</div>
            <div className="header-subtitle">Powered by CRO Ireland Open Data + Claude AI</div>
          </div>
        </div>
        <div className="header-spacer" />
        <span className="header-badge">Gewardz Health</span>
      </header>

      {/* Sidebar */}
      <SearchPanel onSearch={params => handleSearch(params, 0)} loading={loading} />

      {/* Main */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {error && (
          <div className="alert alert-error" style={{ margin: '12px 16px', flexShrink: 0 }}>
            ⚠️ {error}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setError('')}
              style={{ marginLeft: 'auto' }}
            >
              ✕
            </button>
          </div>
        )}

        <ResultsTable
          companies={companies}
          loading={loading}
          enriching={enriching}
          enrichingIndex={enrichingIndex}
          total={total}
          offset={offset}
          limit={limit}
          onEnrichOne={handleEnrich}
          onEnrichAll={handleEnrichAll}
          onExportCSV={handleExportCSV}
          onPageChange={handlePageChange}
          selectedIds={selectedIds}
          onToggleSelect={handleToggleSelect}
          onSelectAll={handleSelectAll}
        />
      </div>
    </div>
  );
}
