// main.js — composition root: canvas setup, module wiring, render loop,
// UI (practice button, vitality bar), persistence, and the dev-only debug
// panel. All cross-module wiring lives here — modules never reach into each
// other. The audio/ and creature/ layers stay pure.

import { createMicInput } from './audio/mic-input.js';
import { detectPitch } from './audio/pitch-detect.js';
import { createSession } from './creature/session.js';
import { createAgeClock, stageForAge } from './creature/age-clock.js';
import { createVitality, VITALITY_MAX, DAILY_PRACTICE_TARGET_S } from './creature/vitality.js';
import { createMood } from './creature/mood.js';
import { createEvolution } from './creature/evolution.js';
import { createExpression } from './creature/expression.js';
import { LOGICAL_WIDTH, LOGICAL_HEIGHT, drawFace, drawEnclosureMask } from './creature/eyes-renderer.js';

const CELEBRATION_MIN_GAINED_S = 1;  // don't celebrate a session with nothing played
const MAX_FRAME_DT_S = 0.1;          // clamp dt after tab-away so nothing jumps
const PROMPT_HELP_AFTER_S = 8;       // nudge toward the address bar if the prompt sits unanswered
const SAVE_KEY = 'practice-creature-v2';
const OLD_SAVE_KEY = 'practice-creature-v1'; // pre-life-system save — cleared
const SAVE_INTERVAL_S = 5;
const DEFAULT_HINT = 'click practice (or press space), then play';
const DENIED_HELP = 'microphone blocked — click the mic icon in the address bar, choose Allow, then reload';

const canvas = document.getElementById('creature-canvas');
const ctx = canvas.getContext('2d');
ctx.scale(canvas.width / LOGICAL_WIDTH, canvas.height / LOGICAL_HEIGHT);

// --- persistence: the creature keeps living (and aging) between visits ----
function loadSaved() {
  try {
    localStorage.removeItem(OLD_SAVE_KEY);
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      age: ageClock.serialize(),
      vitality: vitality.serialize(),
      mood: moodMeter.serialize(),
      evolution: evolution.serialize(),
    }));
  } catch { /* private window etc. — persistence is a nicety */ }
}

const saved = loadSaved();
const mic = createMicInput();
const session = createSession();
const ageClock = createAgeClock(saved ? saved.age : undefined);
const vitality = createVitality(saved ? saved.vitality : undefined);
const moodMeter = createMood(saved ? saved.mood : undefined);
const evolution = createEvolution(saved ? saved.evolution : undefined);
let expression = createExpression();

// --- cross-module wiring (the only place modules meet) --------------------
// Practice is credited to vitality CONTINUOUSLY (every frame of musical
// sound), not at session end — a day boundary crossing mid-session must see
// the practice already done today, or a long session reads as neglect.
let lastCreditedSustained = 0;
function creditPractice() {
  if (session.isSessionActive) {
    const delta = session.sessionSustainedTime - lastCreditedSustained;
    if (delta > 0) vitality.addPracticeTime(delta);
    lastCreditedSustained = session.sessionSustainedTime;
  } else {
    lastCreditedSustained = 0;
  }
}

ageClock.setOnDayBoundary((day) => {
  const { practiced } = vitality.endDay();
  evolution.recordDay(practiced);
  // stages flip exactly at integer-day boundaries, so day N starting is the
  // moment to check: the day that just ended (N-1) belonged to the old stage
  const oldStage = stageForAge(day - 1);
  const newStage = stageForAge(day);
  if (newStage !== oldStage) evolution.onStageTransition(newStage);
});

vitality.setOnDeath(() => {
  if (session.isSessionActive) session.toggle(); // ends quietly, no celebration
  setStatus('your creature has died of neglect — restart to hatch a new egg', true);
});

window.addEventListener('pagehide', saveState);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveState();
});

