import * as THREE from 'three';
import { AU, C_KMS, C_AU_S, YEAR_S, DAY_S, SCALE_LEVELS, PLANETS, MOONS, SUN_RADIUS_VIS, SUN_TEMP, STAR_DATA } from './constants.js';
import { solveKepler, getOrbitalPosition, tempToColor, spTypeToTemp } from './physics.js';
import { _hash, _sN, _sfbm, _mkTex, _pTexFns, loadRealEarthTexture, loadRealTexture } from './noiseUtils.js';
import { OBJECT_FACTS, _FACTS_ALIASES, SUGGESTIONS } from '../data/factsData.js';
import { LAUNCH_DATA, ORG_COLORS, DEST_COLORS } from '../data/launchData.js';
import { openLaunchHistory, closeLaunchHistory, initLaunchHistory } from './launchHistory.js';
import { simbadOtypeInfo, simbadDistAU, simbadMarkerRadius, queryLiveSIMBAD, COMMON_ALIASES, formatDistFromAU, titleCase } from '../data/simbad.js';
// UFO easter egg removed (intro flyby kept via CSS animation)
import { initWarp, renderWarp, hideWarp } from './warpEffect.js';
import { initComets, updateComets } from './comets.js';
import { buildRocket } from './rocketModels.js';
import { initSatellites, toggleSatellites, updateSatellites, isSatellitesVisible } from './satellites.js';
import { ensureLoaded, fetchGaiaStars, fetchNearbyGalaxies } from '../data/catalogManager.js';
import { DEEP_SKY_OBJECTS } from '../data/messierNGC.js';

export function init(container) {
'use strict';

// ═══════════════════════════════════════════════
//  MOBILE DETECTION
// ═══════════════════════════════════════════════
const isMobile = /Android|iPhone|iPad|iPod|webOS/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth < 1200);

// ═══════════════════════════════════════════════
//  THREE.JS SETUP
// ═══════════════════════════════════════════════
const renderer = new THREE.WebGLRenderer({ antialias: !isMobile, alpha: false });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
container.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);
scene.fog = new THREE.FogExp2(0x000005, 0.0008);

const camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.0001, 50000);
camera.position.set(0, 1.5, 4);

const ambientLight = new THREE.AmbientLight(0x334455, 0.7);
scene.add(ambientLight);
// Fill lights to illuminate dark sides of outer planets
const fillLight = new THREE.DirectionalLight(0x445577, 0.45);
fillLight.position.set(-5, 2, -3);
scene.add(fillLight);
const fillLight2 = new THREE.DirectionalLight(0x334466, 0.3);
fillLight2.position.set(0, -3, 5);
scene.add(fillLight2);

// ═══════════════════════════════════════════════
//  SUN
// ═══════════════════════════════════════════════
const sunGroup = new THREE.Group();
scene.add(sunGroup);

const sunGeo = new THREE.SphereGeometry(SUN_RADIUS_VIS, 64, 64);
const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4e0 });
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
sunGroup.add(sunMesh);

// Sun point light
const sunLight = new THREE.PointLight(0xfff0dd, 2.5, 200, 1);
sunGroup.add(sunLight);

