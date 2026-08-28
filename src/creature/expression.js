// expression.js — decides what the face looks like each frame. Pure: state
// values in, visual parameters out — no audio APIs, no timers. The renderer
// draws exactly what this module outputs.
//
// Output is the four-layer channel-mapping contract, composed 1→2→3→4 every
// frame (later layers may override earlier ones, never the reverse):
//   Layer 1  base     — life stage (size/roundness), evolution branch
//                       (palette), vitality (base glow + blink rate)
//   Layer 2  reactive — mood (outer-corner curve, droop, drift liveliness)
//   Layer 3  live     — session engagement: interior waveform on/intensity,
//                       confidence widen, amplitude glow pulse
//   Layer 4  event    — blink, one-off gestures, celebration, death
//                       (death overrides everything until restart)
//
// Channels deliberately kept from earlier stages, outside the table (flagged
// in the build notes): pitch gaze (position channel), sustained-pitch
// smile-squint (L3 composing over L2's corner channel), cute gestures
// (Layer-4 events alongside blink).

import { RELAXED_CONFIDENCE } from '../audio/pitch-detect.js';

// --- tuning constants ---------------------------------------------------
// Layer 1: vitality → glow + blink rate
const GLOW_AT_ZERO_VITALITY = 0.35;
const GLOW_AT_FULL_VITALITY = 0.8;
const BLINK_MULT_AT_ZERO_VITALITY = 1.8;   // slow, heavy blinks when weak
const BLINK_MULT_AT_FULL_VITALITY = 0.85;  // brisk natural blinks when healthy
const LID_SPEED_MULT_AT_ZERO_VITALITY = 1.6; // lid travel slows when weak

// Layer 2: mood → corner curve + droop + drift liveliness
const MOOD_TOP_CURVE_PX = 4;               // topR gain at max mood (smile-in-eye)
const MOOD_BOTTOM_CURVE_PX = 3;            // bottomR loss at max mood
const MOOD_DROOP_TILT = 0.06;              // rad — outer corners down at low mood
const MOOD_DROOP_PX = 3;                   // slight sink at low mood
const DRIFT_AT_ZERO_MOOD = 0.35;
const DRIFT_AT_FULL_MOOD = 1.15;

// blink event
export const BLINK_INTERVAL_MIN_S = 2.0;   // randomized gap between blinks
export const BLINK_INTERVAL_MAX_S = 6.0;
const BLINK_CLOSE_S = 0.07;
const BLINK_HOLD_S  = 0.05;
const BLINK_OPEN_S  = 0.12;
const BLINK_MIN_OPENNESS = 0.08;           // never a hard 0 — keeps a visible slit
const DOUBLE_BLINK_GAP_S = 0.15;

// idle motion (scaled by Layer 2 liveliness)
const DRIFT_X_AMPLITUDE = 3;               // logical px (320x240 space)
const DRIFT_Y_AMPLITUDE = 2;
const DRIFT_X_PERIOD_S  = 6.3;
const DRIFT_Y_PERIOD_S  = 4.1;
const BREATH_SCALE      = 0.025;           // +/- fraction of eye height
const BREATH_PERIOD_S   = 3.9;

// geometry (teen-stage baseline; the stage table scales it)
const BASE_EYE_W  = 52;
const BASE_EYE_H  = 64;
const BASE_EYE_TOP_R = 16;
const BASE_EYE_BOTTOM_R = 16;
const EYE_SPACING = 92;                    // center-to-center
const FACE_CX = 160;
const FACE_CY = 118;

// Layer 1: life-stage SHAPE axis
const STAGE_PARAMS = {
  egg:   { scale: 0.6,  spacing: 0.62, radiusBoost: 12, expressive: 0.45, blinkSlow: 2.0,  gestures: false },
  child: { scale: 0.85, spacing: 0.85, radiusBoost: 6,  expressive: 0.8,  blinkSlow: 1.3,  gestures: true },
  teen:  { scale: 1,    spacing: 1,    radiusBoost: 0,  expressive: 1,    blinkSlow: 1,    gestures: true },
  adult: { scale: 1.06, spacing: 1.04, radiusBoost: -3, expressive: 1.2,  blinkSlow: 0.85, gestures: true },
};

