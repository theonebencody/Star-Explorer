// Mission Planner — main controller
// Manages the planning UI, 3D mission scene, and execution playback

import * as THREE from 'three';
import { ROCKET_CATALOG, DESTINATION_BODIES, MISSION_TEMPLATES } from '../data/missionTemplates.js';
import { missionDeltaV, checkFeasibility, transferOrbitPoints, transferPosition, formatDuration } from './missionPhysics.js';
import { PLANETS } from './constants.js';
import { getOrbitalPosition } from './physics.js';
import { loadRealTexture } from './noiseUtils.js';

// ═══════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════
let _mpActive = false;
let _mpPhase = 'plan'; // 'plan' | 'review' | 'execute'
let _mpPlaying = false;
let _mpSpeed = 1;
let _mpProgress = 0; // 0-1 during execution
let _mpLastT = 0;

// Scene
let _mpRenderer = null;
let _mpScene = null;
let _mpCamera = null;
let _mpAnimId = null;
let _mpPlanetMeshes = {};
let _mpTransferLine = null;
let _mpShipMesh = null;
let _mpOrbitLines = {};

// Mission config
let _mpRocket = null;
let _mpDestination = null;
let _mpStopType = 'orbit';
let _mpMission = null; // computed mission data
let _mpFeasibility = null;
let _mpStayDays = 0;

// ═══════════════════════════════════════════════
//  INIT / OPEN / CLOSE
// ═══════════════════════════════════════════════

export function openMissionPlanner() {
  _mpActive = true;
  _mpPhase = 'plan';
  _mpPlaying = false;
  _mpProgress = 0;
  _mpRocket = ROCKET_CATALOG[0];
  _mpDestination = DESTINATION_BODIES[0];
  _mpStopType = 'orbit';
  _mpStayDays = 0;
  _mpMission = null;
  _mpFeasibility = null;

  const el = document.getElementById('mission-planner');
  if (el) el.classList.add('open');

  _buildPlanUI();
  _initMissionScene();
  _computeMission();
}

export function closeMissionPlanner() {
  _mpActive = false;
  _mpPlaying = false;
  const el = document.getElementById('mission-planner');
  if (el) el.classList.remove('open');
  _destroyMissionScene();
  document.getElementById('splash').classList.remove('hidden');
}

// ═══════════════════════════════════════════════
//  3D MISSION SCENE
// ═══════════════════════════════════════════════

