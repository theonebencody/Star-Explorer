import * as THREE from 'three';
import { AU, C_KMS, C_AU_S, YEAR_S, DAY_S, SCALE_LEVELS, PLANETS, SUN_RADIUS_VIS, SUN_TEMP, STAR_DATA } from './constants.js';
import { solveKepler, getOrbitalPosition, tempToColor, spTypeToTemp } from './physics.js';
import { _hash, _sN, _sfbm, _mkTex, _pTexFns } from './noiseUtils.js';
import { OBJECT_FACTS, _FACTS_ALIASES, SUGGESTIONS } from '../data/factsData.js';
import { LAUNCH_DATA, ORG_COLORS, DEST_COLORS } from '../data/launchData.js';
import { openLaunchHistory, closeLaunchHistory, initLaunchHistory } from './launchHistory.js';
import { simbadOtypeInfo, simbadDistAU, simbadMarkerRadius, queryLiveSIMBAD, COMMON_ALIASES, formatDistFromAU, titleCase } from '../data/simbad.js';
import { initUFO, spawnUFO, updateUFO } from './ufo.js';
import { initWarp, renderWarp, hideWarp } from './warpEffect.js';
import { initComets, updateComets } from './comets.js';
import { buildRocket } from './rocketModels.js';

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

const ambientLight = new THREE.AmbientLight(0x223344, 0.55);
scene.add(ambientLight);
// Fill light from opposite side of sun to soften shadows on dark sides
const fillLight = new THREE.DirectionalLight(0x334466, 0.3);
fillLight.position.set(-5, 2, -3);
scene.add(fillLight);

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
    emissive: new THREE.Color(p.color).multiplyScalar(0.05)
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
//  ASTEROID BELT
// ═══════════════════════════════════════════════
const asteroidCount = isMobile ? 800 : 2000;
const asteroidPositions = new Float32Array(asteroidCount * 3);
for (let i = 0; i < asteroidCount; i++) {
  const a = 2.2 + Math.random() * 1.2; // 2.2 - 3.4 AU
  const angle = Math.random() * Math.PI * 2;
  const y = (Math.random() - 0.5) * 0.15;
  asteroidPositions[i * 3] = Math.cos(angle) * a;
  asteroidPositions[i * 3 + 1] = y;
  asteroidPositions[i * 3 + 2] = Math.sin(angle) * a;
}
const asteroidGeo = new THREE.BufferGeometry();
asteroidGeo.setAttribute('position', new THREE.BufferAttribute(asteroidPositions, 3));
const asteroidMat = new THREE.PointsMaterial({ color: 0x887766, size: 0.008, sizeAttenuation: true });
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
//  GALACTIC PLANE (for Galactic scale)
// ═══════════════════════════════════════════════
const galaxyGroup = new THREE.Group();
galaxyGroup.visible = false;
scene.add(galaxyGroup);

const galaxyStarCount = isMobile ? 6000 : 15000;
const gPositions = new Float32Array(galaxyStarCount * 3);
const gColors = new Float32Array(galaxyStarCount * 3);
for (let i = 0; i < galaxyStarCount; i++) {
  const arm = Math.floor(Math.random() * 4);
  const armAngle = (arm / 4) * Math.PI * 2;
  const dist = Math.random() * 50000 * 63241; // up to 50 kly in AU
  const spiralAngle = armAngle + dist / (15000 * 63241) * Math.PI * 2;
  const spread = (Math.random() - 0.5) * dist * 0.15;
  const ySpread = (Math.random() - 0.5) * dist * 0.02;
  gPositions[i * 3] = Math.cos(spiralAngle) * dist + Math.cos(spiralAngle + Math.PI / 2) * spread;
  gPositions[i * 3 + 1] = ySpread;
  gPositions[i * 3 + 2] = Math.sin(spiralAngle) * dist + Math.sin(spiralAngle + Math.PI / 2) * spread;
  const roll = Math.random();
  const temp = roll < 0.5 ? 3000 + Math.random() * 2000 : 5000 + Math.random() * 15000;
  const col = tempToColor(temp);
  gColors[i * 3] = col.r; gColors[i * 3 + 1] = col.g; gColors[i * 3 + 2] = col.b;
}
const galaxyGeo = new THREE.BufferGeometry();
galaxyGeo.setAttribute('position', new THREE.BufferAttribute(gPositions, 3));
galaxyGeo.setAttribute('color', new THREE.BufferAttribute(gColors, 3));
const galaxyMat = new THREE.PointsMaterial({ size: 8000, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.7 });
galaxyGroup.add(new THREE.Points(galaxyGeo, galaxyMat));

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

