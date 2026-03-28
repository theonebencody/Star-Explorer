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
import { STARSHIP_PROFILE, seekToTime } from './flightProfiles.js';
import { openMissionPlanner, closeMissionPlanner, initMissionPlanner } from './missionPlanner.js';
import { initGalaxyRenderer, buildGalaxy, updateGalaxies } from './galaxyRenderer.js';

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
const sunMat = new THREE.MeshBasicMaterial({ color: 0xffb060 });
const sunMesh = new THREE.Mesh(sunGeo, sunMat);
sunGroup.add(sunMesh);

// Sun point light — warmer, more orange-red
const sunLight = new THREE.PointLight(0xffe0b0, 2.8, 200, 1);
sunGroup.add(sunLight);

// Sun glow sprites — warmer/redder tones
const _sunGlowSprites = [];
for (let i = 0; i < 3; i++) {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  const alpha = [0.35, 0.18, 0.08][i];
  const col = ['255,220,160', '255,170,70', '255,120,30'][i];
  grad.addColorStop(0, `rgba(${col},${alpha})`);
  grad.addColorStop(0.4, `rgba(${col},${alpha * 0.4})`);
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  const spriteMat = new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(spriteMat);
  sprite.scale.setScalar([0.8, 1.5, 3.0][i]);
  sunGroup.add(sprite);
  _sunGlowSprites.push({ sprite, baseScale: [0.8, 1.5, 3.0][i] });
}

