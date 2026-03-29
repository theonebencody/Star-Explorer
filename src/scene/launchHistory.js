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
  if (_lhFilter === 'All') return LAUNCH_DATA;
  return LAUNCH_DATA.filter(m => {
    if (m.org === _lhFilter) return true;
    if (_lhFilter === 'Roscosmos' && m.org === 'Soviet') return true;
    if (_lhFilter === 'Soviet' && m.org === 'Roscosmos') return true;
    if (_lhFilter === 'NASA' && m.org === 'SpaceX/NASA') return true;
    if (_lhFilter === 'ESA' && m.org === 'ESA/NASA') return true;
    return false;
  });
}

function _fmtMass(kg) {
  if (kg >= 1000) return (kg/1000).toFixed(1) + ' t';
  return kg + ' kg';
}

function _truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function _videoEmbed(videoId) {
  if (!videoId) return '';
  return `<div class="lh-video-wrap"><iframe src="https://www.youtube-nocookie.com/embed/${videoId}" loading="lazy" allowfullscreen frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe></div>`;
}

function _missionCardHtml(m) {
  const oc = _getOC(m.org);
  const year = m.date.slice(0, 4);
  const hasVideo = !!m.video;
  return `<div class="lh-mission-card${hasVideo ? ' lh-mission-card-expandable' : ''}">` +
    `<div class="lh-mission-card-header">` +
      `<div class="lh-mission-card-name">${m.name}${hasVideo ? ' <span class="lh-video-icon">\u25B6</span>' : ''}</div>` +
      `<div class="lh-mission-card-date">${year}</div>` +
    `</div>` +
    `<span class="lh-mission-card-org" style="background:rgba(0,0,0,0.03);border:1px solid rgba(0,0,0,0.08);color:rgba(0,0,0,0.45)">${m.org}</span>` +
    `<div class="lh-mission-card-desc">${_truncate(m.desc, 80)}</div>` +
    (hasVideo ? `<div class="lh-mission-card-video" style="display:none">${_videoEmbed(m.video)}</div>` : '') +
  `</div>`;
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

// ─── Global Space Stats (real-world totals, source: Jonathan McDowell) ────
const GLOBAL_STATS = {
  totalAttempts: 7223,
  totalSuccess: 6822,
  totalFailures: 401,
  yearSpan: '1957 \u2013 2026',
  nations: 20,
  byNation: [
    { name: 'Soviet Union', attempts: 2449, note: '1957\u20131991' },
    { name: 'United States', attempts: 2376, note: 'NASA + commercial' },
    { name: 'Russia', attempts: 888, note: '1992\u2013present' },
    { name: 'China', attempts: 748, note: 'CASC / Long March' },
    { name: 'France / ESA', attempts: 351, note: 'Ariane, Vega' },
    { name: 'Japan', attempts: 143, note: 'JAXA' },
    { name: 'India', attempts: 101, note: 'ISRO' },
    { name: 'New Zealand', attempts: 72, note: 'Rocket Lab' },
    { name: 'Others', attempts: 95, note: 'UK, S. Korea, Israel, Iran, etc.' },
  ],
  byCompany: [
    { name: 'SpaceX', launches: 631, note: 'Falcon 9/Heavy + Starship' },
    { name: 'CASC (China)', launches: 600, note: 'Long March series' },
    { name: 'Arianespace', launches: 300, note: 'Ariane, Vega, Soyuz-FG' },
    { name: 'ULA', launches: 200, note: 'Atlas V, Delta IV, Vulcan' },
    { name: 'Rocket Lab', launches: 80, note: 'Electron' },
  ],
};

// ─── Stats Overview ──────────────────────────────────────────────
function _renderStatsOverview(data) {
  const el = document.getElementById('lh-stats-overview');
  if (!el) return;

  const isFiltered = _lhFilter !== 'All';

  if (isFiltered) {
    // Filtered view — show stats from our curated data
    const total = data.length;
    const successes = data.filter(m => m.status === 'success').length;
    const rate = total > 0 ? Math.round((successes / total) * 100) : 0;
    const totalMassKg = data.filter(m => m.status === 'success').reduce((s, m) => s + (m.mass || 0), 0);
    const totalMassTonnes = (totalMassKg / 1000).toFixed(1);
    const totalFirsts = data.reduce((s, m) => s + (m.firsts ? m.firsts.length : 0), 0);

    el.innerHTML =
      _statCard(total, 'Missions in Database') +
      _statCard(rate + '%', 'Success Rate') +
      _statCard(totalMassTonnes + ' t', 'Mass to Orbit') +
      _statCard(totalFirsts, 'Firsts Achieved');
  } else {
    // Global view — show real-world totals
    const g = GLOBAL_STATS;
    const rate = Math.round((g.totalSuccess / g.totalAttempts) * 100);

    el.innerHTML =
      _statCard(g.totalAttempts.toLocaleString(), 'Orbital Launch Attempts') +
      _statCard(g.totalSuccess.toLocaleString(), 'Successful Orbits') +
      _statCard(rate + '%', 'Success Rate') +
      _statCard(g.totalFailures.toLocaleString(), 'Failures') +
      _statCard(g.nations + '+', 'Nations') +
      _statCard(g.yearSpan, 'Since') +
      `<div class="lh-stat-source">Data: Jonathan McDowell (planet4589.org) \u00B7 ${data.length} missions detailed below</div>`;
  }
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
      .sort((a, b) => b.firsts.length - a.firsts.length).slice(0, 12);
  }

  let html = '';
  picks.forEach(m => {
    const year = m.date.slice(0, 4);
    const firstTag = (m.firsts && m.firsts.length > 0) ? m.firsts[0] : '';
    const allFirsts = (m.firsts || []).map(f => `<div class="lh-dm-first-tag">\u2605 ${f}</div>`).join('');
    html += `<div class="lh-dm-row" data-mission="${m.name}">` +
      `<div class="lh-dm-year">${year}</div>` +
      `<div class="lh-dm-main">` +
        `<div class="lh-dm-name">${m.name}</div>` +
        (firstTag ? `<div class="lh-dm-first">${firstTag}</div>` : '') +
      `</div>` +
      `<div class="lh-dm-chevron">\u25BC</div>` +
      `<div class="lh-dm-detail">` +
        _videoEmbed(m.video) +
        `<div class="lh-dm-desc">${m.desc || ''}</div>` +
        `<div class="lh-dm-stats">` +
          `<span>Rocket: <b>${m.rocket || '\u2014'}</b></span>` +
          `<span>Mass: <b>${_fmtMass(m.mass || 0)}</b></span>` +
          `<span>Dest: <b>${m.destination || '\u2014'}</b></span>` +
          `<span>Org: <b>${m.org || '\u2014'}</b></span>` +
        `</div>` +
        (allFirsts ? `<div class="lh-dm-firsts">${allFirsts}</div>` : '') +
      `</div>` +
      `</div>`;
  });
  el.innerHTML = html;
}

