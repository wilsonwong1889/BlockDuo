import { beforeEach, describe, expect, it, vi } from 'vitest';

class FakeParam {
  value = 0;
  cancelScheduledValues() {}
  setValueAtTime(value: number) {
    this.value = value;
  }
  exponentialRampToValueAtTime(value: number) {
    this.value = value;
  }
  setTargetAtTime(value: number) {
    this.value = value;
  }
}

class FakeNode {
  connect<T>(node: T): T {
    return node;
  }
}

class FakeAudioContext {
  static created = 0;
  static oscillators = 0;
  static scheduled = 0;
  static resumes = 0;
  static initialState: AudioContextState = 'running';
  static rejectResume = false;
  static enterRunningOnResume = true;
  static latest: FakeAudioContext | null = null;
  currentTime = 0;
  sampleRate = 48_000;
  state: AudioContextState;
  destination = new FakeNode();

  constructor() {
    FakeAudioContext.created += 1;
    this.state = FakeAudioContext.initialState;
    FakeAudioContext.latest = this;
  }

  createGain() {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }

  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), {
      threshold: new FakeParam(),
      knee: new FakeParam(),
      ratio: new FakeParam(),
      attack: new FakeParam(),
      release: new FakeParam(),
    });
  }

  createOscillator() {
    FakeAudioContext.oscillators += 1;
    return Object.assign(new FakeNode(), {
      type: 'sine',
      frequency: new FakeParam(),
      start() {
        FakeAudioContext.scheduled += 1;
      },
      stop() {},
    });
  }

  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { sampleRate: this.sampleRate, getChannelData: () => data };
  }

  createBufferSource() {
    return Object.assign(new FakeNode(), {
      buffer: null,
      start() {
        FakeAudioContext.scheduled += 1;
      },
      stop() {},
    });
  }

  createBiquadFilter() {
    return Object.assign(new FakeNode(), {
      type: 'bandpass',
      Q: new FakeParam(),
      frequency: new FakeParam(),
    });
  }

  resume() {
    FakeAudioContext.resumes += 1;
    if (FakeAudioContext.rejectResume) return Promise.reject(new Error('NotAllowedError'));
    if (FakeAudioContext.enterRunningOnResume) this.state = 'running';
    return Promise.resolve();
  }
}

beforeEach(() => {
  vi.resetModules();
  FakeAudioContext.created = 0;
  FakeAudioContext.oscillators = 0;
  FakeAudioContext.scheduled = 0;
  FakeAudioContext.resumes = 0;
  FakeAudioContext.initialState = 'running';
  FakeAudioContext.rejectResume = false;
  FakeAudioContext.enterRunningOnResume = true;
  FakeAudioContext.latest = null;
  vi.stubGlobal('window', { AudioContext: FakeAudioContext });
});

describe('synthesised sound effects', () => {
  it('does not construct or schedule audio while muted', async () => {
    const sfx = await import('../src/audio/sfx');
    sfx.setMuted(true);
    sfx.playPlace();
    sfx.playClear(4, 5);

    expect(FakeAudioContext.created).toBe(0);
    expect(FakeAudioContext.oscillators).toBe(0);
  });

  it('uses one shared graph and stops scheduling immediately after muting', async () => {
    const sfx = await import('../src/audio/sfx');
    sfx.unlockAudio();
    sfx.playPlace();
    const beforeMute = FakeAudioContext.oscillators;
    sfx.setMuted(true);
    sfx.playPlace();

    expect(FakeAudioContext.created).toBe(1);
    expect(FakeAudioContext.oscillators).toBe(beforeMute);
  });

  it('reuses the graph after sound is turned back on', async () => {
    const sfx = await import('../src/audio/sfx');
    sfx.unlockAudio();
    sfx.playPlace();
    sfx.setMuted(true);
    sfx.setMuted(false);
    sfx.playPlace();

    expect(FakeAudioContext.created).toBe(1);
    expect(FakeAudioContext.oscillators).toBe(2);
  });

  it('fails silently when browser audio is unavailable', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    const sfx = await import('../src/audio/sfx');

    expect(() => sfx.playClear(2, 2)).not.toThrow();
  });

  it('widens clear chords but caps the number of active oscillator voices', async () => {
    const sfx = await import('../src/audio/sfx');
    sfx.unlockAudio();
    sfx.playClear(1, 1);
    const oneLineVoices = FakeAudioContext.oscillators;
    sfx.playClear(99, 99);
    const maxClearVoices = FakeAudioContext.oscillators - oneLineVoices;

    expect(oneLineVoices).toBe(3); // impact body + two-note chord
    expect(maxClearVoices).toBe(7); // impact body + five-note chord + shimmer
    expect(FakeAudioContext.created).toBe(1);
  });

  it('does not create or schedule a graph before explicit user activation', async () => {
    const sfx = await import('../src/audio/sfx');

    sfx.playPlace();
    sfx.playClear(4, 4);

    expect(FakeAudioContext.created).toBe(0);
    expect(FakeAudioContext.scheduled).toBe(0);
  });

  it('drops sounds while resume is rejected and allows a later activation to retry', async () => {
    FakeAudioContext.initialState = 'suspended';
    FakeAudioContext.rejectResume = true;
    const sfx = await import('../src/audio/sfx');

    sfx.unlockAudio();
    await Promise.resolve();
    await Promise.resolve();
    sfx.playClear(4, 6);

    expect(FakeAudioContext.resumes).toBe(1);
    expect(FakeAudioContext.scheduled).toBe(0);

    FakeAudioContext.rejectResume = false;
    sfx.unlockAudio();
    await Promise.resolve();
    sfx.playPlace();

    expect(FakeAudioContext.resumes).toBe(2);
    expect(FakeAudioContext.scheduled).toBe(2);
  });

  it('does not queue a sound backlog while the context remains suspended', async () => {
    FakeAudioContext.initialState = 'suspended';
    FakeAudioContext.enterRunningOnResume = false;
    const sfx = await import('../src/audio/sfx');

    sfx.unlockAudio();
    await Promise.resolve();
    sfx.playPlace();
    sfx.playClear(4, 6);
    sfx.playPerfect();

    expect(FakeAudioContext.scheduled).toBe(0);

    FakeAudioContext.latest!.state = 'running';
    sfx.playPlace();

    // Only the post-resume placement is scheduled: one noise source and one tone.
    expect(FakeAudioContext.scheduled).toBe(2);
  });
});