// ── Solar Flares — animated arcs that erupt and fade ──
const _solarFlares = [];
const _FLARE_COUNT = 8;
for (let i = 0; i < _FLARE_COUNT; i++) {
  const fc = document.createElement('canvas'); fc.width = 64; fc.height = 128;
  const fctx = fc.getContext('2d');
  // Draw flame shape using overlapping soft ellipses — no rectangles
  // Wide base narrowing to a wispy tip
  for (let layer = 0; layer < 12; layer++) {
    const t = layer / 12; // 0=base, 1=tip
    const cy = 120 - t * 110; // y position: bottom to top
    const rx = (1 - t * t) * 22 + 3; // width: wide base, narrow tip (quadratic falloff)
    const ry = 8 + (1 - t) * 10; // vertical extent
    const wobble = Math.sin(layer * 1.7 + i * 2.3) * 4; // slight random sway
    const g = fctx.createRadialGradient(32 + wobble, cy, 0, 32 + wobble, cy, Math.max(rx, ry));
    const alpha = (1 - t * 0.8) * 0.2;
    const r2 = 255, g2 = Math.max(0, 160 - t * 120) | 0, b2 = Math.max(0, 50 - t * 45) | 0;
    g.addColorStop(0, `rgba(${r2},${g2},${b2},${alpha})`);
    g.addColorStop(0.4, `rgba(${r2},${g2*0.7|0},${b2*0.5|0},${alpha*0.4})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    fctx.fillStyle = g;
    fctx.beginPath();
    fctx.ellipse(32 + wobble, cy, rx, ry, 0, 0, Math.PI * 2);
    fctx.fill();
  }
  // Hot white-yellow core at base
  const cg = fctx.createRadialGradient(32, 118, 0, 32, 118, 14);
  cg.addColorStop(0, 'rgba(255,240,180,0.7)');
  cg.addColorStop(0.4, 'rgba(255,180,60,0.3)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  fctx.fillStyle = cg;
  fctx.beginPath(); fctx.ellipse(32, 118, 14, 10, 0, 0, Math.PI * 2); fctx.fill();
  const flareMat = new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(fc), blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false, opacity: 0
  });
  const flareSprite = new THREE.Sprite(flareMat);
  flareSprite.scale.set(0.08, 0.15, 1);
  // Position randomly around Sun surface
  const angle = (i / _FLARE_COUNT) * Math.PI * 2;
  flareSprite.position.set(
    Math.cos(angle) * SUN_RADIUS_VIS * 1.05,
    (Math.random() - 0.5) * SUN_RADIUS_VIS * 0.6,
    Math.sin(angle) * SUN_RADIUS_VIS * 1.05
  );
  sunGroup.add(flareSprite);
  _solarFlares.push({
    sprite: flareSprite, mat: flareMat,
    angle, phase: Math.random() * 100, // random start time
    lifetime: 3 + Math.random() * 5, // seconds before next eruption
    timer: Math.random() * 8, // offset so they don't all fire at once
    active: false, progress: 0,
    baseY: flareSprite.position.y,
  });
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
  // Outer planets get more emissive so they're visible in low sunlight
  const emissiveStrength = p.a > 15 ? 0.18 : p.a > 5 ? 0.14 : p.a > 1.5 ? 0.06 : 0.03;
  const mat = new THREE.MeshStandardMaterial({
    color: p.color,
    roughness: 0.65,
    metalness: 0.08,
    emissive: new THREE.Color(p.color).multiplyScalar(emissiveStrength)
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  // Saturn rings with Cassini division
  if (p.rings) {
    const ringInner = p.rVis * 1.3, ringOuter = p.rVis * 2.5;
    const ringCanvas = document.createElement('canvas'); ringCanvas.width = 256; ringCanvas.height = 4;
    const rctx = ringCanvas.getContext('2d');
    const rg = rctx.createLinearGradient(0,0,256,0);
    // C ring (faint)
    rg.addColorStop(0, 'rgba(178,158,118,0.15)');
    rg.addColorStop(0.15, 'rgba(178,158,118,0.22)');
    // B ring (bright)
    rg.addColorStop(0.2, 'rgba(218,198,155,0.7)');
    rg.addColorStop(0.38, 'rgba(220,200,158,0.75)');
    // Cassini Division (dark gap)
    rg.addColorStop(0.4, 'rgba(22,16,10,0.06)');
    rg.addColorStop(0.44, 'rgba(22,16,10,0.06)');
    // A ring
    rg.addColorStop(0.46, 'rgba(192,172,128,0.6)');
    rg.addColorStop(0.65, 'rgba(185,165,120,0.55)');
    // Encke Gap
    rg.addColorStop(0.67, 'rgba(40,30,20,0.08)');
    rg.addColorStop(0.69, 'rgba(185,165,120,0.45)');
    // F ring (faint outer)
    rg.addColorStop(0.85, 'rgba(160,140,100,0.15)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    rctx.fillStyle = rg; rctx.fillRect(0,0,256,4);
    const ringTex = new THREE.CanvasTexture(ringCanvas);
    ringTex.wrapS = THREE.ClampToEdgeWrapping;

    // Build ring geometry with UV mapping
    const segments = 128, rows = 3;
    const ringVerts = [], ringUvs = [], ringIdx = [];
    for (let row = 0; row <= rows; row++) {
      const r = ringInner + (ringOuter - ringInner) * (row / rows);
      const v = row / rows;
      for (let seg = 0; seg <= segments; seg++) {
        const a = (seg / segments) * Math.PI * 2;
        ringVerts.push(Math.cos(a) * r, 0, Math.sin(a) * r);
        ringUvs.push(v, seg / segments);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let seg = 0; seg < segments; seg++) {
        const a = row * (segments + 1) + seg;
        const b = a + segments + 1;
        ringIdx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    }
    const ringGeo = new THREE.BufferGeometry();
    ringGeo.setAttribute('position', new THREE.Float32BufferAttribute(ringVerts, 3));
    ringGeo.setAttribute('uv', new THREE.Float32BufferAttribute(ringUvs, 2));
    ringGeo.setIndex(ringIdx);
    const ringMat = new THREE.MeshBasicMaterial({
      map: ringTex, side: THREE.DoubleSide, transparent: true, depthWrite: false, opacity: 0.85
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI * 0.45;
    mesh.add(ringMesh);
  }

  // Atmospheric glow for gas giants and Venus/Earth
  if (['Jupiter','Saturn','Uranus','Neptune','Earth','Venus'].includes(p.name)) {
    const atmoCanvas = document.createElement('canvas'); atmoCanvas.width = 64; atmoCanvas.height = 64;
    const actx = atmoCanvas.getContext('2d');
    const ag = actx.createRadialGradient(32,32,16,32,32,32);
    const atmoColors = {
      Earth: '100,160,255', Venus: '220,200,150', Jupiter: '200,180,140',
      Saturn: '210,195,150', Uranus: '130,200,220', Neptune: '70,100,200'
    };
    const atmoAlpha = { Earth: 0.18, Venus: 0.12, Jupiter: 0.1, Saturn: 0.08, Uranus: 0.15, Neptune: 0.14 };
    const ac = atmoColors[p.name] || '200,200,255';
    const aa = atmoAlpha[p.name] || 0.1;
    ag.addColorStop(0, 'rgba(0,0,0,0)');
    ag.addColorStop(0.6, 'rgba(0,0,0,0)');
    ag.addColorStop(0.8, `rgba(${ac},${aa})`);
    ag.addColorStop(0.92, `rgba(${ac},${aa*0.4})`);
    ag.addColorStop(1, 'rgba(0,0,0,0)');
    actx.fillStyle = ag; actx.fillRect(0,0,64,64);
    const atmoSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(atmoCanvas), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
    }));
    atmoSprite.scale.setScalar(p.rVis * 3.5);
    mesh.add(atmoSprite);
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
  const orbitMat = new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.18 });
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

// Load real textures for major moons
['Moon', 'Io', 'Europa', 'Ganymede', 'Callisto', 'Titan', 'Enceladus', 'Triton'].forEach(moonName => {
  loadRealTexture(moonName.toLowerCase(), (tex) => {
    if (!tex) return;
    const entry = moonMeshes.find(m => m.data.name === moonName);
    if (entry) { entry.mesh.material.map = tex; entry.mesh.material.needsUpdate = true; }
  });
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

// ── Kuiper Belt (30-50 AU) ──
const kuiperCount = isMobile ? 600 : 1500;
const kuiperPos = new Float32Array(kuiperCount * 3);
const kuiperCol = new Float32Array(kuiperCount * 3);
for (let i = 0; i < kuiperCount; i++) {
  const a = 30 + Math.random() * 20; // 30-50 AU
  const angle = Math.random() * Math.PI * 2;
  const y = (Math.random() - 0.5) * 0.8; // wider spread than asteroid belt
  kuiperPos[i*3] = Math.cos(angle) * a;
  kuiperPos[i*3+1] = y;
  kuiperPos[i*3+2] = Math.sin(angle) * a;
  const shade = 0.25 + Math.random() * 0.2;
  // Icy blue-gray tones
  kuiperCol[i*3] = shade * 0.85; kuiperCol[i*3+1] = shade * 0.9; kuiperCol[i*3+2] = shade;
}
const kuiperGeo = new THREE.BufferGeometry();
kuiperGeo.setAttribute('position', new THREE.BufferAttribute(kuiperPos, 3));
kuiperGeo.setAttribute('color', new THREE.BufferAttribute(kuiperCol, 3));
scene.add(new THREE.Points(kuiperGeo, new THREE.PointsMaterial({
  map: asteroidTex, vertexColors: true, size: 0.005, sizeAttenuation: true,
  transparent: true, opacity: 0.6, depthWrite: false, alphaTest: 0.01
})));

// ═══════════════════════════════════════════════
//  GRAPHICS ENHANCEMENT: Noise, Textures, Atmosphere, Comets
// ═══════════════════════════════════════════════

// Noise utilities, textures, planet texture functions imported from noiseUtils.js

// --- Sun granulation texture — deep orange-red with prominent sunspots ---
(()=>{
  const tex=_mkTex(512,256,(u,v,nx,ny,nz)=>{
    // Granulation cells — convection pattern
    const n=_sfbm(nx*8,ny*8,nz*8,5);
    const cell=n>0.52?1:0.65+n*0.67;
    // Sunspots — darker regions in equatorial band
    const spotLat=Math.abs(ny)<0.42;
    const spotN=_sfbm(nx*2.5+7,ny*2.5,nz*2.5,3);
    const spotN2=_sfbm(nx*4+13,ny*4+5,nz*4,2);
    const isSpot=spotLat && spotN>0.58;
    const isSmallSpot=spotLat && spotN2>0.68;
    const spot=isSpot?0.45:(isSmallSpot?0.6:1);
    // Penumbra around spots
    const penumbra=isSpot?(0.45+spotN*0.3):(isSmallSpot?(0.6+spotN2*0.2):1);
    const b=cell*Math.min(spot,penumbra);
    // Limb darkening — edges of sphere are dimmer
    const limb=0.6+0.4*Math.sqrt(Math.max(0,1-nx*nx-ny*ny-nz*nz+0.5));
    const bl=b*limb;
    // Color: deep red-orange base
    return [(255*bl)|0,(115*bl+15)|0,(35*bl+8)|0];
  });
  sunMat.map=tex; sunMat.needsUpdate=true;
})();

// Extra outer corona glow layers — warm red-orange
const _sunCoronaSprites = [];
[5.5, 10.0, 16.0].forEach((sc, i) => {
  const cc = document.createElement('canvas'); cc.width = 128; cc.height = 128;
  const cctx = cc.getContext('2d');
  const cg = cctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  const cols = ['255,140,30', '255,90,10', '255,50,0'];
  const alphas = [0.055, 0.028, 0.012];
  cg.addColorStop(0, `rgba(${cols[i]},${alphas[i]})`);
  cg.addColorStop(0.4, `rgba(${cols[i]},${alphas[i] * 0.35})`);
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  cctx.fillStyle = cg; cctx.fillRect(0, 0, 128, 128);
  const sm = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  const ss = new THREE.Sprite(sm); ss.scale.setScalar(sc); sunGroup.add(ss);
  _sunCoronaSprites.push({ sprite: ss, baseScale: sc });
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

// Infinite background star sphere — follows camera, always visible
const bgStarCount = isMobile ? 4000 : 12000;
const bgStarPos = new Float32Array(bgStarCount * 3);
const bgStarCol = new Float32Array(bgStarCount * 3);
const bgStarSizes = new Float32Array(bgStarCount);
for (let i = 0; i < bgStarCount; i++) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = 500;
  bgStarPos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
  bgStarPos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
  bgStarPos[i*3+2] = r * Math.cos(phi);
  // Realistic spectral color distribution
  const roll = Math.random();
  const b = 0.3 + Math.random() * 0.7;
  if (roll < 0.02) { // O/B blue-white (rare, bright)
    bgStarCol[i*3] = b*0.7; bgStarCol[i*3+1] = b*0.8; bgStarCol[i*3+2] = b;
    bgStarSizes[i] = 0.8 + Math.random() * 0.6;
  } else if (roll < 0.08) { // A white
    bgStarCol[i*3] = b*0.95; bgStarCol[i*3+1] = b*0.95; bgStarCol[i*3+2] = b;
    bgStarSizes[i] = 0.6 + Math.random() * 0.4;
  } else if (roll < 0.18) { // F yellow-white
    bgStarCol[i*3] = b; bgStarCol[i*3+1] = b*0.96; bgStarCol[i*3+2] = b*0.85;
    bgStarSizes[i] = 0.5 + Math.random() * 0.3;
  } else if (roll < 0.30) { // G yellow (Sun-like)
    bgStarCol[i*3] = b; bgStarCol[i*3+1] = b*0.92; bgStarCol[i*3+2] = b*0.7;
    bgStarSizes[i] = 0.5 + Math.random() * 0.2;
  } else if (roll < 0.50) { // K orange
    bgStarCol[i*3] = b; bgStarCol[i*3+1] = b*0.75; bgStarCol[i*3+2] = b*0.5;
    bgStarSizes[i] = 0.4 + Math.random() * 0.2;
  } else { // M red (most common)
    bgStarCol[i*3] = b; bgStarCol[i*3+1] = b*0.55; bgStarCol[i*3+2] = b*0.35;
    bgStarSizes[i] = 0.3 + Math.random() * 0.2;
  }
}
// Soft star point texture for background stars
const _bgStarTex = (() => {
  const c = document.createElement('canvas'); c.width = 16; c.height = 16;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(8,8,0,8,8,8);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0,0,16,16);
  return new THREE.CanvasTexture(c);
})();

const bgStarGeo = new THREE.BufferGeometry();
bgStarGeo.setAttribute('position', new THREE.BufferAttribute(bgStarPos, 3));
bgStarGeo.setAttribute('color', new THREE.BufferAttribute(bgStarCol, 3));
const bgStarMesh = new THREE.Points(bgStarGeo, new THREE.PointsMaterial({
  size: 1.2, vertexColors: true, sizeAttenuation: false,
  transparent: true, opacity: 0.9, depthWrite: false, fog: false,
  map: _bgStarTex, blending: THREE.AdditiveBlending
}));
bgStarMesh.frustumCulled = false;
bgStarMesh.renderOrder = -1;
scene.add(bgStarMesh);

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
  // Add glow sprite with diffraction spikes to each named star
  const gc=document.createElement('canvas'); gc.width=128; gc.height=128;
  const gctx=gc.getContext('2d');
  const gcol=`${(col.r*255)|0},${(col.g*255)|0},${(col.b*255)|0}`;
  // Core glow
  const gg=gctx.createRadialGradient(64,64,0,64,64,64);
  gg.addColorStop(0,`rgba(255,255,255,0.95)`);
  gg.addColorStop(0.05,`rgba(${gcol},0.8)`);
  gg.addColorStop(0.2,`rgba(${gcol},0.3)`);
  gg.addColorStop(0.5,`rgba(${gcol},0.06)`);
  gg.addColorStop(1,'rgba(0,0,0,0)');
  gctx.fillStyle=gg; gctx.fillRect(0,0,128,128);
  // Diffraction spikes (4-point star)
  gctx.save(); gctx.globalCompositeOperation='lighter';
  const spikeAlpha = Math.min(0.4, 0.1 + (1 - s.mag/6) * 0.3);
  for (let a = 0; a < 4; a++) {
    const angle = a * Math.PI/2 + Math.PI/4;
    gctx.save(); gctx.translate(64,64); gctx.rotate(angle);
    const lg = gctx.createLinearGradient(0,0,56,0);
    lg.addColorStop(0, `rgba(${gcol},${spikeAlpha})`);
    lg.addColorStop(0.3, `rgba(${gcol},${spikeAlpha*0.3})`);
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    gctx.fillStyle = lg;
    gctx.fillRect(0,-0.8,56,1.6);
    gctx.restore();
  }
  gctx.restore();
  const gSp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(gc),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false}));
  gSp.scale.setScalar(r*10); mesh.add(gSp);
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
galaxyGroup.add(new THREE.Points(discGeo, new THREE.PointsMaterial({ size: 25000, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.75 })));

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
galaxyGroup.add(new THREE.Points(bulgeGeo, new THREE.PointsMaterial({ size: 35000, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.85 })));

// ── C. Core Glow Sprite ──
const coreC = document.createElement('canvas'); coreC.width = 128; coreC.height = 128;
const coreCtx = coreC.getContext('2d');
const coreGrad = coreCtx.createRadialGradient(64,64,0,64,64,64);
coreGrad.addColorStop(0, 'rgba(255,235,200,0.3)');
coreGrad.addColorStop(0.2, 'rgba(255,210,150,0.15)');
coreGrad.addColorStop(0.5, 'rgba(200,160,100,0.04)');
coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
coreCtx.fillStyle = coreGrad; coreCtx.fillRect(0,0,128,128);
const coreSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(coreC), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, alphaTest: 0.01 }));
coreSprite.scale.setScalar(3e7);
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
galaxyGroup.add(new THREE.Points(dustGeo, new THREE.PointsMaterial({ size: 40000, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.3, blending: THREE.NormalBlending })));

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
galaxyGroup.add(new THREE.Points(haloGeo, new THREE.PointsMaterial({ size: 15000, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.3 })));

// ── F. HII Star-Forming Regions (pink/magenta knots along arms) ──
const hiiCount = isMobile ? 200 : 600;
const hiiPos = new Float32Array(hiiCount * 3);
const hiiCol = new Float32Array(hiiCount * 3);
for (let i = 0; i < hiiCount; i++) {
  const armIdx = Math.floor(Math.random() * NUM_ARMS);
  const armBase = (armIdx / NUM_ARMS) * Math.PI * 2;
  const dist = (0.15 + Math.random() * 0.75) * 50000 * KLY;
  const spiralAngle = armBase + Math.log(1 + dist / R0) * ARM_WIND;
  const spread = _gaussRand() * dist * 0.035;
  hiiPos[i*3] = Math.cos(spiralAngle) * dist + Math.cos(spiralAngle + Math.PI/2) * spread;
  hiiPos[i*3+1] = _gaussRand() * dist * 0.002;
  hiiPos[i*3+2] = Math.sin(spiralAngle) * dist + Math.sin(spiralAngle + Math.PI/2) * spread;
  // Pink to magenta with variation
  hiiCol[i*3] = 0.85 + Math.random() * 0.15;
  hiiCol[i*3+1] = 0.15 + Math.random() * 0.25;
  hiiCol[i*3+2] = 0.25 + Math.random() * 0.2;
}
const hiiGeo = new THREE.BufferGeometry();
hiiGeo.setAttribute('position', new THREE.BufferAttribute(hiiPos, 3));
hiiGeo.setAttribute('color', new THREE.BufferAttribute(hiiCol, 3));
galaxyGroup.add(new THREE.Points(hiiGeo, new THREE.PointsMaterial({
  size: 35000, vertexColors: true, sizeAttenuation: true, transparent: true,
  opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false
})));

// ── G. "You Are Here" marker (Sun's position in the Orion Arm) ──
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

// Cosmic filament texture — soft glow instead of square blocks
const _cosmicTex = (() => {
  const c = document.createElement('canvas'); c.width = 32; c.height = 32;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.4)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.05)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
})();

const clusterCount = 500;
const cPositions = new Float32Array(clusterCount * 3);
const cColors = new Float32Array(clusterCount * 3);
for (let i = 0; i < clusterCount; i++) {
  const filament = Math.floor(Math.random() * 8);
  const fAngle = (filament / 8) * Math.PI * 2;
  const dist = Math.random() * 5e12;
  const spread = (Math.random() - 0.5) * dist * 0.3;
  cPositions[i * 3] = Math.cos(fAngle) * dist + spread;
  cPositions[i * 3 + 1] = (Math.random() - 0.5) * dist * 0.2;
  cPositions[i * 3 + 2] = Math.sin(fAngle) * dist + spread * 0.5;
  // Cooler blue-purple-white tones instead of brown
  const t = Math.random();
  cColors[i * 3] = 0.5 + t * 0.3;
  cColors[i * 3 + 1] = 0.5 + t * 0.4;
  cColors[i * 3 + 2] = 0.7 + t * 0.3;
}
const cosmicGeo = new THREE.BufferGeometry();
cosmicGeo.setAttribute('position', new THREE.BufferAttribute(cPositions, 3));
cosmicGeo.setAttribute('color', new THREE.BufferAttribute(cColors, 3));
const cosmicMat = new THREE.PointsMaterial({
  size: 5e10, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.4,
  map: _cosmicTex, blending: THREE.AdditiveBlending, depthWrite: false
});
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

    // Unique canvas textures per object type for visual variety
    const sc = document.createElement('canvas'); sc.width = 64; sc.height = 64;
    const sctx = sc.getContext('2d');
    const c3 = new THREE.Color(col);
    const cr = (c3.r*255)|0, cg = (c3.g*255)|0, cb = (c3.b*255)|0;

    if (obj.type === 'nebula') {
      // Nebulae: irregular, wispy, multi-colored (Hα red + OIII teal)
      // Draw multiple offset blobs for cloudlike shape
      for (let k = 0; k < 5; k++) {
        const ox = 32 + (Math.random()-0.5)*16, oy = 32 + (Math.random()-0.5)*16;
        const nr = 12 + Math.random()*14;
        const ng = sctx.createRadialGradient(ox, oy, 0, ox, oy, nr);
        // Mix Hα pink-red and OIII teal for emission nebulae
        const isHa = Math.random() > 0.4;
        const ncr = isHa ? 220+Math.random()*35 : 60+Math.random()*40;
        const ncg = isHa ? 80+Math.random()*40 : 180+Math.random()*60;
        const ncb = isHa ? 100+Math.random()*30 : 200+Math.random()*55;
        ng.addColorStop(0, `rgba(${ncr|0},${ncg|0},${ncb|0},${0.3+Math.random()*0.3})`);
        ng.addColorStop(0.5, `rgba(${ncr|0},${ncg|0},${ncb|0},${0.08+Math.random()*0.08})`);
        ng.addColorStop(1, 'rgba(0,0,0,0)');
        sctx.fillStyle = ng; sctx.fillRect(0,0,64,64);
      }
    } else if (obj.type === 'planetary_nebula') {
      // Planetary nebulae: ring-shaped with bright rim and dim center
      const ng = sctx.createRadialGradient(32,32,8,32,32,26);
      ng.addColorStop(0, `rgba(${cr},${cg},${cb},0.15)`);
      ng.addColorStop(0.5, `rgba(${cr},${cg},${cb},0.05)`);
      ng.addColorStop(0.75, `rgba(${cr},${cg},${cb},0.6)`);
      ng.addColorStop(0.9, `rgba(${cr},${cg},${cb},0.3)`);
      ng.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = ng; sctx.fillRect(0,0,64,64);
      // Bright central star
      const cs = sctx.createRadialGradient(32,32,0,32,32,4);
      cs.addColorStop(0, 'rgba(255,255,255,0.9)');
      cs.addColorStop(1, 'rgba(255,255,255,0)');
      sctx.fillStyle = cs; sctx.fillRect(0,0,64,64);
    } else if (obj.type === 'snr') {
      // Supernova remnants: filamentary shell
      for (let k = 0; k < 8; k++) {
        const a = (k/8)*Math.PI*2 + Math.random()*0.4;
        const ir = 14+Math.random()*4, or = 20+Math.random()*6;
        const fx = 32+Math.cos(a)*((ir+or)/2), fy = 32+Math.sin(a)*((ir+or)/2);
        const fg = sctx.createRadialGradient(fx, fy, 0, fx, fy, 6+Math.random()*4);
        fg.addColorStop(0, `rgba(${cr},${cg},${cb},${0.4+Math.random()*0.3})`);
        fg.addColorStop(1, 'rgba(0,0,0,0)');
        sctx.fillStyle = fg; sctx.fillRect(0,0,64,64);
      }
    } else if (obj.type === 'globular') {
      // Globular clusters: dense core fading smoothly, speckled
      const gg = sctx.createRadialGradient(32,32,0,32,32,28);
      gg.addColorStop(0, `rgba(${cr},${cg},${cb},0.85)`);
      gg.addColorStop(0.15, `rgba(${cr},${cg},${cb},0.55)`);
      gg.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.18)`);
      gg.addColorStop(0.7, `rgba(${cr},${cg},${cb},0.04)`);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = gg; sctx.fillRect(0,0,64,64);
      // Sprinkle individual star points
      for (let k = 0; k < 40; k++) {
        const sr = Math.pow(Math.random(),2)*24;
        const sa = Math.random()*Math.PI*2;
        sctx.beginPath();
        sctx.arc(32+Math.cos(sa)*sr, 32+Math.sin(sa)*sr, 0.5+Math.random(), 0, Math.PI*2);
        sctx.fillStyle = `rgba(255,${220+Math.random()*35|0},${180+Math.random()*40|0},${0.5+Math.random()*0.4})`;
        sctx.fill();
      }
    } else if (obj.type === 'open_cluster') {
      // Open clusters: scattered bright stars, no dense core
      for (let k = 0; k < 25; k++) {
        const sr = Math.random()*20;
        const sa = Math.random()*Math.PI*2;
        const ss = 0.8+Math.random()*1.5;
        const sg2 = sctx.createRadialGradient(32+Math.cos(sa)*sr, 32+Math.sin(sa)*sr, 0, 32+Math.cos(sa)*sr, 32+Math.sin(sa)*sr, ss*2);
        sg2.addColorStop(0, `rgba(255,${240+Math.random()*15|0},${200+Math.random()*55|0},${0.6+Math.random()*0.3})`);
        sg2.addColorStop(1, 'rgba(0,0,0,0)');
        sctx.fillStyle = sg2; sctx.fillRect(0,0,64,64);
      }
    } else {
      // Default: simple radial gradient (galaxies, etc.)
      const sg = sctx.createRadialGradient(32,32,0,32,32,32);
      sg.addColorStop(0, `rgba(${cr},${cg},${cb},0.9)`);
      sg.addColorStop(0.3, `rgba(${cr},${cg},${cb},0.35)`);
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.fillStyle = sg; sctx.fillRect(0,0,64,64);
    }

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

    // Special case: Milky Way (dist=0) — center of our coordinate system
    if (obj.name === 'Milky Way') {
      // Create a marker at origin for the galactic center
      sprite.position.set(0, 0, 0);
      const mwScale = 2; // viewed from inside at Galactic scale
      labelsList.push({ el: createLabel('Milky Way'), mesh: sprite, scaleLevel: mwScale });
      searchableObjects.push({ name: 'Milky Way Our Galaxy', distLY: 0, typeLabel: 'Galaxy', mesh: sprite, scaleLevel: mwScale, galaxyType: obj.galaxyType });
      return; // skip normal deep sky processing
    }

    // Label only brighter objects (mag < 9)
    if (obj.mag < 9) {
      labelsList.push({ el: createLabel(displayName), mesh: sprite, scaleLevel: obj.type === 'galaxy' ? 3 : 2 });
    }
    const objScale = obj.type === 'galaxy' ? 3 : 2;
    searchableObjects.push({ name: displayName, distLY, typeLabel: typeLabels[obj.type] || 'Deep Sky', mesh: sprite, scaleLevel: objScale, galaxyType: obj.galaxyType });
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
      sprite.visible = (currentScale === 3) && !_viewingGalaxy;
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

// Init galaxy renderer with scene refs
initGalaxyRenderer(scene, camera, isMobile);

// _buildGalaxyModel now delegates to the galaxy rendering engine
function _buildGalaxyModel(opts) { return buildGalaxy(opts); }

/* ── OLD galaxy code replaced by galaxyRenderer.js ──
function _paintGalaxyCanvas(size, opts) {
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2, cy = size / 2;
  const arms = opts.arms || 2;
  const wind = opts.wind || 2.5;
  const isElliptical = opts.elliptical || false;

  // Black background
  ctx.fillStyle = 'rgba(0,0,0,0)';
  ctx.clearRect(0, 0, size, size);

  // Draw galaxy using many soft dots
  const N = isElliptical ? 30000 : 50000;
  const maxR = size * 0.42;

  for (let i = 0; i < N; i++) {
    let px, py;
    if (isElliptical) {
      const r = Math.pow(Math.random(), 1.8) * maxR;
      const a = Math.random() * Math.PI * 2;
      px = cx + Math.cos(a) * r;
      py = cy + Math.sin(a) * r * 0.65;
    } else {
      const inArm = i < N * 0.65;
      const armIdx = inArm ? Math.floor(Math.random() * arms) : Math.random() * arms;
      const armBase = (armIdx / arms) * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.65) * maxR;
      const spiralAngle = armBase + Math.log(1 + dist / (maxR * 0.08)) * wind;
      const spread = (inArm ? 0.06 : 0.15) * dist;
      const sx = (Math.random() - 0.5) * 2 * spread;
      const sy = (Math.random() - 0.5) * 2 * spread;
      px = cx + Math.cos(spiralAngle) * dist + sx;
      py = cy + Math.sin(spiralAngle) * dist + sy;
    }

    const distFromCenter = Math.sqrt((px - cx) ** 2 + (py - cy) ** 2) / maxR;

    // Color: golden center → blue-white arms (high brightness)
    let r, g, b, alpha;
    if (isElliptical || distFromCenter < 0.2) {
      const t = Math.random();
      r = 255; g = 210 + t * 40; b = 140 + t * 50;
      alpha = (1 - distFromCenter * 0.6) * (0.15 + Math.random() * 0.15);
    } else if (i < N * 0.65) {
      const t = Math.random();
      r = 150 + t * 80; g = 170 + t * 60; b = 230 + t * 25;
      alpha = (1 - distFromCenter * 0.5) * (0.08 + Math.random() * 0.08);
    } else {
      const t = Math.random();
      r = 200 + t * 55; g = 185 + t * 45; b = 155 + t * 35;
      alpha = (1 - distFromCenter * 0.6) * (0.04 + Math.random() * 0.04);
    }

    // Pink/red HII regions in spiral arms
    if (!isElliptical && i < N * 0.65 && Math.random() < 0.04 && distFromCenter > 0.2) {
      r = 255; g = 90 + Math.random() * 70; b = 110 + Math.random() * 50;
      alpha = 0.15 + Math.random() * 0.1;
    }

    const dotR = (1 - distFromCenter * 0.4) * (2 + Math.random() * 3);
    ctx.beginPath();
    ctx.arc(px, py, dotR, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${r|0},${g|0},${b|0},${alpha})`;
    ctx.fill();
  }

  // Bright central bulge glow — very prominent
  const bulgeGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.4);
  bulgeGrad.addColorStop(0, 'rgba(255,245,210,0.95)');
  bulgeGrad.addColorStop(0.1, 'rgba(255,230,180,0.7)');
  bulgeGrad.addColorStop(0.3, 'rgba(240,200,140,0.3)');
  bulgeGrad.addColorStop(0.6, 'rgba(200,160,100,0.08)');
  bulgeGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bulgeGrad;
  ctx.fillRect(0, 0, size, size);

  // Soft outer halo — visible glow
  const haloGrad = ctx.createRadialGradient(cx, cy, maxR * 0.1, cx, cy, maxR * 1.1);
  haloGrad.addColorStop(0, 'rgba(180,195,255,0.12)');
  haloGrad.addColorStop(0.4, 'rgba(140,160,220,0.05)');
  haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = haloGrad;
  ctx.fillRect(0, 0, size, size);

  return c;
}

// ── Procedural galaxy model builder (canvas-textured sprite) ──
function _buildGalaxyModel(opts = {}) {
  const group = new THREE.Group();
  const scale = opts.scale || 1;
  const tilt = opts.tilt || 0.4;

  const KLY = 63241;
  const R = 50000 * KLY * scale; // galaxy radius in AU

  // Paint galaxy texture on canvas
  const texSize = isMobile ? 512 : 1024;
  const galaxyCanvas = _paintGalaxyCanvas(texSize, opts);
  const galaxyTex = new THREE.CanvasTexture(galaxyCanvas);

  // Main galaxy — billboard sprite always faces camera
  const galaxySprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: galaxyTex,
    transparent: true,
    depthWrite: false,
  }));
  const aspect = Math.max(0.25, Math.cos(tilt));
  const baseW = R * 2.2, baseH = R * 2.2 * aspect;
  galaxySprite.scale.set(baseW, baseH, 1);
  group.add(galaxySprite);

  // Bright core glow
  const cc = document.createElement('canvas'); cc.width = 128; cc.height = 128;
  const cctx = cc.getContext('2d');
  const cg = cctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  cg.addColorStop(0, 'rgba(255,245,215,1)');
  cg.addColorStop(0.1, 'rgba(255,230,180,0.7)');
  cg.addColorStop(0.3, 'rgba(230,190,130,0.2)');
  cg.addColorStop(0.6, 'rgba(180,150,100,0.04)');
  cg.addColorStop(1, 'rgba(0,0,0,0)');
  cctx.fillStyle = cg; cctx.fillRect(0, 0, 128, 128);
  const coreSp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(cc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false
  }));
  const coreBaseW = R * 0.8, coreBaseH = R * 0.8 * aspect;
  coreSp.scale.set(coreBaseW, coreBaseH, 1);
  group.add(coreSp);

  return group;
}
END OF OLD CODE */

// Track generated galaxy models so we don't create duplicates
const _galaxyModels = {};
// When viewing a galaxy close-up, hide all catalog/deep sky sprites
let _viewingGalaxy = null; // { position, radius } or null

// Any searchable galaxy (from deep sky catalog) should get a 3D model
function _ensureGalaxyModel(dest) {
  if (!dest || !dest.name || !dest.position) return;
  // Check if this is a known galaxy type from the catalog, or matches known galaxy names
  const nameLower = dest.name.toLowerCase();

  // Special case: Milky Way — don't create a new model, use the existing galaxyGroup
  if (/milky\s*way/i.test(nameLower)) {
    dest.scaleLevel = 2;
    dest.radius = 50000 * 63241; // ~50 kly radius in AU
    // Set viewing flag to hide deep sky clutter
    _viewingGalaxy = { position: new THREE.Vector3(0, 0, 0), radius: dest.radius };
    return;
  }

  const isKnownGalaxy = dest.galaxyType || /galaxy|m31|m32|m33|m49|m51|m58|m59|m61|m63|m64|m65|m66|m74|m81|m82|m83|m84|m86|m87|m101|m104|m106|m108|m109|m110|andromeda|triangulum|whirlpool|sombrero|pinwheel|bode|cigar|magellanic|centaurus|sculptor|fornax|barnard|cartwheel|tadpole/i.test(nameLower);
  if (!isKnownGalaxy) return;
  if (_galaxyModels[dest.name]) return; // already built

  // Determine galaxy type and scale from catalog data or name matching
  let galaxyType = dest.galaxyType || 'spiral';
  let galaxyScale = 1;
  let tilt = 0.3 + Math.random() * 0.5;

  // Override for well-known galaxies with specific visual properties
  const isAndromeda = /andromeda|m31\b/i.test(nameLower);
  const isTriangulum = /triangulum|m33\b/i.test(nameLower);
  const isWhirlpool = /whirlpool|m51\b/i.test(nameLower);
  const isSombrero = /sombrero|m104\b/i.test(nameLower);
  const isPinwheel = /pinwheel|m101\b/i.test(nameLower);
  const isCigar = /cigar|m82\b/i.test(nameLower);
  const isM87 = /m87\b|virgo a/i.test(nameLower);

  if (isAndromeda)       { galaxyScale = 2.2; tilt = 1.35; galaxyType = 'spiral'; }
  else if (isTriangulum) { galaxyScale = 0.6; tilt = 0.3; galaxyType = 'spiral'; }
  else if (isWhirlpool)  { galaxyScale = 0.76; tilt = 0.35; galaxyType = 'grandDesign'; }
  else if (isPinwheel)   { galaxyScale = 1.7; tilt = 0.15; galaxyType = 'grandDesign'; }
  else if (isSombrero)   { galaxyScale = 0.5; tilt = 1.45; galaxyType = 'spiral'; }
  else if (isCigar)      { galaxyScale = 0.37; tilt = 1.3; galaxyType = 'irregular'; }
  else if (isM87)        { galaxyScale = 2.4; tilt = 0.2; galaxyType = 'elliptical'; }

  // Build options from type
  const galaxyOpts = { type: galaxyType, scale: galaxyScale, tilt };

  const group = _buildGalaxyModel(galaxyOpts);
  group.position.copy(dest.position);
  group.visible = true;
  scene.add(group);
  _galaxyModels[dest.name] = group;

  // Andromeda companions
  if (isAndromeda) {
    const KLY = 63241;
    const m32 = _buildGalaxyModel({ scale: 0.12, tilt: 0.2, elliptical: true });
    m32.position.set(-15000 * KLY, -5000 * KLY, 8000 * KLY);
    group.add(m32);
    const m110 = _buildGalaxyModel({ scale: 0.2, tilt: 0.8, elliptical: true });
    m110.position.set(40000 * KLY, 12000 * KLY, -30000 * KLY);
    group.add(m110);
  }

  // Update radius and scale so camera stops at proper distance
  const galaxyR = 50000 * 63241 * (galaxyOpts.scale || 1); // galaxy radius in AU
  dest.radius = galaxyR;
  dest.scaleLevel = 3;

  // Flag that we're viewing a galaxy — hides all catalog/deep sky sprites
  _viewingGalaxy = { position: dest.position.clone(), radius: galaxyR };
}

function travelToSIMBADResult(result, skipTravel = false) {
  const { name, ra, dec, plx, z, otype, sp } = result;
  const typeInfo = simbadOtypeInfo(otype);
  const distAU   = simbadDistAU(plx, z, typeInfo);
  const pos      = raDecToVec3(ra, dec, distAU);
  const r        = simbadMarkerRadius(typeInfo.scale, typeInfo.label);
  const col      = sp ? tempToColor(spTypeToTemp(sp)) : typeInfo.color;
  const isGalaxy = typeInfo.label === 'Galaxy';

  let mesh;
  if (isGalaxy && !_galaxyModels[name]) {
    // Build a procedural galaxy model instead of a plain sphere
    const nameLower = (name || '').toLowerCase();
    // Andromeda (M31): large barred spiral, ~77° inclination, 2 main arms
    const isAndromeda = /andromeda|m\s*31/i.test(nameLower);
    // Triangulum (M33): face-on spiral
    const isTriangulum = /triangulum|m\s*33/i.test(nameLower);

    const galaxyOpts = isAndromeda
      ? { scale: 2.2, tilt: 1.35, arms: 2, wind: 2.0, hue: 'blue' }   // 77° tilt, large
      : isTriangulum
      ? { scale: 0.6, tilt: 0.3, arms: 2, wind: 3.0, hue: 'blue' }    // face-on, smaller
      : { scale: 0.5 + Math.random() * 1.5, tilt: Math.random() * 1.2, arms: 2 + Math.floor(Math.random() * 3), wind: 2 + Math.random() * 2 };

    const galaxyGroup = _buildGalaxyModel(galaxyOpts);
    galaxyGroup.position.copy(pos);
    galaxyGroup.userData = { name, type: 'Galaxy', distAU };
    galaxyGroup.visible = true;
    scene.add(galaxyGroup);
    _galaxyModels[name] = galaxyGroup;

    // Flag that we're viewing a galaxy
    const galaxyR = 50000 * 63241 * (galaxyOpts.scale || 1);
    _viewingGalaxy = { position: pos.clone(), radius: galaxyR };

    // Add companion galaxies for Andromeda
    if (isAndromeda) {
      const KLY = 63241;
      const m32 = _buildGalaxyModel({ scale: 0.12, tilt: 0.2, elliptical: true });
      m32.position.set(-15000 * KLY, -5000 * KLY, 8000 * KLY);
      galaxyGroup.add(m32);
      const m110 = _buildGalaxyModel({ scale: 0.2, tilt: 0.8, elliptical: true });
      m110.position.set(40000 * KLY, 12000 * KLY, -30000 * KLY);
      galaxyGroup.add(m110);
    }

    // Use a small invisible sphere as the travel target (for camera/label positioning)
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.01, 4, 4),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    mesh.position.copy(pos);
    mesh.userData = { name, type: typeInfo.label, distAU, _scaleLevel: typeInfo.scale };
    scene.add(mesh);
    liveStarMeshes.push(mesh);
  } else if (isGalaxy && _galaxyModels[name]) {
    // Already exists — just reuse the existing model's target mesh
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r * 0.01, 4, 4),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    mesh.position.copy(pos);
    mesh.userData = { name, type: typeInfo.label, distAU, _scaleLevel: typeInfo.scale };
    scene.add(mesh);
    liveStarMeshes.push(mesh);
  } else {
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(r, 12, 12),
      new THREE.MeshBasicMaterial({ color: col })
    );
    mesh.position.copy(pos);
    mesh.userData = { name, type: typeInfo.label, distAU, _scaleLevel: typeInfo.scale };
    scene.add(mesh);
    liveStarMeshes.push(mesh);
  }

  labelsList.push({ el: createLabel(name), mesh, scaleLevel: typeInfo.scale });
  if (!skipTravel) travelToMesh(mesh, typeInfo.scale, name, isGalaxy ? r * 15 : r * 4);
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
  let _f = 0;
  const _rp = () => { _positionTriviaPanel(); if (++_f < 20) requestAnimationFrame(_rp); };
  requestAnimationFrame(_rp);
});