// ─── Company Comparison Grid (Condensed) ─────────────────────────
let _orgDataCache = {};
let _orgMissionsCache = {};

function _buildOrgData(data) {
  _orgDataCache = {};
  _orgMissionsCache = {};
  data.forEach(m => {
    if (!_orgDataCache[m.org]) {
      _orgDataCache[m.org] = { launches: 0, success: 0, failed: 0, mass: 0, firsts: [], rockets: new Set(), years: [], destinations: new Set() };
      _orgMissionsCache[m.org] = [];
    }
    const o = _orgDataCache[m.org];
    o.launches++;
    if (m.status === 'success') o.success++;
    else if (m.status === 'failed') o.failed++;
    o.mass += (m.mass || 0);
    if (m.rocket) o.rockets.add(m.rocket);
    o.years.push(parseInt(m.date.slice(0, 4)));
    if (m.destination) o.destinations.add(m.destination);
    if (m.firsts) m.firsts.forEach(f => o.firsts.push(f));
    _orgMissionsCache[m.org].push(m);
  });
}

function _renderCompanyGrid(data) {
  const el = document.getElementById('lh-company-grid');
  if (!el) return;

  _buildOrgData(data);

  // Sort orgs by launch count descending
  const sortedOrgs = Object.entries(_orgDataCache).sort((a, b) => b[1].launches - a[1].launches);

  let html = '<div class="lh-org-table">';
  // Header
  html += '<div class="lh-org-row lh-org-header-row">' +
    '<span class="lh-org-col lh-org-col-name">Organization</span>' +
    '<span class="lh-org-col lh-org-col-num">Launches</span>' +
    '<span class="lh-org-col lh-org-col-num">Rate</span>' +
    '<span class="lh-org-col lh-org-col-num">Mass</span>' +
    '<span class="lh-org-col lh-org-col-years">Active</span>' +
    '<span class="lh-org-col lh-org-col-link"></span>' +
    '</div>';

  for (const [orgName, o] of sortedOrgs) {
    const oc = _getOC(orgName);
    const massTonnes = (o.mass / 1000).toFixed(1);
    const rate = o.launches > 0 ? Math.round((o.success / o.launches) * 100) : 0;
    const minY = Math.min(...o.years);
    const maxY = Math.max(...o.years);
    const yearRange = minY === maxY ? `${minY}` : `${minY}\u2013${maxY}`;

    html += `<div class="lh-org-row" data-org="${orgName}">` +
      `<span class="lh-org-col lh-org-col-name">${orgName}</span>` +
      `<span class="lh-org-col lh-org-col-num">${o.launches}</span>` +
      `<span class="lh-org-col lh-org-col-num">${rate}%</span>` +
      `<span class="lh-org-col lh-org-col-num">${massTonnes}t</span>` +
      `<span class="lh-org-col lh-org-col-years">${yearRange}</span>` +
      `<a class="lh-org-col lh-org-col-link lh-org-detail-link" data-org="${orgName}">VIEW \u2192</a>` +
      `</div>`;
  }
  html += '</div>';
  el.innerHTML = html;
}

