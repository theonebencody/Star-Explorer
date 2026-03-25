import * as THREE from 'three';
import { LAUNCH_DATA, ORG_COLORS, DEST_COLORS } from '../data/launchData.js';
import { _mkTex, _sfbm, _pTexFns, loadRealEarthTexture } from './noiseUtils.js';

let _launchHistoryActive = false;
let _lhFilter            = 'All';
// Earth viewer state
let _ehRenderer=null,_ehScene=null,_ehCam=null,_ehEarth=null;
let _ehSites={};
let _ehCamAngle=0,_ehLastT=0;
let _ehLaunches=[]; // animated launch trajectories
let _ehOrbits=[];   // orbiting objects
let _ehScanRing=null, _ehScanRing2=null;
// Mars viewer
let _mhRenderer=null,_mhScene=null,_mhCam=null,_mhMars=null;
let _mhCamAngle=0,_mhLastT=0;
let _mhLanders=[],_mhOrbits=[],_mhScanRing=null;

let _getStarted = () => false;

function _getOC(org){ return ORG_COLORS[org]||{css:'#8ac',bg:'rgba(136,170,204,0.1)',bd:'rgba(136,170,204,0.28)'}; }

function _filteredData() {
  return LAUNCH_DATA.filter(m => _lhFilter==='All' || m.org===_lhFilter ||
    (_lhFilter==='Roscosmos' && (m.org==='Soviet'||m.org==='Roscosmos')));
}

function _fmtMass(kg) {
  if (kg >= 1000) return (kg/1000).toFixed(1) + ' t';
  return kg + ' kg';
}

function _truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

export function openLaunchHistory() {
  _launchHistoryActive = true;
  document.getElementById('launch-history').classList.add('open');
  _renderAll();
  setTimeout(() => { _initEarthViewer(); _initMarsViewer(); }, 60);
  requestAnimationFrame(t => { _ehLastT=t; _mhLastT=t; _ehAnimate(t); });
}

export function closeLaunchHistory() {
  _launchHistoryActive = false;
  // Clean up orbit labels
  _ehOrbits.forEach(o => { if (o.label && o.label.parentElement) o.label.parentElement.removeChild(o.label); });
  _ehOrbits = []; _ehLaunches = [];
  _mhOrbits.forEach(o => { if (o.label && o.label.parentElement) o.label.parentElement.removeChild(o.label); });
  _mhOrbits = []; _mhLanders = [];
  if (_ehRenderer) { _ehRenderer.dispose(); _ehRenderer = null; }
  if (_mhRenderer) { _mhRenderer.dispose(); _mhRenderer = null; }
  document.getElementById('launch-history').classList.remove('open');
  if (!_getStarted()) {
    const sp = document.getElementById('splash');
    sp.classList.remove('hidden'); sp.style.opacity='';
  }
}

// ─── Render All Sections ─────────────────────────────────────────
function _renderAll() {
  const data = _filteredData();
  _renderStatsOverview(data);
  _renderCompanyGrid(data);
  _renderTimeline(data);
  _renderMissionsGrid(data);
}

// ─── Stats Overview ──────────────────────────────────────────────
function _renderStatsOverview(data) {
  const el = document.getElementById('lh-stats-overview');
  if (!el) return;

  const total = data.length;
  const successes = data.filter(m => m.status === 'success').length;
  const rate = total > 0 ? Math.round((successes / total) * 100) : 0;

  const totalMassKg = data.filter(m => m.status === 'success').reduce((s, m) => s + (m.mass || 0), 0);
  const totalMassTonnes = (totalMassKg / 1000).toFixed(1);

  const countries = new Set();
  data.forEach(m => countries.add(m.org));

  const years = data.map(m => parseInt(m.date.slice(0, 4)));
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const yearSpan = minYear === maxYear ? `${minYear}` : `${minYear} - ${maxYear}`;

  const totalFirsts = data.reduce((s, m) => s + (m.firsts ? m.firsts.length : 0), 0);

  el.innerHTML =
    _statCard(total, 'Total Missions') +
    _statCard(rate + '%', 'Success Rate') +
    _statCard(totalMassTonnes + ' t', 'Mass to Orbit') +
    _statCard(countries.size, 'Organizations') +
    _statCard(yearSpan, 'Year Span') +
    _statCard(totalFirsts, 'Firsts Achieved');
}

function _statCard(value, label) {
  return `<div class="lh-stat-card"><div class="lh-stat-card-value">${value}</div><div class="lh-stat-card-label">${label}</div></div>`;
}

