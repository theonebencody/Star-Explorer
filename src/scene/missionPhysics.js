// Mission Physics — Hohmann transfer calculator, delta-v budgeting, feasibility checks
// Uses real orbital mechanics for interplanetary mission planning

const MU_SUN = 1.327e20; // gravitational parameter of Sun (m³/s²)
const AU_M = 1.496e11;   // 1 AU in meters
const DAY_S = 86400;

/**
 * Hohmann transfer between two circular orbits around the Sun.
 * Returns { dv1, dv2, dvTotal, transferTime, a_transfer }
 *   dv1/dv2 in km/s, transferTime in days, a_transfer in AU
 */
export function hohmannTransfer(r1_au, r2_au) {
  const r1 = r1_au * AU_M;
  const r2 = r2_au * AU_M;

  // Semi-major axis of transfer ellipse
  const a_t = (r1 + r2) / 2;

  // Circular velocities
  const v1_circ = Math.sqrt(MU_SUN / r1);
  const v2_circ = Math.sqrt(MU_SUN / r2);

  // Transfer orbit velocities at departure and arrival
  const v1_transfer = Math.sqrt(MU_SUN * (2 / r1 - 1 / a_t));
  const v2_transfer = Math.sqrt(MU_SUN * (2 / r2 - 1 / a_t));

  // Delta-v at each burn
  const dv1 = Math.abs(v1_transfer - v1_circ);
  const dv2 = Math.abs(v2_circ - v2_transfer);

  // Transfer time (half-period of transfer ellipse)
  const T_transfer = Math.PI * Math.sqrt(Math.pow(a_t, 3) / MU_SUN);

  return {
    dv1: dv1 / 1000,          // km/s
    dv2: dv2 / 1000,          // km/s
    dvTotal: (dv1 + dv2) / 1000,
    transferDays: T_transfer / DAY_S,
    a_transfer: a_t / AU_M,
  };
}

/**
 * Earth escape delta-v from LEO (200 km) to reach the required
 * hyperbolic excess velocity for an interplanetary transfer.
 *   v_inf: hyperbolic excess velocity in km/s (= dv1 from hohmann)
 * Returns total delta-v from LEO in km/s (Earth escape + injection)
 */
export function earthEscapeDV(v_inf_kms) {
  const MU_EARTH = 3.986e14; // m³/s²
  const r_LEO = 6571000;     // 200 km altitude
  const v_LEO = Math.sqrt(MU_EARTH / r_LEO); // ~7.78 km/s
  const v_inf = v_inf_kms * 1000; // m/s

  // Velocity needed at LEO altitude for hyperbolic escape
  const v_escape = Math.sqrt(v_inf * v_inf + 2 * MU_EARTH / r_LEO);
  const dv = (v_escape - Math.sqrt(MU_EARTH / r_LEO)) / 1000;
  return dv; // km/s
}

/**
 * Full mission delta-v budget for a single-leg transfer.
 * stopType: 'flyby' | 'orbit' | 'landing'
 */
export function missionDeltaV(origin_au, dest_au, stopType) {
  const transfer = hohmannTransfer(origin_au, dest_au);

  // Earth escape from LEO
  const escDV = earthEscapeDV(transfer.dv1);

  // Arrival delta-v depends on stop type
  let arrivalDV = 0;
  if (stopType === 'orbit') {
    arrivalDV = transfer.dv2; // orbital insertion burn
  } else if (stopType === 'landing') {
    arrivalDV = transfer.dv2 * 1.5; // orbit insertion + descent (rough estimate)
  }
  // flyby = 0 arrival dv

  return {
    escapeDV: escDV,
    transferDV: transfer.dv1,
    arrivalDV,
    totalDV: escDV + arrivalDV,
    transferDays: transfer.transferDays,
    a_transfer: transfer.a_transfer,
    hohmann: transfer,
  };
}

/**
 * Check if a rocket can complete the mission.
 * Returns { feasible, margin, dvRequired, dvAvailable }
 */
export function checkFeasibility(rocket, missionBudget) {
  const dvAvailable = rocket.deltaV_max;
  const dvRequired = missionBudget.totalDV;
  const margin = dvAvailable - dvRequired;
  return {
    feasible: margin >= 0,
    margin,
    dvRequired,
    dvAvailable,
    marginPct: (margin / dvAvailable) * 100,
  };
}

/**
 * Generate transfer orbit points for 3D visualization.
 * Returns array of { x, z } positions in AU for the transfer ellipse.
 */
export function transferOrbitPoints(r1_au, r2_au, numPoints = 100) {
  const a = (r1_au + r2_au) / 2;
  const c = Math.abs(r2_au - r1_au) / 2; // distance from center to focus
  const e = c / a;
  const points = [];

  // Transfer is half an ellipse (0 to π)
  for (let i = 0; i <= numPoints; i++) {
    const theta = (i / numPoints) * Math.PI;
    const r = a * (1 - e * e) / (1 + e * Math.cos(theta));
    // In the orbital plane, with departure at theta=0
    const x = r * Math.cos(theta);
    const z = r * Math.sin(theta);
    points.push({ x, z });
  }

  return points;
}

/**
 * Get position along transfer orbit at given progress (0-1).
 * Returns { x, z } in AU.
 */
export function transferPosition(r1_au, r2_au, progress) {
  const a = (r1_au + r2_au) / 2;
  const c = Math.abs(r2_au - r1_au) / 2;
  const e = c / a;

  // Mean anomaly from progress
  const M = progress * Math.PI;

  // Solve Kepler's equation
  let E = M;
  for (let i = 0; i < 20; i++) {
    E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  }

  // True anomaly
  const cosTheta = (Math.cos(E) - e) / (1 - e * Math.cos(E));
  const sinTheta = Math.sqrt(1 - e * e) * Math.sin(E) / (1 - e * Math.cos(E));
  const r = a * (1 - e * Math.cos(E));

  return {
    x: r * cosTheta,
    z: r * sinTheta,
  };
}

/**
 * Format days into human-readable duration.
 */
export function formatDuration(days) {
  if (days < 1) return `${Math.round(days * 24)} hours`;
  if (days < 30) return `${Math.round(days)} days`;
  if (days < 365) return `${(days / 30).toFixed(1)} months`;
  if (days < 365 * 2) return `${(days / 365).toFixed(1)} years`;
  return `${Math.round(days / 365)} years`;
}
