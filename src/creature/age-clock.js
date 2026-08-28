// age-clock.js — tracks real elapsed time since creature creation and turns
// it into simulated days and life stages. No vitality, mood, or audio
// references: this file only knows about time.
//
// Age derives from a creation timestamp, so days that pass while the page is
// closed are picked up on the next update() as catch-up day-boundary events.

// --- tuning constants ---------------------------------------------------
// Real seconds per simulated day. 86400 = real-world pacing (a day is a
// day). Drop to 60 for dev pacing (one "day" a minute) — nothing else
// needs to change. The N key still skips whole days instantly either way.
export const TIME_SCALE_S_PER_DAY = 86400;

// Life-stage boundaries, in simulated days.
export const STAGE_CHILD_AT_DAYS = 1;
export const STAGE_TEEN_AT_DAYS  = 4;
export const STAGE_ADULT_AT_DAYS = 7;
// ------------------------------------------------------------------------

export function stageForAge(ageDays) {
  if (ageDays < STAGE_CHILD_AT_DAYS) return 'egg';
  if (ageDays < STAGE_TEEN_AT_DAYS) return 'child';
  if (ageDays < STAGE_ADULT_AT_DAYS) return 'teen';
  return 'adult';
}

// Days until the next stage boundary, or null when adult (no next stage).
export function daysUntilNextStage(ageDays) {
  for (const boundary of [STAGE_CHILD_AT_DAYS, STAGE_TEEN_AT_DAYS, STAGE_ADULT_AT_DAYS]) {
    if (ageDays < boundary) return boundary - ageDays;
  }
  return null;
}

// initial: { createdAtMs, lastProcessedDay } from persistence, or omitted
// for a fresh egg. nowMs is injectable for tests.
export function createAgeClock(initial, nowMs = Date.now()) {
  let createdAtMs = initial && Number.isFinite(initial.createdAtMs)
    ? initial.createdAtMs : nowMs;
  let lastProcessedDay = initial && Number.isFinite(initial.lastProcessedDay)
    ? initial.lastProcessedDay : 0;
  let onDayBoundary = null;

  function ageDays(now = Date.now()) {
    return Math.max(0, (now - createdAtMs) / 1000 / TIME_SCALE_S_PER_DAY);
  }

  // Fires the day-boundary callback exactly once per whole day crossed —
  // including several at once after time away.
  function update(now = Date.now()) {
    const currentDay = Math.floor(ageDays(now));
    while (lastProcessedDay < currentDay) {
      lastProcessedDay += 1;
      if (onDayBoundary) onDayBoundary(lastProcessedDay);
    }
  }

  // Debug helper: advance the clock by exactly one simulated day. Shifts the
  // creation timestamp and runs the normal update path — NOT a separate
  // code path, so everything downstream behaves identically.
  function skipDay(now = Date.now()) {
    createdAtMs -= TIME_SCALE_S_PER_DAY * 1000;
    update(now);
  }

  function reset(now = Date.now()) {
    createdAtMs = now;
    lastProcessedDay = 0;
  }

  return {
    update,
    skipDay,
    reset,
    ageDays,
    stage: (now = Date.now()) => stageForAge(ageDays(now)),
    daysUntilNextStage: (now = Date.now()) => daysUntilNextStage(ageDays(now)),
    setOnDayBoundary: (cb) => { onDayBoundary = cb; },
    serialize: () => ({ createdAtMs, lastProcessedDay }),
  };
}