function initLabels() {
  // Sun
  labelsList.push({ el: createLabel('Sun'), mesh: sunMesh, scaleLevel: 1 });
  // Planets
  planetMeshes.forEach(({ mesh, data }) => {
    labelsList.push({ el: createLabel(data.name), mesh, scaleLevel: 1 });
  });
  // Hardcoded named stars
  namedStarMeshes.forEach(m => {
    labelsList.push({ el: createLabel(m.userData.name), mesh: m, scaleLevel: 2 });
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
    // Update distance display
    const distEl = el.querySelector('.obj-label-dist');
    if (distEl) {
      const dAU = camera.position.distanceTo(_labelWorldPos);
      const dLY = dAU / 63241;
      if (dLY >= 0.01) distEl.textContent = dLY < 1000 ? dLY.toFixed(2) + ' ly' : dLY < 1e6 ? (dLY/1000).toFixed(1) + ' kly' : (dLY/1e6).toFixed(2) + ' Mly';
      else if (dAU >= 0.001) distEl.textContent = dAU.toFixed(3) + ' AU';
      else distEl.textContent = (dAU * AU).toFixed(0) + ' km';
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
      mesh.visible = (currentScale === 2);
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
      mesh.visible = (currentScale === 2);
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

function loadExternalData() {
  fetchRealStars();
  fetchExoplanets();
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
    // ── Solar System ──
    { name:'Sun',     scale:1, spIdx:7, dwell:11, vMult:4.5, getPos:()=>new THREE.Vector3(0,0,0),         r:()=>SUN_RADIUS_VIS },
    { name:'Mercury', scale:1, spIdx:7, dwell:9,  vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Mercury')?.mesh.position.clone(), r:()=>0.008 },
    { name:'Venus',   scale:1, spIdx:7, dwell:9,  vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Venus')?.mesh.position.clone(),   r:()=>0.014 },
    { name:'Earth',   scale:1, spIdx:7, dwell:12, vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Earth')?.mesh.position.clone(),   r:()=>0.015 },
    { name:'Mars',    scale:1, spIdx:7, dwell:10, vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Mars')?.mesh.position.clone(),    r:()=>0.011 },
    { name:'Jupiter', scale:1, spIdx:7, dwell:13, vMult:7,   getPos:()=>planetMeshes.find(p=>p.data.name==='Jupiter')?.mesh.position.clone(), r:()=>0.055 },
    { name:'Saturn',  scale:1, spIdx:7, dwell:14, vMult:7,   getPos:()=>planetMeshes.find(p=>p.data.name==='Saturn')?.mesh.position.clone(),  r:()=>0.055 },
    { name:'Uranus',  scale:1, spIdx:7, dwell:9,  vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Uranus')?.mesh.position.clone(),  r:()=>0.028 },
    { name:'Neptune', scale:1, spIdx:7, dwell:10, vMult:10,  getPos:()=>planetMeshes.find(p=>p.data.name==='Neptune')?.mesh.position.clone(), r:()=>0.026 },
    // ── Stellar Neighbors ──
    { name:'Alpha Centauri', scale:2, spIdx:8, dwell:11, vMult:4, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Alpha Centauri')?.position.clone(), r:()=>0.09 },
    { name:'Sirius',         scale:2, spIdx:8, dwell:10, vMult:4, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Sirius')?.position.clone(),         r:()=>0.10 },
    { name:'Vega',           scale:2, spIdx:8, dwell:9,  vMult:4, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Vega')?.position.clone(),           r:()=>0.08 },
    { name:'Betelgeuse',     scale:2, spIdx:8, dwell:12, vMult:3, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Betelgeuse')?.position.clone(),     r:()=>0.18 },
    { name:'Rigel',          scale:2, spIdx:8, dwell:9,  vMult:4, getPos:()=>namedStarMeshes.find(m=>m.userData.name==='Rigel')?.position.clone(),          r:()=>0.12 },
    // ── Cosmic ──
    { name:'Andromeda Galaxy', scale:4, spIdx:9, dwell:16, vMult:1.2, getPos:()=>raDecToVec3(10.684,41.268,2.5e6*63241), r:()=>8e8 },
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
  // Start with solar system, then shuffle the rest
  const it = _getItinerary();
  const ss  = it.filter(d => d.scale === 1);
  const rest = _shuffle(it.filter(d => d.scale !== 1));
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
      if (Math.random() < 0.38) setTimeout(spawnUFO, 1200 + Math.random() * 2500);
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
      // Smooth blend: lerp from current position to orbit position (fast in first 2s, then lock on)
      const blend = Math.min(1, exploreDwellT * 1.5);
      const lerpRate = Math.min(1, dt * (2 + blend * 6));
      camera.position.x += (goalX - camera.position.x) * lerpRate;
      camera.position.y += (goalY - camera.position.y) * lerpRate;
      camera.position.z += (goalZ - camera.position.z) * lerpRate;
      // Smoothly look at the object
      const toT = new THREE.Vector3().subVectors(target, camera.position).normalize();
      const ty = Math.atan2(-toT.x, -toT.z);
      const tp = Math.asin(Math.max(-1, Math.min(1, toT.y)));
      yaw   += (ty - yaw)   * Math.min(1, dt * 4);
      pitch += (tp - pitch) * Math.min(1, dt * 4);
      roll  += (0 - roll)   * Math.min(1, dt * 3);
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
    { name: 'Sun', distLY: 0, typeLabel: 'Star', mesh: sunMesh, scaleLevel: 1 },
    ...PLANETS.map(p => ({
      name: p.name, distLY: 0, typeLabel: 'Planet',
      mesh: planetMeshes.find(pm => pm.data.name === p.name)?.mesh, scaleLevel: 1
    })),
    ...STAR_DATA.map(s => ({
      name: s.name, distLY: s.dist, typeLabel: 'Star',
      mesh: namedStarMeshes.find(m => m.userData.name === s.name), scaleLevel: 2
    })),
    ...searchableObjects.map(o => ({ ...o, scaleLevel: o.typeLabel === 'Planet' ? 1 : 2 }))
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
      setTravelDest({ position: obj.mesh.position.clone(), name: obj.name, distLY: obj.distLY, scaleLevel: obj.scaleLevel });
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
  camera.position.set(
    target.x + Math.cos(angle) * r,
    target.y + h + Math.sin(angle * 0.42) * h * 0.45,
    target.z + Math.sin(angle) * r
  );
  const toT = new THREE.Vector3().subVectors(target, camera.position).normalize();
  yaw   += (Math.atan2(-toT.x, -toT.z) - yaw)   * Math.min(1, dt * 5);
  pitch += (Math.asin(Math.max(-1, Math.min(1, toT.y))) - pitch) * Math.min(1, dt * 5);
  roll  += (0 - roll) * Math.min(1, dt * 3);
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
    : Math.max(0.3, objR * 6);                          // nav computer: 6× object radius
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
    yaw   += (ty - yaw)   * Math.min(1, dt * 4);
    pitch += (tp - pitch) * Math.min(1, dt * 4);

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
    yaw   += (ty - yaw)   * Math.min(1, dt * 4);
    pitch += (tp - pitch) * Math.min(1, dt * 4);

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

let currentScale = 1; // index into SCALE_LEVELS
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
function applyScale() {
  const level = currentScale;
  // Visibility
  sunGroup.visible = level <= 1;
  planetMeshes.forEach(p => p.mesh.visible = level <= 1);
  orbitLines.forEach(l => l.visible = level <= 1);
  atomGroup.visible = level === 0;
  namedStarMeshes.forEach(m => m.visible = level === 2);
  liveStarMeshes.forEach(m => m.visible = level === 2);
  exoplanetMarkers.forEach(m => m.visible = level === 2);
  galaxyGroup.visible = level === 3;
  cosmicGroup.visible = level === 4;
  lightSphere.visible = level === 1;

  // Adjust camera & fog based on scale
  if (level === 0) {
    camera.near = 0.001; camera.far = 100;
    scene.fog.density = 0.05;
    camera.position.set(0, 0.5, 1.5);
    speedLevel = 5; moveSpeed = getSpeedFromLevel(5);
  } else if (level === 1) {
    camera.near = 0.0001; camera.far = 5000;
    scene.fog.density = 0.0008;
    speedLevel = 10; moveSpeed = getSpeedFromLevel(10);
  } else if (level === 2) {
    camera.near = 0.1; camera.far = 5000000;
    scene.fog.density = 0.0000001;
    camera.position.set(0, 10000, 30000);
    speedLevel = 25; moveSpeed = getSpeedFromLevel(25);
  } else if (level === 3) {
    camera.near = 100; camera.far = 5e9;
    scene.fog.density = 0;
    camera.position.set(0, 1e7, 3e7);
    speedLevel = 32; moveSpeed = getSpeedFromLevel(32);
  } else if (level === 4) {
    camera.near = 1e6; camera.far = 1e14;
    scene.fog.density = 0;
    camera.position.set(0, 1e11, 3e11);
    speedLevel = 38; moveSpeed = getSpeedFromLevel(38);
  }
  camera.updateProjectionMatrix();
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
//  MISSION REPORT
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
  applyScale();
  lastTime = performance.now();

  // Show welcome intro (10s), then controls (10s) — each dismissable via X
  // Show welcome — stays until user closes it
  const welcomeEl = document.getElementById('welcome-intro');
  welcomeEl.classList.add('active');
  function _dismissWelcome() {
    if (!welcomeEl.classList.contains('active')) return;
    welcomeEl.classList.remove('active');
    // Show controls overlay — stays until user closes it
    controlsOpen = true;
    document.getElementById('controls-overlay').classList.add('open');
  }
  document.getElementById('welcome-close-btn').addEventListener('click', _dismissWelcome);
});
document.getElementById('splash-launches-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('splash').classList.add('hidden');
  openLaunchHistory();
});

// ═══════════════════════════════════════════════
//  LAUNCH SIMULATOR
// ═══════════════════════════════════════════════
let _simActive = false;
let _simRenderer = null, _simScene = null, _simCam = null;
let _simRocket = null, _simExhaust = null, _simEarth = null;
let _simT = 0, _simRunning = false, _simLastT = 0;
let _simAlt = 0, _simVel = 0, _simAccel = 0, _simFuel = 100, _simStage = 1;
let _simTrajectoryLine = null;
let _simTickerTimeout = null;
let _simCurrentProvider = 'SpaceX';

const SIM_SITES = {
  KSC:   { lat: 28.57, lon: -80.65, name: 'Kennedy Space Center' },
  CCSFS: { lat: 28.50, lon: -80.58, name: 'Cape Canaveral' },
  Boca:  { lat: 25.99, lon: -97.15, name: 'Starbase, TX' },
  Vandy: { lat: 34.63, lon: -120.63, name: 'Vandenberg SFB' },
  Kourou: { lat: 5.23, lon: -52.77, name: 'Kourou, Fr. Guiana' }
};

const PROVIDER_ROCKETS = {
  'SpaceX': [
    { name: 'Falcon 9', thrust: 7600, mass: 549000, fuel: 411000, stages: 2, isp: 311, height: 70, desc: 'Workhorse medium-lift reusable rocket' },
    { name: 'Falcon Heavy', thrust: 22800, mass: 1421000, fuel: 1100000, stages: 2, isp: 311, height: 70, desc: 'World\'s most powerful operational rocket' },
    { name: 'Starship', thrust: 74000, mass: 5000000, fuel: 4600000, stages: 2, isp: 350, height: 120, desc: 'Super heavy-lift next-gen launch system' },
  ],
  'NASA': [
    { name: 'SLS', thrust: 39000, mass: 2600000, fuel: 2100000, stages: 2, isp: 363, height: 98, desc: 'Space Launch System for deep space' },
    { name: 'Saturn V', thrust: 34000, mass: 2970000, fuel: 2200000, stages: 3, isp: 304, height: 111, desc: 'Apollo-era super heavy-lift vehicle' },
  ],
  'Blue Origin': [
    { name: 'New Glenn', thrust: 17100, mass: 590000, fuel: 450000, stages: 2, isp: 320, height: 98, desc: 'Heavy-lift orbital rocket with reusable booster' },
    { name: 'New Shepard', thrust: 490, mass: 75000, fuel: 55000, stages: 1, isp: 255, height: 18, desc: 'Suborbital tourism vehicle' },
  ],
  'ESA': [
    { name: 'Ariane 6', thrust: 8000, mass: 530000, fuel: 400000, stages: 2, isp: 340, height: 63, desc: 'European heavy-lift launcher' },
    { name: 'Vega-C', thrust: 3015, mass: 210000, fuel: 180000, stages: 4, isp: 280, height: 35, desc: 'European small satellite launcher' },
  ],
  'ISRO': [
    { name: 'LVM3', thrust: 6847, mass: 640000, fuel: 500000, stages: 3, isp: 316, height: 43, desc: 'India\'s heaviest operational launcher' },
    { name: 'PSLV', thrust: 4860, mass: 320000, fuel: 260000, stages: 4, isp: 290, height: 44, desc: 'Polar Satellite Launch Vehicle' },
  ],
  'Custom': [
    { name: 'Falcon 9', thrust: 7600, mass: 549000, fuel: 411000, stages: 2, isp: 311, height: 70, desc: 'Default configuration' },
  ]
};

const SIM_LAUNCH_MESSAGES = [
  { time: -10, text: 'All systems nominal. Go for launch.' },
  { time: -5, text: 'Main engine start sequence initiated.' },
  { time: 0, text: 'LIFTOFF! We have liftoff!' },
  { time: 10, text: 'Vehicle is supersonic.' },
  { time: 60, text: 'Max Q \u2014 maximum dynamic pressure.' },
  { time: 150, text: 'Main engine cutoff. Stage separation.' },
  { time: 180, text: 'Second stage ignition confirmed.' },
  { time: 300, text: 'Fairing separation.' },
  { time: 500, text: 'Approaching orbital velocity.' },
];
const SIM_ORBIT_MESSAGE = 'Orbit insertion confirmed. Mission success!';

// Build a flat lookup from provider rockets for physics
function _getSelectedRocketData() {
  const rocketName = _getSimVal('sim-rocket');
  const rockets = PROVIDER_ROCKETS[_simCurrentProvider] || PROVIDER_ROCKETS['SpaceX'];
  const found = rockets.find(r => r.name === rocketName);
  if (found) return found;
  // fallback
  return PROVIDER_ROCKETS['SpaceX'][0];
}

function _getSimVal(groupId) {
  const active = document.querySelector(`#${groupId} .sim-opt-btn.active`);
  return active ? active.dataset.val : '';
}

function _updateRocketOptions(providerName) {
  _simCurrentProvider = providerName;
  const container = document.getElementById('sim-rocket');
  if (!container) return;
  const rockets = PROVIDER_ROCKETS[providerName] || PROVIDER_ROCKETS['SpaceX'];
  container.innerHTML = '';
  rockets.forEach((rocket, idx) => {
    const btn = document.createElement('button');
    btn.className = 'sim-opt-btn' + (idx === 0 ? ' active' : '');
    btn.dataset.val = rocket.name;
    btn.textContent = rocket.name;
    btn.title = rocket.desc;
    btn.addEventListener('click', () => {
      container.querySelectorAll('.sim-opt-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Rebuild rocket model if viewer is active
      if (_simScene && _simRocket) {
        _simScene.remove(_simRocket);
        _simRocket = buildRocket(btn.dataset.val);
        _simRocket.position.set(0, 0.22, 0);
        _simScene.add(_simRocket);
      }
    });
    container.appendChild(btn);
  });
}

function _rotateEarthToSite(siteKey) {
  if (!_simEarth) return;
  const site = SIM_SITES[siteKey];
  if (!site) return;
  // Convert lat/lon to rotation: we want the site to face the camera (+Z direction)
  // Earth's default orientation has prime meridian facing +Z
  // To rotate site to face camera, set Y rotation = -lon in radians, and tilt X = -lat
  const lonRad = site.lon * (Math.PI / 180);
  const latRad = site.lat * (Math.PI / 180);
  // Y rotation puts the longitude facing the camera
  _simEarth.rotation.y = -lonRad + Math.PI;
  // X rotation tilts so the latitude faces the camera (relative to equator)
  _simEarth.rotation.x = latRad;
}

function _showTickerMessage(text) {
  const tickerEl = document.getElementById('sim-ticker-text');
  if (!tickerEl) return;
  tickerEl.classList.remove('typing');
  tickerEl.textContent = text;
  // Force reflow to restart animation
  void tickerEl.offsetWidth;
  tickerEl.classList.add('typing');
}

function _clearTicker() {
  if (_simTickerTimeout) { clearTimeout(_simTickerTimeout); _simTickerTimeout = null; }
  const tickerEl = document.getElementById('sim-ticker-text');
  if (tickerEl) { tickerEl.textContent = ''; tickerEl.classList.remove('typing'); }
}

function _scheduleTickerMessages() {
  _clearTicker();
  // _simT starts at 0 at liftoff. Messages have times relative to T-0.
  // We use a countdown approach: schedule messages based on sim time offsets.
  // The countdown starts at T-10, so actual sim time for each message = message.time + 10
  // Actually, _simT is incremented continuously from 0. Let's use real wall-clock scheduling
  // since the sim time progresses in real-time (roughly).
  let _tickerMsgIndex = 0;

  function checkAndShow() {
    if (!_simRunning && _tickerMsgIndex < SIM_LAUNCH_MESSAGES.length) {
      // launch ended early
      return;
    }
    if (_tickerMsgIndex >= SIM_LAUNCH_MESSAGES.length) return;

    const msg = SIM_LAUNCH_MESSAGES[_tickerMsgIndex];
    // Messages with time < 0 are countdown messages shown before T-0
    // _simT starts at 0 and goes up. We offset: message shows at _simT = msg.time + 10
    // (i.e., first 10 seconds are countdown)
    const showAtSimT = msg.time + 10;

    if (_simT >= showAtSimT) {
      _showTickerMessage(msg.text);
      _tickerMsgIndex++;
      if (_tickerMsgIndex < SIM_LAUNCH_MESSAGES.length) {
        _simTickerTimeout = setTimeout(checkAndShow, 500);
      }
    } else {
      const waitMs = Math.max(100, (showAtSimT - _simT) * 1000 * 0.8);
      _simTickerTimeout = setTimeout(checkAndShow, Math.min(waitMs, 2000));
    }
  }

  checkAndShow();
}

function _createTrajectoryLine() {
  // Remove existing trajectory if any
  _removeTrajectoryLine();

  if (!_simScene || !_simRocket) return;

  // Create a curved trajectory line from launch position upward
  const startY = 0.22; // launch surface
  const endY = 4.0; // high above earth
  const endX = 1.5; // offset for gravity turn

  const start = new THREE.Vector3(0, startY, 0);
  const control = new THREE.Vector3(0.2, (startY + endY) * 0.6, 0);
  const end = new THREE.Vector3(endX, endY, 0);

  const curve = new THREE.QuadraticBezierCurve3(start, control, end);
  const points = curve.getPoints(64);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: 0x00eeff,
    transparent: true,
    opacity: 0.25,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  _simTrajectoryLine = new THREE.Line(geometry, material);
  _simScene.add(_simTrajectoryLine);
}

function _removeTrajectoryLine() {
  if (_simTrajectoryLine && _simScene) {
    _simScene.remove(_simTrajectoryLine);
    if (_simTrajectoryLine.geometry) _simTrajectoryLine.geometry.dispose();
    if (_simTrajectoryLine.material) _simTrajectoryLine.material.dispose();
    _simTrajectoryLine = null;
  }
}

function openLaunchSim() {
  _simActive = true;
  document.getElementById('launch-sim').classList.add('open');
  _simRunning = false;
  _simT = 0; _simAlt = 0; _simVel = 0; _simFuel = 100; _simStage = 1;
  document.getElementById('sim-status').textContent = 'CONFIGURE MISSION';
  _updateSimTelemetry();
  _clearTicker();
  // Initialize rocket options for current provider
  _updateRocketOptions(_simCurrentProvider);
  setTimeout(() => _initSimViewer(), 60);
}

function closeLaunchSim() {
  _simActive = false; _simRunning = false;
  _clearTicker();
  _removeTrajectoryLine();
  document.getElementById('launch-sim').classList.remove('open');
  document.getElementById('splash').classList.remove('hidden');
  if (_simRenderer) { _simRenderer.dispose(); _simRenderer = null; }
}

function _initSimViewer() {
  if (_simRenderer) return;
  const canvas = document.getElementById('sim-canvas');
  const w = canvas.offsetWidth, h = canvas.offsetHeight;
  if (!w || !h) return;
  _simRenderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  _simRenderer.setSize(w, h);
  _simRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  _simRenderer.setClearColor(0x010208, 1);

  _simScene = new THREE.Scene();
  _simCam = new THREE.PerspectiveCamera(50, w / h, 0.01, 2000);
  _simCam.position.set(3, 2, 5);
  _simCam.lookAt(0, 1, 0);

  // Earth
  const eGeo = new THREE.SphereGeometry(2, 48, 48);
  const eTex = _mkTex(256, 128, _pTexFns.Earth);
  _simEarth = new THREE.Mesh(eGeo, new THREE.MeshStandardMaterial({ map: eTex, roughness: 0.8 }));
  _simEarth.position.set(0, -1.8, 0);
  _simScene.add(_simEarth);

  // Rotate earth to selected launch site
  const selectedSite = _getSimVal('sim-site') || 'KSC';
  _rotateEarthToSite(selectedSite);

  // Atmosphere glow
  const aCanvas = document.createElement('canvas'); aCanvas.width = 128; aCanvas.height = 128;
  const aCtx = aCanvas.getContext('2d');
  const aGrad = aCtx.createRadialGradient(64, 64, 28, 64, 64, 64);
  aGrad.addColorStop(0, 'rgba(100,160,255,0)');
  aGrad.addColorStop(0.6, 'rgba(100,160,255,0)');
  aGrad.addColorStop(0.8, 'rgba(100,160,255,0.15)');
  aGrad.addColorStop(1, 'rgba(100,160,255,0)');
  aCtx.fillStyle = aGrad; aCtx.fillRect(0, 0, 128, 128);
  const atmo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(aCanvas), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  atmo.scale.setScalar(6); _simEarth.add(atmo);

  // Rocket (built from selected model)
  const rocketName = _getSimVal('sim-rocket') || 'Falcon 9';
  _simRocket = buildRocket(rocketName);
  _simRocket.position.set(0, 0.22, 0);
  _simScene.add(_simRocket);

  // Multi-layer exhaust system
  // Layer 1: core flame (bright yellow-white)
  const ex1Geo = new THREE.BufferGeometry();
  const ex1Pos = new Float32Array(20 * 3);
  ex1Geo.setAttribute('position', new THREE.BufferAttribute(ex1Pos, 3));
  const ex1 = new THREE.Points(ex1Geo, new THREE.PointsMaterial({ color: 0xffeedd, size: 0.008, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
  // Layer 2: outer flame (orange)
  const ex2Geo = new THREE.BufferGeometry();
  const ex2Pos = new Float32Array(40 * 3);
  ex2Geo.setAttribute('position', new THREE.BufferAttribute(ex2Pos, 3));
  const ex2 = new THREE.Points(ex2Geo, new THREE.PointsMaterial({ color: 0xff6600, size: 0.016, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
  // Layer 3: smoke plume (only in atmosphere)
  const ex3Geo = new THREE.BufferGeometry();
  const ex3Pos = new Float32Array(30 * 3);
  ex3Geo.setAttribute('position', new THREE.BufferAttribute(ex3Pos, 3));
  const ex3 = new THREE.Points(ex3Geo, new THREE.PointsMaterial({ color: 0x886644, size: 0.028, transparent: true, opacity: 0.3, blending: THREE.NormalBlending, depthWrite: false }));
  _simExhaust = { grp: new THREE.Group(), layers: [{pts:ex1,pos:ex1Pos,n:20,spread:0.015,lenMin:0.02,lenMax:0.08},{pts:ex2,pos:ex2Pos,n:40,spread:0.04,lenMin:0.04,lenMax:0.18},{pts:ex3,pos:ex3Pos,n:30,spread:0.06,lenMin:0.08,lenMax:0.30}] };
  _simExhaust.grp.add(ex1, ex2, ex3);
  _simExhaust.grp.visible = false;
  _simScene.add(_simExhaust.grp);

  // Lights
  _simScene.add(new THREE.AmbientLight(0x223344, 0.4));
  const sunL = new THREE.DirectionalLight(0xfff0dd, 1.2);
  sunL.position.set(5, 3, 2);
  _simScene.add(sunL);

  // Stars
  const sPos = new Float32Array(500 * 3);
  for (let i = 0; i < 500; i++) {
    const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1), r = 400 + Math.random() * 600;
    sPos[i*3] = r * Math.sin(ph) * Math.cos(th);
    sPos[i*3+1] = r * Math.sin(ph) * Math.sin(th);
    sPos[i*3+2] = r * Math.cos(ph);
  }
  const sGeo = new THREE.BufferGeometry();
  sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  _simScene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: true })));

  requestAnimationFrame(t => { _simLastT = t; _simAnimate(t); });
}

function _updateSimTelemetry() {
  const mins = Math.floor(_simT / 60), secs = Math.floor(_simT % 60);
  document.getElementById('sim-t-time').textContent = `${String(mins).padStart(2,'0')}:${String(secs).padStart(2,'0')}`;
  document.getElementById('sim-t-alt').textContent = _simAlt < 1000 ? `${_simAlt.toFixed(1)} km` : `${(_simAlt/1000).toFixed(2)} Mm`;
  document.getElementById('sim-t-vel').textContent = _simVel < 1000 ? `${_simVel.toFixed(0)} m/s` : `${(_simVel/1000).toFixed(2)} km/s`;
  document.getElementById('sim-t-accel').textContent = `${_simAccel.toFixed(1)} g`;
  document.getElementById('sim-t-fuel').textContent = `${Math.max(0, _simFuel).toFixed(0)}%`;
  document.getElementById('sim-t-stage').textContent = _simStage;
  document.getElementById('sim-t-status').textContent = !_simRunning ? 'READY' : _simFuel <= 0 ? 'MECO \u2014 COASTING' : _simStage === 1 ? 'POWERED FLIGHT' : 'STAGE 2 BURN';
}

function _startLaunch() {
  if (_simRunning) return;
  _simRunning = true; _simT = 0; _simAlt = 0; _simVel = 0; _simFuel = 100; _simStage = 1; _simAccel = 0;
  if (_simRocket) _simRocket.position.set(0, 0.22, 0);
  if (_simExhaust) _simExhaust.grp.visible = true;
  document.getElementById('sim-status').textContent = 'LAUNCH IN PROGRESS';
  document.getElementById('sim-launch-btn').textContent = 'LAUNCHING...';
  document.getElementById('sim-launch-btn').classList.add('counting');

  // Create trajectory line
  _createTrajectoryLine();

  // Start ticker messages
  _scheduleTickerMessages();
}

function _simAnimate(now) {
  if (!_simActive || !_simRenderer) return;
  requestAnimationFrame(_simAnimate);
  const dt = Math.min((now - _simLastT) / 1000, 0.1); _simLastT = now;

  if (_simRunning) {
    _simT += dt;
    const rData = _getSelectedRocketData();

    // Simple physics
    if (_simFuel > 0) {
      const thrustG = (rData.thrust * 1000) / (rData.mass * 9.81);
      _simAccel = thrustG * (_simFuel / 100) * 1.2;
      _simVel += _simAccel * 9.81 * dt;
      _simFuel -= dt * (100 / (rData.fuel / (rData.thrust * 1000 / (rData.isp * 9.81))));
      if (_simFuel <= 0) { _simFuel = 0; _simAccel = 0; }
    } else {
      _simAccel = 0;
      _simVel -= 0.5 * dt; // gentle gravity drag in coast
    }
    _simAlt += _simVel * dt / 1000; // m/s to km

    // Stage separation
    if (_simStage === 1 && _simFuel < 30 && _simT > 10) { _simStage = 2; }

    // Move rocket up
    if (_simRocket) {
      const rY = 0.22 + Math.min(_simAlt / 50, 3.5);
      _simRocket.position.y = rY;
      // Slight gravity turn
      _simRocket.rotation.z = Math.min(_simT * 0.008, 0.35);
    }

    // Update trajectory line opacity based on progress
    if (_simTrajectoryLine) {
      _simTrajectoryLine.material.opacity = 0.15 + Math.min(_simAlt / 400, 0.5);
    }

    // Multi-layer exhaust
    if (_simExhaust && _simFuel > 0) {
      const rPos = _simRocket ? _simRocket.position : { x: 0, y: 0.22, z: 0 };
      _simExhaust.layers.forEach(layer => {
        const p = layer.pos;
        for (let i = 0; i < layer.n; i++) {
          const age = Math.random();
          p[i*3]   = rPos.x + (Math.random()-0.5)*layer.spread;
          p[i*3+1] = rPos.y - 0.09 - age*(layer.lenMin + Math.random()*(layer.lenMax-layer.lenMin));
          p[i*3+2] = rPos.z + (Math.random()-0.5)*layer.spread;
        }
        layer.pts.geometry.attributes.position.needsUpdate = true;
      });
      // Hide smoke layer above atmosphere
      _simExhaust.layers[2].pts.visible = _simAlt < 80;
    }
    if (_simExhaust && _simFuel <= 0) _simExhaust.grp.visible = false;

    // Camera follows rocket
    if (_simCam && _simRocket) {
      const tY = _simRocket.position.y;
      _simCam.position.y += (tY + 0.5 - _simCam.position.y) * dt * 2;
      _simCam.lookAt(_simRocket.position.x, tY, _simRocket.position.z);
    }

    _updateSimTelemetry();

    // End condition
    if (_simAlt > 400) {
      _simRunning = false;
      document.getElementById('sim-status').textContent = 'ORBIT ACHIEVED';
      document.getElementById('sim-launch-btn').textContent = 'INITIATE LAUNCH SEQUENCE';
      document.getElementById('sim-launch-btn').classList.remove('counting');
      document.getElementById('sim-t-status').textContent = 'ORBIT INSERTION';
      _showTickerMessage(SIM_ORBIT_MESSAGE);
    }
  }

  _simEarth.rotation.y += dt * 0.02;
  _simRenderer.render(_simScene, _simCam);
}

// Wire provider buttons to update rocket options
document.getElementById('sim-provider').addEventListener('click', (e) => {
  const btn = e.target.closest('.sim-opt-btn');
  if (!btn) return;
  document.querySelectorAll('#sim-provider .sim-opt-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  _updateRocketOptions(btn.dataset.val);
  // Rebuild rocket model if viewer is active
  const firstRocket = (PROVIDER_ROCKETS[btn.dataset.val] || PROVIDER_ROCKETS['SpaceX'])[0];
  if (_simScene && _simRocket && firstRocket) {
    _simScene.remove(_simRocket);
    _simRocket = buildRocket(firstRocket.name);
    _simRocket.position.set(0, 0.22, 0);
    _simScene.add(_simRocket);
  }
});

// Wire other sim option groups (destination, site) with delegated events
['sim-dest', 'sim-site'].forEach(groupId => {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.addEventListener('click', (e) => {
    const btn = e.target.closest('.sim-opt-btn');
    if (!btn) return;
    group.querySelectorAll('.sim-opt-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // If launch site changed, rotate earth
    if (groupId === 'sim-site') {
      _rotateEarthToSite(btn.dataset.val);
    }
  });
});

// Wire sim inputs to stop propagation
document.querySelectorAll('.sim-input').forEach(inp => {
  inp.addEventListener('keydown', e => e.stopPropagation());
  inp.addEventListener('touchstart', e => e.stopPropagation());
});

document.getElementById('sim-launch-btn').addEventListener('click', _startLaunch);
document.getElementById('sim-back-btn').addEventListener('click', closeLaunchSim);
document.getElementById('splash-sim-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('splash').classList.add('hidden');
  openLaunchSim();
});

// Initialize rocket options for default provider on load
_updateRocketOptions('SpaceX');

// Sim canvas resize
window.addEventListener('resize', () => {
  if (_simRenderer && _simActive) {
    const canvas = document.getElementById('sim-canvas');
    const w = canvas.offsetWidth, h = canvas.offsetHeight;
    if (w && h) { _simRenderer.setSize(w, h); _simCam.aspect = w / h; _simCam.updateProjectionMatrix(); }
  }
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
initUFO(scene, camera, () => ({ currentScale, exploreMode, started }));

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
      mesh.rotation.y += dt * 0.5;
      // Spin cloud layer slightly faster than planet
      mesh.children.forEach(c => { if (c.userData._cloudSpin) c.rotation.y += dt * 0.08; });
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

  updateExplore(dt);
  updateTravel(dt);
  updateArrivalOrbit(dt);
  updateUFO(dt);
  updateComets(dt, simTime, currentScale);
  updateHUD();
  tickFacts(dt);
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

// ═══════════════════════════════════════════════
//  LAUNCH HISTORY MODE
// ═══════════════════════════════════════════════




// Launch History extracted to launchHistory.js


}
