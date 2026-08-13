/**
 * Sound effects, synthesised at runtime.
 *
 * No audio files: everything here is an oscillator and a gain envelope, which
 * keeps the bundle tiny, sidesteps asset licensing entirely, and lets the pitch
 * respond to the streak instead of playing the same clip over and over.
 *
 * The AudioContext is created lazily on first user gesture — browsers refuse to
 * start one before that, and creating it eagerly leaves a suspended context.
 */

interface AudioGraph {
  context: AudioContext;
  master: GainNode;
  output: AudioNode;
}

let graph: AudioGraph | null = null;
let noiseBuffer: AudioBuffer | null = null;
let muted = false;
let resumeInFlight: Promise<void> | null = null;

export function setMuted(value: boolean) {
  muted = value;
  if (graph) {
    const now = graph.context.currentTime;
    graph.master.gain.cancelScheduledValues(now);
    graph.master.gain.setTargetAtTime(value ? 0 : 0.72, now, 0.012);
  }
}

export function isMuted() {
  return muted;
}

function createAudioGraph(): AudioGraph | null {
  if (muted) return null;
  if (!graph) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      const context = new Ctor();
      const master = context.createGain();
      master.gain.value = 0.72;

      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -18;
      compressor.knee.value = 12;
      compressor.ratio.value = 4;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.18;
      master.connect(compressor).connect(context.destination);
      graph = { context, master, output: master };
    } catch {
      // Audio is enhancement only. Device/context limits must never stop play.
      return null;
    }
  }
  return graph;
}

/**
 * Called only from user activation. Playback never creates or resumes a context:
 * sounds received while suspended are dropped instead of being queued into a
 * burst that plays on the next tap.
 */
export function unlockAudio() {
  const active = createAudioGraph();
  if (!active || active.context.state === 'running' || active.context.state === 'closed') return;
  if (resumeInFlight) return;

  try {
    resumeInFlight = active.context
      .resume()
      .catch(() => {
        // Autoplay policy and device limits may reject resume. A later genuine
        // user activation can retry; audio must never surface an unhandled error.
      })
      .finally(() => {
        resumeInFlight = null;
      });
  } catch {
    // Some WebKit versions can throw synchronously when the context is unusable.
    resumeInFlight = null;
  }
}

/** Return only an explicitly created graph that is safe to schedule right now. */
function audio(): AudioGraph | null {
  if (muted || !graph || graph.context.state !== 'running') return null;
  return graph;
}

interface ToneOptions {
  freq: number;
  duration?: number;
  type?: OscillatorType;
  gain?: number;
  /** Slide to this frequency over the note's life. */
  glideTo?: number;
  delay?: number;
}

function tone({ freq, duration = 0.12, type = 'triangle', gain = 0.16, glideTo, delay = 0 }: ToneOptions) {
  const active = audio();
  if (!active) return;
  const { context: ac } = active;
  const start = ac.currentTime + delay;

  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(glideTo, 1), start + duration);

  const env = ac.createGain();
  // A short attack stops the click that an instant ramp-up produces.
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  osc.connect(env).connect(active.output);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

interface NoiseOptions {
  duration: number;
  gain: number;
  from: number;
  to: number;
  delay?: number;
}

function noise({ duration, gain, from, to, delay = 0 }: NoiseOptions) {
  const active = audio();
  if (!active) return;
  const { context: ac } = active;
  if (!noiseBuffer || noiseBuffer.sampleRate !== ac.sampleRate) {
    noiseBuffer = ac.createBuffer(1, Math.ceil(ac.sampleRate * 0.3), ac.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
  }

  const start = ac.currentTime + delay;
  const source = ac.createBufferSource();
  source.buffer = noiseBuffer;
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(Math.max(1, from), start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, start);
  env.gain.exponentialRampToValueAtTime(gain, start + 0.006);
  env.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  source.connect(filter).connect(env).connect(active.output);
  source.start(start);
  source.stop(start + duration + 0.01);
}

/** A piece landing on the board: short, dry, low. */
export function playPlace() {
  noise({ duration: 0.038, gain: 0.035, from: 1900, to: 620, delay: 0 });
  tone({ freq: 172, glideTo: 118, duration: 0.075, type: 'sine', gain: 0.075 });
}

/** Trying to drop a piece where it does not fit. */
export function playReject() {
  tone({ freq: 130, glideTo: 90, duration: 0.14, type: 'sawtooth', gain: 0.07 });
}

/**
 * A line clear. More simultaneous lines widen the chord; a continuing chain
 * raises its pentatonic contour and eventually adds shimmer instead of getting
 * endlessly higher and harsher.
 */
export interface ClearSoundPlan {
  root: number;
  intervals: number[];
  shimmer: boolean;
}

/** Pure and capped so extreme chains remain warm instead of becoming shrill. */
export function clearSoundPlan(lines: number, streakAfter: number): ClearSoundPlan {
  const chainSteps = [0, 2, 4, 7, 9, 12];
  const chainIndex = Math.min(Math.max(0, Math.floor(streakAfter) - 1), chainSteps.length - 1);
  const voices = Math.min(5, Math.max(2, Math.floor(lines) + 1));
  return {
    root: 392 * Math.pow(2, chainSteps[chainIndex] / 12),
    intervals: [0, 7, 12, 16, 19].slice(0, voices),
    shimmer: streakAfter >= 6,
  };
}

export function playClear(lines: number, streakAfter: number) {
  const plan = clearSoundPlan(lines, streakAfter);
  const voiceGain = 0.14 / Math.sqrt(plan.intervals.length);

  // A soft impact gives the clear weight; the glassy chord and sweep carry the reward.
  tone({ freq: 118, glideTo: 78, duration: 0.1, type: 'sine', gain: 0.075 });
  noise({ duration: 0.13, gain: 0.045, from: 950, to: 4700, delay: 0.025 });
  for (let i = 0; i < plan.intervals.length; i++) {
    tone({
      freq: plan.root * Math.pow(2, plan.intervals[i] / 12),
      duration: plan.shimmer ? 0.34 : 0.24,
      type: i === 0 ? 'sine' : 'triangle',
      gain: voiceGain,
      delay: 0.035 + i * 0.034,
    });
  }
  if (plan.shimmer) {
    tone({
      freq: plan.root * 4,
      glideTo: plan.root * 4.5,
      duration: 0.36,
      type: 'sine',
      gain: 0.026,
      delay: 0.11,
    });
  }
}

/** Wiping the board completely. */
export function playPerfect() {
  tone({ freq: 92, glideTo: 65, duration: 0.48, type: 'sine', gain: 0.11, delay: 0.1 });
  [0, 7, 12, 19, 24].forEach((step, i) =>
    tone({
      freq: 523 * Math.pow(1.0595, step),
      duration: 0.4,
      type: 'sine',
      gain: 0.14,
      delay: 0.14 + i * 0.065,
    }),
  );
}

export function playGameOver() {
  [0, -3, -7, -12].forEach((step, i) =>
    tone({
      freq: 330 * Math.pow(1.0595, step),
      duration: 0.45,
      type: 'triangle',
      gain: 0.12,
      delay: i * 0.13,
    }),
  );
}

/** Duo mode: it just became your turn. */
export function playYourTurn() {
  tone({ freq: 660, glideTo: 880, duration: 0.16, type: 'sine', gain: 0.1 });
}
