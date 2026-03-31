import { useState, useMemo, useCallback } from 'react'
import { SEED_DATA, queryLaunches, getDistinctValues, getYearRange } from '../data/launchDatabase.js'
import useDebounce from '../hooks/useDebounce.js'

const PAGE_SIZE = 20

const OUTCOME_CFG = {
  success: { icon: '\u2713', label: 'Success',  cls: 'lp-outcome-success' },
  failure: { icon: '\u2717', label: 'Failure',  cls: 'lp-outcome-failure' },
  partial: { icon: '\u26A0', label: 'Partial',  cls: 'lp-outcome-partial' },
  anomaly: { icon: '\u26A0', label: 'Anomaly',  cls: 'lp-outcome-anomaly' },
}

const OPTIONAL_COLS = [
  { key: 'launch_site',              label: 'Launch Site' },
  { key: 'payload_mass_kg',          label: 'Payload Mass' },
  { key: 'booster_landing_outcome',  label: 'Booster Landing' },
]

const ALL_PROVIDERS   = getDistinctValues(SEED_DATA, 'provider')
const ALL_ORBITS      = getDistinctValues(SEED_DATA, 'orbit_type')
const ALL_SITES       = getDistinctValues(SEED_DATA, 'launch_site')
const YEAR_RANGE      = getYearRange(SEED_DATA)
const OUTCOME_KEYS    = ['success', 'failure', 'partial', 'anomaly']

function fmtDate(iso) {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtMass(kg) {
  if (kg == null) return '\u2014'
  return kg >= 1000 ? `${(kg / 1000).toFixed(1)}t` : `${kg} kg`
}

function OutcomeBadge({ outcome }) {
  const c = OUTCOME_CFG[outcome] || OUTCOME_CFG.success
  return (
    <span className={`lp-outcome ${c.cls}`}>
      <span className="lp-outcome-icon" aria-hidden="true">{c.icon}</span>
      {c.label}
    </span>
  )
}

// ── Filter panel content (shared between sidebar & bottom sheet) ──────

function FilterControls({ filters, yearMin, yearMax }) {
  const { providers, outcomes, orbit_type, launch_site, year_min, year_max,
    toggleProvider, toggleOutcome, setOrbitType, setLaunchSite, setYearRange, clearAll, hasActiveFilters } = filters

  return (
    <>
      <div className="lp-filter-title">
        Filters
        {hasActiveFilters && <button className="lp-filter-clear-btn" onClick={clearAll}>Clear all</button>}
      </div>

      <div className="lp-filter-section">
        <div className="lp-filter-section-label">Provider</div>
        <div className="lp-filter-checks">
          {ALL_PROVIDERS.map(p => (
            <div key={p} className={`lp-filter-check${providers.includes(p) ? ' on' : ''}`}
              role="checkbox" aria-checked={providers.includes(p)} tabIndex={0}
              onClick={() => toggleProvider(p)}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleProvider(p) } }}>
              <span className="lp-filter-check-box" aria-hidden="true" />{p}
            </div>
          ))}
        </div>
      </div>

      <div className="lp-filter-section">
        <div className="lp-filter-section-label">Outcome</div>
        <div className="lp-filter-checks">
          {OUTCOME_KEYS.map(o => (
            <div key={o} className={`lp-filter-check${outcomes.includes(o) ? ' on' : ''}`}
              role="checkbox" aria-checked={outcomes.includes(o)} tabIndex={0}
              onClick={() => toggleOutcome(o)}
              onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); toggleOutcome(o) } }}>
              <span className="lp-filter-check-box" aria-hidden="true" />
              <OutcomeBadge outcome={o} />
            </div>
          ))}
        </div>
      </div>

      <div className="lp-filter-section">
        <div className="lp-filter-section-label">Year Range</div>
        <div className="lp-filter-year-row">
          <input type="number" className="lp-filter-year-input"
            placeholder={String(yearMin)} min={yearMin} max={yearMax}
            value={year_min ?? ''} onChange={e => {
              const v = e.target.value ? Number(e.target.value) : null
              setYearRange(v, year_max)
            }} />
          <span className="lp-filter-year-sep">{'\u2013'}</span>
          <input type="number" className="lp-filter-year-input"
            placeholder={String(yearMax)} min={yearMin} max={yearMax}
            value={year_max ?? ''} onChange={e => {
              const v = e.target.value ? Number(e.target.value) : null
              setYearRange(year_min, v)
            }} />
        </div>
      </div>

      <div className="lp-filter-section">
        <div className="lp-filter-section-label">Orbit Type</div>
        <select className="lp-filter-select" value={orbit_type}
          onChange={e => setOrbitType(e.target.value)}>
          <option value="">All orbits</option>
          {ALL_ORBITS.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>

      <div className="lp-filter-section">
        <div className="lp-filter-section-label">Launch Site</div>
        <select className="lp-filter-select" value={launch_site}
          onChange={e => setLaunchSite(e.target.value)}>
          <option value="">All sites</option>
          {ALL_SITES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
    </>
  )
}


