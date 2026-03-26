// Pre-planned mission templates and rocket catalog for Mission Planner

export const ROCKET_CATALOG = [
  {
    id: 'starship', name: 'Starship', company: 'SpaceX',
    payload_LEO: 150000, deltaV_max: 9.5, isp_vac: 380,
    desc: 'Super heavy-lift. Can reach Mars with refueling.',
    color: '#ccc'
  },
  {
    id: 'falcon-heavy', name: 'Falcon Heavy', company: 'SpaceX',
    payload_LEO: 63800, deltaV_max: 12.5, isp_vac: 348,
    desc: 'Heavy-lift. Capable of deep space missions.',
    color: '#aab'
  },
  {
    id: 'falcon-9', name: 'Falcon 9', company: 'SpaceX',
    payload_LEO: 22800, deltaV_max: 9.4, isp_vac: 348,
    desc: 'Medium-lift workhorse. LEO and GTO missions.',
    color: '#aab'
  },
  {
    id: 'sls', name: 'SLS Block 1', company: 'NASA',
    payload_LEO: 95000, deltaV_max: 11.5, isp_vac: 452,
    desc: 'Super heavy-lift for deep space exploration.',
    color: '#f80'
  },
  {
    id: 'new-glenn', name: 'New Glenn', company: 'Blue Origin',
    payload_LEO: 45000, deltaV_max: 10.2, isp_vac: 320,
    desc: 'Heavy-lift with reusable first stage.',
    color: '#48f'
  },
  {
    id: 'ariane-6', name: 'Ariane 6', company: 'ESA',
    payload_LEO: 21650, deltaV_max: 9.8, isp_vac: 457,
    desc: 'European heavy-lift launcher.',
    color: '#0cf'
  },
];

export const DESTINATION_BODIES = [
  { name: 'Moon', a: 0.00257, type: 'moon', parent: 'Earth', dv_from_earth: 6.0, transferDays: 3, color: '#aaa' },
  { name: 'Mars', a: 1.524, type: 'planet', dv_from_earth: 5.7, transferDays: 259, color: '#c44' },
  { name: 'Venus', a: 0.723, type: 'planet', dv_from_earth: 3.5, transferDays: 146, color: '#da8' },
  { name: 'Mercury', a: 0.387, type: 'planet', dv_from_earth: 7.5, transferDays: 105, color: '#887' },
  { name: 'Jupiter', a: 5.203, type: 'planet', dv_from_earth: 8.8, transferDays: 998, color: '#ca8' },
  { name: 'Saturn', a: 9.537, type: 'planet', dv_from_earth: 10.3, transferDays: 2210, color: '#dc8' },
  { name: 'Uranus', a: 19.19, type: 'planet', dv_from_earth: 11.3, transferDays: 5830, color: '#7bc' },
  { name: 'Neptune', a: 30.07, type: 'planet', dv_from_earth: 12.1, transferDays: 11070, color: '#45b' },
];

export const MISSION_TEMPLATES = [
  {
    id: 'apollo11',
    name: 'Apollo 11 — First Moon Landing',
    icon: '\uD83C\uDF19',
    rocketId: 'sls',
    destination: 'Moon',
    stopType: 'landing',
    stayDays: 1,
    desc: 'Relive humanity\'s greatest achievement. Land on the Moon and return safely.',
    facts: ['First humans on the Moon', '600 million watched on TV', '21 hours on the surface'],
    historicalDeltaV: 15.9,
    historicalTransferDays: 3,
  },
  {
    id: 'starship-mars',
    name: 'Starship Mars Colony',
    icon: '\uD83D\uDD34',
    rocketId: 'starship',
    destination: 'Mars',
    stopType: 'landing',
    stayDays: 500,
    desc: 'The future of humanity. Establish a permanent presence on Mars.',
    facts: ['~9 month transit', 'Requires orbital refueling', '500 day surface stay for return window'],
    historicalDeltaV: 5.7,
    historicalTransferDays: 259,
  },
  {
    id: 'voyager-grand-tour',
    name: 'Voyager Grand Tour',
    icon: '\uD83D\uDE80',
    rocketId: 'falcon-heavy',
    destination: 'Neptune',
    stopType: 'flyby',
    stayDays: 0,
    desc: 'Visit all four outer planets using gravity assists. A once-in-175-year alignment.',
    facts: ['Only spacecraft to visit all 4 outer planets', 'Now in interstellar space', '12+ year journey'],
    historicalDeltaV: 16.0,
    historicalTransferDays: 4392,
  },
  {
    id: 'shuttle-iss',
    name: 'Space Shuttle to ISS',
    icon: '\uD83D\uDEF0',
    rocketId: 'falcon-9',
    destination: 'Moon',
    stopType: 'orbit',
    stayDays: 14,
    desc: 'Classic mission to low Earth orbit. Dock with the International Space Station.',
    facts: ['135 Shuttle missions flew', 'ISS orbits at 408 km', '90 minutes per orbit'],
    historicalDeltaV: 9.4,
    historicalTransferDays: 0.01,
  },
  {
    id: 'europa-clipper',
    name: 'Europa Clipper',
    icon: '\uD83E\uDE90',
    rocketId: 'falcon-heavy',
    destination: 'Jupiter',
    stopType: 'orbit',
    stayDays: 1460,
    desc: 'Explore Jupiter\'s icy moon Europa. Search for conditions suitable for life.',
    facts: ['49 close flybys of Europa planned', 'Launched Oct 2024 on Falcon Heavy', 'Europa may have a subsurface ocean'],
    historicalDeltaV: 8.8,
    historicalTransferDays: 1950,
  },
];