// ─── Company Comparison Grid ─────────────────────────────────────
function _renderCompanyGrid(data) {
  const el = document.getElementById('lh-company-grid');
  if (!el) return;

  const orgs = {};
  data.forEach(m => {
    if (!orgs[m.org]) orgs[m.org] = { launches: 0, success: 0, failed: 0, mass: 0, firsts: [] };
    const o = orgs[m.org];
    o.launches++;
    if (m.status === 'success') o.success++;
    else if (m.status === 'failed') o.failed++;
    o.mass += (m.mass || 0);
    if (m.firsts && m.firsts.length > 0 && o.firsts.length === 0) {
      o.firsts.push(m.firsts[0]);
    }
  });

  let html = '';
  for (const [orgName, o] of Object.entries(orgs)) {
    const oc = _getOC(orgName);
    const massTonnes = (o.mass / 1000).toFixed(1);
    const firstNote = o.firsts.length > 0 ? o.firsts[0] : '—';
    html += `<div class="lh-company-card" style="border-left-color:${oc.css}">` +
      `<div class="lh-company-name">${orgName}</div>` +
      `<div class="lh-company-stat">Launches <span>${o.launches}</span></div>` +
      `<div class="lh-company-stat">Success / Fail <span>${o.success} / ${o.failed}</span></div>` +
      `<div class="lh-company-stat">Total Mass <span>${massTonnes} t</span></div>` +
      `<div class="lh-company-stat" style="margin-top:6px;font-size:9px;color:rgba(255,185,0,0.7);border-top:1px solid rgba(0,238,255,0.06);padding-top:6px">\u2605 ${_truncate(firstNote, 60)}</div>` +
      `</div>`;
  }
  el.innerHTML = html;
}

// ─── Key Milestones Timeline ─────────────────────────────────────
function _renderTimeline(data) {
  const el = document.getElementById('lh-timeline');
  if (!el) return;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  let html = '';
  sorted.forEach(m => {
    const year = m.date.slice(0, 4);
    const desc = _truncate(m.desc, 100);
    const firstTag = (m.firsts && m.firsts.length > 0)
      ? `<div class="lh-timeline-firsts">\u2605 ${m.firsts[0]}</div>`
      : '';
    const failClass = m.status === 'failed' ? ' failed' : '';
    html += `<div class="lh-timeline-item${failClass}">` +
      `<div class="lh-timeline-year">${year}</div>` +
      `<div class="lh-timeline-content">` +
        `<div class="lh-timeline-name">${m.name}</div>` +
        `<div class="lh-timeline-desc">${desc}</div>` +
        firstTag +
      `</div>` +
      `</div>`;
  });
  el.innerHTML = html;
}

// ─── All Missions Grid ───────────────────────────────────────────
function _renderMissionsGrid(data) {
  const el = document.getElementById('lh-missions-grid');
  if (!el) return;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  let html = '';
  sorted.forEach(m => {
    const oc = _getOC(m.org);
    const d = new Date(m.date + 'T00:00:00Z');
    const ds = d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
    const desc = _truncate(m.desc, 120);
    const mass = _fmtMass(m.mass);

    const statusLabel = m.status === 'success' ? 'SUCCESS' : m.status === 'failed' ? 'FAILED' : 'PARTIAL';
    const statusClass = m.status;

    html += `<div class="lh-mission-card">` +
      `<div class="lh-mission-card-header">` +
        `<div class="lh-mission-card-name">${m.name}</div>` +
        `<div class="lh-mission-card-date">${ds}</div>` +
      `</div>` +
      `<span class="lh-mission-card-org" style="background:${oc.bg};border:1px solid ${oc.bd};color:${oc.css}">${m.org}</span>` +
      `<span class="lh-mission-card-status ${statusClass}">${statusLabel}</span>` +
      `<div class="lh-mission-card-desc">${desc}</div>` +
      `<div class="lh-mission-card-stats">` +
        `<div>Rocket: <span>${m.rocket}</span></div>` +
        `<div>Mass: <span>${mass}</span></div>` +
        `<div>Dest: <span>${m.destination}</span></div>` +
      `</div>` +
      `</div>`;
  });
  el.innerHTML = html;
}

// ─── Earth Viewer ────────────────────────────────────────────────

function _latlonTo3D(lat,lon){
  const la=lat*Math.PI/180,lo=lon*Math.PI/180;
  return new THREE.Vector3(Math.cos(la)*Math.cos(lo),Math.sin(la),Math.cos(la)*Math.sin(lo));
}

