import * as THREE from 'three';

// ═══════════════════════════════════════════════
//  UFO EASTER EGG (extracted from SceneManager)
// ═══════════════════════════════════════════════

let _scene  = null;
let _camera = null;
let _getState = null; // () => { currentScale, exploreMode, started }

let _ufoGroup   = null;
let _ufoLights  = [];
let _ufoActive  = false;
let _ufoVel     = new THREE.Vector3();
let _ufoLife    = 0;
let _ufoMax     = 6;
let _ufoAlertT  = 0;
let _ufoPassive = 70 + Math.random() * 80; // seconds until passive spawn

// Interceptor system
let _interceptor = null; // { group, vel, missileGroup, missileVel, phase, timer }
let _explosion = null;   // { group, timer, particles }

function _buildUFO() {
  const g = new THREE.Group();
  // Classic disc hull — wide, very flat
  const hullGeo = new THREE.SphereGeometry(1, 24, 10);
  const hullMat = new THREE.MeshPhongMaterial({ color:0xaaaaaa, shininess:90, specular:0x888888, emissive:0x111111 });
  const hull = new THREE.Mesh(hullGeo, hullMat);
  hull.scale.set(1, 0.18, 1);
  g.add(hull);
  // Lower disc rim — slightly wider, tapered like a lens edge
  const rimGeo = new THREE.CylinderGeometry(1.1, 0.9, 0.12, 24);
  const rimMat = new THREE.MeshPhongMaterial({ color:0x999999, shininess:120 });
  const rim = new THREE.Mesh(rimGeo, rimMat);
  rim.position.y = -0.06;
  g.add(rim);
  // Small bubble dome on top
  const domeGeo = new THREE.SphereGeometry(0.32, 12, 7, 0, Math.PI*2, 0, Math.PI*0.55);
  const domeMat = new THREE.MeshPhongMaterial({ color:0x223311, transparent:true, opacity:0.8, shininess:200, specular:0x44aa44, emissive:0x081208 });
  const dome = new THREE.Mesh(domeGeo, domeMat);
  dome.position.y = 0.14;
  g.add(dome);
  // Soft green underglow — very subtle, like propulsion glow
  const gc = document.createElement('canvas'); gc.width=64; gc.height=64;
  const gctx=gc.getContext('2d'),gg=gctx.createRadialGradient(32,32,0,32,32,32);
  gg.addColorStop(0,'rgba(80,255,100,0.35)'); gg.addColorStop(0.5,'rgba(80,255,100,0.08)'); gg.addColorStop(1,'rgba(0,0,0,0)');
  gctx.fillStyle=gg; gctx.fillRect(0,0,64,64);
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(gc),blending:THREE.AdditiveBlending,transparent:true,depthWrite:false}));
  glow.scale.setScalar(2.8); glow.position.y=-0.15; g.add(glow);
  _ufoLights = [];
  g.visible = false;
  _scene.add(g);
  return g;
}

function _buildFighter(sc) {
  const g = new THREE.Group();
  const whiteMat = new THREE.MeshPhongMaterial({ color: 0xdddde0, shininess: 70, specular: 0x555555 });
  const darkMat = new THREE.MeshPhongMaterial({ color: 0x444455, shininess: 40 });
  const accentMat = new THREE.MeshPhongMaterial({ color: 0x2255aa, shininess: 60 });

  // Main hull — shuttle-like body
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 8), whiteMat);
  hull.rotation.x = Math.PI / 2;
  g.add(hull);

  // Cockpit canopy — dark tinted dome
  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.13, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.5),
    new THREE.MeshPhongMaterial({ color: 0x112244, shininess: 200, specular: 0x4488cc, transparent: true, opacity: 0.85 })
  );
  canopy.position.set(0, 0.1, -0.55);
  canopy.rotation.x = -0.2;
  g.add(canopy);

  // Nose — pointed, tapered
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.45, 8), whiteMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -1.02;
  g.add(nose);

  // Delta wings — swept back
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.3, 0.5), whiteMat);
  wingL.position.set(0, -0.04, 0.1);
  wingL.rotation.z = Math.PI / 2;
  wingL.rotation.y = -0.08;
  g.add(wingL);

  // Wing tips — angled up slightly
  const tipL = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.25, 0.15), accentMat);
  tipL.position.set(-0.65, 0.08, 0.25);
  tipL.rotation.z = 0.3;
  g.add(tipL);
  const tipR = tipL.clone();
  tipR.position.x = 0.65;
  tipR.rotation.z = -0.3;
  g.add(tipR);

  // Vertical stabilizer
  const vStab = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.45, 0.3), darkMat);
  vStab.position.set(0, 0.28, 0.55);
  g.add(vStab);

  // Engine nacelles — two pods on the rear
  const nacL = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.5, 8), darkMat);
  nacL.rotation.x = Math.PI / 2;
  nacL.position.set(-0.22, -0.05, 0.5);
  g.add(nacL);
  const nacR = nacL.clone();
  nacR.position.x = 0.22;
  g.add(nacR);

  // Engine glows (two blue thrusters)
  for (const xOff of [-0.22, 0.22]) {
    const ec = document.createElement('canvas'); ec.width = 32; ec.height = 32;
    const ectx = ec.getContext('2d'), eg = ectx.createRadialGradient(16,16,0,16,16,16);
    eg.addColorStop(0, 'rgba(100,170,255,0.95)');
    eg.addColorStop(0.3, 'rgba(60,120,255,0.6)');
    eg.addColorStop(0.6, 'rgba(30,60,200,0.2)');
    eg.addColorStop(1, 'rgba(0,0,0,0)');
    ectx.fillStyle = eg; ectx.fillRect(0,0,32,32);
    const engGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(ec), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    engGlow.scale.setScalar(0.35);
    engGlow.position.set(xOff, -0.05, 0.78);
    g.add(engGlow);
  }

  // Markings — small accent stripe
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.005, 0.02), accentMat);
  stripe.position.set(0, 0.15, -0.3);
  g.add(stripe);

  g.scale.setScalar(sc * 0.55);
  g.visible = false;
  _scene.add(g);
  return g;
}

