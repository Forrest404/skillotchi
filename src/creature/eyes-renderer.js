// eyes-renderer.js — canvas drawing only. Draws the composed face the
// expression layer outputs; makes no decisions about geometry, color, or
// mood, and never touches audio APIs. All coordinates are in the 320x240
// logical space (CYD resolution); main.js scales the context.
//
// Eyes-only contract: nothing renders outside the two eye shapes. The live
// waveform is an oscilloscope trace CLIPPED INSIDE each eye (main.js hands
// the raw sample buffer in as plain data). drawEnclosureMask() blacks out
// everything except the two live eye shapes — dev-only preview of the
// physical cutouts.

export const LOGICAL_WIDTH = 320;
export const LOGICAL_HEIGHT = 240;

// Evolution-branch palettes (the COLOR axis): thriving = bright digital
// blue, neglected = desaturated slate. Death overrides both with gray.
// Brightness scaling comes from the expression layer (vitality baseline).
const PALETTES = {
  thriving:  { r: 70,  g: 190, b: 255 },
  neglected: { r: 110, g: 145, b: 160 },
  dead:      { r: 105, g: 110, b: 115 },
};
const GLOW_BLUR_DEVICE_PX = 26; // canvas shadows ignore ctx.scale, so device px
const GLOW_PULSE_BOOST = 0.9;   // extra glow at full amplitude pulse (Layer 3)
const DEAD_GLOW_FACTOR = 0.3;   // barely any glow when dead

// interior waveform (oscilloscope inside each eye)
const WAVE_TRACE_POINTS = 36;   // polyline points across the eye's width
const WAVE_TRACE_GAIN = 3;      // raw samples are quiet; amplify before clipping
const WAVE_TRACE_HEIGHT = 0.8;  // fraction of eye half-height the trace may use
const WAVE_TRACE_WIDTH_INSET = 3; // logical px kept clear at the eye's edges
const WAVE_TRACE_LINE_WIDTH = 2;
const WAVE_TRACE_COLOR = 'rgba(8, 18, 28, 0.65)'; // dark trace over the bright fill

function paletteFor(face) {
  if (face.dead) return PALETTES.dead;
  return PALETTES[face.branch] || PALETTES.thriving;
}

// The eye's rounded-rect path in its own local space (call under
// translate/rotate). Shared by the fill, the waveform clip, and the
// enclosure mask so all three always agree on the exact shape.
function eyePath(ctx, eye) {
  const maxRadius = Math.min(eye.w, eye.h) / 2;
  const radii = eye.radii.map((r) => Math.max(1, Math.min(r, maxRadius)));
  ctx.roundRect(-eye.w / 2, -eye.h / 2, eye.w, eye.h, radii);
}

export function drawFace(ctx, face, waveSamples) {
  ctx.clearRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  const palette = paletteFor(face);
  const b = face.brightness;
  const color = `rgb(${Math.round(palette.r * b)}, ${Math.round(palette.g * b)}, ${Math.round(palette.b * b)})`;
  const glow = GLOW_BLUR_DEVICE_PX * b
    * (face.dead ? DEAD_GLOW_FACTOR : 1)
    * (1 + (face.glowPulse || 0) * GLOW_PULSE_BOOST); // Layer 3: amplitude pulse

  ctx.save();
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = glow;
  drawEye(ctx, face.leftEye, face, waveSamples);
  drawEye(ctx, face.rightEye, face, waveSamples);
  ctx.restore();
}

function drawEye(ctx, eye, face, waveSamples) {
  ctx.save();
  ctx.translate(eye.cx, eye.cy);
  if (eye.tilt) ctx.rotate(eye.tilt);

  ctx.beginPath();
  eyePath(ctx, eye);
  ctx.fill();

  // Layer 3: live oscilloscope, strictly clipped to this eye's own shape —
  // the clip is the same path as the fill, so it tracks every resize
  // (life stage, blink, drift) automatically.
  if (face.wave && face.wave.active && waveSamples && waveSamples.length) {
    ctx.beginPath();
    eyePath(ctx, eye);
    ctx.clip();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = WAVE_TRACE_COLOR;
    ctx.lineWidth = WAVE_TRACE_LINE_WIDTH;
    ctx.lineJoin = 'round';
    const x0 = -eye.w / 2 + WAVE_TRACE_WIDTH_INSET;
    const x1 = eye.w / 2 - WAVE_TRACE_WIDTH_INSET;
    const yMax = (eye.h / 2) * WAVE_TRACE_HEIGHT;
    const stride = Math.max(1, Math.floor(waveSamples.length / WAVE_TRACE_POINTS));
    ctx.beginPath();
    for (let i = 0; i < WAVE_TRACE_POINTS; i++) {
      const sample = waveSamples[Math.min(waveSamples.length - 1, i * stride)];
      const x = x0 + (i / (WAVE_TRACE_POINTS - 1)) * (x1 - x0);
      const y = -Math.max(-1, Math.min(1, sample * WAVE_TRACE_GAIN)) * yMax * face.wave.intensity;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  ctx.restore();
}

// Dev-only enclosure preview: solid black everywhere except windows exactly
// matching the CURRENT eye shapes (per-frame geometry, never hardcoded).
export function drawEnclosureMask(ctx, face) {
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.rect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  for (const eye of [face.leftEye, face.rightEye]) {
    ctx.save();
    ctx.translate(eye.cx, eye.cy);
    if (eye.tilt) ctx.rotate(eye.tilt);
    eyePath(ctx, eye); // sub-path recorded under the eye's own transform
    ctx.restore();
  }
  ctx.fill('evenodd'); // eye sub-paths become windows in the black cover
  ctx.restore();
}