function _initEarthViewer(){
  if(_ehRenderer) return;
  const canvas=document.getElementById('earth-canvas');
  if (!canvas) return;
  const container = canvas.parentElement;
  const w = container.clientWidth || 500;
  const h = container.clientHeight || 300;
  _ehRenderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
  _ehRenderer.setSize(w, h, false); // false = don't set CSS style, let container control it
  _ehRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  _ehRenderer.setClearColor(0x010208,1);
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  _ehScene=new THREE.Scene();
  _ehCam=new THREE.PerspectiveCamera(40,w/h,0.01,500);
  _ehCam.position.set(0,0.6,3.6);

  // Lighting — dramatic sci-fi blue/purple tones
  _ehScene.add(new THREE.AmbientLight(0x112244, 0.3));
  const keyLight = new THREE.DirectionalLight(0x4488ff, 1.2); keyLight.position.set(4, 3, 5); _ehScene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x8844ff, 0.6); rimLight.position.set(-4, 1, -3); _ehScene.add(rimLight);
  const topLight = new THREE.PointLight(0x00eeff, 0.5, 10); topLight.position.set(0, 3, 0); _ehScene.add(topLight);

  // Earth — holographic wireframe style with glowing edges
  // Solid dark base sphere
  _ehEarth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 48),
    new THREE.MeshPhongMaterial({ color: 0x050818, emissive: 0x061228, shininess: 5, transparent: true, opacity: 0.85 })
  );
  _ehScene.add(_ehEarth);

  // Wireframe overlay — glowing cyan grid lines
  const wireGeo = new THREE.SphereGeometry(1.005, 32, 24);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, wireframe: true, transparent: true, opacity: 0.12 });
  _ehEarth.add(new THREE.Mesh(wireGeo, wireMat));

  // Brighter wireframe at key latitudes (equator, tropics, arctic)
  [0, 23.5, -23.5, 66.5, -66.5].forEach(lat => {
    const latRad = lat * Math.PI / 180;
    const r = Math.cos(latRad) * 1.008;
    const y = Math.sin(latRad) * 1.008;
    const ringGeo = new THREE.RingGeometry(r - 0.002, r + 0.002, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00eeff, side: THREE.DoubleSide, transparent: true, opacity: 0.15 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    _ehEarth.add(ring);
  });

  // Continent overlay — faint additive Earth texture for sci-fi holographic feel
  const scifiTex = _mkTex(256, 128, _pTexFns.Earth);
  const continentOverlay = new THREE.Mesh(
    new THREE.SphereGeometry(1.003, 48, 48),
    new THREE.MeshBasicMaterial({ map: scifiTex, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  _ehEarth.add(continentOverlay);

  // Outer glow — multiple layers for holographic feel
  const glowColors = [
    { color: '0,200,255', alpha: 0.25, scale: 2.4 },
    { color: '100,50,255', alpha: 0.12, scale: 2.8 },
    { color: '0,255,200', alpha: 0.08, scale: 3.2 },
  ];
  glowColors.forEach(gc => {
    const ac = document.createElement('canvas'); ac.width = 128; ac.height = 128;
    const ax = ac.getContext('2d'), ag = ax.createRadialGradient(64,64,30,64,64,64);
    ag.addColorStop(0, `rgba(${gc.color},0)`);
    ag.addColorStop(0.6, `rgba(${gc.color},0)`);
    ag.addColorStop(0.8, `rgba(${gc.color},${gc.alpha})`);
    ag.addColorStop(1, `rgba(${gc.color},0)`);
    ax.fillStyle = ag; ax.fillRect(0,0,128,128);
    const atmo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(ac), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, alphaTest: 0.01 }));
    atmo.scale.setScalar(gc.scale);
    _ehScene.add(atmo);
  });

  // Scan line ring — rotating horizontal ring around Earth
  const scanGeo = new THREE.RingGeometry(1.35, 1.38, 64);
  const scanMat = new THREE.MeshBasicMaterial({ color: 0x00eeff, side: THREE.DoubleSide, transparent: true, opacity: 0.15 });
  const scanRing = new THREE.Mesh(scanGeo, scanMat);
  scanRing.rotation.x = Math.PI / 2;
  _ehScene.add(scanRing);
  _ehScanRing = scanRing;

  // Second scan ring — vertical, slower
  const scan2Geo = new THREE.RingGeometry(1.45, 1.47, 64);
  const scan2Mat = new THREE.MeshBasicMaterial({ color: 0x8844ff, side: THREE.DoubleSide, transparent: true, opacity: 0.08 });
  const scan2Ring = new THREE.Mesh(scan2Geo, scan2Mat);
  _ehScene.add(scan2Ring);
  _ehScanRing2 = scan2Ring;

  // Stars — brighter, more colorful for sci-fi
  const sp = new Float32Array(1500*3), sc2 = new Float32Array(1500*3);
  for (let i = 0; i < 1500; i++) {
    const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1), r = 60+Math.random()*140;
    sp[i*3] = r*Math.sin(ph)*Math.cos(th); sp[i*3+1] = r*Math.sin(ph)*Math.sin(th); sp[i*3+2] = r*Math.cos(ph);
    const roll = Math.random();
    if (roll < 0.3) { sc2[i*3] = 0.3; sc2[i*3+1] = 0.7; sc2[i*3+2] = 1; } // blue
    else if (roll < 0.5) { sc2[i*3] = 0.6; sc2[i*3+1] = 0.3; sc2[i*3+2] = 1; } // purple
    else { const b = 0.5+Math.random()*0.5; sc2[i*3] = b; sc2[i*3+1] = b; sc2[i*3+2] = b; } // white
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  sGeo.setAttribute('color', new THREE.BufferAttribute(sc2, 3));
  _ehScene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ size: 0.5, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9 })));

  // Site markers — pulsing neon dots
  const seen = new Set();
  LAUNCH_DATA.forEach(m => {
    const key = `${m.siteLat},${m.siteLon}`; if (seen.has(key)) return; seen.add(key);
    const pos = _latlonTo3D(m.siteLat, m.siteLon);
    const mc = document.createElement('canvas'); mc.width = 32; mc.height = 32;
    const mx = mc.getContext('2d'), mg = mx.createRadialGradient(16,16,0,16,16,16);
    mg.addColorStop(0, 'rgba(0,255,200,1)'); mg.addColorStop(0.3, 'rgba(0,255,200,0.6)'); mg.addColorStop(1, 'rgba(0,255,200,0)');
    mx.fillStyle = mg; mx.fillRect(0,0,32,32);
    const mkSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(mc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    mkSp.scale.setScalar(0.1); mkSp.position.copy(pos).multiplyScalar(1.015);
    _ehScene.add(mkSp); _ehSites[key] = { sprite: mkSp, pos: pos.clone() };
  });

  // ── Animated launch trajectories (rockets launching from sites) ──
  _ehLaunches = [];
  const launchSites = [];
  const seenSites2 = new Set();
  LAUNCH_DATA.forEach(m => {
    const key = `${m.siteLat},${m.siteLon}`;
    if (seenSites2.has(key)) return; seenSites2.add(key);
    launchSites.push({ lat: m.siteLat, lon: m.siteLon });
  });

  // Create 4 cycling launch animations
  for (let i = 0; i < 4; i++) {
    const site = launchSites[i % launchSites.length];
    const origin = _latlonTo3D(site.lat, site.lon).multiplyScalar(1.02);

    // Trajectory curve: from surface up and out
    const apex = origin.clone().multiplyScalar(2.2);
    apex.x += (Math.random() - 0.5) * 0.5;
    apex.z += (Math.random() - 0.5) * 0.5;

    const curve = new THREE.QuadraticBezierCurve3(origin, apex, apex.clone().multiplyScalar(1.3));
    const pts = curve.getPoints(40);
    const trailPos = new Float32Array(40 * 3);
    const trailCol = new Float32Array(40 * 3);
    pts.forEach((p, j) => {
      trailPos[j*3] = p.x; trailPos[j*3+1] = p.y; trailPos[j*3+2] = p.z;
      const fade = 1 - j / 40;
      // Neon cyan-to-purple trail
      trailCol[j*3] = fade * 0.2; trailCol[j*3+1] = fade * 0.9; trailCol[j*3+2] = fade;
    });
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 3));
    const trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false }));
    _ehScene.add(trail);

    // Small rocket dot at the head
    const dotC = document.createElement('canvas'); dotC.width = 16; dotC.height = 16;
    const dotCtx = dotC.getContext('2d'), dotG = dotCtx.createRadialGradient(8,8,0,8,8,8);
    dotG.addColorStop(0, 'rgba(0,255,220,1)'); dotG.addColorStop(0.4, 'rgba(0,200,255,0.6)'); dotG.addColorStop(1, 'rgba(0,100,255,0)');
    dotCtx.fillStyle = dotG; dotCtx.fillRect(0,0,16,16);
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(dotC), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    dot.scale.setScalar(0.04);
    _ehScene.add(dot);

    _ehLaunches.push({ trail, dot, pts, progress: i * 0.25, site, speed: 0.12 + Math.random() * 0.08 });
  }

  // ── Orbiting objects (ISS, Hubble, etc.) ──
  _ehOrbits = [];
  const orbitDefs = [
    { name: 'ISS', r: 1.15, speed: 0.4, color: 0xffffff, size: 0.025 },
    { name: 'Hubble', r: 1.12, speed: 0.35, color: 0xaaccff, size: 0.018 },
    { name: 'Apollo', r: 1.25, speed: 0.15, color: 0xffcc44, size: 0.02 },
    { name: 'Starship', r: 1.18, speed: 0.3, color: 0xcccccc, size: 0.022 },
    { name: 'Tiangong', r: 1.14, speed: 0.38, color: 0xff8844, size: 0.02 },
  ];
  orbitDefs.forEach((od, i) => {
    // Orbit ring
    const ringGeo = new THREE.RingGeometry(od.r - 0.002, od.r + 0.002, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: od.color, side: THREE.DoubleSide, transparent: true, opacity: 0.08 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = Math.PI / 2 + (i - 2) * 0.15; // slight inclination variety
    ring.rotation.z = i * 0.3;
    _ehScene.add(ring);

    // Object sprite
    const oc = document.createElement('canvas'); oc.width = 16; oc.height = 16;
    const octx = oc.getContext('2d'), og = octx.createRadialGradient(8,8,0,8,8,8);
    const c3 = new THREE.Color(od.color);
    og.addColorStop(0, `rgba(${(c3.r*255)|0},${(c3.g*255)|0},${(c3.b*255)|0},1)`);
    og.addColorStop(0.5, `rgba(${(c3.r*255)|0},${(c3.g*255)|0},${(c3.b*255)|0},0.4)`);
    og.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = og; octx.fillRect(0,0,16,16);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(oc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sp.scale.setScalar(od.size);
    _ehScene.add(sp);

    // Label
    const labelDiv = document.createElement('div');
    labelDiv.style.cssText = 'position:absolute;font-family:Orbitron,sans-serif;font-size:7px;color:rgba(0,238,255,0.5);letter-spacing:1px;pointer-events:none;white-space:nowrap';
    labelDiv.textContent = od.name;
    const container2 = document.getElementById('earth-canvas')?.parentElement;
    if (container2) container2.appendChild(labelDiv);

    _ehOrbits.push({ sprite: sp, ring, angle: i * 1.3, r: od.r, speed: od.speed, incX: ring.rotation.x, incZ: ring.rotation.z, label: labelDiv, name: od.name });
  });
}

// ─── Mars Viewer ────────────────────────────────────────────────
function _initMarsViewer() {
  if (_mhRenderer) return;
  const canvas = document.getElementById('mars-canvas');
  if (!canvas) return;
  const container = canvas.parentElement;
  const w = container.clientWidth || 480, h = container.clientHeight || 300;
  _mhRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  _mhRenderer.setSize(w, h, false);
  _mhRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _mhRenderer.setClearColor(0x080208, 1);
  canvas.style.width = '100%'; canvas.style.height = '100%';
  _mhScene = new THREE.Scene();
  _mhCam = new THREE.PerspectiveCamera(40, w / h, 0.01, 500);
  _mhCam.position.set(0, 0.5, 3.6);

  // Lighting — warm orange/red sci-fi
  _mhScene.add(new THREE.AmbientLight(0x221108, 0.3));
  const mKey = new THREE.DirectionalLight(0xff6633, 1.0); mKey.position.set(5, 3, 4); _mhScene.add(mKey);
  const mRim = new THREE.DirectionalLight(0xff4488, 0.4); mRim.position.set(-4, 1, -2); _mhScene.add(mRim);
  const mTop = new THREE.PointLight(0xff8844, 0.4, 10); mTop.position.set(0, 3, 0); _mhScene.add(mTop);

  // Mars — dark holographic sphere with wireframe
  _mhMars = new THREE.Mesh(
    new THREE.SphereGeometry(1, 48, 48),
    new THREE.MeshPhongMaterial({ color: 0x120808, emissive: 0x1a0a04, shininess: 5, transparent: true, opacity: 0.85 })
  );
  _mhScene.add(_mhMars);

  // Wireframe overlay — orange grid
  const mWire = new THREE.Mesh(
    new THREE.SphereGeometry(1.005, 28, 20),
    new THREE.MeshBasicMaterial({ color: 0xff6633, wireframe: true, transparent: true, opacity: 0.1 })
  );
  _mhMars.add(mWire);

  // Mars surface texture overlay (faint additive)
  const marsTex = _mkTex(256, 128, _pTexFns.Mars);
  _mhMars.add(new THREE.Mesh(
    new THREE.SphereGeometry(1.003, 48, 48),
    new THREE.MeshBasicMaterial({ map: marsTex, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false })
  ));

  // Glow halos — orange/red
  [{ col: '255,100,50', a: 0.2, s: 2.3 }, { col: '255,60,30', a: 0.1, s: 2.7 }].forEach(g => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 128;
    const ctx = c.getContext('2d'), gr = ctx.createRadialGradient(64,64,30,64,64,64);
    gr.addColorStop(0, `rgba(${g.col},0)`); gr.addColorStop(0.65, `rgba(${g.col},0)`);
    gr.addColorStop(0.82, `rgba(${g.col},${g.a})`); gr.addColorStop(1, `rgba(${g.col},0)`);
    ctx.fillStyle = gr; ctx.fillRect(0,0,128,128);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, alphaTest: 0.01 }));
    sp.scale.setScalar(g.s); _mhScene.add(sp);
  });

  // Scan ring
  const mScanGeo = new THREE.RingGeometry(1.3, 1.33, 64);
  _mhScanRing = new THREE.Mesh(mScanGeo, new THREE.MeshBasicMaterial({ color: 0xff6633, side: THREE.DoubleSide, transparent: true, opacity: 0.12 }));
  _mhScanRing.rotation.x = Math.PI / 2;
  _mhScene.add(_mhScanRing);

  // Stars
  const msp = new Float32Array(1000*3), msc = new Float32Array(1000*3);
  for (let i = 0; i < 1000; i++) {
    const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1), r = 60+Math.random()*120;
    msp[i*3] = r*Math.sin(ph)*Math.cos(th); msp[i*3+1] = r*Math.sin(ph)*Math.sin(th); msp[i*3+2] = r*Math.cos(ph);
    const b = 0.4+Math.random()*0.6; msc[i*3] = b; msc[i*3+1] = b*0.8; msc[i*3+2] = b*0.6;
  }
  const msGeo = new THREE.BufferGeometry();
  msGeo.setAttribute('position', new THREE.BufferAttribute(msp, 3));
  msGeo.setAttribute('color', new THREE.BufferAttribute(msc, 3));
  _mhScene.add(new THREE.Points(msGeo, new THREE.PointsMaterial({ size: 0.4, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.8 })));

  // Landers coming in for landing — 3 animated descent trajectories
  _mhLanders = [];
  for (let i = 0; i < 3; i++) {
    const landAngle = Math.random() * Math.PI * 2;
    const landLat = (Math.random() - 0.3) * 0.8;
    const surfacePos = new THREE.Vector3(Math.cos(landAngle) * Math.cos(landLat), Math.sin(landLat), Math.sin(landAngle) * Math.cos(landLat)).multiplyScalar(1.01);
    const startPos = surfacePos.clone().multiplyScalar(2.5 + Math.random() * 0.5);
    startPos.x += (Math.random() - 0.5) * 0.5;
    startPos.z += (Math.random() - 0.5) * 0.5;

    const ctrl = surfacePos.clone().add(startPos).multiplyScalar(0.5);
    ctrl.y += 0.3;
    const curve = new THREE.QuadraticBezierCurve3(startPos, ctrl, surfacePos);
    const pts = curve.getPoints(30);

    const tPos = new Float32Array(30*3), tCol = new Float32Array(30*3);
    pts.forEach((p, j) => {
      tPos[j*3] = p.x; tPos[j*3+1] = p.y; tPos[j*3+2] = p.z;
      const fade = j / 30;
      tCol[j*3] = fade; tCol[j*3+1] = fade * 0.4; tCol[j*3+2] = fade * 0.2;
    });
    const tGeo = new THREE.BufferGeometry();
    tGeo.setAttribute('position', new THREE.BufferAttribute(tPos, 3));
    tGeo.setAttribute('color', new THREE.BufferAttribute(tCol, 3));
    const trail = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.4, depthWrite: false }));
    _mhScene.add(trail);

    // Lander dot
    const dc = document.createElement('canvas'); dc.width = 16; dc.height = 16;
    const dctx = dc.getContext('2d'), dg = dctx.createRadialGradient(8,8,0,8,8,8);
    dg.addColorStop(0, 'rgba(255,140,40,1)'); dg.addColorStop(0.4, 'rgba(255,80,20,0.5)'); dg.addColorStop(1, 'rgba(255,40,0,0)');
    dctx.fillStyle = dg; dctx.fillRect(0,0,16,16);
    const dot = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(dc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    dot.scale.setScalar(0.04);
    _mhScene.add(dot);

    _mhLanders.push({ trail, dot, pts, progress: i * 0.35, speed: 0.08 + Math.random() * 0.06 });
  }

  // Orbiting stations/spacecraft
  _mhOrbits = [];
  const mOrbitDefs = [
    { name: 'Mars Gateway', r: 1.2, speed: 0.25, color: 0xff8844, size: 0.02 },
    { name: 'Perseverance Relay', r: 1.15, speed: 0.35, color: 0xffaa66, size: 0.018 },
    { name: 'Starship Cargo', r: 1.3, speed: 0.18, color: 0xcccccc, size: 0.022 },
  ];
  mOrbitDefs.forEach((od, i) => {
    // Orbit ring
    const rGeo = new THREE.RingGeometry(od.r - 0.002, od.r + 0.002, 64);
    const rMat = new THREE.MeshBasicMaterial({ color: od.color, side: THREE.DoubleSide, transparent: true, opacity: 0.06 });
    const ring = new THREE.Mesh(rGeo, rMat);
    ring.rotation.x = Math.PI / 2 + (i - 1) * 0.2;
    ring.rotation.z = i * 0.4;
    _mhScene.add(ring);

    // Sprite
    const oc = document.createElement('canvas'); oc.width = 16; oc.height = 16;
    const octx = oc.getContext('2d'), og = octx.createRadialGradient(8,8,0,8,8,8);
    const c3 = new THREE.Color(od.color);
    og.addColorStop(0, `rgba(${(c3.r*255)|0},${(c3.g*255)|0},${(c3.b*255)|0},1)`);
    og.addColorStop(0.5, `rgba(${(c3.r*255)|0},${(c3.g*255)|0},${(c3.b*255)|0},0.3)`);
    og.addColorStop(1, 'rgba(0,0,0,0)');
    octx.fillStyle = og; octx.fillRect(0,0,16,16);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(oc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    sp.scale.setScalar(od.size);
    _mhScene.add(sp);

    // Label
    const lbl = document.createElement('div');
    lbl.style.cssText = 'position:absolute;font-family:Orbitron,sans-serif;font-size:7px;color:rgba(255,136,68,0.5);letter-spacing:1px;pointer-events:none;white-space:nowrap';
    lbl.textContent = od.name;
    const cont = document.getElementById('mars-canvas')?.parentElement;
    if (cont) cont.appendChild(lbl);

    _mhOrbits.push({ sprite: sp, ring, angle: i * 2, r: od.r, speed: od.speed, incX: ring.rotation.x, incZ: ring.rotation.z, label: lbl });
  });
}

