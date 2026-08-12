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

let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(value: boolean) {
  muted = value;
}

export function isMuted() {
  return muted;
}

function audio(): AudioContext | null {
  if (muted) return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
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
  const ac = audio();
  if (!ac) return;
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

  osc.connect(env).connect(ac.destination);
  osc.start(start);
  osc.stop(start + duration + 0.02);
}

/** A piece landing on the board: short, dry, low. */
export function playPlace() {
  tone({ freq: 210, glideTo: 150, duration: 0.09, type: 'square', gain: 0.1 });
}

/** Trying to drop a piece where it does not fit. */
export function playReject() {
  tone({ freq: 130, glideTo: 90, duration: 0.14, type: 'sawtooth', gain: 0.07 });
}

/**
 * A line clear. Each additional line adds a note further up the arpeggio, and
 * the whole run is transposed up by the streak — so a long streak audibly
 * climbs, which is most of the reward for keeping one alive.
 */
export function playClear(lines: number, streak: number) {
  const root = 392 * Math.pow(1.0595, Math.min(streak, 8) * 2);
  const steps = [0, 4, 7, 12, 16, 19, 24, 28];
  for (let i = 0; i < Math.min(lines, steps.length); i++) {
    tone({
      freq: root * Math.pow(1.0595, steps[i]),
      duration: 0.22,
      type: 'triangle',
      gain: 0.13,
      delay: i * 0.055,
    });
  }
}

/** Wiping the board completely. */
export function playPerfect() {
  [0, 7, 12, 19, 24].forEach((step, i) =>
    tone({
      freq: 523 * Math.pow(1.0595, step),
      duration: 0.4,
      type: 'sine',
      gain: 0.14,
      delay: i * 0.07,
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
