// audioEngine.js — Procedural audio system for Universe Explorer
// Uses Web Audio API exclusively, no external dependencies.

let ctx = null;       // AudioContext
let master = null;    // master GainNode
let masterVol = 0.3;

// Active node groups, keyed by purpose so we can tear them down cleanly.
let ambient = null;
let simAmbient = null;
let historyAmbient = null;
let warpNodes = null;
let rumbleNodes = null;

// ── helpers ─────────────────────────────────────────────────────────────

function now() { return ctx.currentTime; }

function createNoiseBuffer(seconds = 2) {
  const len = ctx.sampleRate * seconds;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function makeNoise(loop = true) {
  const src = ctx.createBufferSource();
  src.buffer = createNoiseBuffer();
  src.loop = loop;
  return src;
}

function fadeIn(gain, target, duration) {
  gain.gain.setValueAtTime(0.0001, now());
  gain.gain.linearRampToValueAtTime(target, now() + duration);
}

function fadeOut(gain, duration) {
  gain.gain.setValueAtTime(gain.gain.value, now());
  gain.gain.linearRampToValueAtTime(0.0001, now() + duration);
}

function stopAndDisconnect(nodes, fadeTime = 0.5) {
  if (!nodes) return;
  const sources = nodes.sources || [];
  const gains = nodes.gains || [];
  const all = nodes.all || [];

  gains.forEach(g => fadeOut(g, fadeTime));

  setTimeout(() => {
    sources.forEach(s => { try { s.stop(); } catch (_) { /* already stopped */ } });
    all.forEach(n => { try { n.disconnect(); } catch (_) { /* ok */ } });
  }, (fadeTime + 0.1) * 1000);
}

// ── public API ──────────────────────────────────────────────────────────

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = masterVol;
  master.connect(ctx.destination);

  // Handle suspended state
  if (ctx.state === 'suspended') ctx.resume();
}

export function setMasterVolume(v) {
  masterVol = Math.max(0, Math.min(1, v));
  if (master) master.gain.setValueAtTime(masterVol, now());
}

// ── Ambient Space Drone (explore mode) ──────────────────────────────────

export function startAmbient() {
  if (!ctx || ambient) return;
  const nodes = { sources: [], gains: [], all: [] };

  // Sub oscillators — detuned sines / triangles
  const freqs = [48, 60, 72];
  const types = ['sine', 'triangle', 'sine'];
  const detunes = [0, -8, 5];

  const mixGain = ctx.createGain();
  mixGain.gain.value = 0;
  mixGain.connect(master);
  nodes.gains.push(mixGain);
  nodes.all.push(mixGain);

  freqs.forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = types[i];
    osc.frequency.value = f;
    osc.detune.value = detunes[i];

    const g = ctx.createGain();
    g.gain.value = 0.12;

    osc.connect(g).connect(mixGain);
    osc.start();
    nodes.sources.push(osc);
    nodes.all.push(osc, g);
  });

  // Slow LFO on first oscillator amplitude
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.07; // very slow
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.04;
  lfo.connect(lfoGain).connect(nodes.all[1].gain); // modulate first osc gain
  lfo.start();
  nodes.sources.push(lfo);
  nodes.all.push(lfo, lfoGain);

  // Slow filter sweep oscillator
  const sweepOsc = ctx.createOscillator();
  sweepOsc.type = 'triangle';
  sweepOsc.frequency.value = 55;
  const sweepFilter = ctx.createBiquadFilter();
  sweepFilter.type = 'lowpass';
  sweepFilter.Q.value = 2;
  // Sweep cutoff 100–400Hz over ~20s
  const sweepLFO = ctx.createOscillator();
  sweepLFO.type = 'sine';
  sweepLFO.frequency.value = 0.05; // 20s cycle
  const sweepLFOGain = ctx.createGain();
  sweepLFOGain.gain.value = 150;
  sweepLFO.connect(sweepLFOGain).connect(sweepFilter.frequency);
  sweepFilter.frequency.value = 250;
  const sweepGain = ctx.createGain();
  sweepGain.gain.value = 0.08;
  sweepOsc.connect(sweepFilter).connect(sweepGain).connect(mixGain);
  sweepOsc.start();
  sweepLFO.start();
  nodes.sources.push(sweepOsc, sweepLFO);
  nodes.all.push(sweepOsc, sweepFilter, sweepLFO, sweepLFOGain, sweepGain);

  // Filtered noise texture
  const noise = makeNoise();
  const noiseBP = ctx.createBiquadFilter();
  noiseBP.type = 'bandpass';
  noiseBP.frequency.value = 200;
  noiseBP.Q.value = 1.5;
  const noiseGain = ctx.createGain();
  noiseGain.gain.value = 0.025;
  noise.connect(noiseBP).connect(noiseGain).connect(mixGain);
  noise.start();
  nodes.sources.push(noise);
  nodes.all.push(noise, noiseBP, noiseGain);

  fadeIn(mixGain, 0.6, 3);
  ambient = nodes;
}

