import { useState } from 'react';
import OutreachModal from './OutreachModal.jsx';

function getField(company, ...keys) {
  for (const k of keys) {
    if (company[k] !== undefined && company[k] !== null && company[k] !== '') return company[k];
  }
  return '';
}

// CRO API uses snake_case: company_name, company_num, company_type, company_status
// company_address_4 typically holds "CITY, Ireland"
function getCompanyName(c) {
  return getField(c, 'company_name', 'Company Name', 'name') || 'Unknown';
}

function getCompanyNumber(c) {
  return getField(c, 'company_num', 'Company Number', '_id');
}

function getCompanyType(c) {
  return getField(c, 'company_type', 'Company Type', 'type');
}

function getCounty(c) {
  // address_4 contains e.g. "DUBLIN, Ireland" – extract city part
  const addr4 = c.company_address_4 || '';
  return addr4 ? addr4.split(',')[0].trim() : getField(c, 'County', 'county');
}

function getStatus(c) {
  return getField(c, 'company_status', 'Status', 'status');
}

function statusClass(status) {
  const s = (status || '').toLowerCase();
  if (s.includes('normal') || s.includes('active')) return 'status-normal';
  if (s.includes('dissolv') || s.includes('struck') || s.includes('liquidat')) return 'status-dissolved';
  return 'status-other';
}

function scoreClass(score) {
  if (!score) return '';
  if (score >= 7) return 'score-hot';
  if (score >= 4) return 'score-warm';
  return 'score-cold';
}

function priorityClass(p) {
  if (!p) return 'priority-cold';
  const lower = p.toLowerCase();
  if (lower === 'hot') return 'priority-hot';
  if (lower === 'warm') return 'priority-warm';
  return 'priority-cold';
}

