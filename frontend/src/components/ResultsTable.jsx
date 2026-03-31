import { useState } from 'react';
import OutreachModal from './OutreachModal.jsx';

/* ─── Field helpers ──────────────────────────────────── */
function getField(c, ...keys) {
  for (const k of keys) {
    if (c[k] !== undefined && c[k] !== null && c[k] !== '') return c[k];
  }
  return '';
}

function getCompanyName(c) { return getField(c, 'company_name', 'Company Name', 'name') || 'Unknown'; }
function getCompanyNumber(c) { return getField(c, 'company_num', 'Company Number', '_id'); }
function getCompanyType(c) { return getField(c, 'company_type', 'Company Type', 'type'); }
function getStatus(c) { return getField(c, 'company_status', 'Status', 'status'); }
function getRegistered(c) {
  const raw = c.company_reg_date || c['Incorporation Date'] || '';
  if (!raw) return '';
  return raw.includes('T') ? raw.split('T')[0] : raw;
}
function getAddress(c) {
  return [c.company_address_1, c.company_address_2, c.company_address_3, c.company_address_4]
    .filter(Boolean).join(', ') || c['Address'] || '';
}
function getCounty(c) {
  const addr4 = c.company_address_4 || '';
  return addr4 ? addr4.split(',')[0].trim() : getField(c, 'County', 'county');
}

