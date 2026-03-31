import { useEffect, useRef, useState, useCallback, lazy, Suspense } from 'react'
import StarFieldBg from './components/StarFieldBg.jsx'
import useTheme from './hooks/useTheme.js'
import ToastContainer from './components/Toasts.jsx'
import ScrollProgress from './components/ScrollProgress.jsx'

// Lazy-loaded page components
const HomePage = lazy(() => import('./components/HomePage.jsx'))

function App() {
  const canvasContainer = useRef(null)
  const [cmdOpen, setCmdOpen] = useState(false)
  const [activeNav, setActiveNav] = useState('explore')
  const cmdInputRef = useRef(null)
  const [cmdQuery, setCmdQuery] = useState('')
  const [panelStack, setPanelStack] = useState([])
  const currentPanel = panelStack[panelStack.length - 1] || null
  const pushPanel = useCallback((p) => setPanelStack(prev => [...prev, p]), [])
  const popPanel = useCallback(() => setPanelStack(prev => prev.slice(0, -1)), [])
  const closePanel = useCallback(() => setPanelStack([]), [])
  const [breadcrumbs, setBreadcrumbs] = useState([])
  const { theme, toggle: toggleTheme } = useTheme()
  const timelineOpenRef = useRef(false)

  useEffect(() => {
    let cleanup
    import('./scene/SceneManager.js').then(m => {
      cleanup = m.init(canvasContainer.current)
    })
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])

  // ── Timeline: open/close old Launch History overlay ──
  useEffect(() => {
    if (activeNav === 'timeline' && !timelineOpenRef.current) {
      import('./scene/launchHistory.js').then(m => { m.openLaunchHistory?.(); timelineOpenRef.current = true })
    } else if (activeNav !== 'timeline' && timelineOpenRef.current) {
      import('./scene/launchHistory.js').then(m => { m.closeLaunchHistory?.(); timelineOpenRef.current = false })
    }
  }, [activeNav])

  // ── Bridge: expose functions for SceneManager ↔ React communication ──
  useEffect(() => {
    // Global nav setter for SceneManager
    window.__infinita_setNav = (nav) => setActiveNav(nav)
    // Breadcrumb updater from SceneManager
    window.__infinita_updateBreadcrumbs = (crumbs) => setBreadcrumbs(crumbs)

    // Called from SceneManager when a launch site marker is clicked in 3D
    window.__infinita_showSiteLaunches = (siteName) => {
      pushPanel({ type: 'siteLaunches', data: { siteName, launches: [] }, title: siteName })
    }

    // Open side panel with launch details
    window.__infinita_openPanel = (panel) => pushPanel(panel)

    window.__infinita_viewIn3D = (launch) => {
      setActiveNav('explore')
      pushPanel({ type: 'launch', data: launch, title: launch.mission_name })
      setTimeout(() => {
        window.__infinita_flyToSite?.(launch.launch_site_lat, launch.launch_site_lon, launch.launch_site)
      }, 300)
    }

    // Return to timeline from 3D
    window.__infinita_returnToDb = () => {
      setActiveNav('timeline')
      closePanel()
    }
    return () => {
      delete window.__infinita_setNav
      delete window.__infinita_updateBreadcrumbs
      delete window.__infinita_showSiteLaunches
      delete window.__infinita_openPanel
      delete window.__infinita_viewIn3D
      delete window.__infinita_returnToDb
    }
  }, [pushPanel, closePanel])

  // Command palette: simple search → navigate to Timeline
  const handleCmdSearch = useCallback(() => {
    if (cmdQuery.trim()) {
      setActiveNav('timeline')
      setCmdQuery('')
      setCmdOpen(false)
    }
  }, [cmdQuery])

  // ⌘K / Ctrl+K command palette toggle
  const toggleCmd = useCallback((open) => {
    setCmdOpen(open)
    if (open) setTimeout(() => cmdInputRef.current?.focus(), 50)
    if (!open) setCmdQuery('')
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        toggleCmd(!cmdOpen)
      }
      if (e.key === 'Escape' && cmdOpen) {
        e.stopPropagation()
        toggleCmd(false)
      }
    }
    window.addEventListener('keydown', onKey)

    // Hardware back button (Android) — close overlays in order
    const onPopState = () => {
      if (cmdOpen) { toggleCmd(false); history.pushState(null, '', location.href) }
      else if (panelStack.length > 0) { popPanel(); history.pushState(null, '', location.href) }
    }
    window.addEventListener('popstate', onPopState)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('popstate', onPopState) }
  }, [cmdOpen, toggleCmd, panelStack, popPanel])

  return (
    <>
      <StarFieldBg />
      <div ref={canvasContainer} id="canvas-container" aria-label="Interactive 3D view of the solar system" role="img" />

      <div id="splash">
        <canvas id="splash-bg" className="splash-bg-canvas"></canvas>
        {/* Hidden buttons for SceneManager.js event listeners */}
        <button id="splash-explore-btn" style={{ display: 'none' }} aria-hidden="true" />
        <button id="splash-launches-btn" style={{ display: 'none' }} aria-hidden="true" />
        <div className="splash-hover-box" id="splash-hover-box"></div>
        {/* Scrollytelling homepage */}
        <Suspense fallback={null}>
        <HomePage
          onExplore={() => document.getElementById('splash-explore-btn')?.click()}
          onLaunches={() => {
            document.getElementById('splash-explore-btn')?.click()
            setActiveNav('timeline')
          }}
        />
        </Suspense>
      </div>

      <div id="hud">
        <div className="crosshair"></div>
        {/* Compass widget — shows camera orientation on mobile */}
        <div className="compass-widget" id="compass-widget" aria-hidden="true">
          <svg viewBox="0 0 40 40" width="40" height="40">
            <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(79,195,247,0.2)" strokeWidth="1"/>
            <line id="compass-needle" x1="20" y1="20" x2="20" y2="6" stroke="var(--color-accent-primary)" strokeWidth="2" strokeLinecap="round"/>
            <text x="20" y="5" textAnchor="middle" fill="var(--color-accent-primary)" fontSize="6" fontFamily="var(--font-mono)">N</text>
          </svg>
        </div>

        <div className="hud-tl">
          <div className="hud-panel">
            <div className="hud-label">Velocity</div>
            <div className="hud-value large" id="hud-speed">0 m/s</div>
            <div className="hud-small" id="hud-speed-c"></div>
          </div>
          <div className="hud-panel">
            <div className="hud-label">Distance from Sun</div>
            <div className="hud-value" id="hud-dist">0 AU</div>
            <div className="lightspeed-ref">Light travel: <span className="val" id="hud-light-time">0s</span></div>
          </div>
          <div className="nearest-body">
            <div className="hud-label">Nearest Body</div>
            <div className="nearest-name" id="hud-nearest-name">Sun</div>
            <div className="nearest-info" id="hud-nearest-info">0 AU</div>
          </div>
          <div className="hud-panel">
            <div className="hud-label">Scale Level</div>
            <div className="hud-value" id="hud-scale">Solar System</div>
            <div className="scale-bar" id="scale-bar"></div>
          </div>
          <div className="hud-panel">
            <div className="hud-label">Time Rate</div>
            <div className="hud-value" id="hud-time-rate">1 day/s</div>
            <div className="time-bar" id="time-bar"></div>
          </div>
          <div className="hud-panel">
            <div className="hud-label">Simulation Date</div>
            <div className="hud-value" id="hud-date">2026.0</div>
          </div>
        </div>

        <div className="hud-bl">
          <button className="lh-back-btn" id="hud-back-btn" style={{marginBottom:'8px',pointerEvents:'all'}}>{'\u2190'} BACK</button>
          <button className="mission-report-btn" id="mission-report-btn" style={{pointerEvents:'all'}}>{'\u2263'} ASTRO REPORT</button>
          <button className="mission-report-btn" id="sat-toggle-btn" style={{pointerEvents:'all'}}>{'\uD83D\uDEF0'} SATELLITES</button>
          <div className="hud-panel controls-help" id="controls-help">
            <span>C</span> Show all controls
          </div>
          <button className="reset-view-btn" id="reset-view-btn" aria-label="Reset view to solar system overview" style={{pointerEvents:'all'}}>{'\u2302'} Reset View</button>
        </div>

        <div className="cruise-tip" id="cruise-tip">Press R for a good time</div>

        {/* Gesture hint for first-time visitors */}
        <div className="gesture-hint" id="gesture-hint" aria-hidden="true">
          <div className="gesture-hint-item">
            <div className="gesture-hint-icon">{'\u270B'}</div>
            <div className="gesture-hint-text">Drag to look around</div>
          </div>
          <div className="gesture-hint-item">
            <div className="gesture-hint-icon">{'\uD83D\uDDB1\uFE0F'}</div>
            <div className="gesture-hint-text">Double-click a planet</div>
          </div>
        </div>

        <div className="hud-ticker" id="hud-ticker">
          <span className="hud-ticker-text" id="hud-ticker-text"></span>
        </div>

        {/* Controls overlay */}
        <div className="controls-overlay" id="controls-overlay">
          <div className="controls-card">
            <div className="controls-card-title">CONTROLS <button className="panel-close-btn" id="controls-close-btn" aria-label="Close controls">{'\u2715'}</button></div>
            <div className="controls-grid">

              <div>
                <div className="ctrl-section-title">Navigation</div>
                <div className="ctrl-row"><span className="ctrl-key">W / S</span><span className="ctrl-desc">Fly forward / back</span></div>
                <div className="ctrl-row"><span className="ctrl-key">A / D</span><span className="ctrl-desc">Strafe left / right</span></div>
                <div className="ctrl-row"><span className="ctrl-key">Space</span><span className="ctrl-desc">Fly up</span></div>
                <div className="ctrl-row"><span className="ctrl-key">Shift</span><span className="ctrl-desc">Fly down</span></div>
                <div className="ctrl-row"><span className="ctrl-key">Mouse drag</span><span className="ctrl-desc">Look around</span></div>
                <div className="ctrl-row"><span className="ctrl-key">Q / E</span><span className="ctrl-desc">Roll left / right</span></div>
                <div className="ctrl-row"><span className="ctrl-key">Scroll</span><span className="ctrl-desc">Adjust speed</span></div>
                <div className="ctrl-row"><span className="ctrl-key">G</span><span className="ctrl-desc">Jump to nearest body</span></div>
              </div>

              <div>
                <div className="ctrl-section-title">Time</div>
                <div className="ctrl-row"><span className="ctrl-key">1</span><span className="ctrl-desc">0.1 day/s</span></div>
                <div className="ctrl-row"><span className="ctrl-key">2</span><span className="ctrl-desc">1 day/s</span></div>
                <div className="ctrl-row"><span className="ctrl-key">3</span><span className="ctrl-desc">10 days/s</span></div>
                <div className="ctrl-row"><span className="ctrl-key">4</span><span className="ctrl-desc">100 days/s</span></div>
                <div className="ctrl-row"><span className="ctrl-key">5</span><span className="ctrl-desc">~3 years/s</span></div>
                <div className="ctrl-row"><span className="ctrl-key">6</span><span className="ctrl-desc">~27 years/s</span></div>
                <div className="ctrl-row"><span className="ctrl-key">P</span><span className="ctrl-desc">Pause / resume time</span></div>
              </div>

              <div>
                <div className="ctrl-section-title">View</div>
                <div className="ctrl-row"><span className="ctrl-key">Tab</span><span className="ctrl-desc">Cycle scale level</span></div>
                <div className="ctrl-row"><span className="ctrl-key">H</span><span className="ctrl-desc">Toggle HUD</span></div>
                <div className="ctrl-row"><span className="ctrl-key">C</span><span className="ctrl-desc">Show / hide controls</span></div>
                <div className="ctrl-row"><span className="ctrl-key">T</span><span className="ctrl-desc">Navigation Computer</span></div>
              </div>

              <div>
                <div className="ctrl-section-title">Database {'&'} Travel</div>
                <div className="ctrl-row"><span className="ctrl-key">F</span><span className="ctrl-desc">Quick object search</span></div>
                <div className="ctrl-row"><span className="ctrl-key">R</span><span className="ctrl-desc">Random exploration mode</span></div>
                <div className="ctrl-row"><span className="ctrl-key">T</span><span className="ctrl-desc">Navigation Computer</span></div>
                <div className="ctrl-row"><span className="ctrl-key">Enter</span><span className="ctrl-desc">Travel to result</span></div>
                <div className="ctrl-row"><span className="ctrl-key">Esc</span><span className="ctrl-desc">Close / abort travel</span></div>
                <div className="ctrl-row"><span className="ctrl-key">{'\u25C8'} Panel</span><span className="ctrl-desc">Click header to collapse</span></div>
              </div>

            </div>
            <div className="controls-footer">PRESS C OR ESC TO CLOSE</div>
          </div>
        </div>

        {/* Search overlay */}
        <div className="search-overlay">
          <div className="search-panel" id="search-panel">
            <div className="search-title">Object Database Search <button className="panel-close-btn" id="search-close-btn" aria-label="Close search">{'\u2715'}</button></div>
            <input type="text" className="search-input" id="search-input" placeholder="Search stars, exoplanets, planets..." autoComplete="off" spellCheck="false" />
            <div className="search-results" id="search-results"></div>
            <div className="search-hint">ESC / F to close {'\u00A0'}{'\u00B7'}{'\u00A0'} Enter or click to travel {'\u00A0'}{'\u00B7'}{'\u00A0'} Powered by SIMBAD (~15M objects)</div>
          </div>
        </div>
      </div>

      {/* Travel Panel */}
      <div className="travel-panel" id="travel-panel">
        <div className="travel-card">
          <div className="travel-card-title">NAVIGATION COMPUTER <button className="panel-close-btn" id="travel-close-btn" aria-label="Close navigation">{'\u2715'}</button></div>
          <div className="travel-section">
            <div className="travel-section-label">Destination</div>
            <input className="travel-dest-input" id="travel-dest-input" placeholder="Search star, planet, galaxy…" autoComplete="off" spellCheck="false" />
            <div className="travel-dest-results" id="travel-dest-results"></div>
            <div className="travel-dest-confirmed" id="travel-dest-confirmed">
              <div className="travel-dest-confirmed-name" id="travel-dest-name">{'\u2014'}</div>
              <div className="travel-dest-confirmed-info" id="travel-dest-info"></div>
            </div>
          </div>
          <div className="travel-section">
            <div className="travel-section-label">Travel Speed</div>
            <div className="travel-speeds-grid" id="travel-speeds-grid"></div>
          </div>
          <div className="travel-engage-row">
            <button className="travel-engage-btn" id="travel-engage-btn" disabled>ENGAGE</button>
            <button className="travel-engage-btn travel-instant-btn" id="travel-instant-btn" disabled>INSTANT</button>
          </div>
          <div className="travel-panel-footer">T / ESC to close {'\u00A0'}{'\u00B7'}{'\u00A0'} ESC to abort during flight</div>
        </div>
      </div>

      {/* Travel flight HUD */}
      <div className="travel-hud" id="travel-hud">
        <div className="travel-hud-dest" id="travel-hud-dest">{'\u2014'}</div>
        <div className="travel-hud-stats">
          <div className="travel-hud-stat">SPD <span id="t-spd">0</span></div>
          <div className="travel-hud-stat">DIST <span id="t-dist">{'\u2014'}</span></div>
          <div className="travel-hud-stat">ETA <span id="t-eta">{'\u2014'}</span></div>
        </div>
        <button className="travel-abort-btn" id="travel-abort-btn">ABORT</button>
      </div>

      {/* Warp effect overlay */}
      <div id="warp-overlay"></div>

      {/* Explore Mode HUD */}
      <div id="explore-hud">
        <span className="exp-icon">{'\u2B21'}</span>
        <span className="exp-label">Auto-Explore</span>
        <span className="exp-sep">{'\u00B7'}</span>
        <span id="exp-dest" className="exp-dest">{'\u2014'}</span>
        <span className="exp-sep">{'\u00B7'}</span>
        <span id="exp-status" className="exp-status">{'\u2014'}</span>
        <button className="exp-stop" id="explore-stop-btn">{'\u25A0'} STOP</button>
      </div>

      {/* Welcome Intro */}
      <div id="welcome-intro" className="welcome-overlay">
        <div className="welcome-card">
          <button className="panel-close-btn" id="welcome-close-btn" aria-label="Close welcome" style={{position:'absolute',top:'12px',right:'12px',transform:'none'}}>{'\u2715'}</button>
          <div className="welcome-icon">{'\u2B21'}</div>
          <div className="welcome-title">WELCOME, EXPLORER</div>
          <div className="welcome-text">
            You are now a pilot in an infinite universe. Fly between planets, visit distant stars,
            search 15 million real objects, and bend time itself. The cosmos is yours.
          </div>
          <div className="welcome-features">
            <div className="welcome-feat">{'\u2726'} Fly freely through the Solar System and beyond</div>
            <div className="welcome-feat">{'\u2726'} Search and travel to real stars, galaxies, and nebulae</div>
            <div className="welcome-feat">{'\u2726'} Control the flow of time from paused to 27 years per second</div>
            <div className="welcome-feat">{'\u2726'} Hit R for auto-explore and let the universe surprise you</div>
          </div>
          <div className="welcome-hint">Controls will display next...</div>
        </div>
      </div>

      {/* Astro Report Overlay */}
      <div id="mission-report" className="report-overlay">
        <div className="report-card">
          <button className="panel-close-btn" id="report-close-btn" aria-label="Close report">{'\u2715'}</button>
          <div className="report-header">
            <div className="report-icon">{'\u2263'}</div>
            <div className="report-title">ASTRO REPORT</div>
            <div className="report-target" id="report-target-name">---</div>
          </div>
          <div className="report-body" id="report-body"></div>
        </div>
      </div>

      {/* Alien flyby (intro only — no alert box) */}
      <div id="alien-flyby" className="alien-flyby">
        <div className="alien-flyby-wrapper">
          <img src="/Infinita/images/marsattacks.jpg" alt="" className="alien-flyby-img" />
          <div className="alien-yak">YAK YAK</div>
        </div>
      </div>

      {/* UFO alert removed — intro flyby kept above */}

      {/* Launch History Overlay */}
      <div id="launch-history" className="lh-overlay">
        <div className="lh-header">
          <div className="lh-header-top">
            <button className="lh-back-btn" id="lh-back-btn">{'\u2190'} BACK</button>
            <div className="lh-title">LAUNCH HISTORY</div>
            <div style={{width:'70px'}}></div>
          </div>
        </div>
        <div className="lh-scroll-body" id="lh-scroll-body">
          {/* Hero stats */}
          <div className="lh-stats-overview" id="lh-stats-overview"></div>

          {/* Timeline by Era — prominent clickable cards */}
          <div className="lh-section">
            <div className="lh-section-title">EXPLORE BY ERA</div>
            <div className="lh-timeline" id="lh-timeline"></div>
          </div>

          {/* Featured highlights — defining moments with full-width astronaut + snowfall */}
          <div className="lh-section lh-defining-section">
            <img src="/Infinita/images/astronaut.png" alt="" className="lh-defining-bg-img" />
            <div className="lh-snowfall" id="lh-snowfall"></div>
            <div className="lh-section-title">DEFINING MOMENTS</div>
            <div className="lh-defining-subtitle">The missions that changed everything</div>
            <div className="lh-highlights" id="lh-highlights"></div>
          </div>

          {/* Active Operations — the 3 planet visuals */}
          <div className="lh-section">
            <div className="lh-section-title">FLIGHT OF THE HUMANS</div>
            <div className="lh-dual-globes">
              <div className="lh-globe-wrapper">
                <div className="lh-globe-label">EARTH {'\u00B7'} LAUNCH OPS</div>
                <div className="lh-globe-container">
                  <canvas id="earth-canvas"></canvas>
                </div>
              </div>
              <div className="lh-globe-wrapper">
                <div className="lh-globe-label">MARS {'\u00B7'} EXPLORATION</div>
                <div className="lh-globe-container">
                  <canvas id="mars-canvas"></canvas>
                </div>
              </div>
              <div className="lh-globe-wrapper">
                <div className="lh-globe-label">...And Beyond</div>
                <div className="lh-globe-container">
                  <canvas id="solsys-canvas"></canvas>
                </div>
              </div>
            </div>
          </div>

          {/* Organizations — condensed table with detail links */}
          <div className="lh-section">
            <div className="lh-section-title">ORGANIZATIONS</div>
            <div className="lh-company-grid" id="lh-company-grid"></div>
          </div>

          {/* Organization Detail Overlay (appears over launch history) */}
          <div className="lh-org-detail" id="lh-org-detail"></div>

          {/* Mission catalog — hidden by default, revealed by button */}
          <div className="lh-section">
            <button className="lh-show-more-btn lh-catalog-btn" id="lh-catalog-btn">{'\u{1F680}'} BROWSE MISSIONS BY DESTINATION</button>
            <div className="lh-missions-grid" id="lh-missions-grid" style={{display:'none'}}></div>
          </div>
        </div>
      </div>

      {/* Launch Simulator Overlay */}
      <div id="launch-sim" className="lh-overlay">
        <div className="fp-space-bg" id="fp-space-bg"></div>
        <div className="fp-header">
          <button className="lh-back-btn" id="sim-back-btn">{'\u2190'} BACK</button>
          <div className="fp-title">STARSHIP FLIGHT PROFILE</div>
          <div className="fp-controls">
            <button className="fp-ctrl-btn" id="fp-play-btn" aria-label="Play">{'\u25B6'}</button>
            <button className="fp-ctrl-btn" id="fp-pause-btn" aria-label="Pause">{'\u23F8'}</button>
            <select className="fp-speed-select" id="fp-speed-select" defaultValue="10">
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="5">5x</option>
              <option value="10">10x</option>
            </select>
            <button className="fp-ctrl-btn" id="fp-reset-btn" aria-label="Reset">{'\u21BA'}</button>
          </div>
        </div>
        <div className="fp-body">
          <div className="fp-rocket-panel" id="fp-rocket-panel"></div>
          <div className="fp-timeline-panel" id="fp-timeline-panel">
            <div className="fp-altitude-scale">
              <span style={{bottom:'0%'}}>0 km</span>
              <span style={{bottom:'5%'}}>10 km</span>
              <span style={{bottom:'25%'}}>50 km</span>
              <span style={{bottom:'50%'}}>100 km</span>
              <span style={{bottom:'75%'}}>150 km</span>
              <span style={{bottom:'100%'}}>200 km</span>
            </div>
            <div className="fp-timeline-line"></div>
            <div className="fp-milestones" id="fp-milestones"></div>
            <div className="fp-rocket-indicator" id="fp-rocket-dot">{'\u25B2'}</div>
          </div>
          <div className="fp-callout-panel" id="fp-callout-panel">
            <img src="/Infinita/images/generated/starship-hero.png" alt="Starship" className="fp-hero-img" />
            <div className="fp-callout-card" id="fp-callout">
              <div className="fp-callout-label" id="fp-callout-label">READY</div>
              <div className="fp-callout-time" id="fp-callout-time">T-0:10</div>
              <div className="fp-callout-desc" id="fp-callout-desc">Press play to begin the flight profile.</div>
            </div>
            <div className="fp-stage-info" id="fp-stage-info"></div>
          </div>
        </div>
        <div className="fp-scrub-row">
          <input type="range" className="fp-scrub" id="fp-scrub" min="0" max="420" defaultValue="0" step="1" />
        </div>
        <div className="fp-telemetry" id="fp-telemetry">
          <div className="fp-telem"><span className="fp-telem-lbl">T+</span><span className="fp-telem-val" id="fp-t-time">00:00</span></div>
          <div className="fp-telem"><span className="fp-telem-lbl">ALT</span><span className="fp-telem-val" id="fp-t-alt">0 km</span></div>
          <div className="fp-telem"><span className="fp-telem-lbl">VEL</span><span className="fp-telem-val" id="fp-t-vel">0 m/s</span></div>
          <div className="fp-telem"><span className="fp-telem-lbl">ACCEL</span><span className="fp-telem-val" id="fp-t-accel">0 g</span></div>
          <div className="fp-telem"><span className="fp-telem-lbl">STAGE</span><span className="fp-telem-val" id="fp-t-stage">BOOSTER</span></div>
        </div>
      </div>

      {/* Mission Planner Overlay */}
      <div id="mission-planner" className="lh-overlay">
        <div className="mp-header">
          <button className="lh-back-btn" id="mp-back-btn">{'\u2190'} BACK</button>
          <div className="mp-title">MISSION PLANNER</div>
          <div className="mp-exec-controls" id="mp-exec-controls" style={{display:'none'}}>
            <button className="fp-ctrl-btn" id="mp-play-btn" aria-label="Play">{'\u25B6'}</button>
            <button className="fp-ctrl-btn" id="mp-pause-btn" aria-label="Pause">{'\u23F8'}</button>
            <select className="fp-speed-select" id="mp-speed-select" defaultValue="1">
              <option value="0.5">0.5x</option>
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="5">5x</option>
              <option value="10">10x</option>
            </select>
          </div>
        </div>
        <div className="mp-body">
          {/* 3D Viewport */}
          <div className="mp-viewport" id="mp-viewport"></div>

          {/* Planning sidebar */}
          <div className="mp-sidebar" id="mp-plan-panel">
            <div className="mp-section">
              <div className="mp-section-title">PRESET MISSIONS</div>
              <div className="mp-templates-grid" id="mp-templates"></div>
            </div>

            <div className="mp-section">
              <div className="mp-section-title">SELECT ROCKET</div>
              <div className="mp-rocket-grid" id="mp-rocket-grid"></div>
            </div>

            <div className="mp-section">
              <div className="mp-section-title">DESTINATION</div>
              <div className="mp-dest-grid" id="mp-dest-grid"></div>
            </div>

            <div className="mp-section">
              <div className="mp-section-title">MISSION TYPE</div>
              <div className="mp-stop-row">
                <button className="mp-stop-btn" data-stop="flyby">FLYBY</button>
                <button className="mp-stop-btn selected" data-stop="orbit">ORBIT</button>
                <button className="mp-stop-btn" data-stop="landing">LANDING</button>
              </div>
            </div>

            <div className="mp-section">
              <div className="mp-section-title">MISSION BRIEFING</div>
              <div className="mp-briefing" id="mp-briefing"></div>
            </div>

            <div className="mp-action-row">
              <button className="mp-approve-btn" id="mp-approve-btn" disabled>{'\u2713'} APPROVE MISSION</button>
              <button className="mp-deny-btn" id="mp-deny-btn">{'\u2715'} RESET</button>
            </div>
          </div>

          {/* Execution sidebar (hidden during planning) */}
          <div className="mp-sidebar mp-exec-sidebar" id="mp-exec-panel" style={{display:'none'}}>
            <div className="mp-section">
              <div className="mp-section-title">MISSION TELEMETRY</div>
              <div className="mp-telem-grid">
                <div className="mp-telem-row"><span className="mp-telem-lbl">ELAPSED</span><span className="mp-telem-val" id="mp-t-elapsed">0 days</span></div>
                <div className="mp-telem-row"><span className="mp-telem-lbl">REMAINING</span><span className="mp-telem-val" id="mp-t-remaining">{'\u2014'}</span></div>
                <div className="mp-telem-row"><span className="mp-telem-lbl">PROGRESS</span><span className="mp-telem-val" id="mp-t-progress">0%</span></div>
                <div className="mp-telem-row"><span className="mp-telem-lbl">DIST</span><span className="mp-telem-val" id="mp-t-dist">1.00 AU</span></div>
                <div className="mp-telem-row"><span className="mp-telem-lbl">PHASE</span><span className="mp-telem-val" id="mp-t-phase">STANDBY</span></div>
              </div>
            </div>
            <div className="mp-progress-wrap">
              <div className="mp-progress-track">
                <div className="mp-progress-bar" id="mp-progress-bar"></div>
              </div>
            </div>
            <div className="mp-arrival" id="mp-arrival" style={{display:'none'}}>
              <div className="mp-arrival-title">{'\u2713'} MISSION COMPLETE</div>
              <div className="mp-arrival-text">Spacecraft has arrived at destination.</div>
            </div>
            <div className="mp-action-row">
              <button className="mp-deny-btn" id="mp-replan-btn">{'\u21BA'} NEW MISSION</button>
            </div>
          </div>
        </div>
      </div>


      {/* Fun Facts Panel */}
      <div id="facts-panel">
        <div className="facts-card">
          <div className="facts-hdr" id="facts-toggle-btn">
            <div className="facts-hdr-title"><span className="facts-hdr-icon">{'\u25C8'}</span>Stellar Intelligence</div>
            <span className="facts-chevron">{'\u25BC'}</span>
          </div>
          <div className="facts-body">
            <div className="facts-inner">
              <div id="facts-badge" className="facts-badge nearby">{'\u25C9'} Nearby</div>
              <div id="facts-obj-name" className="facts-obj-name">{'\u2014'}</div>
              <div id="facts-text" className="facts-text"></div>
              <div id="facts-footer" className="facts-footer"></div>
              <button id="facts-suggest-btn" className="facts-suggest-btn" style={{display:'none'}}>{'\u2605'} TRAVEL HERE {'\u2192'}</button>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      <div id="mobile-menu" className="mob-menu">
        <button className="mob-menu-toggle" id="mob-menu-toggle" aria-label="Menu">{'\u2630'}</button>
        <div className="mob-menu-panel" id="mob-menu-panel">
          <div className="mob-menu-section">
            <div className="mob-menu-title">NAVIGATION</div>
            <button className="mob-menu-item" id="mob-fly-fwd">{'\u25B2'} Fly Forward</button>
            <button className="mob-menu-item" id="mob-fly-back">{'\u25BC'} Fly Backward</button>
            <button className="mob-menu-item" id="mob-fly-up">{'\u25B3'} Fly Up</button>
            <button className="mob-menu-item" id="mob-fly-down">{'\u25BD'} Fly Down</button>
            <button className="mob-menu-item" id="mob-nearest">G Jump to Nearest</button>
          </div>
          <div className="mob-menu-section">
            <div className="mob-menu-title">SPEED</div>
            <div className="mob-speed-row">
              <button className="mob-menu-item mob-spd" id="mob-speed-down">{'\u2212'} Slower</button>
              <span className="mob-speed-display" id="mob-speed-label">0 m/s</span>
              <button className="mob-menu-item mob-spd" id="mob-speed-up">+ Faster</button>
            </div>
          </div>
          <div className="mob-menu-section">
            <div className="mob-menu-title">TOOLS</div>
            <button className="mob-menu-item" id="mob-search">{'\uD83D\uDD0D'} Object Search</button>
            <button className="mob-menu-item" id="mob-nav">{'\u2316'} Navigation Computer</button>
            <button className="mob-menu-item" id="mob-explore">{'\u2B21'} Auto-Explore</button>
            <button className="mob-menu-item" id="mob-controls">{'\u2328'} Show Controls</button>
            <button className="mob-menu-item" id="mob-report">{'\u2263'} Astro Report</button>
            <button className="mob-menu-item" id="mob-satellites">{'\uD83D\uDEF0'} Satellites</button>
          </div>
          <div className="mob-menu-section">
            <div className="mob-menu-title">VIEW</div>
            <button className="mob-menu-item" id="mob-scale">{'\u29BE'} Cycle Scale Level</button>
            <button className="mob-menu-item" id="mob-time">{'\u23EF'} Pause / Resume Time</button>
            <button className="mob-menu-item" id="mob-time-faster">{'\u23E9'} Speed Up Time</button>
            <button className="mob-menu-item" id="mob-time-slower">{'\u23EA'} Slow Down Time</button>
            <button className="mob-menu-item" id="mob-hud-toggle">{'\u25A3'} Toggle HUD</button>
          </div>
        </div>
      </div>

      <div id="labels" />

      {/* ── Contextual Side Panel (stack-based) ── */}
      {currentPanel && (
        <div className="ctx-panel open" role="complementary" aria-label="Details panel"
          onTouchStart={e => { e.currentTarget._touchY = e.touches[0].clientY }}
          onTouchMove={e => {
            const dy = e.touches[0].clientY - (e.currentTarget._touchY || 0)
            if (dy > 0) e.currentTarget.style.transform = `translateY(${dy}px)`
          }}
          onTouchEnd={e => {
            const dy = e.changedTouches[0].clientY - (e.currentTarget._touchY || 0)
            if (dy > 80) closePanel()
            else e.currentTarget.style.transform = ''
          }}>
          <div className="ctx-panel-header">
            {panelStack.length > 1 && (
              <button className="ctx-panel-back" onClick={popPanel} aria-label="Back">{'\u2190'}</button>
            )}
            <span className="ctx-panel-title">{currentPanel.title || 'Details'}</span>
            <button className="ctx-panel-close" onClick={closePanel} aria-label="Close panel">{'\u2715'}</button>
          </div>
          {currentPanel.type === 'launch' && currentPanel.data && (() => {
            const d = currentPanel.data
            return (
            <div className="ctx-panel-body">
              <div className="ctx-panel-field"><span className="ctx-panel-label">Date</span><span className="ctx-panel-value">{d.launch_date}</span></div>
              <div className="ctx-panel-field"><span className="ctx-panel-label">Rocket</span><span className="ctx-panel-value">{d.rocket_name} {d.rocket_variant}</span></div>
              <div className="ctx-panel-field"><span className="ctx-panel-label">Provider</span><span className="ctx-panel-value">{d.provider}</span></div>
              <div className="ctx-panel-field"><span className="ctx-panel-label">Site</span><span className="ctx-panel-value">{d.launch_site}</span></div>
              <div className="ctx-panel-field"><span className="ctx-panel-label">Orbit</span><span className="ctx-panel-value">{d.orbit_type}</span></div>
              <div className="ctx-panel-field"><span className="ctx-panel-label">Outcome</span>
                <span className={`ctx-panel-outcome ${d.outcome}`}>
                  {d.outcome === 'success' ? '\u2713' : d.outcome === 'failure' ? '\u2717' : '\u26A0'} {d.outcome}
                </span>
              </div>
              <div className="ctx-panel-desc">{d.mission_description}</div>
              {d.firsts?.length > 0 && (
                <div className="ctx-panel-firsts">{d.firsts.map((f,i) => <div key={i}>{'\u2605'} {f}</div>)}</div>
              )}

              {/* ── Contextual links ── */}
              <div className="ctx-panel-links">
                {activeNav === 'explore' && (
                  <button className="ctx-panel-link" onClick={() => window.__infinita_returnToDb?.()}>
                    {'\u2190'} Back to Database
                  </button>
                )}
                <button className="ctx-panel-link" onClick={() => { setActiveNav('timeline'); closePanel() }}>
                  Browse all launches {'\u2192'}
                </button>
                {activeNav !== 'explore' && d.launch_site_lat && (
                  <button className="ctx-panel-link primary" onClick={() => window.__infinita_viewIn3D?.(d)}>
                    {'\uD83C\uDF0D'} View in 3D
                  </button>
                )}
              </div>
            </div>
            )
          })()}
          {currentPanel.type === 'siteLaunches' && currentPanel.data && (
            <div className="ctx-panel-body">
              <div className="ctx-panel-site-count">{currentPanel.data.launches.length} launches from this site</div>
              {currentPanel.data.launches.map(l => (
                <div key={l.id} className="ctx-panel-launch-row"
                  onClick={() => pushPanel({ type: 'launch', data: l, title: l.mission_name })}
                  role="button" tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') pushPanel({ type: 'launch', data: l, title: l.mission_name }) }}>
                  <span className="ctx-panel-launch-date">{l.launch_date}</span>
                  <span className="ctx-panel-launch-name">{l.mission_name}</span>
                  <span className={`ctx-panel-launch-outcome ${l.outcome}`}>{l.outcome === 'success' ? '\u2713' : l.outcome === 'failure' ? '\u2717' : '\u26A0'}</span>
                </div>
              ))}
              <div className="ctx-panel-links">
                <button className="ctx-panel-link" onClick={() => { setActiveNav('timeline'); closePanel() }}>
                  Browse all launches {'\u2192'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Breadcrumb Bar (Explore mode only) ── */}
      {activeNav === 'explore' && breadcrumbs.length > 0 && (
        <div className="breadcrumb-bar" aria-label="Navigation breadcrumb">
          {breadcrumbs.map((crumb, i) => (
            <span key={i}>
              {i > 0 && <span className="breadcrumb-sep">{'\u203A'}</span>}
              <button className={`breadcrumb-item${!crumb.action ? ' current' : ''}`} onClick={() => {
                if (crumb.action === 'resetView') { window.__infinita_resetView?.(); closePanel() }
                else if (crumb.action?.startsWith('flyTo:')) { window.__infinita_flyToBody?.(crumb.action.slice(6)); closePanel() }
              }} disabled={!crumb.action}>{crumb.label}</button>
            </span>
          ))}
        </div>
      )}

      {/* ── Lazy-loaded Pages ── */}

      {/* ── Desktop Sidebar ── */}
      <nav className="nav-sidebar" aria-label="Main navigation">
        <div className="nav-sidebar-brand">I</div>
        <div className="nav-sidebar-items">
          {[
            ['explore',   'Explore',   <><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></>],
            ['timeline',  'Launches',  <><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></>],
          ].map(([id, label, icon]) => (
            <button key={id} className={'nav-sidebar-item' + (activeNav === id ? ' active' : '')}
              onClick={() => setActiveNav(id)} aria-label={label}>
              <span className="nav-sidebar-icon"><svg viewBox="0 0 24 24">{icon}</svg></span>
              <span className="nav-sidebar-label">{label}</span>
            </button>
          ))}
          <div className="nav-sidebar-spacer" />
          <button className="nav-sidebar-item" onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            <span className="nav-sidebar-icon"><svg viewBox="0 0 24 24">
              {theme === 'dark'
                ? <><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>
                : <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>}
            </svg></span>
            <span className="nav-sidebar-label">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>
          </button>
        </div>
        <button className="nav-search-trigger" onClick={() => toggleCmd(true)} aria-label="Search">
          <span className="nav-search-trigger-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
          <span className="nav-search-trigger-text">Search</span>
          <span className="nav-search-trigger-kbd">{'\u2318'}K</span>
        </button>
      </nav>

      {/* ── Mobile Bottom Nav ── */}
      <nav className="nav-bottom" aria-label="Main navigation">
        <div className="nav-bottom-items">
          {[
            ['explore',   'Explore',   <><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z"/></>],
            ['timeline',  'Launches',  <><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></>],
          ].map(([id, label, icon]) => (
            <button key={id} className={'nav-bottom-item' + (activeNav === id ? ' active' : '')}
              onClick={() => setActiveNav(id)} aria-label={label}>
              <span className="nav-bottom-icon"><svg viewBox="0 0 24 24">{icon}</svg></span>
              <span className="nav-bottom-label">{label}</span>
            </button>
          ))}
          <button className="nav-bottom-item" onClick={() => toggleCmd(true)} aria-label="Search">
            <span className="nav-bottom-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
            <span className="nav-bottom-label">Search</span>
          </button>
        </div>
      </nav>

      {/* ── Command Palette (⌘K) ── */}
      <div className={'cmd-palette-overlay' + (cmdOpen ? ' open' : '')}
        onClick={(e) => { if (e.target === e.currentTarget) toggleCmd(false) }}
        role="dialog" aria-modal="true" aria-label="Search missions">
        <div className="cmd-palette">
          <div className="cmd-palette-input-row">
            <span className="cmd-palette-search-icon"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg></span>
            <input ref={cmdInputRef} className="cmd-palette-input" type="text"
              placeholder="Search missions, rockets, providers..." spellCheck="false" autoComplete="off"
              value={cmdQuery} onChange={e => setCmdQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCmdSearch() }} />
            <span className="cmd-palette-kbd">ESC</span>
          </div>
          <div className="cmd-palette-body" aria-live="polite">
            <div className="cmd-palette-hint">
              {cmdQuery.trim() ? `Press Enter to search "${cmdQuery}" in the launch database` : 'Type a mission name, rocket, or provider'}
            </div>
          </div>
          <div className="cmd-palette-footer">
            <span className="cmd-palette-footer-hint"><kbd>{'\u2191'}{'\u2193'}</kbd> navigate</span>
            <span className="cmd-palette-footer-hint"><kbd>{'\u21B5'}</kbd> select</span>
            <span className="cmd-palette-footer-hint"><kbd>esc</kbd> close</span>
          </div>
        </div>
      </div>

      {/* ── Toasts & Scroll Progress ── */}
      <ToastContainer />
      <ScrollProgress target={activeNav === 'launches' ? '.lp-body' : activeNav === 'stats' ? '.stats-body' : '.home-scroll'} />
    </>
  )
}

export default App
