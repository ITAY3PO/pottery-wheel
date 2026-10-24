import type { Audio, SoundId } from './types';

export const MUTE_STORAGE_KEY = 'pottery-wheel:muted';

/** Master trim so the wheel, a hand, and the kiln can overlap without clipping. */
const MASTER_GAIN = 0.8;

const WHEEL_FREQ_MIN = 50;
const WHEEL_FREQ_SPAN = 62;
const WHEEL_GAIN = 0.09;
const WHEEL_GAIN_FLOOR = 0.016;
const SQUISH_PEAK = 0.2;
const SQUISH_FREQ_MIN = 240;
const SQUISH_FREQ_SPAN = 780;

const WIND_UP_FREQ = 0.36;
const WIND_UP_GAIN = 0.22;
const WIND_DOWN_FREQ = 0.82;
const WIND_DOWN_GAIN = 1.05;

export interface AudioEngineOptions {
  storage?: Storage | null;
  now?: () => number;
  /**
   * Build an AudioContext. Return null when the platform cannot play audio.
   * Omit to use the browser constructor.
   */
  createContext?: () => AudioContext | null;
}

export function wheelFundamental(speed: number): number {
  return WHEEL_FREQ_MIN + clamp01(speed) * WHEEL_FREQ_SPAN;
}

export function wheelLevel(speed: number): number {
  const s = clamp01(speed);
  if (s <= 0.001) return 0.0001;
  return WHEEL_GAIN_FLOOR + s * WHEEL_GAIN;
}

export function wheelWind(rising: boolean): { frequency: number; gain: number } {
  return rising
    ? { frequency: WIND_UP_FREQ, gain: WIND_UP_GAIN }
    : { frequency: WIND_DOWN_FREQ, gain: WIND_DOWN_GAIN };
}

/** Wet squish loudness. Dry clay and a light touch both go quiet. */
export function squishLevel(pressure: number, moisture: number): number {
  return clamp01(pressure) * clamp01(moisture) * SQUISH_PEAK;
}

/** Wetter clay is duller; drier contact moves up into a thinner band. */
export function squishCenter(moisture: number): number {
  return SQUISH_FREQ_MIN + (1 - clamp01(moisture)) * SQUISH_FREQ_SPAN;
}

export class PotteryAudio implements Audio {
  private readonly storage: Storage | null;
  private readonly now: () => number;
  private readonly createContext: () => AudioContext | null;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private unlocked = false;
  private mutedFlag: boolean;
  private muteListener: ((muted: boolean) => void) | null = null;

  private wheelTarget = 0;
  private wheelApplied = -1;
  private motor: MotorGraph | null = null;
  private motorReleaseAt = 0;

  private contactP = 0;
  private contactM = 0;
  private contactAppliedP = -1;
  private contactAppliedM = -1;
  private squish: SquishGraph | null = null;
  private squishReleaseAt = 0;

  private kilnWanted = false;
  private kiln: LiveGraph | null = null;
  private queued: SoundId[] = [];

  private brownBuffer: AudioBuffer | null = null;
  private whiteBuffer: AudioBuffer | null = null;

  constructor(options: AudioEngineOptions = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.now = options.now ?? browserNow;
    this.createContext = options.createContext ?? browserContext;
    this.mutedFlag = readMuted(this.storage);
  }

  get muted(): boolean {
    return this.mutedFlag;
  }

  /** The mute button listens here. Called immediately with the stored value. */
  setMuteListener(listener: (muted: boolean) => void): void {
    this.muteListener = listener;
    listener(this.mutedFlag);
  }