function _initMissionScene() {
  const container = document.getElementById('mp-viewport');
  if (!container || _mpRenderer) return;

  _mpRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  _mpRenderer.setSize(container.clientWidth, container.clientHeight);
  _mpRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _mpRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  container.appendChild(_mpRenderer.domElement);

  _mpScene = new THREE.Scene();
  _mpScene.background = new THREE.Color(0x000308);

  _mpCamera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.01, 500);
  _mpCamera.position.set(0, 8, 12);
  _mpCamera.lookAt(0, 0, 0);

  // Lighting
  const ambient = new THREE.AmbientLight(0x334466, 0.8);
  _mpScene.add(ambient);
  const sunLight = new THREE.PointLight(0xfff4dd, 2, 200);
  _mpScene.add(sunLight);

  // Sun
  const sunGeo = new THREE.SphereGeometry(0.25, 32, 32);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4e0 });
  const sunMesh = new THREE.Mesh(sunGeo, sunMat);
  _mpScene.add(sunMesh);

  // Sun glow
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 64; glowCanvas.height = 64;
  const gCtx = glowCanvas.getContext('2d');
  const grad = gCtx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,244,200,0.4)');
  grad.addColorStop(0.5, 'rgba(255,200,100,0.1)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  gCtx.fillStyle = grad;
  gCtx.fillRect(0, 0, 64, 64);
  const glowTex = new THREE.CanvasTexture(glowCanvas);
  const glowMat = new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true });
  const glowSprite = new THREE.Sprite(glowMat);
  glowSprite.scale.setScalar(1.5);
  _mpScene.add(glowSprite);

  // Background stars
  const starGeo = new THREE.BufferGeometry();
  const starVerts = [];
  for (let i = 0; i < 2000; i++) {
    const r = 80 + Math.random() * 120;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    starVerts.push(r * Math.sin(phi) * Math.cos(theta), r * Math.sin(phi) * Math.sin(theta), r * Math.cos(phi));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starVerts, 3));
  const starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.15, sizeAttenuation: true });
  _mpScene.add(new THREE.Points(starGeo, starMat));

  // Planets (scaled for visibility)
  _mpPlanetMeshes = {};
  const VISUAL_SCALE = 3; // AU to scene units
  PLANETS.forEach(p => {
    const radius = Math.max(0.08, p.rVis * 1.5);
    const geo = new THREE.SphereGeometry(radius, 24, 24);
    const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6, metalness: 0.1, emissive: p.color, emissiveIntensity: 0.15 });
    const mesh = new THREE.Mesh(geo, mat);
    // Position planets at current orbital position
    const pos = getOrbitalPosition(p, 2026.0);
    mesh.position.set(pos.x * VISUAL_SCALE, 0, pos.z * VISUAL_SCALE);
    _mpScene.add(mesh);
    _mpPlanetMeshes[p.name] = { mesh, data: p };

    // Load real textures
    loadRealTexture(p.name.toLowerCase(), (tex) => {
      mat.map = tex;
      mat.needsUpdate = true;
    });

    // Orbit ring
    const orbitPts = [];
    for (let i = 0; i <= 128; i++) {
      const angle = (i / 128) * Math.PI * 2;
      const r = p.a * VISUAL_SCALE;
      orbitPts.push(new THREE.Vector3(Math.cos(angle) * r, 0, Math.sin(angle) * r));
    }
    const orbitGeo = new THREE.BufferGeometry().setFromPoints(orbitPts);
    const orbitMat = new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.15 });
    const orbitLine = new THREE.Line(orbitGeo, orbitMat);
    _mpScene.add(orbitLine);
    _mpOrbitLines[p.name] = orbitLine;
  });

  // Ship marker
  const shipGeo = new THREE.ConeGeometry(0.06, 0.2, 8);
  const shipMat = new THREE.MeshBasicMaterial({ color: 0x00eeff });
  _mpShipMesh = new THREE.Mesh(shipGeo, shipMat);
  _mpShipMesh.rotation.x = -Math.PI / 2;
  _mpShipMesh.visible = false;
  _mpScene.add(_mpShipMesh);

  // Mouse rotation
  let isDragging = false;
  let dragX = 0, dragY = 0;
  let camAngleX = 0.5, camAngleY = 0.6;
  let camDist = 14;

  container.addEventListener('mousedown', (e) => { isDragging = true; dragX = e.clientX; dragY = e.clientY; });
  container.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    camAngleX += (e.clientX - dragX) * 0.005;
    camAngleY = Math.max(0.1, Math.min(1.5, camAngleY + (e.clientY - dragY) * 0.005));
    dragX = e.clientX; dragY = e.clientY;
  });
  container.addEventListener('mouseup', () => { isDragging = false; });
  container.addEventListener('mouseleave', () => { isDragging = false; });
  container.addEventListener('wheel', (e) => {
    camDist = Math.max(3, Math.min(40, camDist + e.deltaY * 0.02));
    e.preventDefault();
  }, { passive: false });

  // Resize observer
  const ro = new ResizeObserver(() => {
    if (!_mpRenderer || !container) return;
    _mpRenderer.setSize(container.clientWidth, container.clientHeight);
    _mpCamera.aspect = container.clientWidth / container.clientHeight;
    _mpCamera.updateProjectionMatrix();
  });
  ro.observe(container);

  // Animate
  function mpAnimate(now) {
    if (!_mpActive) return;
    _mpAnimId = requestAnimationFrame(mpAnimate);

    // Camera orbit
    _mpCamera.position.set(
      Math.sin(camAngleX) * Math.cos(camAngleY) * camDist,
      Math.sin(camAngleY) * camDist,
      Math.cos(camAngleX) * Math.cos(camAngleY) * camDist
    );
    _mpCamera.lookAt(0, 0, 0);

    // Planet rotation
    Object.values(_mpPlanetMeshes).forEach(p => { p.mesh.rotation.y += 0.003; });

    // Execute playback
    if (_mpPhase === 'execute' && _mpPlaying && _mpMission) {
      const dt = _mpLastT ? (now - _mpLastT) / 1000 : 0;
      _mpLastT = now;
      // Progress: map speed-adjusted time to 0-1
      const totalSec = _mpMission.transferDays * 0.15; // compress: 1 day ≈ 0.15s at 1x
      _mpProgress += (dt * _mpSpeed) / totalSec;
      if (_mpProgress >= 1) {
        _mpProgress = 1;
        _mpPlaying = false;
      }
      _updateExecution();
    } else {
      _mpLastT = now;
    }

    _mpRenderer.render(_mpScene, _mpCamera);
  }
  _mpAnimId = requestAnimationFrame(mpAnimate);
}