export function stopAmbient() {
  stopAndDisconnect(ambient, 2);
  ambient = null;
}

// ── Sim Ambient (launch simulator) ──────────────────────────────────────

export function startSimAmbient() {
  if (!ctx || simAmbient) return;
  const nodes = { sources: [], gains: [], all: [] };

  const mixGain = ctx.createGain();
  mixGain.gain.value = 0;
  mixGain.connect(master);
  nodes.gains.push(mixGain);
  nodes.all.push(mixGain);

  // Base drone — similar to ambient but slightly darker
  const osc1 = ctx.createOscillator();
  osc1.type = 'sine';
  osc1.frequency.value = 45;
  const osc2 = ctx.createOscillator();
  osc2.type = 'triangle';
  osc2.frequency.value = 67;
  osc2.detune.value = -6;

  [osc1, osc2].forEach(o => {
    const g = ctx.createGain();
    g.gain.value = 0.1;
    o.connect(g).connect(mixGain);
    o.start();
    nodes.sources.push(o);
    nodes.all.push(o, g);
  });

  // Rhythmic pulse — amplitude modulation at 0.5Hz
  const pulseLFO = ctx.createOscillator();
  pulseLFO.type = 'sine';
  pulseLFO.frequency.value = 0.5;
  const pulseDepth = ctx.createGain();
  pulseDepth.gain.value = 0.04;
  pulseLFO.connect(pulseDepth).connect(mixGain.gain);
  pulseLFO.start();
  nodes.sources.push(pulseLFO);
  nodes.all.push(pulseLFO, pulseDepth);

  // High-frequency shimmer — filtered noise at ~2kHz
  const shimmer = makeNoise();
  const shimmerBP = ctx.createBiquadFilter();
  shimmerBP.type = 'bandpass';
  shimmerBP.frequency.value = 2000;
  shimmerBP.Q.value = 3;
  const shimmerGain = ctx.createGain();
  shimmerGain.gain.value = 0.012;
  shimmer.connect(shimmerBP).connect(shimmerGain).connect(mixGain);
  shimmer.start();
  nodes.sources.push(shimmer);
  nodes.all.push(shimmer, shimmerBP, shimmerGain);

  fadeIn(mixGain, 0.5, 3);
  simAmbient = nodes;
}

export function stopSimAmbient() {
  stopAndDisconnect(simAmbient, 2);
  simAmbient = null;
}

// ── History Ambient ─────────────────────────────────────────────────────

