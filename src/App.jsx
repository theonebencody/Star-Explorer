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
          <div className="splash-sub">Navigate the cosmos</div>
          <div className="splash-buttons">
            <button className="splash-btn splash-btn-primary" id="splash-explore-btn">
              <div className="splash-btn-icon">{'\u2B21'}</div>
              <div className="splash-btn-label">EXPLORE UNIVERSE</div>
              <div className="splash-btn-sub">Free-fly through space and time</div>
            </button>
            <button className="splash-btn" id="splash-launches-btn">
              <div className="splash-btn-icon">{'\uD83D\uDE80'}</div>
              <div className="splash-btn-label">LAUNCH HISTORY <span className="beta-tag">BETA</span></div>
              <div className="splash-btn-sub">Relive humanity{"'"}s greatest missions</div>
            </button>
            <button className="splash-btn" id="splash-sim-btn">
              <div className="splash-btn-icon">{'\u2622'}</div>
              <div className="splash-btn-label">LAUNCH SIMULATOR <span className="beta-tag">BETA</span></div>
              <div className="splash-btn-sub">Design and simulate your own mission</div>
            </button>
          </div>
        </div>
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
        </div>

        <div className="hud-tr">
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
          <button className="panel-close-btn" id="welcome-close-btn" style={{position:'absolute',top:'12px',right:'12px'}}>{'\u2715'}</button>
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

      {/* UFO Alert */}
      <div id="ufo-alert">
        <span className="ufo-msg">UNIDENTIFIED CRAFT DETECTED</span>
      </div>

      {/* Launch History Overlay */}
      <div id="launch-history" className="lh-overlay">
        <div className="lh-header">
          <button className="lh-back-btn" id="lh-back-btn">{'\u2190'} BACK</button>
          <div className="lh-title">LAUNCH HISTORY</div>
          <div className="lh-filter-row">
            <button className="lh-filter-btn active" data-org="All">ALL</button>
            <button className="lh-filter-btn" data-org="NASA">NASA</button>
            <button className="lh-filter-btn" data-org="SpaceX">SPACEX</button>
            <button className="lh-filter-btn" data-org="Soviet">SOVIET</button>
            <button className="lh-filter-btn" data-org="CNSA">CHINA</button>
            <button className="lh-filter-btn" data-org="ESA/NASA">ESA</button>
            <button className="lh-filter-btn" data-org="ISRO">INDIA</button>
          </div>
        </div>
        <div className="lh-body">
          <div className="lh-left" id="lh-mission-list"></div>
          <div className="lh-center"><canvas id="earth-canvas"></canvas></div>
          <div className="lh-right" id="lh-detail-panel">
            <div className="lh-detail-empty">SELECT A MISSION<br />TO VIEW DETAILS</div>
          </div>
        </div>
      </div>

      {/* Launch Simulator Overlay */}
      <div id="launch-sim" className="lh-overlay">
        <div className="lh-header">
          <button className="lh-back-btn" id="sim-back-btn">{'\u2190'} BACK</button>
          <div className="lh-title">STARSHIP LAUNCH SIMULATOR</div>
          <div className="sim-status" id="sim-status">CONFIGURE LAUNCH</div>
        </div>
        <div className="sim-comparison-body">
          <div className="sim-config-panel" id="sim-config">
            <div className="sim-rocket-selector sim-selector-a">
              <div className="sim-selector-label">MISSION PROFILE</div>

              <div className="sim-section">
                <div className="sim-label">PAYLOAD MASS (tonnes)</div>
                <input type="range" className="sim-slider" id="sim-payload" min="0" max="150" defaultValue="50" />
                <div className="sim-slider-val" id="sim-payload-val">50 t</div>
              </div>

              <div className="sim-section">
                <div className="sim-label">DESTINATION</div>
                <div className="sim-options" id="sim-dest">
                  <button className="sim-opt-btn active" data-val="LEO">LEO (200 km)</button>
                  <button className="sim-opt-btn" data-val="GTO">GTO</button>
                  <button className="sim-opt-btn" data-val="Moon">Moon</button>
                  <button className="sim-opt-btn" data-val="Mars">Mars</button>
                </div>
              </div>

              <div className="sim-section">
                <div className="sim-label">LAUNCH SITE</div>
                <div className="sim-options" id="sim-site">
                  <button className="sim-opt-btn active" data-val="Boca">Starbase, TX</button>
                  <button className="sim-opt-btn" data-val="KSC">Kennedy Space Center</button>
                </div>
              </div>

              <div className="sim-section">
                <div className="sim-label">RAPTOR ENGINE COUNT (BOOSTER)</div>
                <input type="range" className="sim-slider" id="sim-engines" min="20" max="33" defaultValue="33" />
                <div className="sim-slider-val" id="sim-engines-val">33 engines</div>
              </div>

              <div className="sim-section">
                <div className="sim-label">SHIP RAPTOR COUNT</div>
                <input type="range" className="sim-slider" id="sim-ship-engines" min="3" max="6" defaultValue="6" />
                <div className="sim-slider-val" id="sim-ship-engines-val">6 engines (3 sea-level + 3 vacuum)</div>
              </div>
            </div>

            <div className="sim-shared-config">
              <div className="sim-selector-label">VEHICLE SPECS (computed)</div>
              <div className="sim-spec-grid" id="sim-specs">
                <div className="sim-spec"><span className="sim-spec-label">Total Height</span><span className="sim-spec-val">121 m</span></div>
                <div className="sim-spec"><span className="sim-spec-label">Liftoff Mass</span><span className="sim-spec-val">5,000 t</span></div>
                <div className="sim-spec"><span className="sim-spec-label">Booster Thrust</span><span className="sim-spec-val">74,400 kN</span></div>
                <div className="sim-spec"><span className="sim-spec-label">Ship Thrust</span><span className="sim-spec-val">14,700 kN</span></div>
                <div className="sim-spec"><span className="sim-spec-label">Thrust-to-Weight</span><span className="sim-spec-val">1.52</span></div>
                <div className="sim-spec"><span className="sim-spec-label">Delta-V Budget</span><span className="sim-spec-val">~9.5 km/s</span></div>
              </div>
            </div>

            <button className="sim-launch-btn" id="sim-launch-btn">INITIATE LAUNCH SEQUENCE</button>
          </div>

          <div className="sim-dual-viewport">
            <div className="sim-viewport-half" id="sim-viewport-a" style={{flex:'1'}}>
              <canvas id="sim-canvas-a"></canvas>
              <div className="sim-rocket-label sim-label-a" id="sim-label-a">STARSHIP / SUPER HEAVY</div>
              <div className="sim-telemetry" id="sim-telemetry-a">
                <div className="sim-telem-row"><span className="sim-telem-label">T+</span><span className="sim-telem-val" id="sim-t-time">00:00</span></div>
                <div className="sim-telem-row"><span className="sim-telem-label">ALT</span><span className="sim-telem-val" id="sim-t-alt">0 km</span></div>
                <div className="sim-telem-row"><span className="sim-telem-label">VEL</span><span className="sim-telem-val" id="sim-t-vel">0 m/s</span></div>
                <div className="sim-telem-row"><span className="sim-telem-label">ACCEL</span><span className="sim-telem-val" id="sim-t-accel">0.0 g</span></div>
                <div className="sim-telem-row"><span className="sim-telem-label">DOWNRANGE</span><span className="sim-telem-val" id="sim-t-downrange">0 km</span></div>
                <div className="sim-telem-row"><span className="sim-telem-label">BOOSTER FUEL</span><span className="sim-telem-val" id="sim-t-bfuel">100%</span></div>
                <div className="sim-telem-row"><span className="sim-telem-label">SHIP FUEL</span><span className="sim-telem-val" id="sim-t-sfuel">100%</span></div>
                <div className="sim-telem-row"><span className="sim-telem-label">STAGE</span><span className="sim-telem-val" id="sim-t-stage">BOOSTER</span></div>
                <div className="sim-telem-row"><span className="sim-telem-label">STATUS</span><span className="sim-telem-val" id="sim-t-status">PRE-LAUNCH</span></div>
              </div>
              <div className="sim-ticker" id="sim-ticker-a"><div className="sim-ticker-text" id="sim-ticker-text"></div></div>
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