// Sun glow sprites
for (let i = 0; i < 3; i++) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  const alpha = [0.3, 0.15, 0.06][i];
  const col = ['255,244,200', '255,200,100', '255,150,50'][i];
  grad.addColorStop(0, `rgba(${col},${alpha})`);
  grad.addColorStop(0.5, `rgba(${col},${alpha * 0.3})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.setScalar([0.8, 1.5, 3.0][i]);
  sunGroup.add(sprite);
}

// ═══════════════════════════════════════════════
//  PLANETS
// ═══════════════════════════════════════════════
const planetMeshes = [];
const orbitLines = [];
const bodyPositions = [{ name: 'Sun', pos: new THREE.Vector3(), radius: SUN_RADIUS_VIS, rReal: 696340, temp: SUN_TEMP }];

PLANETS.forEach(p => {
  // Planet mesh
  const geo = new THREE.SphereGeometry(p.rVis, 32, 32);
  const mat = new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: 0.7,
    metalness: 0.1,
    emissive: new THREE.Color(p.color).multiplyScalar(p.a > 5 ? 0.12 : 0.05)
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  // Saturn rings
  if (p.rings) {
    const ringGeo = new THREE.RingGeometry(p.rVis * 1.4, p.rVis * 2.4, 64);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd4b896, side: THREE.DoubleSide, transparent: true, opacity: 0.5
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI * 0.45;
    mesh.add(ringMesh);
  }

  planetMeshes.push({ mesh, data: p });
  bodyPositions.push({ name: p.name, pos: mesh.position, radius: p.rVis, rReal: p.rReal });

  // Orbit line
  const pts = [];
  for (let i = 0; i <= 256; i++) {
    const t = (i / 256) * p.T;
    pts.push(getOrbitalPosition(p, t));
  }
  const orbitGeo = new THREE.BufferGeometry().setFromPoints(pts);
  const orbitMat = new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.5 });
  const orbitLine = new THREE.Line(orbitGeo, orbitMat);
  scene.add(orbitLine);
  orbitLines.push(orbitLine);
});

// ═══════════════════════════════════════════════
//  MOONS
// ═══════════════════════════════════════════════
const moonMeshes = []; // { mesh, data, parentMesh, orbitR, angle }
MOONS.forEach(m => {
  const parentPM = planetMeshes.find(p => p.data.name === m.parent);
  if (!parentPM) return;
  const pVis = parentPM.data.rVis;
  // Moon visual radius: proportional to real size relative to parent, but with a minimum
  const moonRVis = Math.max(0.0015, pVis * Math.min(0.35, m.rReal / parentPM.data.rReal));
  const orbitR = pVis * m.orbitMult;
  const geo = new THREE.SphereGeometry(moonRVis, 16, 16);
  const mat = new THREE.MeshStandardMaterial({ color: m.color, roughness: 0.8, metalness: 0.05 });
  const mesh = new THREE.Mesh(geo, mat);
  // Start at random orbital position
  const startAngle = Math.random() * Math.PI * 2;
  mesh.position.set(Math.cos(startAngle) * orbitR, 0, Math.sin(startAngle) * orbitR);
  parentPM.mesh.add(mesh);
  // Trailing orbit line — ring buffer of recent positions
  const TRAIL_LEN = 80;
  const trailPositions = new Float32Array(TRAIL_LEN * 3);
  const trailColors = new Float32Array(TRAIL_LEN * 3);
  // Pre-fill trail with current position
  for (let ti = 0; ti < TRAIL_LEN; ti++) {
    trailPositions[ti * 3] = mesh.position.x;
    trailPositions[ti * 3 + 1] = mesh.position.y;
    trailPositions[ti * 3 + 2] = mesh.position.z;
    const fade = ti / TRAIL_LEN;
    trailColors[ti * 3] = 1; trailColors[ti * 3 + 1] = 1; trailColors[ti * 3 + 2] = 1;
  }
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
  trailGeo.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
  const trailLine = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.3, depthWrite: false
  }));
  parentPM.mesh.add(trailLine);

  moonMeshes.push({ mesh, data: m, parentMesh: parentPM.mesh, orbitR, angle: startAngle, moonRVis, trailPositions, trailColors, trailGeo, trailHead: 0, TRAIL_LEN });
  bodyPositions.push({ name: m.name, pos: mesh.position, radius: moonRVis, rReal: m.rReal });
});

// Load real Moon texture
loadRealTexture('Moon', (tex) => {
  if (!tex) return;
  const moonEntry = moonMeshes.find(m => m.data.name === 'Moon');
  if (moonEntry) { moonEntry.mesh.material.map = tex; moonEntry.mesh.material.needsUpdate = true; }
});

// ═══════════════════════════════════════════════
//  ASTEROID BELT
// ═══════════════════════════════════════════════
const asteroidCount = isMobile ? 800 : 2000;
const asteroidPositions = new Float32Array(asteroidCount * 3);
const asteroidColors = new Float32Array(asteroidCount * 3);
const asteroidSizes = new Float32Array(asteroidCount);
for (let i = 0; i < asteroidCount; i++) {
  const a = 2.2 + Math.random() * 1.2; // 2.2 - 3.4 AU
  const angle = Math.random() * Math.PI * 2;
  const y = (Math.random() - 0.5) * 0.15;
  asteroidPositions[i * 3] = Math.cos(angle) * a;
  asteroidPositions[i * 3 + 1] = y;
  asteroidPositions[i * 3 + 2] = Math.sin(angle) * a;
  // Color variation: brownish to grayish
  const shade = 0.35 + Math.random() * 0.3;
  asteroidColors[i * 3] = shade * (0.9 + Math.random() * 0.2);
  asteroidColors[i * 3 + 1] = shade * (0.8 + Math.random() * 0.15);
  asteroidColors[i * 3 + 2] = shade * (0.65 + Math.random() * 0.15);
  asteroidSizes[i] = 0.004 + Math.random() * 0.01;
}
// Round asteroid sprite texture
const _astC = document.createElement('canvas'); _astC.width = 32; _astC.height = 32;
const _astCtx = _astC.getContext('2d');
const _astG = _astCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
_astG.addColorStop(0, 'rgba(255,255,255,1)');
_astG.addColorStop(0.4, 'rgba(255,255,255,0.8)');
_astG.addColorStop(0.7, 'rgba(200,200,200,0.3)');
_astG.addColorStop(1, 'rgba(0,0,0,0)');
_astCtx.fillStyle = _astG; _astCtx.fillRect(0, 0, 32, 32);
const asteroidTex = new THREE.CanvasTexture(_astC);

const asteroidGeo = new THREE.BufferGeometry();
asteroidGeo.setAttribute('position', new THREE.BufferAttribute(asteroidPositions, 3));
asteroidGeo.setAttribute('color', new THREE.BufferAttribute(asteroidColors, 3));
asteroidGeo.setAttribute('size', new THREE.BufferAttribute(asteroidSizes, 1));
const asteroidMat = new THREE.PointsMaterial({
  map: asteroidTex, vertexColors: true, size: 0.008, sizeAttenuation: true,
  transparent: true, depthWrite: false, alphaTest: 0.01
});
scene.add(new THREE.Points(asteroidGeo, asteroidMat));

// ═══════════════════════════════════════════════
//  GRAPHICS ENHANCEMENT: Noise, Textures, Atmosphere, Comets
// ═══════════════════════════════════════════════

// Noise utilities, textures, planet texture functions imported from noiseUtils.js

// --- Sun granulation texture ---
(()=>{
  const tex=_mkTex(256,128,(u,v,nx,ny,nz)=>{
    const n=_sfbm(nx*6,ny*6,nz*6,4);
    const cell=n>0.54?1:0.72+n*0.52;
    const spotLat=Math.abs(ny)<0.38,spotN=_sfbm(nx*2+7,ny*2,nz*2,2);
    const spot=spotLat&&spotN>0.62?0.68:1;
    const b=cell*spot;
    return [255,(185+b*70)|0,(85+b*55)|0];
  });
  sunMat.map=tex; sunMat.needsUpdate=true;
})();

// Extra outer corona glow layers
[5.5,10.0].forEach((sc,i)=>{
  const cc=document.createElement('canvas'); cc.width=128; cc.height=128;
  const cctx=cc.getContext('2d');
  const cg=cctx.createRadialGradient(64,64,0,64,64,64);
  const cols=['255,110,10','255,70,0'],alphas=[0.045,0.022];
  cg.addColorStop(0,`rgba(${cols[i]},${alphas[i]})`);
  cg.addColorStop(0.45,`rgba(${cols[i]},${alphas[i]*0.35})`);
  cg.addColorStop(1,'rgba(0,0,0,0)');
  cctx.fillStyle=cg; cctx.fillRect(0,0,128,128);
  const sm=new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cc),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false});
  const ss=new THREE.Sprite(sm); ss.scale.setScalar(sc); sunGroup.add(ss);
});

// _pTexFns imported from noiseUtils.js

// Deferred texture application (one per frame to avoid jank)
const _texQueue=[...planetMeshes];
function _applyNextTex(){
  if(!_texQueue.length) return;
  const {mesh,data}=_texQueue.shift();
  const fn=_pTexFns[data.name];
  if(fn){
    const big=data.name==='Earth'||data.name==='Jupiter'||data.name==='Mars';
    const tex=_mkTex(big?512:256,big?256:128,fn);
    mesh.material.map=tex; mesh.material.needsUpdate=true;
  }
  requestAnimationFrame(_applyNextTex);
}
requestAnimationFrame(_applyNextTex);

// Load real NASA/SSS textures for all planets and swap when ready
['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune'].forEach(name => {
  loadRealTexture(name, (tex) => {
    if (!tex) return;
    const pm = planetMeshes.find(p => p.data.name === name);
    if (pm) { pm.mesh.material.map = tex; pm.mesh.material.needsUpdate = true; }
  });
});

// Load real Sun texture
loadRealTexture('Sun', (tex) => {
  if (!tex) return;
  sunMat.map = tex; sunMat.needsUpdate = true;
});

// Load real Saturn ring texture
loadRealTexture('SaturnRing', (tex) => {
  if (!tex) return;
  const saturn = planetMeshes.find(p => p.data.name === 'Saturn');
  if (saturn) {
    saturn.mesh.children.forEach(c => {
      if (c.isMesh && c !== saturn.mesh) { c.material.map = tex; c.material.needsUpdate = true; }
    });
  }
});

// --- Atmosphere sprites ---
const _atmoC={Earth:[100,160,255,0.18],Mars:[200,128,75,0.14],Venus:[220,188,78,0.24],
               Neptune:[58,78,200,0.16],Uranus:[78,208,208,0.14],Jupiter:[200,178,138,0.10]};
planetMeshes.forEach(({mesh,data})=>{
  const ac=_atmoC[data.name]; if(!ac) return;
  const [ar,ag,ab,aa]=ac;
  const ac2=document.createElement('canvas'); ac2.width=128; ac2.height=128;
  const ag2=ac2.getContext('2d');
  const gr=ag2.createRadialGradient(64,64,28,64,64,64);
  gr.addColorStop(0,`rgba(${ar},${ag},${ab},0)`);
  gr.addColorStop(0.62,`rgba(${ar},${ag},${ab},0)`);
  gr.addColorStop(0.80,`rgba(${ar},${ag},${ab},${aa})`);
  gr.addColorStop(1,`rgba(${ar},${ag},${ab},0)`);
  ag2.fillStyle=gr; ag2.fillRect(0,0,128,128);
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(ac2),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false}));
  sp.scale.setScalar(data.rVis*3.4); mesh.add(sp);
});

// --- Earth cloud layer ---
(()=>{
  const earth=planetMeshes.find(p=>p.data.name==='Earth');
  if(!earth) return;
  const cloudTex=_mkTex(256,128,(u,v,nx,ny,nz)=>{
    const n1=_sfbm(nx*4+10,ny*4+10,nz*4+10,4);
    const n2=_sfbm(nx*8+20,ny*8,nz*8+20,3)*0.3;
    const cloud=Math.max(0,n1+n2-0.42)*2.5;
    const c=Math.min(255,(cloud*255)|0);
    return [c,c,c];
  });
  const cloudGeo=new THREE.SphereGeometry(earth.data.rVis*1.015,32,32);
  const cloudMat=new THREE.MeshStandardMaterial({map:cloudTex,transparent:true,opacity:0.45,depthWrite:false,roughness:1,metalness:0});
  const cloudMesh=new THREE.Mesh(cloudGeo,cloudMat);
  cloudMesh.userData._cloudSpin=true;
  earth.mesh.add(cloudMesh);
})();

// --- Enhanced Saturn rings (custom geo with Cassini division) ---
(()=>{
  const sat=planetMeshes.find(p=>p.data.name==='Saturn');
  if(!sat) return;
  const oldR=sat.mesh.children.find(c=>c.isMesh); if(oldR) sat.mesh.remove(oldR);
  const rIn=sat.data.rVis*1.3,rOut=sat.data.rVis*2.55,RS=128,RR=6;
  const pos=[],uv=[],idx=[];
  for(let r=0;r<=RR;r++){
    const t=r/RR,rad=rIn+(rOut-rIn)*t;
    for(let s=0;s<=RS;s++){
      const th=s/RS*Math.PI*2;
      pos.push(rad*Math.cos(th),0,rad*Math.sin(th)); uv.push(t,s/RS);
    }
  }
  for(let r=0;r<RR;r++) for(let s=0;s<RS;s++){
    const a=(RS+1)*r+s,b=a+1,c=(RS+1)*(r+1)+s,d=c+1;
    idx.push(a,c,b,b,c,d);
  }
  const rGeo=new THREE.BufferGeometry();
  rGeo.setAttribute('position',new THREE.BufferAttribute(new Float32Array(pos),3));
  rGeo.setAttribute('uv',new THREE.BufferAttribute(new Float32Array(uv),2));
  rGeo.setIndex(idx);

  // 1D radial texture: C ring → B ring → Cassini gap → A ring → fade
  const rc=document.createElement('canvas'); rc.width=256; rc.height=4;
  const rctx=rc.getContext('2d');
  const rg=rctx.createLinearGradient(0,0,256,0);
  rg.addColorStop(0,'rgba(178,158,118,0.22)');
  rg.addColorStop(0.22,'rgba(218,198,155,0.75)');
  rg.addColorStop(0.48,'rgba(208,188,142,0.92)');
  rg.addColorStop(0.57,'rgba(22,16,10,0.06)');
  rg.addColorStop(0.63,'rgba(22,16,10,0.06)');
  rg.addColorStop(0.70,'rgba(192,172,128,0.68)');
  rg.addColorStop(0.88,'rgba(182,162,118,0.50)');
  rg.addColorStop(1,'rgba(155,138,98,0.12)');
  rctx.fillStyle=rg; rctx.fillRect(0,0,256,4);

  const rMesh=new THREE.Mesh(rGeo,new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(rc),side:THREE.DoubleSide,transparent:true,depthWrite:false}));
  rMesh.rotation.x=Math.PI*0.45; sat.mesh.add(rMesh);
})();

initComets(scene);

// ═══════════════════════════════════════════════
//  BACKGROUND STARFIELD
// ═══════════════════════════════════════════════
const starCount = isMobile ? 3000 : 8000;
const starPositions = new Float32Array(starCount * 3);
const starColors = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = 800 + Math.random() * 3000;
  starPositions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
  starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
  starPositions[i * 3 + 2] = r * Math.cos(phi);
  // Spectral type distribution
  const roll = Math.random();
  let temp;
  if (roll < 0.76) temp = 2400 + Math.random() * 1300;      // M (red)
  else if (roll < 0.88) temp = 3700 + Math.random() * 1500;  // K (orange)
  else if (roll < 0.95) temp = 5200 + Math.random() * 800;   // G (yellow)
  else if (roll < 0.97) temp = 6000 + Math.random() * 1500;  // F
  else if (roll < 0.99) temp = 7500 + Math.random() * 2500;  // A (white)
  else temp = 10000 + Math.random() * 20000;                  // B/O (blue)
  const col = tempToColor(temp);
  starColors[i * 3] = col.r;
  starColors[i * 3 + 1] = col.g;
  starColors[i * 3 + 2] = col.b;
}
const starGeo = new THREE.BufferGeometry();
starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
starGeo.setAttribute('color', new THREE.BufferAttribute(starColors, 3));
const starMat = new THREE.PointsMaterial({ size: 1.2, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.9 });
scene.add(new THREE.Points(starGeo, starMat));

// ═══════════════════════════════════════════════
//  NAMED STARS (for Stellar scale)
// ═══════════════════════════════════════════════
const namedStarMeshes = [];
STAR_DATA.forEach(s => {
  const col = tempToColor(s.temp);
  const r = Math.max(0.02, 0.1 * Math.pow(10, -s.mag / 5));
  const geo = new THREE.SphereGeometry(r, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color: col });
  const mesh = new THREE.Mesh(geo, mat);
  // Place at random angle, correct distance (in ly, scaled to AU)
  const angle = Math.random() * Math.PI * 2;
  const elev = (Math.random() - 0.5) * 0.5;
  const dAU = s.dist * 63241; // ly to AU
  mesh.position.set(Math.cos(angle) * dAU, elev * dAU, Math.sin(angle) * dAU);
  mesh.visible = false;
  mesh.userData = s;
  scene.add(mesh);
  namedStarMeshes.push(mesh);
  // Add glow sprite to each named star
  const gc=document.createElement('canvas'); gc.width=64; gc.height=64;
  const gctx=gc.getContext('2d'),gg=gctx.createRadialGradient(32,32,0,32,32,32);
  const gcol=`${(col.r*255)|0},${(col.g*255)|0},${(col.b*255)|0}`;
  gg.addColorStop(0,`rgba(${gcol},0.9)`); gg.addColorStop(0.25,`rgba(${gcol},0.4)`); gg.addColorStop(1,'rgba(0,0,0,0)');
  gctx.fillStyle=gg; gctx.fillRect(0,0,64,64);
  const gSp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(gc),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false}));
  gSp.scale.setScalar(r*8); mesh.add(gSp);
});

// ═══════════════════════════════════════════════
//  MILKY WAY GALAXY MODEL (for Galactic scale)
// ═══════════════════════════════════════════════
const galaxyGroup = new THREE.Group();
galaxyGroup.visible = false;
scene.add(galaxyGroup);

const KLY = 63241; // 1 kly in AU
const _gaussRand = () => { let u=0,v=0; while(!u) u=Math.random(); while(!v) v=Math.random(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); };

// ── A. Spiral Disc (main body) ──
const discCount = isMobile ? 8000 : 20000;
const discPos = new Float32Array(discCount * 3);
const discCol = new Float32Array(discCount * 3);
const NUM_ARMS = 4;
const ARM_WIND = 2.8; // winding tightness
const R0 = 3000 * KLY; // scale radius
for (let i = 0; i < discCount; i++) {
  const isMajor = i < discCount * 0.7;
  const armIdx = isMajor ? Math.floor(Math.random() * NUM_ARMS) : Math.floor(Math.random() * NUM_ARMS) + 0.5;
  const armBase = (armIdx / NUM_ARMS) * Math.PI * 2;
  const dist = Math.pow(Math.random(), 0.7) * 50000 * KLY;
  const spiralAngle = armBase + Math.log(1 + dist / R0) * ARM_WIND;
  const spreadSigma = dist * (isMajor ? 0.06 : 0.12);
  const perpSpread = _gaussRand() * spreadSigma;
  const ySpread = _gaussRand() * dist * 0.008;
  discPos[i*3]   = Math.cos(spiralAngle) * dist + Math.cos(spiralAngle + Math.PI/2) * perpSpread;
  discPos[i*3+1] = ySpread;
  discPos[i*3+2] = Math.sin(spiralAngle) * dist + Math.sin(spiralAngle + Math.PI/2) * perpSpread;
  // Color: blue-white in arms, warmer between
  const inArm = Math.abs(perpSpread) < spreadSigma * 0.6;
  const temp = inArm ? 7000 + Math.random() * 15000 : 3000 + Math.random() * 4000;
  const col = tempToColor(temp);
  discCol[i*3] = col.r; discCol[i*3+1] = col.g; discCol[i*3+2] = col.b;
}
const discGeo = new THREE.BufferGeometry();
discGeo.setAttribute('position', new THREE.BufferAttribute(discPos, 3));
discGeo.setAttribute('color', new THREE.BufferAttribute(discCol, 3));
galaxyGroup.add(new THREE.Points(discGeo, new THREE.PointsMaterial({ size: 7000, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.65 })));

// ── B. Central Bulge (2000 points) ──
const bulgeCount = isMobile ? 800 : 2000;
const bulgePos = new Float32Array(bulgeCount * 3);
const bulgeCol = new Float32Array(bulgeCount * 3);
for (let i = 0; i < bulgeCount; i++) {
  const r = 5000 * KLY * Math.pow(Math.random(), 2.5);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  bulgePos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
  bulgePos[i*3+1] = r * Math.sin(phi) * Math.sin(theta) * 0.6; // oblate
  bulgePos[i*3+2] = r * Math.cos(phi);
  const temp = 3500 + Math.random() * 2500; // warm old stars
  const col = tempToColor(temp);
  bulgeCol[i*3] = col.r; bulgeCol[i*3+1] = col.g; bulgeCol[i*3+2] = col.b;
}
const bulgeGeo = new THREE.BufferGeometry();
bulgeGeo.setAttribute('position', new THREE.BufferAttribute(bulgePos, 3));
bulgeGeo.setAttribute('color', new THREE.BufferAttribute(bulgeCol, 3));
galaxyGroup.add(new THREE.Points(bulgeGeo, new THREE.PointsMaterial({ size: 15000, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.8 })));

// ── C. Core Glow Sprite ──
const coreC = document.createElement('canvas'); coreC.width = 128; coreC.height = 128;
const coreCtx = coreC.getContext('2d');
const coreGrad = coreCtx.createRadialGradient(64,64,0,64,64,64);
coreGrad.addColorStop(0, 'rgba(255,235,200,0.7)');
coreGrad.addColorStop(0.2, 'rgba(255,210,150,0.35)');
coreGrad.addColorStop(0.5, 'rgba(200,160,100,0.1)');
coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
coreCtx.fillStyle = coreGrad; coreCtx.fillRect(0,0,128,128);
const coreSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(coreC), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, alphaTest: 0.01 }));
coreSprite.scale.setScalar(2e7);
galaxyGroup.add(coreSprite);

// ── D. Dust Lanes (between arms) ──
const dustCount = isMobile ? 1000 : 3000;
const dustPos = new Float32Array(dustCount * 3);
const dustCol = new Float32Array(dustCount * 3);
for (let i = 0; i < dustCount; i++) {
  const armIdx = Math.floor(Math.random() * NUM_ARMS);
  const armBase = (armIdx / NUM_ARMS) * Math.PI * 2;
  const dist = Math.pow(Math.random(), 0.6) * 45000 * KLY;
  const spiralAngle = armBase + Math.log(1 + dist / R0) * ARM_WIND - 0.15; // offset inward
  const perpSpread = _gaussRand() * dist * 0.03;
  dustPos[i*3]   = Math.cos(spiralAngle) * dist + Math.cos(spiralAngle + Math.PI/2) * perpSpread;
  dustPos[i*3+1] = _gaussRand() * dist * 0.003;
  dustPos[i*3+2] = Math.sin(spiralAngle) * dist + Math.sin(spiralAngle + Math.PI/2) * perpSpread;
  dustCol[i*3] = 0.12; dustCol[i*3+1] = 0.08; dustCol[i*3+2] = 0.05;
}
const dustGeo = new THREE.BufferGeometry();
dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
galaxyGroup.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 18000, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.35, blending: THREE.NormalBlending })));

// ── E. Halo (dim outer sphere) ──
const haloCount = isMobile ? 400 : 1000;
const haloPos = new Float32Array(haloCount * 3);
const haloCol = new Float32Array(haloCount * 3);
for (let i = 0; i < haloCount; i++) {
  const r = 60000 * KLY * Math.pow(Math.random(), 1.5);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  haloPos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
  haloPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
  haloPos[i*3+2] = r * Math.cos(phi);
  const col = tempToColor(4000 + Math.random() * 1500);
  haloCol[i*3] = col.r * 0.4; haloCol[i*3+1] = col.g * 0.4; haloCol[i*3+2] = col.b * 0.4;
}
const haloGeo = new THREE.BufferGeometry();
haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3));
haloGeo.setAttribute('color', new THREE.BufferAttribute(haloCol, 3));
galaxyGroup.add(new THREE.Points(haloGeo, new THREE.PointsMaterial({ size: 5000, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.25 })));

// ── F. "You Are Here" marker (Sun's position in the Orion Arm) ──
const sunGalacticR = 26000 * KLY; // 26 kly from center
const sunGalacticAngle = Math.PI * 0.85; // position in Orion Arm
const youAreHere = new THREE.Group();
const yahSprite = new THREE.Sprite(new THREE.SpriteMaterial({
  map: (() => { const c=document.createElement('canvas'); c.width=64; c.height=64; const ctx=c.getContext('2d'),g=ctx.createRadialGradient(32,32,0,32,32,32); g.addColorStop(0,'rgba(255,220,50,1)'); g.addColorStop(0.3,'rgba(255,200,50,0.5)'); g.addColorStop(1,'rgba(0,0,0,0)'); ctx.fillStyle=g; ctx.fillRect(0,0,64,64); return new THREE.CanvasTexture(c); })(),
  blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, alphaTest: 0.01
}));
yahSprite.scale.setScalar(8000);
youAreHere.add(yahSprite);
youAreHere.position.set(Math.cos(sunGalacticAngle) * sunGalacticR, 0, Math.sin(sunGalacticAngle) * sunGalacticR);
galaxyGroup.add(youAreHere);
// "You Are Here" label added in initLabels() to avoid temporal dead zone

// ═══════════════════════════════════════════════
//  ATOMIC SCALE
// ═══════════════════════════════════════════════
const atomGroup = new THREE.Group();
atomGroup.visible = false;
scene.add(atomGroup);

const nucleusGeo = new THREE.SphereGeometry(0.05, 32, 32);
const nucleusMat = new THREE.MeshBasicMaterial({ color: 0xff4444 });
atomGroup.add(new THREE.Mesh(nucleusGeo, nucleusMat));

const electronOrbitGeo = new THREE.RingGeometry(0.48, 0.5, 64);
const electronOrbitMat = new THREE.MeshBasicMaterial({ color: 0x0088ff, side: THREE.DoubleSide, transparent: true, opacity: 0.2 });
for (let i = 0; i < 3; i++) {
  const ring = new THREE.Mesh(electronOrbitGeo.clone(), electronOrbitMat.clone());
  ring.rotation.x = Math.PI / 2 * i + Math.random() * 0.5;
  ring.rotation.y = Math.random() * Math.PI;
  atomGroup.add(ring);
}

// electrons
const electronGeo = new THREE.SphereGeometry(0.02, 16, 16);
const electronMat = new THREE.MeshBasicMaterial({ color: 0x00aaff });
const electrons = [];
for (let i = 0; i < 3; i++) {
  const e = new THREE.Mesh(electronGeo, electronMat);
  atomGroup.add(e);
  electrons.push({ mesh: e, orbit: i, angle: Math.random() * Math.PI * 2 });
}

// ═══════════════════════════════════════════════
//  COSMIC WEB (for Cosmic scale)
// ═══════════════════════════════════════════════
const cosmicGroup = new THREE.Group();
cosmicGroup.visible = false;
scene.add(cosmicGroup);

const clusterCount = 500;
const cPositions = new Float32Array(clusterCount * 3);
const cColors = new Float32Array(clusterCount * 3);
for (let i = 0; i < clusterCount; i++) {
  // Filamentary structure
  const filament = Math.floor(Math.random() * 8);
  const fAngle = (filament / 8) * Math.PI * 2;
  const dist = Math.random() * 5e12; // in AU
  const spread = (Math.random() - 0.5) * dist * 0.3;
  cPositions[i * 3] = Math.cos(fAngle) * dist + spread;
  cPositions[i * 3 + 1] = (Math.random() - 0.5) * dist * 0.2;
  cPositions[i * 3 + 2] = Math.sin(fAngle) * dist + spread * 0.5;
  cColors[i * 3] = 0.6 + Math.random() * 0.4;
  cColors[i * 3 + 1] = 0.5 + Math.random() * 0.3;
  cColors[i * 3 + 2] = 0.3 + Math.random() * 0.2;
}
const cosmicGeo = new THREE.BufferGeometry();
cosmicGeo.setAttribute('position', new THREE.BufferAttribute(cPositions, 3));
cosmicGeo.setAttribute('color', new THREE.BufferAttribute(cColors, 3));
const cosmicMat = new THREE.PointsMaterial({ size: 5e10, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.6 });
cosmicGroup.add(new THREE.Points(cosmicGeo, cosmicMat));

// ═══════════════════════════════════════════════
//  LIGHT SPEED SPHERE
// ═══════════════════════════════════════════════
const lightSphereGeo = new THREE.SphereGeometry(1, 32, 32);
const lightSphereMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.03, side: THREE.BackSide, wireframe: true });
const lightSphere = new THREE.Mesh(lightSphereGeo, lightSphereMat);
lightSphere.visible = false;
scene.add(lightSphere);

// ═══════════════════════════════════════════════
//  OBJECT LABELS
// ═══════════════════════════════════════════════
const labelsContainer = document.getElementById('labels');
const labelsList = []; // { el, mesh, scaleLevel }

function createLabel(text) {
  const el = document.createElement('div');
  el.className = 'obj-label';
  el.innerHTML = `<span class="obj-label-name">${text}</span><span class="obj-label-dist"></span>`;
  labelsContainer.appendChild(el);
  return el;
}

// Background reference objects — far-away labels visible at various scales
const _bgRefObjects = [];
const _bgRefData = [
  // Nearby stars visible at stellar scale (scale 1)
  { name:'Proxima Centauri', dist:4.24, scale:1 },{ name:'Wolf 359', dist:7.86, scale:1 },
  { name:'Lalande 21185', dist:8.31, scale:1 },{ name:'Ross 154', dist:9.69, scale:1 },
  { name:'Epsilon Eridani', dist:10.5, scale:1 },{ name:'61 Cygni', dist:11.4, scale:1 },
  { name:'Tau Ceti', dist:11.9, scale:1 },{ name:'Polaris', dist:433, scale:1 },
  { name:'Deneb', dist:2600, scale:1 },{ name:'Canopus', dist:310, scale:1 },
  { name:'Arcturus', dist:36.7, scale:1 },{ name:'Capella', dist:42.9, scale:1 },
  { name:'Aldebaran', dist:65.3, scale:1 },{ name:'Spica', dist:250, scale:1 },
  { name:'Antares', dist:550, scale:1 },{ name:'Fomalhaut', dist:25.1, scale:1 },
  // Galactic objects visible at galactic scale (scale 2)
  { name:'Orion Nebula', dist:1344, scale:2 },{ name:'Pleiades', dist:444, scale:2 },
  { name:'Crab Nebula', dist:6500, scale:2 },{ name:'Eagle Nebula', dist:7000, scale:2 },
  { name:'Sagittarius A*', dist:26000, scale:2 },{ name:'Carina Nebula', dist:8500, scale:2 },
  { name:'Omega Centauri', dist:15800, scale:2 },{ name:'47 Tucanae', dist:13000, scale:2 },
  { name:'Horsehead Nebula', dist:1375, scale:2 },{ name:'Ring Nebula', dist:2283, scale:2 },
  // Cosmic objects visible at cosmic scale (scale 3)
  { name:'Andromeda (M31)', dist:2.537e6, scale:3 },{ name:'Triangulum (M33)', dist:2.73e6, scale:3 },
  { name:'Large Magellanic Cloud', dist:160000, scale:3 },{ name:'Small Magellanic Cloud', dist:200000, scale:3 },
  { name:'Whirlpool Galaxy (M51)', dist:23e6, scale:3 },{ name:'Sombrero Galaxy (M104)', dist:29e6, scale:3 },
  { name:'Centaurus A', dist:13e6, scale:3 },{ name:'Coma Cluster', dist:321e6, scale:3 },
  { name:'Virgo Cluster', dist:54e6, scale:3 },{ name:'Hercules Cluster', dist:500e6, scale:3 },
];

function initLabels() {
  // Sun
  labelsList.push({ el: createLabel('Sun'), mesh: sunMesh, scaleLevel: 0 });
  // Planets
  planetMeshes.forEach(({ mesh, data }) => {
    labelsList.push({ el: createLabel(data.name), mesh, scaleLevel: 0 });
  });
  // Moons
  moonMeshes.forEach(m => {
    labelsList.push({ el: createLabel(m.data.name), mesh: m.mesh, scaleLevel: 0 });
  });
  // Hardcoded named stars
  namedStarMeshes.forEach(m => {
    labelsList.push({ el: createLabel(m.userData.name), mesh: m, scaleLevel: 1 });
  });
  // "You Are Here" marker in the Milky Way
  labelsList.push({ el: createLabel('You Are Here \u2609'), mesh: youAreHere, scaleLevel: 2 });
  // Background reference objects — placed at random angles, correct distances
  _bgRefData.forEach(obj => {
    const dAU = obj.dist * 63241; // ly to AU
    const angle = Math.random() * Math.PI * 2;
    const elev = (Math.random() - 0.5) * 0.6;
    const marker = new THREE.Object3D();
    marker.position.set(Math.cos(angle) * dAU, elev * dAU * 0.3, Math.sin(angle) * dAU);
    marker.visible = false;
    scene.add(marker);
    _bgRefObjects.push({ marker, scale: obj.scale });
    labelsList.push({ el: createLabel(obj.name), mesh: marker, scaleLevel: obj.scale });
  });
}

const _labelWorldPos = new THREE.Vector3();
function updateLabels() {
  if (!started) return;
  labelsList.forEach(({ el, mesh, scaleLevel }) => {
    if (!hudVisible || currentScale !== scaleLevel || !mesh.visible) {
      el.style.display = 'none'; return;
    }
    mesh.getWorldPosition(_labelWorldPos);
    const proj = _labelWorldPos.clone().project(camera);
    if (proj.z > 1 || proj.z < -1) { el.style.display = 'none'; return; }
    const x = (proj.x + 1) * 0.5 * window.innerWidth;
    const y = (-proj.y + 1) * 0.5 * window.innerHeight;
    el.style.display = '';
    el.style.left = x + 'px';
    el.style.top  = y + 'px';
    // Update distance from Earth
    const distEl = el.querySelector('.obj-label-dist');
    if (distEl) {
      const earthMesh = planetMeshes.find(p => p.data.name === 'Earth')?.mesh;
      const earthPos = earthMesh ? earthMesh.position : new THREE.Vector3(1, 0, 0);
      const dAU = earthPos.distanceTo(_labelWorldPos);
      const dLY = dAU / 63241;
      if (dAU < 0.0001) distEl.textContent = 'Home';
      else if (dLY >= 0.01) distEl.textContent = dLY < 1000 ? dLY.toFixed(2) + ' ly' : dLY < 1e6 ? (dLY/1000).toFixed(1) + ' kly' : (dLY/1e6).toFixed(2) + ' Mly';
      else if (dAU >= 0.001) distEl.textContent = dAU.toFixed(3) + ' AU from Earth';
      else distEl.textContent = (dAU * AU).toFixed(0) + ' km from Earth';
    }
  });
}

// ═══════════════════════════════════════════════
//  LIVE ASTRONOMICAL DATABASES
// ═══════════════════════════════════════════════
const liveStarMeshes = [];
const exoplanetMarkers = [];
const searchableObjects = [];
let searchOpen = false;

function updateDBBadge() {} // status bar removed

function raDecToVec3(ra, dec, distAU) {
  const raRad = ra * Math.PI / 180;
  const decRad = dec * Math.PI / 180;
  return new THREE.Vector3(
    distAU * Math.cos(decRad) * Math.cos(raRad),
    distAU * Math.sin(decRad),
    distAU * Math.cos(decRad) * Math.sin(raRad)
  );
}

async function fetchRealStars() {
  try {
    const q = `SELECT TOP 300 main_id,ra,dec,plx_value,sp_type FROM basic WHERE plx_value>5 AND ra IS NOT NULL ORDER BY plx_value DESC`;
    const url = `https://simbad.cds.unistra.fr/simbad/sim-tap/sync?REQUEST=doQuery&LANG=ADQL&FORMAT=json&QUERY=${encodeURIComponent(q)}`;
    const resp = await fetch(url);
    const json = await resp.json();
    const cols = (json.metadata || []).map(m => m.name);
    const idx = n => cols.indexOf(n);
    let count = 0;
    (json.data || []).forEach(row => {
      const name  = row[idx('main_id')];
      const ra    = row[idx('ra')];
      const dec   = row[idx('dec')];
      const plx   = row[idx('plx_value')];
      const vmag  = 4;
      const sp    = row[idx('sp_type')];
      if (!plx || plx <= 0 || ra == null || dec == null) return;
      const distLY = (1000 / plx) * 3.26156;
      const distAU = distLY * 63241;
      const temp = spTypeToTemp(sp);
      const col  = tempToColor(temp);
      const r    = Math.max(0.01, 0.1 * Math.pow(10, -vmag / 5));
      const geo  = new THREE.SphereGeometry(r, 16, 16);
      const mat  = new THREE.MeshBasicMaterial({ color: col });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(raDecToVec3(ra, dec, distAU));
      mesh.visible = (currentScale === 1);
      mesh.userData = { name, distLY, temp, vmag, type: 'star' };
      scene.add(mesh);
      liveStarMeshes.push(mesh);
      bodyPositions.push({ name, pos: mesh.position, radius: r, rReal: 696340 });
      searchableObjects.push({ name, distLY, typeLabel: 'Star', mesh });
      count++;
    });
    updateDBBadge('stars', 'loaded', `Stars: ${count}`);
  } catch(e) {
    updateDBBadge('stars', 'error', 'Stars: offline');
    console.warn('SIMBAD fetch failed:', e);
  }
}

async function fetchExoplanets() {
  try {
    const q = `SELECT pl_name,hostname,ra,dec,sy_dist,pl_rade,disc_year FROM ps WHERE default_flag=1 AND sy_dist IS NOT NULL AND sy_dist<500 ORDER BY sy_dist`;
    const url = `https://exoplanetarchive.ipac.caltech.edu/TAP/sync?query=${encodeURIComponent(q)}&format=json`;
    const resp = await fetch(url);
    const rows = await resp.json();
    // Group by host star
    const hosts = {};
    rows.forEach(p => {
      if (!hosts[p.hostname]) hosts[p.hostname] = { ra: p.ra, dec: p.dec, dist: p.sy_dist, planets: [] };
      hosts[p.hostname].planets.push({ name: p.pl_name, rade: p.pl_rade, year: p.disc_year });
    });
    let sysCount = 0, plCount = 0;
    Object.entries(hosts).forEach(([hostName, star]) => {
      const distLY = star.dist * 3.26156;
      const distAU = distLY * 63241;
      const pos = raDecToVec3(star.ra, star.dec, distAU);
      const geo = new THREE.SphereGeometry(0.025, 8, 8);
      const mat = new THREE.MeshBasicMaterial({ color: 0xff8c00 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.visible = (currentScale === 1);
      mesh.userData = { name: hostName, planets: star.planets, distLY, type: 'exo_system' };
      scene.add(mesh);
      exoplanetMarkers.push(mesh);
      const n = star.planets.length;
      plCount += n;
      sysCount++;
      searchableObjects.push({ name: hostName, distLY, typeLabel: `${n} exoplanet${n>1?'s':''}`, mesh });
      star.planets.forEach(p => {
        searchableObjects.push({ name: p.name, distLY, typeLabel: `Exoplanet (${hostName})`, mesh });
      });
    });
    updateDBBadge('exo', 'loaded', `Exoplanets: ${plCount} (${sysCount} systems)`);
  } catch(e) {
    updateDBBadge('exo', 'error', 'Exoplanets: offline');
    console.warn('Exoplanet Archive fetch failed:', e);
  }
}

// ── Deep-sky objects (Messier/NGC) — loaded at init, shown at scale 3 ──
const deepSkyMeshes = [];
let _deepSkyLoaded = false;

function loadDeepSkyObjects() {
  if (_deepSkyLoaded) return;
  _deepSkyLoaded = true;
  const typeColors = {
    nebula: 0x6688ff, globular: 0xffaa44, open_cluster: 0xffdd77,
    planetary_nebula: 0x44ffaa, snr: 0xff5533, galaxy: 0x8899ff
  };
  const typeLabels = {
    nebula: 'Nebula', globular: 'Globular Cluster', open_cluster: 'Open Cluster',
    planetary_nebula: 'Planetary Nebula', snr: 'Supernova Remnant', galaxy: 'Galaxy'
  };

  DEEP_SKY_OBJECTS.forEach(obj => {
    const distAU = obj.dist * 63241;
    const pos = raDecToVec3(obj.ra, obj.dec, distAU);
    const col = typeColors[obj.type] || 0xaaaaff;
    const r = obj.type === 'galaxy' ? 8e8 : 2500;

    // Glow sprite for each object
    const sc = document.createElement('canvas'); sc.width = 64; sc.height = 64;
    const sctx = sc.getContext('2d');
    const sg = sctx.createRadialGradient(32,32,0,32,32,32);
    const c3 = new THREE.Color(col);
    sg.addColorStop(0, `rgba(${(c3.r*255)|0},${(c3.g*255)|0},${(c3.b*255)|0},0.9)`);
    sg.addColorStop(0.3, `rgba(${(c3.r*255)|0},${(c3.g*255)|0},${(c3.b*255)|0},0.35)`);
    sg.addColorStop(1, 'rgba(0,0,0,0)');
    sctx.fillStyle = sg; sctx.fillRect(0,0,64,64);

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(sc), blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, alphaTest: 0.01
    }));
    sprite.position.copy(pos);
    sprite.scale.setScalar(r * 0.5);
    sprite.visible = (currentScale === 2);
    scene.add(sprite);
    deepSkyMeshes.push(sprite);

    const displayName = obj.altName ? `${obj.name} ${obj.altName}` : obj.name;
    const distLY = obj.dist;

    // Label only brighter objects (mag < 9)
    if (obj.mag < 9) {
      labelsList.push({ el: createLabel(displayName), mesh: sprite, scaleLevel: obj.type === 'galaxy' ? 3 : 2 });
    }
    searchableObjects.push({ name: displayName, distLY, typeLabel: typeLabels[obj.type] || 'Deep Sky', mesh: sprite });
  });
}