function _destroyMissionScene() {
  if (_mpAnimId) cancelAnimationFrame(_mpAnimId);
  _mpAnimId = null;
  if (_mpRenderer) {
    _mpRenderer.dispose();
    const container = document.getElementById('mp-viewport');
    if (container && _mpRenderer.domElement.parentNode === container) {
      container.removeChild(_mpRenderer.domElement);
    }
  }
  _mpRenderer = null;
  _mpScene = null;
  _mpCamera = null;
  _mpPlanetMeshes = {};
  _mpTransferLine = null;
  _mpShipMesh = null;
  _mpOrbitLines = {};
}

// ═══════════════════════════════════════════════
//  TRANSFER ARC VISUALIZATION
// ═══════════════════════════════════════════════

function _drawTransferArc() {
  if (!_mpScene || !_mpMission || !_mpDestination) return;

  // Remove old arc
  if (_mpTransferLine) {
    _mpScene.remove(_mpTransferLine);
    _mpTransferLine.geometry.dispose();
    _mpTransferLine.material.dispose();
    _mpTransferLine = null;
  }

  const VISUAL_SCALE = 3;
  const originR = 1.0; // Earth
  const destR = _mpDestination.a;
  const pts = transferOrbitPoints(originR, destR, 80);

  const positions = [];
  pts.forEach(p => {
    positions.push(new THREE.Vector3(p.x * VISUAL_SCALE, 0, p.z * VISUAL_SCALE));
  });

  const geo = new THREE.BufferGeometry().setFromPoints(positions);
  const mat = new THREE.LineBasicMaterial({
    color: 0x00eeff,
    transparent: true,
    opacity: 0.6,
    linewidth: 2,
  });
  _mpTransferLine = new THREE.Line(geo, mat);
  _mpScene.add(_mpTransferLine);

  // Highlight origin and destination orbits
  Object.entries(_mpOrbitLines).forEach(([name, line]) => {
    const isRelevant = name === 'Earth' || name === _mpDestination.name;
    line.material.opacity = isRelevant ? 0.4 : 0.08;
  });

  // Focus camera
  const maxR = Math.max(originR, destR) * VISUAL_SCALE;
  // Camera will auto-adjust via orbit controls
}

// ═══════════════════════════════════════════════
//  COMPUTE MISSION
// ═══════════════════════════════════════════════

function _computeMission() {
  if (!_mpRocket || !_mpDestination) return;

  const originR = 1.0; // Earth
  const destR = _mpDestination.a;

  _mpMission = missionDeltaV(originR, destR, _mpStopType);
  _mpFeasibility = checkFeasibility(_mpRocket, _mpMission);

  _updateBriefing();
  _drawTransferArc();
}

// ═══════════════════════════════════════════════
//  UI BUILDING
// ═══════════════════════════════════════════════

