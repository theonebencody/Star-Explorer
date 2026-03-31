import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { SEED_DATA, getDistinctValues } from '../data/launchDatabase.js'

// ── Provider color palette (deterministic from design tokens) ──
const PROVIDER_COLORS = {
  SpaceX: '#4fc3f7', NASA: '#b388ff', ULA: '#7dcfff', ESA: '#bb9af7',
  CNSA: '#ff9e64', ISRO: '#e0af68', JAXA: '#7aa2f7', Roscosmos: '#f87171',
  'Rocket Lab': '#4ade80', 'Blue Origin': '#38bdf8', Firefly: '#fbbf24',
  Astra: '#f472b6', Relativity: '#a78bfa',
}
function provColor(p) { return PROVIDER_COLORS[p] || '#9e9e9e' }

// ── Simplified world map paths (Natural Earth inspired, equirectangular) ──
const MAP_PATHS = [
  // North America
  'M38,22 L42,18 L52,16 L58,14 L68,14 L76,16 L82,18 L88,22 L90,26 L88,30 L84,34 L80,36 L74,38 L68,40 L62,42 L56,40 L50,38 L46,36 L42,32 L38,28 Z',
  // Central America
  'M56,40 L60,42 L62,44 L58,46 L54,44 Z',
  // South America
  'M62,46 L68,44 L74,46 L78,50 L80,56 L78,62 L74,68 L70,72 L66,70 L62,64 L60,58 L58,52 L60,48 Z',
  // Europe
  'M108,18 L112,16 L118,14 L126,14 L132,16 L136,18 L134,22 L130,26 L124,28 L118,26 L112,24 L108,22 Z',
  // Africa
  'M110,32 L118,30 L126,30 L134,32 L138,36 L140,42 L138,50 L134,56 L128,60 L122,62 L116,58 L112,52 L110,46 L108,40 L110,36 Z',
  // Asia
  'M132,12 L140,10 L152,10 L164,12 L174,14 L182,16 L188,20 L186,26 L180,30 L174,32 L166,34 L158,36 L150,34 L142,32 L136,28 L132,24 L130,18 Z',
  // India
  'M150,34 L154,36 L156,40 L154,46 L150,44 L148,40 L148,36 Z',
  // Southeast Asia
  'M164,34 L170,36 L172,40 L168,42 L164,38 Z',
  // Japan
  'M180,18 L182,16 L184,18 L182,22 L180,20 Z',
  // Australia
  'M168,54 L176,50 L184,52 L188,56 L186,62 L180,66 L174,64 L170,60 L168,56 Z',
  // Greenland
  'M72,8 L80,6 L86,8 L84,12 L78,14 L72,12 Z',
]

// ── Lat/lon to map x,y (equirectangular) ──
function geoToXY(lat, lon, w, h) {
  return { x: ((lon + 180) / 360) * w, y: ((90 - lat) / 180) * h }
}

// ── Tooltip component ──
function Tooltip({ tip }) {
  if (!tip) return null
  return (
    <div className="stats-tooltip" style={{ left: tip.x, top: tip.y }}>
      <div className="stats-tooltip-title">{tip.title}</div>
      <div className="stats-tooltip-value">{tip.value}</div>
    </div>
  )
}

// ── Scroll-into-view animation hook ──
function useScrollReveal() {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) { el.classList.add('visible'); obs.disconnect() }
    }, { threshold: 0.15 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return ref
}