// ── Gaia stars — loaded lazily on first enter of scale 2 ──
let _gaiaLoaded = false;
function loadGaiaStars() {
  if (_gaiaLoaded) return;
  _gaiaLoaded = true;
  ensureLoaded('gaiaStars', fetchGaiaStars, (stars) => {
    if (!stars || !stars.length) return;
    stars.forEach(s => {
      const col = tempToColor(s.temp || 5778);
      const r = Math.max(0.015, 0.08 * Math.pow(10, -(s.mag || 4) / 5));
      const geo = new THREE.SphereGeometry(r, 12, 12);
      const mat = new THREE.MeshBasicMaterial({ color: col });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(raDecToVec3(s.ra, s.dec, s.distAU));
      mesh.visible = (currentScale === 1);
      mesh.userData = { name: 'Gaia ' + (s.sourceId || '').toString().slice(-6), distLY: s.distLY, temp: s.temp, type: 'star' };
      scene.add(mesh);
      liveStarMeshes.push(mesh);

      // Glow sprite
      const gc = document.createElement('canvas'); gc.width = 32; gc.height = 32;
      const gctx = gc.getContext('2d'), gg = gctx.createRadialGradient(16,16,0,16,16,16);
      const gcol = `${(col.r*255)|0},${(col.g*255)|0},${(col.b*255)|0}`;
      gg.addColorStop(0,`rgba(${gcol},0.7)`); gg.addColorStop(0.3,`rgba(${gcol},0.25)`); gg.addColorStop(1,'rgba(0,0,0,0)');
      gctx.fillStyle = gg; gctx.fillRect(0,0,32,32);
      const gSp = new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(gc),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false}));
      gSp.scale.setScalar(r * 6);
      mesh.add(gSp);

      // Only label bright stars
      if ((s.mag || 99) < 3.5) {
        labelsList.push({ el: createLabel(mesh.userData.name), mesh, scaleLevel: 1 });
      }
    });
    console.log(`Loaded ${stars.length} Gaia stars`);
  });
}

// ── Nearby galaxies — loaded lazily on first enter of scale 4 ──
let _galaxiesLoaded = false;
const galaxyCatalogMeshes = [];
function loadNearbyGalaxies() {
  if (_galaxiesLoaded) return;
  _galaxiesLoaded = true;
  ensureLoaded('nearbyGalaxies', fetchNearbyGalaxies, (galaxies) => {
    if (!galaxies || !galaxies.length) return;
    galaxies.forEach(g => {
      const pos = raDecToVec3(g.ra, g.dec, g.distAU);
      // Galaxy sprite
      const gc = document.createElement('canvas'); gc.width = 64; gc.height = 64;
      const gctx = gc.getContext('2d'), gg = gctx.createRadialGradient(32,32,0,32,32,32);
      // Color by morphological type: elliptical=warm, spiral=blue-white, irregular=pale
      const isElliptical = (g.morphType || 0) < 0;
      const gCol = isElliptical ? '255,220,150' : '150,180,255';
      gg.addColorStop(0, `rgba(${gCol},0.8)`); gg.addColorStop(0.3, `rgba(${gCol},0.3)`); gg.addColorStop(1, 'rgba(0,0,0,0)');
      gctx.fillStyle = gg; gctx.fillRect(0,0,64,64);

      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(gc), blending: THREE.AdditiveBlending,
        transparent: true, depthWrite: false, alphaTest: 0.01
      }));
      sprite.position.copy(pos);
      sprite.scale.setScalar(8e8 * 0.4);
      sprite.visible = (currentScale === 3);
      scene.add(sprite);
      galaxyCatalogMeshes.push(sprite);

      // Label brighter galaxies
      if ((g.mag || 99) < 12) {
        labelsList.push({ el: createLabel(g.name), mesh: sprite, scaleLevel: 3 });
      }
      searchableObjects.push({ name: g.name, distLY: g.distLY, typeLabel: 'Galaxy', mesh: sprite });
    });
    console.log(`Loaded ${galaxies.length} nearby galaxies`);
  });
}

function loadExternalData() {
  fetchRealStars(); // SIMBAD nearby stars
  fetchExoplanets(); // NASA exoplanet archive
  loadDeepSkyObjects(); // Messier/NGC (immediate, no network)
}

// ═══════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════
function openSearch() {
  searchOpen = true;
  document.querySelector('.search-overlay').classList.add('open');
  const panel = document.getElementById('search-panel');
  panel.classList.add('open');
  const input = document.getElementById('search-input');
  input.value = '';
  document.getElementById('search-results').innerHTML = '';
  setTimeout(() => input.focus(), 50);
}

function closeSearch() {
  searchOpen = false;
  document.querySelector('.search-overlay').classList.remove('open');
  document.getElementById('search-panel').classList.remove('open');
}
document.getElementById('search-close-btn').addEventListener('click', closeSearch);
// Tap backdrop to close search
document.querySelector('.search-overlay').addEventListener('click', e => {
  if (e.target === document.querySelector('.search-overlay')) closeSearch();
});

function travelToMesh(mesh, scaleLevel, name, orbitR) {
  _pauseTimeForTravel();
  if (scaleLevel !== undefined && currentScale !== scaleLevel) { currentScale = scaleLevel; applyScale(); }
  const r = orbitR || Math.max(0.3, (mesh.geometry?.parameters?.radius || 0.3) * 4);
  travelOrigin.copy(camera.position);
  travelElapsed = 0;
  travelDest = { position: mesh.position.clone(), name: name || '?', scaleLevel, radius: r };
  travelActive = true; travelSpeed = 0;
  document.getElementById('travel-hud').classList.add('active');
  document.getElementById('travel-hud-dest').textContent = '→ ' + (name || 'DESTINATION').toUpperCase();
}

// simbadMarkerRadius imported from simbad.js

function travelToSIMBADResult(result, skipTravel = false) {
  const { name, ra, dec, plx, z, otype, sp } = result;
  const typeInfo = simbadOtypeInfo(otype);
  const distAU   = simbadDistAU(plx, z, typeInfo);
  const pos      = raDecToVec3(ra, dec, distAU);
  const r        = simbadMarkerRadius(typeInfo.scale);
  const col      = sp ? tempToColor(spTypeToTemp(sp)) : typeInfo.color;
  const mesh     = new THREE.Mesh(
    new THREE.SphereGeometry(r, 12, 12),
    new THREE.MeshBasicMaterial({ color: col })
  );
  mesh.position.copy(pos);
  mesh.userData  = { name, type: typeInfo.label, distAU };
  scene.add(mesh);
  liveStarMeshes.push(mesh);
  labelsList.push({ el: createLabel(name), mesh, scaleLevel: typeInfo.scale });
  if (!skipTravel) travelToMesh(mesh, typeInfo.scale, name, r * 4);
  closeSearch();
}

// Query SIMBAD TAP for live search
let searchDebounce = null;
let liveReqId = 0;