// ── Main component ────────────────────────────────────────────────────────

export default function LaunchesPage({ open, filters }) {
  const pageIdx = filters.page || 0
  const setPageIdx = filters.setPage
  const [expandedId, setExpandedId] = useState(null)
  const [density, setDensity] = useState('comfortable')
  const [visibleOptCols, setVisibleOptCols] = useState(new Set())
  const [colPickerOpen, setColPickerOpen] = useState(false)
  const [filterSidebarOpen, setFilterSidebarOpen] = useState(false)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const [loadedExtra, setLoadedExtra] = useState(0) // "Load More" extra rows

  const debouncedSearch = useDebounce(filters.search, 300)

  // Query with all filters
  const allSorted = useMemo(() => {
    const { data } = queryLaunches(SEED_DATA, {
      search: debouncedSearch || undefined,
      provider: filters.providers.length ? filters.providers : undefined,
      outcome: filters.outcomes.length ? filters.outcomes : undefined,
      orbit_type: filters.orbit_type || undefined,
      launch_site: filters.launch_site || undefined,
      year_min: filters.year_min,
      year_max: filters.year_max,
      sort_by: filters.sort_by,
      sort_dir: filters.sort_dir,
      limit: 9999,
    })
    return data
  }, [debouncedSearch, filters.providers, filters.outcomes, filters.orbit_type,
      filters.launch_site, filters.year_min, filters.year_max, filters.sort_by, filters.sort_dir])

  // Reset extra loaded rows when page or filters change
  useEffect(() => setLoadedExtra(0), [pageIdx, allSorted])

  const totalPages = Math.max(1, Math.ceil(allSorted.length / PAGE_SIZE))
  const pageEnd = (pageIdx + 1) * PAGE_SIZE + loadedExtra
  const page = useMemo(() => allSorted.slice(pageIdx * PAGE_SIZE, pageEnd), [allSorted, pageIdx, pageEnd])
  const hasMoreOnPage = pageEnd < Math.min((pageIdx + 1) * PAGE_SIZE + allSorted.length, allSorted.length)

  const handleSort = useCallback((col) => {
    const newDir = filters.sort_by === col && filters.sort_dir === 'desc' ? 'asc' : 'desc'
    filters.setSort(col, newDir)
  }, [filters])

  const toggleCol = useCallback((key) => {
    setVisibleOptCols(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n })
  }, [])

  const toggleExpand = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id)
  }, [])

  const openLaunchPanel = useCallback((launch) => {
    window.__infinita_viewIn3D // Only if the bridge exists, use push panel
      ? window.__infinita_openPanel?.({ type: 'launch', data: launch, title: launch.mission_name })
      : setExpandedId(launch.id)
  }, [])

  const sortArrow = (col) => {
    if (filters.sort_by !== col) return null
    return <span className="lp-sort-arrow">{filters.sort_dir === 'desc' ? '\u25BC' : '\u25B2'}</span>
  }

  const thClass = (col) => `lp-col-${col}` + (filters.sort_by === col ? ' sorted' : '')
  const showSite = visibleOptCols.has('launch_site')
  const showMass = visibleOptCols.has('payload_mass_kg')
  const showLanding = visibleOptCols.has('booster_landing_outcome')
  const colSpan = 6 + (showSite ? 1 : 0) + (showMass ? 1 : 0) + (showLanding ? 1 : 0)

  const { activeFiltersList, removeFilter, clearAll, hasActiveFilters } = filters

  return (
    <div className={`launches-page${open ? ' open' : ''}`}>

      {/* ── Header / Toolbar ── */}
      <div className="lp-header">
        <div className="lp-title">Launches</div>
        <div className="lp-toolbar">
          {/* Mobile filter toggle */}
          <button className="lp-tool-btn lp-filter-toggle" onClick={() => setFilterSheetOpen(v => !v)}>
            <svg viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            Filter{hasActiveFilters ? ` \u00B7` : ''}
          </button>
          {/* Desktop filter toggle */}
          <button className="lp-tool-btn" style={{ display: 'none' }}
            ref={el => { if (el) el.style.display = window.innerWidth > 768 ? 'flex' : 'none' }}
            onClick={() => setFilterSidebarOpen(v => !v)}>
            <svg viewBox="0 0 24 24"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
            {filterSidebarOpen ? 'Hide Filters' : 'Filters'}
          </button>

          <div className="lp-density-group" role="radiogroup" aria-label="Row density">
            {['compact','comfortable','spacious'].map(d => (
              <button key={d} className={`lp-density-btn${density === d ? ' active' : ''}`}
                onClick={() => setDensity(d)} aria-label={d} title={d}>
                <svg viewBox="0 0 14 14">
                  {d === 'compact'     && <><line x1="1" y1="3" x2="13" y2="3"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="1" y1="11" x2="13" y2="11"/></>}
                  {d === 'comfortable' && <><line x1="1" y1="2.5" x2="13" y2="2.5"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="1" y1="11.5" x2="13" y2="11.5"/></>}
                  {d === 'spacious'    && <><line x1="1" y1="2" x2="13" y2="2"/><line x1="1" y1="7" x2="13" y2="7"/><line x1="1" y1="12" x2="13" y2="12"/></>}
                </svg>
              </button>
            ))}
          </div>

          <button className="lp-tool-btn" onClick={() => setColPickerOpen(v => !v)}>
            <svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
            Columns
            {colPickerOpen && (
              <div className="lp-col-dropdown" onClick={e => e.stopPropagation()}>
                {OPTIONAL_COLS.map(c => (
                  <div key={c.key} className={`lp-col-option${visibleOptCols.has(c.key) ? ' checked' : ''}`}
                    onClick={() => toggleCol(c.key)}>
                    <span className="lp-col-check" />{c.label}
                  </div>
                ))}
              </div>
            )}
          </button>
        </div>
      </div>

      {/* ── Active filter chips ── */}
      {activeFiltersList.length > 0 && (
        <div className="lp-chips-bar">
          {activeFiltersList.map(f => (
            <span key={f.key} className="lp-chip">
              <span className="lp-chip-type">{f.type}</span>
              {f.label}
              <button className="lp-chip-x" onClick={() => removeFilter(f.key)} aria-label={`Remove ${f.label}`}>{'\u00D7'}</button>
            </span>
          ))}
          <button className="lp-chips-clear" onClick={clearAll}>Clear all</button>
        </div>
      )}

      {/* ── Body: sidebar + content ── */}
      <div className={`lp-body lp-density-${density} lp-with-sidebar`}>

        {/* Desktop filter sidebar */}
        <div className={`lp-filter-sidebar${filterSidebarOpen ? ' open' : ''}`}>
          <div className="lp-filter-sidebar-inner">
            <FilterControls filters={filters} yearMin={YEAR_RANGE.min} yearMax={YEAR_RANGE.max} />
          </div>
        </div>

        {/* Screen reader results announcement */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {allSorted.length} launch{allSorted.length !== 1 ? 'es' : ''} found
        </div>

        {/* Table / Cards / No results */}
        {allSorted.length === 0 ? (
          <div className="lp-no-results">
            <div className="lp-no-results-icon">{'\uD83D\uDD2D'}</div>
            <div className="lp-no-results-text">No launches match your filters</div>
            {hasActiveFilters && <button className="lp-no-results-btn" onClick={clearAll}>Clear all filters</button>}
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="lp-table-wrap">
              <table className="lp-table" role="table">
                <thead>
                  <tr>
                    <th scope="col" className={thClass('date')} onClick={() => handleSort('date')}>Date{sortArrow('date')}</th>
                    <th scope="col" className={thClass('mission')} onClick={() => handleSort('name')}>Mission{sortArrow('name')}</th>
                    <th scope="col" className="lp-col-rocket">Rocket</th>
                    <th scope="col" className={thClass('provider')} onClick={() => handleSort('provider')}>Provider{sortArrow('provider')}</th>
                    <th scope="col" className="lp-col-outcome">Outcome</th>
                    <th scope="col" className="lp-col-orbit">Orbit</th>
                    {showSite    && <th scope="col" className="lp-col-site">Launch Site</th>}
                    {showMass    && <th scope="col" className="lp-col-mass">Mass</th>}
                    {showLanding && <th scope="col" className="lp-col-landing">Landing</th>}
                  </tr>
                </thead>
                {page.map(r => (
                  <tbody key={r.id}>
                    <tr className={expandedId === r.id ? 'expanded' : ''}
                      onClick={() => toggleExpand(r.id)} aria-expanded={expandedId === r.id}>
                      <td className="lp-col-date"><span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{fmtDate(r.launch_date)}</span></td>
                      <td className="lp-col-mission"><span className="lp-mission-name">{r.mission_name}</span></td>
                      <td className="lp-col-rocket">{r.rocket_name}{r.rocket_variant !== r.rocket_name ? ` ${r.rocket_variant}` : ''}</td>
                      <td className="lp-col-provider">{r.provider}</td>
                      <td className="lp-col-outcome"><OutcomeBadge outcome={r.outcome} /></td>
                      <td className="lp-col-orbit" style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)' }}>{r.orbit_type}</td>
                      {showSite    && <td className="lp-col-site" title={r.launch_site}>{r.launch_site}</td>}
                      {showMass    && <td className="lp-col-mass">{fmtMass(r.payload_mass_kg)}</td>}
                      {showLanding && <td className="lp-col-landing">{r.booster_landing_outcome || '\u2014'}</td>}
                    </tr>
                    {expandedId === r.id && (
                      <tr className="lp-detail-row">
                        <td colSpan={colSpan}>
                          <div className="lp-detail">
                            <div className="lp-detail-main">
                              <div className="lp-detail-desc">{r.mission_description}</div>
                              <div className="lp-detail-meta">
                                <div className="lp-detail-meta-item"><span className="lp-detail-meta-label">Launch Site</span><span className="lp-detail-meta-value">{r.launch_site}</span></div>
                                <div className="lp-detail-meta-item"><span className="lp-detail-meta-label">Payload Type</span><span className="lp-detail-meta-value">{r.payload_type}</span></div>
                                <div className="lp-detail-meta-item"><span className="lp-detail-meta-label">Payload Mass</span><span className="lp-detail-meta-value">{fmtMass(r.payload_mass_kg)}</span></div>
                                <div className="lp-detail-meta-item"><span className="lp-detail-meta-label">Booster Landing</span><span className="lp-detail-meta-value">{r.booster_landing_outcome || 'N/A'}</span></div>
                              </div>
                              {r.firsts.length > 0 && (
                                <div className="lp-detail-firsts">
                                  {r.firsts.map((f, i) => <div key={i} className="lp-detail-first">{'\u2605'} {f}</div>)}
                                </div>
                              )}
                              <button className="lp-view3d-btn" onClick={(e) => { e.stopPropagation(); window.__infinita_viewIn3D?.(r) }}
                                aria-label={`View ${r.mission_name} launch site in 3D`}>
                                {'\uD83C\uDF0D'} View in 3D
                              </button>
                            </div>
                            <div className="lp-detail-patch" aria-label="Mission patch placeholder">
                              {r.mission_patch_url
                                ? <img src={r.mission_patch_url} alt={`${r.mission_name} patch`} style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 'var(--radius-lg)' }} />
                                : r.rocket_name.charAt(0)}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                ))}
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lp-cards">
              {page.map(r => (
                <div key={r.id} className={`lp-card${expandedId === r.id ? ' expanded' : ''}`}
                  onClick={() => toggleExpand(r.id)} role="button" tabIndex={0} aria-expanded={expandedId === r.id}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleExpand(r.id) } }}>
                  <div className="lp-card-top">
                    <div className="lp-card-name">{r.mission_name}</div>
                    <div className="lp-card-date">{fmtDate(r.launch_date)}</div>
                  </div>
                  <div className="lp-card-sub">
                    <span>{r.rocket_name}</span>
                    <span>{'\u00B7'}</span>
                    <span>{r.provider}</span>
                    <span style={{ marginLeft: 'auto' }}><OutcomeBadge outcome={r.outcome} /></span>
                  </div>
                  <div className="lp-card-detail">
                    <div className="lp-card-desc">{r.mission_description}</div>
                    <div className="lp-card-meta">
                      <div><div className="lp-card-meta-label">Orbit</div><div className="lp-card-meta-value">{r.orbit_type}</div></div>
                      <div><div className="lp-card-meta-label">Payload</div><div className="lp-card-meta-value">{fmtMass(r.payload_mass_kg)}</div></div>
                      <div><div className="lp-card-meta-label">Site</div><div className="lp-card-meta-value">{r.launch_site}</div></div>
                      <div><div className="lp-card-meta-label">Landing</div><div className="lp-card-meta-value">{r.booster_landing_outcome || 'N/A'}</div></div>
                    </div>
                    {r.firsts.length > 0 && (
                      <div className="lp-detail-firsts" style={{ marginTop: 'var(--space-2)' }}>
                        {r.firsts.map((f, i) => <div key={i} className="lp-detail-first">{'\u2605'} {f}</div>)}
                      </div>
                    )}
                    <button className="lp-view3d-btn" onClick={(e) => { e.stopPropagation(); window.__infinita_viewIn3D?.(r) }}
                      aria-label={`View ${r.mission_name} launch site in 3D`}>
                      {'\uD83C\uDF0D'} View in 3D
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Load More within current page */}
        {hasMoreOnPage && allSorted.length > PAGE_SIZE && (
          <div style={{ padding: 'var(--space-3)', textAlign: 'center' }}>
            <button className="lp-load-more-btn"
              onClick={() => setLoadedExtra(prev => prev + PAGE_SIZE)}>
              Load {Math.min(PAGE_SIZE, allSorted.length - pageEnd)} more
            </button>
          </div>
        )}
      </div>

      {/* ── Mobile filter bottom sheet ── */}
      <div className={`lp-filter-scrim${filterSheetOpen ? ' open' : ''}`} onClick={() => setFilterSheetOpen(false)} />
      <div className={`lp-filter-sheet${filterSheetOpen ? ' open' : ''}`}
        onTouchStart={e => { e.currentTarget._touchY = e.touches[0].clientY }}
        onTouchMove={e => {
          const dy = e.touches[0].clientY - (e.currentTarget._touchY || 0)
          if (dy > 0) e.currentTarget.style.transform = `translateY(${dy}px)`
        }}
        onTouchEnd={e => {
          const dy = e.changedTouches[0].clientY - (e.currentTarget._touchY || 0)
          if (dy > 80) setFilterSheetOpen(false)
          e.currentTarget.style.transform = filterSheetOpen ? 'translateY(0)' : ''
        }}>
        <div className="lp-filter-sheet-handle" />
        <FilterControls filters={filters} yearMin={YEAR_RANGE.min} yearMax={YEAR_RANGE.max} />
      </div>

      {/* ── Pagination ── */}
      <div className="lp-pagination">
        <button className="lp-page-btn" disabled={pageIdx === 0}
          onClick={() => { setPageIdx(p => p - 1); setExpandedId(null) }} aria-label="Previous page">
          <svg viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
        </button>
        <div className="lp-page-info">
          Page <strong>{pageIdx + 1}</strong> of <strong>{totalPages}</strong>
          {' \u2014 '}
          <strong>{allSorted.length}</strong> launch{allSorted.length !== 1 ? 'es' : ''}
        </div>
        <button className="lp-page-btn" disabled={pageIdx >= totalPages - 1}
          onClick={() => { setPageIdx(p => p + 1); setExpandedId(null) }} aria-label="Next page">
          <svg viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>
    </div>
  )
}
