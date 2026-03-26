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
// Solar system viewer
let _ssRenderer=null,_ssScene=null,_ssCam=null;
let _ssCamAngle=0,_ssPlanets=[];

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
  setTimeout(() => { _initEarthViewer(); _initMarsViewer(); _initSolarSystemViewer(); _initGallery(); _initSnowfall(); }, 60);
  requestAnimationFrame(t => { _ehLastT=t; _mhLastT=t; _ehAnimate(t); });
}

export function closeLaunchHistory() {
  _launchHistoryActive = false;
  _stopGallery();
  // Clean up orbit labels
  _ehOrbits.forEach(o => { if (o.label && o.label.parentElement) o.label.parentElement.removeChild(o.label); });
  _ehOrbits = []; _ehLaunches = [];
  _mhOrbits.forEach(o => { if (o.label && o.label.parentElement) o.label.parentElement.removeChild(o.label); });
  _mhOrbits = []; _mhLanders = [];
  if (_ehRenderer) { _ehRenderer.dispose(); _ehRenderer = null; }
  if (_mhRenderer) { _mhRenderer.dispose(); _mhRenderer = null; }
  _ssPlanets.forEach(p => { if (p.label && p.label.parentElement) p.label.parentElement.removeChild(p.label); });
  _ssPlanets = [];
  if (_ssRenderer) { _ssRenderer.dispose(); _ssRenderer = null; }
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
  _renderHighlights(data);
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

// ─── Highlights (Defining Moments) — Curated ───────────────────
const DEFINING_MOMENTS = [
  'sputnik1', 'vostok1', 'friendship7', 'voskhod2', 'apollo11', 'apollo13',
  'skylab1', 'sts1', 'hubble', 'iss_exp1', 'spirit', 'spaceshipone',
  'falcon1f4', 'dragoncrs1', 'curiosity', 'rosetta', 'newhorizons',
  'orbcomm2', 'falconheavy', 'crewdragon', 'jwst', 'artemis1',
  'starshipift1', 'polaris_dawn', 'starshipift5',
  'sx_blueghost', 'cn_tianwen2', 'bo_ng_escapade',
];

function _renderHighlights(data) {
  const el = document.getElementById('lh-highlights');
  if (!el || data.length === 0) { if (el) el.innerHTML = ''; return; }

  // Build a lookup from data
  const byId = {};
  data.forEach(m => { byId[m.id] = m; });

  // Pick curated defining moments that exist in filtered data
  let picks = DEFINING_MOMENTS.map(id => byId[id]).filter(Boolean);
  // If filter removes all curated picks, fall back to missions with firsts
  if (picks.length === 0) {
    picks = [...data].filter(m => m.firsts && m.firsts.length > 0)
      .sort((a, b) => b.firsts.length - a.firsts.length).slice(0, 6);
  }
  // Limit to 6 displayed
  picks = picks.slice(0, 6);

  let html = '';
  picks.forEach(m => {
    const year = m.date.slice(0, 4);
    const desc = _truncate(m.desc, 80);
    const firstTag = (m.firsts && m.firsts.length > 0) ? m.firsts[0] : '';
    const allFirsts = (m.firsts || []).map(f => `<div>\u2605 ${f}</div>`).join('');
    html += `<div class="lh-highlight-card" data-mission="${m.name}">` +
      `<div class="lh-highlight-year">${year}</div>` +
      `<div class="lh-highlight-name">${m.name}</div>` +
      `<div class="lh-highlight-desc">${desc}</div>` +
      (firstTag ? `<div class="lh-highlight-first">\u2605 ${firstTag}</div>` : '') +
      `<div class="lh-highlight-expand">` +
        `<div class="lh-highlight-expand-desc">${m.desc || ''}</div>` +
        `<div class="lh-highlight-expand-stats">` +
          `<div>Rocket: <span>${m.rocket || '\u2014'}</span></div>` +
          `<div>Mass: <span>${_fmtMass(m.mass || 0)}</span></div>` +
          `<div>Dest: <span>${m.destination || '\u2014'}</span></div>` +
        `</div>` +
        (allFirsts ? `<div style="margin-top:8px;font-size:11px;color:#fb4">${allFirsts}</div>` : '') +
      `</div>` +
      `</div>`;
  });
  el.innerHTML = html;
}

// ─── Company Comparison Grid ─────────────────────────────────────
function _renderCompanyGrid(data) {
  const el = document.getElementById('lh-company-grid');
  if (!el) return;

  const orgs = {};
  const orgMissions = {};
  data.forEach(m => {
    if (!orgs[m.org]) { orgs[m.org] = { launches: 0, success: 0, failed: 0, mass: 0, firsts: [], rockets: new Set(), years: [] }; orgMissions[m.org] = []; }
    const o = orgs[m.org];
    o.launches++;
    if (m.status === 'success') o.success++;
    else if (m.status === 'failed') o.failed++;
    o.mass += (m.mass || 0);
    if (m.rocket) o.rockets.add(m.rocket);
    o.years.push(parseInt(m.date.slice(0, 4)));
    if (m.firsts) m.firsts.forEach(f => o.firsts.push(f));
    orgMissions[m.org].push(m);
  });

  // Sort orgs by launch count descending
  const sortedOrgs = Object.entries(orgs).sort((a, b) => b[1].launches - a[1].launches);

  let html = '';
  for (const [orgName, o] of sortedOrgs) {
    const oc = _getOC(orgName);
    const massTonnes = (o.mass / 1000).toFixed(1);
    const rate = o.launches > 0 ? Math.round((o.success / o.launches) * 100) : 0;
    const minY = Math.min(...o.years);
    const maxY = Math.max(...o.years);
    const yearRange = minY === maxY ? `${minY}` : `${minY}\u2013${maxY}`;
    const rocketList = [...o.rockets].slice(0, 4).join(', ') + (o.rockets.size > 4 ? ` +${o.rockets.size - 4}` : '');

    // Show top 5 notable missions (prefer ones with firsts, then recent)
    const notable = orgMissions[orgName]
      .sort((a, b) => (b.firsts?.length || 0) - (a.firsts?.length || 0) || b.date.localeCompare(a.date))
      .slice(0, 5);
    const missionsHtml = notable.map(m => {
      const year = m.date.slice(0, 4);
      const first = m.firsts?.length ? `<span style="color:#fb4;margin-left:6px">\u2605</span>` : '';
      return `<div class="lh-company-mission"><span style="color:rgba(0,238,255,0.4);min-width:36px">${year}</span> ${m.name}${first}</div>`;
    }).join('');
    const remainCount = orgMissions[orgName].length - 5;
    const moreNote = remainCount > 0 ? `<div class="lh-company-mission" style="color:rgba(0,238,255,0.25);font-style:italic">+ ${remainCount} more missions</div>` : '';

    html += `<div class="lh-company-card" style="border-left-color:${oc.css}" data-org="${orgName}">` +
      `<div class="lh-company-name">${orgName}</div>` +
      `<div class="lh-company-stat">Launches <span>${o.launches}</span></div>` +
      `<div class="lh-company-stat">Success Rate <span>${rate}%</span></div>` +
      `<div class="lh-company-stat">Mass to Orbit <span>${massTonnes} t</span></div>` +
      `<div class="lh-company-stat">Active <span>${yearRange}</span></div>` +
      `<div class="lh-company-stat" style="font-size:9px">Rockets <span style="font-size:9px">${rocketList}</span></div>` +
      `<div class="lh-company-expand">` +
        `<div style="font-size:8px;letter-spacing:2px;color:rgba(0,238,255,0.35);margin-bottom:6px;text-transform:uppercase">Notable Missions</div>` +
        missionsHtml + moreNote +
      `</div>` +
      `</div>`;
  }
  el.innerHTML = html;
}

// ─── Timeline by Era ─────────────────────────────────────────────
function _renderTimeline(data) {
  const el = document.getElementById('lh-timeline');
  if (!el) return;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  // Group into eras
  const eras = [
    { label: 'THE SPACE RACE', range: [1957, 1969], color: '#fb4' },
    { label: 'STATIONS & SHUTTLES', range: [1970, 1999], color: '#0ef' },
    { label: 'EXPLORATION ERA', range: [2000, 2014], color: '#4fa' },
    { label: 'COMMERCIAL REVOLUTION', range: [2015, 2022], color: '#f80' },
    { label: 'THE NEW FRONTIER', range: [2023, 2030], color: '#e4f' },
  ];

  let html = '';
  eras.forEach(era => {
    const eraMissions = sorted.filter(m => {
      const y = parseInt(m.date.slice(0, 4));
      return y >= era.range[0] && y <= era.range[1];
    });
    if (eraMissions.length === 0) return;

    const successes = eraMissions.filter(m => m.status === 'success').length;
    const totalFirsts = eraMissions.reduce((s, m) => s + (m.firsts?.length || 0), 0);

    // Pick top 5 missions with firsts for this era
    const highlights = eraMissions
      .filter(m => m.firsts && m.firsts.length > 0)
      .sort((a, b) => b.firsts.length - a.firsts.length)
      .slice(0, 5);

    html += `<div class="lh-era-card" data-era="${era.label}">` +
      `<div class="lh-era-header" style="border-left-color:${era.color}">` +
        `<div class="lh-era-title" style="color:${era.color}">${era.label}</div>` +
        `<div class="lh-era-range">${era.range[0]}\u2013${era.range[1]}</div>` +
        `<div class="lh-era-stats">` +
          `<span>${eraMissions.length} missions</span>` +
          `<span>${successes} successes</span>` +
          `<span>${totalFirsts} firsts</span>` +
        `</div>` +
        `<div class="lh-era-chevron">\u25BC</div>` +
      `</div>` +
      `<div class="lh-era-body">`;

    highlights.forEach(m => {
      const year = m.date.slice(0, 4);
      const firstTag = m.firsts[0];
      html += `<div class="lh-timeline-item">` +
        `<div class="lh-timeline-year">${year}</div>` +
        `<div class="lh-timeline-content">` +
          `<div class="lh-timeline-name">${m.name}</div>` +
          `<div class="lh-timeline-desc">${_truncate(m.desc, 100)}</div>` +
          `<div class="lh-timeline-firsts">\u2605 ${firstTag}</div>` +
        `</div></div>`;
    });

    const remaining = eraMissions.length - highlights.length;
    if (remaining > 0) {
      html += `<div class="lh-era-more" style="color:rgba(0,238,255,0.3);font-size:10px;padding:4px 0 4px 26px;font-style:italic">+ ${remaining} more missions in this era</div>`;
    }

    html += `</div></div>`;
  });
  el.innerHTML = html;

  // Hide the old "show more" button — eras handle their own expand
  const moreBtn = document.getElementById('lh-timeline-more');
  if (moreBtn) moreBtn.style.display = 'none';
}

// ─── All Missions Grid — grouped by destination ─────────────────
function _renderMissionsGrid(data) {
  const el = document.getElementById('lh-missions-grid');
  if (!el) return;

  // Group by destination type
  const groups = {};
  const groupOrder = ['LEO', 'ISS', 'GTO', 'Moon', 'Mars', 'Deep', 'Suborbital'];
  const groupLabels = { LEO: 'Low Earth Orbit', ISS: 'Space Station', GTO: 'Geostationary', Moon: 'Lunar', Mars: 'Mars', Deep: 'Deep Space', Suborbital: 'Suborbital' };

  data.forEach(m => {
    const key = m.destType || 'LEO';
    if (!groups[key]) groups[key] = [];
    groups[key].push(m);
  });

  let html = '';
  groupOrder.forEach(key => {
    const missions = groups[key];
    if (!missions || missions.length === 0) return;
    missions.sort((a, b) => b.date.localeCompare(a.date)); // newest first

    const dc = DEST_COLORS[key] || '#0ef';
    const label = groupLabels[key] || key;
    const preview = missions.slice(0, 4);
    const remainCount = missions.length - 4;

    html += `<div class="lh-dest-group" data-dest="${key}">` +
      `<div class="lh-dest-header" style="border-left-color:${dc}">` +
        `<span class="lh-dest-label" style="color:${dc}">${label}</span>` +
        `<span class="lh-dest-count">${missions.length} missions</span>` +
        `<span class="lh-dest-chevron">\u25BC</span>` +
      `</div>` +
      `<div class="lh-dest-body">`;

    preview.forEach(m => {
      const oc = _getOC(m.org);
      const year = m.date.slice(0, 4);
      html += `<div class="lh-mission-card">` +
        `<div class="lh-mission-card-header">` +
          `<div class="lh-mission-card-name">${m.name}</div>` +
          `<div class="lh-mission-card-date">${year}</div>` +
        `</div>` +
        `<span class="lh-mission-card-org" style="background:${oc.bg};border:1px solid ${oc.bd};color:${oc.css}">${m.org}</span>` +
        `<div class="lh-mission-card-desc">${_truncate(m.desc, 80)}</div>` +
      `</div>`;
    });

    if (remainCount > 0) {
      html += `<div class="lh-dest-more-missions" style="display:none">`;
      missions.slice(4).forEach(m => {
        const oc = _getOC(m.org);
        const year = m.date.slice(0, 4);
        html += `<div class="lh-mission-card">` +
          `<div class="lh-mission-card-header">` +
            `<div class="lh-mission-card-name">${m.name}</div>` +
            `<div class="lh-mission-card-date">${year}</div>` +
          `</div>` +
          `<span class="lh-mission-card-org" style="background:${oc.bg};border:1px solid ${oc.bd};color:${oc.css}">${m.org}</span>` +
          `<div class="lh-mission-card-desc">${_truncate(m.desc, 80)}</div>` +
        `</div>`;
      });
      html += `</div>`;
      html += `<button class="lh-show-more-btn lh-dest-expand-btn" data-dest="${key}">SHOW ALL ${missions.length} MISSIONS</button>`;
    }

    html += `</div></div>`;
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
  _ehScene.add(new THREE.AmbientLight(0x334466, 0.6));
  const keyLight = new THREE.DirectionalLight(0x6699ff, 1.6); keyLight.position.set(4, 3, 5); _ehScene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x8855ff, 0.8); rimLight.position.set(-4, 1, -3); _ehScene.add(rimLight);
  const topLight = new THREE.PointLight(0x00eeff, 0.7, 10); topLight.position.set(0, 3, 0); _ehScene.add(topLight);

  // Earth — real NASA texture with sci-fi overlays
  const earthTex = _mkTex(512, 256, _pTexFns.Earth);
  _ehEarth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshStandardMaterial({ map: earthTex, roughness: 0.7, metalness: 0.05 })
  );
  _ehScene.add(_ehEarth);

  // Swap in real NASA Blue Marble when loaded
  loadRealEarthTexture((tex) => {
    if (tex && _ehEarth) { _ehEarth.material.map = tex; _ehEarth.material.needsUpdate = true; }
  });

  // Wireframe overlay — faint cyan grid for sci-fi feel on top of real Earth
  const wireGeo = new THREE.SphereGeometry(1.006, 32, 24);
  const wireMat = new THREE.MeshBasicMaterial({ color: 0x00ccff, wireframe: true, transparent: true, opacity: 0.06 });
  _ehEarth.add(new THREE.Mesh(wireGeo, wireMat));

  // Latitude rings (equator, tropics, arctic)
  [0, 23.5, -23.5, 66.5, -66.5].forEach(lat => {
    const latRad = lat * Math.PI / 180;
    const r = Math.cos(latRad) * 1.008;
    const y = Math.sin(latRad) * 1.008;
    const ringGeo = new THREE.RingGeometry(r - 0.002, r + 0.002, 64);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x00eeff, side: THREE.DoubleSide, transparent: true, opacity: 0.08 });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = y;
    ring.rotation.x = Math.PI / 2;
    _ehEarth.add(ring);
  });

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

  // Mars — real texture with sci-fi overlays
  const marsTex = _mkTex(512, 256, _pTexFns.Mars);
  _mhMars = new THREE.Mesh(
    new THREE.SphereGeometry(1, 64, 64),
    new THREE.MeshStandardMaterial({ map: marsTex, roughness: 0.8, metalness: 0.05 })
  );
  _mhScene.add(_mhMars);

  // Swap in real NASA Mars texture when loaded
  import('./noiseUtils.js').then(m => {
    if (m.loadRealTexture) m.loadRealTexture('Mars', (tex) => {
      if (tex && _mhMars) { _mhMars.material.map = tex; _mhMars.material.needsUpdate = true; }
    });
  });

  // Faint wireframe overlay for sci-fi feel
  const mWire = new THREE.Mesh(
    new THREE.SphereGeometry(1.006, 28, 20),
    new THREE.MeshBasicMaterial({ color: 0xff6633, wireframe: true, transparent: true, opacity: 0.06 })
  );
  _mhMars.add(mWire);

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

