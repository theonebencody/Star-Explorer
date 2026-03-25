import * as THREE from 'three';
import * as satellite from 'satellite.js';

let _scene = null, _earthMesh = null;
let _satGroup = null;   // THREE.Group holding all satellite meshes
let _satData = [];       // parsed satellite records
let _satMeshes = [];     // { mesh, satrec, name, type }
let _orbitLines = [];    // orbit path lines
let _loaded = false;
let _visible = false;
let _loading = false;

// Visual constants
const EARTH_VIS_R = 0.015;  // AU — must match constants.js Earth rVis
const EARTH_REAL_R = 6371;  // km

// Satellite categories
const SAT_TYPES = {
  STATION: 'station',
  ACTIVE: 'active',
  STARLINK: 'starlink',
};

// Visual config per type
const TYPE_CONFIG = {
  [SAT_TYPES.STATION]: { color: 0xffd700, size: 0.001, showOrbit: true },
  [SAT_TYPES.ACTIVE]:  { color: 0xffffff, size: 0.0006, showOrbit: false },
  [SAT_TYPES.STARLINK]:{ color: 0x88aacc, size: 0.0003, showOrbit: false },
};

// Names of satellites that get orbit lines drawn
const ORBIT_NAMES = new Set([
  'ISS (ZARYA)', 'ISS', 'HST', 'HUBBLE SPACE TELESCOPE',
  'TIANGONG', 'CSS (TIANHE)',
]);

// ─────────────────────────────────────────────
//  INIT
// ─────────────────────────────────────────────

export function initSatellites(scene, earthMesh) {
  _scene = scene;
  _earthMesh = earthMesh;
  _satGroup = new THREE.Group();
  _satGroup.visible = false;
  scene.add(_satGroup);
}

// ─────────────────────────────────────────────
//  TOGGLE
// ─────────────────────────────────────────────

export function toggleSatellites() {
  if (_loading) return _visible;

  if (!_loaded) {
    _loading = true;
    _fetchAllSatellites().then(() => {
      _loaded = true;
      _loading = false;
      _visible = true;
      _satGroup.visible = true;
    }).catch(err => {
      console.error('[satellites] fetch failed:', err);
      _loading = false;
    });
    return true; // optimistically report "will be visible"
  }

  _visible = !_visible;
  _satGroup.visible = _visible;
  return _visible;
}

export function isSatellitesVisible() { return _visible; }

// ─────────────────────────────────────────────
//  FETCH
// ─────────────────────────────────────────────

const TLE_URLS = [
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=tle', type: SAT_TYPES.STATION, limit: 50 },
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle',   type: SAT_TYPES.ACTIVE,  limit: 200 },
  { url: 'https://celestrak.org/NORAD/elements/gp.php?GROUP=starlink&FORMAT=tle',  type: SAT_TYPES.STARLINK, limit: 300 },
];

async function _fetchTLE(urlObj) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(urlObj.url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];
    const text = await res.text();
    return _parseTLE(text, urlObj.type, urlObj.limit);
  } catch (e) {
    clearTimeout(timer);
    console.warn(`[satellites] failed to fetch ${urlObj.type}:`, e.message);
    return [];
  }
}

function _parseTLE(text, type, limit) {
  const lines = text.trim().split('\n');
  const results = [];
  for (let i = 0; i + 2 < lines.length && results.length < limit; i += 3) {
    const name = lines[i].trim();
    const line1 = lines[i + 1].trim();
    const line2 = lines[i + 2].trim();
    // Basic validation: TLE line 1 starts with '1', line 2 with '2'
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) {
      // Might be malformed; try to recover by skipping
      i -= 2; // will be incremented by 3, net +1 — skip one line
      continue;
    }
    try {
      const satrec = satellite.twoline2satrec(line1, line2);
      if (satrec && !satrec.error) {
        results.push({ name, satrec, type });
      }
    } catch (_) {
      // skip bad records
    }
  }
  return results;
}

async function _fetchAllSatellites() {
  const batches = await Promise.all(TLE_URLS.map(u => _fetchTLE(u)));
  _satData = batches.flat();
  _buildMeshes();
}

// ─────────────────────────────────────────────
//  MESH BUILDING
// ─────────────────────────────────────────────