// --- UI -----------------------------------------------------------------
const practiceButton = document.getElementById('practice-button');
const restartButton = document.getElementById('restart-button');
const lifeFill = document.getElementById('life-fill');
const lifeTime = document.getElementById('life-time');
const statusLine = document.getElementById('status');

function setStatus(text, isError = false) {
  statusLine.textContent = text;
  statusLine.classList.toggle('error', isError);
}
setStatus(DEFAULT_HINT);

function formatTime(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function micErrorHelp() {
  if (mic.state === 'denied') return DENIED_HELP;
  return `microphone ${mic.state}${mic.errorMessage ? ' — ' + mic.errorMessage : ''}`;
}

// Practice flow: never a silent dead state. If the mic isn't ready, the
// click arms pendingStart and the frame loop watches mic.state — the session
// starts the moment the mic goes active, and a second click always cancels.
let pendingStart = false;
let promptWaitT = 0;
let promptHelpShown = false;

function startSession() {
  session.toggle();
  setStatus('listening — play something');
}

function endSession() {
  const result = session.toggle(); // vitality was already credited continuously
  if (result.sustainedTime >= CELEBRATION_MIN_GAINED_S) {
    expression.startCelebration();
    setStatus(`+${Math.round(result.sustainedTime)}s practiced today `
      + `(${Math.round(vitality.todayPracticeS)}/${DAILY_PRACTICE_TARGET_S}s)`);
  } else {
    setStatus('session ended — nothing heard');
  }
  saveState();
}

function togglePractice() {
  if (vitality.isDead) {
    setStatus('it’s gone — restart to hatch a new egg', true);
    return;
  }
  if (session.isSessionActive) {
    endSession();
    return;
  }
  if (pendingStart) {
    pendingStart = false;
    setStatus('practice cancelled');
    return;
  }
  if (mic.state === 'active') {
    startSession();
    return;
  }
  if (mic.state === 'unsupported') {
    setStatus(micErrorHelp(), true);
    return;
  }
  pendingStart = true;
  promptWaitT = 0;
  promptHelpShown = false;
  mic.start(); // fire-and-watch: the frame loop reacts to mic.state changes
  setStatus('Chrome will ask to use the microphone — click Allow');
}

// Frame-loop side of the practice flow.
function watchPendingStart(dt) {
  if (!pendingStart) return;
  if (mic.state === 'active') {
    pendingStart = false;
    startSession();
  } else if (mic.state === 'denied' || mic.state === 'error' || mic.state === 'unsupported') {
    pendingStart = false;
    setStatus(micErrorHelp(), true);
  } else {
    promptWaitT += dt;
    if (promptWaitT > PROMPT_HELP_AFTER_S && !promptHelpShown) {
      promptHelpShown = true;
      setStatus('still waiting — look for the microphone prompt or mic icon in Chrome’s address bar');
    }
  }
}

// Restart: every module back to initial state, save wiped.
function restart() {
  ageClock.reset();
  vitality.reset();
  moodMeter.reset();
  evolution.reset();
  session.reset();
  expression = createExpression();
  pendingStart = false;
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
  saveState();
  setStatus(`a new egg — ${DEFAULT_HINT}`);
}

// Early warning if the mic is already blocked for this site.
if (navigator.permissions && navigator.permissions.query) {
  navigator.permissions.query({ name: 'microphone' }).then((perm) => {
    const apply = () => { if (perm.state === 'denied') setStatus(DENIED_HELP, true); };
    apply();
    perm.addEventListener('change', apply);
  }).catch(() => { /* Permissions API is best-effort */ });
}

practiceButton.addEventListener('click', () => {
  practiceButton.blur(); // keep spacebar from re-clicking the focused button
  togglePractice();
});
restartButton.addEventListener('click', () => {
  restartButton.blur();
  restart();
});

// Dev-only toggles: enclosure preview (what the CYD's physical cutouts
// would reveal) and hiding the dev panel entirely.
let enclosureOn = false;
const debugPanel = document.getElementById('debug-panel');
const enclosureButton = document.getElementById('enclosure-button');
function setEnclosure(on) {
  enclosureOn = on;
  enclosureButton.textContent = `enclosure preview: ${on ? 'on' : 'off'}`;
}
enclosureButton.addEventListener('click', () => {
  enclosureButton.blur();
  setEnclosure(!enclosureOn);
});

// Space = the device's single button. N = skip a day, R = restart,
// E = enclosure preview, D = hide/show the dev panel (all dev-only).
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Space') {
    e.preventDefault();
    togglePractice();
  } else if (e.code === 'KeyN') {
    ageClock.skipDay(); // debug: same day-boundary path as real time
    saveState();
  } else if (e.code === 'KeyR') {
    restart();
  } else if (e.code === 'KeyE') {
    setEnclosure(!enclosureOn);
  } else if (e.code === 'KeyD') {
    debugPanel.style.display = debugPanel.style.display === 'none' ? '' : 'none';
  }
});

