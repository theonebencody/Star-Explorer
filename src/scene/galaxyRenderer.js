// ═══════════════════════════════════════════════════════════════════
//  GALAXY RENDERING ENGINE
//  Real-time volumetric galaxy renderer with custom shaders,
//  logarithmic spiral arms, and multi-layer particle systems.
// ═══════════════════════════════════════════════════════════════════

import * as THREE from 'three';
import { tempToColor } from './physics.js';

// ── Module state ─────────────────────────────────────────────────
let _scene, _camera, _isMobile;
const _galaxies = []; // all active galaxy groups for animation
const KLY = 63241;    // 1 kly in AU

// ── Shared soft-glow sprite texture (created once) ──────────────
let _spriteTexture;
function _getSpriteTexture() {
  if (_spriteTexture) return _spriteTexture;
  const c = document.createElement('canvas');
  c.width = 64; c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.2)');
  g.addColorStop(0.7, 'rgba(255,255,255,0.03)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  _spriteTexture = new THREE.CanvasTexture(c);
  return _spriteTexture;
}

// ── Gaussian random ─────────────────────────────────────────────
function _gr() {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ── Galaxy type presets ─────────────────────────────────────────
const PRESETS = {
  spiral: {
    arms: 2, wind: 2.0, barFraction: 0,
    bulgeRatio: 0.25, discThickness: 0.008,
    armSpread: 0.06, interarmSpread: 0.14,
    hiiDensity: 0.04, haloSize: 1.3,
  },
  barredSpiral: {
    arms: 2, wind: 2.5, barFraction: 0.3,
    bulgeRatio: 0.18, discThickness: 0.008,
    armSpread: 0.05, interarmSpread: 0.12,
    hiiDensity: 0.05, haloSize: 1.2,
  },
  grandDesign: {
    arms: 2, wind: 3.5, barFraction: 0,
    bulgeRatio: 0.08, discThickness: 0.006,
    armSpread: 0.04, interarmSpread: 0.09,
    hiiDensity: 0.08, haloSize: 1.1,
  },
  elliptical: {
    arms: 0, wind: 0, barFraction: 0,
    bulgeRatio: 1.0, discThickness: 0,
    oblateness: 0.6, hiiDensity: 0, haloSize: 1.5,
  },
  irregular: {
    arms: 0, wind: 0, barFraction: 0.1,
    bulgeRatio: 0.05, discThickness: 0.04,
    hiiDensity: 0.12, haloSize: 0.8,
    clumpiness: 0.7,
  },
};

// ═══════════════════════════════════════════════════════════════════
//  CUSTOM SHADER — Star particles
// ═══════════════════════════════════════════════════════════════════

const STAR_VERTEX = `
  attribute float aSize;
  attribute float aRandom;
  varying vec3 vColor;
  varying float vRandom;
  uniform float uTime;
  uniform float uPointScale;

  void main() {
    vColor = color;
    vRandom = aRandom;

    // Twinkle: per-particle phase offset
    float twinkle = 1.0 + 0.12 * sin(uTime * 2.5 + aRandom * 6.283)
                       + 0.06 * sin(uTime * 5.7 + aRandom * 3.14);

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float dist = -mvPos.z;
    gl_PointSize = max(1.0, aSize * twinkle * uPointScale * (300.0 / max(dist, 1.0)));
    gl_Position = projectionMatrix * mvPos;
  }
`;

const STAR_FRAGMENT = `
  varying vec3 vColor;
  varying float vRandom;
  uniform sampler2D uSprite;

  void main() {
    vec4 texel = texture2D(uSprite, gl_PointCoord);
    float alpha = texel.a;

    // Soft circular falloff
    float d = length(gl_PointCoord - vec2(0.5));
    alpha *= smoothstep(0.5, 0.1, d);

    // Slight brightness variation per particle
    float brightness = 0.85 + 0.15 * fract(vRandom * 17.3);

    gl_FragColor = vec4(vColor * brightness, alpha * 0.9);
  }
`;

// ── Dust particle shader (darker, absorptive) ───────────────────
const DUST_VERTEX = `
  attribute float aSize;
  attribute float aRandom;
  varying float vAlpha;
  uniform float uTime;
  uniform float uPointScale;

  void main() {
    vAlpha = 0.25 + 0.1 * sin(uTime * 0.3 + aRandom * 6.283);
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    float dist = -mvPos.z;
    gl_PointSize = max(1.0, aSize * uPointScale * (300.0 / max(dist, 1.0)));
    gl_Position = projectionMatrix * mvPos;
  }
`;

const DUST_FRAGMENT = `
  varying float vAlpha;
  uniform sampler2D uSprite;

  void main() {
    vec4 texel = texture2D(uSprite, gl_PointCoord);
    float d = length(gl_PointCoord - vec2(0.5));
    float alpha = texel.a * smoothstep(0.5, 0.15, d) * vAlpha;
    gl_FragColor = vec4(0.03, 0.02, 0.01, alpha);
  }
`;

// ═══════════════════════════════════════════════════════════════════
//  PARTICLE GENERATION
// ═══════════════════════════════════════════════════════════════════

function _generateDiscStars(R, preset, count) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const randoms = new Float32Array(count);

  const R0 = R * 0.06; // scale radius for spiral
  const arms = preset.arms || 2;
  const wind = preset.wind || 2.5;
  const barR = R * (preset.barFraction || 0);

  for (let i = 0; i < count; i++) {
    const inArm = i < count * 0.65;
    let x, y, z;

    if (preset.arms === 0 && preset.clumpiness) {
      // Irregular galaxy — clumpy random distribution
      const r = Math.pow(Math.random(), 0.8) * R;
      const a = Math.random() * Math.PI * 2;
      x = Math.cos(a) * r + _gr() * R * 0.15;
      y = _gr() * R * (preset.discThickness || 0.04);
      z = Math.sin(a) * r + _gr() * R * 0.15;
    } else if (preset.arms === 0) {
      // Elliptical — handled by bulge, skip disc
      x = y = z = 0;
    } else {
      const armIdx = inArm
        ? Math.floor(Math.random() * arms)
        : Math.floor(Math.random() * arms) + 0.5;
      const armBase = (armIdx / arms) * Math.PI * 2;
      const dist = Math.pow(Math.random(), 0.7) * R;

      if (barR > 0 && dist < barR) {
        // Bar region
        const barAngle = 0; // bar along X axis
        const along = (Math.random() * 2 - 1) * barR;
        x = along + _gr() * barR * 0.08;
        y = _gr() * dist * (preset.discThickness || 0.008);
        z = _gr() * barR * 0.15;
      } else {
        const spiralAngle = armBase + Math.log(1 + dist / R0) * wind;
        const spread = inArm ? preset.armSpread : preset.interarmSpread;
        const perpSpread = _gr() * dist * spread;
        x = Math.cos(spiralAngle) * dist + Math.cos(spiralAngle + Math.PI / 2) * perpSpread;
        y = _gr() * dist * (preset.discThickness || 0.008);
        z = Math.sin(spiralAngle) * dist + Math.sin(spiralAngle + Math.PI / 2) * perpSpread;
      }
    }

    pos[i * 3] = x;
    pos[i * 3 + 1] = y;
    pos[i * 3 + 2] = z;

    // Color: warm core → blue arms
    const distFromCenter = Math.sqrt(x * x + z * z) / R;
    let temp;
    if (distFromCenter < 0.12) {
      temp = 3500 + Math.random() * 2000;
    } else if (inArm && preset.arms > 0) {
      temp = 6500 + Math.random() * 20000;
    } else {
      temp = 3500 + Math.random() * 4000;
    }
    const c = tempToColor(temp);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;

    sizes[i] = (0.7 + Math.random() * 0.6) * R * 0.004;
    randoms[i] = Math.random();
  }

  return { pos, col, sizes, randoms };
}

