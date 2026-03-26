// Flight Profile Data — defines each rocket's flight stages and milestones
// Extensible: add new rockets by creating additional profile objects

export const STARSHIP_PROFILE = {
  id: 'starship',
  name: 'SpaceX Starship / Super Heavy',
  image: '/Infinita/images/starship.jpg',
  totalHeight: 121, // meters
  maxAlt: 200,      // km target orbit
  maxTime: 540,     // seconds total mission

  stages: [
    {
      id: 'superheavy',
      name: 'Super Heavy Booster',
      heightPct: [0, 58.7],   // % of total rocket height
      color: '#c0c0c8',
      glowColor: '#0ef',
      details: [
        { label: 'Engines', value: '33 Raptor 2' },
        { label: 'Thrust', value: '74,400 kN' },
        { label: 'Propellant', value: 'CH₄ + LOX (3,400 t)' },
        { label: 'Burn Time', value: '~170 s' },
        { label: 'Height', value: '71 m' },
      ]
    },
    {
      id: 'ship',
      name: 'Starship (Ship)',
      heightPct: [58.7, 100],
      color: '#d0d0d8',
      glowColor: '#00ff88',
      details: [
        { label: 'Engines', value: '3 SL + 3 Vacuum Raptors' },
        { label: 'Thrust', value: '14,700 kN' },
        { label: 'Propellant', value: 'CH₄ + LOX (1,200 t)' },
        { label: 'Burn Time', value: '~360 s' },
        { label: 'Height', value: '50 m' },
      ]
    }
  ],

  milestones: [
    {
      t: 0, alt: 0, vel: 0,
      label: 'LIFTOFF',
      stage: 'superheavy',
      desc: 'All 33 Raptor engines ignite simultaneously, generating 74,400 kN of thrust — more than twice the thrust of the Saturn V. The fully stacked vehicle weighs approximately 5,000 tonnes.',
      short: 'All engines ignition. 5,000 tonnes lifting off.',
    },
    {
      t: 62, alt: 12, vel: 343,
      label: 'MAX Q',
      stage: 'superheavy',
      desc: 'Maximum dynamic pressure — the point of greatest aerodynamic stress on the vehicle. The combination of increasing speed and decreasing air density peaks here at approximately 12 km altitude.',
      short: 'Peak aerodynamic stress at 12 km.',
    },
    {
      t: 173, alt: 68, vel: 2250,
      label: 'HOT-STAGE & SEPARATION',
      stage: 'both',
      desc: 'At T+2:50, booster engines cut off (MECO). Three seconds later, Starship\'s engines ignite while still attached — hot-staging. The ship separates and the booster begins its return. All within 10 seconds.',
      short: 'MECO → hot-stage → separation in rapid sequence.',
    },
    {
      t: 240, alt: 95, vel: 3800,
      label: 'BOOSTER CATCH',
      stage: 'booster-return',
      desc: 'Super Heavy flips, performs a boostback burn, then a landing burn targeting the Mechazilla tower\'s chopstick arms for a mid-air catch. Meanwhile, Starship continues accelerating toward orbit.',
      short: 'Booster returns for tower catch. Ship presses on.',
    },
    {
      t: 530, alt: 200, vel: 7800,
      label: 'ORBIT INSERTION',
      stage: 'orbit',
      desc: 'Ship Engine Cutoff at orbital velocity of 7.8 km/s. Starship is now in a 200 km low Earth orbit. The payload door opens to deploy satellites or prepare for the next mission phase.',
      short: 'Orbital velocity achieved. Mission success.',
    },
  ],

  // Physics constants for simulation
  physics: {
    booster: {
      dryMass: 200000, propMass: 3400000,
      raptorThrust: 2256, defaultEngines: 33,
      isp_sl: 327, isp_vac: 356, burnTime: 170,
    },
    ship: {
      dryMass: 100000, propMass: 1200000,
      raptorSL: 3, raptorVac: 3,
      thrustSL: 2256, thrustVac: 2490,
      isp_sl: 327, isp_vac: 380, burnTime: 360,
    },
  }
};