export default function StatsPage({ open, onFilterYear, onFilterSite }) {
  const [tip, setTip] = useState(null)

  const ref1 = useScrollReveal()
  const ref2 = useScrollReveal()
  const ref3 = useScrollReveal()
  const ref4 = useScrollReveal()

  // ── 1. Launch frequency by year, stacked by provider ──
  const { yearData, allYears, allProviders, maxPerYear } = useMemo(() => {
    const provs = getDistinctValues(SEED_DATA, 'provider')
    const byYear = {}
    SEED_DATA.forEach(r => {
      const y = r.launch_date.slice(0, 4)
      if (!byYear[y]) byYear[y] = {}
      byYear[y][r.provider] = (byYear[y][r.provider] || 0) + 1
    })
    const years = Object.keys(byYear).sort()
    let max = 0
    years.forEach(y => { const t = Object.values(byYear[y]).reduce((a, b) => a + b, 0); if (t > max) max = t })
    return { yearData: byYear, allYears: years, allProviders: provs, maxPerYear: max }
  }, [])

  // ── 2. Success rate over time ──
  const successData = useMemo(() => {
    const sorted = [...SEED_DATA].sort((a, b) => a.launch_date.localeCompare(b.launch_date))
    const points = []
    const window = 10
    for (let i = window - 1; i < sorted.length; i++) {
      const slice = sorted.slice(i - window + 1, i + 1)
      const succ = slice.filter(r => r.outcome === 'success').length
      const rate = Math.round((succ / window) * 100)
      points.push({ date: sorted[i].launch_date, year: sorted[i].launch_date.slice(0, 4), rate, name: sorted[i].mission_name, outcome: sorted[i].outcome })
    }
    return points
  }, [])

  const failureAnnotations = useMemo(() =>
    successData.filter(p => p.outcome === 'failure').map(p => ({ ...p, label: p.name })),
  [successData])

  // ── 3. Launch sites ──
  const siteData = useMemo(() => {
    const sites = {}
    SEED_DATA.forEach(r => {
      const key = r.launch_site
      if (!sites[key]) sites[key] = { name: key, lat: r.launch_site_lat, lon: r.launch_site_lon, count: 0 }
      sites[key].count++
    })
    return Object.values(sites).sort((a, b) => b.count - a.count)
  }, [])
  const maxSiteCount = Math.max(...siteData.map(s => s.count), 1)

  // ── 4. Rocket comparison ──
  // Reference specs for top rockets (height in meters, payload to LEO in kg)
  const ROCKET_SPECS = {
    'Falcon 9':       { height: 70, payload: 22800 },
    'Electron':       { height: 18, payload: 300 },
    'Starship':       { height: 121, payload: 150000 },
    'Chang Zheng 5':  { height: 57, payload: 25000 },
    'Soyuz':          { height: 46, payload: 7020 },
    'Falcon Heavy':   { height: 70, payload: 63800 },
    'Atlas V':        { height: 58, payload: 18850 },
    'Ariane 5':       { height: 52, payload: 21000 },
    'Ariane 6':       { height: 56, payload: 21650 },
    'SLS':            { height: 98, payload: 95000 },
    'New Glenn':      { height: 98, payload: 45000 },
    'Vega':           { height: 30, payload: 1500 },
    'H3':             { height: 57, payload: 6500 },
    'PSLV':           { height: 44, payload: 3800 },
    'LVM3':           { height: 43, payload: 8000 },
  }

  const rocketData = useMemo(() => {
    const rockets = {}
    SEED_DATA.forEach(r => {
      if (!rockets[r.rocket_name]) rockets[r.rocket_name] = { name: r.rocket_name, launches: 0, successes: 0, lastYear: 0 }
      rockets[r.rocket_name].launches++
      if (r.outcome === 'success') rockets[r.rocket_name].successes++
      const y = parseInt(r.launch_date.slice(0, 4))
      if (y > rockets[r.rocket_name].lastYear) rockets[r.rocket_name].lastYear = y
    })
    return Object.values(rockets).sort((a, b) => b.launches - a.launches).slice(0, 5).map(r => ({
      ...r, ...(ROCKET_SPECS[r.name] || { height: null, payload: null })
    }))
  }, [])
  const maxRocketLaunches = Math.max(...rocketData.map(r => r.launches), 1)

  const showTip = useCallback((e, title, value) => {
    setTip({ x: e.clientX, y: e.clientY, title, value })
  }, [])

  const hideTip = useCallback(() => setTip(null), [])

  // ── Bar chart dims ──
  const barW = 700, barH = 200, barPad = 40
  const barGap = 4
  const bw = Math.max(8, (barW - barPad * 2) / allYears.length - barGap)

  // ── Line chart dims ──
  const lineW = 700, lineH = 200, linePad = 40

  // ── Map dims ──
  const mapW = 200, mapH = 100

  return (
    <div className={`stats-page${open ? ' open' : ''}`}>
      <div className="stats-header">
        <div className="stats-title">Statistics</div>
      </div>

      <div className="stats-body">

        {/* ── 1. Launch Frequency ── */}
        <section ref={ref1} className="stats-section" aria-label="Launch frequency by year">
          <div className="stats-section-title">Launch Frequency</div>
          <div className="stats-section-sub">Launches per year, colored by provider</div>
          <div className="sr-only">{allYears.map(y => {
            const total = Object.values(yearData[y]).reduce((a, b) => a + b, 0)
            return `${y}: ${total} launches. `
          }).join('')}</div>
          <div className="stats-bar-chart">
            <svg viewBox={`0 0 ${barW} ${barH + 30}`} role="img" aria-label="Bar chart of launches per year">
              {allYears.map((y, i) => {
                const x = barPad + i * (bw + barGap)
                let cumH = 0
                const total = Object.values(yearData[y]).reduce((a, b) => a + b, 0)
                const segments = allProviders.filter(p => yearData[y]?.[p]).map(p => {
                  const count = yearData[y][p]
                  const h = (count / maxPerYear) * (barH - 20)
                  const seg = { p, count, h, yOff: cumH }
                  cumH += h
                  return seg
                })
                return (
                  <g key={y} className="stats-bar" tabIndex={0} role="button" aria-label={`${y}: ${total} launches`}
                    onClick={() => onFilterYear?.(y)}
                    onMouseMove={e => showTip(e, y, `${total} launches`)} onMouseLeave={hideTip}
                    onTouchStart={e => showTip(e.touches[0], y, `${total} launches`)} onTouchEnd={hideTip}>
                    {segments.map((s, j) => (
                      <rect key={j} x={x} y={barH - s.yOff - s.h} width={bw} height={Math.max(1, s.h)}
                        rx={1} fill={provColor(s.p)} />
                    ))}
                    <text className="stats-bar-label" x={x + bw / 2} y={barH + 14} textAnchor="middle">{y.slice(2)}</text>
                    <text className="stats-bar-value" x={x + bw / 2} y={barH - cumH - 4} textAnchor="middle">{total}</text>
                  </g>
                )
              })}
              {/* Y axis */}
              <line x1={barPad - 4} y1={0} x2={barPad - 4} y2={barH} stroke="var(--color-border-muted)" />
              {[0, 0.25, 0.5, 0.75, 1].map(f => (
                <text key={f} className="stats-axis-label" x={barPad - 8} y={barH - f * (barH - 20)} textAnchor="end" dominantBaseline="middle">
                  {Math.round(f * maxPerYear)}
                </text>
              ))}
            </svg>
          </div>
          {/* Provider legend */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: '12px' }}>
            {allProviders.filter(p => SEED_DATA.some(r => r.provider === p)).map(p => (
              <span key={p} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: provColor(p), display: 'inline-block' }} />{p}
              </span>
            ))}
          </div>
        </section>

        {/* ── 2. Success Rate Over Time ── */}
        <section ref={ref2} className="stats-section" aria-label="Success rate over time">
          <div className="stats-section-title">Success Rate</div>
          <div className="stats-section-sub">Rolling {10}-launch success rate</div>
          <div className="sr-only">Success rate ranges from {Math.min(...successData.map(p => p.rate))}% to {Math.max(...successData.map(p => p.rate))}%.</div>
          <div className="stats-line-chart">
            <svg viewBox={`0 0 ${lineW} ${lineH + 30}`} role="img" aria-label="Line chart of launch success rate">
              {/* Grid lines */}
              {[0, 25, 50, 75, 100].map(v => {
                const y = linePad + (1 - v / 100) * (lineH - linePad * 2)
                return <g key={v}>
                  <line className="stats-line-grid" x1={linePad} y1={y} x2={lineW - 10} y2={y} />
                  <text className="stats-axis-label" x={linePad - 6} y={y} textAnchor="end" dominantBaseline="middle">{v}%</text>
                </g>
              })}
              {/* Line + area */}
              {(() => {
                const pts = successData.map((p, i) => {
                  const x = linePad + (i / (successData.length - 1)) * (lineW - linePad - 10)
                  const y = linePad + (1 - p.rate / 100) * (lineH - linePad * 2)
                  return { x, y, ...p }
                })
                const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')
                const areaPath = linePath + ` L${pts[pts.length - 1].x},${lineH - linePad} L${pts[0].x},${lineH - linePad} Z`
                return <>
                  <path className="stats-line-area" d={areaPath} fill="var(--color-success)" />
                  <path className="stats-line-path" d={linePath} stroke="var(--color-success)" />
                  {pts.map((p, i) => (
                    <circle key={i} className="stats-line-dot" cx={p.x} cy={p.y} r={3}
                      fill={p.outcome === 'failure' ? 'var(--color-failure)' : 'var(--color-success)'}
                      stroke="var(--color-bg-base)" strokeWidth={1.5}
                      onMouseMove={e => showTip(e, p.name, `${p.rate}% (${p.year})`)} onMouseLeave={hideTip}
                      onTouchStart={e => showTip(e.touches[0], p.name, `${p.rate}% (${p.year})`)} onTouchEnd={hideTip}>
                      <title>{p.name}: {p.rate}% success rate</title>
                    </circle>
                  ))}
                  {/* Failure annotations */}
                  {failureAnnotations.map((a, i) => {
                    const pt = pts.find(p => p.date === a.date)
                    if (!pt) return null
                    return <g key={i}>
                      <line x1={pt.x} y1={pt.y - 8} x2={pt.x} y2={pt.y - 20} stroke="var(--color-failure)" strokeWidth={1} opacity={0.5} />
                      <text className="stats-line-annotation" x={pt.x} y={pt.y - 22}>{a.label.length > 15 ? a.label.slice(0, 15) + '...' : a.label}</text>
                    </g>
                  })}
                </>
              })()}
            </svg>
          </div>
        </section>

        {/* ── 3. Launch Site Map ── */}
        <section ref={ref3} className="stats-section" aria-label="Launch sites world map">
          <div className="stats-section-title">Launch Sites</div>
          <div className="stats-section-sub">Click a site to filter launches</div>
          <div className="sr-only">{siteData.map(s => `${s.name}: ${s.count} launches. `).join('')}</div>
          <div className="stats-map">
            <svg viewBox={`0 0 ${mapW} ${mapH}`} role="img" aria-label="World map with launch site markers">
              {/* Background */}
              <rect width={mapW} height={mapH} fill="var(--color-bg-deep)" rx={8} />
              {/* Simplified landmasses */}
              {MAP_PATHS.map((d, i) => <path key={i} className="stats-map-land" d={d} />)}
              {/* Grid lines */}
              {[0, 30, 60, 90, 120, 150].map(lon => {
                const x = ((lon + 180) / 360) * mapW
                return <line key={`lon${lon}`} x1={x} y1={0} x2={x} y2={mapH} stroke="rgba(79,195,247,0.04)" />
              })}
              {[0, 30, 60, -30, -60].map(lat => {
                const y = ((90 - lat) / 180) * mapH
                return <line key={`lat${lat}`} x1={0} y1={y} x2={mapW} y2={y} stroke="rgba(79,195,247,0.04)" />
              })}
              {/* Site markers */}
              {siteData.map(s => {
                const { x, y } = geoToXY(s.lat, s.lon, mapW, mapH)
                const r = 1.5 + (s.count / maxSiteCount) * 4
                return (
                  <g key={s.name} className="stats-map-marker" tabIndex={0} role="button"
                    aria-label={`${s.name}: ${s.count} launches`}
                    onClick={() => onFilterSite?.(s.name)}
                    onMouseMove={e => showTip(e, s.name, `${s.count} launches`)} onMouseLeave={hideTip}
                    onTouchStart={e => showTip(e.touches[0], s.name, `${s.count} launches`)} onTouchEnd={hideTip}>
                    <circle cx={x} cy={y} r={r} fill="var(--color-accent-primary)" opacity={0.15} />
                    <circle cx={x} cy={y} r={r * 0.5} fill="var(--color-accent-primary)" opacity={0.6} />
                    <circle cx={x} cy={y} r={0.8} fill="var(--color-accent-primary)" />
                  </g>
                )
              })}
            </svg>
          </div>
        </section>

        {/* ── 4. Rocket Comparison ── */}
        <section ref={ref4} className="stats-section" aria-label="Top rockets comparison">
          <div className="stats-section-title">Top Rockets</div>
          <div className="stats-section-sub">Most-launched vehicles in the database</div>
          <div className="sr-only">{rocketData.map(r => `${r.name}: ${r.launches} launches, ${Math.round(r.successes / r.launches * 100)}% success rate. `).join('')}</div>
          <div className="stats-rockets">
            {rocketData.map(r => {
              const rate = Math.round((r.successes / r.launches) * 100)
              const maxH = Math.max(...rocketData.map(x => x.height || 0), 1)
              const barH = r.height ? (r.height / maxH) * 100 : (r.launches / maxRocketLaunches) * 100
              const active = r.lastYear >= 2024
              return (
                <div key={r.name} className="stats-rocket-card">
                  <div className="stats-rocket-bar-wrap">
                    <div className="stats-rocket-bar" style={{ height: `${barH}%` }} />
                  </div>
                  <div className="stats-rocket-name">{r.name}</div>
                  <div className="stats-rocket-stat"><span>Launches</span><span className="stats-rocket-stat-val">{r.launches}</span></div>
                  <div className="stats-rocket-stat"><span>Success</span><span className="stats-rocket-stat-val">{rate}%</span></div>
                  {r.height && <div className="stats-rocket-stat"><span>Height</span><span className="stats-rocket-stat-val">{r.height}m</span></div>}
                  {r.payload && <div className="stats-rocket-stat"><span>Payload</span><span className="stats-rocket-stat-val">{r.payload >= 1000 ? `${(r.payload/1000).toFixed(0)}t` : `${r.payload}kg`}</span></div>}
                  <span className={`stats-rocket-status ${active ? 'active' : 'retired'}`}>{active ? 'Active' : 'Retired'}</span>
                </div>
              )
            })}
          </div>
        </section>

      </div>
      <Tooltip tip={tip} />
    </div>
  )
}