document.getElementById('facts-suggest-btn').addEventListener('click', () => {
  if (_factsSuggestTarget) {
    openTravelPanel();
    const inp = document.getElementById('travel-dest-input');
    inp.value = _factsSuggestTarget;
    // Small delay to ensure panel is open before searching
    setTimeout(() => doTravelSearch(_factsSuggestTarget), 50);
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
    ...searchableObjects.map(o => ({ ...o, scaleLevel: o.scaleLevel !== undefined ? o.scaleLevel : (o.typeLabel === 'Planet' ? 0 : o.typeLabel === 'Star' ? 1 : 2) }))
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
      setTravelDest({ position: obj.mesh.position.clone(), name: obj.name, distLY: obj.distLY, scaleLevel: obj.scaleLevel, radius: meshR, galaxyType: obj.galaxyType });
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
            const mR = simbadMarkerRadius(ti.scale, ti.label);
            setTravelDest({ position: pos, name: r.name, distLY: dLY, scaleLevel: ti.scale, simbadResult: r, radius: mR });
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
  // Create galaxy model or SIMBAD object at destination FIRST (may update scale/radius)
  if (travelDest.simbadResult) {
    travelToSIMBADResult(travelDest.simbadResult, true);
  } else {
    _ensureGalaxyModel(travelDest);
  }
  // Switch scale (after model creation which may update scaleLevel)
  if (travelDest.scaleLevel !== undefined && currentScale !== travelDest.scaleLevel) {
    currentScale = travelDest.scaleLevel; applyScale();
  }
  // Teleport camera to viewing position
  const objR = travelDest.radius || 0.05;
  const isMilkyWay = /milky\s*way/i.test(travelDest.name || '');
  const isGalaxyDest = !isMilkyWay && (travelDest.galaxyType || _viewingGalaxy);
  if (isMilkyWay) {
    // Milky Way: position above and slightly off-center for dramatic view
    // The MW model uses particles sized for viewing from ~26kly (Sun's position)
    // so we need to stay relatively close — elevated above the disc
    const KLY = 63241;
    camera.position.set(15000 * KLY, 25000 * KLY, 20000 * KLY);
    // Look toward the galactic center
    const toCenter = new THREE.Vector3(0, 0, 0).sub(camera.position).normalize();
    yaw = Math.atan2(-toCenter.x, -toCenter.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, toCenter.y)));
    roll = 0;
  } else if (isGalaxyDest) {
    // External galaxy: position in front, close enough to fill the view
    const viewDist = objR * 1.5;
    const toGalaxy = travelDest.position.clone().normalize();
    camera.position.copy(travelDest.position).addScaledVector(toGalaxy, -viewDist);
    const toTarget = new THREE.Vector3().subVectors(travelDest.position, camera.position).normalize();
    yaw = Math.atan2(-toTarget.x, -toTarget.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, toTarget.y)));
    roll = 0;
  } else {
    const stopR = Math.max(objR * 4, objR * 6);
    const dir = new THREE.Vector3().subVectors(travelDest.position, camera.position).normalize();
    camera.position.copy(travelDest.position).addScaledVector(dir, -stopR);
    yaw = Math.atan2(-dir.x, -dir.z);
    pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
  }
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
    const isGalaxyArrival = travelDest.simbadResult && simbadOtypeInfo(travelDest.simbadResult.otype).label === 'Galaxy';
    const r = isGalaxyArrival ? (travelDest.radius || 8e8) * 20 : Math.max(0.3, (travelDest.radius || 0.3) * 6);
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
      if (travelDest.simbadResult) travelToSIMBADResult(travelDest.simbadResult, true); else _ensureGalaxyModel(travelDest);
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
      if (travelDest.simbadResult) travelToSIMBADResult(travelDest.simbadResult, true); else _ensureGalaxyModel(travelDest);
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
  if (e.code === 'KeyR') {
    if (_introPhase === 'tip') _introPhase = 'done';
    exploreMode ? stopExploreMode() : startExploreMode(); e.preventDefault(); return;
  }
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
  liveStarMeshes.forEach(m => m.visible = level === (m.userData._scaleLevel || 1));
  exoplanetMarkers.forEach(m => m.visible = level === 1);
  deepSkyMeshes.forEach(m => m.visible = (level === 2 || level === 3) && !_viewingGalaxy);
  galaxyGroup.visible = level === 2;
  // Hide background stars mesh when viewing Milky Way from above (they clutter the view)
  if (bgStarMesh) bgStarMesh.visible = !_viewingGalaxy;
  galaxyCatalogMeshes.forEach(m => m.visible = level === 3 && !_viewingGalaxy);
  Object.values(_galaxyModels).forEach(g => g.visible = level === 3);
  cosmicGroup.visible = level === 3 && !_viewingGalaxy;
  lightSphere.visible = level === 0;
  _bgRefObjects.forEach(o => { o.marker.visible = level === o.scale; });
}