// ─── Solar System Viewer ────────────────────────────────────────
function _initSolarSystemViewer() {
  if (_ssRenderer) return;
  const canvas = document.getElementById('solsys-canvas');
  if (!canvas) return;
  const container = canvas.parentElement;
  const w = container.clientWidth || 480, h = container.clientHeight || 300;
  _ssRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  _ssRenderer.setSize(w, h, false);
  _ssRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  _ssRenderer.setClearColor(0x030108, 1);
  canvas.style.width = '100%'; canvas.style.height = '100%';
  _ssScene = new THREE.Scene();
  _ssCam = new THREE.PerspectiveCamera(50, w / h, 0.01, 500);
  _ssCam.position.set(0, 5, 8);
  _ssCam.lookAt(0, 0, 0);

  // Lighting
  _ssScene.add(new THREE.AmbientLight(0x111122, 0.3));
  const sLight = new THREE.PointLight(0xffeedd, 1.5, 50); sLight.position.set(0, 0, 0); _ssScene.add(sLight);

  // Sun — glowing center
  const sunGeo = new THREE.SphereGeometry(0.3, 24, 24);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
  _ssScene.add(new THREE.Mesh(sunGeo, sunMat));
  // Sun glow
  const sgC = document.createElement('canvas'); sgC.width = 64; sgC.height = 64;
  const sgCtx = sgC.getContext('2d'), sgG = sgCtx.createRadialGradient(32,32,0,32,32,32);
  sgG.addColorStop(0, 'rgba(255,220,80,0.6)'); sgG.addColorStop(0.3, 'rgba(255,180,40,0.2)'); sgG.addColorStop(1, 'rgba(0,0,0,0)');
  sgCtx.fillStyle = sgG; sgCtx.fillRect(0,0,64,64);
  const sunGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(sgC), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, alphaTest: 0.01 }));
  sunGlow.scale.setScalar(1.5); _ssScene.add(sunGlow);

  // Planets
  const planetDefs = [
    { name: 'Mercury', r: 0.05, orbit: 0.7, speed: 4.1, color: 0x888877 },
    { name: 'Venus',   r: 0.08, orbit: 1.1, speed: 1.6, color: 0xddbb77 },
    { name: 'Earth',   r: 0.09, orbit: 1.5, speed: 1.0, color: 0x4488ff },
    { name: 'Mars',    r: 0.06, orbit: 2.0, speed: 0.53, color: 0xcc5522 },
    { name: 'Jupiter', r: 0.18, orbit: 3.0, speed: 0.08, color: 0xcc9966 },
    { name: 'Saturn',  r: 0.15, orbit: 4.0, speed: 0.034, color: 0xddcc88 },
    { name: 'Uranus',  r: 0.1,  orbit: 5.0, speed: 0.012, color: 0x66bbcc },
    { name: 'Neptune', r: 0.09, orbit: 5.8, speed: 0.006, color: 0x4455bb },
  ];

  _ssPlanets = [];
  planetDefs.forEach(pd => {
    // Orbit ring — neon
    const orbitGeo = new THREE.RingGeometry(pd.orbit - 0.01, pd.orbit + 0.01, 96);
    const orbitMat = new THREE.MeshBasicMaterial({ color: 0x2244aa, side: THREE.DoubleSide, transparent: true, opacity: 0.1 });
    const orbitMesh = new THREE.Mesh(orbitGeo, orbitMat);
    orbitMesh.rotation.x = Math.PI / 2;
    _ssScene.add(orbitMesh);

    // Planet sphere — glowing
    const pGeo = new THREE.SphereGeometry(pd.r, 16, 16);
    const pMat = new THREE.MeshPhongMaterial({ color: pd.color, emissive: new THREE.Color(pd.color).multiplyScalar(0.3), shininess: 30 });
    const pMesh = new THREE.Mesh(pGeo, pMat);
    _ssScene.add(pMesh);

    // Planet glow sprite
    const gc = document.createElement('canvas'); gc.width = 32; gc.height = 32;
    const gctx = gc.getContext('2d'), gg = gctx.createRadialGradient(16,16,0,16,16,16);
    const c3 = new THREE.Color(pd.color);
    gg.addColorStop(0, `rgba(${(c3.r*255)|0},${(c3.g*255)|0},${(c3.b*255)|0},0.5)`);
    gg.addColorStop(0.5, `rgba(${(c3.r*255)|0},${(c3.g*255)|0},${(c3.b*255)|0},0.1)`);
    gg.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.fillStyle = gg; gctx.fillRect(0,0,32,32);
    const gSp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, alphaTest: 0.01 }));
    gSp.scale.setScalar(pd.r * 4);
    pMesh.add(gSp);

    // Saturn rings
    if (pd.name === 'Saturn') {
      const sRingGeo = new THREE.RingGeometry(pd.r * 1.4, pd.r * 2.2, 32);
      const sRingMat = new THREE.MeshBasicMaterial({ color: 0xddcc88, side: THREE.DoubleSide, transparent: true, opacity: 0.3 });
      const sRing = new THREE.Mesh(sRingGeo, sRingMat);
      sRing.rotation.x = Math.PI * 0.45;
      pMesh.add(sRing);
    }

    // Label
    const lbl = document.createElement('div');
    lbl.style.cssText = 'position:absolute;font-family:Orbitron,sans-serif;font-size:6px;color:rgba(100,150,255,0.5);letter-spacing:1px;pointer-events:none;white-space:nowrap';
    lbl.textContent = pd.name;
    const cont = document.getElementById('solsys-canvas')?.parentElement;
    if (cont) cont.appendChild(lbl);

    _ssPlanets.push({ mesh: pMesh, orbit: pd.orbit, speed: pd.speed, angle: Math.random() * Math.PI * 2, label: lbl, name: pd.name });
  });

  // Stars
  const ssp = new Float32Array(800*3), ssc = new Float32Array(800*3);
  for (let i = 0; i < 800; i++) {
    const th = Math.random()*Math.PI*2, ph = Math.acos(2*Math.random()-1), r = 40+Math.random()*80;
    ssp[i*3] = r*Math.sin(ph)*Math.cos(th); ssp[i*3+1] = r*Math.sin(ph)*Math.sin(th); ssp[i*3+2] = r*Math.cos(ph);
    const b = 0.3+Math.random()*0.7; ssc[i*3] = b*0.8; ssc[i*3+1] = b*0.85; ssc[i*3+2] = b;
  }
  const ssGeo = new THREE.BufferGeometry();
  ssGeo.setAttribute('position', new THREE.BufferAttribute(ssp, 3));
  ssGeo.setAttribute('color', new THREE.BufferAttribute(ssc, 3));
  _ssScene.add(new THREE.Points(ssGeo, new THREE.PointsMaterial({ size: 0.3, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.7 })));

  // Trajectory lines — a couple of mission paths
  const trajDefs = [
    { from: 1.5, to: 2.0, color: 0x00eeff, label: 'Mars Mission' },   // Earth to Mars
    { from: 1.5, to: 3.0, color: 0xff8844, label: 'Jupiter Probe' },  // Earth to Jupiter
  ];
  trajDefs.forEach(td => {
    const pts = [];
    for (let i = 0; i <= 30; i++) {
      const t = i / 30;
      const r = td.from + (td.to - td.from) * t;
      const a = t * Math.PI * 0.8;
      pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(t * Math.PI) * 0.3, Math.sin(a) * r));
    }
    const tGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const tLine = new THREE.Line(tGeo, new THREE.LineBasicMaterial({ color: td.color, transparent: true, opacity: 0.25, depthWrite: false }));
    _ssScene.add(tLine);
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

  // ── Solar system animation ──
  if (_ssRenderer && _ssScene && _ssCam) {
    _ssCamAngle += dt * 0.04;
    _ssCam.position.set(Math.cos(_ssCamAngle) * 9, 4 + Math.sin(_ssCamAngle * 0.3) * 1.5, Math.sin(_ssCamAngle) * 9);
    _ssCam.lookAt(0, 0, 0);

    const ssCanvas = document.getElementById('solsys-canvas');
    _ssPlanets.forEach(p => {
      p.angle += p.speed * dt * 0.3;
      p.mesh.position.set(Math.cos(p.angle) * p.orbit, 0, Math.sin(p.angle) * p.orbit);
      p.mesh.rotation.y += dt * 0.5;

      // Project label
      if (p.label && ssCanvas) {
        const proj = p.mesh.position.clone().project(_ssCam);
        if (proj.z > 0 && proj.z < 1) {
          const rect = ssCanvas.getBoundingClientRect();
          p.label.style.left = ((proj.x+1)*0.5*rect.width) + 'px';
          p.label.style.top = ((-proj.y+1)*0.5*rect.height - 10) + 'px';
          p.label.style.display = '';
        } else { p.label.style.display = 'none'; }
      }
    });

    _ssRenderer.render(_ssScene, _ssCam);
  }
}

