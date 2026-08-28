// session.js — practice-session state. No rendering code and no audio API
// calls: it only consumes the confidence + amplitude numbers handed to it
// each frame.
//
// Counting philosophy: practice time accrues whenever the creature hears
// MUSICAL SOUND — moderate periodicity at real volume — not only on a strict
// monophonic pitch lock (chords, attacks, and fast passages rarely hold one).
// The strict lock threshold stays in the expression layer for visuals.

import { RELAXED_CONFIDENCE } from '../audio/pitch-detect.js';

// --- tuning constants ---------------------------------------------------
const CONFIDENT_GRACE_S = 0.5;         // after a good frame, bridge this long...
const GRACE_FLOOR_CONFIDENCE = 0.35;   // ...through frames at least this periodic
const PRACTICE_MIN_RMS = 0.01;         // ignore boosted room noise: playing must be audible
// ------------------------------------------------------------------------

export function createSession() {
  let isSessionActive = false;
  let sessionSustainedTime = 0; // seconds of musical sound this session
  let sinceGood = Infinity;     // time since the last clearly-musical frame
  let onEnd = null;             // session-end callback (main.js wires vitality to this)

  // Returns what happened so the caller can react (celebration, vitality credit).
  function toggle() {
    if (!isSessionActive) {
      isSessionActive = true;
      sessionSustainedTime = 0; // fresh session — no leakage from the last one
      sinceGood = Infinity;
      return { type: 'start' };
    }
    isSessionActive = false;
    if (onEnd) onEnd({ sustainedTime: sessionSustainedTime });
    return { type: 'end', sustainedTime: sessionSustainedTime };
  }

  // Call every frame. Silence and pure noise inside a session never count.
  function update(dtSeconds, confidence, amplitude) {
    if (!isSessionActive) return;
    const audible = amplitude > PRACTICE_MIN_RMS;
    if (audible && confidence > RELAXED_CONFIDENCE) {
      sinceGood = 0;
      sessionSustainedTime += dtSeconds;
    } else {
      sinceGood += dtSeconds;
      if (audible && confidence > GRACE_FLOOR_CONFIDENCE && sinceGood < CONFIDENT_GRACE_S) {
        sessionSustainedTime += dtSeconds;
      }
    }
  }

  function reset() {
    isSessionActive = false;
    sessionSustainedTime = 0;
    sinceGood = Infinity;
  }

  return {
    toggle,
    update,
    reset,
    setOnEnd: (cb) => { onEnd = cb; },
    get isSessionActive() { return isSessionActive; },
    get sessionSustainedTime() { return sessionSustainedTime; },
  };
}
