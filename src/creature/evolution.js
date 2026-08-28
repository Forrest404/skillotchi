// evolution.js — tracks how consistently the creature was practiced-with
// across the days of the CURRENT life stage, and locks in a branch
// ("thriving" | "neglected") at each stage transition. The daily
// practiced-or-not signal comes from vitality.endDay()'s return value,
// wired through main.js — no second day-tracker here.

// --- tuning constants ---------------------------------------------------
export const THRIVING_RATIO = 0.5;   // fraction of stage days practiced to stay thriving
// ------------------------------------------------------------------------

export function createEvolution(initial) {
  let branch = initial && (initial.branch === 'neglected') ? 'neglected' : 'thriving';
  let stageDays = initial && Number.isFinite(initial.stageDays) ? initial.stageDays : 0;
  let practicedDays = initial && Number.isFinite(initial.practicedDays) ? initial.practicedDays : 0;

  // One call per day boundary, with that day's practiced signal.
  function recordDay(practiced) {
    stageDays += 1;
    if (practiced) practicedDays += 1;
  }

  // Called by main.js when the age clock's stage changes. Locks the branch
  // from the stage that just ENDED, then starts a clean tally for the new
  // stage. Decided exactly once per transition — never recomputed mid-stage.
  function onStageTransition() {
    const ratio = stageDays > 0 ? practicedDays / stageDays : 1; // an empty stage counts as thriving
    branch = ratio >= THRIVING_RATIO ? 'thriving' : 'neglected';
    stageDays = 0;
    practicedDays = 0;
    return branch;
  }

  function reset() {
    branch = 'thriving';
    stageDays = 0;
    practicedDays = 0;
  }

  return {
    recordDay,
    onStageTransition,
    reset,
    get branch() { return branch; },
    get stageDays() { return stageDays; },
    get practicedDays() { return practicedDays; },
    serialize: () => ({ branch, stageDays, practicedDays }),
  };
}