function EnrichmentTooltip({ enrichment }) {
  const [show, setShow] = useState(false);

  if (!enrichment) return <span style={{ color: 'var(--text-dim)', fontSize: 11 }}>—</span>;

  return (
    <div
      className="enrichment-tooltip"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <div
        className={`score-badge ${scoreClass(enrichment.partnerFitScore)}`}
        style={{ cursor: 'default' }}
      >
        {enrichment.partnerFitScore ?? '?'}
      </div>

      {show && (
        <div className="enrichment-details">
          <div className="detail-row">
            <span className="detail-label">Owner</span>
            <span className="detail-value">{enrichment.estimatedOwnerName || '—'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Email</span>
            <span className="detail-value">{enrichment.estimatedOwnerEmail || '—'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">LinkedIn</span>
            <span className="detail-value">{enrichment.estimatedOwnerLinkedIn || '—'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Size</span>
            <span className="detail-value">{enrichment.estimatedCompanySize || '—'}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Fit reason</span>
            <span className="detail-value">{enrichment.fitReason || '—'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function ResultsTable({
  companies,
  loading,
  enriching,
  enrichingIndex,
  total,
  offset,
  limit,
  onEnrichOne,
  onEnrichAll,
  onExportCSV,
  onPageChange,
  selectedIds,
  onToggleSelect,
  onSelectAll,
}) {
  const [outreachCompany, setOutreachCompany] = useState(null);

  const allSelected = companies.length > 0 && companies.every(c => selectedIds.has(c._id || getCompanyNumber(c)));
  const anySelected = companies.some(c => selectedIds.has(c._id || getCompanyNumber(c)));
  const anyEnriched = companies.some(c => c.enrichment);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  if (!loading && companies.length === 0) {
    return (
      <div className="main-content">
        <div className="empty-state">
          <div className="empty-state-icon">🔍</div>
          <div className="empty-state-title">No results yet</div>
          <div className="empty-state-desc">
            Use the search panel to find Irish companies from the CRO Open Data register.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="main-content">
      {/* Stats bar */}
      <div className="stats-bar">
        <div className="stat-item">
          <span className="stat-value">{total.toLocaleString()}</span>
          <span className="stat-label">companies found</span>
        </div>
        <div className="stat-item">
          <span className="stat-value">{companies.filter(c => c.enrichment).length}</span>
          <span className="stat-label">enriched</span>
        </div>
        {anyEnriched && (
          <div className="stat-item">
            <span className="stat-value">
              {companies.filter(c => c.enrichment?.priorityLevel === 'Hot').length}
            </span>
            <span className="stat-label">hot leads</span>
          </div>
        )}
        <div className="stats-bar-spacer" />
        <div className="stats-actions">
          <button
            className="btn btn-secondary btn-sm"
            onClick={onEnrichAll}
            disabled={enriching || loading || companies.length === 0}
            title="Enrich all visible companies with AI"
          >
            {enriching ? (
              <><span className="loading-spinner" style={{ width: 12, height: 12 }} />Enriching…</>
            ) : '✨ Enrich All'}
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onExportCSV}
            disabled={!anyEnriched}
            title="Export enriched companies to CSV"
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* Selection bar */}
      {anySelected && (
        <div className="select-all-bar">
          <span>{[...selectedIds].length} selected</span>
          <button
            className="btn btn-primary btn-sm"
            style={{ padding: '4px 12px' }}
            onClick={() => {
              const sel = companies.filter(c => selectedIds.has(c._id || getCompanyNumber(c)));
              onEnrichOne(sel);
            }}
            disabled={enriching}
          >
            ✨ Enrich selected
          </button>
        </div>
      )}

      {/* Table */}
      <div className="results-area">
        {loading ? (
          <table className="results-table">
            <thead>
              <tr>
                <th className="col-name">Company</th>
                <th className="col-county">County</th>
                <th className="col-type">Type</th>
                <th className="col-status">Status</th>
                <th className="col-score">Fit Score</th>
                <th className="col-priority">Priority</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 8 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j}><div className="skeleton" style={{ width: j === 0 ? '80%' : '60%' }} /></td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="results-table">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={onSelectAll}
                    style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                    title="Select all"
                  />
                </th>
                <th className="col-name">Company</th>
                <th className="col-county">County</th>
                <th className="col-type">Type</th>
                <th className="col-status">Status</th>
                <th className="col-score" title="Hover for details">Fit ↑</th>
                <th className="col-priority">Priority</th>
                <th style={{ width: 100 }}>Industry</th>
                <th className="col-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {companies.map((company, idx) => {
                const id = company._id || getCompanyNumber(company) || idx;
                const selected = selectedIds.has(id);
                const isEnriching = enriching && enrichingIndex === idx;
                const e = company.enrichment;

                return (
                  <tr key={id} style={selected ? { background: 'rgba(91,106,245,0.06)' } : undefined}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => onToggleSelect(id)}
                        style={{ accentColor: 'var(--accent)', cursor: 'pointer' }}
                      />
                    </td>
                    <td>
                      <div className="company-name">{getCompanyName(company)}</div>
                      {getCompanyNumber(company) && (
                        <div className="company-number">#{getCompanyNumber(company)}</div>
                      )}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{getCounty(company) || '—'}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{getCompanyType(company) || '—'}</td>
                    <td>
                      <span className={`status-dot ${statusClass(getStatus(company))}`}>
                        {getStatus(company) || '—'}
                      </span>
                    </td>
                    <td>
                      {isEnriching
                        ? <span className="loading-spinner" style={{ width: 20, height: 20 }} />
                        : <EnrichmentTooltip enrichment={e} />
                      }
                    </td>
                    <td>
                      {e?.priorityLevel
                        ? <span className={`priority-pill ${priorityClass(e.priorityLevel)}`}>{e.priorityLevel}</span>
                        : <span style={{ color: 'var(--text-dim)' }}>—</span>
                      }
                    </td>
                    <td>
                      {e?.industryTag
                        ? <span className="industry-tag">{e.industryTag}</span>
                        : <span style={{ color: 'var(--text-dim)' }}>—</span>
                      }
                    </td>
                    <td>
                      <div className="row-actions">
                        {!e && (
                          <button
                            className="btn btn-secondary btn-sm"
                            onClick={() => onEnrichOne([company])}
                            disabled={enriching}
                            title="AI enrich this company"
                          >
                            ✨
                          </button>
                        )}
                        <button
                          className="btn btn-secondary btn-sm"
                          onClick={() => setOutreachCompany(company)}
                          title="Generate outreach sequence"
                          disabled={enriching}
                        >
                          ✉️
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="pagination">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            disabled={offset === 0 || loading}
          >
            ← Prev
          </button>
          <span className="pagination-info">
            Page {currentPage} of {totalPages} · {total.toLocaleString()} total
          </span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onPageChange(offset + limit)}
            disabled={offset + limit >= total || loading}
          >
            Next →
          </button>
        </div>
      )}

      {/* Outreach modal */}
      {outreachCompany && (
        <OutreachModal
          company={outreachCompany}
          onClose={() => setOutreachCompany(null)}
        />
      )}
    </div>
  );
}