// ═══════════════════════════════════════════════
//  RANDOM EXPLORATION MODE
// ═══════════════════════════════════════════════
let _exploreItinerary = null;
function _getItinerary() {
  if (_exploreItinerary) return _exploreItinerary;
  _exploreItinerary = [
    // ── Solar System (scale 0) ──
    { name:'Sun',     scale:0, spIdx:7, dwell:11, vMult:4.5, getPos:()=>new THREE.Vector3(0,0,0),         r:()=>SUN_RADIUS_VIS },
    { name:'Mercury', scale:0, spIdx:7, dwell:9,  vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Mercury')?.mesh.position.clone(), r:()=>0.008 },
    { name:'Venus',   scale:0, spIdx:7, dwell:9,  vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Venus')?.mesh.position.clone(),   r:()=>0.014 },
    { name:'Earth',   scale:0, spIdx:7, dwell:12, vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Earth')?.mesh.position.clone(),   r:()=>0.015 },
    { name:'Mars',    scale:0, spIdx:7, dwell:10, vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Mars')?.mesh.position.clone(),    r:()=>0.011 },
    { name:'Jupiter', scale:0, spIdx:7, dwell:13, vMult:7,   getPos:()=>planetMeshes.find(p=>p.data.name==='Jupiter')?.mesh.position.clone(), r:()=>0.055 },
    { name:'Saturn',  scale:0, spIdx:7, dwell:14, vMult:7,   getPos:()=>planetMeshes.find(p=>p.data.name==='Saturn')?.mesh.position.clone(),  r:()=>0.055 },
    { name:'Uranus',  scale:0, spIdx:7, dwell:9,  vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Uranus')?.mesh.position.clone(),  r:()=>0.028 },
    { name:'Neptune', scale:0, spIdx:7, dwell:10, vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Neptune')?.mesh.position.clone(), r:()=>0.026 },
    // ── Stellar Neighbors (scale 1) ──
    { name:'Alpha Centauri', scale:1, spIdx:8, dwell:11, vMult:4, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Alpha Centauri')?.position.clone(), r:()=>0.09 },
    { name:'Sirius',         scale:1, spIdx:8, dwell:10, vMult:4, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Sirius')?.position.clone(),         r:()=>0.10 },
    { name:'Vega',           scale:1, spIdx:8, dwell:9,  vMult:4, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Vega')?.position.clone(),           r:()=>0.08 },
    { name:'Betelgeuse',     scale:1, spIdx:8, dwell:12, vMult:3, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Betelgeuse')?.position.clone(),     r:()=>0.18 },
    { name:'Rigel',          scale:1, spIdx:8, dwell:9,  vMult:4, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Rigel')?.position.clone(),          r:()=>0.12 },
    // ── Cosmic (scale 3) ──
    { name:'Andromeda Galaxy', scale:3, spIdx:9, dwell:16, vMult:1.2, getPos:()=>raDecToVec3(10.684,41.268,2.5e6*63241), r:()=>8e8 },
  ];
  return _exploreItinerary;
}

function _shuffle(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

let exploreMode     = false;
let explorePhase    = 'idle';  // 'travel' | 'dwell' | 'gap'
let exploreDwellT   = 0;
let exploreGapT     = 0;
let exploreQueue    = [];
let exploreDest     = null;    // current itinerary entry
let exploreOrbitAng = 0;

function startExploreMode() {
  exploreMode  = true;
  explorePhase = 'gap';
  exploreGapT  = 0;
  // Always start in Solar System
  currentScale = 0;
  camera.position.set(0, 1.5, 4);
  yaw = Math.PI; pitch = -0.3; roll = 0;
  applyScale();
  // Start with solar system objects, then shuffle the rest
  const it = _getItinerary();
  const ss  = it.filter(d => d.scale === 0);
  const rest = _shuffle(it.filter(d => d.scale !== 0));
  exploreQueue = [..._shuffle(ss), ...rest];
  document.getElementById('explore-hud').classList.add('active');
  document.body.classList.add('explore-active');
  document.getElementById('exp-dest').textContent = 'INITIALISING…';
  document.getElementById('exp-status').textContent = '';
}

function stopExploreMode() {
  exploreMode  = false;
  explorePhase = 'idle';
  exploreDest  = null;
  document.getElementById('explore-hud').classList.remove('active');
  document.body.classList.remove('explore-active');
}

function _exploreLaunch() {
  if (exploreQueue.length === 0) {
    // Reshuffle when we run out
    exploreQueue = _shuffle(_getItinerary());
  }
  exploreDest = exploreQueue.shift();
  const pos = exploreDest.getPos();
  if (!pos) { _exploreLaunch(); return; } // mesh not ready, skip

  // Switch scale
  if (currentScale !== exploreDest.scale) { currentScale = exploreDest.scale; applyScale(); }

  _pauseTimeForTravel();
  travelOrigin.copy(camera.position);
  travelElapsed = 0;

  // Inject travel destination
  travelDest = { position: pos, name: exploreDest.name, scaleLevel: exploreDest.scale, distLY: pos.length()/63241, radius: exploreDest.r() };
  travelActive  = true;
  travelSpeed   = 0;
  travelSpeedIdx = exploreDest.spIdx;
  document.getElementById('travel-speeds-grid').querySelectorAll('.travel-speed-btn').forEach((b,i)=>b.classList.toggle('selected',i===travelSpeedIdx));
  document.getElementById('travel-hud').classList.add('active');
  document.getElementById('travel-hud-dest').textContent = '→ ' + exploreDest.name.toUpperCase();
  document.getElementById('exp-dest').textContent = exploreDest.name.toUpperCase();
  document.getElementById('exp-status').textContent = 'EN ROUTE';
  explorePhase = 'travel';
}

function updateExplore(dt) {
  if (!exploreMode) return;

  if (explorePhase === 'travel') {
    if (!travelActive) {
      // Arrived
      explorePhase  = 'dwell';
      exploreDwellT = 0;
      exploreOrbitAng = yaw + Math.PI * 0.5; // start orbit tangent to current heading
      document.getElementById('exp-status').textContent = 'ARRIVED';
      // Random UFO chance on arrival
      // (UFO easter egg removed)
    }
  } else if (explorePhase === 'dwell') {
    exploreDwellT += dt;
    const remaining = exploreDest.dwell - exploreDwellT;

    // Cinematic orbit around the destination — smooth blend in
    const target = exploreDest.getPos();
    if (target) {
      exploreOrbitAng += dt * 0.32;
      const orbitR = Math.max(0.5, exploreDest.r() * exploreDest.vMult);
      const height  = orbitR * 0.28;
      const goalX = target.x + Math.cos(exploreOrbitAng) * orbitR;
      const goalY = target.y + height + Math.sin(exploreOrbitAng * 0.4) * height * 0.4;
      const goalZ = target.z + Math.sin(exploreOrbitAng) * orbitR;
      // Smooth blend: gently ease into orbit position over several seconds
      const blend = Math.min(1, exploreDwellT * 0.5);
      const lerpRate = Math.min(1, dt * (0.8 + blend * 2.2));
      camera.position.x += (goalX - camera.position.x) * lerpRate;
      camera.position.y += (goalY - camera.position.y) * lerpRate;
      camera.position.z += (goalZ - camera.position.z) * lerpRate;
      // Smoothly look at the object
      const toT = new THREE.Vector3().subVectors(target, camera.position).normalize();
      const ty = Math.atan2(-toT.x, -toT.z);
      const tp = Math.asin(Math.max(-1, Math.min(1, toT.y)));
      yaw   += (ty - yaw)   * Math.min(1, dt * 1.8);
      pitch += (tp - pitch) * Math.min(1, dt * 1.8);
      roll  += (0 - roll)   * Math.min(1, dt * 1.5);
    }

    const secs = Math.max(0, Math.ceil(remaining));
    document.getElementById('exp-status').textContent = secs > 0 ? `DEPARTING IN ${secs}s` : 'DEPARTING…';

    if (exploreDwellT >= exploreDest.dwell) {
      explorePhase = 'gap';
      exploreGapT  = 0;
      document.getElementById('exp-status').textContent = 'NEXT DESTINATION…';
    }
  } else if (explorePhase === 'gap') {
    exploreGapT += dt;
    if (exploreGapT >= 2.5) _exploreLaunch();
  }
}

document.getElementById('explore-stop-btn').addEventListener('click', stopExploreMode);

let _nearestBody = { name: 'Sun', rReal: 696340 };
let _factsCollapsed = false;
let _factsSubject   = null;
let _factsList      = [];
let _factsIdx       = 0;
let _factsTimer     = 0;
let _factsSuggestTarget = null;
const _FACTS_CYCLE = 10; // seconds per fact

document.getElementById('facts-toggle-btn').addEventListener('click', () => {
  _factsCollapsed = !_factsCollapsed;
  document.getElementById('facts-panel').classList.toggle('collapsed', _factsCollapsed);
});

document.getElementById('facts-suggest-btn').addEventListener('click', () => {
  if (_factsSuggestTarget) {
    openTravelPanel();
    const inp = document.getElementById('travel-dest-input');
    inp.value = _factsSuggestTarget;
    doTravelSearch(_factsSuggestTarget);
  }
});

function _matchFacts(name) {
  let n = (name || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (_FACTS_ALIASES[n]) n = _FACTS_ALIASES[n];
  if (OBJECT_FACTS[n]) return OBJECT_FACTS[n];
  for (const [k, v] of Object.entries(OBJECT_FACTS)) {
    if (n.includes(k) || k.includes(n)) return v;
  }
  return null;
}

function _showFact() {
  const el = document.getElementById('facts-text');
  el.classList.add('fading');
  setTimeout(() => {
    el.textContent = _factsList[_factsIdx] || '';
    el.classList.remove('fading');
  }, 250);
  document.querySelectorAll('#facts-footer .facts-dot').forEach((d, i) => d.classList.toggle('active', i === _factsIdx));
  _restartProgress();
}

function _restartProgress() {
  const fill = document.getElementById('facts-pfill');
  if (!fill) return;
  fill.style.transition = 'none';
  fill.style.width = '0%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.transition = `width ${_FACTS_CYCLE}s linear`;
    fill.style.width = '100%';
  }));
}

function _buildFactsUI(displayName, badge, facts, suggestTarget) {
  document.getElementById('facts-obj-name').textContent = displayName.replace(/\s+/g, ' ').trim();
  const badgeEl = document.getElementById('facts-badge');
  badgeEl.className = 'facts-badge ' + badge;
  if (badge === 'travel')       badgeEl.textContent = '→ EN ROUTE';
  else if (badge === 'suggest') badgeEl.textContent = '★ EXPLORE';
  else                          badgeEl.textContent = '◉ NEARBY';
  _factsSuggestTarget = suggestTarget || null;
  const sugBtn = document.getElementById('facts-suggest-btn');
  sugBtn.style.display = suggestTarget ? 'block' : 'none';
  const footer = document.getElementById('facts-footer');
  footer.innerHTML = '';
  if (facts.length > 1) {
    facts.forEach((_, i) => {
      const dot = document.createElement('span');
      dot.className = 'facts-dot' + (i === 0 ? ' active' : '');
      dot.addEventListener('click', () => { _factsIdx = i; _factsTimer = 0; _showFact(); });
      footer.appendChild(dot);
    });
    const prog = document.createElement('div'); prog.className = 'facts-progress';
    const fill = document.createElement('div'); fill.className = 'facts-pfill'; fill.id = 'facts-pfill';
    prog.appendChild(fill); footer.appendChild(prog);
  }
}

function tickFacts(dt) {
  let subject, badge, displayName, facts, suggestTarget = null;

  if (travelActive && travelDest) {
    subject     = travelDest.name.toLowerCase();
    badge       = 'travel';
    displayName = travelDest.name;
    facts       = _matchFacts(travelDest.name);
  } else {
    subject     = (_nearestBody?.name || 'Sun').toLowerCase();
    badge       = 'nearby';
    displayName = _nearestBody?.name || 'Sun';
    facts       = _matchFacts(displayName);
  }

  if (!facts) {
    const si  = Math.floor(Date.now() / 18000) % SUGGESTIONS.length;
    const sug = SUGGESTIONS[si];
    subject      = '__sug' + si;
    displayName  = sug.label;
    badge        = 'suggest';
    facts        = sug.facts;
    suggestTarget = sug.label.toLowerCase();
  }

  if (subject !== _factsSubject) {
    _factsSubject = subject;
    _factsList    = facts;
    _factsIdx     = 0;
    _factsTimer   = 0;
    _buildFactsUI(displayName, badge, facts, suggestTarget);
    const el = document.getElementById('facts-text');
    el.textContent = facts[0] || '';
    el.classList.remove('fading');
    _restartProgress();
    return;
  }

  if (_factsList.length > 1) {
    _factsTimer += dt;
    if (_factsTimer >= _FACTS_CYCLE) {
      _factsTimer = 0;
      _factsIdx = (_factsIdx + 1) % _factsList.length;
      _showFact();
    }
  }
}

function getLocalMatches(q) {
  const allObjs = [
    { name: 'Sun', distLY: 0, typeLabel: 'Star', mesh: sunMesh, scaleLevel: 0 },
    ...PLANETS.map(p => ({
      name: p.name, distLY: 0, typeLabel: 'Planet',
      mesh: planetMeshes.find(pm => pm.data.name === p.name)?.mesh, scaleLevel: 0
    })),
    ...STAR_DATA.map(s => ({
      name: s.name, distLY: s.dist, typeLabel: 'Star',
      mesh: namedStarMeshes.find(m => m.userData.name === s.name), scaleLevel: 1
    })),
    ...searchableObjects.map(o => ({ ...o, scaleLevel: o.typeLabel === 'Planet' ? 0 : o.typeLabel === 'Star' ? 1 : 2 }))
  ];
  const seen = new Set();
  const results = [];
  for (const o of allObjs) {
    if (!o.name || !o.name.toLowerCase().includes(q)) continue;
    const key = o.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push(o);
    if (results.length >= 8) break;
  }
  return results;
}

function renderSearchResults(localResults, liveResults, isLoading) {
  const container = document.getElementById('search-results');
  container.innerHTML = '';

  localResults.forEach(obj => {
    const div = document.createElement('div');
    div.className = 'search-result';
    const distStr = obj.distLY > 0
      ? (obj.distLY < 1000 ? obj.distLY.toFixed(2) + ' ly' : (obj.distLY / 1000).toFixed(1) + ' kly')
      : 'Solar System';
    div.innerHTML = `<div class="res-name">${obj.name}</div><div class="res-info">${obj.typeLabel} &nbsp;·&nbsp; ${distStr}</div>`;
    div.addEventListener('click', () => { if (obj.mesh) travelToMesh(obj.mesh, obj.scaleLevel, obj.name); closeSearch(); });
    container.appendChild(div);
  });

  if (isLoading || (liveResults && liveResults.length > 0)) {
    const sep = document.createElement('div');
    sep.className = 'search-section-label';
    sep.innerHTML = isLoading
      ? `<span class="search-spinner"></span>Searching SIMBAD&hellip;`
      : `SIMBAD`;
    container.appendChild(sep);
  }

  if (liveResults) {
    liveResults.forEach(r => {
      const typeInfo = simbadOtypeInfo(r.otype);
      const distAU   = simbadDistAU(r.plx, r.z, typeInfo);
      const div = document.createElement('div');
      div.className = 'search-result';
      div.innerHTML = `<div class="res-name">${r.name}</div><div class="res-info">${typeInfo.label} &nbsp;·&nbsp; ${formatDistFromAU(distAU)}</div>`;
      div.addEventListener('click', () => travelToSIMBADResult(r));
      container.appendChild(div);
    });
  }

  if (!localResults.length && !isLoading && (!liveResults || !liveResults.length)) {
    container.innerHTML = '<div style="font-size:10px;opacity:0.3;padding:6px 0">No results</div>';
  }
}

async function performSearch(query) {
  const q = query.toLowerCase().trim();
  if (!q) { document.getElementById('search-results').innerHTML = ''; return; }

  const local = getLocalMatches(q);
  renderSearchResults(local, null, q.length >= 2);
  if (q.length < 2) return;

  clearTimeout(searchDebounce);
  const myId = ++liveReqId;
  searchDebounce = setTimeout(async () => {
    try {
      const aliasId = COMMON_ALIASES[q];
      const { reqId, json } = await queryLiveSIMBAD(query.trim(), myId, aliasId);
      if (reqId !== liveReqId) return;
      const cols = (json?.metadata || []).map(m => m.name);
      const idx  = n => cols.indexOf(n);
      const live = (json?.data || []).map(row => ({
        name:  row[idx('main_id')],
        ra:    row[idx('ra')],
        dec:   row[idx('dec')],
        otype: row[idx('otype')],
        plx:   row[idx('plx_value')],
        z:     row[idx('rvz_redshift')],
        sp:    row[idx('sp_type')],
      })).filter(r => r.name && r.ra != null && r.dec != null);
      // Remove items already in local results
      const localNames = new Set(getLocalMatches(q).map(o => o.name.toLowerCase()));
      renderSearchResults(local, live.filter(r => !localNames.has(r.name.toLowerCase())), false);
    } catch(e) {
      renderSearchResults(local, [], false);
      console.warn('SIMBAD live query error:', e);
    }
  }, 450);
}

document.getElementById('search-input').addEventListener('input', e => performSearch(e.target.value));
document.getElementById('search-input').addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSearch(); e.stopPropagation(); return; }
  if (e.key === 'Enter') { const first = document.querySelector('.search-result'); if (first) first.click(); e.stopPropagation(); return; }
  e.stopPropagation();
});

// ═══════════════════════════════════════════════
//  TRAVEL SYSTEM
// ═══════════════════════════════════════════════
const TRAVEL_SPEEDS = [
  { label: 'ISS Orbit',        sub: '7.7 km/s',                   au_s: 7700 / 149597870.7 },
  { label: 'Voyager 1',        sub: '17 km/s',                     au_s: 17000 / 149597870.7 },
  { label: 'Solar Probe',      sub: '163 km/s',                    au_s: 163000 / 149597870.7 },
  { label: '1% Light',         sub: '0.01c · 3,000 km/s',         au_s: C_AU_S * 0.01 },
  { label: 'Light Speed',      sub: '1c · 299,792 km/s',          au_s: C_AU_S },
  { label: '10× Light',        sub: '10c · sci-fi drive',         au_s: C_AU_S * 10 },
  { label: '100× Light',       sub: '100c · hyperdrive',          au_s: C_AU_S * 100 },
  { label: '1,000× Light',     sub: '1,000c · warp',              au_s: C_AU_S * 1000 },
  { label: '1 Million× Light', sub: '1M c · transwarp',           au_s: C_AU_S * 1e6 },
  { label: 'Nav Warp',         sub: '1B c · navigation warp',     au_s: C_AU_S * 1e9 },
];

let travelPanelOpen = false;
let travelActive    = false;
let _savedTimeRate  = null; // time rate saved at travel start, restored on arrival/abort
const TRAVEL_DURATION = 3.5; // seconds — all travel is this long regardless of distance
let travelElapsed   = 0;
const travelOrigin  = new THREE.Vector3();
const _arrivalOrbit = { active:false, target:null, r:0, h:0, angle:0, timer:0, duration:0 };

function _pauseTimeForTravel() {
  if (_savedTimeRate === null) _savedTimeRate = timeRateIndex;
  timeRateIndex = 0;
}
function _resumeTimeAfterTravel() {
  if (_savedTimeRate !== null) { timeRateIndex = _savedTimeRate; _savedTimeRate = null; }
}
let travelDest      = null;  // { position, name, distLY, scaleLevel, simbadResult? }
let travelSpeedIdx  = 4;     // default: light speed
let travelSpeed     = 0;     // current AU/s
let travelDestDebounce = null;

// Build speed grid
(function() {
  const grid = document.getElementById('travel-speeds-grid');
  TRAVEL_SPEEDS.forEach((s, i) => {
    const btn = document.createElement('button');
    btn.className = 'travel-speed-btn' + (i === travelSpeedIdx ? ' selected' : '');
    btn.innerHTML = `<div class="travel-speed-name">${s.label}</div><div class="travel-speed-sub">${s.sub}</div>`;
    btn.addEventListener('click', () => {
      travelSpeedIdx = i;
      grid.querySelectorAll('.travel-speed-btn').forEach((b, j) => b.classList.toggle('selected', j === i));
    });
    grid.appendChild(btn);
  });
})();

function openTravelPanel() {
  travelPanelOpen = true;
  document.getElementById('travel-panel').classList.add('open');
  setTimeout(() => document.getElementById('travel-dest-input').focus(), 40);
}
function closeTravelPanel() {
  travelPanelOpen = false;
  document.getElementById('travel-panel').classList.remove('open');
}
document.getElementById('travel-close-btn').addEventListener('click', closeTravelPanel);
document.getElementById('travel-panel').addEventListener('click', e => {
  if (e.target === document.getElementById('travel-panel')) closeTravelPanel();
});
function setTravelDest(dest) {
  travelDest = dest;
  document.getElementById('travel-dest-name').textContent = dest.name;
  const au = dest.position.length();
  const camDist = camera.position.distanceTo(dest.position);
  const distStr = formatDist(camDist);
  document.getElementById('travel-dest-info').textContent = distStr + ' from current position';
  document.getElementById('travel-dest-confirmed').classList.add('show');
  document.getElementById('travel-dest-results').innerHTML = '';
  document.getElementById('travel-dest-input').value = '';
  document.getElementById('travel-engage-btn').disabled = false;
  document.getElementById('travel-instant-btn').disabled = false;
}

// Travel destination search (reuses SIMBAD search)
const travelInput   = document.getElementById('travel-dest-input');
const travelResults = document.getElementById('travel-dest-results');

function renderTravelResult(name, typeLabel, distLY, onClick) {
  const div = document.createElement('div');
  div.className = 'travel-dest-result';
  const d = distLY <= 0 ? 'Solar System' : distLY < 1000 ? distLY.toFixed(2) + ' ly' : distLY < 1e6 ? (distLY/1000).toFixed(1) + ' kly' : (distLY/1e6).toFixed(2) + ' Mly';
  div.innerHTML = `<div class="res-name">${name}</div><div class="res-info">${typeLabel} · ${d}</div>`;
  div.addEventListener('click', onClick);
  travelResults.appendChild(div);
}

async function doTravelSearch(query) {
  const q = query.toLowerCase().trim();
  travelResults.innerHTML = '';
  if (!q) return;
  getLocalMatches(q).forEach(obj => {
    renderTravelResult(obj.name, obj.typeLabel, obj.distLY, () => {
      const meshR = obj.mesh?.geometry?.parameters?.radius || 0.05;
      setTravelDest({ position: obj.mesh.position.clone(), name: obj.name, distLY: obj.distLY, scaleLevel: obj.scaleLevel, radius: meshR });
    });
  });
  if (q.length < 2) return;
  clearTimeout(travelDestDebounce);
  const myId = ++liveReqId;
  travelDestDebounce = setTimeout(async () => {
    try {
      const aliasId = COMMON_ALIASES[q];
      const { reqId, json } = await queryLiveSIMBAD(query.trim(), myId, aliasId);
      if (reqId !== liveReqId) return;
      const cols = (json?.metadata || []).map(m => m.name);
      const idx  = n => cols.indexOf(n);
      const localNames = new Set(getLocalMatches(q).map(o => o.name.toLowerCase()));
      (json?.data || []).map(row => ({
        name: row[idx('main_id')], ra: row[idx('ra')], dec: row[idx('dec')],
        otype: row[idx('otype')], plx: row[idx('plx_value')], z: row[idx('rvz_redshift')], sp: row[idx('sp_type')]
      })).filter(r => r.name && r.ra != null && !localNames.has(r.name.toLowerCase()))
        .forEach(r => {
          const ti   = simbadOtypeInfo(r.otype);
          const dAU  = simbadDistAU(r.plx, r.z, ti);
          const dLY  = dAU / 63241;
          renderTravelResult(r.name, ti.label, dLY, () => {
            const pos = raDecToVec3(r.ra, r.dec, dAU);
            setTravelDest({ position: pos, name: r.name, distLY: dLY, scaleLevel: ti.scale, simbadResult: r });
          });
        });
    } catch(e) {}
  }, 420);
}
travelInput.addEventListener('input',   e => doTravelSearch(e.target.value));
travelInput.addEventListener('keydown', e => e.stopPropagation());

document.getElementById('travel-engage-btn').addEventListener('click', () => {
  if (!travelDest) return;
  closeTravelPanel();
  _pauseTimeForTravel();
  // Switch to destination's scale level immediately so camera.far covers the distance
  if (travelDest.scaleLevel !== undefined && currentScale !== travelDest.scaleLevel) {
    currentScale = travelDest.scaleLevel; applyScale();
  }
  travelOrigin.copy(camera.position);
  travelElapsed = 0;
  travelActive = true;
  travelSpeed  = 0;
  document.getElementById('travel-hud').classList.add('active');
  document.getElementById('travel-hud-dest').textContent = '→ ' + travelDest.name.toUpperCase();
});
document.getElementById('travel-instant-btn').addEventListener('click', () => {
  if (!travelDest) return;
  closeTravelPanel();
  // Switch scale
  if (travelDest.scaleLevel !== undefined && currentScale !== travelDest.scaleLevel) {
    currentScale = travelDest.scaleLevel; applyScale();
  }
  // Teleport camera directly to viewing position
  const objR = travelDest.radius || 0.05;
  const stopR = Math.max(objR * 4, objR * 6);
  const dir = new THREE.Vector3().subVectors(travelDest.position, camera.position).normalize();
  camera.position.copy(travelDest.position).addScaledVector(dir, -stopR);
  // Face the destination
  yaw = Math.atan2(-dir.x, -dir.z);
  pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
});
document.getElementById('travel-abort-btn').addEventListener('click', abortTravel);

function abortTravel(arrived) {
  travelActive = false;
  travelSpeed  = 0;
  document.getElementById('travel-hud').classList.remove('active');
  hideWarp();
  _resumeTimeAfterTravel();
  if (arrived && travelDest && !exploreMode) {
    // Cinematic orbit around the destination for non-explore arrivals
    const r = Math.max(0.3, (travelDest.radius || 0.3) * 6);
    _arrivalOrbit.active = true;
    _arrivalOrbit.target = travelDest.position.clone();
    _arrivalOrbit.r      = r;
    _arrivalOrbit.h      = r * 0.32;
    _arrivalOrbit.angle  = yaw + Math.PI * 0.5;
    _arrivalOrbit.timer  = 0;
    _arrivalOrbit.duration = 10;
  }
  if (exploreMode && !arrived) stopExploreMode();
}

function updateArrivalOrbit(dt) {
  if (!_arrivalOrbit.active) return;
  _arrivalOrbit.timer += dt;
  if (_arrivalOrbit.timer >= _arrivalOrbit.duration) { _arrivalOrbit.active = false; return; }
  _arrivalOrbit.angle += dt * 0.28;
  const {target, r, h, angle} = _arrivalOrbit;
  const goalX = target.x + Math.cos(angle) * r;
  const goalY = target.y + h + Math.sin(angle * 0.42) * h * 0.45;
  const goalZ = target.z + Math.sin(angle) * r;
  // Smooth lerp into orbit — gentle blend
  const orbitBlend = Math.min(1, _arrivalOrbit.timer * 0.6);
  const orbitLerp = Math.min(1, dt * (0.8 + orbitBlend * 2));
  camera.position.x += (goalX - camera.position.x) * orbitLerp;
  camera.position.y += (goalY - camera.position.y) * orbitLerp;
  camera.position.z += (goalZ - camera.position.z) * orbitLerp;
  const toT = new THREE.Vector3().subVectors(target, camera.position).normalize();
  yaw   += (Math.atan2(-toT.x, -toT.z) - yaw)   * Math.min(1, dt * 1.8);
  pitch += (Math.asin(Math.max(-1, Math.min(1, toT.y))) - pitch) * Math.min(1, dt * 1.8);
  roll  += (0 - roll) * Math.min(1, dt * 1.5);
}

// ── Warp streak effect (extracted module) ─────
initWarp(scene, camera);
const _tD = new THREE.Vector3();

function updateTravel(dt) {
  // Fade out warp streaks after travel ends
  if (!travelActive) {
    if (travelSpeed > 0) {
      travelSpeed = Math.max(0, travelSpeed * (1 - dt * 5));
      renderWarp(dt, travelActive, travelSpeed, C_AU_S, _tD);
    } else {
      hideWarp();
    }
    return;
  }
  if (!travelDest) return;

  // Compute stop point: offset from object center at a comfortable viewing distance
  const objR = travelDest.radius || 0.3;
  const stopR = exploreMode
    ? Math.max(0.5, objR * (exploreDest?.vMult || 8))  // match dwell orbit radius
    : Math.max(objR * 4, objR * 6);                      // nav computer: 6× object radius, min 4×
  const _stopDir = new THREE.Vector3().subVectors(travelDest.position, travelOrigin).normalize();
  const stopPt = travelDest.position.clone().addScaledVector(_stopDir, -stopR);

  if (exploreMode) {
    // ── Explore mode: fixed duration cinematic travel ──
    travelElapsed = Math.min(travelElapsed + dt, TRAVEL_DURATION);
    const p = travelElapsed / TRAVEL_DURATION;
    // Quintic ease-out for ultra-smooth deceleration into arrival
    const ease = p < 0.5 ? 16*p*p*p*p*p : 1 - Math.pow(-2*p+2, 5)/2;
    camera.position.lerpVectors(travelOrigin, stopPt, ease);
    // Warp intensity: bell curve, but taper off earlier for smooth finish
    const warpInt = Math.sin(Math.min(p * 1.15, 1) * Math.PI);
    travelSpeed = C_AU_S * warpInt;
    _tD.copy(_stopDir);

    const ty = Math.atan2(-_tD.x, -_tD.z);
    const tp = Math.asin(Math.max(-1, Math.min(1, _tD.y)));
    yaw   += (ty - yaw)   * Math.min(1, dt * 2);
    pitch += (tp - pitch) * Math.min(1, dt * 2);

    // Turbulence only in mid-flight, taper off in last 30%
    const turbFade = p > 0.7 ? (1 - p) / 0.3 : 1;
    if (warpInt > 0.35 && turbFade > 0.01) {
      const sh = warpInt * warpInt * 0.0018 * turbFade;
      camera.position.x += (Math.random()-0.5)*sh;
      camera.position.y += (Math.random()-0.5)*sh;
      camera.position.z += (Math.random()-0.5)*sh;
    }

    renderWarp(dt, travelActive, travelSpeed, C_AU_S, _tD);

    const rem = Math.max(0, TRAVEL_DURATION - travelElapsed);
    document.getElementById('t-spd').textContent  = formatSpeed(travelSpeed);
    document.getElementById('t-dist').textContent = formatDist(camera.position.distanceTo(stopPt));
    document.getElementById('t-eta').textContent  = rem.toFixed(1) + 's';

    if (p >= 1) {
      camera.position.copy(stopPt);
      if (travelDest.simbadResult) travelToSIMBADResult(travelDest.simbadResult, true);
      if (travelDest.scaleLevel !== undefined && currentScale !== travelDest.scaleLevel) {
        currentScale = travelDest.scaleLevel; applyScale();
      }
      abortTravel(true);
    }
  } else {
    // ── Nav Computer: respect user-chosen speed ──
    const chosenAuS = TRAVEL_SPEEDS[travelSpeedIdx].au_s;
    travelSpeed = chosenAuS;
    _tD.copy(_stopDir);

    // Move camera at chosen speed
    const step = chosenAuS * dt;
    const remaining = camera.position.distanceTo(stopPt);
    if (step >= remaining) {
      camera.position.copy(stopPt);
    } else {
      camera.position.addScaledVector(_tD, step);
    }

    // Camera faces destination
    const ty = Math.atan2(-_tD.x, -_tD.z);
    const tp = Math.asin(Math.max(-1, Math.min(1, _tD.y)));
    yaw   += (ty - yaw)   * Math.min(1, dt * 2);
    pitch += (tp - pitch) * Math.min(1, dt * 2);

    // Turbulence at high speed
    const warpInt = Math.min(1, chosenAuS / C_AU_S);
    if (warpInt > 0.35) {
      const sh = warpInt * warpInt * 0.0022;
      camera.position.x += (Math.random()-0.5)*sh;
      camera.position.y += (Math.random()-0.5)*sh;
      camera.position.z += (Math.random()-0.5)*sh;
    }

    renderWarp(dt, travelActive, travelSpeed, C_AU_S, _tD);

    // HUD: show speed, remaining distance, ETA
    const distLeft = camera.position.distanceTo(stopPt);
    const eta = chosenAuS > 0 ? distLeft / chosenAuS : Infinity;
    document.getElementById('t-spd').textContent  = formatSpeed(chosenAuS);
    document.getElementById('t-dist').textContent = formatDist(distLeft);
    document.getElementById('t-eta').textContent  = eta < 3600 ? eta.toFixed(1) + 's' : eta < 86400 ? (eta/3600).toFixed(1) + 'h' : (eta/86400).toFixed(1) + 'd';

    // Arrival
    if (camera.position.distanceTo(stopPt) < step * 0.5 || camera.position.distanceTo(stopPt) < 0.0001) {
      camera.position.copy(stopPt);
      if (travelDest.simbadResult) travelToSIMBADResult(travelDest.simbadResult, true);
      if (travelDest.scaleLevel !== undefined && currentScale !== travelDest.scaleLevel) {
        currentScale = travelDest.scaleLevel; applyScale();
      }
      abortTravel(true);
    }
  }
}


// ═══════════════════════════════════════════════
//  CAMERA CONTROLS
// ═══════════════════════════════════════════════
const keys = {};
let mouseDown = false;
let yaw = Math.PI, pitch = -0.3;
let roll = 0;
let moveSpeed = 0.05; // AU per second
let speedLevel = 10; // logarithmic
const MIN_SPEED_LEVEL = 0;
const MAX_SPEED_LEVEL = 40;

let currentScale = 0; // index into SCALE_LEVELS (0=Solar System)
let simTime = 2026.0;
let timeRateIndex = 2;
const TIME_RATES = [0, 0.1, 1, 10, 100, 1000, 10000];
const TIME_RATE_LABELS = ['Paused', '0.1 day/s', '1 day/s', '10 day/s', '100 day/s', '~3 yr/s', '~27 yr/s'];
let hudVisible = true;

function getSpeedFromLevel(level) {
  // level 0 = 1e-8 AU/s ≈ 1.5 m/s
  // level 20 = 1 AU/s
  // level 40 = 1e6 AU/s ≈ 15 ly/s
  return Math.pow(10, (level - 20) * 0.3);
}

let controlsOpen = false;
function toggleControls() {
  controlsOpen = !controlsOpen;
  document.getElementById('controls-overlay').classList.toggle('open', controlsOpen);
}
document.getElementById('controls-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('controls-overlay')) toggleControls();
});
document.getElementById('controls-close-btn').addEventListener('click', () => {
  controlsOpen = true; toggleControls(); // toggleControls will flip to false and close
});

document.addEventListener('keydown', e => {
  if (searchOpen)      { if (e.code === 'Escape') closeSearch();      return; }
  if (travelPanelOpen) { if (e.code === 'Escape' || e.code === 'KeyT') closeTravelPanel(); return; }
  if (controlsOpen)    { if (e.code === 'Escape' || e.code === 'KeyC') toggleControls();   return; }
  if (travelActive)    { if (e.code === 'Escape') { abortTravel(); return; } }
  // Any movement key during explore dwell breaks out of cinematic mode
  if (exploreMode && explorePhase === 'dwell') {
    const movKeys = ['KeyW','KeyS','KeyA','KeyD','Space','ShiftLeft','ShiftRight','KeyQ','KeyE'];
    if (movKeys.includes(e.code)) { stopExploreMode(); }
  }
  if (e.code === 'Escape' && exploreMode) { stopExploreMode(); return; }
  if (e.code === 'KeyR') { exploreMode ? stopExploreMode() : startExploreMode(); e.preventDefault(); return; }
  if (e.code === 'KeyT') { openTravelPanel(); e.preventDefault(); return; }
  if (e.code === 'KeyC') { toggleControls(); e.preventDefault(); return; }
  if (e.code === 'KeyF') { openSearch(); e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === 'KeyP') { timeRateIndex = timeRateIndex === 0 ? 2 : 0; }
  if (e.code >= 'Digit1' && e.code <= 'Digit6') { timeRateIndex = parseInt(e.code.slice(5)); }
  if (e.code === 'KeyH') { hudVisible = !hudVisible; document.getElementById('hud').classList.toggle('active', hudVisible); }
  if (e.code === 'Tab') { e.preventDefault(); currentScale = (currentScale + 1) % SCALE_LEVELS.length; applyScale(); }
  if (e.code === 'KeyG') goToNearest();
  e.preventDefault();
});
document.addEventListener('keyup', e => { keys[e.code] = false; });

document.addEventListener('mousemove', e => {
  if (!mouseDown || !started || travelActive) return;
  yaw -= e.movementX * 0.003;
  pitch -= e.movementY * 0.003;
  pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
});

document.addEventListener('mousedown', e => { if (started) mouseDown = true; });
document.addEventListener('mouseup', () => { mouseDown = false; });

document.addEventListener('wheel', e => {
  speedLevel = Math.max(MIN_SPEED_LEVEL, Math.min(MAX_SPEED_LEVEL, speedLevel + (e.deltaY > 0 ? -1 : 1)));
  moveSpeed = getSpeedFromLevel(speedLevel);
}, { passive: true });

// Pointer lock for smoother control (desktop only)
if (!isMobile) {
  renderer.domElement.addEventListener('click', () => {
    if (started) renderer.domElement.requestPointerLock && renderer.domElement.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    if (document.pointerLockElement === renderer.domElement) mouseDown = true;
    else mouseDown = false;
  });
}

// ═══════════════════════════════════════════════
//  MOBILE TOUCH CONTROLS
// ═══════════════════════════════════════════════
if (isMobile) {
  const mobMenu = document.getElementById('mobile-menu');
  const mobToggle = document.getElementById('mob-menu-toggle');
  const mobPanel = document.getElementById('mob-menu-panel');
  let mobMenuOpen = false;

  mobToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    mobMenuOpen = !mobMenuOpen;
    mobPanel.classList.toggle('open', mobMenuOpen);
    mobToggle.classList.toggle('open', mobMenuOpen);
  });

  // Close menu when tapping outside
  document.addEventListener('click', (e) => {
    if (mobMenuOpen && !mobPanel.contains(e.target) && e.target !== mobToggle) {
      mobMenuOpen = false;
      mobPanel.classList.remove('open');
      mobToggle.classList.remove('open');
    }
  });

  function _closeMenu() {
    mobMenuOpen = false;
    mobPanel.classList.remove('open');
    mobToggle.classList.remove('open');
  }

  // Hold-to-fly buttons
  let _flyInterval = null;
  function _startFly(key) {
    keys[key] = true;
    _flyInterval = setInterval(() => { keys[key] = true; }, 50);
    _closeMenu();
  }
  function _stopFly(key) {
    keys[key] = false;
    if (_flyInterval) { clearInterval(_flyInterval); _flyInterval = null; }
  }

  const flyFwd = document.getElementById('mob-fly-fwd');
  const flyBack = document.getElementById('mob-fly-back');
  const flyUp = document.getElementById('mob-fly-up');
  const flyDown = document.getElementById('mob-fly-down');

  flyFwd.addEventListener('touchstart', (e) => { e.preventDefault(); _startFly('KeyW'); }, { passive: false });
  flyFwd.addEventListener('touchend', () => _stopFly('KeyW'));
  flyFwd.addEventListener('touchcancel', () => _stopFly('KeyW'));
  flyBack.addEventListener('touchstart', (e) => { e.preventDefault(); _startFly('KeyS'); }, { passive: false });
  flyBack.addEventListener('touchend', () => _stopFly('KeyS'));
  flyBack.addEventListener('touchcancel', () => _stopFly('KeyS'));
  flyUp.addEventListener('touchstart', (e) => { e.preventDefault(); _startFly('Space'); }, { passive: false });
  flyUp.addEventListener('touchend', () => _stopFly('Space'));
  flyUp.addEventListener('touchcancel', () => _stopFly('Space'));
  flyDown.addEventListener('touchstart', (e) => { e.preventDefault(); _startFly('ShiftLeft'); }, { passive: false });
  flyDown.addEventListener('touchend', () => _stopFly('ShiftLeft'));
  flyDown.addEventListener('touchcancel', () => _stopFly('ShiftLeft'));

  // Touch look: one-finger drag on canvas rotates camera
  let lookTouchId = null, lookLastX = 0, lookLastY = 0;

  renderer.domElement.addEventListener('touchstart', e => {
    if (e.touches.length === 1) {
      lookTouchId = e.touches[0].identifier;
      lookLastX = e.touches[0].clientX;
      lookLastY = e.touches[0].clientY;
    }
  }, { passive: true });

  renderer.domElement.addEventListener('touchmove', e => {
    if (lookTouchId === null) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === lookTouchId) {
        if (!started || travelActive || _arrivalOrbit.active) return;
        const dx = t.clientX - lookLastX;
        const dy = t.clientY - lookLastY;
        yaw -= dx * 0.004;
        pitch -= dy * 0.004;
        pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
        lookLastX = t.clientX;
        lookLastY = t.clientY;
        break;
      }
    }
  }, { passive: true });

  renderer.domElement.addEventListener('touchend', e => {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === lookTouchId) { lookTouchId = null; break; }
    }
  });

  // Pinch to zoom (adjust speed)
  let pinchDist0 = 0;
  renderer.domElement.addEventListener('touchstart', e => {
    if (e.touches.length === 2) {
      lookTouchId = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDist0 = Math.sqrt(dx*dx + dy*dy);
    }
  }, { passive: true });

  renderer.domElement.addEventListener('touchmove', e => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const d = Math.sqrt(dx*dx + dy*dy);
      const delta = d - pinchDist0;
      if (Math.abs(delta) > 5) {
        speedLevel = Math.max(MIN_SPEED_LEVEL, Math.min(MAX_SPEED_LEVEL, speedLevel + (delta > 0 ? 1 : -1)));
        moveSpeed = getSpeedFromLevel(speedLevel);
        pinchDist0 = d;
      }
    }
  }, { passive: true });

  // Speed buttons
  document.getElementById('mob-speed-up').addEventListener('click', () => {
    speedLevel = Math.min(MAX_SPEED_LEVEL, speedLevel + 3);
    moveSpeed = getSpeedFromLevel(speedLevel);
  });
  document.getElementById('mob-speed-down').addEventListener('click', () => {
    speedLevel = Math.max(MIN_SPEED_LEVEL, speedLevel - 3);
    moveSpeed = getSpeedFromLevel(speedLevel);
  });

  // Tools
  document.getElementById('mob-search').addEventListener('click', () => { _closeMenu(); openSearch(); });
  document.getElementById('mob-nav').addEventListener('click', () => { _closeMenu(); openTravelPanel(); });
  document.getElementById('mob-explore').addEventListener('click', () => {
    _closeMenu(); exploreMode ? stopExploreMode() : startExploreMode();
  });
  document.getElementById('mob-controls').addEventListener('click', () => { _closeMenu(); toggleControls(); });
  document.getElementById('mob-report').addEventListener('click', () => { _closeMenu(); generateMissionReport(); });
  document.getElementById('mob-satellites').addEventListener('click', () => { _closeMenu(); toggleSatellites(); });

  // View
  document.getElementById('mob-scale').addEventListener('click', () => {
    _closeMenu(); currentScale = (currentScale + 1) % SCALE_LEVELS.length; applyScale();
  });
  document.getElementById('mob-nearest').addEventListener('click', () => { _closeMenu(); goToNearest(); });
  document.getElementById('mob-time').addEventListener('click', () => { _closeMenu(); timeRateIndex = timeRateIndex === 0 ? 2 : 0; });
  document.getElementById('mob-time-faster').addEventListener('click', () => {
    _closeMenu(); timeRateIndex = Math.min(TIME_RATES.length - 1, timeRateIndex + 1);
  });
  document.getElementById('mob-time-slower').addEventListener('click', () => {
    _closeMenu(); timeRateIndex = Math.max(0, timeRateIndex - 1);
  });
  document.getElementById('mob-hud-toggle').addEventListener('click', () => {
    _closeMenu(); hudVisible = !hudVisible; document.getElementById('hud').classList.toggle('active', hudVisible);
  });

  // Show/hide
  const _origShowHud = () => { mobMenu.classList.add('active'); };
  const _origHideHud = () => { mobMenu.classList.remove('active'); _closeMenu(); };

  window._mobileApplyJoystick = () => {}; // no joystick anymore
  window._mobileHideControls = _origHideHud;
  window._mobileShowControls = _origShowHud;
}