export function startHistoryAmbient() {
  if (!ctx || historyAmbient) return;
  const nodes = { sources: [], gains: [], all: [] };

  const mixGain = ctx.createGain();
  mixGain.gain.value = 0;
  mixGain.connect(master);
  nodes.gains.push(mixGain);
  nodes.all.push(mixGain);

  // Warm triangle at 60Hz
  const osc1 = ctx.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.value = 60;
  const g1 = ctx.createGain();
  g1.gain.value = 0.1;
  osc1.connect(g1).connect(mixGain);
  osc1.start();

  // Gentle sine at 90Hz
  const osc2 = ctx.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = 90;
  const g2 = ctx.createGain();
  g2.gain.value = 0.07;
  osc2.connect(g2).connect(mixGain);
  osc2.start();

  // Slow gentle LFO for warmth
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = 0.04;
  const lfoG = ctx.createGain();
  lfoG.gain.value = 3;
  lfo.connect(lfoG).connect(osc2.frequency);
  lfo.start();

  nodes.sources.push(osc1, osc2, lfo);
  nodes.all.push(osc1, g1, osc2, g2, lfo, lfoG);

  fadeIn(mixGain, 0.45, 3);
  historyAmbient = nodes;
}

export function stopHistoryAmbient() {
  stopAndDisconnect(historyAmbient, 2);
  historyAmbient = null;
}

// ── Warp / Travel Sound ─────────────────────────────────────────────────

export function playWarp(intensity) {
  if (!ctx) return;
  const t = Math.max(0, Math.min(1, intensity));

  if (!warpNodes) {
    const nodes = { sources: [], gains: [], all: [] };

    const mixGain = ctx.createGain();
    mixGain.gain.value = 0;
    mixGain.connect(master);
    nodes.gains.push(mixGain);
    nodes.all.push(mixGain);

    // Filtered white noise
    const noise = makeNoise();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 200;
    bp.Q.value = 1;
    const noiseG = ctx.createGain();
    noiseG.gain.value = 0.35;
    noise.connect(bp).connect(noiseG).connect(mixGain);
    noise.start();
    nodes.sources.push(noise);
    nodes.all.push(noise, bp, noiseG);
    nodes.filter = bp;

    // Low sine oscillator
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 50;
    const oscG = ctx.createGain();
    oscG.gain.value = 0.2;
    osc.connect(oscG).connect(mixGain);
    osc.start();
    nodes.sources.push(osc);
    nodes.all.push(osc, oscG);
    nodes.osc = osc;

    warpNodes = nodes;
  }

  // Update parameters based on intensity
  const mix = warpNodes.gains[0];
  mix.gain.setValueAtTime(t * 0.55, now());

  warpNodes.filter.frequency.setValueAtTime(200 + t * 3800, now());
  warpNodes.filter.Q.setValueAtTime(1 + t * 8, now());

  warpNodes.osc.frequency.setValueAtTime(50 + t * 150, now());
}

export function stopWarp() {
  stopAndDisconnect(warpNodes, 0.5);
  warpNodes = null;
}

// ── Rocket Launch Rumble ────────────────────────────────────────────────

let crackleTimer = null;

export function playLaunchRumble(thrust) {
  if (!ctx) return;
  const t = Math.max(0, Math.min(1, thrust));

  if (!rumbleNodes) {
    const nodes = { sources: [], gains: [], all: [] };

    const mixGain = ctx.createGain();
    mixGain.gain.value = 0;
    mixGain.connect(master);
    nodes.gains.push(mixGain);
    nodes.all.push(mixGain);

    // Low-frequency rumble noise
    const noise = makeNoise();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 150;
    lp.Q.value = 1;
    const noiseG = ctx.createGain();
    noiseG.gain.value = 0.5;
    noise.connect(lp).connect(noiseG).connect(mixGain);
    noise.start();
    nodes.sources.push(noise);
    nodes.all.push(noise, lp, noiseG);

    // Sawtooth engine harmonic
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = 35;
    const sawLP = ctx.createBiquadFilter();
    sawLP.type = 'lowpass';
    sawLP.frequency.value = 120;
    const sawG = ctx.createGain();
    sawG.gain.value = 0.15;
    saw.connect(sawLP).connect(sawG).connect(mixGain);
    saw.start();
    nodes.sources.push(saw);
    nodes.all.push(saw, sawLP, sawG);
    nodes.saw = saw;

    // Build up over 2s
    mixGain.gain.setValueAtTime(0.0001, now());
    mixGain.gain.linearRampToValueAtTime(t * 0.7, now() + 2);

    // Crackle — short noise bursts at random intervals
    const noiseBuf = createNoiseBuffer(0.04);
    function scheduleCrackle() {
      if (!rumbleNodes) return;
      const burst = ctx.createBufferSource();
      burst.buffer = noiseBuf;
      const bG = ctx.createGain();
      bG.gain.value = 0.12 * t;
      burst.connect(bG).connect(mixGain);
      burst.start();
      crackleTimer = setTimeout(scheduleCrackle, 40 + Math.random() * 160);
    }
    crackleTimer = setTimeout(scheduleCrackle, 100);

    rumbleNodes = nodes;
    return;
  }

  // Update existing rumble
  const mix = rumbleNodes.gains[0];
  mix.gain.setValueAtTime(t * 0.7, now());
  rumbleNodes.saw.frequency.setValueAtTime(30 + t * 20, now());
}

