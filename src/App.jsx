import { useEffect, useRef } from 'react'

function App() {
  const canvasContainer = useRef(null)

  useEffect(() => {
    let cleanup
    import('./scene/SceneManager.js').then(m => {
      cleanup = m.init(canvasContainer.current)
    })
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])

  return (
    <>
      <div ref={canvasContainer} id="canvas-container" />

      <div id="splash">
        <canvas id="splash-bg" className="splash-bg-canvas"></canvas>
        <div className="splash-inner">
          <div className="splash-title">INFINITA</div>
          <div className="splash-sub">Life on Earth is finite. Life beyond is infinite.</div>
          <div className="splash-buttons">
            <button className="splash-btn splash-btn-primary" id="splash-explore-btn"
              data-hover-desc="Pilot your own spacecraft through an accurate 3D solar system. Visit all 8 planets with real NASA textures, 18 moons, asteroids, and comets. Search and travel to over 15 million real stars, galaxies, and nebulae from the SIMBAD database. Control the flow of time from paused to 27 years per second. Track real satellites in orbit using live data.">
              <div className="splash-btn-icon">{'\u2B21'}</div>
              <div className="splash-btn-label">EXPLORE UNIVERSE</div>
            </button>
            <button className="splash-btn" id="splash-launches-btn"
              data-hover-desc="Dive into a comprehensive database of over 1,300 real space launches spanning from 1957 to 2026 across 21 organizations worldwide. Explore interactive 3D globes of Earth, Mars, and the solar system showing mission trajectories. Browse detailed timelines, organization profiles, and defining moments in spaceflight history.">
              <div className="splash-btn-icon">{'\uD83D\uDE80'}</div>
              <div className="splash-btn-label">LAUNCH HISTORY <span className="beta-tag">BETA</span></div>
            </button>
            <button className="splash-btn" id="splash-sim-btn"
              data-hover-desc="Watch SpaceX&apos;s Starship flight profile unfold in real time with accurate physics simulation. Follow every milestone from liftoff through Max Q, hot-staging, booster catch, and orbit insertion. Features real SpaceX photography, live telemetry readouts, and adjustable playback speed.">
              <div className="splash-btn-icon">{'\u2622'}</div>
              <div className="splash-btn-label">LAUNCH SIMULATOR <span className="beta-tag">NOT READY</span></div>
            </button>
            <button className="splash-btn" id="splash-planner-btn"
              data-hover-desc="Plan interplanetary missions with real orbital mechanics. Choose from 6 rockets across SpaceX, NASA, Blue Origin, and ESA. Select destinations from the Moon to Neptune, pick your mission type, and get a physics-based feasibility analysis. Approve your mission and watch it execute in a 3D solar system with live telemetry.">
              <div className="splash-btn-icon">{'\uD83D\uDDFA'}</div>
              <div className="splash-btn-label">MISSION PLANNER <span className="beta-tag">NOT READY</span></div>
            </button>
          </div>
        </div>
        <div className="splash-hover-box" id="splash-hover-box"></div>
      </div>

      <div id="hud">
        <div className="crosshair"></div>

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
          <div className="hud-panel">
            <div className="hud-label">Position (AU)</div>
            <div className="hud-small" id="hud-pos">x: 0 y: 0 z: 0</div>
          </div>
        </div>

        <div className="hud-bl">
          <button className="lh-back-btn" id="hud-back-btn" style={{marginBottom:'8px',pointerEvents:'all'}}>{'\u2190'} BACK</button>
          <button className="mission-report-btn" id="mission-report-btn" style={{pointerEvents:'all'}}>{'\u2263'} ASTRO REPORT</button>
          <button className="mission-report-btn" id="sat-toggle-btn" style={{pointerEvents:'all'}}>{'\uD83D\uDEF0'} SATELLITES</button>
          <div className="hud-panel controls-help" id="controls-help">
            <span>C</span> Show all controls
          </div>
        </div>

        <div className="cruise-tip" id="cruise-tip">Press R for a good time</div>

        <div className="hud-ticker" id="hud-ticker">
          <span className="hud-ticker-text" id="hud-ticker-text"></span>
        </div>

        {/* Controls overlay */}
        <div className="controls-overlay" id="controls-overlay">
          <div className="controls-card">
            <div className="controls-card-title">CONTROLS <button className="panel-close-btn" id="controls-close-btn">{'\u2715'}</button></div>
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
            <div className="search-title">Object Database Search <button className="panel-close-btn" id="search-close-btn">{'\u2715'}</button></div>
            <input type="text" className="search-input" id="search-input" placeholder="Search stars, exoplanets, planets..." autoComplete="off" spellCheck="false" />
            <div className="search-results" id="search-results"></div>
            <div className="search-hint">ESC / F to close {'\u00A0'}{'\u00B7'}{'\u00A0'} Enter or click to travel {'\u00A0'}{'\u00B7'}{'\u00A0'} Powered by SIMBAD (~15M objects)</div>
          </div>
        </div>
      </div>

      {/* Travel Panel */}
      <div className="travel-panel" id="travel-panel">
        <div className="travel-card">
          <div className="travel-card-title">NAVIGATION COMPUTER <button className="panel-close-btn" id="travel-close-btn">{'\u2715'}</button></div>
          <div className="travel-section">
            <div className="travel-section-label">Destination</div>
            <input className="travel-dest-input" id="travel-dest-input" placeholder="Search star, planet, galaxy\u2026" autoComplete="off" spellCheck="false" />
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
          <button className="panel-close-btn" id="welcome-close-btn" style={{position:'absolute',top:'12px',right:'12px',transform:'none'}}>{'\u2715'}</button>
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
          <button className="panel-close-btn" id="report-close-btn">{'\u2715'}</button>
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
            <button className="fp-ctrl-btn" id="fp-play-btn">{'\u25B6'}</button>
            <button className="fp-ctrl-btn" id="fp-pause-btn">{'\u23F8'}</button>
            <select className="fp-speed-select" id="fp-speed-select">
              <option value="1">1x</option>
              <option value="2">2x</option>
              <option value="5">5x</option>
              <option value="10" selected>10x</option>
            </select>
            <button className="fp-ctrl-btn" id="fp-reset-btn">{'\u21BA'}</button>
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
            <button className="fp-ctrl-btn" id="mp-play-btn">{'\u25B6'}</button>
            <button className="fp-ctrl-btn" id="mp-pause-btn">{'\u23F8'}</button>
            <select className="fp-speed-select" id="mp-speed-select">
              <option value="0.5">0.5x</option>
              <option value="1" selected>1x</option>
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

      {/* Trivia Panel — sits above Stellar Intelligence */}
      <div id="trivia-panel">
        <div className="facts-card">
          <div className="facts-hdr" id="trivia-toggle">
            <div className="facts-hdr-title"><span className="facts-hdr-icon">{'\u2728'}</span>Space Trivia</div>
            <span className="facts-chevron" id="trivia-chevron">{'\u25BC'}</span>
          </div>
          <div className="facts-body" id="trivia-body-wrap">
            <div className="facts-inner">
              <div className="trivia-question" id="trivia-question"></div>
              <div className="trivia-answer" id="trivia-answer"></div>
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
        <button className="mob-menu-toggle" id="mob-menu-toggle">{'\u2630'}</button>
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
    </>
  )
}

export default App