// Layer 3: session engagement
const PERK_WIDEN   = 0.15;                 // eye-height boost on confident pitch
const PERK_WIDTH   = 0.06;                 // eye-width boost on confident pitch
const SQUINT_CLOSE = 0.5;                  // eye-height reduction at full squint-happy
const SQUINT_WIDTH = 0.10;                 // eye-width boost at full squint (smile-eyes)
const SMILE_TOP_R    = 26;                 // squint blends corner radii toward this arch...
const SMILE_BOTTOM_R = 6;                  // ...flat-ish base = smile shape
const LID_SQUASH_WIDTH = 0.06;             // sideways squash while lids close
const SQUINT_ONSET_S = 0.6;                // sustained confident time before squinting starts
const SQUINT_FULL_S  = 1.8;                // ...and where it reaches full
const LISTENING_PERK = 0.35;               // slight anticipation perk in a quiet session
const LISTENING_TILT = 0.05;               // rad — attentive head tilt while listening
const MUSIC_PULSE    = 0.06;               // eye scale bounce with amplitude while playing
const CONFIDENT_RELEASE_RATE = 3;          // how fast sustained-time drains on dropouts (s/s)
const CONFIDENT_BRIGHTNESS = 1;            // full glow on confident pitch (over the vitality base)
const GLOW_PULSE_ATTACK_RATE = 18;         // 1/s — border glow chases amplitude quickly
const WAVE_NOISE_FLOOR_RMS = 0.005;        // below this amplitude: no interior waveform
const WAVE_FULL_RMS = 0.08;                // RMS that maps to full waveform intensity

// easing
const EASE_ATTACK_RATE  = 10;              // 1/s — snap toward new targets
const EASE_RELEASE_RATE = 4;               // 1/s — relax back
const BASELINE_EASE_RATE = 5;              // 1/s — layer-1/2 baseline transitions
const SHAPE_EASE_RATE   = 6;               // 1/s — corner radii / tilt / gaze / stage transitions

// gaze — eyes glance up for high notes, down for low ones
const PITCH_GAZE_RANGE_PX = 5;
const PITCH_GAZE_CENTER_MIDI = 64;         // ~E4 reads as "eye level"
const PITCH_GAZE_SPAN_MIDI = 24;           // two octaves to the extremes

// Layer 4: gestures
const GESTURE_INTERVAL_MIN_S = 6;
const GESTURE_INTERVAL_MAX_S = 14;
const LOOK_DURATION_S = 2.4;
const LOOK_GAZE_PX = 7;
const NOD_DURATION_S = 2.2;
const NOD_SINK_PX = 7;
const NOD_CLOSE = 0.5;                     // how far the lids sink during a sleepy nod
const WIGGLE_DURATION_S = 0.7;
const WIGGLE_PX = 5;
const WIGGLE_TILT = 0.05;

// Layer 4: celebration (one-off on session end)
const CELEBRATION_DURATION_S = 1.4;
const CELEBRATION_HOPS = 3;
const CELEBRATION_BOUNCE_PX = 14;
const CELEBRATION_PUFF = 0.25;             // extra eye-height scale at bounce peaks
const CELEBRATION_PUFF_WIDTH_RATIO = 0.6;  // width puffs this fraction of the height puff
const CELEBRATION_MIN_BRIGHTNESS = 0.85;   // brightness floor during celebration
const CELEBRATION_FLARE = 0.15;            // extra brightness at bounce peaks
const CELEBRATION_SMILE = 0.85;            // squint level forced during celebration (smile-arch)

// Layer 4: death
const DEAD_HEIGHT = 0.06;                  // closed slit
const DEAD_GLOW = 0.3;
const DEAD_DROOP_PX = 8;
const DEAD_RADIUS = 3;
// demeanor thresholds (debug label + gesture flavor only — not a visual driver)
export const WEAK_VITALITY_BELOW = 25;
export const SAD_MOOD_BELOW = 35;
export const CONTENT_MOOD_ABOVE = 70;
// ------------------------------------------------------------------------

// Word label for the debug panel and gesture flavor. NOT a visual channel —
// the contract maps vitality/mood/confidence to their own channels directly.
export function deriveDemeanor({ isDead, isSessionActive, lastConfidence, vitality, mood }) {
  if (isDead) return 'dead';
  if (isSessionActive) {
    return lastConfidence > RELAXED_CONFIDENCE ? 'happy' : 'listening';
  }
  if (vitality < WEAK_VITALITY_BELOW) return 'weak';
  if (mood < SAD_MOOD_BELOW) return 'sad';
  if (mood > CONTENT_MOOD_ABOVE) return 'content';
  return 'idle';
}

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(x) {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
}