function _generateBulge(R, preset, count) {
  const bulgeR = R * (preset.bulgeRatio || 0.25);
  const oblateness = preset.oblateness || 0.5;
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const randoms = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = bulgeR * Math.pow(Math.random(), 2.2);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * oblateness;
    pos[i * 3 + 2] = r * Math.cos(phi);

    const temp = 3200 + Math.random() * 2800;
    const c = tempToColor(temp);
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;

    sizes[i] = (0.8 + Math.random() * 0.5) * R * 0.005;
    randoms[i] = Math.random();
  }

  return { pos, col, sizes, randoms };
}

function _generateHII(R, preset, count) {
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const randoms = new Float32Array(count);

  const R0 = R * 0.06;
  const arms = preset.arms || 2;
  const wind = preset.wind || 2.5;

  for (let i = 0; i < count; i++) {
    const armIdx = Math.floor(Math.random() * Math.max(1, arms));
    const armBase = (armIdx / Math.max(1, arms)) * Math.PI * 2;
    const dist = (0.2 + Math.random() * 0.7) * R;
    const spiralAngle = armBase + Math.log(1 + dist / R0) * wind;
    const spread = _gr() * dist * 0.04;
    const x = Math.cos(spiralAngle) * dist + Math.cos(spiralAngle + Math.PI / 2) * spread;
    const y = _gr() * dist * 0.003;
    const z = Math.sin(spiralAngle) * dist + Math.sin(spiralAngle + Math.PI / 2) * spread;

    pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;

    // Pink-magenta with variation
    col[i * 3] = 0.9 + Math.random() * 0.1;
    col[i * 3 + 1] = 0.2 + Math.random() * 0.3;
    col[i * 3 + 2] = 0.3 + Math.random() * 0.25;

    sizes[i] = (1.5 + Math.random() * 2.5) * R * 0.004;
    randoms[i] = Math.random();
  }

  return { pos, col, sizes, randoms };
}

