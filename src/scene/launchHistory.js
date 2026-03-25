import * as THREE from 'three';
import { LAUNCH_DATA, ORG_COLORS, DEST_COLORS } from '../data/launchData.js';
import { _mkTex, _sfbm, _pTexFns, loadRealEarthTexture } from './noiseUtils.js';

let _launchHistoryActive = false;
let _lhFilter            = 'All';
// Earth viewer state
let _ehRenderer=null,_ehScene=null,_ehCam=null,_ehEarth=null;
let _ehSites={};
let _ehCamAngle=0,_ehLastT=0;

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
  setTimeout(() => { _initEarthViewer(); }, 60);
  requestAnimationFrame(t => { _ehLastT=t; _ehAnimate(t); });
}

export function closeLaunchHistory() {
  _launchHistoryActive = false;
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
  const w=canvas.offsetWidth||500,h=canvas.offsetHeight||300;
  _ehRenderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
  _ehRenderer.setSize(w,h); _ehRenderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
  _ehRenderer.setClearColor(0x010208,1);
  _ehScene=new THREE.Scene();
  _ehCam=new THREE.PerspectiveCamera(40,w/h,0.01,500);
  _ehCam.position.set(0,0.6,3.6);

  // Lighting
  _ehScene.add(new THREE.AmbientLight(0x223344,0.55));
  const sunL=new THREE.DirectionalLight(0xfff5dd,1.4); sunL.position.set(6,3,5); _ehScene.add(sunL);
  const fillL=new THREE.DirectionalLight(0x334466,0.3); fillL.position.set(-5,2,-3); _ehScene.add(fillL);

  // Earth — uses the same continent-based texture as the main scene
  const earthTex = _mkTex(512, 256, _pTexFns.Earth);
  _ehEarth=new THREE.Mesh(new THREE.SphereGeometry(1,64,64),
    new THREE.MeshStandardMaterial({map:earthTex,roughness:0.7,metalness:0.05}));
  _ehScene.add(_ehEarth);

  // Swap in real NASA texture when loaded
  loadRealEarthTexture((tex) => {
    if (tex && _ehEarth) {
      _ehEarth.material.map = tex;
      _ehEarth.material.needsUpdate = true;
    }
  });

  // Cloud layer
  const cloudTex = _mkTex(256, 128, (u,v,nx,ny,nz) => {
    const n1 = _sfbm(nx*4+10,ny*4+10,nz*4+10,4);
    const n2 = _sfbm(nx*8+20,ny*8,nz*8+20,3)*0.3;
    const cloud = Math.max(0, n1+n2-0.42)*2.5;
    const c = Math.min(255,(cloud*255)|0);
    return [c,c,c];
  });
  const cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(1.015, 48, 48),
    new THREE.MeshStandardMaterial({ map: cloudTex, transparent: true, opacity: 0.4, depthWrite: false, roughness: 1, metalness: 0 })
  );
  _ehEarth.add(cloudMesh);

  // Atmosphere sprite
  const ac=document.createElement('canvas'); ac.width=128; ac.height=128;
  const ax=ac.getContext('2d'),ag=ax.createRadialGradient(64,64,44,64,64,64);
  ag.addColorStop(0,'rgba(60,140,255,0)'); ag.addColorStop(0.72,'rgba(60,140,255,0)');
  ag.addColorStop(0.86,'rgba(60,140,255,0.32)'); ag.addColorStop(1,'rgba(60,140,255,0)');
  ax.fillStyle=ag; ax.fillRect(0,0,128,128);
  const atmo=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(ac),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false}));
  atmo.scale.setScalar(2.65); _ehScene.add(atmo);

  // Stars
  const sp=new Float32Array(2000*3),sc=new Float32Array(2000*3);
  for(let i=0;i<2000;i++){
    const th=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1),r=80+Math.random()*120;
    sp[i*3]=r*Math.sin(ph)*Math.cos(th);sp[i*3+1]=r*Math.sin(ph)*Math.sin(th);sp[i*3+2]=r*Math.cos(ph);
    const b=0.5+Math.random()*0.5;sc[i*3]=b*0.9;sc[i*3+1]=b*0.95;sc[i*3+2]=b;
  }
  const sGeo=new THREE.BufferGeometry();
  sGeo.setAttribute('position',new THREE.BufferAttribute(sp,3));
  sGeo.setAttribute('color',new THREE.BufferAttribute(sc,3));
  _ehScene.add(new THREE.Points(sGeo,new THREE.PointsMaterial({size:0.4,vertexColors:true,sizeAttenuation:true,transparent:true,opacity:0.8})));

  // Site markers
  const seen=new Set();
  LAUNCH_DATA.forEach(m=>{
    const key=`${m.siteLat},${m.siteLon}`; if(seen.has(key)) return; seen.add(key);
    const pos=_latlonTo3D(m.siteLat,m.siteLon);
    const mc=document.createElement('canvas'); mc.width=32; mc.height=32;
    const mx=mc.getContext('2d'),mg=mx.createRadialGradient(16,16,0,16,16,16);
    mg.addColorStop(0,'rgba(0,238,255,1)'); mg.addColorStop(0.4,'rgba(0,238,255,0.5)'); mg.addColorStop(1,'rgba(0,238,255,0)');
    mx.fillStyle=mg; mx.fillRect(0,0,32,32);
    const mkSp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(mc),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false}));
    mkSp.scale.setScalar(0.09); mkSp.position.copy(pos).multiplyScalar(1.015);
    _ehScene.add(mkSp); _ehSites[key]={sprite:mkSp,pos:pos.clone()};
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
  _ehEarth.rotation.y+=dt*0.04;
  _ehRenderer.render(_ehScene,_ehCam);
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
      const w=canvas.offsetWidth,h=canvas.offsetHeight;
      if(w&&h){ _ehRenderer.setSize(w,h); _ehCam.aspect=w/h; _ehCam.updateProjectionMatrix(); }
    }
  });
}