function _buildMissile(sc) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 0.4, 6),
    new THREE.MeshPhongMaterial({ color: 0xcccccc, shininess: 60 })
  );
  body.rotation.x = Math.PI / 2;
  g.add(body);
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(0.04, 0.12, 6),
    new THREE.MeshPhongMaterial({ color: 0xff3333, shininess: 80 })
  );
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = -0.26;
  g.add(tip);
  // Exhaust trail
  const tc = document.createElement('canvas'); tc.width = 32; tc.height = 32;
  const tctx = tc.getContext('2d'), tg = tctx.createRadialGradient(16,16,0,16,16,16);
  tg.addColorStop(0, 'rgba(255,200,50,0.9)'); tg.addColorStop(0.3, 'rgba(255,100,20,0.5)'); tg.addColorStop(1, 'rgba(0,0,0,0)');
  tctx.fillStyle = tg; tctx.fillRect(0,0,32,32);
  const trail = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tc), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
  trail.scale.setScalar(0.3);
  trail.position.z = 0.25;
  g.add(trail);
  g.scale.setScalar(sc * 0.35);
  g.visible = false;
  _scene.add(g);
  return g;
}

function _buildExplosion(sc) {
  const g = new THREE.Group();
  const N = 40;
  const particles = [];
  for (let i = 0; i < N; i++) {
    const c = document.createElement('canvas'); c.width = 16; c.height = 16;
    const ctx = c.getContext('2d'), grad = ctx.createRadialGradient(8,8,0,8,8,8);
    const hot = Math.random() > 0.4;
    if (hot) {
      grad.addColorStop(0, 'rgba(255,255,200,1)');
      grad.addColorStop(0.3, 'rgba(255,180,50,0.8)');
      grad.addColorStop(1, 'rgba(255,60,0,0)');
    } else {
      grad.addColorStop(0, 'rgba(255,100,30,0.8)');
      grad.addColorStop(0.5, 'rgba(200,60,10,0.4)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
    }
    ctx.fillStyle = grad; ctx.fillRect(0,0,16,16);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }));
    const dir = new THREE.Vector3(Math.random()-0.5, Math.random()-0.5, Math.random()-0.5).normalize();
    const speed = 0.5 + Math.random() * 2;
    sp.scale.setScalar(sc * (0.3 + Math.random() * 0.6));
    sp.visible = false;
    g.add(sp);
    particles.push({ sprite: sp, dir, speed, life: 0 });
  }
  _scene.add(g);
  return { group: g, particles };
}