function applyScale() {
  const level = currentScale;

  // Clear galaxy viewing mode when leaving cosmic scale
  if (level !== 3) _viewingGalaxy = null;

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
    // Don't move camera if we're viewing a galaxy (instant travel already positioned it)
    targetPos: (params.pos && !_viewingGalaxy) ? new THREE.Vector3(...params.pos) : null
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
// ═══════════════════════════════════════════════
//  SPACE BACKGROUND (for flight profile page)
// ═══════════════════════════════════════════════
let _spaceBgAnimId = null;
function _initSpaceBg() {
  const container = document.getElementById('fp-space-bg');
  if (!container || container.querySelector('canvas')) return;
  const canvas = document.createElement('canvas');
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let w, h;

  function resize() {
    w = canvas.width = container.clientWidth || 800;
    h = canvas.height = container.clientHeight || 600;
  }
  resize();
  window.addEventListener('resize', resize);

  // Stars only — black and white, very subtle drift
  const stars = [];
  for (let i = 0; i < 400; i++) {
    stars.push({
      x: Math.random() * 3000 - 500, y: Math.random() * 2000 - 500,
      size: 0.3 + Math.random() * 1.2,
      brightness: 0.2 + Math.random() * 0.6,
      twinkle: Math.random() * Math.PI * 2,
      dx: (Math.random() - 0.5) * 0.015,
      dy: (Math.random() - 0.5) * 0.01,
    });
  }

  let t = 0;
  function draw() {
    _spaceBgAnimId = requestAnimationFrame(draw);
    t += 1;
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    ctx.fillRect(0, 0, w, h);

    stars.forEach(s => {
      s.x += s.dx; s.y += s.dy;
      s.twinkle += 0.006;
      if (s.x > w + 50) s.x = -50;
      if (s.x < -50) s.x = w + 50;
      if (s.y > h + 50) s.y = -50;
      if (s.y < -50) s.y = h + 50;
      const flicker = 0.5 + 0.5 * Math.sin(s.twinkle);
      const a = s.brightness * flicker;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });

  }
  draw();
}

function _stopSpaceBg() {
  if (_spaceBgAnimId) { cancelAnimationFrame(_spaceBgAnimId); _spaceBgAnimId = null; }
}

// ═══════════════════════════════════════════════
//  MATRIX RAIN (div-based, no canvas)
// ═══════════════════════════════════════════════
let _matrixInterval = null;
function _initMatrixRain() {
  const container = document.getElementById('matrix-rain');
  if (!container || container.children.length > 0) return;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ΑΒΓΔΘΛΞΠΣΦΨΩαβγδθλξπσφψω@#$%&*+=<>';
  const NUM_COLS = Math.max(60, Math.floor(window.innerWidth / 16));
  const _insults = [
    'NOOB','LMAO','U MAD','GG EZ','BRUH','LOL','NERD','OOPS',
    'SCRUB','YIKES','FAIL','REKT','TRASH','PLEB','BASIC',
    'WEAK','SALTY','OWNED','DERP','YAWN','MEH','CRINGE',
    'SUS','RATIO','COPE','L','SIGH','CLOWN','GOOBER',
    'UR SLOW','GO HOME','TRY HARDER','NICE TRY',
    'DO BETTER','NOT GREAT','WRONG WAY','LOST MUCH',
    'STILL HERE','GIVE UP YET','YOURE LOST',
    'SEND HELP','EARTH MISSES U','TURN AROUND',
    'SPACE IS HARD','GET GOOD','SMOOTH BRAIN',
    'BIG YIKES','SKILL ISSUE','NO SIGNAL',
    'JUST STOP','REALLY BRO','HELP ME',
    'IM WATCHING U','DONT LOOK UP','BOO',
  ];
  for (let c = 0; c < NUM_COLS; c++) {
    const col = document.createElement('div');
    col.className = 'matrix-col';
    col.style.opacity = (0.25 + Math.random() * 0.55).toFixed(2);
    const inner = document.createElement('div');
    inner.className = 'matrix-col-inner';
    inner.style.setProperty('--dur', (6 + Math.random() * 10) + 's');
    inner.style.animationDelay = (-Math.random() * 15) + 's';
    // Fill with enough characters to loop seamlessly
    let html = '';
    for (let i = 0; i < 60; i++) {
      const ch = chars[Math.floor(Math.random() * chars.length)];
      html += '<span>' + ch + '</span>';
    }
    inner.innerHTML = html;
    col.appendChild(inner);
    container.appendChild(col);
  }
  // Periodically randomize characters for living effect
  setInterval(() => {
    const inners = container.querySelectorAll('.matrix-col-inner');
    inners.forEach(col => {
      const spans = col.querySelectorAll('span');
      // Randomize ~10% of characters each tick
      for (let i = 0; i < 8; i++) {
        const idx = Math.floor(Math.random() * spans.length);
        spans[idx].textContent = chars[Math.floor(Math.random() * chars.length)];
      }
      // ~12% chance per column per tick: sneak an insult vertically down a column
      if (Math.random() < 0.12) {
        const word = _insults[Math.floor(Math.random() * _insults.length)];
        const startIdx = Math.floor(Math.random() * (spans.length - word.length));
        for (let wi = 0; wi < word.length; wi++) {
          spans[startIdx + wi].textContent = word[wi];
        }
      }
    });
  }, 500);
}

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
  // Reposition continuously during the CSS transition
  let _frames = 0;
  const _reposition = () => { _positionTriviaPanel(); if (++_frames < 20) requestAnimationFrame(_reposition); };
  requestAnimationFrame(_reposition);
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
//  SPLASH — SPACETIME FABRIC
//
//  Perspective-projected grid warped by invisible
//  wandering masses. Organic bezier-like paths via
//  layered sine/cosine. Catmull-Rom splines for
//  silky smooth curves. Contour rings + depth
//  shading for topographic depth illusion.
// ═══════════════════════════════════════════════
(function _initSplashBg() {
  const canvas = document.getElementById('splash-bg');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w, h, animId = null;
  let t = 0;
  const TWO_PI = Math.PI * 2;

  // Mouse
  let mx = -9999, my = -9999, mActive = false;
  canvas.parentElement.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; mActive = true; });
  canvas.parentElement.addEventListener('mouseleave', () => { mActive = false; });

  // ── Invisible gravitational masses ──
  // Each drifts on a smooth, wandering path built from 3 sine/cosine
  // components per axis — organic and unpredictable, never straight lines.
  const masses = [];
  for (let i = 0; i < 5; i++) {
    masses.push({
      // Path center — spread across full viewport
      cx: 0.1 + Math.random() * 0.8,
      cy: 0.1 + Math.random() * 0.8,
      // X oscillation — 3 frequencies for complex wandering
      ax1: 0.10 + Math.random() * 0.12, fx1: 0.07 + Math.random() * 0.06, px1: Math.random() * TWO_PI,
      ax2: 0.05 + Math.random() * 0.06, fx2: 0.16 + Math.random() * 0.10, px2: Math.random() * TWO_PI,
      ax3: 0.02 + Math.random() * 0.03, fx3: 0.35 + Math.random() * 0.20, px3: Math.random() * TWO_PI,
      // Y oscillation — 3 frequencies, different from X
      ay1: 0.08 + Math.random() * 0.10, fy1: 0.06 + Math.random() * 0.05, py1: Math.random() * TWO_PI,
      ay2: 0.04 + Math.random() * 0.05, fy2: 0.13 + Math.random() * 0.10, py2: Math.random() * TWO_PI,
      ay3: 0.015 + Math.random() * 0.025, fy3: 0.28 + Math.random() * 0.18, py3: Math.random() * TWO_PI,
      // Physics
      radius: 200 + Math.random() * 300,   // influence radius (px)
      intensity: 0.6 + Math.random() * 0.4, // pull strength
      speed: 0.6 + Math.random() * 0.8,     // drift speed multiplier
    });
  }

  function getMassPos(m) {
    const st = t * m.speed;
    const nx = m.cx + Math.sin(st * m.fx1 + m.px1) * m.ax1
                    + Math.sin(st * m.fx2 + m.px2) * m.ax2
                    + Math.sin(st * m.fx3 + m.px3) * m.ax3;
    const ny = m.cy + Math.cos(st * m.fy1 + m.py1) * m.ay1
                    + Math.cos(st * m.fy2 + m.py2) * m.ay2
                    + Math.cos(st * m.fy3 + m.py3) * m.ay3;
    return {
      x: Math.max(0, Math.min(1, nx)) * w,
      y: Math.max(0, Math.min(1, ny)) * h,
      radius: m.radius, intensity: m.intensity,
    };
  }

  // ── Independent wave emitters — spread across the ENTIRE viewport ──
  // Seeded at distributed positions including edges and corners so waves
  // propagate from everywhere, not just the center.
  const _emitterDefs = [];
  // Fixed grid of starting positions to guarantee full coverage
  const _emitterSeeds = [
    [0.05, 0.05], [0.5, 0.0], [0.95, 0.05],    // top edge
    [0.0, 0.5],  [0.95, 0.5],                     // sides
    [0.05, 0.95], [0.5, 1.0], [0.95, 0.95],      // bottom edge
    [0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7], // inner quad
  ];
  for (const [sx, sy] of _emitterSeeds) {
    _emitterDefs.push({
      cx: sx, cy: sy,
      ax: 0.05 + Math.random() * 0.12, fx: 0.03 + Math.random() * 0.05, px: Math.random() * TWO_PI,
      ay: 0.04 + Math.random() * 0.10, fy: 0.025 + Math.random() * 0.04, py: Math.random() * TWO_PI,
      waveLen: 70 + Math.random() * 130,
      speed: 0.25 + Math.random() * 0.5,
      amp: 1.5 + Math.random() * 2.5,
      reach: 400 + Math.random() * 500,
      drift: 0.4 + Math.random() * 0.7,
    });
  }
  let _emitters = [];

  // Button wells
  const _btnWells = [];
  function _updateBtnWells() {
    _btnWells.length = 0;
    document.querySelectorAll('.splash-btn').forEach(btn => {
      const rect = btn.getBoundingClientRect();
      _btnWells.push({
        x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
        rx: rect.width * 0.7, ry: rect.height * 0.7,
        strength: 0.3, hover: btn.matches(':hover') ? 1 : 0,
      });
    });
  }
  document.querySelectorAll('.splash-btn').forEach(btn => {
    btn.addEventListener('mouseenter', _updateBtnWells);
    btn.addEventListener('mouseleave', _updateBtnWells);
  });

  function resize() { w = canvas.width = window.innerWidth; h = canvas.height = window.innerHeight; }
  resize();
  window.addEventListener('resize', () => { resize(); _updateBtnWells(); });

  const GRID = 44;
  const PERSP_H = 0.30;       // horizontal convergence toward top
  const PERSP_V_EXP = 1.12;   // vertical compression exponent (>1 = top compressed)
  const MAX_DISP = GRID * 0.47;
  const G_VIS = 2800;         // gravitational pull constant

  function draw() {
    if (document.getElementById('splash').classList.contains('hidden')) {
      cancelAnimationFrame(animId); animId = null; return;
    }
    animId = requestAnimationFrame(draw);
    t += 0.007;
    _updateBtnWells();

    // Mass positions this frame
    const mpos = masses.map(getMassPos);

    // Wave emitter positions (wander independently)
    _emitters = _emitterDefs.map(em => {
      const st = t * em.drift;
      return {
        x: (em.cx + Math.sin(st * em.fx + em.px) * em.ax) * w,
        y: (em.cy + Math.cos(st * em.fy + em.py) * em.ay) * h,
        waveLen: em.waveLen, speed: em.speed, amp: em.amp, reach: em.reach,
      };
    });

    // ── Background ──
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, w, h);

    // ── Dark pool shadows under each mass ──
    for (const mp of mpos) {
      const r1 = mp.radius * 1.2;
      const g1 = ctx.createRadialGradient(mp.x, mp.y, 0, mp.x, mp.y, r1);
      g1.addColorStop(0, `rgba(0,0,0,${0.06 * mp.intensity})`);
      g1.addColorStop(0.4, `rgba(0,0,0,${0.025 * mp.intensity})`);
      g1.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g1;
      ctx.fillRect(mp.x - r1, mp.y - r1, r1 * 2, r1 * 2);
      // Wide outer haze
      const r2 = mp.radius * 3;
      const g2 = ctx.createRadialGradient(mp.x, mp.y, 0, mp.x, mp.y, r2);
      g2.addColorStop(0, `rgba(0,0,0,${0.03 * mp.intensity})`);
      g2.addColorStop(0.35, `rgba(0,0,0,${0.012 * mp.intensity})`);
      g2.addColorStop(0.7, `rgba(0,0,0,${0.003 * mp.intensity})`);
      g2.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(mp.x - r2, mp.y - r2, r2 * 2, r2 * 2);
    }

    // Mouse shadow
    if (mActive) {
      const r = 280;
      const g = ctx.createRadialGradient(mx, my, 0, mx, my, r);
      g.addColorStop(0, 'rgba(0,0,0,0.06)');
      g.addColorStop(0.35, 'rgba(0,0,0,0.025)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(mx - r, my - r, r * 2, r * 2);
    }

    // ── Pulsing contour rings — ripple outward over time ──
    for (const mp of mpos) {
      const nRings = 6;
      for (let ring = 0; ring < nRings; ring++) {
        // Rings expand outward with time, creating a pulsing ripple effect
        const phase = (t * 0.6 * mp.intensity + ring / nRings) % 1;
        const r = mp.radius * 0.15 + phase * mp.radius * 1.2;
        const fade = (1 - phase) * mp.intensity;
        ctx.beginPath();
        ctx.arc(mp.x, mp.y, r, 0, TWO_PI);
        ctx.strokeStyle = `rgba(0,0,0,${0.025 * fade})`;
        ctx.lineWidth = 0.5 + (1 - phase) * 0.5;
        ctx.stroke();
      }
    }

    // ── Compute perspective grid with gravitational displacement ──
    const margin = GRID * 4;
    const totalH = h + margin * 2;
    const totalW = w + margin * 2;
    const cols = Math.ceil(totalW / GRID) + 2;
    const rows = Math.ceil(totalH / GRID) + 2;
    const stride = cols + 1;
    const pts = new Array(stride * (rows + 1));
    const centerX = w / 2;

    for (let gy = 0; gy <= rows; gy++) {
      // ── Perspective projection ──
      // rowT: 0 = top (far), 1 = bottom (near)
      const rowT = gy / rows;
      // Vertical: compress rows near the top (far away)
      const yPersp = Math.pow(rowT, PERSP_V_EXP);
      const baseY = -margin + yPersp * totalH;
      // Horizontal: lines converge toward center at the top
      const hScale = (1 - PERSP_H) + PERSP_H * rowT;

      for (let gx = 0; gx <= cols; gx++) {
        // Flat grid X position
        const flatX = -margin + gx * GRID;
        // Apply horizontal perspective convergence
        const bx = centerX + (flatX - centerX) * hScale;
        const by = baseY;

        let dx = 0, dy = 0;

        // ── Gravitational displacement + pulsing waves ──
        for (const mp of mpos) {
          const rx = bx - mp.x, ry = by - mp.y;
          const r = Math.sqrt(rx * rx + ry * ry);
          const softR = mp.radius * 0.35;

          // Static gravitational well (inverse-distance)
          const pull = mp.intensity * G_VIS / (r + softR);
          const invR = 1 / (r + 0.5);
          dx -= rx * invR * pull;
          dy -= ry * invR * pull;

          // Slower traveling waves pulsing outward from each mass
          if (r < mp.radius * 3.5) {
            const waveLen = mp.radius * 0.7;
            const waveSpeed = 1.0 * mp.intensity;
            const wavePhase = r / waveLen - t * waveSpeed;
            const waveFade = Math.exp(-r / (mp.radius * 2.0));
            const waveAmp = Math.sin(wavePhase * TWO_PI) * waveFade * mp.intensity * 4;
            if (r > 1) {
              dx += (rx / r) * waveAmp;
              dy += (ry / r) * waveAmp;
            }
          }
        }

        // Independent wave emitters — separate sources from the masses
        // Each radiates slow circular waves from a different fixed location
        for (const em of _emitters) {
          const erx = bx - em.x, ery = by - em.y;
          const er = Math.sqrt(erx * erx + ery * ery);
          if (er < em.reach) {
            const phase = er / em.waveLen - t * em.speed;
            const fade = Math.exp(-er / (em.reach * 0.5));
            const amp = Math.sin(phase * TWO_PI) * fade * em.amp;
            if (er > 1) {
              dx += (erx / er) * amp;
              dy += (ery / er) * amp;
            }
          }
        }

        // Gentle global plane wave — very slow background breathing
        dx += Math.sin(bx * 0.003 + by * 0.0015 + t * 0.4) * 1.2;
        dy += Math.cos(bx * 0.0015 - by * 0.003 + t * 0.35) * 1.2;

        // Mouse as a gravitational mass
        if (mActive) {
          const rx = bx - mx, ry = by - my;
          const r = Math.sqrt(rx * rx + ry * ry);
          const pull = 2200 / (r + 130);
          dx -= (rx / (r + 0.5)) * pull;
          dy -= (ry / (r + 0.5)) * pull;
        }

        // Button wells
        for (const well of _btnWells) {
          const rx = bx - well.x, ry = by - well.y;
          const nd = Math.sqrt((rx / well.rx) ** 2 + (ry / well.ry) ** 2);
          if (nd < 3) {
            const str = well.strength * (1 + well.hover * 1.5);
            const f = Math.exp(-nd * nd * 0.5);
            dx -= rx * f * str * 0.4;
            dy -= ry * f * str * 0.4;
            if (well.hover > 0) dy += f * str * 12 * well.hover;
          }
        }

        // Smooth asymptotic clamp — no hard cutoff
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0.01) {
          const clamped = MAX_DISP * (1 - Math.exp(-len / MAX_DISP));
          dx *= clamped / len;
          dy *= clamped / len;
        }

        pts[gy * stride + gx] = { x: bx + dx, y: by + dy, dx, dy };
      }
    }

    // ── Draw grid as Catmull-Rom → cubic Bezier splines ──
    // CP1 = P1 + (P2 - P0)/6, CP2 = P2 - (P3 - P1)/6
    // Guarantees C1 tangent continuity — silky smooth everywhere.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Per-segment style: lighter overall, with per-line weight variance
    // lineIdx provides a stable hash so each grid line has a slightly
    // different base weight — some thinner, some thicker — for texture.
    function setStyle(p1, p2, lineIdx) {
      const d1 = Math.sqrt(p1.dx * p1.dx + p1.dy * p1.dy);
      const d2 = Math.sqrt(p2.dx * p2.dx + p2.dy * p2.dy);
      const dn = Math.min(1, (d1 + d2) / (2 * MAX_DISP));
      const ramp = 1 - Math.exp(-dn * 3.5);
      // Per-line variance: deterministic wobble based on line index
      const variance = ((lineIdx * 7919) % 100) / 100; // 0-1 pseudo-random per line
      const thickLine = variance > 0.7 ? 1 : 0; // ~30% of lines are accent lines
      // Opacity: 0.035 (flat thin) → 0.18 (deep well), accent lines slightly stronger
      const baseAlpha = 0.035 + thickLine * 0.015;
      const alpha = baseAlpha + ramp * 0.13;
      // Width: varies per line, boosted in wells
      const baseLw = 0.2 + variance * 0.25 + thickLine * 0.2;
      const lw = baseLw + ramp * 0.8;
      ctx.strokeStyle = `rgba(0,0,0,${Math.min(0.20, alpha)})`;
      ctx.lineWidth = Math.min(1.4, lw);
    }

    function drawCR(p0, p1, p2, p3, lineIdx) {
      setStyle(p1, p2, lineIdx);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(
        p1.x + (p2.x - p0.x) / 6, p1.y + (p2.y - p0.y) / 6,
        p2.x - (p3.x - p1.x) / 6, p2.y - (p3.y - p1.y) / 6,
        p2.x, p2.y
      );
      ctx.stroke();
    }

    // Horizontal splines — lineIdx = row index for consistent per-line weight
    for (let gy = 0; gy <= rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        drawCR(
          pts[gy * stride + Math.max(0, gx - 1)],
          pts[gy * stride + gx],
          pts[gy * stride + gx + 1],
          pts[gy * stride + Math.min(cols, gx + 2)],
          gy
        );
      }
    }
    // Vertical splines — lineIdx offset so verticals get different variance from horizontals
    for (let gx = 0; gx <= cols; gx++) {
      for (let gy = 0; gy < rows; gy++) {
        drawCR(
          pts[Math.max(0, gy - 1) * stride + gx],
          pts[gy * stride + gx],
          pts[(gy + 1) * stride + gx],
          pts[Math.min(rows, gy + 2) * stride + gx],
          gx + 1000
        );
      }
    }

    // Button hover shadows
    for (const well of _btnWells) {
      if (well.hover <= 0) continue;
      const bGrad = ctx.createRadialGradient(well.x, well.y + well.ry * 0.3, 0, well.x, well.y, Math.max(well.rx, well.ry) * 2.5);
      bGrad.addColorStop(0, `rgba(0,0,0,${0.12 * well.hover})`);
      bGrad.addColorStop(0.3, `rgba(0,0,0,${0.06 * well.hover})`);
      bGrad.addColorStop(0.7, `rgba(0,0,0,${0.015 * well.hover})`);
      bGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bGrad;
      ctx.fillRect(well.x - well.rx * 3, well.y - well.ry * 3, well.rx * 6, well.ry * 6);
    }
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
let _introPhase = 'idle';
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
  _introPhase = 'welcome'; // welcome → controls → tip → done
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
        // Show R tip — alien flyby triggers only if user presses R while tip is visible
        _introPhase = 'tip';
        const tip = document.getElementById('cruise-tip');
        if (tip) {
          tip.classList.add('active');
          setTimeout(() => { tip.classList.remove('active'); if (_introPhase === 'tip') _introPhase = 'done'; }, 5000);
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
//  SPLASH HOVER DESCRIPTIONS (dynamically generated from actual data)
// ═══════════════════════════════════════════════
const _hoverBox = document.getElementById('splash-hover-box');
const _moonCount = MOONS.length;
const _planetCount = PLANETS.length;
const _deepSkyGalaxies = DEEP_SKY_OBJECTS.filter(o => o.type === 'galaxy').length;
const _deepSkyNebulae = DEEP_SKY_OBJECTS.filter(o => o.type === 'nebula' || o.type === 'planetary_nebula' || o.type === 'snr').length;
const _deepSkyClusters = DEEP_SKY_OBJECTS.filter(o => o.type === 'globular' || o.type === 'open_cluster').length;
const _launchCount = LAUNCH_DATA.length;
const _launchOrgs = new Set(LAUNCH_DATA.map(m => m.org)).size;
const _launchYearMin = LAUNCH_DATA.reduce((min, m) => Math.min(min, parseInt(m.date.slice(0,4))), 9999);
const _launchYearMax = LAUNCH_DATA.reduce((max, m) => Math.max(max, parseInt(m.date.slice(0,4))), 0);

const _splashDescs = {
  'splash-explore-btn': `Pilot your own spacecraft through an accurate 3D solar system. Visit all ${_planetCount} planets with real NASA textures, ${_moonCount} moons, asteroids, the Kuiper Belt, and comets. Explore ${_deepSkyGalaxies} galaxies with a full 3D rendering engine, ${_deepSkyNebulae} nebulae, and ${_deepSkyClusters} star clusters. Search and travel to over 15 million real objects from the SIMBAD database. Control the flow of time from paused to 27 years per second. Track real satellites in orbit using live CelesTrak data.`,
  'splash-launches-btn': `Dive into a comprehensive database of ${_launchCount.toLocaleString()} orbital launches spanning from ${_launchYearMin} to ${_launchYearMax} across ${_launchOrgs} organizations worldwide. Explore interactive 3D globes of Earth, Mars, and the solar system. Browse detailed organization profiles with launch-by-year charts, rocket fleets, and historic firsts. Watch embedded launch videos for iconic missions. Filter by nation and drill into defining moments of spaceflight history.`,
  'splash-sim-btn': `Watch SpaceX's Starship flight profile unfold in real time with accurate physics simulation. Follow every milestone from liftoff through Max Q, hot-staging, booster catch, and orbit insertion. Features real SpaceX photography for each flight phase, live telemetry readouts (altitude, velocity, acceleration, stage), scrub bar, and adjustable playback speed up to 10x.`,
  'splash-planner-btn': `Plan interplanetary missions with real Hohmann transfer orbital mechanics. Choose from 6 rockets across SpaceX, NASA, Blue Origin, and ESA. Select destinations from the Moon to Neptune, pick your mission type (flyby, orbit, or landing), and get a physics-based delta-v feasibility analysis. Approve your mission and watch it execute in a 3D solar system with live telemetry.`,
};

document.querySelectorAll('.splash-btn[data-hover-desc]').forEach(btn => {
  btn.addEventListener('mouseenter', () => {
    const desc = _splashDescs[btn.id] || btn.getAttribute('data-hover-desc');
    if (_hoverBox && desc) {
      _hoverBox.innerHTML = '<div class="splash-hover-box-inner"><div class="splash-hover-box-text">' + desc + '</div></div>';
      _hoverBox.classList.add('visible');
    }
  });
  btn.addEventListener('mouseleave', () => {
    if (_hoverBox) _hoverBox.classList.remove('visible');
  });
});

// ═══════════════════════════════════════════════
//  LAUNCH SIMULATOR  (Flight Profile Viewer)
// ═══════════════════════════════════════════════

let _fpActive = false;
let _fpPlaying = false;
let _fpSpeed = 10;
let _fpTime = 0;
let _fpLastT = 0;
let _fpState = null;
let _fpActiveMilestone = -1;

// (old SIM_SITES / DEST_ALTS removed — flight profile uses STARSHIP_PROFILE)

// ── Flight Profile functions ─────────────────────

// ── openLaunchSim ────────────────────────────────
function openLaunchSim() {
  _fpActive = true;
  _fpPlaying = false;
  _fpTime = 0;
  _fpActiveMilestone = -1;
  document.getElementById('launch-sim').classList.add('open');
  _initSpaceBg();
  _renderRocketDiagram();
  _renderMilestones();
  // Reset to T=0 state
  _fpState = seekToTime(0, STARSHIP_PROFILE);
  _updateFP(_fpState);
  requestAnimationFrame(function(t) { _fpLastT = t; _fpAnimate(t); });
}

// ── closeLaunchSim ───────────────────────────────
function closeLaunchSim() {
  _fpActive = false;
  _fpPlaying = false;
  _stopSpaceBg();
  document.getElementById('launch-sim').classList.remove('open');
  document.getElementById('splash').classList.remove('hidden');
}


// ── Flight Phase Images ─────────────────────────
const _FP_PHASE_IMAGES = [
  { id: 'liftoff',    minT: -999, src: '/Infinita/images/starship/startship8liftoff.webp', label: 'LIFTOFF' },
  { id: 'maxq',       minT: 62,   src: '/Infinita/images/starship/starship8maxq.jpeg', label: 'MAX Q — ASCENT' },
  { id: 'hotstage',   minT: 160,  src: '/Infinita/images/starship/starship8hotstage.jpg', label: 'HOT-STAGING' },
  { id: 'boostback',  minT: 240,  src: '/Infinita/images/starship/SpaceXCatchesBooster.jpg', label: 'BOOSTER CATCH' },
  { id: 'orbit',      minT: 380,  src: '/Infinita/images/starship/starship8orbit.webp', label: 'ORBIT ACHIEVED' },
];
let _fpCurrentPhase = '';

function _getPhaseForTime(t) {
  for (var i = _FP_PHASE_IMAGES.length - 1; i >= 0; i--) {
    if (t >= _FP_PHASE_IMAGES[i].minT) return _FP_PHASE_IMAGES[i];
  }
  return _FP_PHASE_IMAGES[0];
}

function _updatePhaseImage(t) {
  var phase = _getPhaseForTime(t);
  if (phase.id === _fpCurrentPhase) return;
  _fpCurrentPhase = phase.id;
  var img = document.getElementById('fp-phase-img');
  var label = document.getElementById('fp-phase-label');
  if (img) {
    img.style.opacity = '0';
    setTimeout(function() {
      img.src = phase.src;
      img.onload = function() { img.style.opacity = '1'; };
      if (img.complete) img.style.opacity = '1';
    }, 300);
  }
  if (label) label.textContent = phase.label;
}

function _renderRocketDiagram() {
  var panel = document.getElementById('fp-rocket-panel');
  if (!panel) return;
  // Phase-based image display instead of SVG
  _fpCurrentPhase = '';
  panel.innerHTML = '<div class="fp-phase-display">' +
    '<img id="fp-phase-img" class="fp-phase-img" src="' + _FP_PHASE_IMAGES[0].src + '" alt="Flight phase" />' +
    '<div id="fp-phase-label" class="fp-phase-img-label">' + _FP_PHASE_IMAGES[0].label + '</div>' +
    '</div>';
  _fpCurrentPhase = 'prelaunch';
  return;
  // Old SVG code below (kept for reference but unreachable)
  var svgNS = 'http://www.w3.org/2000/svg';
  var svgW = 80, svgH = 500;
  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + svgW + ' ' + svgH);
  svg.setAttribute('class', 'fp-rocket-svg');
  svg.style.width = '80px';
  svg.style.height = '100%';
  svg.style.maxHeight = svgH + 'px';

  // ── Booster group (bottom 58.7% of height) ──
  var boosterG = document.createElementNS(svgNS, 'g');
  boosterG.setAttribute('class', 'fp-rocket-stage');
  boosterG.setAttribute('data-stage', 'superheavy');
  boosterG.style.setProperty('--glow', '#0ef');

  // Booster body — tall rounded rect
  var boosterY = svgH * 0.413; // top of booster
  var boosterH = svgH * 0.557; // 55.7% for body (leaving room for engines)
  var boosterRect = document.createElementNS(svgNS, 'rect');
  boosterRect.setAttribute('x', '22');
  boosterRect.setAttribute('y', String(boosterY));
  boosterRect.setAttribute('width', '36');
  boosterRect.setAttribute('height', String(boosterH));
  boosterRect.setAttribute('rx', '3');
  boosterRect.setAttribute('fill', '#a0a0a8');
  boosterRect.setAttribute('stroke', 'rgba(0,238,255,0.15)');
  boosterRect.setAttribute('stroke-width', '0.5');
  boosterG.appendChild(boosterRect);

  // Booster vertical line details (panel seams)
  for (var si = 0; si < 3; si++) {
    var seam = document.createElementNS(svgNS, 'line');
    seam.setAttribute('x1', String(30 + si * 10));
    seam.setAttribute('y1', String(boosterY + 5));
    seam.setAttribute('x2', String(30 + si * 10));
    seam.setAttribute('y2', String(boosterY + boosterH - 5));
    seam.setAttribute('stroke', 'rgba(0,0,0,0.15)');
    seam.setAttribute('stroke-width', '0.3');
    boosterG.appendChild(seam);
  }

  // Engine skirt (wider at bottom)
  var skirtY = boosterY + boosterH;
  var skirt = document.createElementNS(svgNS, 'polygon');
  skirt.setAttribute('points', '22,' + skirtY + ' 18,' + (skirtY + 12) + ' 62,' + (skirtY + 12) + ' 58,' + skirtY);
  skirt.setAttribute('fill', '#808088');
  skirt.setAttribute('stroke', 'rgba(0,238,255,0.1)');
  skirt.setAttribute('stroke-width', '0.3');
  boosterG.appendChild(skirt);

  // Engine nozzles at bottom
  var engY = skirtY + 12;
  var engColors = ['#555', '#666', '#555', '#666', '#555'];
  var engXPositions = [26, 32, 40, 48, 54];
  for (var ei = 0; ei < 5; ei++) {
    var nozzle = document.createElementNS(svgNS, 'rect');
    nozzle.setAttribute('x', String(engXPositions[ei] - 2));
    nozzle.setAttribute('y', String(engY));
    nozzle.setAttribute('width', '4');
    nozzle.setAttribute('height', '8');
    nozzle.setAttribute('rx', '1');
    nozzle.setAttribute('fill', engColors[ei]);
    boosterG.appendChild(nozzle);
  }
  // Raptor cluster indicator dots (inner ring)
  var clusterCX = 40, clusterCY = engY + 4;
  for (var ci = 0; ci < 8; ci++) {
    var ca = (ci / 8) * Math.PI * 2;
    var dot = document.createElementNS(svgNS, 'circle');
    dot.setAttribute('cx', String(clusterCX + Math.cos(ca) * 8));
    dot.setAttribute('cy', String(clusterCY + Math.sin(ca) * 3));
    dot.setAttribute('r', '1');
    dot.setAttribute('fill', '#777');
    boosterG.appendChild(dot);
  }

  // Grid fins (4 small rectangles at top of booster)
  var finY = boosterY + 2;
  var finPositions = [{x: 14, side: -1}, {x: 58, side: 1}];
  for (var fi = 0; fi < 2; fi++) {
    var fin = document.createElementNS(svgNS, 'rect');
    fin.setAttribute('x', String(finPositions[fi].x));
    fin.setAttribute('y', String(finY));
    fin.setAttribute('width', '8');
    fin.setAttribute('height', '18');
    fin.setAttribute('rx', '1');
    fin.setAttribute('fill', '#707078');
    fin.setAttribute('stroke', 'rgba(0,238,255,0.1)');
    fin.setAttribute('stroke-width', '0.3');
    boosterG.appendChild(fin);
    // Grid pattern on fin
    for (var gi = 0; gi < 3; gi++) {
      var gridLine = document.createElementNS(svgNS, 'line');
      gridLine.setAttribute('x1', String(finPositions[fi].x + 1));
      gridLine.setAttribute('y1', String(finY + 4 + gi * 5));
      gridLine.setAttribute('x2', String(finPositions[fi].x + 7));
      gridLine.setAttribute('y2', String(finY + 4 + gi * 5));
      gridLine.setAttribute('stroke', 'rgba(0,0,0,0.2)');
      gridLine.setAttribute('stroke-width', '0.3');
      boosterG.appendChild(gridLine);
    }
  }

  // Hot-stage ring at top of booster
  var hotRing = document.createElementNS(svgNS, 'rect');
  hotRing.setAttribute('x', '20');
  hotRing.setAttribute('y', String(boosterY - 4));
  hotRing.setAttribute('width', '40');
  hotRing.setAttribute('height', '6');
  hotRing.setAttribute('rx', '1');
  hotRing.setAttribute('fill', '#606068');
  boosterG.appendChild(hotRing);

  // "SUPER HEAVY" label
  var boosterLabel = document.createElementNS(svgNS, 'text');
  boosterLabel.setAttribute('class', 'fp-rocket-stage-label');
  boosterLabel.setAttribute('x', '40');
  boosterLabel.setAttribute('y', String(boosterY + boosterH * 0.5));
  boosterLabel.setAttribute('text-anchor', 'middle');
  boosterLabel.setAttribute('transform', 'rotate(-90, 40, ' + (boosterY + boosterH * 0.5) + ')');
  boosterLabel.textContent = 'SUPER HEAVY';
  boosterG.appendChild(boosterLabel);

  svg.appendChild(boosterG);

  // ── Ship group (top 41.3% of height) ──
  var shipG = document.createElementNS(svgNS, 'g');
  shipG.setAttribute('class', 'fp-rocket-stage');
  shipG.setAttribute('data-stage', 'ship');
  shipG.style.setProperty('--glow', '#00ff88');

  // Ship body
  var shipBodyY = svgH * 0.12;
  var shipBodyH = boosterY - 4 - shipBodyY;
  var shipRect = document.createElementNS(svgNS, 'rect');
  shipRect.setAttribute('x', '22');
  shipRect.setAttribute('y', String(shipBodyY));
  shipRect.setAttribute('width', '36');
  shipRect.setAttribute('height', String(shipBodyH));
  shipRect.setAttribute('rx', '3');
  shipRect.setAttribute('fill', '#c0c0c8');
  shipRect.setAttribute('stroke', 'rgba(0,238,255,0.15)');
  shipRect.setAttribute('stroke-width', '0.5');
  shipG.appendChild(shipRect);

  // Heat shield (dark side) — half of ship body
  var heatShield = document.createElementNS(svgNS, 'rect');
  heatShield.setAttribute('x', '22');
  heatShield.setAttribute('y', String(shipBodyY));
  heatShield.setAttribute('width', '18');
  heatShield.setAttribute('height', String(shipBodyH));
  heatShield.setAttribute('rx', '3');
  heatShield.setAttribute('fill', '#333338');
  heatShield.setAttribute('opacity', '0.5');
  shipG.appendChild(heatShield);

  // Ship panel seams
  for (var ssi = 0; ssi < 2; ssi++) {
    var sSeam = document.createElementNS(svgNS, 'line');
    sSeam.setAttribute('x1', String(32 + ssi * 16));
    sSeam.setAttribute('y1', String(shipBodyY + 5));
    sSeam.setAttribute('x2', String(32 + ssi * 16));
    sSeam.setAttribute('y2', String(shipBodyY + shipBodyH - 5));
    sSeam.setAttribute('stroke', 'rgba(0,0,0,0.1)');
    sSeam.setAttribute('stroke-width', '0.3');
    shipG.appendChild(sSeam);
  }

  // Nose cone — triangular top
  var noseTopY = 8;
  var noseCone = document.createElementNS(svgNS, 'path');
  // Rounded nose with bezier curve
  noseCone.setAttribute('d', 'M 22,' + shipBodyY + ' Q 22,' + (noseTopY + 20) + ' 40,' + noseTopY + ' Q 58,' + (noseTopY + 20) + ' 58,' + shipBodyY + ' Z');
  noseCone.setAttribute('fill', '#d0d0d8');
  noseCone.setAttribute('stroke', 'rgba(0,238,255,0.15)');
  noseCone.setAttribute('stroke-width', '0.5');
  shipG.appendChild(noseCone);

  // Nose cone heat shield half
  var noseDark = document.createElementNS(svgNS, 'path');
  noseDark.setAttribute('d', 'M 22,' + shipBodyY + ' Q 22,' + (noseTopY + 20) + ' 40,' + noseTopY + ' L 40,' + shipBodyY + ' Z');
  noseDark.setAttribute('fill', '#333338');
  noseDark.setAttribute('opacity', '0.4');
  shipG.appendChild(noseDark);

  // Forward flaps (2)
  var fwdFlapY = shipBodyY + 10;
  var fwdFlap1 = document.createElementNS(svgNS, 'rect');
  fwdFlap1.setAttribute('x', '12');
  fwdFlap1.setAttribute('y', String(fwdFlapY));
  fwdFlap1.setAttribute('width', '10');
  fwdFlap1.setAttribute('height', '30');
  fwdFlap1.setAttribute('rx', '2');
  fwdFlap1.setAttribute('fill', '#505058');
  fwdFlap1.setAttribute('transform', 'rotate(-5, 17, ' + (fwdFlapY + 15) + ')');
  shipG.appendChild(fwdFlap1);

  var fwdFlap2 = document.createElementNS(svgNS, 'rect');
  fwdFlap2.setAttribute('x', '58');
  fwdFlap2.setAttribute('y', String(fwdFlapY));
  fwdFlap2.setAttribute('width', '10');
  fwdFlap2.setAttribute('height', '30');
  fwdFlap2.setAttribute('rx', '2');
  fwdFlap2.setAttribute('fill', '#505058');
  fwdFlap2.setAttribute('transform', 'rotate(5, 63, ' + (fwdFlapY + 15) + ')');
  shipG.appendChild(fwdFlap2);

  // Aft flaps (2)
  var aftFlapY = shipBodyY + shipBodyH - 35;
  var aftFlap1 = document.createElementNS(svgNS, 'rect');
  aftFlap1.setAttribute('x', '12');
  aftFlap1.setAttribute('y', String(aftFlapY));
  aftFlap1.setAttribute('width', '10');
  aftFlap1.setAttribute('height', '30');
  aftFlap1.setAttribute('rx', '2');
  aftFlap1.setAttribute('fill', '#505058');
  aftFlap1.setAttribute('transform', 'rotate(-5, 17, ' + (aftFlapY + 15) + ')');
  shipG.appendChild(aftFlap1);

  var aftFlap2 = document.createElementNS(svgNS, 'rect');
  aftFlap2.setAttribute('x', '58');
  aftFlap2.setAttribute('y', String(aftFlapY));
  aftFlap2.setAttribute('width', '10');
  aftFlap2.setAttribute('height', '30');
  aftFlap2.setAttribute('rx', '2');
  aftFlap2.setAttribute('fill', '#505058');
  aftFlap2.setAttribute('transform', 'rotate(5, 63, ' + (aftFlapY + 15) + ')');
  shipG.appendChild(aftFlap2);

  // Ship engines (smaller, at bottom of ship)
  var shipEngY = shipBodyY + shipBodyH - 2;
  for (var sei = 0; sei < 3; sei++) {
    var sNoz = document.createElementNS(svgNS, 'rect');
    sNoz.setAttribute('x', String(30 + sei * 7));
    sNoz.setAttribute('y', String(shipEngY));
    sNoz.setAttribute('width', '3');
    sNoz.setAttribute('height', '5');
    sNoz.setAttribute('rx', '0.5');
    sNoz.setAttribute('fill', '#666');
    shipG.appendChild(sNoz);
  }

  // "SHIP" label
  var shipLabel = document.createElementNS(svgNS, 'text');
  shipLabel.setAttribute('class', 'fp-rocket-stage-label');
  shipLabel.setAttribute('x', '40');
  shipLabel.setAttribute('y', String(shipBodyY + shipBodyH * 0.5));
  shipLabel.setAttribute('text-anchor', 'middle');
  shipLabel.setAttribute('transform', 'rotate(-90, 40, ' + (shipBodyY + shipBodyH * 0.5) + ')');
  shipLabel.textContent = 'SHIP';
  shipG.appendChild(shipLabel);

  svg.appendChild(shipG);

  panel.innerHTML = '';
  panel.appendChild(svg);
}