function _missionRowHtml(m) {
  const d = new Date(m.date + 'T00:00:00Z');
  const ds = d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
  const statusDot = m.status === 'success' ? '\u25CF' : m.status === 'failed' ? '\u25CF' : '\u25CB';
  const statusColor = m.status === 'success' ? 'rgba(0,0,0,0.5)' : m.status === 'failed' ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.4)';
  const hasDetail = m.video || (m.firsts && m.firsts.length > 0);
  return `<div class="lh-od-mission-row${hasDetail ? ' lh-od-expandable' : ''}">` +
    `<span class="lh-od-mission-status" style="color:${statusColor}">${statusDot}</span>` +
    `<span class="lh-od-mission-date">${ds}</span>` +
    `<span class="lh-od-mission-name">${m.name}${m.video ? ' <span class="lh-video-icon">\u25B6</span>' : ''}</span>` +
    `<span class="lh-od-mission-rocket">${m.rocket}</span>` +
    `<span class="lh-od-mission-dest">${m.destination || '\u2014'}</span>` +
    (hasDetail ? `<div class="lh-od-mission-detail">${_videoEmbed(m.video)}<div class="lh-od-mission-desc">${_truncate(m.desc, 200)}</div></div>` : '') +
    `</div>`;
}

// ─── Organization Detail Page ───────────────────────────────────
function _openOrgDetail(orgName) {
  const overlay = document.getElementById('lh-org-detail');
  if (!overlay) return;

  const o = _orgDataCache[orgName];
  const missions = _orgMissionsCache[orgName];
  if (!o || !missions) return;

  const oc = _getOC(orgName);
  const massTonnes = (o.mass / 1000).toFixed(1);
  const rate = o.launches > 0 ? Math.round((o.success / o.launches) * 100) : 0;
  const minY = Math.min(...o.years);
  const maxY = Math.max(...o.years);
  const yearRange = minY === maxY ? `${minY}` : `${minY}\u2013${maxY}`;
  const rocketList = [...o.rockets];
  const destList = [...o.destinations];

  // Year-by-year launch counts
  const yearCounts = {};
  o.years.forEach(y => { yearCounts[y] = (yearCounts[y] || 0) + 1; });
  const yearEntries = Object.entries(yearCounts).sort((a, b) => parseInt(a[0]) - parseInt(b[0]));
  const peakYear = yearEntries.reduce((best, e) => e[1] > best[1] ? e : best, ['', 0]);

  // Missions sorted by date (newest first)
  const sorted = [...missions].sort((a, b) => b.date.localeCompare(a.date));
  // Notable missions (with firsts)
  const notable = sorted.filter(m => m.firsts && m.firsts.length > 0);

  // Build rocket breakdown
  const rocketCounts = {};
  missions.forEach(m => { rocketCounts[m.rocket] = (rocketCounts[m.rocket] || 0) + 1; });
  const rocketEntries = Object.entries(rocketCounts).sort((a, b) => b[1] - a[1]);

  // Build bar chart for launches by year (group into 5-year bins if > 25 years)
  let barData = yearEntries;
  if (yearEntries.length > 25) {
    const bins = {};
    yearEntries.forEach(([y, c]) => {
      const bin = Math.floor(parseInt(y) / 5) * 5;
      const label = `${bin}\u2013${bin + 4}`;
      bins[label] = (bins[label] || 0) + c;
    });
    barData = Object.entries(bins).sort((a, b) => a[0].localeCompare(b[0]));
  }
  const maxCount = Math.max(...barData.map(e => e[1]), 1);
  const barHtml = barData.map(([y, c]) => {
    const pct = Math.round((c / maxCount) * 100);
    return `<div class="lh-od-bar-row"><span class="lh-od-bar-year">${y}</span><div class="lh-od-bar-track"><div class="lh-od-bar-fill" style="width:${pct}%;background:rgba(0,0,0,0.2)"></div></div><span class="lh-od-bar-val">${c}</span></div>`;
  }).join('');

  let html = `<div class="lh-od-header" style="border-bottom-color:rgba(0,0,0,0.1)">` +
    `<button class="lh-od-back" id="lh-od-back">\u2190 BACK</button>` +
    `<div class="lh-od-title" style="color:#111">${orgName}</div>` +
    `</div>`;

  html += `<div class="lh-od-body">`;

  // Stats row
  html += `<div class="lh-od-stats">` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${o.launches}</div><div class="lh-od-stat-lbl">Launches</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${rate}%</div><div class="lh-od-stat-lbl">Success Rate</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${massTonnes}t</div><div class="lh-od-stat-lbl">Mass to Orbit</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${yearRange}</div><div class="lh-od-stat-lbl">Active</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${o.firsts.length}</div><div class="lh-od-stat-lbl">Firsts</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${peakYear[0]}</div><div class="lh-od-stat-lbl">Peak Year (${peakYear[1]})</div></div>` +
    `</div>`;

  // Launches by year bar chart
  html += `<div class="lh-od-section">` +
    `<div class="lh-od-section-title">LAUNCHES BY YEAR</div>` +
    `<div class="lh-od-bars">${barHtml}</div>` +
    `</div>`;

  // Rocket fleet
  const topRockets = rocketEntries.slice(0, 10);
  const moreRockets = rocketEntries.length > 10 ? rocketEntries.length - 10 : 0;
  html += `<div class="lh-od-section">` +
    `<div class="lh-od-section-title">ROCKET FLEET</div>` +
    `<div class="lh-od-rockets">`;
  topRockets.forEach(([rocket, count]) => {
    html += `<div class="lh-od-rocket"><span class="lh-od-rocket-name">${rocket}</span><span class="lh-od-rocket-count">${count} flights</span></div>`;
  });
  if (moreRockets > 0) html += `<div class="lh-od-rocket" style="color:rgba(0,0,0,0.25);font-style:italic">+ ${moreRockets} more rocket types</div>`;
  html += `</div></div>`;

  // Destinations
  html += `<div class="lh-od-section">` +
    `<div class="lh-od-section-title">DESTINATIONS</div>` +
    `<div class="lh-od-dests">`;
  destList.forEach(d => {
    const dc = 'rgba(0,0,0,0.3)';
    const count = missions.filter(m => m.destination === d).length;
    html += `<span class="lh-od-dest" style="border-color:${dc};color:${dc}">${d} (${count})</span>`;
  });
  html += `</div></div>`;

  // Notable firsts
  if (notable.length > 0) {
    html += `<div class="lh-od-section">` +
      `<div class="lh-od-section-title">HISTORIC FIRSTS</div>`;
    notable.forEach(m => {
      const year = m.date.slice(0, 4);
      html += `<div class="lh-od-first">` +
        `<span class="lh-od-first-year">${year}</span>` +
        `<div><div class="lh-od-first-name">${m.name}</div>` +
        m.firsts.map(f => `<div class="lh-od-first-tag">\u2605 ${f}</div>`).join('') +
        `</div></div>`;
    });
    html += `</div>`;
  }

  // Full mission log (collapsible, starts collapsed, capped at 100 with load-more)
  const MISSION_LOG_LIMIT = 100;
  html += `<div class="lh-od-section">` +
    `<div class="lh-od-section-title lh-od-missions-toggle" style="cursor:pointer">ALL ${sorted.length} MISSIONS <span class="lh-od-toggle-chevron" style="transform:rotate(-90deg)">\u25BC</span></div>` +
    `<div class="lh-od-missions-list" style="max-height:0px;opacity:0">`;
  const initialBatch = sorted.slice(0, MISSION_LOG_LIMIT);
  initialBatch.forEach(m => {
    html += _missionRowHtml(m);
  });
  if (sorted.length > MISSION_LOG_LIMIT) {
    html += `<button class="lh-show-more-btn lh-od-load-more" data-org="${orgName}" data-offset="${MISSION_LOG_LIMIT}">LOAD ${Math.min(200, sorted.length - MISSION_LOG_LIMIT)} MORE OF ${sorted.length}</button>`;
  }
  html += `</div></div>`;

  html += `</div>`; // close lh-od-body

  overlay.innerHTML = html;
  overlay.classList.add('open');

  // Wire back button
  document.getElementById('lh-od-back').addEventListener('click', () => {
    overlay.classList.remove('open');
  });

  // Wire missions toggle
  const missionsToggle = overlay.querySelector('.lh-od-missions-toggle');
  if (missionsToggle) {
    const missionsList = overlay.querySelector('.lh-od-missions-list');
    const chevron = missionsToggle.querySelector('.lh-od-toggle-chevron');
    missionsToggle.addEventListener('click', () => {
      const collapsed = missionsList.style.maxHeight === '0px';
      missionsList.style.maxHeight = collapsed ? '5000px' : '0px';
      missionsList.style.opacity = collapsed ? '1' : '0';
      if (chevron) chevron.style.transform = collapsed ? '' : 'rotate(-90deg)';
    });
  }

  // Wire expandable mission rows in org detail
  overlay.addEventListener('click', (e) => {
    const row = e.target.closest('.lh-od-expandable');
    if (row) { row.classList.toggle('expanded'); return; }

    // Load-more button
    const loadMore = e.target.closest('.lh-od-load-more');
    if (loadMore) {
      const org = loadMore.dataset.org;
      const offset = parseInt(loadMore.dataset.offset) || 0;
      const missions = _orgMissionsCache[org];
      if (!missions) return;
      const sorted2 = [...missions].sort((a, b) => b.date.localeCompare(a.date));
      const nextBatch = sorted2.slice(offset, offset + 200);
      let newHtml = '';
      nextBatch.forEach(m => { newHtml += _missionRowHtml(m); });
      const nextOffset = offset + 200;
      if (nextOffset < sorted2.length) {
        newHtml += `<button class="lh-show-more-btn lh-od-load-more" data-org="${org}" data-offset="${nextOffset}">LOAD ${Math.min(200, sorted2.length - nextOffset)} MORE OF ${sorted2.length}</button>`;
      }
      loadMore.insertAdjacentHTML('beforebegin', newHtml);
      loadMore.remove();
    }
  });
}

// ─── Timeline by Era — styled as prominent clickable cards ──────
const _ERA_DEFS = [
  { label: 'THE SPACE RACE', range: [1957, 1969], color: 'rgba(0,0,0,0.3)', icon: '\u2606', desc: 'From Sputnik to Apollo \u2014 the era that launched humanity into space' },
  { label: 'STATIONS & SHUTTLES', range: [1970, 1999], color: 'rgba(0,0,0,0.3)', icon: '\u2302', desc: 'Space stations, the Shuttle program, and international cooperation' },
  { label: 'EXPLORATION ERA', range: [2000, 2014], color: 'rgba(0,0,0,0.3)', icon: '\u269B', desc: 'Mars rovers, ISS expansion, and the dawn of commercial spaceflight' },
  { label: 'COMMERCIAL REVOLUTION', range: [2015, 2022], color: 'rgba(0,0,0,0.3)', icon: '\u26A1', desc: 'Reusable rockets, mega-constellations, and record launch cadence' },
  { label: 'THE NEW FRONTIER', range: [2023, 2030], color: 'rgba(0,0,0,0.3)', icon: '\u2B50', desc: 'Starship, Artemis, lunar return, and the push to Mars' },
];

function _renderTimeline(data) {
  const el = document.getElementById('lh-timeline');
  if (!el) return;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));

  let html = '<div class="lh-era-grid">';
  _ERA_DEFS.forEach(era => {
    const eraMissions = sorted.filter(m => {
      const y = parseInt(m.date.slice(0, 4));
      return y >= era.range[0] && y <= era.range[1];
    });
    if (eraMissions.length === 0) return;

    const successes = eraMissions.filter(m => m.status === 'success').length;
    const totalFirsts = eraMissions.reduce((s, m) => s + (m.firsts?.length || 0), 0);
    const topFirst = eraMissions.filter(m => m.firsts?.length).sort((a,b) => b.firsts.length - a.firsts.length)[0];

    html += `<div class="lh-era-btn" data-era="${era.label}" style="--era-color:rgba(0,0,0,0.3)">` +
      `<div class="lh-era-btn-icon">${era.icon}</div>` +
      `<div class="lh-era-btn-title">${era.label}</div>` +
      `<div class="lh-era-btn-range">${era.range[0]} \u2013 ${era.range[1]}</div>` +
      `<div class="lh-era-btn-desc">${era.desc}</div>` +
      `<div class="lh-era-btn-stats">` +
        `<span>${eraMissions.length.toLocaleString()} launches</span>` +
        `<span>${totalFirsts} firsts</span>` +
      `</div>` +
      (topFirst ? `<div class="lh-era-btn-highlight">\u2605 ${topFirst.firsts[0]}</div>` : '') +
      `<div class="lh-era-btn-arrow">EXPLORE \u2192</div>` +
    `</div>`;
  });
  html += '</div>';
  el.innerHTML = html;

  // Hide the old "show more" button
  const moreBtn = document.getElementById('lh-timeline-more');
  if (moreBtn) moreBtn.style.display = 'none';
}

// ─── Era Detail Overlay ─────────────────────────────────────────
function _openEraDetail(eraLabel, data) {
  const era = _ERA_DEFS.find(e => e.label === eraLabel);
  if (!era) return;

  const overlay = document.getElementById('lh-org-detail');
  if (!overlay) return;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const eraMissions = sorted.filter(m => {
    const y = parseInt(m.date.slice(0, 4));
    return y >= era.range[0] && y <= era.range[1];
  });

  const successes = eraMissions.filter(m => m.status === 'success').length;
  const failures = eraMissions.filter(m => m.status === 'failed').length;
  const totalFirsts = eraMissions.reduce((s, m) => s + (m.firsts?.length || 0), 0);
  const totalMass = eraMissions.reduce((s, m) => s + (m.mass || 0), 0);
  const orgs = new Set(eraMissions.map(m => m.org));

  // Era narrative — emotionally resonant summary
  const eraNarratives = {
    'THE SPACE RACE': `In the shadow of the Cold War, two superpowers turned their gaze upward and changed the course of human history forever. What began with the haunting beep of Sputnik in 1957 became a decade-long sprint to the Moon — a contest driven by rivalry, but ultimately won by all of humanity. Yuri Gagarin felt weightlessness for the first time. John Glenn saw sunrise from orbit. And on a July night in 1969, Neil Armstrong stepped onto the lunar surface while 600 million people held their breath. In just twelve years, we went from never having left the atmosphere to walking on another world. Every mission carried the weight of a nation's pride — and the fragile hope that reaching for the stars might be the one thing that could unite us.`,

    'STATIONS & SHUTTLES': `After the Moon landings, space became a place to live. The Soviet Union built the first space stations — cramped, fragile outposts where cosmonauts endured months of isolation to prove that humans could survive long-duration spaceflight. America answered with the Space Shuttle, a revolutionary reusable spacecraft that promised routine access to orbit. For three decades, the Shuttle carried satellites, telescopes, and dreams into space — including the Hubble Space Telescope, which would rewrite our understanding of the cosmos. But this era also brought tragedy: the loss of Challenger and Columbia reminded us that the path to space is written in sacrifice. Through it all, former rivals learned to work together, building the International Space Station — a permanently inhabited laboratory orbiting 400 km above every border on Earth.`,

    'EXPLORATION ERA': `The new millennium brought robots to the surface of Mars and humans to the frontier of international cooperation. Spirit and Opportunity rolled across Martian plains, finding evidence that water once flowed on the Red Planet. The Cassini spacecraft plunged through Saturn's rings and discovered oceans beneath the ice of Enceladus. On the International Space Station, astronauts from dozens of nations lived and worked together in microgravity, conducting thousands of experiments. And quietly, in a small factory in California, a company called SpaceX was building rockets in a way no one had tried before — setting the stage for a revolution that would reshape the entire industry. This was the era when exploration became a global endeavor, and the question shifted from "can we go?" to "where should we go next?"`,

    'COMMERCIAL REVOLUTION': `Everything changed when a Falcon 9 booster landed upright on a concrete pad in December 2015. That single moment shattered the assumption that rockets were disposable — and with it, the economics of spaceflight. Launch costs plummeted. Cadence skyrocketed. SpaceX alone began launching more missions per year than most nations combined, while China emerged as a space superpower with its own station and lunar ambitions. Mega-constellations like Starlink brought internet from orbit, and commercial crews flew to the ISS for the first time. The James Webb Space Telescope unfurled its golden mirror at L2 and peered back to the first galaxies. In just seven years, spaceflight went from a government monopoly to an industry — and the old barriers between Earth and orbit began to dissolve.`,

    'THE NEW FRONTIER': `We stand at the threshold of a new chapter. Starship — the largest rocket ever built — has caught its booster mid-air in a feat of engineering that would have seemed like science fiction a decade ago. NASA's Artemis program is returning humans to the Moon for the first time in over fifty years, this time to stay. China is building a lunar research station. Private companies are landing spacecraft on the Moon's surface. The first commercial spacewalk has been completed. And somewhere in the plans of every major space agency is the same red dot: Mars. We are no longer just visitors to space — we are becoming inhabitants. The next defining moments haven't been written yet. They're waiting for us.`,
  };
  const narrative = eraNarratives[era.label] || era.desc;

  // Notable missions with firsts
  const notable = eraMissions.filter(m => m.firsts?.length).sort((a,b) => b.firsts.length - a.firsts.length);

  let html = `<div class="lh-od-header" style="border-bottom-color:rgba(0,0,0,0.1)">` +
    `<button class="lh-od-back" id="lh-od-back">\u2190 BACK</button>` +
    `<div class="lh-od-title" style="color:#111">${era.icon} ${era.label}</div>` +
    `</div><div class="lh-od-body">`;

  html += `<div class="lh-od-stats">` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${eraMissions.length.toLocaleString()}</div><div class="lh-od-stat-lbl">Launches</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${Math.round(successes/eraMissions.length*100)}%</div><div class="lh-od-stat-lbl">Success Rate</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${(totalMass/1000).toFixed(0)}t</div><div class="lh-od-stat-lbl">Mass to Orbit</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${orgs.size}</div><div class="lh-od-stat-lbl">Organizations</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${totalFirsts}</div><div class="lh-od-stat-lbl">Firsts</div></div>` +
    `<div class="lh-od-stat"><div class="lh-od-stat-val" style="color:#111">${era.range[0]}\u2013${era.range[1]}</div><div class="lh-od-stat-lbl">Years</div></div>` +
    `</div>`;

  html += `<div class="lh-od-section"><div class="lh-era-narrative">${narrative}</div></div>`;

  if (notable.length > 0) {
    html += `<div class="lh-od-section"><div class="lh-od-section-title">HISTORIC FIRSTS</div>` +
      `<div class="lh-era-firsts-grid">`;
    notable.slice(0, 20).forEach(m => {
      const year = m.date.slice(0, 4);
      const oc = _getOC(m.org);
      html += `<div class="lh-era-first-card${m.video ? ' lh-era-first-expandable' : ''}" style="border-top-color:rgba(0,0,0,0.1)">` +
        `<div class="lh-era-first-year" style="color:#111">${year}</div>` +
        `<div class="lh-era-first-name">${m.name}${m.video ? ' <span class="lh-video-icon">\u25B6</span>' : ''}</div>` +
        `<div class="lh-era-first-org" style="color:#111">${m.org}</div>` +
        m.firsts.map(f => `<div class="lh-era-first-tag">\u2605 ${f}</div>`).join('') +
        (m.video ? `<div class="lh-era-first-video" style="display:none">${_videoEmbed(m.video)}</div>` : '') +
        `</div>`;
    });
    html += `</div></div>`;
  }

  html += `</div>`;
  overlay.innerHTML = html;
  overlay.classList.add('open');

  document.getElementById('lh-od-back').addEventListener('click', () => {
    overlay.classList.remove('open');
  });

  // Wire expandable first cards with videos
  overlay.querySelectorAll('.lh-era-first-expandable').forEach(card => {
    card.addEventListener('click', () => {
      const vid = card.querySelector('.lh-era-first-video');
      if (vid) vid.style.display = vid.style.display === 'none' ? 'block' : 'none';
    });
  });
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

    const dc = 'rgba(0,0,0,0.3)';
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
      html += _missionCardHtml(m);
    });

    if (remainCount > 0) {
      // Don't pre-render all — lazy load on click
      html += `<div class="lh-dest-more-missions" style="display:none"></div>`;
      html += `<button class="lh-show-more-btn lh-dest-expand-btn" data-dest="${key}">SHOW ${Math.min(50, remainCount)} MORE OF ${missions.length}</button>`;
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
    labelDiv.style.cssText = 'position:absolute;font-family:Orbitron,sans-serif;font-size:7px;color:rgba(0,0,0,0.35);letter-spacing:1px;pointer-events:none;white-space:nowrap';
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
    lbl.style.cssText = 'position:absolute;font-family:Orbitron,sans-serif;font-size:7px;color:rgba(0,0,0,0.35);letter-spacing:1px;pointer-events:none;white-space:nowrap';
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
    lbl.style.cssText = 'position:absolute;font-family:Orbitron,sans-serif;font-size:6px;color:rgba(0,0,0,0.35);letter-spacing:1px;pointer-events:none;white-space:nowrap';
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
        catalogBtn.textContent = '\uD83D\uDE80 BROWSE MISSIONS BY DESTINATION';
      }
    });
  }

  // Defining moments row expand/collapse
  const hlContainer = document.getElementById('lh-highlights');
  if (hlContainer) {
    hlContainer.addEventListener('click', (e) => {
      const row = e.target.closest('.lh-dm-row');
      if (row) row.classList.toggle('expanded');
    });
  }

  // Organization detail links (event delegation)
  const compGrid = document.getElementById('lh-company-grid');
  if (compGrid) {
    compGrid.addEventListener('click', (e) => {
      const link = e.target.closest('.lh-org-detail-link');
      if (link) {
        e.preventDefault();
        const orgName = link.dataset.org;
        if (orgName) _openOrgDetail(orgName);
      }
    });
  }

  // Era button clicks — open era detail overlay
  const timeline = document.getElementById('lh-timeline');
  if (timeline) {
    timeline.addEventListener('click', (e) => {
      const btn = e.target.closest('.lh-era-btn');
      if (btn) {
        const eraLabel = btn.dataset.era;
        _openEraDetail(eraLabel, _filteredData());
      }
    });
  }

  // Destination group expand/collapse + "show all" + video expand (event delegation)
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
      // "Show more" button — lazy render next batch
      const expandBtn = e.target.closest('.lh-dest-expand-btn');
      if (expandBtn) {
        const group = expandBtn.closest('.lh-dest-group');
        const destKey = expandBtn.dataset.dest;
        if (group && destKey) {
          const more = group.querySelector('.lh-dest-more-missions');
          if (more) more.style.display = '';
          // Find missions for this destination from filtered data
          const allData = _filteredData();
          const destMissions = allData.filter(m => (m.destType || 'LEO') === destKey)
            .sort((a, b) => b.date.localeCompare(a.date));
          const currentCount = group.querySelectorAll('.lh-mission-card').length;
          const nextBatch = destMissions.slice(currentCount, currentCount + 50);
          if (nextBatch.length > 0 && more) {
            let batchHtml = '';
            nextBatch.forEach(m => { batchHtml += _missionCardHtml(m); });
            more.insertAdjacentHTML('beforeend', batchHtml);
          }
          const remaining = destMissions.length - currentCount - nextBatch.length;
          if (remaining > 0) {
            expandBtn.textContent = `SHOW ${Math.min(50, remaining)} MORE OF ${destMissions.length}`;
          } else {
            expandBtn.style.display = 'none';
          }
        }
        return;
      }
      // Mission card with video — toggle expand
      const card = e.target.closest('.lh-mission-card-expandable');
      if (card) {
        const videoWrap = card.querySelector('.lh-mission-card-video');
        if (videoWrap) {
          videoWrap.style.display = videoWrap.style.display === 'none' ? 'block' : 'none';
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