function _buildMeshes() {
  // Separate Starlink (rendered as Points) from named sats (individual meshes)
  const starlinks = _satData.filter(s => s.type === SAT_TYPES.STARLINK);
  const named = _satData.filter(s => s.type !== SAT_TYPES.STARLINK);

  // ── Individual satellite meshes ──
  const sphereGeo = new THREE.SphereGeometry(1, 6, 6);

  for (const sat of named) {
    const cfg = TYPE_CONFIG[sat.type];
    const mat = new THREE.MeshBasicMaterial({ color: cfg.color });
    const mesh = new THREE.Mesh(sphereGeo, mat);
    mesh.scale.setScalar(cfg.size);
    _satGroup.add(mesh);
    const entry = { mesh, satrec: sat.satrec, name: sat.name, type: sat.type };
    _satMeshes.push(entry);

    // Orbit lines for select satellites
    if (cfg.showOrbit || ORBIT_NAMES.has(sat.name.toUpperCase())) {
      _buildOrbitLine(entry);
    }
  }

  // ── Starlink point cloud ──
  if (starlinks.length > 0) {
    const positions = new Float32Array(starlinks.length * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: TYPE_CONFIG[SAT_TYPES.STARLINK].color,
      size: TYPE_CONFIG[SAT_TYPES.STARLINK].size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    _satGroup.add(points);

    for (const sl of starlinks) {
      _satMeshes.push({
        mesh: points,        // shared reference
        satrec: sl.satrec,
        name: sl.name,
        type: sl.type,
        _isStarlink: true,
      });
    }
    // Stash metadata on the Points object for update
    points.userData._starlinkCount = starlinks.length;
  }
}

function _buildOrbitLine(entry) {
  const SEGMENTS = 100;
  const positions = new Float32Array(SEGMENTS * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const isStation = entry.type === SAT_TYPES.STATION;
  const mat = new THREE.LineBasicMaterial({
    color: isStation ? 0xffd700 : 0x6688aa,
    transparent: true,
    opacity: 0.35,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(geo, mat);
  _satGroup.add(line);
  _orbitLines.push({ line, satrec: entry.satrec, positions, segments: SEGMENTS });
}

// ─────────────────────────────────────────────
//  UPDATE (per frame)
// ─────────────────────────────────────────────

const _tmpVec = new THREE.Vector3();
const _earthPos = new THREE.Vector3();

export function updateSatellites(simTime) {
  if (!_visible || !_loaded || _satMeshes.length === 0) return;

  // Convert simTime (year, e.g. 2026.23) to JS Date
  // simTime is years since year 0 in astronomical terms, but in this project
  // it starts at 2026.0. The epoch is J2000 = 2000-01-01T12:00:00 UTC.
  const msPerYear = 365.25 * 86400 * 1000;
  const j2000Ms = Date.UTC(2000, 0, 1, 12, 0, 0);
  const now = new Date(j2000Ms + (simTime - 2000.0) * msPerYear);

  _earthPos.copy(_earthMesh.position);

  // Track starlink index for filling the point buffer
  let starlinkIdx = 0;
  let starlinkPoints = null;
  let starlinkPositions = null;

  for (const entry of _satMeshes) {
    // Propagate
    const pv = satellite.propagate(entry.satrec, now);
    const posEci = pv.position;
    if (!posEci || typeof posEci.x !== 'number') {
      if (entry._isStarlink) {
        // Write a degenerate position so stale data doesn't show
        if (!starlinkPoints) {
          starlinkPoints = entry.mesh;
          starlinkPositions = starlinkPoints.geometry.attributes.position.array;
        }
        starlinkPositions[starlinkIdx * 3] = 0;
        starlinkPositions[starlinkIdx * 3 + 1] = 0;
        starlinkPositions[starlinkIdx * 3 + 2] = 0;
        starlinkIdx++;
      } else {
        entry.mesh.visible = false;
      }
      continue;
    }

    // ECI distance from Earth center (km)
    const distKm = Math.sqrt(posEci.x * posEci.x + posEci.y * posEci.y + posEci.z * posEci.z);
    const orbitAltKm = distKm - EARTH_REAL_R;

    // Exaggerate orbital distance so satellites are visible at solar-system scale.
    // LEO (~400 km) maps to ~1.05 * EARTH_VIS_R; GEO (~35786 km) maps further out.
    const visualDist = EARTH_VIS_R * (1.05 + (orbitAltKm / EARTH_REAL_R) * 2.5);

    // Direction from Earth center in scene coords.
    // ECI: x = vernal equinox, y = 90 deg east in equatorial plane, z = north pole
    // Scene: y = up (north), x/z = ecliptic-ish plane
    _tmpVec.set(posEci.x, posEci.z, posEci.y).normalize();

    const wx = _earthPos.x + _tmpVec.x * visualDist;
    const wy = _earthPos.y + _tmpVec.y * visualDist;
    const wz = _earthPos.z + _tmpVec.z * visualDist;

    if (entry._isStarlink) {
      if (!starlinkPoints) {
        starlinkPoints = entry.mesh;
        starlinkPositions = starlinkPoints.geometry.attributes.position.array;
      }
      starlinkPositions[starlinkIdx * 3] = wx;
      starlinkPositions[starlinkIdx * 3 + 1] = wy;
      starlinkPositions[starlinkIdx * 3 + 2] = wz;
      starlinkIdx++;
    } else {
      entry.mesh.visible = true;
      entry.mesh.position.set(wx, wy, wz);
    }
  }

  // Flush starlink point buffer
  if (starlinkPoints) {
    starlinkPoints.geometry.attributes.position.needsUpdate = true;
  }

  // Update orbit lines
  _updateOrbitLines(now);
}

function _updateOrbitLines(now) {
  _earthPos.copy(_earthMesh.position);

  for (const ol of _orbitLines) {
    const periodMin = (2 * Math.PI) / ol.satrec.no; // orbital period in minutes
    const stepMin = periodMin / ol.segments;

    for (let i = 0; i < ol.segments; i++) {
      const t = new Date(now.getTime() + i * stepMin * 60000);
      const pv = satellite.propagate(ol.satrec, t);
      const p = pv.position;
      if (!p || typeof p.x !== 'number') {
        ol.positions[i * 3] = ol.positions[i * 3 + 1] = ol.positions[i * 3 + 2] = 0;
        continue;
      }
      const distKm = Math.sqrt(p.x * p.x + p.y * p.y + p.z * p.z);
      const altKm = distKm - EARTH_REAL_R;
      const vd = EARTH_VIS_R * (1.05 + (altKm / EARTH_REAL_R) * 2.5);
      _tmpVec.set(p.x, p.z, p.y).normalize();
      ol.positions[i * 3]     = _earthPos.x + _tmpVec.x * vd;
      ol.positions[i * 3 + 1] = _earthPos.y + _tmpVec.y * vd;
      ol.positions[i * 3 + 2] = _earthPos.z + _tmpVec.z * vd;
    }
    ol.line.geometry.attributes.position.needsUpdate = true;
  }
}