function _startIntercept() {
  if (!_ufoActive || !_ufoGroup) return;
  const { currentScale } = _getState();
  const sc = currentScale <= 1 ? 0.28 : currentScale === 2 ? 3200 : _camera.far * 0.0008;

  // Build fighter if needed
  const fighterGrp = _buildFighter(sc);
  const missileGrp = _buildMissile(sc);

  // Position fighter behind and to the side of the UFO
  const ufoPos = _ufoGroup.position.clone();
  const offsetDir = new THREE.Vector3(
    (Math.random() - 0.5), (Math.random() - 0.5) * 0.3, (Math.random() - 0.5)
  ).normalize();
  const startPos = ufoPos.clone().addScaledVector(offsetDir, sc * 12);

  fighterGrp.position.copy(startPos);
  fighterGrp.lookAt(ufoPos);
  fighterGrp.visible = true;

  // Fighter velocity — fly toward UFO
  const toUFO = ufoPos.clone().sub(startPos).normalize();
  const fighterSpeed = sc * 8;

  _interceptor = {
    group: fighterGrp,
    vel: toUFO.clone().multiplyScalar(fighterSpeed),
    missileGroup: missileGrp,
    missileVel: new THREE.Vector3(),
    phase: 'approach', // approach → fire → track → explode → retreat
    timer: 0,
    sc: sc,
    fireDelay: 0.8 + Math.random() * 0.6 // seconds before firing
  };

  // Show alert
  _ufoAlertT = 6;
  const alertEl = document.getElementById('ufo-alert');
  alertEl.querySelector('.ufo-msg').textContent = 'DEFENSE INTERCEPTOR LAUNCHED';
  alertEl.classList.add('show');
}

function _updateIntercept(dt) {
  if (!_interceptor) return;
  const ic = _interceptor;
  ic.timer += dt;

  if (ic.phase === 'approach') {
    ic.group.position.addScaledVector(ic.vel, dt);
    if (_ufoGroup) ic.group.lookAt(_ufoGroup.position);
    if (ic.timer > ic.fireDelay) {
      // Fire missile
      ic.phase = 'track';
      ic.timer = 0;
      ic.missileGroup.position.copy(ic.group.position);
      ic.missileGroup.visible = true;
      const toTarget = _ufoGroup.position.clone().sub(ic.group.position).normalize();
      ic.missileVel.copy(toTarget).multiplyScalar(ic.sc * 16);
      ic.missileGroup.lookAt(_ufoGroup.position);
    }
  } else if (ic.phase === 'track') {
    // Missile homes toward UFO
    if (_ufoGroup && _ufoActive) {
      const toTarget = _ufoGroup.position.clone().sub(ic.missileGroup.position).normalize();
      ic.missileVel.lerp(toTarget.multiplyScalar(ic.sc * 16), dt * 4);
      ic.missileGroup.position.addScaledVector(ic.missileVel.normalize().multiplyScalar(ic.sc * 16), dt);
      ic.missileGroup.lookAt(_ufoGroup.position);

      // Check hit
      const dist = ic.missileGroup.position.distanceTo(_ufoGroup.position);
      if (dist < ic.sc * 1.5) {
        // IMPACT — trigger explosion
        ic.phase = 'explode';
        ic.timer = 0;
        ic.missileGroup.visible = false;

        // Build and start explosion at UFO position
        const expData = _buildExplosion(ic.sc);
        expData.group.position.copy(_ufoGroup.position);
        expData.particles.forEach(p => { p.sprite.visible = true; p.sprite.position.set(0,0,0); });
        _explosion = { group: expData.group, particles: expData.particles, timer: 0, sc: ic.sc };

        // Hide UFO
        _ufoGroup.visible = false;
        _ufoActive = false;

        // Update alert
        _ufoAlertT = 4;
        const alertEl = document.getElementById('ufo-alert');
        alertEl.querySelector('.ufo-msg').textContent = 'HOSTILE CRAFT NEUTRALIZED';
        alertEl.classList.add('show');
      }
    }
    if (ic.timer > 5) {
      // Missile missed — timeout
      ic.missileGroup.visible = false;
      ic.phase = 'retreat';
      ic.timer = 0;
    }
  } else if (ic.phase === 'explode') {
    if (ic.timer > 1.5) {
      ic.phase = 'retreat';
      ic.timer = 0;
    }
  } else if (ic.phase === 'retreat') {
    // Fighter flies away
    const away = ic.group.position.clone().sub(_camera.position).normalize();
    ic.group.position.addScaledVector(away, ic.sc * 6 * dt);
    ic.group.lookAt(ic.group.position.clone().addScaledVector(away, 1));
    if (ic.timer > 3) {
      // Cleanup
      _scene.remove(ic.group);
      _scene.remove(ic.missileGroup);
      ic.group.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }});
      ic.missileGroup.traverse(c => { if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }});
      _interceptor = null;
    }
  }
}