  unlock(): void {
    if (this.unlocked && this.ctx) {
      if (!this.mutedFlag && this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    this.unlocked = true;
    if (this.mutedFlag) return;
    if (!this.boot()) return;
    this.flush();
  }

  setWheel(speed: number): void {
    if (!Number.isFinite(speed)) return;
    this.wheelTarget = clamp01(speed);
    if (!this.canSpeak()) return;
    this.pushWheel(false);
  }

  setContact(pressure: number, moisture: number): void {
    if (!Number.isFinite(pressure) || !Number.isFinite(moisture)) return;
    this.contactP = clamp01(pressure);
    this.contactM = clamp01(moisture);
    if (!this.canSpeak()) return;
    this.pushContact(false);
  }

  play(id: SoundId): void {
    if (id === 'kilnLoop') {
      this.kilnWanted = true;
      if (this.canSpeak()) this.syncKiln();
      return;
    }
    if (this.mutedFlag) return;
    if (!this.canSpeak()) {
      // A tap may unlock a moment later. Remember a few one-shots; drop them if muted.
      if (!this.unlocked) {
        this.queued.push(id);
        if (this.queued.length > 4) this.queued.shift();
      }
      return;
    }
    this.voice(id);
  }

  stop(id: 'kilnLoop'): void {
    if (id !== 'kilnLoop') return;
    this.kilnWanted = false;
    this.teardownKiln();
  }

  setMuted(m: boolean): void {
    this.mutedFlag = m;
    writeMuted(this.storage, m);
    this.muteListener?.(m);
    if (m) this.queued.length = 0;
    if (!this.unlocked) return;
    if (m) {
      if (this.master && this.ctx) this.master.gain.setValueAtTime(0, this.ctx.currentTime);
      if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
      return;
    }
    if (!this.boot()) return;
    this.master?.gain.setValueAtTime(MASTER_GAIN, this.ctx?.currentTime ?? 0);
    void this.ctx?.resume();
    this.flush();
  }

  private canSpeak(): boolean {
    return this.unlocked && !this.mutedFlag && this.ctx != null && this.master != null;
  }

  private boot(): boolean {
    if (this.ctx && this.master) return true;
    let ctx: AudioContext | null = null;
    try {
      ctx = this.createContext();
    } catch {
      return false;
    }
    if (!ctx) return false;
    try {
      const master = ctx.createGain();
      master.gain.value = this.mutedFlag ? 0 : MASTER_GAIN;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      void ctx.resume();
      return true;
    } catch {
      return false;
    }
  }

  private flush(): void {
    const queued = this.queued.splice(0);
    for (const id of queued) this.voice(id);
    this.syncKiln();
    this.pushWheel(true);
    this.pushContact(true);
  }

  private pushWheel(force: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const target = this.wheelTarget;
    if (target <= 0.001) {
      if (!this.motor) {
        this.wheelApplied = 0;
        return;
      }
      if (force || this.wheelApplied > 0.001) this.applyWheel(0, false);
      this.wheelApplied = 0;
      // Gain wind-down is about a second. Hold the graph long enough to finish
      // the coast, then drop it so an idle phone is not running oscillators.
      if (this.motorReleaseAt === 0) this.motorReleaseAt = this.now() + 3200;
      if (this.now() >= this.motorReleaseAt) this.teardownMotor();
      return;
    }
    this.motorReleaseAt = 0;
    const rising = target >= this.wheelApplied;
    if (!force && Math.abs(target - this.wheelApplied) < 0.004) return;
    this.ensureMotor();
    this.applyWheel(target, rising);
    this.wheelApplied = target;
  }

  private ensureMotor(): void {
    if (this.motor || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const fundamental = ctx.createOscillator();
    fundamental.type = 'triangle';
    const whine = ctx.createOscillator();
    whine.type = 'sine';
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.22;

    const air = ctx.createBufferSource();
    air.buffer = this.noise('brown');
    air.loop = true;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.Q.value = 0.6;
    const airGain = ctx.createGain();
    airGain.gain.value = 0.35;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0.0001;

    fundamental.connect(filter);
    whine.connect(whineGain);
    whineGain.connect(filter);
    filter.connect(gain);
    air.connect(airFilter);
    airFilter.connect(airGain);
    airGain.connect(gain);
    gain.connect(this.master);

    const t = ctx.currentTime;
    fundamental.start(t);
    whine.start(t);
    air.start(t);

    this.motor = {
      fundamental,
      whine,
      air,
      airFilter,
      filter,
      gain,
      whineGain,
      sources: [fundamental, whine, air],
      nodes: [fundamental, whine, whineGain, air, airFilter, airGain, filter, gain],
    };
  }

  private applyWheel(speed: number, rising: boolean): void {
    const motor = this.motor;
    const ctx = this.ctx;
    if (!motor || !ctx) return;
    const t = ctx.currentTime;
    const wind = wheelWind(rising);
    const freq = wheelFundamental(speed);
    motor.fundamental.frequency.setTargetAtTime(freq, t, wind.frequency);
    motor.whine.frequency.setTargetAtTime(150 + speed * 520, t, wind.frequency);
    motor.filter.frequency.setTargetAtTime(190 + speed * 1080, t, wind.frequency);
    motor.airFilter.frequency.setTargetAtTime(160 + speed * 860, t, wind.frequency);
    motor.gain.gain.setTargetAtTime(wheelLevel(speed), t, wind.gain);
  }

  private teardownMotor(): void {
    const motor = this.motor;
    this.motor = null;
    this.motorReleaseAt = 0;
    this.wheelApplied = 0;
    if (!motor) return;
    stopSources(motor.sources, this.ctx?.currentTime ?? 0);
    disconnectAll(motor.nodes);
  }

  private pushContact(force: boolean): void {
    if (!this.ctx || !this.master) return;
    const level = this.contactP * this.contactM;
    if (level < 0.002) {
      const wasSounding = this.contactAppliedP * this.contactAppliedM >= 0.002;
      if (this.squish && (force || wasSounding)) this.applySquish(0, 0);
      this.contactAppliedP = this.contactP;
      this.contactAppliedM = this.contactM;
      if (!this.squish) return;
      if (this.squishReleaseAt === 0) this.squishReleaseAt = this.now() + 320;
      if (this.now() >= this.squishReleaseAt) this.teardownSquish();
      return;
    }
    this.squishReleaseAt = 0;
    const changed =
      Math.abs(this.contactP - this.contactAppliedP) >= 0.01 ||
      Math.abs(this.contactM - this.contactAppliedM) >= 0.01;
    if (!force && !changed) return;
    this.ensureSquish();
    this.applySquish(this.contactP, this.contactM);
    this.contactAppliedP = this.contactP;
    this.contactAppliedM = this.contactM;
  }

  private ensureSquish(): void {
    if (this.squish || !this.ctx || !this.master) return;
    const ctx = this.ctx;
    const source = ctx.createBufferSource();
    source.buffer = this.noise('brown');
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master);
    source.start(ctx.currentTime);
    this.squish = { source, filter, gain, sources: [source], nodes: [source, filter, gain] };
  }

  private applySquish(pressure: number, moisture: number): void {
    const squish = this.squish;
    const ctx = this.ctx;
    if (!squish || !ctx) return;
    const t = ctx.currentTime;
    const level = squishLevel(pressure, moisture);
    const rising = level >= squishLevel(this.contactAppliedP, this.contactAppliedM);
    squish.filter.frequency.setTargetAtTime(squishCenter(moisture), t, 0.06);
    squish.filter.Q.setTargetAtTime(0.8 + clamp01(moisture) * 1.6, t, 0.08);
    squish.gain.gain.setTargetAtTime(Math.max(0.0001, level), t, rising ? 0.045 : 0.14);
  }

  private teardownSquish(): void {
    const squish = this.squish;
    this.squish = null;
    this.squishReleaseAt = 0;
    if (!squish) return;
    stopSources(squish.sources, this.ctx?.currentTime ?? 0);
    disconnectAll(squish.nodes);
  }

  private syncKiln(): void {
    if (!this.canSpeak()) return;
    if (!this.kilnWanted) {
      this.teardownKiln();
      return;
    }
    if (this.kiln) return;
    this.startKiln();
  }

  private startKiln(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const roar = ctx.createBufferSource();
    roar.buffer = this.noise('brown');
    roar.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.value = 0.16;
    const rumble = ctx.createOscillator();
    rumble.type = 'sine';
    rumble.frequency.value = 52;
    const rumbleGain = ctx.createGain();
    rumbleGain.gain.value = 0.045;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.17;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.028;

    roar.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    rumble.connect(rumbleGain);
    rumbleGain.connect(master);
    lfo.connect(lfoGain);
    lfoGain.connect(gain.gain);

    roar.start(t);
    rumble.start(t);
    lfo.start(t);
    this.kiln = {
      sources: [roar, rumble, lfo],
      nodes: [roar, filter, gain, rumble, rumbleGain, lfo, lfoGain],
    };
  }

  private teardownKiln(): void {
    const kiln = this.kiln;
    this.kiln = null;
    if (!kiln) return;
    stopSources(kiln.sources, this.ctx?.currentTime ?? 0);
    disconnectAll(kiln.nodes);
  }

  private voice(id: SoundId): void {
    if (id === 'kilnLoop') return;
    try {
      if (id === 'wire') this.wire();
      else if (id === 'splash') this.splash();
      else if (id === 'kilnDoor') this.kilnDoor();
      else if (id === 'ting') this.ting();
    } catch {
      // A closed or partial context should not break the wheel.
    }
  }

  private wire(): void {
    this.shapedNoise({ type: 'highpass', from: 1600, to: 3200, q: 0.7, peak: 0.16, attack: 0.006, duration: 0.11 });
    this.bleep({ freq: 2400, type: 'triangle', peak: 0.07, attack: 0.004, duration: 0.08 });
  }

  private splash(): void {
    this.shapedNoise({ type: 'lowpass', from: 2400, to: 380, q: 0.8, peak: 0.22, attack: 0.01, duration: 0.36 });
    this.bleep({ freq: 220, slide: 80, type: 'sine', peak: 0.1, attack: 0.012, duration: 0.3 });
  }

  private kilnDoor(): void {
    this.bleep({ freq: 86, slide: 48, type: 'sine', peak: 0.2, attack: 0.008, duration: 0.42 });
    this.shapedNoise({ type: 'bandpass', from: 520, to: 280, q: 1.4, peak: 0.14, attack: 0.02, duration: 0.38 });
  }

  private ting(): void {
    this.bleep({ freq: 1760, type: 'sine', peak: 0.09, attack: 0.004, duration: 0.9 });
    this.bleep({ freq: 2218, type: 'sine', peak: 0.045, attack: 0.004, duration: 0.72 });
    this.bleep({ freq: 2794, type: 'sine', peak: 0.028, attack: 0.004, duration: 0.5 });
  }

  private bleep(options: {
    freq: number;
    slide?: number;
    type: OscillatorType;
    peak: number;
    attack: number;
    duration: number;
  }): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = options.type;
    osc.frequency.setValueAtTime(options.freq, t);
    if (options.slide && options.slide > 0) {
      osc.frequency.exponentialRampToValueAtTime(options.slide, t + options.duration);
    }
    envelope(gain.gain, t, options.peak, options.attack, options.duration);
    osc.connect(gain);
    gain.connect(master);
    osc.start(t);
    osc.stop(t + options.duration + 0.03);
    osc.onended = () => {
      osc.disconnect();
      gain.disconnect();
    };
  }

  private shapedNoise(options: {
    type: BiquadFilterType;
    from: number;
    to: number;
    q: number;
    peak: number;
    attack: number;
    duration: number;
  }): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise(options.type === 'highpass' ? 'white' : 'brown');
    source.loop = false;
    const filter = ctx.createBiquadFilter();
    filter.type = options.type;
    filter.Q.value = options.q;
    filter.frequency.setValueAtTime(Math.max(40, options.from), t);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, options.to), t + options.duration);
    const gain = ctx.createGain();
    envelope(gain.gain, t, options.peak, options.attack, options.duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + options.duration + 0.03);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      gain.disconnect();
    };
  }

  private noise(kind: 'brown' | 'white'): AudioBuffer {
    if (kind === 'brown') {
      if (!this.brownBuffer) this.brownBuffer = makeNoise(this.ctx!, 0.45, 'brown');
      return this.brownBuffer;
    }
    if (!this.whiteBuffer) this.whiteBuffer = makeNoise(this.ctx!, 0.45, 'white');
    return this.whiteBuffer;
  }
}

