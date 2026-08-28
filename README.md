# skillotchi — practice creature (browser MVP)

Tamagotchi-style creature that lives on real instrument practice, detected via
microphone pitch tracking. Browser prototype of a future CYD (ESP32 + 320x240
display + mic + one button) device. Vanilla JS + Canvas + Web Audio, no build step.

## Run

```
cd src
python3 -m http.server 8137
```

Open http://localhost:8137 — the mic requires localhost or https (`file://` won't
work, and to share it with others just drop `src/` on any https static host).

1. Click **start practice** (or press space) and allow the microphone when Chrome asks.
2. Play — the creature perks up on confident pitch, squints happily while you
   sustain, glances up on high notes, and shows a waveform while it hears you.
3. Click **end practice**: sustained playing time is credited to today's
   practice (celebration bounce).

The life system (persists in localStorage, keeps running while the page is closed):

- **Age** — real time becomes simulated days (`TIME_SCALE_S_PER_DAY`, dev default
  60s/day; set 86400 for real pacing). Life stages: egg (day 0) → child (1–4) →
  teen (4–7) → adult (7+), each with its own eye proportions.
- **Vitality** — moves once per day: hit the daily practice target and it
  regenerates; miss it and it decays. Three consecutive days at zero = death
  (restart hatches a new egg).
- **Mood** — fast happiness: rises while you play, halves every 12 real hours.
  Vitality and mood can disagree — a healthy creature can still be sad today.
- **Evolution** — each stage's practice consistency locks a branch at the next
  stage transition: thriving (bright blue, fluid) or neglected (dull slate, twitchy).

Debug keys: **N** skips a simulated day, **R** restarts.

## Layout

```
src/
  audio/            pure signal layer — zero DOM/canvas
    mic-input.js    getUserMedia + AnalyserNode, pull-based getSamples()
    pitch-detect.js autocorrelation detector -> {pitchHz, note, cents, confidence, amplitude}
  creature/         state + rendering — never touches audio APIs
    session.js      button toggle + sustained-time accumulation
    age-clock.js    real time -> simulated days + life stages + day events
    vitality.js     daily survival stat, neglect tracking, death
    mood.js         fast numeric happiness (session rise, real-hours half-life)
    evolution.js    per-stage practice consistency -> thriving/neglected branch
    expression.js   demeanor derivation + face geometry/color/waveform (all tuning constants)
    eyes-renderer.js   draw-only: eyes + waveform on the 320x240 logical canvas
  main.js           wiring, rAF loop, debug panel (debug panel dies at CYD port time)
  index.html
```

Tuning knobs are named constants at the top of each file (thresholds, decay
rate, blink timing, mood baselines).