function updateControls() {
  const dead = vitality.isDead;
  practiceButton.hidden = dead;
  restartButton.hidden = !dead;
  if (session.isSessionActive) {
    practiceButton.textContent = `end practice · ${formatTime(session.sessionSustainedTime)}`;
    practiceButton.classList.add('active');
  } else if (pendingStart) {
    practiceButton.textContent = 'allow the microphone…';
    practiceButton.classList.remove('active');
  } else {
    practiceButton.textContent = 'start practice';
    practiceButton.classList.remove('active');
  }
  lifeFill.style.width = `${(vitality.vitality / VITALITY_MAX) * 100}%`;
  lifeTime.textContent = dead ? 'gone' : `day ${Math.floor(ageClock.ageDays())} · ${ageClock.stage()}`;
}

// --- debug panel (deleted for the CYD port) -----------------------------
const debugWave = document.getElementById('debug-wave');
const debugWaveCtx = debugWave.getContext('2d');
const dbg = {
  mic: document.getElementById('dbg-mic'),
  pitch: document.getElementById('dbg-pitch'),
  note: document.getElementById('dbg-note'),
  confidence: document.getElementById('dbg-confidence'),
  amplitude: document.getElementById('dbg-amplitude'),
  session: document.getElementById('dbg-session'),
  sustained: document.getElementById('dbg-sustained'),
  age: document.getElementById('dbg-age'),
  branch: document.getElementById('dbg-branch'),
  vitality: document.getElementById('dbg-vitality'),
  mood: document.getElementById('dbg-mood'),
  nextStage: document.getElementById('dbg-next-stage'),
  neglect: document.getElementById('dbg-neglect'),
  today: document.getElementById('dbg-today'),
  demeanor: document.getElementById('dbg-demeanor'),
  stats: document.getElementById('dbg-stats'),
};

// Rolling 30s stats of what the detector actually reports — for tuning.
const STATS_WINDOW = 1800;
const statConf = [];
const statAmp = [];
function recordStats(audio) {
  if (!audio) return;
  statConf.push(audio.confidence);
  statAmp.push(audio.amplitude);
  if (statConf.length > STATS_WINDOW) { statConf.shift(); statAmp.shift(); }
}
function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
}
window.__practiceStats = () => ({
  samples: statConf.length,
  confP50: percentile(statConf, 0.5),
  confP90: percentile(statConf, 0.9),
  aboveMusical: statConf.filter(c => c > 0.5).length / Math.max(1, statConf.length),
  ampP50: percentile(statAmp, 0.5),
  ampP90: percentile(statAmp, 0.9),
});