/* ─── Initials avatar ────────────────────────────────── */
function initials(name) {
  if (!name || name === 'Unknown') return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* ─── Confidence badge ───────────────────────────────── */
function confidenceBadge(e) {
  if (!e) return null;
  const score = e.partnerFitScore || 0;
  if (score >= 7) return <span className="confidence-badge badge-high">High Confidence</span>;
  if (score >= 4) return <span className="confidence-badge badge-medium">Moderate</span>;
  return null;
}

/* ─── Healthcare service tag ─────────────────────────── */
function healthcareTag(e) {
  if (!e) return null;
  const svc = e.currentHealthcareService || '';
  if (!svc || svc === 'Unknown') return null;
  if (svc === 'None Known') {
    return <span className="tag tag-green">No Existing Provider</span>;
  }
  return <span className="tag tag-amber">{svc}</span>;
}

/* ─── Skeleton card ──────────────────────────────────── */
function SkeletonCard() {
  return (
    <div className="card-skeleton">
      <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#e5e7eb', flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="skeleton" style={{ width: '35%' }} />
        <div className="skeleton" style={{ width: '55%' }} />
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          {[40, 70, 120, 90].map(w => <div key={w} className="skeleton" style={{ width: w, height: 20, borderRadius: 999 }} />)}
        </div>
        <div className="skeleton" style={{ width: '80%', marginTop: 4 }} />
      </div>
    </div>
  );
}

/* ─── Company card ───────────────────────────────────── */
function CompanyCard({ company, onOutreach, onAddToPipeline, enriching }) {
  const [addedToPipeline, setAddedToPipeline] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const e = company.enrichment;

  const ownerName = e?.estimatedOwnerName && e.estimatedOwnerName !== 'Unknown' ? e.estimatedOwnerName : null;
  const displayName = ownerName || getCompanyName(company);
  const companyName = ownerName ? getCompanyName(company) : null;
  const county = getCounty(company);
  const type = getCompanyType(company);
  const address = getAddress(company);
  const registered = getRegistered(company);
  const status = getStatus(company);

  return (
    <div className="company-card">
      {/* Header */}
      <div className="card-header">
        <div className="card-avatar">{initials(displayName)}</div>
        <div className="card-main">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
            <div>
              <div className="card-owner-name">{displayName}</div>
              {companyName && <div className="card-company-name">{companyName}</div>}
              {!companyName && ownerName === null && <div className="card-company-name">#{getCompanyNumber(company)}</div>}
            </div>
            {confidenceBadge(e)}
          </div>

          {/* Tags */}
          <div className="card-tags">
            {county && <span className="tag tag-gray">{county}</span>}
            {e?.industryTag && <span className="tag tag-gray">{e.industryTag}</span>}
            {type && <span className="tag tag-gray">{type.length > 30 ? type.replace('Private Company Limited by Shares', 'LTD').replace('Designated Activity Company', 'DAC').replace('Company Limited by Guarantee', 'CLG') : type}</span>}
            {healthcareTag(e)}
          </div>

          {/* Contact info */}
          {e && (e.estimatedOwnerEmail || e.estimatedOwnerLinkedIn || e.estimatedCompanySize) && (
            <div className="card-contact" style={{ marginTop: 10 }}>
              {e.estimatedOwnerEmail && (
                <div className="contact-item">
                  <span className="contact-icon">✉</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.estimatedOwnerEmail}</span>
                </div>
              )}
              {e.estimatedCompanySize && (
                <div className="contact-item">
                  <span className="contact-icon">👥</span>
                  <span>~{e.estimatedCompanySize} staff</span>
                </div>
              )}
              {e.estimatedOwnerLinkedIn && (
                <div className="contact-item">
                  <span className="contact-icon">🔗</span>
                  <a href={`https://${e.estimatedOwnerLinkedIn.replace(/^https?:\/\//, '')}`} target="_blank" rel="noreferrer" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>LinkedIn</a>
                </div>
              )}
              {county && (
                <div className="contact-item">
                  <span className="contact-icon">📍</span>
                  <span>{county}</span>
                </div>
              )}
            </div>
          )}

          {/* Pitch */}
          {e?.fitReason && (
            <div className="card-pitch">{e.fitReason}</div>
          )}

          {/* Expanded details */}
          {expanded && (
            <div className="card-details">
              <span className="detail-label">CRO Number</span>
              <span className="detail-value">{getCompanyNumber(company) || '—'}</span>
              <span className="detail-label">Registered</span>
              <span className="detail-value">{registered || '—'}</span>
              <span className="detail-label">Address</span>
              <span className="detail-value">{address || '—'}</span>
              <span className="detail-label">Status</span>
              <span className="detail-value">{status || '—'}</span>
              {e?.currentHealthcareService && e.currentHealthcareService !== 'Unknown' && (
                <>
                  <span className="detail-label">Healthcare</span>
                  <span className="detail-value">{e.currentHealthcareService}</span>
                </>
              )}
              {e?.estimatedOwnerName && e.estimatedOwnerName !== 'Unknown' && (
                <>
                  <span className="detail-label">Est. Owner</span>
                  <span className="detail-value">{e.estimatedOwnerName}</span>
                </>
              )}
            </div>
          )}

          {/* Footer */}
          <div className="card-footer">
            <button className="btn-more" onClick={() => setExpanded(x => !x)}>
              {expanded ? '▲ Less' : '▼ More'}
            </button>
            <div style={{ flex: 1 }} />
            {onAddToPipeline && (
              <button
                className={addedToPipeline ? 'btn btn-secondary btn-sm' : 'btn-outreach'}
                style={addedToPipeline ? { background: 'var(--accent-dim)', color: 'var(--accent-text)', border: '1px solid var(--accent)', fontSize: 12 } : {}}
                onClick={async () => {
                  if (!addedToPipeline && onAddToPipeline) {
                    const ok = await onAddToPipeline(company);
                    if (ok) setAddedToPipeline(true);
                  }
                }}
                disabled={addedToPipeline || enriching}
              >
                {addedToPipeline ? '✓ In Pipeline' : '+ Pipeline'}
              </button>
            )}
            <button
              className="btn-outreach"
              onClick={() => onOutreach(company)}
              disabled={enriching}
            >
              <span>✦</span> Generate Outreach
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Results container ──────────────────────────────── */
export default function ResultsTable({
  companies,
  loading,
  enriching,
  total,
  offset,
  limit,
  onExportCSV,
  onPageChange,
  onAddToPipeline,
}) {
  const [outreachCompany, setOutreachCompany] = useState(null);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const highConf = companies.filter(c => (c.enrichment?.partnerFitScore || 0) >= 7).length;
  const openOpp  = companies.filter(c => c.enrichment?.currentHealthcareService === 'None Known').length;
  const counties = new Set(companies.map(c => getCounty(c)).filter(Boolean)).size;
  const anyEnriched = companies.some(c => c.enrichment);

  if (!loading && companies.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🔍</div>
        <div className="empty-state-title">Find your next partners</div>
        <div className="empty-state-desc">
          Search for Irish owner-managed businesses from the CRO register. Results are automatically enriched with AI-estimated owner contact details and partner fit scores.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Stats bar */}
      {(companies.length > 0 || loading) && (
        <div className="stats-bar">
          <div className="stat-chip">
            <div className="stat-icon stat-icon-green">🏢</div>
            <span className="stat-value">{loading ? '—' : total.toLocaleString()}</span>
            <span className="stat-label">Total Found</span>
          </div>
          {anyEnriched && (
            <>
              <div className="stat-chip">
                <div className="stat-icon stat-icon-blue">🛡</div>
                <span className="stat-value">{highConf}</span>
                <span className="stat-label">High Confidence</span>
              </div>
              <div className="stat-chip">
                <div className="stat-icon stat-icon-green">💚</div>
                <span className="stat-value">{openOpp}</span>
                <span className="stat-label">Open Opportunities</span>
              </div>
            </>
          )}
          <div className="stat-chip">
            <div className="stat-icon stat-icon-amber">📍</div>
            <span className="stat-value">{loading ? '—' : counties}</span>
            <span className="stat-label">Counties</span>
          </div>

          <div className="stats-spacer" />

          <button
            className="export-btn"
            onClick={onExportCSV}
            disabled={!anyEnriched}
            title="Export enriched companies to CSV"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            Export CSV
          </button>
        </div>
      )}

      {/* Cards */}
      <div className="cards-list">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)
        ) : (
          companies.map((company, idx) => (
            <CompanyCard
              key={company._id || getCompanyNumber(company) || idx}
              company={company}
              onOutreach={setOutreachCompany}
              onAddToPipeline={onAddToPipeline}
              enriching={enriching}
            />
          ))
        )}
      </div>

      {/* Enriching indicator */}
      {enriching && (
        <div className="alert alert-info" style={{ marginTop: 8 }}>
          <span className="loading-spinner" style={{ width: 14, height: 14 }} />
          Enriching with AI — estimating owner details, fit scores &amp; healthcare context…
        </div>
      )}

      {/* Pagination */}
      {total > limit && !loading && (
        <div className="pagination">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            disabled={offset === 0}
          >← Prev</button>
          <span className="pagination-info">
            Page {currentPage} of {totalPages} · {total.toLocaleString()} total
          </span>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => onPageChange(offset + limit)}
            disabled={offset + limit >= total}
          >Next →</button>
        </div>
      )}

      {/* Outreach modal */}
      {outreachCompany && (
        <OutreachModal company={outreachCompany} onClose={() => setOutreachCompany(null)} />
      )}
    </>
  );
}