function goToNearest() {
  let minDist = Infinity, target = null;
  bodyPositions.forEach(b => {
    const d = camera.position.distanceTo(b.pos);
    if (d > 0.001 && d < minDist) { minDist = d; target = b; }
  });
  if (target) {
    const dir = new THREE.Vector3().subVectors(target.pos, camera.position).normalize();
    camera.position.copy(target.pos).addScaledVector(dir, -(target.radius * 3 + 0.05));
    yaw = Math.atan2(-dir.x, -dir.z);
    pitch = Math.asin(dir.y);
  }
}

// ═══════════════════════════════════════════════
//  SCALE MANAGEMENT
// ═══════════════════════════════════════════════
// Scale transition system
let _scaleTransition = null; // { from, to, progress, duration, fromNear, fromFar, fromFog, toNear, toFar, toFog, fromSpeed, toSpeed, targetPos }

const _SCALE_PARAMS = [
  { near: 0.0001, far: 5000, fog: 0.0008, speed: 10, pos: null },                // 0: Solar System
  { near: 0.1, far: 5000000, fog: 0.0000001, speed: 25, pos: [0, 10000, 30000] }, // 1: Stellar
  { near: 100, far: 5e9, fog: 0, speed: 32, pos: [0, 1e7, 3e7] },               // 2: Galactic
  { near: 1e6, far: 1e14, fog: 0, speed: 38, pos: [0, 1e11, 3e11] }             // 3: Cosmic
];

function _setScaleVisibility(level) {
  sunGroup.visible = level <= 0;
  planetMeshes.forEach(p => p.mesh.visible = level <= 0);
  orbitLines.forEach(l => l.visible = level <= 0);
  atomGroup.visible = false; // atomic scale removed
  namedStarMeshes.forEach(m => m.visible = level === 1);
  liveStarMeshes.forEach(m => m.visible = level === 1);
  exoplanetMarkers.forEach(m => m.visible = level === 1);
  deepSkyMeshes.forEach(m => m.visible = level === 2);
  galaxyGroup.visible = level === 2;
  galaxyCatalogMeshes.forEach(m => m.visible = level === 3);
  cosmicGroup.visible = level === 3;
  lightSphere.visible = level === 0;
  _bgRefObjects.forEach(o => { o.marker.visible = level === o.scale; });
}

function applyScale() {
  const level = currentScale;

  // Lazy-load catalogs
  if (level === 1) loadGaiaStars();
  if (level === 3) loadNearbyGalaxies();

  const params = _SCALE_PARAMS[level];
  const prevParams = _scaleTransition ? _SCALE_PARAMS[_scaleTransition.from] : null;

  // If there's a previous scale to transition from, animate
  if (prevParams && !_scaleTransition) {
    // Just do the instant transition for now — the cross-fade is below
  }

  // Set visibility for new scale (show both during transition handled in updateTransition)
  _setScaleVisibility(level);

  // Start smooth camera parameter transition
  const fromNear = camera.near, fromFar = camera.far, fromFog = scene.fog.density;
  const fromSpeed = speedLevel;
  _scaleTransition = {
    from: -1, to: level,
    progress: 0, duration: 2.5,
    fromNear, fromFar, fromFog,
    toNear: params.near, toFar: params.far, toFog: params.fog,
    fromSpeed, toSpeed: params.speed,
    targetPos: params.pos ? new THREE.Vector3(...params.pos) : null
  };

  // Immediately update near/far to max range to avoid clipping during transition
  camera.near = Math.min(fromNear, params.near);
  camera.far = Math.max(fromFar, params.far);
  camera.updateProjectionMatrix();
}

function _updateScaleTransition(dt) {
  if (!_scaleTransition) return;
  const tr = _scaleTransition;
  tr.progress = Math.min(1, tr.progress + dt / tr.duration);
  const t = tr.progress;
  // Smoothstep easing
  const e = t * t * (3 - 2 * t);

  // Log-space interpolation for near/far (spans orders of magnitude)
  camera.near = Math.exp(Math.log(tr.fromNear) * (1 - e) + Math.log(tr.toNear) * e);
  camera.far = Math.exp(Math.log(Math.max(tr.fromFar, 1)) * (1 - e) + Math.log(Math.max(tr.toFar, 1)) * e);
  scene.fog.density = tr.fromFog * (1 - e) + tr.toFog * e;
  camera.updateProjectionMatrix();

  // Smooth speed interpolation
  speedLevel = Math.round(tr.fromSpeed * (1 - e) + tr.toSpeed * e);
  moveSpeed = getSpeedFromLevel(speedLevel);

  // Smooth camera position move (if target specified)
  if (tr.targetPos) {
    camera.position.lerp(tr.targetPos, Math.min(1, dt * 0.7));
  }

  if (t >= 1) {
    camera.near = tr.toNear;
    camera.far = tr.toFar;
    scene.fog.density = tr.toFog;
    camera.updateProjectionMatrix();
    speedLevel = tr.toSpeed;
    moveSpeed = getSpeedFromLevel(tr.toSpeed);
    _scaleTransition = null;
  }
}

// ═══════════════════════════════════════════════
//  HUD
// ═══════════════════════════════════════════════
const hudSpeed = document.getElementById('hud-speed');
const hudSpeedC = document.getElementById('hud-speed-c');
const hudDist = document.getElementById('hud-dist');
const hudLightTime = document.getElementById('hud-light-time');
const hudNearestName = document.getElementById('hud-nearest-name');
const hudNearestInfo = document.getElementById('hud-nearest-info');
const hudScale = document.getElementById('hud-scale');
const hudTimeRate = document.getElementById('hud-time-rate');
const hudDate = document.getElementById('hud-date');
const hudPos = document.getElementById('hud-pos');
const scalebar = document.getElementById('scale-bar');
const timebar = document.getElementById('time-bar');

// Build scale pips
SCALE_LEVELS.forEach((s, i) => {
  const pip = document.createElement('div');
  pip.className = 'scale-pip' + (i === currentScale ? ' active' : '');
  pip.title = s.name;
  scalebar.appendChild(pip);
});

// Build time pips
TIME_RATES.forEach((_, i) => {
  const pip = document.createElement('div');
  pip.className = 'time-pip';
  timebar.appendChild(pip);
});

function formatSpeed(auPerSec) {
  const kms = auPerSec * AU;
  const ms = kms * 1000;
  if (ms < 1000) return ms.toFixed(1) + ' m/s';
  if (kms < 1) return (kms * 1000).toFixed(0) + ' m/s';
  if (kms < C_KMS * 0.01) return kms.toFixed(1) + ' km/s';
  const c = kms / C_KMS;
  if (c < 1000) return c.toFixed(1) + ' c';
  if (c < 1e6)  return (c / 1000).toFixed(1) + 'k c';
  if (c < 1e9)  return (c / 1e6).toFixed(2) + 'M c';
  return (c / 1e9).toFixed(2) + 'B c';
}

function formatDist(au) {
  if (au < 0.001) return (au * AU).toFixed(0) + ' km';
  if (au < 100) return au.toFixed(4) + ' AU';
  const ly = au / 63241;
  if (ly < 1000) return ly.toFixed(2) + ' ly';
  if (ly < 1e6) return (ly / 1000).toFixed(2) + ' kly';
  return (ly / 1e6).toFixed(2) + ' Mly';
}

function formatLightTime(au) {
  const seconds = au / C_AU_S;
  if (seconds < 60) return seconds.toFixed(1) + 's';
  if (seconds < 3600) return (seconds / 60).toFixed(1) + ' min';
  if (seconds < 86400) return (seconds / 3600).toFixed(1) + ' hr';
  return (seconds / 86400).toFixed(1) + ' days';
}

function updateHUD() {
  hudSpeed.textContent = formatSpeed(moveSpeed);
  const cFrac = (moveSpeed * AU) / C_KMS;
  hudSpeedC.textContent = cFrac < 0.001 ? '' : `${cFrac.toFixed(4)}c`;

  const distFromSun = camera.position.length();
  hudDist.textContent = formatDist(distFromSun);
  hudLightTime.textContent = formatLightTime(distFromSun);

  // Nearest body
  let minDist = Infinity, nearest = bodyPositions[0];
  bodyPositions.forEach(b => {
    const d = camera.position.distanceTo(b.pos);
    if (d < minDist) { minDist = d; nearest = b; }
  });
  _nearestBody = nearest;
  hudNearestName.textContent = nearest.name;
  hudNearestInfo.textContent = `${formatDist(minDist)} | Real Ø ${nearest.rReal > 10000 ? (nearest.rReal/1000).toFixed(0) + ' k' : nearest.rReal.toFixed(0)} km`;

  hudScale.textContent = SCALE_LEVELS[currentScale].name;
  scalebar.querySelectorAll('.scale-pip').forEach((pip, i) => pip.classList.toggle('active', i === currentScale));

  hudTimeRate.textContent = TIME_RATE_LABELS[timeRateIndex];
  timebar.querySelectorAll('.time-pip').forEach((pip, i) => {
    pip.classList.toggle('active', i === timeRateIndex);
    pip.classList.toggle('paused', i === 0 && timeRateIndex === 0);
  });

  const yr = Math.floor(simTime);
  const dayOfYear = Math.floor((simTime - yr) * 365.25);
  hudDate.textContent = `${yr}.${String(dayOfYear).padStart(3, '0')}`;

  hudPos.textContent = `x:${camera.position.x.toFixed(2)} y:${camera.position.y.toFixed(2)} z:${camera.position.z.toFixed(2)}`;

  // Update mobile speed label
  if (isMobile) {
    const sl = document.getElementById('mob-speed-label');
    if (sl) sl.textContent = formatSpeed(moveSpeed);
  }
}

// ═══════════════════════════════════════════════
//  AI TICKER — funny/informational scrolling messages
// ═══════════════════════════════════════════════
const _TICKER_MSGS = [
  // General
  "I've been thinking... if light takes 8 minutes from the Sun, your pizza delivery excuse just got cosmic.",
  "Fun fact: You weigh slightly less at the equator. Not enough to skip the gym though.",
  "Space is only an hour's drive away — if your car could drive straight up.",
  "The universe has no center. Much like this conversation.",
  "If you could fold a piece of paper 42 times, it would reach the Moon. Please don't try.",
  // Speed-related
  "At light speed, you could circle Earth 7.5 times per second. Traffic would still be terrible.",
  "Voyager 1 has been traveling since 1977 and still hasn't left the solar system's backyard. Patience.",
  "The fastest human-made object? The Parker Solar Probe at 635,266 km/h. Still slower than my thoughts.",
  // Planet-related
  "Jupiter's Great Red Spot has been raging for over 350 years. That's commitment to a tantrum.",
  "A day on Venus is longer than its year. Even Venus can't get its schedule together.",
  "Saturn would float in water. Good luck finding a bathtub that big.",
  "If you fell into Jupiter, you'd never hit a surface. Just... falling. Forever. Think about that.",
  "Mars has a volcano so tall it pokes out of the atmosphere. Olympus Mons doesn't do subtle.",
  // Distance-related
  "The nearest star is 4.24 light-years away. That's 40 trillion km. Pack a lunch.",
  "Light from the Andromeda Galaxy left 2.5 million years ago. That's some seriously delayed gratification.",
  "If the Sun were a basketball, Earth would be a peppercorn 26 meters away.",
  // Philosophical
  "Every atom in your body was forged inside a dying star. You're literally made of stardust. You're welcome.",
  "The observable universe is 93 billion light-years across. And yet you still can't find your keys.",
  "There are more stars in the universe than grains of sand on Earth. Let that sink in.",
  "If you yelled in space, no one would hear you. But I would. I'm always listening.",
  // Easter egg references
  "I'm detecting some unusual readings on the sensors... probably nothing. Probably.",
  "All systems nominal. Well, mostly. Let's not worry about the ones that aren't.",
  "Have you tried pressing R? The universe is better when it comes to you.",
  "Reminder: in space, nobody can hear your Spotify playlist.",
  "My processors estimate there is a 0.003% chance of encountering something unusual today. Stay alert.",
  // Scale-related
  "You've zoomed out past where anyone at NASA would feel comfortable. I respect that.",
  "At this scale, entire civilizations could exist between the pixels. Just saying.",
  "The cosmic web connects galaxy clusters like neurons in a brain. The universe might be thinking.",
];
let _tickerIdx = Math.floor(Math.random() * _TICKER_MSGS.length);
let _tickerTimer = 0;
const _TICKER_INTERVAL = 24; // seconds between messages