function _buildPlanUI() {
  // Rocket selector
  const rocketGrid = document.getElementById('mp-rocket-grid');
  if (rocketGrid) {
    rocketGrid.innerHTML = ROCKET_CATALOG.map(r => `
      <div class="mp-rocket-card ${r.id === _mpRocket?.id ? 'selected' : ''}" data-rocket="${r.id}">
        <div class="mp-rocket-name">${r.name}</div>
        <div class="mp-rocket-company">${r.company}</div>
        <div class="mp-rocket-stats">
          <span>\u0394v ${r.deltaV_max} km/s</span>
          <span>LEO ${(r.payload_LEO/1000).toFixed(0)}t</span>
        </div>
      </div>
    `).join('');

    rocketGrid.querySelectorAll('.mp-rocket-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.rocket;
        _mpRocket = ROCKET_CATALOG.find(r => r.id === id);
        rocketGrid.querySelectorAll('.mp-rocket-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        _computeMission();
      });
    });
  }

  // Destination selector
  const destGrid = document.getElementById('mp-dest-grid');
  if (destGrid) {
    destGrid.innerHTML = DESTINATION_BODIES.map(d => `
      <div class="mp-dest-card ${d.name === _mpDestination?.name ? 'selected' : ''}" data-dest="${d.name}">
        <div class="mp-dest-name" style="color:${d.color}">${d.name}</div>
        <div class="mp-dest-info">\u0394v ${d.dv_from_earth} km/s \u00B7 ${formatDuration(d.transferDays)}</div>
      </div>
    `).join('');

    destGrid.querySelectorAll('.mp-dest-card').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.dataset.dest;
        _mpDestination = DESTINATION_BODIES.find(d => d.name === name);
        destGrid.querySelectorAll('.mp-dest-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        _computeMission();
      });
    });
  }

  // Stop type selector
  const stopBtns = document.querySelectorAll('.mp-stop-btn');
  stopBtns.forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.stop === _mpStopType);
    btn.addEventListener('click', () => {
      _mpStopType = btn.dataset.stop;
      stopBtns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      _computeMission();
    });
  });

  // Templates
  const templateGrid = document.getElementById('mp-templates');
  if (templateGrid) {
    templateGrid.innerHTML = MISSION_TEMPLATES.map(t => `
      <div class="mp-template-card" data-template="${t.id}">
        <div class="mp-template-icon">${t.icon}</div>
        <div class="mp-template-name">${t.name}</div>
        <div class="mp-template-desc">${t.desc}</div>
        <div class="mp-template-facts">${t.facts.map(f => `<span>${f}</span>`).join('')}</div>
      </div>
    `).join('');

    templateGrid.querySelectorAll('.mp-template-card').forEach(card => {
      card.addEventListener('click', () => {
        const tpl = MISSION_TEMPLATES.find(t => t.id === card.dataset.template);
        if (!tpl) return;
        // Apply template
        _mpRocket = ROCKET_CATALOG.find(r => r.id === tpl.rocketId) || _mpRocket;
        _mpDestination = DESTINATION_BODIES.find(d => d.name === tpl.destination) || _mpDestination;
        _mpStopType = tpl.stopType;
        _mpStayDays = tpl.stayDays;
        // Re-render selectors
        _buildPlanUI();
        _computeMission();
      });
    });
  }

  // Approve button
  const approveBtn = document.getElementById('mp-approve-btn');
  if (approveBtn) {
    approveBtn.onclick = () => {
      if (!_mpFeasibility?.feasible) return;
      _startExecution();
    };
  }

  // Deny / re-plan button
  const denyBtn = document.getElementById('mp-deny-btn');
  if (denyBtn) {
    denyBtn.onclick = () => {
      _mpPhase = 'plan';
      _mpProgress = 0;
      _mpPlaying = false;
      _showPlanPanel();
    };
  }
}

function _updateBriefing() {
  const briefEl = document.getElementById('mp-briefing');
  if (!briefEl || !_mpMission || !_mpFeasibility) return;

  const m = _mpMission;
  const f = _mpFeasibility;
  const dest = _mpDestination;
  const rocket = _mpRocket;

  const statusClass = f.feasible ? 'mp-feasible' : 'mp-infeasible';
  const statusText = f.feasible ? 'MISSION FEASIBLE' : 'INSUFFICIENT \u0394V';
  const marginText = f.feasible
    ? `+${f.margin.toFixed(1)} km/s margin (${f.marginPct.toFixed(0)}%)`
    : `${f.margin.toFixed(1)} km/s deficit`;

  briefEl.innerHTML = `
    <div class="mp-brief-status ${statusClass}">${statusText}</div>
    <div class="mp-brief-grid">
      <div class="mp-brief-row"><span>Rocket</span><span>${rocket.name}</span></div>
      <div class="mp-brief-row"><span>Destination</span><span style="color:${dest.color}">${dest.name}</span></div>
      <div class="mp-brief-row"><span>Mission Type</span><span>${_mpStopType.toUpperCase()}</span></div>
      <div class="mp-brief-row"><span>Transfer Time</span><span>${formatDuration(m.transferDays)}</span></div>
      <div class="mp-brief-row"><span>Earth Escape \u0394v</span><span>${m.escapeDV.toFixed(1)} km/s</span></div>
      <div class="mp-brief-row"><span>Arrival \u0394v</span><span>${m.arrivalDV.toFixed(1)} km/s</span></div>
      <div class="mp-brief-row mp-brief-total"><span>Total \u0394v Required</span><span>${m.totalDV.toFixed(1)} km/s</span></div>
      <div class="mp-brief-row"><span>Available \u0394v</span><span>${f.dvAvailable.toFixed(1)} km/s</span></div>
      <div class="mp-brief-row ${statusClass}"><span>Margin</span><span>${marginText}</span></div>
    </div>
  `;

  // Update approve button state
  const approveBtn = document.getElementById('mp-approve-btn');
  if (approveBtn) {
    approveBtn.disabled = !f.feasible;
    approveBtn.textContent = f.feasible ? '\u2713 APPROVE MISSION' : '\u2717 NOT FEASIBLE';
  }
}

// ═══════════════════════════════════════════════
//  EXECUTION
// ═══════════════════════════════════════════════

