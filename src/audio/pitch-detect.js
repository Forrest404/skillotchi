// pitch-detect.js — pure pitch detection. No DOM, no audio APIs, no side
// effects: (buffer, sampleRate) in, {pitchHz, note, cents, confidence,
// amplitude} out. Autocorrelation-based (normalized ACF), not FFT peak
// picking — ACF ports cleanly to a microcontroller.

// --- tuning constants ---------------------------------------------------
export const CONFIDENCE_THRESHOLD = 0.8;  // normalized ACF peak needed to count as "confident pitch"
export const RELAXED_CONFIDENCE = 0.5;     // "musical sound" — the practice counter keys off this
const MIN_FREQ_HZ = 60;                  // search range (covers guitar low E ~82Hz with margin)
const MAX_FREQ_HZ = 1200;
const MIN_RMS = 0.003;                   // below this RMS: treat as silence, skip ACF
const MIN_PEAK_VALUE = 0.3;              // ACF peaks below this aren't worth reporting a pitch for
const OCTAVE_PEAK_RATIO = 0.85;          // prefer the lowest-lag peak within this ratio of the best
// ------------------------------------------------------------------------

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function detectPitch(buffer, sampleRate) {
  const n = buffer.length;

  // remove DC offset (cheap mics have bias, and it skews the correlation)
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buffer[i];
  mean /= n;

  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const v = buffer[i] - mean;
    sumSq += v * v;
  }
  const amplitude = Math.sqrt(sumSq / n);

  // `!(x >= y)` also catches NaN
  if (!(amplitude >= MIN_RMS)) return noPitch(amplitude);

  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buffer[i] - mean;

  const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQ_HZ));
  const maxLag = Math.min(n - 2, Math.ceil(sampleRate / MIN_FREQ_HZ));
  if (minLag >= maxLag) return noPitch(amplitude);

  // Normalized autocorrelation: correlate x[0..W) against x[lag..lag+W),
  // W fixed so every lag compares windows of equal length.
  const W = n - maxLag;
  const acf = new Float32Array(maxLag + 1);
  let energy0 = 0;
  for (let i = 0; i < W; i++) energy0 += x[i] * x[i];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let dot = 0;
    let energyLag = 0;
    for (let i = 0; i < W; i++) {
      dot += x[i] * x[i + lag];
      energyLag += x[i + lag] * x[i + lag];
    }
    acf[lag] = dot / (Math.sqrt(energy0 * energyLag) + 1e-12);
  }

  // Find the strongest local maximum, then prefer the lowest-lag local max
  // that comes close to it (guards against octave-down errors, where the
  // peak at 2x the true period edges out the true one).
  let bestValue = -Infinity;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag] >= acf[lag - 1] && acf[lag] > acf[lag + 1] && acf[lag] > bestValue) {
      bestValue = acf[lag];
    }
  }
  if (bestValue < MIN_PEAK_VALUE) {
    return noPitch(amplitude, Math.max(0, bestValue === -Infinity ? 0 : bestValue));
  }
  let peakLag = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (acf[lag] >= acf[lag - 1] && acf[lag] > acf[lag + 1] && acf[lag] >= bestValue * OCTAVE_PEAK_RATIO) {
      peakLag = lag;
      break;
    }
  }

  // Parabolic interpolation around the peak for sub-sample lag precision.
  const alpha = acf[peakLag - 1];
  const beta = acf[peakLag];
  const gamma = acf[peakLag + 1];
  const denom = alpha - 2 * beta + gamma;
  const offset = denom === 0 ? 0 : 0.5 * (alpha - gamma) / denom;
  const interpolatedLag = peakLag + offset;

  const pitchHz = sampleRate / interpolatedLag;
  const confidence = Math.min(1, Math.max(0, acf[peakLag]));

  const midiFloat = 69 + 12 * Math.log2(pitchHz / 440);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const note = NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);

  return { pitchHz, note, cents, confidence, amplitude };
}

function noPitch(amplitude, confidence = 0) {
  return { pitchHz: null, note: null, cents: null, confidence, amplitude };
}