// ─── Rocket Photo Gallery ───────────────────────────────────────
const _GALLERY_IMAGES = [
  '/Infinita/images/astronaut.png',
];
let _galleryIdx = 0;
function _initSnowfall() {
  const container = document.getElementById('lh-snowfall');
  if (!container || container.children.length > 0) return;
  for (let i = 0; i < 160; i++) {
    const flake = document.createElement('div');
    flake.className = 'lh-snowflake';
    const size = 1 + Math.random() * 3;
    flake.style.width = size + 'px';
    flake.style.height = size + 'px';
    flake.style.left = Math.random() * 100 + '%';
    flake.style.top = Math.random() * -20 + '%';
    flake.style.setProperty('--dur', (8 + Math.random() * 12) + 's');
    flake.style.setProperty('--op', (0.15 + Math.random() * 0.25).toFixed(2));
    flake.style.setProperty('--fall', (300 + Math.random() * 500) + 'px');
    flake.style.setProperty('--sway', ((Math.random() - 0.5) * 60) + 'px');
    flake.style.animationDelay = (-Math.random() * 20) + 's';
    container.appendChild(flake);
  }
}

let _galleryInterval = null;

function _initGallery() {
  const img = document.getElementById('lh-gallery-img');
  const dotsEl = document.getElementById('lh-gallery-dots');
  if (!img || !dotsEl) return;

  // Create dots
  dotsEl.innerHTML = '';
  _GALLERY_IMAGES.forEach((_, i) => {
    const dot = document.createElement('span');
    dot.className = 'lh-gallery-dot' + (i === 0 ? ' active' : '');
    dot.addEventListener('click', () => _showGalleryImage(i));
    dotsEl.appendChild(dot);
  });

  // Show first image
  _galleryIdx = 0;
  img.src = _GALLERY_IMAGES[0];
  img.classList.add('active');

  // Auto-cycle every 5 seconds
  if (_galleryInterval) clearInterval(_galleryInterval);
  _galleryInterval = setInterval(() => {
    _showGalleryImage((_galleryIdx + 1) % _GALLERY_IMAGES.length);
  }, 5000);
}