// ── _renderMilestones ────────────────────────────
function _renderMilestones() {
  var container = document.getElementById('fp-milestones');
  if (!container) return;
  container.innerHTML = '';
  var milestones = STARSHIP_PROFILE.milestones;
  var maxTime = STARSHIP_PROFILE.maxTime;
  for (var i = 0; i < milestones.length; i++) {
    var m = milestones[i];
    // Use time-based positioning so milestones don't cluster at similar altitudes
    var pct = (m.t / maxTime) * 88 + 6;
    var side = i % 2 === 0 ? 'left' : 'right';
    var node = document.createElement('div');
    node.className = 'fp-milestone fp-milestone-' + side;
    node.style.bottom = pct + '%';
    node.dataset.index = String(i);
    node.innerHTML =
      '<div class="fp-milestone-dot"></div>' +
      '<div class="fp-milestone-card">' +
        '<div class="fp-milestone-label">' + m.label + '</div>' +
        '<div class="fp-milestone-time">T+' + Math.floor(m.t / 60) + ':' + String(Math.floor(m.t % 60)).padStart(2, '0') + ' | ' + m.alt + ' km</div>' +
      '</div>';
    node.addEventListener('click', (function(idx) {
      return function() {
        _fpTime = STARSHIP_PROFILE.milestones[idx].t;
        _fpState = seekToTime(_fpTime, STARSHIP_PROFILE);
        _updateFP(_fpState);
        var scrub = document.getElementById('fp-scrub');
        if (scrub) scrub.value = String(_fpTime);
      };
    })(i));
    container.appendChild(node);
  }
}