function _generateHalo(R, preset, count) {
  const haloR = R * (preset.haloSize || 1.3);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const randoms = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const r = haloR * Math.pow(Math.random(), 1.5);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i * 3 + 2] = r * Math.cos(phi);

    const c = tempToColor(4000 + Math.random() * 1500);
    col[i * 3] = c.r * 0.4; col[i * 3 + 1] = c.g * 0.4; col[i * 3 + 2] = c.b * 0.4;

    sizes[i] = (0.5 + Math.random() * 0.3) * R * 0.003;
    randoms[i] = Math.random();
  }

  return { pos, col, sizes, randoms };
}

function _generateDust(R, preset, count) {
  const pos = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const randoms = new Float32Array(count);

  const R0 = R * 0.06;
  const arms = preset.arms || 2;
  const wind = preset.wind || 2.5;

  for (let i = 0; i < count; i++) {
    const armIdx = Math.floor(Math.random() * Math.max(1, arms));
    const armBase = (armIdx / Math.max(1, arms)) * Math.PI * 2;
    const dist = Math.pow(Math.random(), 0.6) * R * 0.85;
    const spiralAngle = armBase + Math.log(1 + dist / R0) * wind - 0.12;
    const spread = _gr() * dist * 0.025;
    pos[i * 3] = Math.cos(spiralAngle) * dist + Math.cos(spiralAngle + Math.PI / 2) * spread;
    pos[i * 3 + 1] = _gr() * dist * 0.002;
    pos[i * 3 + 2] = Math.sin(spiralAngle) * dist + Math.sin(spiralAngle + Math.PI / 2) * spread;

    sizes[i] = (1.5 + Math.random() * 2) * R * 0.006;
    randoms[i] = Math.random();
  }

  return { pos, sizes, randoms };
}

// ═══════════════════════════════════════════════════════════════════
//  CREATE POINTS MESH FROM GENERATED DATA
// ═══════════════════════════════════════════════════════════════════

function _createStarPoints(data, blending) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(data.col, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1));
  geo.setAttribute('aRandom', new THREE.BufferAttribute(data.randoms, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPointScale: { value: 1 },
      uSprite: { value: _getSpriteTexture() },
    },
    vertexShader: STAR_VERTEX,
    fragmentShader: STAR_FRAGMENT,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: blending || THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.renderOrder = 1;
  return points;
}

function _createDustPoints(data) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(data.sizes, 1));
  geo.setAttribute('aRandom', new THREE.BufferAttribute(data.randoms, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uPointScale: { value: 1 },
      uSprite: { value: _getSpriteTexture() },
    },
    vertexShader: DUST_VERTEX,
    fragmentShader: DUST_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.NormalBlending,
  });

  const points = new THREE.Points(geo, mat);
  points.renderOrder = 0; // render dust first (behind stars)
  return points;
}

// ═══════════════════════════════════════════════════════════════════
//  CORE GLOW (PlaneGeometry with view-angle-aware shader)
// ═══════════════════════════════════════════════════════════════════

const CORE_VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const CORE_FRAGMENT = `
  varying vec2 vUv;
  uniform float uBreath;

  void main() {
    float d = length(vUv - vec2(0.5)) * 2.0;
    float glow = exp(-d * d * 2.5) * (0.9 + uBreath * 0.1);
    // Color gradient: white center → golden edge
    vec3 col = mix(vec3(1.0, 0.95, 0.82), vec3(1.0, 0.99, 0.95), exp(-d * 4.0));
    gl_FragColor = vec4(col, glow);
  }
`;