function _showGalleryImage(idx) {
  const img = document.getElementById('lh-gallery-img');
  const dotsEl = document.getElementById('lh-gallery-dots');
  if (!img) return;
  _galleryIdx = idx;

  // Fade out, swap, fade in
  img.classList.remove('active');
  setTimeout(() => {
    img.src = _GALLERY_IMAGES[idx];
    img.onload = () => img.classList.add('active');
    // If already cached, trigger manually
    if (img.complete) img.classList.add('active');
  }, 400);

  // Update dots
  if (dotsEl) {
    dotsEl.querySelectorAll('.lh-gallery-dot').forEach((d, i) => d.classList.toggle('active', i === idx));
  }
}

function _stopGallery() {
  if (_galleryInterval) { clearInterval(_galleryInterval); _galleryInterval = null; }
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

  // Timeline "Show Full Timeline" button (kept for backwards compat)
  const tlMoreBtn = document.getElementById('lh-timeline-more');
  if (tlMoreBtn) {
    tlMoreBtn.addEventListener('click', () => {
      document.querySelectorAll('#lh-timeline .lh-timeline-item').forEach(item => {
        item.style.display = '';
      });
      tlMoreBtn.style.display = 'none';
    });
  }

  // Mission catalog toggle button
  const catalogBtn = document.getElementById('lh-catalog-btn');
  if (catalogBtn) {
    catalogBtn.addEventListener('click', () => {
      const grid = document.getElementById('lh-missions-grid');
      if (!grid) return;
      if (grid.style.display === 'none') {
        if (!grid.innerHTML) _renderMissionsGrid(_filteredData());
        grid.style.display = '';
        catalogBtn.textContent = 'HIDE MISSION CATALOG';
      } else {
        grid.style.display = 'none';
        catalogBtn.textContent = '\uD83D\uDE80 EXPLORE ALL MISSIONS BY DESTINATION';
      }
    });
  }

  // Highlight card expand/collapse
  const hlContainer = document.getElementById('lh-highlights');
  if (hlContainer) {
    hlContainer.addEventListener('click', (e) => {
      const card = e.target.closest('.lh-highlight-card');
      if (card) card.classList.toggle('expanded');
    });
  }

  // Company card expand/collapse
  const compGrid = document.getElementById('lh-company-grid');
  if (compGrid) {
    compGrid.addEventListener('click', (e) => {
      const card = e.target.closest('.lh-company-card');
      if (card) card.classList.toggle('expanded');
    });
  }

  // Era expand/collapse (event delegation on timeline)
  const timeline = document.getElementById('lh-timeline');
  if (timeline) {
    timeline.addEventListener('click', (e) => {
      const header = e.target.closest('.lh-era-header');
      if (header) {
        const card = header.closest('.lh-era-card');
        if (card) card.classList.toggle('collapsed');
      }
    });
  }

  // Destination group expand/collapse + "show all" buttons (event delegation on missions grid)
  const missionsGrid = document.getElementById('lh-missions-grid');
  if (missionsGrid) {
    missionsGrid.addEventListener('click', (e) => {
      // Header click — toggle collapse
      const header = e.target.closest('.lh-dest-header');
      if (header) {
        const group = header.closest('.lh-dest-group');
        if (group) group.classList.toggle('collapsed');
        return;
      }
      // "Show all" button
      const expandBtn = e.target.closest('.lh-dest-expand-btn');
      if (expandBtn) {
        const group = expandBtn.closest('.lh-dest-group');
        if (group) {
          const more = group.querySelector('.lh-dest-more-missions');
          if (more) {
            if (more.style.display === 'none') {
              more.style.display = '';
              expandBtn.textContent = 'SHOW LESS';
            } else {
              more.style.display = 'none';
              const dest = expandBtn.dataset.dest;
              expandBtn.textContent = `SHOW ALL MISSIONS`;
            }
          }
        }
      }
    });
  }

  window.addEventListener('resize',()=>{
    if (!_launchHistoryActive) return;
    // Resize all three canvases
    [
      { r: _ehRenderer, c: _ehCam, id: 'earth-canvas' },
      { r: _mhRenderer, c: _mhCam, id: 'mars-canvas' },
      { r: _ssRenderer, c: _ssCam, id: 'solsys-canvas' },
    ].forEach(({ r, c, id }) => {
      if (!r) return;
      const canvas = document.getElementById(id);
      if (!canvas) return;
      const ct = canvas.parentElement;
      const w = ct.clientWidth, h = ct.clientHeight;
      if (w && h) { r.setSize(w, h, false); c.aspect = w / h; c.updateProjectionMatrix(); }
    });
  });
}