// ── _updateFP: update all UI from physics state ──
function _updateFP(state) {
  if (!state) return;
  var s = state;
  var maxAlt = STARSHIP_PROFILE.maxAlt;
  var milestones = STARSHIP_PROFILE.milestones;

  // Update phase image based on current time
  _updatePhaseImage(_fpTime);

  // Update rocket indicator position (sqrt scale)
  var rocketDot = document.getElementById('fp-rocket-dot');
  if (rocketDot) {
    var altPct = (Math.min(_fpTime, STARSHIP_PROFILE.maxTime) / STARSHIP_PROFILE.maxTime) * 88 + 6;
    rocketDot.style.bottom = altPct + '%';
  }

  // Update telemetry values
  var mins = Math.floor(s.t / 60);
  var secs = Math.floor(s.t % 60);
  var timeEl = document.getElementById('fp-t-time');
  if (timeEl) timeEl.textContent = String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');

  var altEl = document.getElementById('fp-t-alt');
  if (altEl) altEl.textContent = s.alt < 1000 ? s.alt.toFixed(1) + ' km' : (s.alt / 1000).toFixed(2) + ' Mm';

  var velEl = document.getElementById('fp-t-vel');
  if (velEl) velEl.textContent = s.vel < 1000 ? s.vel.toFixed(0) + ' m/s' : (s.vel / 1000).toFixed(2) + ' km/s';

  var accelEl = document.getElementById('fp-t-accel');
  if (accelEl) accelEl.textContent = s.accel.toFixed(1) + ' g';

  var stageEl = document.getElementById('fp-t-stage');
  if (stageEl) stageEl.textContent = s.stage.toUpperCase();

  // Update scrub bar
  var scrub = document.getElementById('fp-scrub');
  if (scrub && !scrub.matches(':active')) {
    scrub.value = String(Math.floor(s.t));
  }

  // Check milestones: activate reached ones, update callout
  var newActiveMilestone = -1;
  for (var mi = milestones.length - 1; mi >= 0; mi--) {
    if (s.t >= milestones[mi].t) {
      newActiveMilestone = mi;
      break;
    }
  }

  // Update milestone DOM nodes
  var milestoneNodes = document.querySelectorAll('.fp-milestone');
  for (var mni = 0; mni < milestoneNodes.length; mni++) {
    var idx = parseInt(milestoneNodes[mni].dataset.index, 10);
    milestoneNodes[mni].classList.toggle('reached', s.t >= milestones[idx].t);
    milestoneNodes[mni].classList.toggle('active', idx === newActiveMilestone);
  }

  // Update callout card if milestone changed
  if (newActiveMilestone !== _fpActiveMilestone) {
    _fpActiveMilestone = newActiveMilestone;
    var labelEl = document.getElementById('fp-callout-label');
    var timeCallEl = document.getElementById('fp-callout-time');
    var descEl = document.getElementById('fp-callout-desc');
    if (newActiveMilestone >= 0) {
      var cm = milestones[newActiveMilestone];
      if (labelEl) labelEl.textContent = cm.label;
      if (timeCallEl) timeCallEl.textContent = 'T+' + Math.floor(cm.t / 60) + ':' + String(Math.floor(cm.t % 60)).padStart(2, '0') + ' | ALT ' + cm.alt + ' km | VEL ' + cm.vel + ' m/s';
      if (descEl) descEl.textContent = cm.desc;
    } else {
      if (labelEl) labelEl.textContent = 'READY';
      if (timeCallEl) timeCallEl.textContent = 'T-0:10';
      if (descEl) descEl.textContent = 'Press play to begin the flight profile.';
    }
  }

  // Update rocket diagram: highlight active stage, show separation
  var stageGroups = document.querySelectorAll('.fp-rocket-stage');
  for (var sgi = 0; sgi < stageGroups.length; sgi++) {
    var stageId = stageGroups[sgi].dataset.stage;
    var isBooster = stageId === 'superheavy';
    var isShip = stageId === 'ship';
    // Active highlighting
    if (s.stage === 'booster' || s.stage === 'hot-stage') {
      stageGroups[sgi].classList.toggle('active', isBooster);
    } else if (s.stage === 'ship' || s.stage === 'coast') {
      stageGroups[sgi].classList.toggle('active', isShip);
    } else if (s.stage === 'orbit') {
      stageGroups[sgi].classList.toggle('active', isShip);
    } else {
      stageGroups[sgi].classList.remove('active');
    }
    // Separation visual
    if (isBooster && (s.stage === 'ship' || s.stage === 'coast' || s.stage === 'orbit' || s.stage === 'booster-return')) {
      stageGroups[sgi].classList.add('separated');
    } else {
      stageGroups[sgi].classList.remove('separated');
    }
  }

  // Update stage info panel
  var stageInfoEl = document.getElementById('fp-stage-info');
  if (stageInfoEl) {
    var activeStage = null;
    for (var asi = 0; asi < STARSHIP_PROFILE.stages.length; asi++) {
      var stg = STARSHIP_PROFILE.stages[asi];
      if ((s.stage === 'booster' || s.stage === 'hot-stage') && stg.id === 'superheavy') { activeStage = stg; break; }
      if ((s.stage === 'ship' || s.stage === 'coast' || s.stage === 'orbit') && stg.id === 'ship') { activeStage = stg; break; }
    }
    if (activeStage && activeStage.details) {
      var detailHTML = '';
      for (var di = 0; di < activeStage.details.length; di++) {
        detailHTML += '<div class="fp-stage-detail">' + activeStage.details[di].label + '<span>' + activeStage.details[di].value + '</span></div>';
      }
      stageInfoEl.innerHTML = detailHTML;
    } else {
      stageInfoEl.innerHTML = '';
    }
  }
}