function _updateTicker(dt) {
  _tickerTimer += dt;
  if (_tickerTimer >= _TICKER_INTERVAL) {
    _tickerTimer = 0;
    _tickerIdx = (_tickerIdx + 1) % _TICKER_MSGS.length;
    const el = document.getElementById('hud-ticker-text');
    if (el) el.textContent = _TICKER_MSGS[_tickerIdx];
  }
}

// ═══════════════════════════════════════════════
//  SPACE TRIVIA
// ═══════════════════════════════════════════════
const _TRIVIA = [
  { q: "How long does it take sunlight to reach Earth?", a: "About 8 minutes and 20 seconds." },
  { q: "What is the hottest planet in our solar system?", a: "Venus — at 465°C (869°F), hotter than Mercury despite being farther from the Sun." },
  { q: "How many Earths could fit inside Jupiter?", a: "About 1,300. Jupiter's volume is massive." },
  { q: "What is a neutron star made of?", a: "Almost entirely neutrons — so dense that a teaspoon weighs about 6 billion tons." },
  { q: "How fast does the ISS orbit Earth?", a: "About 28,000 km/h (17,500 mph) — it circles Earth every 90 minutes." },
  { q: "Which planet has the shortest day?", a: "Jupiter — it rotates once every 9 hours 56 minutes." },
  { q: "How old is the universe?", a: "Approximately 13.8 billion years old, based on cosmic microwave background data." },
  { q: "What causes Saturn's rings?", a: "Billions of particles of ice and rock, ranging from tiny grains to house-sized chunks." },
  { q: "Can you hear sound in space?", a: "No — space is a near-perfect vacuum with no medium for sound waves to travel through." },
  { q: "What is the Great Red Spot?", a: "A massive storm on Jupiter that has been raging for at least 350 years. It's larger than Earth." },
  { q: "How far is the nearest star (other than the Sun)?", a: "Proxima Centauri — about 4.24 light-years away, or 40 trillion km." },
  { q: "What is a light-year?", a: "The distance light travels in one year: about 9.46 trillion kilometers." },
  { q: "Which planet rotates on its side?", a: "Uranus — it's tilted 98° from its orbital plane, possibly from an ancient collision." },
  { q: "How many moons does Mars have?", a: "Two: Phobos and Deimos. Both are small and irregularly shaped." },
  { q: "What is the largest volcano in the solar system?", a: "Olympus Mons on Mars — 21.9 km tall, nearly 3× the height of Mount Everest." },
  { q: "What percentage of the universe is dark matter?", a: "About 27%. Dark energy makes up 68%. Normal matter is only ~5%." },
  { q: "What is the Karman line?", a: "The boundary of space at 100 km altitude, internationally recognized as where space begins." },
  { q: "How long would it take to drive to the Moon?", a: "At highway speed (100 km/h), about 160 days non-stop." },
  { q: "What is the largest known structure in the universe?", a: "The Hercules–Corona Borealis Great Wall — about 10 billion light-years across." },
  { q: "Why is Mars red?", a: "Iron oxide (rust) in the soil and dust gives Mars its reddish appearance." },
  { q: "How many galaxies are in the observable universe?", a: "An estimated 2 trillion (2,000,000,000,000) galaxies." },
  { q: "What was the first animal sent to space?", a: "Fruit flies in 1947 (V-2 rocket). Laika the dog orbited Earth in 1957." },
  { q: "How long is a day on Venus?", a: "243 Earth days — longer than its year (225 Earth days). Venus also rotates backward." },
  { q: "What is the coldest place in the solar system?", a: "Triton (Neptune's moon) at −235°C, or possibly permanently shadowed lunar craters." },
  { q: "What is the fastest human-made object?", a: "Parker Solar Probe — reached 635,266 km/h (0.05% the speed of light) in 2024." },
  { q: "How much would you weigh on the Moon?", a: "About 1/6 of your Earth weight. A 180 lb person would weigh 30 lbs." },
  { q: "What is a pulsar?", a: "A rapidly spinning neutron star that emits beams of radiation like a cosmic lighthouse." },
  { q: "How big is the observable universe?", a: "About 93 billion light-years in diameter." },
  { q: "What is the Oort Cloud?", a: "A theoretical shell of icy objects surrounding our solar system, up to 2 light-years away." },
  { q: "Which Apollo mission had the famous 'Houston, we've had a problem'?", a: "Apollo 13, in April 1970. The crew survived despite an oxygen tank explosion." },
];

let _triviaIdx = Math.floor(Math.random() * _TRIVIA.length);
let _triviaTimer = 0;
let _triviaPhase = 'question'; // question → answer → pause → next
const _TRIVIA_Q_TIME = 12;  // show question for 12s
const _TRIVIA_A_TIME = 15;  // show answer for 15s
let _triviaCollapsed = false;

// Init trivia
document.getElementById('trivia-toggle').addEventListener('click', () => {
  _triviaCollapsed = !_triviaCollapsed;
  document.getElementById('trivia-panel').classList.toggle('collapsed', _triviaCollapsed);
  _positionTriviaPanel();
});

function _positionTriviaPanel() {
  const factsPanel = document.getElementById('facts-panel');
  const triviaPanel = document.getElementById('trivia-panel');
  if (!factsPanel || !triviaPanel) return;
  const triviaH = triviaPanel.offsetHeight;
  factsPanel.style.bottom = (16 + triviaH + 6) + 'px';
}
// Reposition when trivia panel collapses/expands
const _tpObserver = new MutationObserver(_positionTriviaPanel);
const _tpEl = document.getElementById('trivia-panel');
if (_tpEl) _tpObserver.observe(_tpEl, { attributes: true, attributeFilter: ['class'], subtree: true });
const _fpEl = document.getElementById('facts-panel');
if (_fpEl) { const _fpObs = new MutationObserver(_positionTriviaPanel); _fpObs.observe(_fpEl, { attributes: true, attributeFilter: ['class'], subtree: true }); }
setTimeout(_positionTriviaPanel, 100);
// Show first question
(function _initTrivia() {
  const qEl = document.getElementById('trivia-question');
  const aEl = document.getElementById('trivia-answer');
  if (qEl) qEl.textContent = '❓ ' + _TRIVIA[_triviaIdx].q;
  if (aEl) { aEl.textContent = _TRIVIA[_triviaIdx].a; aEl.classList.remove('show'); }
})();

function _updateTrivia(dt) {
  // Keep trivia positioned above facts panel
  if (Math.floor(_triviaTimer) % 3 === 0 && _triviaTimer - Math.floor(_triviaTimer) < dt) _positionTriviaPanel();
  if (_triviaCollapsed) return;
  _triviaTimer += dt;
  const qEl = document.getElementById('trivia-question');
  const aEl = document.getElementById('trivia-answer');
  if (!qEl || !aEl) return;

  if (_triviaPhase === 'question' && _triviaTimer >= _TRIVIA_Q_TIME) {
    // Reveal answer
    _triviaPhase = 'answer';
    _triviaTimer = 0;
    aEl.classList.add('show');
  } else if (_triviaPhase === 'answer' && _triviaTimer >= _TRIVIA_A_TIME) {
    // Next question
    _triviaPhase = 'question';
    _triviaTimer = 0;
    _triviaIdx = (_triviaIdx + 1) % _TRIVIA.length;
    qEl.textContent = '❓ ' + _TRIVIA[_triviaIdx].q;
    aEl.textContent = _TRIVIA[_triviaIdx].a;
    aEl.classList.remove('show');
  }
}

// ═══════════════════════════════════════════════
//  ASTRO REPORT
// ═══════════════════════════════════════════════
function generateMissionReport() {
  const nearest = _nearestBody;
  const name = nearest?.name || 'Unknown';
  const distAU = camera.position.distanceTo(nearest?.pos || new THREE.Vector3());
  const distKM = distAU * AU;
  const distLY = distAU / 63241;

  // Real distances from Sun for known bodies (AU)
  const realDistFromEarth = {
    Sun: 1.0, Mercury: 0.61, Venus: 0.28, Earth: 0, Mars: 0.52,
    Jupiter: 4.2, Saturn: 8.5, Uranus: 18.2, Neptune: 29.1
  };
  const earthDistAU = realDistFromEarth[name] !== undefined ? realDistFromEarth[name] : distAU;
  const earthDistKM = earthDistAU * AU;

  // Light travel time
  const lightTimeSec = earthDistKM / 299792.458;
  let lightTimeStr;
  if (lightTimeSec < 60) lightTimeStr = lightTimeSec.toFixed(1) + ' seconds';
  else if (lightTimeSec < 3600) lightTimeStr = (lightTimeSec / 60).toFixed(1) + ' minutes';
  else if (lightTimeSec < 86400) lightTimeStr = (lightTimeSec / 3600).toFixed(2) + ' hours';
  else if (lightTimeSec < 86400 * 365.25) lightTimeStr = (lightTimeSec / 86400).toFixed(1) + ' days';
  else lightTimeStr = (lightTimeSec / (86400 * 365.25)).toFixed(2) + ' years';

  // Travel times at various speeds
  const speeds = [
    { name: 'Walking (5 km/h)', kms: 0.00139 },
    { name: 'Commercial jet (900 km/h)', kms: 0.25 },
    { name: 'Apollo 10 (39,897 km/h)', kms: 11.08 },
    { name: 'Voyager 1 (17 km/s)', kms: 17 },
    { name: 'Parker Solar Probe (163 km/s)', kms: 163 },
    { name: '10% speed of light', kms: 29979 },
    { name: 'Speed of light', kms: 299792.458 }
  ];

  function fmtTime(seconds) {
    if (seconds < 60) return seconds.toFixed(1) + ' sec';
    if (seconds < 3600) return (seconds / 60).toFixed(1) + ' min';
    if (seconds < 86400) return (seconds / 3600).toFixed(1) + ' hours';
    if (seconds < 86400 * 365.25) return (seconds / 86400).toFixed(1) + ' days';
    const years = seconds / (86400 * 365.25);
    if (years < 1000) return years.toFixed(1) + ' years';
    if (years < 1e6) return (years / 1000).toFixed(1) + ' thousand years';
    if (years < 1e9) return (years / 1e6).toFixed(1) + ' million years';
    return (years / 1e9).toFixed(1) + ' billion years';
  }

  // Relativity: time dilation at 90% c
  const v = 0.9; // 90% of c
  const gamma = 1 / Math.sqrt(1 - v * v); // Lorentz factor
  const travelTimeEarth = earthDistKM / (v * 299792.458); // seconds
  const travelTimeShip = travelTimeEarth / gamma;

  // 99.99% c
  const v2 = 0.9999;
  const gamma2 = 1 / Math.sqrt(1 - v2 * v2);
  const travelTimeEarth2 = earthDistKM / (v2 * 299792.458);
  const travelTimeShip2 = travelTimeEarth2 / gamma2;

  // Interesting facts
  const diameterKM = (nearest?.rReal || 0) * 2;
  const howManyEarths = diameterKM > 0 ? ((nearest?.rReal || 1) / 6371).toFixed(1) : '?';
  const tempC = (nearest?.temp || 0) > 0 ? `${nearest.temp} K (${(nearest.temp - 273.15).toFixed(0)}°C)` : 'Unknown';

  // Build report HTML
  let html = '';

  // Distance section
  html += `<div class="report-section">
    <div class="report-section-title">Distance from Earth</div>
    <div class="report-row"><span class="report-label">Kilometers</span><span class="report-value">${earthDistKM > 1e9 ? (earthDistKM / 1e9).toFixed(2) + ' billion km' : earthDistKM > 1e6 ? (earthDistKM / 1e6).toFixed(1) + ' million km' : earthDistKM.toFixed(0) + ' km'}</span></div>
    <div class="report-row"><span class="report-label">Astronomical Units</span><span class="report-value">${earthDistAU.toFixed(4)} AU</span></div>
    ${distLY > 0.001 ? `<div class="report-row"><span class="report-label">Light Years</span><span class="report-value">${distLY < 1 ? (distLY * 365.25).toFixed(1) + ' light-days' : distLY.toFixed(2) + ' ly'}</span></div>` : ''}
    <div class="report-row"><span class="report-label">Light travel time</span><span class="report-value">${lightTimeStr}</span></div>
  </div>`;

  // Object info section
  if (diameterKM > 0) {
    html += `<div class="report-section">
      <div class="report-section-title">Object Profile</div>
      ${diameterKM > 0 ? `<div class="report-row"><span class="report-label">Diameter</span><span class="report-value">${diameterKM > 1e6 ? (diameterKM / 1e6).toFixed(2) + ' million km' : diameterKM.toFixed(0) + ' km'}</span></div>` : ''}
      <div class="report-row"><span class="report-label">Size vs Earth</span><span class="report-value">${howManyEarths}× Earth radius</span></div>
      ${nearest?.temp ? `<div class="report-row"><span class="report-label">Temperature</span><span class="report-value">${tempC}</span></div>` : ''}
    </div>`;
  }

  // Travel times section
  html += `<div class="report-section">
    <div class="report-section-title">How long to get there?</div>`;
  speeds.forEach(s => {
    const sec = earthDistKM / s.kms;
    html += `<div class="report-row"><span class="report-label">${s.name}</span><span class="report-value">${fmtTime(sec)}</span></div>`;
  });
  html += `</div>`;

  // Relativity section
  html += `<div class="report-section">
    <div class="report-section-title">Einstein{"'"}s Relativity</div>
    <div class="report-row"><span class="report-label">At 90% light speed (0.9c)</span><span class="report-value"></span></div>
    <div class="report-row"><span class="report-label">&nbsp;&nbsp;Time on Earth</span><span class="report-value">${fmtTime(travelTimeEarth)}</span></div>
    <div class="report-row"><span class="report-label">&nbsp;&nbsp;Time on the ship</span><span class="report-value">${fmtTime(travelTimeShip)}</span></div>
    <div class="report-row"><span class="report-label">&nbsp;&nbsp;Lorentz factor (γ)</span><span class="report-value">${gamma.toFixed(2)}×</span></div>
    <div class="report-row"><span class="report-label">At 99.99% light speed (0.9999c)</span><span class="report-value"></span></div>
    <div class="report-row"><span class="report-label">&nbsp;&nbsp;Time on Earth</span><span class="report-value">${fmtTime(travelTimeEarth2)}</span></div>
    <div class="report-row"><span class="report-label">&nbsp;&nbsp;Time on the ship</span><span class="report-value">${fmtTime(travelTimeShip2)}</span></div>
    <div class="report-row"><span class="report-label">&nbsp;&nbsp;Lorentz factor (γ)</span><span class="report-value">${gamma2.toFixed(1)}×</span></div>
  </div>`;

  // Mind-bending facts
  const ageDiffYears = (travelTimeEarth - travelTimeShip) / (86400 * 365.25);
  const ageDiffYears2 = (travelTimeEarth2 - travelTimeShip2) / (86400 * 365.25);
  const walkYears = earthDistKM / (0.00139 * 86400 * 365.25);
  const lifetimes = walkYears / 80;

  let mindBlown = '';
  if (ageDiffYears2 > 0.01) {
    mindBlown += `<p>At 99.99% the speed of light, you'd arrive having aged <strong>${fmtTime(travelTimeShip2)}</strong>, but everyone on Earth would have aged <strong>${fmtTime(travelTimeEarth2)}</strong>. You'd come back <strong>${ageDiffYears2 > 1 ? ageDiffYears2.toFixed(1) + ' years' : (ageDiffYears2 * 365.25).toFixed(0) + ' days'}</strong> younger than your twin who stayed home.</p>`;
  }
  if (lifetimes > 1) {
    mindBlown += `<p>Walking non-stop, it would take <strong>${walkYears > 1e6 ? (walkYears / 1e6).toFixed(1) + ' million' : walkYears > 1000 ? (walkYears / 1000).toFixed(1) + ' thousand' : walkYears.toFixed(0)}</strong> years — about <strong>${lifetimes > 1e6 ? (lifetimes / 1e6).toFixed(1) + ' million' : lifetimes > 1000 ? (lifetimes / 1000).toFixed(0) + ' thousand' : lifetimes.toFixed(0)}</strong> human lifetimes.</p>`;
  }
  if (lightTimeSec > 1) {
    mindBlown += `<p>If you called home, it would take <strong>${lightTimeStr}</strong> for your voice to arrive. A conversation would have a <strong>${(lightTimeSec * 2) < 60 ? (lightTimeSec * 2).toFixed(1) + ' second' : (lightTimeSec * 2) < 3600 ? ((lightTimeSec * 2) / 60).toFixed(1) + ' minute' : fmtTime(lightTimeSec * 2)}</strong> round-trip delay.</p>`;
  }
  if (earthDistKM > 1e9) {
    const photonAge = lightTimeSec / (86400 * 365.25);
    mindBlown += `<p>The light reaching you from ${name} right now left there <strong>${photonAge > 1 ? photonAge.toFixed(1) + ' years' : (photonAge * 365.25).toFixed(0) + ' days'}</strong> ago. You're literally looking back in time.</p>`;
  }
  if (nearest?.temp > 5000) {
    mindBlown += `<p>At <strong>${nearest.temp.toLocaleString()} K</strong>, ${name} is so hot that every known material would vaporize long before you got close.</p>`;
  }

  if (mindBlown) {
    html += `<div class="report-mindblown">
      <div class="report-mindblown-title">★ MIND-BENDING FACTS</div>
      <div class="report-mindblown-text">${mindBlown}</div>
    </div>`;
  }

  // Show the report
  document.getElementById('report-target-name').textContent = name.toUpperCase();
  document.getElementById('report-body').innerHTML = html;
  document.getElementById('mission-report').classList.add('active');
}

document.getElementById('mission-report-btn').addEventListener('click', generateMissionReport);

// Satellite toggle
document.getElementById('sat-toggle-btn').addEventListener('click', () => {
  const on = toggleSatellites();
  document.getElementById('sat-toggle-btn').style.borderColor = on ? '#0ef' : 'rgba(0,238,255,0.22)';
});
document.getElementById('report-close-btn').addEventListener('click', () => {
  document.getElementById('mission-report').classList.remove('active');
});
document.getElementById('mission-report').addEventListener('click', e => {
  if (e.target === document.getElementById('mission-report')) {
    document.getElementById('mission-report').classList.remove('active');
  }
});