// frame-rate-independent exponential approach
function ease(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function createExpression() {
  let t = 0;
  let nextBlinkIn = randRange(BLINK_INTERVAL_MIN_S, BLINK_INTERVAL_MAX_S);
  let blinkT = -1;           // progress through the current blink; -1 = not blinking
  let secondBlinkIn = -1;    // countdown to the second half of a double-blink
  let lidSpeedMult = 1;      // vitality-driven blink heaviness (applies to the blink in flight)

  // smoothed values
  let perk = 0;              // L3 — "heard a confident pitch"
  let squint = 0;            // L3 — sustained pitch; smile-arch
  let brightness = GLOW_AT_FULL_VITALITY;
  let glowPulse = 0;         // L3 — border glow chasing amplitude
  let moodCurve = 0;         // L2 — smoothed (mood-50)/50
  let moodDrift = 1;         // L2 — drift liveliness
  let droop = 0;
  let topR = BASE_EYE_TOP_R;
  let bottomR = BASE_EYE_BOTTOM_R;
  let tiltSad = 0;           // mirrored tilt (outer corners down)
  let tiltBase = 0;          // shared tilt (attentive listening)
  let gazeY = 0;
  let pulse = 0;
  let waveIntensity = 0;
  let confidentTime = 0;
  let celebrationT = -1;     // -1 = not celebrating

  // stage shape (eased so stage transitions morph, not snap)
  let stageScale = STAGE_PARAMS.teen.scale;
  let stageSpacing = STAGE_PARAMS.teen.spacing;
  let stageRadius = 0;
  let stageExpressive = 1;

  // one-shot gesture: { name, t, dur, side }
  let gesture = null;
  let nextGestureIn = randRange(GESTURE_INTERVAL_MIN_S, GESTURE_INTERVAL_MAX_S);
  let prevSessionActive = false;

  // 1 = fully open, BLINK_MIN_OPENNESS = closed slit
  function blinkOpenness() {
    if (blinkT < 0) return 1;
    const closeS = BLINK_CLOSE_S * lidSpeedMult;
    const holdS = BLINK_HOLD_S * lidSpeedMult;
    const openS = BLINK_OPEN_S * lidSpeedMult;
    if (blinkT < closeS) {
      return 1 - (blinkT / closeS) * (1 - BLINK_MIN_OPENNESS);
    }
    if (blinkT < closeS + holdS) return BLINK_MIN_OPENNESS;
    const openT = blinkT - closeS - holdS;
    return Math.min(1, BLINK_MIN_OPENNESS + (openT / openS) * (1 - BLINK_MIN_OPENNESS));
  }

  function stepBlink(dt, enabled, intervalMult) {
    if (secondBlinkIn >= 0) {
      secondBlinkIn -= dt;
      if (secondBlinkIn < 0 && blinkT < 0) blinkT = 0;
    }
    if (blinkT < 0) {
      if (!enabled) return;
      nextBlinkIn -= dt;
      if (nextBlinkIn <= 0) blinkT = 0;
    } else {
      blinkT += dt; // a blink in flight always finishes
      if (blinkT >= (BLINK_CLOSE_S + BLINK_HOLD_S + BLINK_OPEN_S) * lidSpeedMult) {
        blinkT = -1;
        nextBlinkIn = randRange(BLINK_INTERVAL_MIN_S, BLINK_INTERVAL_MAX_S) * intervalMult;
      }
    }
  }

  // Idle-time cute animations, demeanor- and stage-appropriate.
  function scheduleGestures(dt, demeanor, allowed, celebrating) {
    if (gesture || celebrating || !allowed) return;
    if (demeanor !== 'idle' && demeanor !== 'content' && demeanor !== 'sad' && demeanor !== 'weak') return;
    nextGestureIn -= dt;
    if (nextGestureIn > 0) return;
    nextGestureIn = randRange(GESTURE_INTERVAL_MIN_S, GESTURE_INTERVAL_MAX_S);
    const roll = Math.random();
    if (demeanor === 'weak' || demeanor === 'sad') {
      gesture = roll < 0.6
        ? { name: 'nod', t: 0, dur: NOD_DURATION_S, side: 0 }
        : { name: 'doubleblink', t: 0, dur: 0.6, side: 0 };
    } else {
      gesture = roll < 0.55
        ? { name: 'look', t: 0, dur: LOOK_DURATION_S, side: Math.random() < 0.5 ? -1 : 1 }
        : { name: 'doubleblink', t: 0, dur: 0.6, side: 0 };
    }
    if (gesture.name === 'doubleblink') {
      blinkT = 0;
      secondBlinkIn = (BLINK_CLOSE_S + BLINK_HOLD_S + BLINK_OPEN_S) * lidSpeedMult + DOUBLE_BLINK_GAP_S;
    }
  }

  // Per-gesture offsets applied to the composed face.
  function gestureOffsets(dt) {
    const out = { gazeX: 0, cyOff: 0, openMul: 1, xOff: 0, tiltOff: 0 };
    if (!gesture) return out;
    gesture.t += dt;
    const p = gesture.t / gesture.dur;
    if (p >= 1) { gesture = null; return out; }
    if (gesture.name === 'look') {
      const env = p < 0.2 ? smoothstep(p / 0.2) : p > 0.75 ? smoothstep((1 - p) / 0.25) : 1;
      out.gazeX = gesture.side * LOOK_GAZE_PX * env;
    } else if (gesture.name === 'nod') {
      if (p < 0.55) {
        const s = smoothstep(p / 0.55);
        out.cyOff = NOD_SINK_PX * s;
        out.openMul = 1 - NOD_CLOSE * s;
      } else if (p < 0.72) {
        out.cyOff = NOD_SINK_PX;
        out.openMul = 1 - NOD_CLOSE;
      } else {
        const r = smoothstep((p - 0.72) / 0.28);
        out.cyOff = NOD_SINK_PX * (1 - r) - 2 * Math.sin(r * Math.PI);
        out.openMul = (1 - NOD_CLOSE) + NOD_CLOSE * r;
      }
    } else if (gesture.name === 'wiggle') {
      const decay = 1 - p;
      out.xOff = Math.sin(p * Math.PI * 4) * WIGGLE_PX * decay;
      out.tiltOff = Math.sin(p * Math.PI * 4 + 0.6) * WIGGLE_TILT * decay;
    }
    return out;
  }

  // Trigger the one-off session-end celebration (a Layer-4 event).
  function startCelebration() {
    celebrationT = 0;
    gesture = null;
  }

  // state: { stage, branch, vitality, mood, isDead,
  //          isSessionActive, lastPitchHz, lastConfidence, lastAmplitude }
  function update(dt, state) {
    t += dt;

    const demeanor = deriveDemeanor(state);
    const stageP = STAGE_PARAMS[state.stage] || STAGE_PARAMS.teen;
    const vitalityNorm = clamp01((state.vitality || 0) / 100);
    const moodNorm = clamp01((state.mood || 0) / 100);
    const amplitude = state.lastAmplitude || 0;
    const confident = state.lastConfidence > RELAXED_CONFIDENCE;
    const inSession = !!state.isSessionActive && !state.isDead;
    const hearingSomething = inSession && amplitude > WAVE_NOISE_FLOOR_RMS;

    const celebrating = celebrationT >= 0;
    if (celebrating) {
      celebrationT += dt;
      if (celebrationT >= CELEBRATION_DURATION_S) celebrationT = -1;
    }

    // ---- Layer 1: base (stage shape, branch palette, vitality glow/blink)
    stageScale = ease(stageScale, stageP.scale, SHAPE_EASE_RATE, dt);
    stageSpacing = ease(stageSpacing, stageP.spacing, SHAPE_EASE_RATE, dt);
    stageRadius = ease(stageRadius, stageP.radiusBoost, SHAPE_EASE_RATE, dt);
    stageExpressive = ease(stageExpressive, stageP.expressive, SHAPE_EASE_RATE, dt);
    const baseGlow = lerp(GLOW_AT_ZERO_VITALITY, GLOW_AT_FULL_VITALITY, vitalityNorm);
    const blinkIntervalMult = lerp(BLINK_MULT_AT_ZERO_VITALITY, BLINK_MULT_AT_FULL_VITALITY, vitalityNorm)
      * stageP.blinkSlow;
    lidSpeedMult = lerp(LID_SPEED_MULT_AT_ZERO_VITALITY, 1, vitalityNorm);

    // ---- Layer 2: reactive (mood → corner curve, droop, drift liveliness)
    const moodCurveTarget = (moodNorm - 0.5) * 2; // -1 .. +1
    moodCurve = ease(moodCurve, moodCurveTarget, BASELINE_EASE_RATE, dt);
    moodDrift = ease(moodDrift, lerp(DRIFT_AT_ZERO_MOOD, DRIFT_AT_FULL_MOOD, moodNorm), BASELINE_EASE_RATE, dt);
    const moodDroopTarget = Math.max(0, -moodCurveTarget) * MOOD_DROOP_PX;
    droop = ease(droop, state.isDead ? DEAD_DROOP_PX : moodDroopTarget, BASELINE_EASE_RATE, dt);
    const tiltSadTarget = Math.max(0, -moodCurveTarget) * MOOD_DROOP_TILT;
    tiltSad = ease(tiltSad, state.isDead ? 0 : tiltSadTarget, SHAPE_EASE_RATE, dt);

    // ---- Layer 3: live (session engagement; zero when no session)
    confidentTime = confident && inSession
      ? confidentTime + dt
      : Math.max(0, confidentTime - dt * CONFIDENT_RELEASE_RATE);
    const reactScale = (state.isDead ? 0 : 1) * stageExpressive;
    const perkTarget = inSession
      ? (confident ? 1 : LISTENING_PERK * 0.5) * reactScale
      : 0;
    const squintTarget = clamp01((confidentTime - SQUINT_ONSET_S) / (SQUINT_FULL_S - SQUINT_ONSET_S)) * reactScale;
    const brightTarget = state.isDead ? DEAD_GLOW
      : inSession && confident ? CONFIDENT_BRIGHTNESS
      : baseGlow;
    const waveTarget = hearingSomething ? clamp01(amplitude / WAVE_FULL_RMS) : 0;
    const tiltBaseTarget = inSession && !confident ? LISTENING_TILT : 0;

    let gazeYTarget = 0;
    if (inSession && confident && state.lastPitchHz) {
      const midi = 69 + 12 * Math.log2(state.lastPitchHz / 440);
      const norm = Math.max(-1, Math.min(1, (midi - PITCH_GAZE_CENTER_MIDI) / PITCH_GAZE_SPAN_MIDI));
      gazeYTarget = -norm * PITCH_GAZE_RANGE_PX;
    }

    perk = ease(perk, perkTarget, perkTarget > perk ? EASE_ATTACK_RATE : EASE_RELEASE_RATE, dt);
    squint = ease(squint, squintTarget, EASE_RELEASE_RATE, dt);
    brightness = ease(brightness, brightTarget, brightTarget > brightness ? EASE_ATTACK_RATE : EASE_RELEASE_RATE, dt);
    glowPulse = ease(glowPulse, waveTarget, GLOW_PULSE_ATTACK_RATE, dt);
    tiltBase = ease(tiltBase, tiltBaseTarget, SHAPE_EASE_RATE, dt);
    gazeY = ease(gazeY, gazeYTarget, SHAPE_EASE_RATE, dt);
    pulse = ease(pulse, waveTarget, EASE_ATTACK_RATE, dt);
    waveIntensity = ease(waveIntensity, waveTarget, EASE_ATTACK_RATE, dt);

    // ---- Layer 4: events (blink, gestures, celebration, death)
    stepBlink(dt, !state.isDead && !celebrating, blinkIntervalMult);
    scheduleGestures(dt, demeanor, stageP.gestures && !state.isDead, celebrating);
    const g = gestureOffsets(dt);

    if (state.isSessionActive && !prevSessionActive && stageP.gestures && !state.isDead) {
      gesture = { name: 'wiggle', t: 0, dur: WIGGLE_DURATION_S, side: 0 };
    }
    prevSessionActive = state.isSessionActive;

    // ---- compose 1 → 2 → 3 → 4 ------------------------------------------
    // corner radii: L1 stage roundness + L2 mood curve, L3 squint composing
    // over the top (layer priority: later wins where they meet)
    const effSquint = Math.max(squint, celebrating ? CELEBRATION_SMILE : 0);
    const moodTopR = BASE_EYE_TOP_R + moodCurve * MOOD_TOP_CURVE_PX;
    const moodBottomR = BASE_EYE_BOTTOM_R - moodCurve * MOOD_BOTTOM_CURVE_PX;
    const topRTarget = state.isDead ? DEAD_RADIUS
      : lerp(moodTopR, SMILE_TOP_R, effSquint) + stageRadius;
    const bottomRTarget = state.isDead ? DEAD_RADIUS
      : lerp(moodBottomR, SMILE_BOTTOM_R, effSquint) + stageRadius;
    topR = ease(topR, topRTarget, SHAPE_EASE_RATE, dt);
    bottomR = ease(bottomR, bottomRTarget, SHAPE_EASE_RATE, dt);

    // motion: L2 liveliness, killed by death (L4)
    const motionScale = state.isDead ? 0 : moodDrift;
    const driftX = Math.sin((t / DRIFT_X_PERIOD_S) * Math.PI * 2) * DRIFT_X_AMPLITUDE * motionScale;
    const driftY = Math.sin((t / DRIFT_Y_PERIOD_S) * Math.PI * 2) * DRIFT_Y_AMPLITUDE * motionScale;
    const breath = 1 + Math.sin((t / BREATH_PERIOD_S) * Math.PI * 2) * BREATH_SCALE * motionScale;
    const open = state.isDead ? 1 : blinkOpenness() * g.openMul;

    // height: L1 stage scale, widened by L3 perk, closed by squint (L3) or
    // death (L4)
    const baseHeightScale = state.isDead ? DEAD_HEIGHT : 1;
    let heightScale = (baseHeightScale + perk * PERK_WIDEN - effSquint * SQUINT_CLOSE * (state.isDead ? 0 : 1))
      * (1 + pulse * MUSIC_PULSE * perk);
    let widthScale = 1 + perk * PERK_WIDTH + effSquint * SQUINT_WIDTH * (state.isDead ? 0 : 1)
      + (1 - open) * LID_SQUASH_WIDTH;
    let brightnessOut = brightness;
    let cy = FACE_CY + driftY + droop + g.cyOff + gazeY;

    if (celebrating) {
      const progress = celebrationT / CELEBRATION_DURATION_S;
      const bounce = Math.abs(Math.sin(progress * Math.PI * CELEBRATION_HOPS)) * (1 - progress);
      cy -= bounce * CELEBRATION_BOUNCE_PX;
      heightScale *= 1 + CELEBRATION_PUFF * bounce;
      widthScale *= 1 + CELEBRATION_PUFF * CELEBRATION_PUFF_WIDTH_RATIO * bounce;
      brightnessOut = Math.max(brightnessOut, CELEBRATION_MIN_BRIGHTNESS + CELEBRATION_FLARE * bounce);
    }

    const h = BASE_EYE_H * stageScale * breath * heightScale * open;
    const w = BASE_EYE_W * stageScale * widthScale;
    const radii = [topR, topR, bottomR, bottomR]; // [tl, tr, br, bl]
    const xShift = driftX + g.xOff + g.gazeX;
    const spacing = EYE_SPACING * stageSpacing;

    return {
      // the four layers, for inspection/debugging and any renderer needs
      layers: {
        base: { stage: state.stage, branch: state.branch, glow: baseGlow, blinkIntervalMult },
        reactive: { moodCurve, drift: moodDrift },
        live: {
          active: inSession,
          wave: { active: hearingSomething && waveIntensity > 0.02, intensity: waveIntensity },
          widen: perk,
          glowPulse,
        },
        event: {
          blinking: blinkT >= 0,
          gesture: gesture ? gesture.name : null,
          celebrating,
          dead: !!state.isDead,
        },
      },
      // composed, ready-to-draw geometry (layers already applied 1→4)
      leftEye: {
        cx: FACE_CX - spacing / 2 + xShift, cy,
        w, h,
        radii, tilt: tiltBase + g.tiltOff - tiltSad,
      },
      rightEye: {
        cx: FACE_CX + spacing / 2 + xShift, cy,
        w, h,
        radii, tilt: tiltBase + g.tiltOff + tiltSad,
      },
      brightness: brightnessOut,
      glowPulse,
      dead: !!state.isDead,
      branch: state.branch,
      stage: state.stage,
      wave: { active: hearingSomething && waveIntensity > 0.02 && !state.isDead, intensity: waveIntensity },
      demeanor,      // debug label only
      celebrating,
    };
  }

  return { update, startCelebration };
}