// Function to seek physics state to a given time
export function seekToTime(targetT, profile) {
  const p = profile.physics;
  const g0 = 9.81;
  const dt = 0.5; // coarse step for seeking
  let t = 0, alt = 0, vel = 0, accel = 0, downrange = 0;
  let boosterFuel = 100, shipFuel = 100;
  let stage = 'booster', pitchAngle = 90;

  const nBooster = p.booster.defaultEngines;
  const nSL = p.ship.raptorSL;
  const nVac = p.ship.raptorVac;
  const payloadKg = 50000; // default 50t

  while (t < targetT) {
    const step = Math.min(dt, targetT - t);
    t += step;

    const gAlt = g0 * Math.pow(6371 / (6371 + alt), 2);
    const rho = Math.exp(-alt / 8.5);
    const dragAccel = Math.min(0.5 * rho * vel * vel * 0.000003, 5 * g0);

    if (t < 200) pitchAngle = 90 - (80 * Math.min(t / 200, 1) * Math.min(t / 200, 1));
    else pitchAngle = Math.max(5, 10 - (t - 200) * 0.01);
    const pitchRad = pitchAngle * Math.PI / 180;

    let thrustAccel = 0;

    if (stage === 'booster' && boosterFuel > 0) {
      const thrustN = nBooster * p.booster.raptorThrust * 1000;
      const fuelFrac = boosterFuel / 100;
      const mass = p.booster.dryMass + p.booster.propMass * fuelFrac + p.ship.dryMass + p.ship.propMass + payloadKg;
      thrustAccel = thrustN / mass;
      const massFlow = thrustN / (p.booster.isp_sl * g0);
      boosterFuel -= (massFlow * step / p.booster.propMass) * 100;
      if (boosterFuel <= 0) boosterFuel = 0;
      if (t >= p.booster.burnTime || boosterFuel <= 0) stage = 'hot-stage';
    } else if (stage === 'hot-stage') {
      const shipThrust = (nSL * p.ship.thrustSL + nVac * p.ship.thrustVac) * 1000;
      const mass = p.ship.dryMass + p.ship.propMass * (shipFuel/100) + payloadKg + p.booster.dryMass;
      thrustAccel = shipThrust / mass;
      const massFlow = shipThrust / (p.ship.isp_vac * g0);
      shipFuel -= (massFlow * step / p.ship.propMass) * 100;
      if (t >= p.booster.burnTime + 6) stage = 'ship';
    } else if (stage === 'ship' && shipFuel > 0) {
      const vacFrac = Math.min(1, alt / 100);
      const totalThrust = (nSL * p.ship.thrustSL * (1 - vacFrac * 0.15) + nVac * p.ship.thrustVac) * 1000;
      const mass = p.ship.dryMass + p.ship.propMass * (shipFuel/100) + payloadKg;
      thrustAccel = totalThrust / mass;
      const avgIsp = (nSL * p.ship.isp_sl * (1 - vacFrac * 0.15) + nVac * p.ship.isp_vac) / (nSL + nVac);
      const massFlow = totalThrust / (avgIsp * g0);
      shipFuel -= (massFlow * step / p.ship.propMass) * 100;
      if (shipFuel <= 0) { shipFuel = 0; stage = 'coast'; }
    }

    const netAccel = thrustAccel - gAlt * Math.sin(pitchRad) - dragAccel;
    accel = thrustAccel / g0;
    vel += netAccel * step;
    if (vel < 0) vel = 0;
    alt += (vel * Math.sin(pitchRad) * step) / 1000;
    downrange += (vel * Math.cos(pitchRad) * step) / 1000;

    if (alt >= 200 && vel >= 7500) { stage = 'orbit'; break; }
  }

  return { t, alt, vel, accel, downrange, boosterFuel, shipFuel, stage, pitchAngle };
}