function _ehAnimate(now=0){
  if(!_launchHistoryActive) return;
  requestAnimationFrame(_ehAnimate);
  if(!_ehRenderer||!_ehScene||!_ehCam) return;
  const dt=Math.min((now-_ehLastT)/1000,0.1); _ehLastT=now;
  _ehCamAngle+=dt*0.07;
  const cd=3.6,ce=0.45;
  _ehCam.position.set(Math.cos(_ehCamAngle)*cd,ce,Math.sin(_ehCamAngle)*cd);
  _ehCam.lookAt(0,0,0);
  _ehEarth.rotation.y+=dt*0.06;

  // Rotate scan rings
  if (_ehScanRing) { _ehScanRing.rotation.z += dt * 0.3; _ehScanRing.material.opacity = 0.1 + 0.05 * Math.sin(now * 0.002); }
  if (_ehScanRing2) { _ehScanRing2.rotation.x += dt * 0.15; _ehScanRing2.rotation.y += dt * 0.08; }

  // Animate launch trajectories
  _ehLaunches.forEach(l => {
    l.progress += l.speed * dt;
    if (l.progress > 1.3) {
      // Reset with a new random site
      l.progress = 0;
      const sites = [];
      const seen3 = new Set();
      LAUNCH_DATA.forEach(m => {
        const k = `${m.siteLat},${m.siteLon}`;
        if (!seen3.has(k)) { seen3.add(k); sites.push({ lat: m.siteLat, lon: m.siteLon }); }
      });
      const site = sites[Math.floor(Math.random() * sites.length)];
      const origin = _latlonTo3D(site.lat, site.lon).multiplyScalar(1.02);
      const apex = origin.clone().multiplyScalar(2.2);
      apex.x += (Math.random() - 0.5) * 0.5;
      apex.z += (Math.random() - 0.5) * 0.5;
      const curve = new THREE.QuadraticBezierCurve3(origin, apex, apex.clone().multiplyScalar(1.3));
      l.pts = curve.getPoints(40);
      const p = l.trail.geometry.attributes.position.array;
      const c = l.trail.geometry.attributes.color.array;
      l.pts.forEach((pt, j) => {
        p[j*3] = pt.x; p[j*3+1] = pt.y; p[j*3+2] = pt.z;
        const fade = 1 - j / 40;
        c[j*3] = fade * 0.2; c[j*3+1] = fade * 0.9; c[j*3+2] = fade;
      });
      l.trail.geometry.attributes.position.needsUpdate = true;
      l.trail.geometry.attributes.color.needsUpdate = true;
    }
    // Draw partial trail up to current progress
    const drawCount = Math.min(40, Math.floor(l.progress * 40));
    l.trail.geometry.setDrawRange(0, Math.max(2, drawCount));
    l.trail.material.opacity = l.progress > 1 ? Math.max(0, 1 - (l.progress - 1) * 3.3) : 0.5;
    // Position dot at head
    if (drawCount > 0 && drawCount <= 40 && l.progress <= 1) {
      const pt = l.pts[Math.min(drawCount - 1, 39)];
      l.dot.position.set(pt.x, pt.y, pt.z);
      l.dot.visible = true;
    } else {
      l.dot.visible = false;
    }
  });

  // Animate orbiting objects
  const canvas = document.getElementById('earth-canvas');
  _ehOrbits.forEach(o => {
    o.angle += o.speed * dt;
    // Orbit in inclined plane
    const x = Math.cos(o.angle) * o.r;
    const z = Math.sin(o.angle) * o.r;
    // Apply inclination rotation
    const cosI = Math.cos(o.incX - Math.PI/2), sinI = Math.sin(o.incX - Math.PI/2);
    const cosZ = Math.cos(o.incZ), sinZ = Math.sin(o.incZ);
    const y2 = z * sinI;
    const z2 = z * cosI;
    const x3 = x * cosZ - y2 * sinZ;
    const y3 = x * sinZ + y2 * cosZ;
    o.sprite.position.set(x3, y3, z2);

    // Project to screen for label positioning
    if (o.label && canvas) {
      const proj = o.sprite.position.clone().project(_ehCam);
      if (proj.z > 0 && proj.z < 1) {
        const rect = canvas.getBoundingClientRect();
        const sx = (proj.x + 1) * 0.5 * rect.width;
        const sy = (-proj.y + 1) * 0.5 * rect.height;
        o.label.style.left = sx + 'px';
        o.label.style.top = (sy - 12) + 'px';
        o.label.style.display = '';
      } else {
        o.label.style.display = 'none';
      }
    }
  });

  _ehRenderer.render(_ehScene,_ehCam);

  // ── Mars viewer animation ──
  if (_mhRenderer && _mhScene && _mhCam) {
    _mhCamAngle += dt * 0.06;
    _mhCam.position.set(Math.cos(_mhCamAngle) * 3.6, 0.4, Math.sin(_mhCamAngle) * 3.6);
    _mhCam.lookAt(0, 0, 0);
    if (_mhMars) _mhMars.rotation.y += dt * 0.05;
    if (_mhScanRing) { _mhScanRing.rotation.z += dt * 0.25; _mhScanRing.material.opacity = 0.08 + 0.04 * Math.sin(now * 0.003); }

    // Landers descending
    const marsCanvas = document.getElementById('mars-canvas');
    _mhLanders.forEach(l => {
      l.progress += l.speed * dt;
      if (l.progress > 1.4) {
        l.progress = 0;
        // Regenerate trajectory
        const la = Math.random() * Math.PI * 2, ll = (Math.random()-0.3)*0.8;
        const sp2 = new THREE.Vector3(Math.cos(la)*Math.cos(ll),Math.sin(ll),Math.sin(la)*Math.cos(ll)).multiplyScalar(1.01);
        const st = sp2.clone().multiplyScalar(2.5+Math.random()*0.5);
        st.x+=(Math.random()-0.5)*0.5; st.z+=(Math.random()-0.5)*0.5;
        const ct = sp2.clone().add(st).multiplyScalar(0.5); ct.y+=0.3;
        const curve = new THREE.QuadraticBezierCurve3(st, ct, sp2);
        l.pts = curve.getPoints(30);
        const p = l.trail.geometry.attributes.position.array;
        const c = l.trail.geometry.attributes.color.array;
        l.pts.forEach((pt, j) => {
          p[j*3]=pt.x; p[j*3+1]=pt.y; p[j*3+2]=pt.z;
          const fade = j / 30;
          c[j*3]=fade; c[j*3+1]=fade*0.4; c[j*3+2]=fade*0.2;
        });
        l.trail.geometry.attributes.position.needsUpdate = true;
        l.trail.geometry.attributes.color.needsUpdate = true;
      }
      const dc = Math.min(30, Math.floor(l.progress * 30));
      l.trail.geometry.setDrawRange(0, Math.max(2, dc));
      l.trail.material.opacity = l.progress > 1 ? Math.max(0, 1-(l.progress-1)*2.5) : 0.4;
      if (dc > 0 && dc <= 30 && l.progress <= 1) {
        const pt = l.pts[Math.min(dc-1, 29)];
        l.dot.position.set(pt.x, pt.y, pt.z);
        l.dot.visible = true;
      } else { l.dot.visible = false; }
    });

    // Mars orbiting objects
    _mhOrbits.forEach(o => {
      o.angle += o.speed * dt;
      const x = Math.cos(o.angle)*o.r, z = Math.sin(o.angle)*o.r;
      const cosI=Math.cos(o.incX-Math.PI/2),sinI=Math.sin(o.incX-Math.PI/2);
      const cosZ=Math.cos(o.incZ),sinZ=Math.sin(o.incZ);
      const y2=z*sinI, z2=z*cosI, x3=x*cosZ-y2*sinZ, y3=x*sinZ+y2*cosZ;
      o.sprite.position.set(x3, y3, z2);
      if (o.label && marsCanvas) {
        const proj = o.sprite.position.clone().project(_mhCam);
        if (proj.z > 0 && proj.z < 1) {
          const rect = marsCanvas.getBoundingClientRect();
          o.label.style.left = ((proj.x+1)*0.5*rect.width) + 'px';
          o.label.style.top = ((-proj.y+1)*0.5*rect.height - 12) + 'px';
          o.label.style.display = '';
        } else { o.label.style.display = 'none'; }
      }
    });

    _mhRenderer.render(_mhScene, _mhCam);
  }
}

export function initLaunchHistory(getStarted) {
  _getStarted = getStarted;

  document.querySelectorAll('.lh-filter-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      document.querySelectorAll('.lh-filter-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active'); _lhFilter=btn.dataset.org;
      _renderAll();
    });
  });
  document.getElementById('lh-back-btn').addEventListener('click',closeLaunchHistory);

  window.addEventListener('resize',()=>{
    if(_ehRenderer&&_launchHistoryActive){
      const canvas=document.getElementById('earth-canvas');
      if (!canvas) return;
      const container=canvas.parentElement;
      const w=container.clientWidth,h=container.clientHeight;
      if(w&&h){ _ehRenderer.setSize(w,h,false); _ehCam.aspect=w/h; _ehCam.updateProjectionMatrix(); }
    }
  });
}