// ── _fpAnimate: animation loop ───────────────────
function _fpAnimate(now) {
  if (!_fpActive) return;
  requestAnimationFrame(_fpAnimate);

  var dt = Math.min((now - _fpLastT) / 1000, 0.1);
  _fpLastT = now;

  if (_fpPlaying) {
    _fpTime += dt * _fpSpeed;
    if (_fpTime > STARSHIP_PROFILE.maxTime) {
      _fpTime = STARSHIP_PROFILE.maxTime;
      _fpPlaying = false;
      // Remove active class from play button
      var playBtn = document.getElementById('fp-play-btn');
      if (playBtn) playBtn.classList.remove('active');
    }
    _fpState = seekToTime(_fpTime, STARSHIP_PROFILE);
    _updateFP(_fpState);
  }
}

// ── Event wiring ─────────────────────────────────

// Play button
document.getElementById('fp-play-btn').addEventListener('click', function() {
  _fpPlaying = true;
  this.classList.add('active');
  var pauseBtn = document.getElementById('fp-pause-btn');
  if (pauseBtn) pauseBtn.classList.remove('active');
});

// Pause button
document.getElementById('fp-pause-btn').addEventListener('click', function() {
  _fpPlaying = false;
  this.classList.add('active');
  var playBtn = document.getElementById('fp-play-btn');
  if (playBtn) playBtn.classList.remove('active');
});