function _updateExplosion(dt) {
  if (!_explosion) return;
  _explosion.timer += dt;
  const t = _explosion.timer;
  const sc = _explosion.sc;
  _explosion.particles.forEach(p => {
    p.life += dt;
    const expand = p.speed * sc * 2;
    p.sprite.position.addScaledVector(p.dir, expand * dt);
    const fade = Math.max(0, 1 - t / 2.0);
    p.sprite.material.opacity = fade;
    p.sprite.scale.setScalar(sc * (0.3 + t * 0.8) * (0.5 + p.speed * 0.3));
  });
  if (t > 2.0) {
    _scene.remove(_explosion.group);
    _explosion.group.traverse(c => { if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); }});
    _explosion = null;
  }
}

const _UFO_MSGS = [
  'UNIDENTIFIED CRAFT DETECTED',
  'UNKNOWN VESSEL INTERCEPTED',
  'ANOMALOUS OBJECT IN VICINITY',
  'UNREGISTERED SHIP ON SENSORS',
  'CONTACT SIGNAL — ORIGIN UNKNOWN',
];

/**
 * Store scene/camera refs and a state accessor. No immediate action.
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {Function} getState  — () => { currentScale, exploreMode, started }
 */
export function initUFO(scene, camera, getState) {
  _scene    = scene;
  _camera   = camera;
  _getState = getState;
}

export function spawnUFO() {
  if (!_ufoGroup) _ufoGroup = _buildUFO();
  if (_ufoActive) return;

  const { currentScale } = _getState();

  // Scale relative to scale level so it's always visually prominent
  const sc = currentScale <= 1 ? 0.28 : currentScale === 2 ? 3200 : _camera.far * 0.0008;
  _ufoGroup.scale.setScalar(sc);

  const fwd   = new THREE.Vector3(0,0,-1).applyQuaternion(_camera.quaternion);
  const right = new THREE.Vector3(1,0,0).applyQuaternion(_camera.quaternion);
  const up    = new THREE.Vector3(0,1,0);

  const side  = (Math.random() > 0.5 ? 1 : -1) * (6 + Math.random() * 5) * sc;
  const depth = (14 + Math.random() * 6) * sc;
  const vert  = (Math.random() - 0.5) * 4 * sc;

  const sp = _camera.position.clone()
    .addScaledVector(fwd, depth)
    .addScaledVector(right, side)
    .add(up.clone().multiplyScalar(vert));

  _ufoGroup.position.copy(sp);

  // Fly across + slightly forward — always visibly crosses the view
  const crossDir = right.clone().multiplyScalar(-Math.sign(side))
    .addScaledVector(fwd, 0.35 + Math.random()*0.25)
    .addScaledVector(up, (Math.random()-0.5)*0.15)
    .normalize();

  _ufoVel.copy(crossDir).multiplyScalar(sc * 5.8);
  _ufoGroup.rotation.y = Math.atan2(_ufoVel.x, _ufoVel.z);
  _ufoGroup.visible = true;
  _ufoActive = true;
  _ufoLife   = 0;
  _ufoMax    = 5 + Math.random() * 2.5;

  // Alert notification
  _ufoAlertT = 4.5;
  const alertEl = document.getElementById('ufo-alert');
  alertEl.querySelector('.ufo-msg').textContent = _UFO_MSGS[Math.floor(Math.random()*_UFO_MSGS.length)];
  alertEl.classList.add('show');

  // Rare chance (~18%) a human interceptor comes to shoot it down
  if (Math.random() < 0.18 && !_interceptor) {
    setTimeout(() => _startIntercept(), 1200 + Math.random() * 1500);
  }
}

export function updateUFO(dt) {
  const { exploreMode, started } = _getState();

  // Passive spawn when not in explore mode
  if (!exploreMode && started) {
    _ufoPassive -= dt;
    if (_ufoPassive <= 0) { _ufoPassive = 70 + Math.random()*90; spawnUFO(); }
  }

  if (_ufoActive && _ufoGroup) {
    _ufoLife += dt;
    if (_ufoLife >= _ufoMax) {
      _ufoGroup.visible = false;
      _ufoActive = false;
    } else {
      _ufoGroup.position.addScaledVector(_ufoVel, dt);
      // Slow steady rotation — classic saucer spin
      _ufoGroup.rotation.y += dt * 0.9;
      // Very gentle hover bob
      _ufoGroup.position.y += Math.sin(_ufoLife * 3.8) * _ufoGroup.scale.x * 0.004;
    }
  }

  // Update interceptor and explosion
  _updateIntercept(dt);
  _updateExplosion(dt);

  if (_ufoAlertT > 0) {
    _ufoAlertT -= dt;
    if (_ufoAlertT <= 0) document.getElementById('ufo-alert').classList.remove('show');
  }
}