function _createCoreGlow(R, aspect) {
  const size = R * 0.5;
  const geo = new THREE.PlaneGeometry(size * 2, size * 2 * (aspect || 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uBreath: { value: 0 },
    },
    vertexShader: CORE_VERTEX,
    fragmentShader: CORE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 5;
  // Oriented in disc plane — will be rotated by parent group
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

// ═══════════════════════════════════════════════════════════════════
//  PUBLIC API
// ═══════════════════════════════════════════════════════════════════

export function initGalaxyRenderer(scene, camera, isMobile) {
  _scene = scene;
  _camera = camera;
  _isMobile = isMobile;
}

/**
 * Build a galaxy model.
 * @param {Object} opts
 * @param {string} opts.type - 'spiral'|'barredSpiral'|'grandDesign'|'elliptical'|'irregular'
 * @param {number} opts.scale - size multiplier (1 = ~100kly diameter)
 * @param {number} opts.tilt - inclination in radians
 * @param {number} opts.arms - override arm count
 * @param {number} opts.wind - override winding factor
 * @param {boolean} opts.elliptical - shorthand for elliptical type
 * @returns {THREE.Group}
 */
export function buildGalaxy(opts = {}) {
  const type = opts.elliptical ? 'elliptical' : (opts.type || 'spiral');
  const preset = { ...PRESETS[type] };
  if (opts.arms !== undefined) preset.arms = opts.arms;
  if (opts.wind !== undefined) preset.wind = opts.wind;

  const scale = opts.scale || 1;
  const tilt = opts.tilt || 0.4;
  const R = 50000 * KLY * scale;

  const group = new THREE.Group();

  // Particle counts
  const mobile = _isMobile;
  const discCount = preset.arms > 0 ? (mobile ? 10000 : 30000) : (preset.clumpiness ? (mobile ? 5000 : 15000) : 0);
  const bulgeCount = mobile ? 2000 : 5000;
  const hiiCount = preset.hiiDensity > 0 && preset.arms > 0 ? (mobile ? 500 : 1500) : 0;
  const haloCount = mobile ? 500 : 1500;
  const dustCount = preset.arms > 0 ? (mobile ? 1500 : 4000) : 0;

  // Materials list for animation updates
  const materials = [];

  // Layer 1: Halo (outermost, rendered first)
  if (haloCount > 0) {
    const haloData = _generateHalo(R, preset, haloCount);
    const haloPoints = _createStarPoints(haloData, THREE.AdditiveBlending);
    haloPoints.renderOrder = 0;
    group.add(haloPoints);
    materials.push(haloPoints.material);
  }

  // Layer 2: Dust (absorptive, behind stars)
  if (dustCount > 0) {
    const dustData = _generateDust(R, preset, dustCount);
    const dustPoints = _createDustPoints(dustData);
    dustPoints.renderOrder = 1;
    group.add(dustPoints);
    materials.push(dustPoints.material);
  }

  // Layer 3: Disc stars
  if (discCount > 0) {
    const discData = _generateDiscStars(R, preset, discCount);
    const discPoints = _createStarPoints(discData, THREE.AdditiveBlending);
    discPoints.renderOrder = 2;
    group.add(discPoints);
    materials.push(discPoints.material);
  }

  // Layer 4: Bulge
  if (bulgeCount > 0) {
    const bulgeData = _generateBulge(R, preset, bulgeCount);
    const bulgePoints = _createStarPoints(bulgeData, THREE.AdditiveBlending);
    bulgePoints.renderOrder = 3;
    group.add(bulgePoints);
    materials.push(bulgePoints.material);
  }

  // Layer 5: HII regions
  if (hiiCount > 0) {
    const hiiData = _generateHII(R, preset, hiiCount);
    const hiiPoints = _createStarPoints(hiiData, THREE.AdditiveBlending);
    hiiPoints.renderOrder = 4;
    group.add(hiiPoints);
    materials.push(hiiPoints.material);
  }

  // Layer 6: Core glow
  const aspect = type === 'elliptical' ? (preset.oblateness || 0.6) : 1;
  const coreGlow = _createCoreGlow(R, aspect);
  group.add(coreGlow);

  // Apply tilt
  group.rotation.x = tilt;

  // Store animation data
  group.userData._galaxyAnim = {
    time: Math.random() * 100,
    rotSpeed: 0.002 + Math.random() * 0.002,
    materials,
    coreMaterial: coreGlow.material,
    R,
  };

  // Register for animation
  _galaxies.push(group);

  return group;
}

/**
 * Update all active galaxies — called once per frame from the animate loop.
 */
export function updateGalaxies(dt) {
  if (!_camera) return;

  for (const group of _galaxies) {
    if (!group.visible || !group.userData._galaxyAnim) continue;
    const a = group.userData._galaxyAnim;
    a.time += dt;

    // Slow rotation
    group.rotation.y += a.rotSpeed * dt;

    // Compute camera distance for point scale
    const camDist = _camera.position.distanceTo(group.position);
    const pointScale = Math.max(0.5, a.R * 0.15 / Math.max(camDist, 1));

    // Update all shader uniforms
    for (const mat of a.materials) {
      mat.uniforms.uTime.value = a.time;
      mat.uniforms.uPointScale.value = pointScale;
    }

    // Core breathing
    a.coreMaterial.uniforms.uBreath.value =
      Math.sin(a.time * 0.4) * 0.3 + Math.sin(a.time * 1.1) * 0.15;
  }
}

/**
 * Dispose a galaxy and remove from animation list.
 */
export function disposeGalaxy(group) {
  const idx = _galaxies.indexOf(group);
  if (idx >= 0) _galaxies.splice(idx, 1);
  group.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (child.material.uniforms?.uSprite?.value) {
        // Don't dispose shared texture
      }
      child.material.dispose();
    }
  });
}