interface LiveGraph {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

interface MotorGraph extends LiveGraph {
  fundamental: OscillatorNode;
  whine: OscillatorNode;
  air: AudioBufferSourceNode;
  airFilter: BiquadFilterNode;
  filter: BiquadFilterNode;
  gain: GainNode;
  whineGain: GainNode;
}

interface SquishGraph extends LiveGraph {
  source: AudioBufferSourceNode;
  filter: BiquadFilterNode;
  gain: GainNode;
}

function envelope(param: AudioParam, time: number, peak: number, attack: number, duration: number): void {
  const top = Math.max(0.0001, peak);
  const attackEnd = time + Math.max(0.004, attack);
  const end = Math.max(attackEnd + 0.01, time + duration);
  param.setValueAtTime(0.0001, time);
  param.exponentialRampToValueAtTime(top, attackEnd);
  param.exponentialRampToValueAtTime(0.0001, end);
}

function stopSources(sources: AudioScheduledSourceNode[], when: number): void {
  for (const source of sources) {
    try {
      source.stop(when);
    } catch {
      // Already stopped, or started in the same tick on a strict implementation.
    }
  }
}

function disconnectAll(nodes: AudioNode[]): void {
  for (const node of nodes) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected.
    }
  }
}

function makeNoise(ctx: AudioContext, seconds: number, kind: 'brown' | 'white'): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  if (kind === 'white') {
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * 0.85;
    return buffer;
  }
  let last = 0;
  let peak = 0;
  for (let i = 0; i < length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    data[i] = last;
    const mag = Math.abs(last);
    if (mag > peak) peak = mag;
  }
  const scale = peak > 1e-5 ? 0.85 / peak : 1;
  for (let i = 0; i < length; i++) data[i] *= scale;
  return buffer;
}

function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function readMuted(storage: Storage | null): boolean {
  try {
    return storage?.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(storage: Storage | null, muted: boolean): void {
  try {
    storage?.setItem(MUTE_STORAGE_KEY, muted ? '1' : '0');
  } catch {
    // Private mode and blocked storage stay in memory for this session.
  }
}

function browserStorage(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function browserNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function browserContext(): AudioContext | null {
  const scope = globalThis as typeof globalThis & { webkitAudioContext?: typeof AudioContext };
  const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor({ latencyHint: 'interactive' });
  } catch {
    try {
      return new Ctor();
    } catch {
      return null;
    }
  }
}

export function createAudio(options?: AudioEngineOptions): PotteryAudio {
  return new PotteryAudio(options);
}

export const audio: PotteryAudio = createAudio();