export function stopLaunchRumble() {
  if (crackleTimer) { clearTimeout(crackleTimer); crackleTimer = null; }
  stopAndDisconnect(rumbleNodes, 0.8);
  rumbleNodes = null;
}

// ── One-shot: Explosion ─────────────────────────────────────────────────

export function playExplosion() {
  if (!ctx) return;
  const t0 = now();

  // Noise burst with decaying lowpass
  const noise = makeNoise(false);
  noise.buffer = createNoiseBuffer(1);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.setValueAtTime(5000, t0);
  lp.frequency.exponentialRampToValueAtTime(200, t0 + 0.8);
  const noiseG = ctx.createGain();
  noiseG.gain.setValueAtTime(0.7, t0);
  noiseG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.8);
  noise.connect(lp).connect(noiseG).connect(master);
  noise.start(t0);
  noise.stop(t0 + 0.85);

  // Sub-bass thump
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = 40;
  const subG = ctx.createGain();
  subG.gain.setValueAtTime(0.6, t0);
  subG.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
  sub.connect(subG).connect(master);
  sub.start(t0);
  sub.stop(t0 + 0.55);
}

// ── One-shot: Arrival Chime ─────────────────────────────────────────────

export function playArrival() {
  if (!ctx) return;
  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  const noteDur = 0.15;
  const gap = 0.1;
  const t0 = now();

  notes.forEach((freq, i) => {
    const start = t0 + i * (noteDur + gap);

    // Main tone
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.linearRampToValueAtTime(0.25, start + 0.02);   // attack
    g.gain.setValueAtTime(0.25, start + noteDur - 0.01);
    g.gain.linearRampToValueAtTime(0.0001, start + noteDur + 0.3); // release
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + noteDur + 0.35);

    // Delayed quiet copy (reverb feel)
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = freq;
    const g2 = ctx.createGain();
    const delayStart = start + 0.08;
    g2.gain.setValueAtTime(0.0001, delayStart);
    g2.gain.linearRampToValueAtTime(0.08, delayStart + 0.02);
    g2.gain.linearRampToValueAtTime(0.0001, delayStart + noteDur + 0.4);
    osc2.connect(g2).connect(master);
    osc2.start(delayStart);
    osc2.stop(delayStart + noteDur + 0.45);
  });
}

// ── One-shot: UI Click ──────────────────────────────────────────────────

export function playUIClick() {
  if (!ctx) return;
  const t0 = now();
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = 1200;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.15, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.06);
}

// ── One-shot: Countdown Beep ────────────────────────────────────────────

export function playCountdown(n) {
  if (!ctx) return;
  const t0 = now();

  // n = seconds remaining. 10 → 600Hz, 1 → 1200Hz, 0 → 1500Hz special
  const isZero = n <= 0;
  const freq = isZero ? 1500 : 600 + (1200 - 600) * ((10 - Math.max(1, n)) / 9);
  const dur = isZero ? 0.3 : 0.1;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.3, t0);
  g.gain.setValueAtTime(0.3, t0 + dur * 0.7);
  g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.01);
}
