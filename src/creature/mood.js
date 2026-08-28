// mood.js — fast-moving numeric happiness (0..100). Rises while a session is
// running and the existing detector confidence says musical sound is present
// (RELAXED_CONFIDENCE comes from the audio layer — no re-derived detection).
// Decays continuously with a half-life measured in REAL hours — mood is the
// "were you here recently" stat, deliberately faster than vitality.
// No imports from vitality.js or age-clock.js.

import { RELAXED_CONFIDENCE } from '../audio/pitch-detect.js';

// --- tuning constants ---------------------------------------------------
export const MOOD_START = 50;
export const MOOD_MAX = 100;
export const MOOD_RISE_PER_MUSICAL_SECOND = 2;
export const MOOD_HALF_LIFE_HOURS = 12;   // real hours; drop to ~0.01 to watch decay in dev
// ------------------------------------------------------------------------

const HALF_LIFE_S = () => MOOD_HALF_LIFE_HOURS * 3600;

export function createMood(initial, nowMs = Date.now()) {
  let value = Math.min(MOOD_MAX, Math.max(0, initial && Number.isFinite(initial.value)
    ? initial.value : MOOD_START));

  // catch-up decay for time the page was closed
  if (initial && Number.isFinite(initial.savedAtMs)) {
    const hoursAway = Math.max(0, (nowMs - initial.savedAtMs) / 3600000);
    value *= Math.pow(0.5, hoursAway / MOOD_HALF_LIFE_HOURS);
  }

  // Call every frame with real dt seconds.
  function update(dt, isSessionActive, confidence) {
    if (isSessionActive && confidence > RELAXED_CONFIDENCE) {
      value = Math.min(MOOD_MAX, value + MOOD_RISE_PER_MUSICAL_SECOND * dt);
    }
    value *= Math.pow(0.5, dt / HALF_LIFE_S()); // continuous real-time decay
  }

  function reset() {
    value = MOOD_START;
  }

  return {
    update,
    reset,
    get value() { return value; },
    serialize: (now = Date.now()) => ({ value, savedAtMs: now }),
  };
}
