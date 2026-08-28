// vitality.js — the slow survival stat. Starts full; moves ONLY at
// day-boundary events (endDay, called by main.js from the age clock).
// Practice time arrives via addPracticeTime (main.js wires it from the
// session-end callback) — this module never imports session internals.

// --- tuning constants ---------------------------------------------------
export const VITALITY_MAX = 100;
export const VITALITY_START = 100;
export const DAILY_PRACTICE_TARGET_S = 600;  // sustained seconds/day to count as practiced
                                             // (10 min at real-world pacing; pair with
                                             //  TIME_SCALE_S_PER_DAY — use ~10 for dev days)
export const REGEN_PER_GOOD_DAY = 15;
export const DECAY_PER_BAD_DAY = 25;
export const DEATH_AFTER_NEGLECT_DAYS = 3;   // consecutive days at zero vitality
// ------------------------------------------------------------------------

function clampVitality(v) {
  return Math.min(VITALITY_MAX, Math.max(0, v));
}

export function createVitality(initial) {
  let vitality = clampVitality(initial && Number.isFinite(initial.vitality)
    ? initial.vitality : VITALITY_START);
  let todayPracticeS = initial && Number.isFinite(initial.todayPracticeS)
    ? initial.todayPracticeS : 0;
  let consecutiveNeglectDays = initial && Number.isFinite(initial.consecutiveNeglectDays)
    ? initial.consecutiveNeglectDays : 0;
  let isDead = !!(initial && initial.isDead);
  let onDeath = null;

  function addPracticeTime(seconds) {
    if (isDead) return;
    todayPracticeS += Math.max(0, seconds);
  }

  // Called once per day-boundary event. Applies the day's regen/decay,
  // resets the daily tracker, and advances the neglect/death logic.
  // Returns { practiced } — the daily signal the evolution layer reuses.
  function endDay() {
    if (isDead) return { practiced: false };
    const practiced = todayPracticeS >= DAILY_PRACTICE_TARGET_S;
    vitality = clampVitality(practiced
      ? vitality + REGEN_PER_GOOD_DAY
      : vitality - DECAY_PER_BAD_DAY);
    todayPracticeS = 0; // fresh day — yesterday's practice never leaks forward
    if (vitality <= 0) {
      consecutiveNeglectDays += 1;
      if (consecutiveNeglectDays >= DEATH_AFTER_NEGLECT_DAYS) {
        isDead = true;
        if (onDeath) onDeath();
      }
    } else {
      consecutiveNeglectDays = 0;
    }
    return { practiced };
  }

  function reset() {
    vitality = VITALITY_START;
    todayPracticeS = 0;
    consecutiveNeglectDays = 0;
    isDead = false;
  }

  return {
    addPracticeTime,
    endDay,
    reset,
    setOnDeath: (cb) => { onDeath = cb; },
    get vitality() { return vitality; },
    get todayPracticeS() { return todayPracticeS; },
    get consecutiveNeglectDays() { return consecutiveNeglectDays; },
    get isDead() { return isDead; },
    serialize: () => ({ vitality, todayPracticeS, consecutiveNeglectDays, isDead }),
  };
}
