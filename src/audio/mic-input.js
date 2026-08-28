// mic-input.js — microphone capture only. Owns getUserMedia + AudioContext +
// AnalyserNode. Exposes a pull-based API: call getSamples() each frame for
// the latest time-domain buffer. Zero DOM/canvas code in this file — the
// caller decides how to present permission prompts and errors.
//
// Designed so an unanswered permission prompt can never wedge it: state is
// observable every frame ('prompting' while Chrome's prompt is up), repeated
// start() calls reuse the pending request instead of stacking prompts, and
// a late "Allow" still lands (state flips to 'active' whenever it settles).
// stop() releases the microphone entirely (recording indicator goes off);
// the AudioContext is kept for cheap restarts.

export const FFT_SIZE = 2048; // samples per analysis buffer (~43ms @ 48kHz)

export function createMicInput() {
  let audioContext = null;
  let analyser = null;
  let stream = null;
  let state = 'idle'; // 'idle' | 'prompting' | 'active' | 'denied' | 'error' | 'unsupported'
  let errorMessage = null;
  let pendingRequest = null;
  const buffer = new Float32Array(FFT_SIZE);

  // Call from a user gesture (browser requirement). Safe to call repeatedly:
  // returns the in-flight request if one is still waiting on the prompt.
  function start() {
    if (state === 'active') return Promise.resolve(state);
    if (pendingRequest) return pendingRequest;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      state = 'unsupported';
      errorMessage = 'microphone API unavailable (needs https or localhost)';
      return Promise.resolve(state);
    }

    // Create/resume the AudioContext synchronously, inside the user gesture,
    // BEFORE any await — so autoplay policy can't leave it suspended.
    if (!audioContext) audioContext = new AudioContext();
    if (audioContext.state === 'suspended') audioContext.resume();

    state = 'prompting';
    errorMessage = null;
    pendingRequest = (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            // Keep echo/noise processing off (it mangles instrument
            // harmonics) but let auto-gain boost quiet or distant playing —
            // pitch detection is amplitude-invariant, so AGC only helps.
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true,
          },
        });
        const source = audioContext.createMediaStreamSource(stream);
        analyser = audioContext.createAnalyser();
        analyser.fftSize = FFT_SIZE;
        source.connect(analyser);
        if (audioContext.state === 'suspended') await audioContext.resume();

        // Device unplugged / permission revoked mid-use -> back to idle.
        const track = stream.getAudioTracks()[0];
        if (track) {
          track.addEventListener('ended', () => {
            state = 'idle';
            analyser = null;
            stream = null;
            errorMessage = 'microphone stopped';
          });
        }
        state = 'active';
      } catch (err) {
        state = err && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
          ? 'denied'
          : 'error';
        errorMessage = err && err.message ? err.message : String(err);
      } finally {
        pendingRequest = null; // never latches shut, whatever happened
      }
      return state;
    })();
    return pendingRequest;
  }

  // Latest time-domain samples, or null if the mic isn't running.
  // Returns the same Float32Array each call — consume it synchronously.
  function getSamples() {
    if (state !== 'active' || !analyser) return null;
    analyser.getFloatTimeDomainData(buffer);
    return buffer;
  }

  // Release the microphone completely — Chrome's recording indicator turns
  // off. Permission stays granted, so the next start() is instant.
  function stop() {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    analyser = null;
    if (state === 'active') state = 'idle';
    if (audioContext && audioContext.state === 'running') audioContext.suspend();
  }

  return {
    start,
    stop,
    getSamples,
    get sampleRate() { return audioContext ? audioContext.sampleRate : 0; },
    get state() { return state; },
    get errorMessage() { return errorMessage; },
  };
}