function updateDebugValues(audio, demeanor) {
  dbg.mic.textContent = mic.state === 'active' ? `active @ ${mic.sampleRate} Hz` : mic.state;
  dbg.pitch.textContent = audio && audio.pitchHz ? audio.pitchHz.toFixed(1) + ' Hz' : '–';
  dbg.note.textContent = audio && audio.note
    ? `${audio.note} ${audio.cents >= 0 ? '+' : ''}${audio.cents}c` : '–';
  dbg.confidence.textContent = audio ? audio.confidence.toFixed(2) : '–';
  dbg.amplitude.textContent = audio ? audio.amplitude.toFixed(3) : '–';
  dbg.session.textContent = session.isSessionActive ? 'active' : 'inactive';
  dbg.sustained.textContent = session.sessionSustainedTime.toFixed(1) + 's';
  dbg.age.textContent = `${ageClock.ageDays().toFixed(2)}d · ${ageClock.stage()}`;
  dbg.branch.textContent = evolution.branch;
  dbg.vitality.textContent = vitality.isDead ? 'dead' : vitality.vitality.toFixed(0);
  dbg.mood.textContent = moodMeter.value.toFixed(1);
  const next = ageClock.daysUntilNextStage();
  dbg.nextStage.textContent = next === null ? '–' : `${next.toFixed(2)}d`;
  dbg.neglect.textContent = String(vitality.consecutiveNeglectDays);
  dbg.today.textContent = `${vitality.todayPracticeS.toFixed(1)}/${DAILY_PRACTICE_TARGET_S}s`;
  dbg.demeanor.textContent = demeanor;
  dbg.stats.textContent = statConf.length
    ? `${percentile(statConf, 0.5).toFixed(2)} / ${percentile(statConf, 0.9).toFixed(2)}`
    : '–';
}

// Raw-waveform readout to confirm signal is flowing.
function drawDebugWave(samples) {
  const w = debugWave.width, h = debugWave.height;
  debugWaveCtx.clearRect(0, 0, w, h);
  if (!samples) return;
  debugWaveCtx.strokeStyle = '#4a90c2';
  debugWaveCtx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = (i / (samples.length - 1)) * w;
    const y = h / 2 - samples[i] * (h / 2);
    if (i === 0) debugWaveCtx.moveTo(x, y);
    else debugWaveCtx.lineTo(x, y);
  }
  debugWaveCtx.stroke();
}
// ------------------------------------------------------------------------

let saveT = 0;
let lastFrameTime = performance.now();
function frame(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, MAX_FRAME_DT_S);
  lastFrameTime = now;

  const samples = mic.getSamples();
  const audio = samples ? detectPitch(samples, mic.sampleRate) : null;
  const confidence = audio ? audio.confidence : 0;

  watchPendingStart(dt);
  recordStats(audio);

  // Privacy invariant: the microphone only runs during a practice session.
  // Covers every exit path — session end, cancelled start, death.
  if (mic.state === 'active' && !session.isSessionActive && !pendingStart) {
    mic.stop();
  }

  // dead creature: the simulation freezes until restart
  if (!vitality.isDead) {
    session.update(dt, confidence, audio ? audio.amplitude : 0);
    creditPractice(); // before the day clock, so a boundary sees today's practice
    ageClock.update(); // fires day-boundary events (and catch-up days after time away)
    moodMeter.update(dt, session.isSessionActive, confidence);
  }

  saveT += dt;
  if (saveT >= SAVE_INTERVAL_S) {
    saveT = 0;
    saveState();
  }

  // the creature state tuple — demeanor is derived inside the expression
  // layer, never stored
  const state = {
    stage: ageClock.stage(),
    branch: evolution.branch,
    vitality: vitality.vitality,
    mood: moodMeter.value,
    isDead: vitality.isDead,
    isSessionActive: session.isSessionActive,
    lastPitchHz: audio ? audio.pitchHz : null,
    lastConfidence: confidence,
    lastAmplitude: audio ? audio.amplitude : 0,
  };

  const face = expression.update(dt, state);
  drawFace(ctx, face, face.wave.active ? samples : null);
  if (enclosureOn) drawEnclosureMask(ctx, face);
  updateControls();
  drawDebugWave(samples);
  updateDebugValues(audio, face.demeanor);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