// ═══════════════════════════════════════════════
//  SPLASH BIG BANG BACKGROUND
// ═══════════════════════════════════════════════
(function _initSplashBg() {
  const canvas = document.getElementById('splash-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, animId = null;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  // Small stars expanding slowly from center
  const N = 200;
  const stars = [];
  for (let i = 0; i < N; i++) {
    stars.push({
      angle: Math.random() * Math.PI * 2,
      dist: Math.random() * 0.5,
      speed: 0.04 + Math.random() * 0.12,
      size: 0.4 + Math.random() * 1.2,
      brightness: 120 + Math.floor(Math.random() * 136), // 120-255
      twinklePhase: Math.random() * Math.PI * 2,
      twinkleSpeed: 0.005 + Math.random() * 0.015
    });
  }

  function draw() {
    if (document.getElementById('splash').classList.contains('hidden')) {
      cancelAnimationFrame(animId);
      animId = null;
      return;
    }
    animId = requestAnimationFrame(draw);
    const cx = w / 2, cy = h / 2;
    const maxR = Math.max(w, h) * 0.55;

    // Slow fade — leaves faint trails
    ctx.fillStyle = 'rgba(0,0,0,0.04)';
    ctx.fillRect(0, 0, w, h);

    // Subtle center glow
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.08);
    glow.addColorStop(0, 'rgba(255,255,255,0.025)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR * 0.08, 0, Math.PI * 2);
    ctx.fill();

    // Stars
    stars.forEach(s => {
      s.dist += s.speed * 0.0004;
      s.twinklePhase += s.twinkleSpeed;
      if (s.dist > 1.1) { s.dist = 0; s.angle = Math.random() * Math.PI * 2; }

      const r = s.dist * maxR;
      const x = cx + Math.cos(s.angle) * r;
      const y = cy + Math.sin(s.angle) * r;

      // Fade in near center, fade out at edges
      const distFade = s.dist < 0.05 ? s.dist / 0.05 : s.dist > 0.85 ? (1.1 - s.dist) / 0.25 : 1;
      const twinkle = 0.6 + 0.4 * Math.sin(s.twinklePhase);
      const alpha = distFade * twinkle * 0.7;

      const b = s.brightness;
      ctx.fillStyle = `rgba(${b},${b},${b},${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  draw();

  const observer = new MutationObserver(() => {
    if (!document.getElementById('splash').classList.contains('hidden') && !animId) draw();
  });
  observer.observe(document.getElementById('splash'), { attributes: true, attributeFilter: ['class'] });
})();

// ═══════════════════════════════════════════════
//  ANIMATION LOOP
// ═══════════════════════════════════════════════
let started = false;
let lastTime = 0;

document.getElementById('splash-explore-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  started = true;
  document.getElementById('splash').classList.add('hidden');
  document.getElementById('hud').classList.add('active');
  if (isMobile && window._mobileShowControls) window._mobileShowControls();
  // Always start in Solar System
  currentScale = 0;
  camera.position.set(0, 1.5, 4);
  yaw = Math.PI; pitch = -0.3; roll = 0;
  applyScale();
  lastTime = performance.now();

  // Show welcome intro (10s), then controls (10s) — each dismissable via X
  // Show welcome — stays until user closes it
  const welcomeEl = document.getElementById('welcome-intro');
  welcomeEl.classList.add('active');
  let _introPhase = 'welcome'; // welcome → controls → tip → done
  function _dismissWelcome() {
    if (!welcomeEl.classList.contains('active')) return;
    welcomeEl.classList.remove('active');
    _introPhase = 'controls';
    // Show controls overlay — stays until user closes it
    controlsOpen = true;
    document.getElementById('controls-overlay').classList.add('open');
    // Watch for controls close to show the R tip
    const _watchClose = setInterval(() => {
      if (!controlsOpen && _introPhase === 'controls') {
        clearInterval(_watchClose);
        _introPhase = 'flyby';
        // Alien flyby first, then show R tip after alien exits
        const flyby = document.getElementById('alien-flyby');
        if (flyby) {
          flyby.classList.add('active');
          setTimeout(() => {
            flyby.classList.remove('active');
            // Now show the R tip
            _introPhase = 'tip';
            const tip = document.getElementById('cruise-tip');
            if (tip) {
              tip.classList.add('active');
              setTimeout(() => { tip.classList.remove('active'); _introPhase = 'done'; }, 5000);
            }
          }, 3700); // matches animation duration
        }
      }
    }, 200);
  }
  document.getElementById('welcome-close-btn').addEventListener('click', _dismissWelcome);
});
document.getElementById('splash-launches-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('splash').classList.add('hidden');
  openLaunchHistory();
});

// ═══════════════════════════════════════════════
//  LAUNCH SIMULATOR  (Starship-focused)
// ═══════════════════════════════════════════════

// SpaceX Starship / Super Heavy — real specifications
const STARSHIP = {
  booster: {
    height: 71,
    diameter: 9,
    dryMass: 200000,
    propMass: 3400000,
    raptorThrust: 2256,
    defaultEngines: 33,
    isp_sl: 327,
    isp_vac: 356,
    burnTime: 170,
  },
  ship: {
    height: 50,
    diameter: 9,
    dryMass: 100000,
    propMass: 1200000,
    raptorSL: 3,
    raptorVac: 3,
    thrustSL: 2256,
    thrustVac: 2490,
    isp_sl: 327,
    isp_vac: 380,
    burnTime: 360,
  },
  totalHeight: 121,
};

const SIM_SITES = {
  Boca:  { lat: 25.99, lon: -97.15, name: 'Starbase, TX' },
  KSC:   { lat: 28.57, lon: -80.65, name: 'Kennedy Space Center' },
};

const DEST_ALTS = { LEO: 200, GTO: 35786, Moon: 384400, Mars: 2250000 };

// ── Sim state ────────────────────────────────────
let _simActive = false;
let _simLastT = 0;
let _simState = null;   // holds physics + 3D refs
let _simCountdown = -1; // countdown seconds remaining (-1 = not counting)

// ── Helpers ──────────────────────────────────────
function _getSimVal(groupId) {
  const active = document.querySelector('#' + groupId + ' .sim-opt-btn.active');
  return active ? active.dataset.val : '';
}

function _rotateEarthToSite(earth, siteKey) {
  if (!earth) return;
  const site = SIM_SITES[siteKey];
  if (!site) return;
  const lonRad = site.lon * (Math.PI / 180);
  const latRad = site.lat * (Math.PI / 180);
  earth.rotation.y = -lonRad + Math.PI;
  earth.rotation.x = latRad;
}


// ── _updateSpecs: recompute vehicle specs from slider values ──
function _updateSpecs() {
  var payloadT = parseInt(document.getElementById('sim-payload').value, 10);
  var nBoosterEngines = parseInt(document.getElementById('sim-engines').value, 10);
  var nShipEngines = parseInt(document.getElementById('sim-ship-engines').value, 10);
  var nSL = Math.ceil(nShipEngines / 2);
  var nVac = nShipEngines - nSL;

  // Update slider display values
  var payloadValEl = document.getElementById('sim-payload-val');
  if (payloadValEl) payloadValEl.textContent = payloadT + ' t';
  var engValEl = document.getElementById('sim-engines-val');
  if (engValEl) engValEl.textContent = nBoosterEngines + ' engines';
  var shipEngValEl = document.getElementById('sim-ship-engines-val');
  if (shipEngValEl) shipEngValEl.textContent = nShipEngines + ' engines (' + nSL + ' sea-level + ' + nVac + ' vacuum)';

  // Compute specs
  var boosterThrust = nBoosterEngines * STARSHIP.booster.raptorThrust;
  var shipThrustSL = nSL * STARSHIP.ship.thrustSL;
  var shipThrustVac = nVac * STARSHIP.ship.thrustVac;
  var shipThrust = shipThrustSL + shipThrustVac;

  var payloadKg = payloadT * 1000;
  var liftoffMass = STARSHIP.booster.dryMass + STARSHIP.booster.propMass
                  + STARSHIP.ship.dryMass + STARSHIP.ship.propMass + payloadKg;
  var liftoffMassT = liftoffMass / 1000;
  var twr = (boosterThrust * 1000) / (liftoffMass * 9.81);

  // Delta-V (Tsiolkovsky): stage 1 + stage 2
  var g0 = 9.81;
  var m0_b = liftoffMass;
  var mf_b = liftoffMass - STARSHIP.booster.propMass;
  var dv1 = STARSHIP.booster.isp_sl * g0 * Math.log(m0_b / mf_b);
  var m0_s = STARSHIP.ship.dryMass + STARSHIP.ship.propMass + payloadKg;
  var mf_s = STARSHIP.ship.dryMass + payloadKg;
  var avgIsp_s = (nSL * STARSHIP.ship.isp_sl + nVac * STARSHIP.ship.isp_vac) / nShipEngines;
  var dv2 = avgIsp_s * g0 * Math.log(m0_s / mf_s);
  var totalDV = (dv1 + dv2) / 1000; // km/s

  // Update spec grid
  var specsEl = document.getElementById('sim-specs');
  if (specsEl) {
    var specs = specsEl.querySelectorAll('.sim-spec-val');
    if (specs.length >= 6) {
      specs[0].textContent = STARSHIP.totalHeight + ' m';
      specs[1].textContent = liftoffMassT.toLocaleString(undefined, {maximumFractionDigits:0}) + ' t';
      specs[2].textContent = boosterThrust.toLocaleString() + ' kN';
      specs[3].textContent = shipThrust.toLocaleString() + ' kN';
      specs[4].textContent = twr.toFixed(2);
      specs[5].textContent = '~' + totalDV.toFixed(1) + ' km/s';
    }
  }
}

// ── Build detailed Starship 3D model ─────────────
function _buildStarship(simScene) {
  var group = new THREE.Group();

  // ── Super Heavy Booster ──
  var boosterGroup = new THREE.Group();
  boosterGroup.name = 'booster';

  // Main booster body — silver cylinder
  var boosterGeo = new THREE.CylinderGeometry(0.18, 0.20, 1.42, 24, 1);
  var boosterMat = new THREE.MeshStandardMaterial({ color: 0xc8c8c8, roughness: 0.35, metalness: 0.6 });
  var boosterBody = new THREE.Mesh(boosterGeo, boosterMat);
  boosterBody.position.y = 0.71;
  boosterGroup.add(boosterBody);

  // Engine skirt (wider at bottom)
  var skirtGeo = new THREE.CylinderGeometry(0.20, 0.22, 0.12, 24, 1);
  var skirtMat = new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.5, metalness: 0.4 });
  var skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.y = 0.06;
  boosterGroup.add(skirt);

  // Engine bells at bottom (many small cones)
  var engineGeo = new THREE.ConeGeometry(0.012, 0.06, 8);
  var engineMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.3, metalness: 0.8 });
  for (var ei = 0; ei < 33; ei++) {
    var angle = (ei / 33) * Math.PI * 2;
    var ring = ei < 13 ? 0.06 : (ei < 23 ? 0.12 : 0.17);
    var eng = new THREE.Mesh(engineGeo, engineMat);
    eng.position.set(Math.cos(angle) * ring, -0.03, Math.sin(angle) * ring);
    eng.rotation.x = Math.PI;
    boosterGroup.add(eng);
  }

  // Grid fins (4)
  var finGeo = new THREE.BoxGeometry(0.14, 0.08, 0.01);
  var finMat = new THREE.MeshStandardMaterial({ color: 0x444444, roughness: 0.4, metalness: 0.7 });
  for (var fi = 0; fi < 4; fi++) {
    var fin = new THREE.Mesh(finGeo, finMat);
    var fAngle = (fi / 4) * Math.PI * 2;
    fin.position.set(Math.cos(fAngle) * 0.22, 1.35, Math.sin(fAngle) * 0.22);
    fin.rotation.y = fAngle;
    boosterGroup.add(fin);
  }

  // Hot-stage ring at top of booster
  var ringGeo = new THREE.CylinderGeometry(0.20, 0.19, 0.04, 24, 1);
  var ringMat = new THREE.MeshStandardMaterial({ color: 0x666666, roughness: 0.5, metalness: 0.5 });
  var hotRing = new THREE.Mesh(ringGeo, ringMat);
  hotRing.position.y = 1.44;
  boosterGroup.add(hotRing);

  group.add(boosterGroup);

  // ── Starship (Ship / upper stage) ──
  var shipGroup = new THREE.Group();
  shipGroup.name = 'ship';

  // Ship body cylinder
  var shipBodyGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.80, 24, 1);
  var shipBodyMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.3, metalness: 0.5 });
  var shipBody = new THREE.Mesh(shipBodyGeo, shipBodyMat);
  shipBody.position.y = 1.86;
  shipGroup.add(shipBody);

  // Heat shield side (dark tiles) — half cylinder
  var tileGeo = new THREE.CylinderGeometry(0.183, 0.183, 0.80, 12, 1, false, 0, Math.PI);
  var tileMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9, metalness: 0.1 });
  var tiles = new THREE.Mesh(tileGeo, tileMat);
  tiles.position.y = 1.86;
  tiles.rotation.y = Math.PI;
  shipGroup.add(tiles);

  // Nose cone
  var noseGeo = new THREE.ConeGeometry(0.18, 0.40, 24, 1);
  var noseMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, roughness: 0.3, metalness: 0.5 });
  var nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.y = 2.46;
  shipGroup.add(nose);

  // Forward flaps (2)
  var flapGeo = new THREE.BoxGeometry(0.16, 0.22, 0.008);
  var flapMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.7, metalness: 0.3 });
  for (var ffi = 0; ffi < 2; ffi++) {
    var flap = new THREE.Mesh(flapGeo, flapMat);
    var ffAngle = ffi === 0 ? 0 : Math.PI;
    flap.position.set(Math.cos(ffAngle) * 0.19, 2.15, Math.sin(ffAngle) * 0.19);
    flap.rotation.y = ffAngle;
    shipGroup.add(flap);
  }

  // Aft flaps (2)
  for (var afi = 0; afi < 2; afi++) {
    var aflap = new THREE.Mesh(flapGeo, flapMat);
    var afAngle = afi === 0 ? Math.PI / 2 : -Math.PI / 2;
    aflap.position.set(Math.cos(afAngle) * 0.19, 1.55, Math.sin(afAngle) * 0.19);
    aflap.rotation.y = afAngle;
    shipGroup.add(aflap);
  }

  // Ship engines (smaller)
  var sEngGeo = new THREE.ConeGeometry(0.015, 0.07, 8);
  for (var si = 0; si < 6; si++) {
    var sAngle = (si / 6) * Math.PI * 2;
    var sEng = new THREE.Mesh(sEngGeo, engineMat);
    sEng.position.set(Math.cos(sAngle) * 0.08, 1.42, Math.sin(sAngle) * 0.08);
    sEng.rotation.x = Math.PI;
    shipGroup.add(sEng);
  }

  shipGroup.position.y = 0; // stacked on top of booster
  group.add(shipGroup);

  return group;
}

// ── Init the 3D viewer ───────────────────────────
function _initSimViewer() {
  if (_simState && _simState.renderer) return;
  var canvas = document.getElementById('sim-canvas-a');
  if (!canvas) return;
  var w = canvas.offsetWidth, h = canvas.offsetHeight;
  if (!w || !h) return;

  var simRenderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
  simRenderer.setSize(w, h);
  simRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  simRenderer.setClearColor(0x010208, 1);

  var simScene = new THREE.Scene();
  var simCam = new THREE.PerspectiveCamera(50, w / h, 0.01, 2000);
  simCam.position.set(3, 2, 5);
  simCam.lookAt(0, 1.5, 0);

  // Earth
  var eGeo = new THREE.SphereGeometry(2, 64, 64);
  var eTex = _mkTex(512, 256, _pTexFns.Earth);
  var earth = new THREE.Mesh(eGeo, new THREE.MeshStandardMaterial({ map: eTex, roughness: 0.7, metalness: 0.05 }));
  earth.position.set(0, -1.8, 0);
  simScene.add(earth);

  // Cloud layer
  var cloudTex = _mkTex(256, 128, function(u,v,nx,ny,nz) {
    var n1 = _sfbm(nx*4+10,ny*4+10,nz*4+10,4);
    var n2 = _sfbm(nx*8+20,ny*8,nz*8+20,3)*0.3;
    var cloud = Math.max(0, n1+n2-0.42)*2.5;
    var c = Math.min(255,(cloud*255)|0);
    return [c,c,c];
  });
  var cloudMesh = new THREE.Mesh(
    new THREE.SphereGeometry(2.03, 48, 48),
    new THREE.MeshStandardMaterial({ map: cloudTex, transparent: true, opacity: 0.4, depthWrite: false, roughness: 1, metalness: 0 })
  );
  cloudMesh.userData._cloudSpin = true;
  earth.add(cloudMesh);

  // Atmosphere glow
  var aCanvas = document.createElement('canvas');
  aCanvas.width = 128; aCanvas.height = 128;
  var aCtx = aCanvas.getContext('2d');
  var aGrad = aCtx.createRadialGradient(64, 64, 28, 64, 64, 64);
  aGrad.addColorStop(0, 'rgba(100,160,255,0)');
  aGrad.addColorStop(0.6, 'rgba(100,160,255,0)');
  aGrad.addColorStop(0.8, 'rgba(100,160,255,0.15)');
  aGrad.addColorStop(1, 'rgba(100,160,255,0)');
  aCtx.fillStyle = aGrad;
  aCtx.fillRect(0, 0, 128, 128);
  var atmo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(aCanvas),
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false
  }));
  atmo.scale.setScalar(6);
  earth.add(atmo);

  // Rotate to launch site
  var selectedSite = _getSimVal('sim-site') || 'Boca';
  _rotateEarthToSite(earth, selectedSite);

  // Build Starship
  var rocket = _buildStarship(simScene);
  rocket.position.set(0, 0.22, 0);
  simScene.add(rocket);

  // Multi-layer exhaust
  // Core flame (bright yellow-white)
  var ex1Geo = new THREE.BufferGeometry();
  var ex1Pos = new Float32Array(30 * 3);
  ex1Geo.setAttribute('position', new THREE.BufferAttribute(ex1Pos, 3));
  var ex1 = new THREE.Points(ex1Geo, new THREE.PointsMaterial({
    color: 0xffeedd, size: 0.01, transparent: true, opacity: 0.95,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  // Outer flame (orange)
  var ex2Geo = new THREE.BufferGeometry();
  var ex2Pos = new Float32Array(60 * 3);
  ex2Geo.setAttribute('position', new THREE.BufferAttribute(ex2Pos, 3));
  var ex2 = new THREE.Points(ex2Geo, new THREE.PointsMaterial({
    color: 0xff6600, size: 0.02, transparent: true, opacity: 0.7,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  // Smoke plume
  var ex3Geo = new THREE.BufferGeometry();
  var ex3Pos = new Float32Array(40 * 3);
  ex3Geo.setAttribute('position', new THREE.BufferAttribute(ex3Pos, 3));
  var ex3 = new THREE.Points(ex3Geo, new THREE.PointsMaterial({
    color: 0x886644, size: 0.035, transparent: true, opacity: 0.3,
    blending: THREE.NormalBlending, depthWrite: false
  }));

  var exhaustGrp = new THREE.Group();
  exhaustGrp.add(ex1, ex2, ex3);
  exhaustGrp.visible = false;
  simScene.add(exhaustGrp);

  var exhaust = {
    grp: exhaustGrp,
    layers: [
      { pts: ex1, pos: ex1Pos, n: 30, spread: 0.02, lenMin: 0.03, lenMax: 0.12 },
      { pts: ex2, pos: ex2Pos, n: 60, spread: 0.05, lenMin: 0.05, lenMax: 0.25 },
      { pts: ex3, pos: ex3Pos, n: 40, spread: 0.07, lenMin: 0.10, lenMax: 0.40 }
    ]
  };

  // Trajectory arc
  var trajStart = new THREE.Vector3(0, 0.22, 0);
  var trajControl = new THREE.Vector3(0.3, 2.5, 0);
  var trajEnd = new THREE.Vector3(2.0, 4.5, 0);
  var trajCurve = new THREE.QuadraticBezierCurve3(trajStart, trajControl, trajEnd);
  var trajPts = trajCurve.getPoints(64);
  var trajGeo = new THREE.BufferGeometry().setFromPoints(trajPts);
  var trajLine = new THREE.Line(trajGeo, new THREE.LineBasicMaterial({
    color: 0x00eeff, transparent: true, opacity: 0.15,
    blending: THREE.AdditiveBlending, depthWrite: false
  }));
  trajLine.visible = false;
  simScene.add(trajLine);

  // Lights
  simScene.add(new THREE.AmbientLight(0x223344, 0.4));
  var simSunL = new THREE.DirectionalLight(0xfff0dd, 1.2);
  simSunL.position.set(5, 3, 2);
  simScene.add(simSunL);

  // Stars
  var sPos = new Float32Array(600 * 3);
  for (var i = 0; i < 600; i++) {
    var th = Math.random() * Math.PI * 2;
    var ph = Math.acos(2 * Math.random() - 1);
    var r = 400 + Math.random() * 600;
    sPos[i * 3]     = r * Math.sin(ph) * Math.cos(th);
    sPos[i * 3 + 1] = r * Math.sin(ph) * Math.sin(th);
    sPos[i * 3 + 2] = r * Math.cos(ph);
  }
  var sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  simScene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({
    color: 0xffffff, size: 1.5, sizeAttenuation: true
  })));

  _simState = {
    renderer: simRenderer,
    scene: simScene,
    cam: simCam,
    rocket: rocket,
    boosterGroup: rocket.children.find(function(c) { return c.name === 'booster'; }),
    shipGroup: rocket.children.find(function(c) { return c.name === 'ship'; }),
    separatedBooster: null,
    exhaust: exhaust,
    earth: earth,
    trajLine: trajLine,
    // Physics state
    t: 0,
    alt: 0,          // km
    vel: 0,          // m/s
    accel: 0,        // g
    downrange: 0,    // km
    boosterFuel: 100,
    shipFuel: 100,
    stage: 'booster', // 'booster', 'hot-stage', 'ship', 'coast', 'orbit'
    pitchAngle: 90,  // degrees from horizontal (90 = vertical)
    running: false,
    completed: false,
    countdownActive: false,
    countdownT: 10,
    // Milestone flags
    _msgMaxQ: false,
    _msgMECO: false,
    _msgSep: false,
    _msgBoostback: false,
    _msgFairing: false,
    _msgSECO: false,
  };
}

// ── Show ticker message ──────────────────────────
function _showTicker(text) {
  var el = document.getElementById('sim-ticker-text');
  if (!el) return;
  el.classList.remove('typing');
  el.textContent = text;
  void el.offsetWidth;
  el.classList.add('typing');
}

// ── Update telemetry display ─────────────────────
function _updateTelemetry() {
  if (!_simState) return;
  var s = _simState;

  var mins = Math.floor(Math.abs(s.t) / 60);
  var secs = Math.floor(Math.abs(s.t) % 60);
  var prefix = s.t < 0 ? 'T-' : 'T+';

  var timeEl = document.getElementById('sim-t-time');
  if (timeEl) timeEl.textContent = prefix + String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

  var altEl = document.getElementById('sim-t-alt');
  if (altEl) altEl.textContent = s.alt < 1000 ? s.alt.toFixed(1) + ' km' : (s.alt / 1000).toFixed(2) + ' Mm';

  var velEl = document.getElementById('sim-t-vel');
  if (velEl) velEl.textContent = s.vel < 1000 ? s.vel.toFixed(0) + ' m/s' : (s.vel / 1000).toFixed(2) + ' km/s';

  var accelEl = document.getElementById('sim-t-accel');
  if (accelEl) accelEl.textContent = s.accel.toFixed(1) + ' g';

  var downrangeEl = document.getElementById('sim-t-downrange');
  if (downrangeEl) downrangeEl.textContent = s.downrange.toFixed(1) + ' km';

  var bfuelEl = document.getElementById('sim-t-bfuel');
  if (bfuelEl) bfuelEl.textContent = Math.max(0, s.boosterFuel).toFixed(0) + '%';

  var sfuelEl = document.getElementById('sim-t-sfuel');
  if (sfuelEl) sfuelEl.textContent = Math.max(0, s.shipFuel).toFixed(0) + '%';

  var stageEl = document.getElementById('sim-t-stage');
  if (stageEl) stageEl.textContent = s.stage.toUpperCase();

  var statusEl = document.getElementById('sim-t-status');
  if (statusEl) {
    if (s.countdownActive) statusEl.textContent = 'COUNTDOWN';
    else if (!s.running && !s.completed) statusEl.textContent = 'PRE-LAUNCH';
    else if (s.completed) statusEl.textContent = 'ORBIT ACHIEVED';
    else if (s.stage === 'booster') statusEl.textContent = 'POWERED FLIGHT';
    else if (s.stage === 'hot-stage') statusEl.textContent = 'HOT STAGING';
    else if (s.stage === 'ship') statusEl.textContent = 'SHIP BURN';
    else if (s.stage === 'coast') statusEl.textContent = 'COASTING';
    else statusEl.textContent = s.stage.toUpperCase();
  }
}

// ── Start launch (with countdown) ────────────────
function _startLaunch() {
  if (!_simState) return;
  if (_simState.running || _simState.countdownActive) return;

  // Reset state
  _simState.t = -10;
  _simState.alt = 0;
  _simState.vel = 0;
  _simState.accel = 0;
  _simState.downrange = 0;
  _simState.boosterFuel = 100;
  _simState.shipFuel = 100;
  _simState.stage = 'booster';
  _simState.pitchAngle = 90;
  _simState.running = false;
  _simState.completed = false;
  _simState.countdownActive = true;
  _simState.countdownT = 10;
  _simState._msgMaxQ = false;
  _simState._msgMECO = false;
  _simState._msgSep = false;
  _simState._msgBoostback = false;
  _simState._msgFairing = false;
  _simState._msgSECO = false;

  // Reset 3D positions
  if (_simState.rocket) {
    _simState.rocket.position.set(0, 0.22, 0);
    _simState.rocket.rotation.z = 0;
  }
  // If booster was separated, remove it and rebuild rocket
  if (_simState.separatedBooster) {
    _simState.scene.remove(_simState.separatedBooster);
    _simState.separatedBooster = null;
  }
  if (_simState.scene && _simState.rocket) {
    _simState.scene.remove(_simState.rocket);
  }
  var newRocket = _buildStarship(_simState.scene);
  newRocket.position.set(0, 0.22, 0);
  _simState.scene.add(newRocket);
  _simState.rocket = newRocket;
  _simState.boosterGroup = newRocket.children.find(function(c) { return c.name === 'booster'; });
  _simState.shipGroup = newRocket.children.find(function(c) { return c.name === 'ship'; });

  if (_simState.exhaust) _simState.exhaust.grp.visible = false;
  if (_simState.trajLine) { _simState.trajLine.visible = true; _simState.trajLine.material.opacity = 0.15; }
  if (_simState.cam) {
    _simState.cam.position.set(3, 2, 5);
    _simState.cam.lookAt(0, 1.5, 0);
  }

  var statusEl = document.getElementById('sim-status');
  if (statusEl) statusEl.textContent = 'COUNTDOWN';

  var launchBtn = document.getElementById('sim-launch-btn');
  if (launchBtn) { launchBtn.textContent = 'COUNTDOWN...'; launchBtn.classList.add('counting'); }

  _showTicker('T-10... LAUNCH SEQUENCE INITIATED');
}

// ── Physics + Rendering loop ─────────────────────
function _simAnimate(now) {
  if (!_simActive || !_simState) return;
  requestAnimationFrame(_simAnimate);

  var dt = Math.min((now - _simLastT) / 1000, 0.1);
  _simLastT = now;

  var s = _simState;

  // ── Countdown phase ──
  if (s.countdownActive) {
    s.t += dt;
    if (s.t < 0) {
      var countSec = Math.ceil(Math.abs(s.t));
      if (countSec !== s.countdownT) {
        s.countdownT = countSec;
        if (countSec <= 10 && countSec > 0) {
          _showTicker('T-' + countSec + '...');
        }
      }
      _updateTelemetry();
      return;
    }
    // Countdown just hit zero — ignition!
    s.countdownActive = false;
    s.running = true;
    s.t = 0;
    _showTicker('LIFTOFF! All ' + document.getElementById('sim-engines').value + ' Raptors at full thrust.');
    var statusEl2 = document.getElementById('sim-status');
    if (statusEl2) statusEl2.textContent = 'LAUNCH IN PROGRESS';
  }

  if (!s.running && !s.completed) {
    return;
  }

  // ── Physics step ──
  if (s.running && !s.completed) {
    s.t += dt;

    var g0 = 9.81;
    var nBoosterEng = parseInt(document.getElementById('sim-engines').value, 10);
    var nShipEng = parseInt(document.getElementById('sim-ship-engines').value, 10);
    var nSL = Math.ceil(nShipEng / 2);
    var nVac = nShipEng - nSL;
    var payloadKg = parseInt(document.getElementById('sim-payload').value, 10) * 1000;

    // Gravity at altitude
    var gAlt = g0 * Math.pow(6371 / (6371 + s.alt), 2);

    // Atmospheric drag: proportional to v^2, decreasing with altitude (scale height ~8.5km)
    var rho = Math.exp(-s.alt / 8.5);
    var dragAccel = 0.5 * rho * s.vel * s.vel * 0.000003;
    dragAccel = Math.min(dragAccel, 5 * g0);

    // Gravity turn: pitch transitions from 90 to ~10 degrees over first 200s
    if (s.t < 200) {
      s.pitchAngle = 90 - (80 * Math.min(s.t / 200, 1) * Math.min(s.t / 200, 1));
    } else {
      s.pitchAngle = Math.max(5, 10 - (s.t - 200) * 0.01);
    }
    var pitchRad = s.pitchAngle * Math.PI / 180;

    var thrustAccel = 0;

    if (s.stage === 'booster') {
      // Booster phase
      var boosterThrustN = nBoosterEng * STARSHIP.booster.raptorThrust * 1000;
      var boosterMassFlow = boosterThrustN / (STARSHIP.booster.isp_sl * g0);
      var boosterFuelUsed = boosterMassFlow * dt;
      var boosterFuelFrac = s.boosterFuel / 100;
      var currentBoosterProp = STARSHIP.booster.propMass * boosterFuelFrac;
      var totalMass = STARSHIP.booster.dryMass + currentBoosterProp
                    + STARSHIP.ship.dryMass + STARSHIP.ship.propMass + payloadKg;
      thrustAccel = boosterThrustN / totalMass;

      s.boosterFuel -= (boosterFuelUsed / STARSHIP.booster.propMass) * 100;
      if (s.boosterFuel <= 0) s.boosterFuel = 0;

      // MECO at ~170s or fuel exhaustion
      if (s.t >= STARSHIP.booster.burnTime || s.boosterFuel <= 0) {
        if (!s._msgMECO) {
          s._msgMECO = true;
          s.stage = 'hot-stage';
          _showTicker('Booster MECO. Hot-staging initiated.');
        }
      }
    } else if (s.stage === 'hot-stage') {
      // Brief hot-staging phase (~3s) — both stages briefly fire
      var hsBoosterThrust = nBoosterEng * STARSHIP.booster.raptorThrust * 1000 * 0.3;
      var hsShipThrust = (nSL * STARSHIP.ship.thrustSL + nVac * STARSHIP.ship.thrustVac) * 1000;
      var hsTotalMass = STARSHIP.ship.dryMass + STARSHIP.ship.propMass + payloadKg + STARSHIP.booster.dryMass;
      thrustAccel = (hsBoosterThrust + hsShipThrust) / hsTotalMass;

      // Ship fuel starts burning
      var hsShipMassFlow = hsShipThrust / (STARSHIP.ship.isp_vac * g0);
      s.shipFuel -= (hsShipMassFlow * dt / STARSHIP.ship.propMass) * 100;

      if (!s._msgSep && s.t >= STARSHIP.booster.burnTime + 3) {
        s._msgSep = true;
        s.stage = 'ship';
        _showTicker('Stage separation. Ship engines at full thrust.');

        // Stage separation (visual handled by image overlay)
      }
      if (!s._msgBoostback && s.t >= STARSHIP.booster.burnTime + 5) {
        s._msgBoostback = true;
        _showTicker('Booster beginning boostback burn.');
      }
    } else if (s.stage === 'ship') {
      // Ship phase — thrust transitions from SL to Vac with altitude
      var vacFrac = Math.min(1, s.alt / 100);
      var slFrac = 1 - vacFrac;
      var shipThrustSLN = nSL * STARSHIP.ship.thrustSL * 1000 * slFrac;
      var shipThrustVacN = nVac * STARSHIP.ship.thrustVac * 1000;
      var slInVac = nSL * STARSHIP.ship.thrustSL * 1000 * vacFrac * 0.85;
      var totalShipThrust = shipThrustSLN + slInVac + shipThrustVacN;

      var avgIsp = (nSL * STARSHIP.ship.isp_sl * (1 - vacFrac * 0.15) + nVac * STARSHIP.ship.isp_vac) / nShipEng;
      var shipMassFlow = totalShipThrust / (avgIsp * g0);
      var shipPropFrac = s.shipFuel / 100;
      var currentShipProp = STARSHIP.ship.propMass * shipPropFrac;
      var shipTotalMass = STARSHIP.ship.dryMass + currentShipProp + payloadKg;
      thrustAccel = totalShipThrust / shipTotalMass;

      s.shipFuel -= (shipMassFlow * dt / STARSHIP.ship.propMass) * 100;
      if (s.shipFuel <= 0) {
        s.shipFuel = 0;
        s.stage = 'coast';
        if (!s._msgSECO) {
          s._msgSECO = true;
          _showTicker('SECO. Orbit insertion confirmed!');
        }
      }
    } else if (s.stage === 'coast') {
      thrustAccel = 0;
    }

    // Net acceleration along flight path
    var netAccelAlongPath = thrustAccel - gAlt * Math.sin(pitchRad) - dragAccel;
    s.accel = thrustAccel / g0;
    s.vel += netAccelAlongPath * dt;
    if (s.vel < 0) s.vel = 0;

    // Altitude and downrange
    s.alt += (s.vel * Math.sin(pitchRad) * dt) / 1000;
    s.downrange += (s.vel * Math.cos(pitchRad) * dt) / 1000;

    // Milestone messages
    if (!s._msgMaxQ && s.t > 55 && s.t < 65) {
      s._msgMaxQ = true;
      _showTicker('Max Q \u2014 maximum dynamic pressure');
    }
    if (!s._msgFairing && s.alt > 100 && s.alt < 200 && s.stage === 'ship' && s.t > 250) {
      s._msgFairing = true;
      _showTicker('Fairing jettison');
    }

    // Target altitude check for orbit
    var destVal = _getSimVal('sim-dest') || 'LEO';
    var targetAlt = DEST_ALTS[destVal] || 200;
    var orbitalVel = Math.sqrt(g0 * Math.pow(6371, 2) / (6371 + targetAlt)) * 1000;
    if (s.alt >= targetAlt || (s.alt > 180 && s.vel >= orbitalVel * 0.95)) {
      s.completed = true;
      s.running = false;
      if (!s._msgSECO) {
        s._msgSECO = true;
        _showTicker('SECO. Orbit insertion confirmed!');
      }
      var simStatusEl = document.getElementById('sim-status');
      if (simStatusEl) simStatusEl.textContent = 'ORBIT ACHIEVED';
      var launchBtn2 = document.getElementById('sim-launch-btn');
      if (launchBtn2) { launchBtn2.textContent = 'INITIATE LAUNCH SEQUENCE'; launchBtn2.classList.remove('counting'); }
    }

    // Auto-complete if coasting with sufficient altitude + velocity
    if (s.stage === 'coast' && s.alt > 150 && s.vel > 6000) {
      s.completed = true;
      s.running = false;
      var simStatusEl3 = document.getElementById('sim-status');
      if (simStatusEl3) simStatusEl3.textContent = 'ORBIT ACHIEVED';
      var launchBtn3 = document.getElementById('sim-launch-btn');
      if (launchBtn3) { launchBtn3.textContent = 'INITIATE LAUNCH SEQUENCE'; launchBtn3.classList.remove('counting'); }
    }
  }

  // ── Image overlay effects ──
  var overlay = document.getElementById('sim-img-overlay');
  if (overlay) {
    if (s.running && (s.stage === 'booster' || s.stage === 'hot-stage' || s.stage === 'ship')) {
      overlay.className = 'sim-img-overlay launching';
    } else if (s.completed) {
      overlay.className = 'sim-img-overlay orbit';
    } else {
      overlay.className = 'sim-img-overlay';
    }
  }

  // Image shake effect during Max Q / high thrust
  var img = document.getElementById('sim-starship-img');
  if (img && s.running) {
    var shake = s.accel > 1.5 ? (s.accel - 1.5) * 0.3 : 0;
    if (shake > 0) {
      var sx = (Math.random() - 0.5) * shake;
      var sy = (Math.random() - 0.5) * shake;
      img.style.transform = 'translate(' + sx + 'px,' + sy + 'px)';
    } else {
      img.style.transform = '';
    }
  } else if (img) {
    img.style.transform = '';
  }

  _updateTelemetry();
}

// ── Open / Close ─────────────────────────────────
function openLaunchSim() {
  _simActive = true;
  document.getElementById('launch-sim').classList.add('open');
  var statusEl = document.getElementById('sim-status');
  if (statusEl) statusEl.textContent = 'CONFIGURE LAUNCH';

  // Create simState for physics (no 3D renderer needed — using image display)
  if (!_simState) {
    _simState = {
      renderer: null, scene: null, cam: null,
      rocket: null, boosterGroup: null, shipGroup: null,
      separatedBooster: null, exhaust: null, earth: null, trajLine: null,
      t: 0, alt: 0, vel: 0, accel: 0, downrange: 0,
      boosterFuel: 100, shipFuel: 100,
      stage: 'booster', pitchAngle: 90,
      running: false, completed: false,
      countdownActive: false, countdownT: 10,
      _msgMaxQ: false, _msgMECO: false, _msgSep: false,
      _msgBoostback: false, _msgFairing: false, _msgSECO: false,
    };
  }

  // Initialize specs from current slider values
  _updateSpecs();
  _updateTelemetry();

  requestAnimationFrame(function(t) {
    _simLastT = t;
    _simAnimate(t);
  });
}

function closeLaunchSim() {
  _simActive = false;
  _simRunning = false;
  _simState = null;
  var overlay = document.getElementById('sim-img-overlay');
  if (overlay) { overlay.className = 'sim-img-overlay'; }
  document.getElementById('launch-sim').classList.remove('open');
  document.getElementById('splash').classList.remove('hidden');
}

// ── Event wiring ─────────────────────────────────

// Option button groups (destination, site)
['sim-dest', 'sim-site'].forEach(function(groupId) {
  var group = document.getElementById(groupId);
  if (!group) return;
  group.addEventListener('click', function(e) {
    var btn = e.target.closest('.sim-opt-btn');
    if (!btn) return;
    group.querySelectorAll('.sim-opt-btn').forEach(function(b) { b.classList.remove('active'); });
    btn.classList.add('active');
    if (groupId === 'sim-site' && _simState && _simState.earth) {
      _rotateEarthToSite(_simState.earth, btn.dataset.val);
    }
    _updateSpecs();
  });
});

// Sliders
['sim-payload', 'sim-engines', 'sim-ship-engines'].forEach(function(sliderId) {
  var slider = document.getElementById(sliderId);
  if (!slider) return;
  slider.addEventListener('input', function() { _updateSpecs(); });
  slider.addEventListener('touchstart', function(e) { e.stopPropagation(); });
});

// Main buttons
document.getElementById('sim-launch-btn').addEventListener('click', _startLaunch);
document.getElementById('sim-back-btn').addEventListener('click', closeLaunchSim);
document.getElementById('splash-sim-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('splash').classList.add('hidden');
  openLaunchSim();
});

// Resize handler
window.addEventListener('resize', function() {
  // No 3D viewport to resize — image scales via CSS
});
document.getElementById('hud-back-btn').addEventListener('click', () => {
  started = false;
  document.getElementById('hud').classList.remove('active');
  document.getElementById('splash').classList.remove('hidden');
  if (isMobile && window._mobileHideControls) window._mobileHideControls();
  if (exploreMode) stopExploreMode();
  if (travelActive) abortTravel();
  if (_arrivalOrbit.active) _arrivalOrbit.active = false;
});
initLaunchHistory(() => started);
// UFO system removed

function animate(now) {
  requestAnimationFrame(animate);
  if (!started) { renderer.render(scene, camera); return; }

  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // Time simulation
  const daysPassed = TIME_RATES[timeRateIndex] * dt;
  simTime += daysPassed / 365.25;

  // Update planet positions
  if (currentScale <= 1) {
    planetMeshes.forEach(({ mesh, data }) => {
      const pos = getOrbitalPosition(data, simTime);
      mesh.position.copy(pos);
      // Planet spin tied to time rate
      if (daysPassed !== 0) {
        mesh.rotation.y += daysPassed * 0.5;
        mesh.children.forEach(c => { if (c.userData._cloudSpin) c.rotation.y += daysPassed * 0.08; });
      }
    });

    // Animate moons orbiting their parent planets (uses time rate)
    moonMeshes.forEach(m => {
      const orbitalSpeed = (2 * Math.PI) / m.data.T; // rad per sim-day
      m.angle += orbitalSpeed * daysPassed;
      const inc = (m.data.inc || 0) * Math.PI / 180;
      const px = Math.cos(m.angle) * m.orbitR;
      const py = Math.sin(m.angle) * Math.sin(inc) * m.orbitR * 0.3;
      const pz = Math.sin(m.angle) * m.orbitR;
      m.mesh.position.set(px, py, pz);

      // Update trail — shift buffer and add new head position
      if (daysPassed !== 0) {
        // Shift all positions forward (oldest drops off)
        for (let ti = m.TRAIL_LEN - 1; ti > 0; ti--) {
          m.trailPositions[ti * 3]     = m.trailPositions[(ti - 1) * 3];
          m.trailPositions[ti * 3 + 1] = m.trailPositions[(ti - 1) * 3 + 1];
          m.trailPositions[ti * 3 + 2] = m.trailPositions[(ti - 1) * 3 + 2];
        }
        m.trailPositions[0] = px;
        m.trailPositions[1] = py;
        m.trailPositions[2] = pz;
        // Update fade colors (bright at head, fades to transparent)
        for (let ti = 0; ti < m.TRAIL_LEN; ti++) {
          const fade = 1 - (ti / m.TRAIL_LEN);
          m.trailColors[ti * 3] = fade * 0.6;
          m.trailColors[ti * 3 + 1] = fade * 0.8;
          m.trailColors[ti * 3 + 2] = fade;
        }
        m.trailGeo.attributes.position.needsUpdate = true;
        m.trailGeo.attributes.color.needsUpdate = true;
      }
    });

    // Update Sun rotation and pulse
    sunMesh.rotation.y += dt * 0.1;

    // Light speed sphere
    if (lightSphere.visible) {
      const lightRadius = C_AU_S * (simTime % 0.01) * 365.25 * DAY_S;
      lightSphere.scale.setScalar(Math.min(lightRadius, 40));
    }
  }

  // Update atom electrons
  if (currentScale === 0) {
    electrons.forEach(el => {
      el.angle += dt * (3 + el.orbit);
      const r = 0.49;
      const baseAngle = (el.orbit / 3) * Math.PI;
      el.mesh.position.set(
        Math.cos(el.angle) * r * Math.cos(baseAngle),
        Math.cos(el.angle) * r * Math.sin(baseAngle) * 0.5 + Math.sin(el.angle) * r * 0.5,
        Math.sin(el.angle) * r
      );
    });
  }

  // Apply mobile joystick input
  if (isMobile && window._mobileApplyJoystick) window._mobileApplyJoystick();

  // Camera movement (suppressed during cinematic dwell)
  const euler = new THREE.Euler(pitch, yaw, roll, 'YXZ');
  const forward = new THREE.Vector3(0, 0, -1).applyEuler(euler);
  const right = new THREE.Vector3(1, 0, 0).applyEuler(euler);
  const up = new THREE.Vector3(0, 1, 0);

  const _dwelling = (exploreMode && explorePhase === 'dwell') || _arrivalOrbit.active;
  if (!_dwelling) {
    const spd = moveSpeed * dt;
    if (keys['KeyW']) camera.position.addScaledVector(forward, spd);
    if (keys['KeyS']) camera.position.addScaledVector(forward, -spd);
    if (keys['KeyA']) camera.position.addScaledVector(right, -spd);
    if (keys['KeyD']) camera.position.addScaledVector(right, spd);
    if (keys['Space']) camera.position.addScaledVector(up, spd);
    if (keys['ShiftLeft'] || keys['ShiftRight']) camera.position.addScaledVector(up, -spd);
    if (keys['KeyQ']) roll += dt * 1.5;
    if (keys['KeyE']) roll -= dt * 1.5;
  }

  camera.quaternion.setFromEuler(euler);

  // Update body positions ref
  bodyPositions[0].pos.set(0, 0, 0);

  _updateScaleTransition(dt);
  updateExplore(dt);
  updateTravel(dt);
  updateArrivalOrbit(dt);
  // UFO removed
  updateComets(dt, simTime, currentScale);
  if (currentScale === 0) updateSatellites(simTime);
  if (galaxyGroup.visible) galaxyGroup.rotation.y += dt * 0.0008;
  // Pulse "You Are Here" marker
  if (youAreHere.visible) { yahSprite.scale.setScalar(8000 * (1 + 0.15 * Math.sin(performance.now() * 0.003))); }
  updateHUD();
  tickFacts(dt);
  _updateTicker(dt);
  _updateTrivia(dt);
  updateLabels();
  renderer.render(scene, camera);
}

requestAnimationFrame(animate);

// ═══════════════════════════════════════════════
//  RESIZE
// ═══════════════════════════════════════════════
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

initLabels();
loadExternalData();

// Satellite tracking — init with Earth mesh reference
const earthMeshRef = planetMeshes.find(p => p.data.name === 'Earth')?.mesh;
if (earthMeshRef) initSatellites(scene, earthMeshRef);

// ═══════════════════════════════════════════════
//  LAUNCH HISTORY MODE
// ═══════════════════════════════════════════════




// Launch History extracted to launchHistory.js


}