// Reset button
document.getElementById('fp-reset-btn').addEventListener('click', function() {
  _fpTime = 0;
  _fpPlaying = false;
  _fpActiveMilestone = -1;
  _fpState = seekToTime(0, STARSHIP_PROFILE);
  _updateFP(_fpState);
  var playBtn = document.getElementById('fp-play-btn');
  if (playBtn) playBtn.classList.remove('active');
  var pauseBtn = document.getElementById('fp-pause-btn');
  if (pauseBtn) pauseBtn.classList.remove('active');
});

// Speed select
document.getElementById('fp-speed-select').addEventListener('change', function() {
  _fpSpeed = parseInt(this.value, 10) || 1;
});

// Scrub bar
document.getElementById('fp-scrub').addEventListener('input', function() {
  _fpTime = parseInt(this.value, 10) || 0;
  _fpState = seekToTime(_fpTime, STARSHIP_PROFILE);
  _updateFP(_fpState);
});
document.getElementById('fp-scrub').addEventListener('touchstart', function(e) { e.stopPropagation(); });

// Back button
document.getElementById('sim-back-btn').addEventListener('click', closeLaunchSim);

// Splash sim button
document.getElementById('splash-sim-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('splash').classList.add('hidden');
  openLaunchSim();
});
// Mission Planner button
document.getElementById('splash-planner-btn').addEventListener('click', function(e) {
  e.stopPropagation();
  document.getElementById('splash').classList.add('hidden');
  openMissionPlanner();
});
initMissionPlanner();

document.getElementById('hud-back-btn').addEventListener('click', () => {
  started = false;
  document.getElementById('hud').classList.remove('active');
  document.getElementById('splash').classList.remove('hidden');
  if (isMobile && window._mobileHideControls) window._mobileHideControls();
  if (exploreMode) stopExploreMode();
  if (travelActive) abortTravel();
  if (_arrivalOrbit.active) _arrivalOrbit.active = false;
  _viewingGalaxy = null;
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

    // Sun glow pulsing — subtle brightness oscillation
    const sunT = performance.now() * 0.001;
    _sunGlowSprites.forEach((g, i) => {
      const pulse = 1 + Math.sin(sunT * (0.5 + i * 0.3)) * 0.06 + Math.sin(sunT * (1.2 + i * 0.7)) * 0.03;
      g.sprite.scale.setScalar(g.baseScale * pulse);
    });
    // Corona breathing
    _sunCoronaSprites.forEach((c, i) => {
      const breath = 1 + Math.sin(sunT * (0.2 + i * 0.15)) * 0.08;
      c.sprite.scale.setScalar(c.baseScale * breath);
    });
    // Solar flare eruptions
    _solarFlares.forEach(f => {
      f.timer += dt;
      if (!f.active && f.timer > f.lifetime) {
        f.active = true;
        f.progress = 0;
        f.timer = 0;
        f.lifetime = 2 + Math.random() * 5;
        f.angle += Math.random() * Math.PI * 0.6;
        f.baseY = (Math.random() - 0.5) * SUN_RADIUS_VIS * 0.4;
      }
      if (f.active) {
        f.progress += dt * (0.12 + Math.random() * 0.06);
        if (f.progress >= 1) {
          f.active = false;
          f.mat.opacity = 0;
          f.sprite.scale.set(0.001, 0.001, 1);
        } else {
          const rise = Math.sin(f.progress * Math.PI);
          const fade = f.progress < 0.2 ? f.progress / 0.2 : Math.pow(1 - (f.progress - 0.2) / 0.8, 0.6);
          f.mat.opacity = fade * 0.8;
          // Flare grows from surface outward — base stays anchored
          const flareH = rise * SUN_RADIUS_VIS * 0.6;
          f.sprite.scale.set(
            0.03 + rise * 0.04,
            Math.max(0.01, flareH),
            1
          );
          // Position: base of sprite sits on the Sun surface
          // Sprite center offset upward by half its height so bottom touches surface
          const surfR = SUN_RADIUS_VIS * 0.98;
          const dx = Math.cos(f.angle);
          const dz = Math.sin(f.angle);
          // Radial direction outward from center
          f.sprite.position.set(
            dx * (surfR + flareH * 0.5),
            f.baseY + flareH * 0.3,
            dz * (surfR + flareH * 0.5)
          );
        }
      }
    });

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

  // Animate generated galaxy models (shader-based engine)
  updateGalaxies(dt);
  // Pulse "You Are Here" marker
  if (youAreHere.visible) { yahSprite.scale.setScalar(8000 * (1 + 0.15 * Math.sin(performance.now() * 0.003))); }
  updateHUD();
  tickFacts(dt);
  _updateTicker(dt);
  _updateTrivia(dt);
  updateLabels();
  // Keep background stars centered on camera so they're always visible
  bgStarMesh.position.copy(camera.position);
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