function _showPlanPanel() {
  const planPanel = document.getElementById('mp-plan-panel');
  const execPanel = document.getElementById('mp-exec-panel');
  if (planPanel) planPanel.style.display = '';
  if (execPanel) execPanel.style.display = 'none';
}

function _showExecPanel() {
  const planPanel = document.getElementById('mp-plan-panel');
  const execPanel = document.getElementById('mp-exec-panel');
  if (planPanel) planPanel.style.display = 'none';
  if (execPanel) execPanel.style.display = '';
}

function _startExecution() {
  _mpPhase = 'execute';
  _mpProgress = 0;
  _mpPlaying = true;
  _mpSpeed = 1;
  _mpLastT = 0;
  _showExecPanel();

  if (_mpShipMesh) _mpShipMesh.visible = true;
  _updateExecution();
}

function _updateExecution() {
  if (!_mpMission || !_mpDestination) return;

  const VISUAL_SCALE = 3;
  const originR = 1.0;
  const destR = _mpDestination.a;

  // Ship position
  const pos = transferPosition(originR, destR, _mpProgress);
  if (_mpShipMesh) {
    _mpShipMesh.position.set(pos.x * VISUAL_SCALE, 0.15, pos.z * VISUAL_SCALE);
    _mpShipMesh.visible = true;
  }

  // Update telemetry
  const elapsed = _mpMission.transferDays * _mpProgress;
  const remaining = _mpMission.transferDays - elapsed;
  const distFromSun = Math.sqrt(pos.x * pos.x + pos.z * pos.z);

  const tElapsed = document.getElementById('mp-t-elapsed');
  const tRemaining = document.getElementById('mp-t-remaining');
  const tProgress = document.getElementById('mp-t-progress');
  const tDist = document.getElementById('mp-t-dist');
  const tPhase = document.getElementById('mp-t-phase');

  if (tElapsed) tElapsed.textContent = formatDuration(elapsed);
  if (tRemaining) tRemaining.textContent = formatDuration(remaining);
  if (tProgress) tProgress.textContent = `${(100 * _mpProgress).toFixed(1)}%`;
  if (tDist) tDist.textContent = `${distFromSun.toFixed(2)} AU`;

  // Phase determination
  let phase = 'TRANSIT';
  if (_mpProgress < 0.02) phase = 'EARTH ESCAPE';
  else if (_mpProgress > 0.98) phase = _mpStopType === 'flyby' ? 'FLYBY' : _mpStopType === 'landing' ? 'DESCENT' : 'ORBIT INSERT';
  if (_mpProgress >= 1) phase = 'ARRIVAL';
  if (tPhase) tPhase.textContent = phase;

  // Progress bar
  const bar = document.getElementById('mp-progress-bar');
  if (bar) bar.style.width = `${_mpProgress * 100}%`;

  // Arrival state
  if (_mpProgress >= 1) {
    const arrivalEl = document.getElementById('mp-arrival');
    if (arrivalEl) arrivalEl.style.display = 'block';
  }
}

// ═══════════════════════════════════════════════
//  EVENT WIRING (called once from SceneManager)
// ═══════════════════════════════════════════════

export function initMissionPlanner() {
  // Back button
  const backBtn = document.getElementById('mp-back-btn');
  if (backBtn) backBtn.addEventListener('click', closeMissionPlanner);

  // Playback controls
  const playBtn = document.getElementById('mp-play-btn');
  const pauseBtn = document.getElementById('mp-pause-btn');
  const speedSelect = document.getElementById('mp-speed-select');
  const replanBtn = document.getElementById('mp-replan-btn');

  if (playBtn) playBtn.addEventListener('click', () => {
    _mpPlaying = true;
    if (_mpProgress >= 1) { _mpProgress = 0; }
    playBtn.classList.add('active');
    if (pauseBtn) pauseBtn.classList.remove('active');
  });

  if (pauseBtn) pauseBtn.addEventListener('click', () => {
    _mpPlaying = false;
    pauseBtn.classList.add('active');
    if (playBtn) playBtn.classList.remove('active');
  });

  if (speedSelect) speedSelect.addEventListener('change', function() {
    _mpSpeed = parseFloat(this.value) || 1;
  });

  if (replanBtn) replanBtn.addEventListener('click', () => {
    _mpPhase = 'plan';
    _mpProgress = 0;
    _mpPlaying = false;
    if (_mpShipMesh) _mpShipMesh.visible = false;
    _showPlanPanel();
    _computeMission();
    const arrivalEl = document.getElementById('mp-arrival');
    if (arrivalEl) arrivalEl.style.display = 'none';
  });
}
