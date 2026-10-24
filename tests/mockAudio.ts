export interface ParamEvent {
  method: string;
  value?: number;
  time?: number;
  timeConstant?: number;
}

export class MockParam {
  value: number;
  readonly calls: ParamEvent[] = [];

  constructor(value = 0) {
    this.value = value;
  }

  setValueAtTime(value: number, time: number): this {
    this.value = value;
    this.calls.push({ method: 'setValueAtTime', value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number, timeConstant: number): this {
    this.calls.push({ method: 'setTargetAtTime', value, time, timeConstant });
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ method: 'linearRampToValueAtTime', value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ method: 'exponentialRampToValueAtTime', value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.calls.push({ method: 'cancelScheduledValues', time });
    return this;
  }
}

export function lastTarget(param: MockParam | undefined): ParamEvent | undefined {
  if (!param) return undefined;
  for (let i = param.calls.length - 1; i >= 0; i--) {
    if (param.calls[i]?.method === 'setTargetAtTime') return param.calls[i];
  }
  return undefined;
}

class MockNode {
  connections: unknown[] = [];

  connect(dest: unknown): void {
    this.connections.push(dest);
  }

  disconnect(): void {
    this.connections = [];
  }
}

export class MockOsc extends MockNode {
  type: OscillatorType = 'sine';
  frequency = new MockParam(440);
  detune = new MockParam(0);
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  stopTime = 0;

  start(when = 0): void {
    if (this.started) throw new Error('oscillator already started');
    this.started = true;
    void when;
  }

  stop(when = 0): void {
    if (!this.started || this.stopped) throw new Error('oscillator cannot stop');
    this.stopped = true;
    this.stopTime = when;
  }
}

export class MockGain extends MockNode {
  gain = new MockParam(1);
}

export class MockFilter extends MockNode {
  type: BiquadFilterType = 'lowpass';
  frequency = new MockParam(350);
  Q = new MockParam(1);
  gain = new MockParam(0);
  detune = new MockParam(0);
}

export class MockBufferSource extends MockNode {
  buffer: MockBuffer | null = null;
  loop = false;
  playbackRate = new MockParam(1);
  onended: (() => void) | null = null;
  started = false;
  stopped = false;

  start(when = 0): void {
    if (this.started) throw new Error('source already started');
    this.started = true;
    void when;
  }

  stop(when = 0): void {
    if (!this.started || this.stopped) throw new Error('source cannot stop');
    this.stopped = true;
    void when;
  }
}

export class MockBuffer {
  private readonly channels: Float32Array[];

  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    const data = this.channels[channel];
    if (!data) throw new Error(`no channel ${channel}`);
    return data;
  }
}

export class MockContext {
  readonly sampleRate = 8000;
  currentTime = 0;
  state: AudioContextState = 'suspended';
  readonly destination = new MockGain();
  readonly oscillators: MockOsc[] = [];
  readonly gains: MockGain[] = [];
  readonly filters: MockFilter[] = [];
  readonly sources: MockBufferSource[] = [];

  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';
    return Promise.resolve();
  }

  createGain(): MockGain {
    const node = new MockGain();
    this.gains.push(node);
    return node;
  }

  createOscillator(): MockOsc {
    const node = new MockOsc();
    this.oscillators.push(node);
    return node;
  }

  createBiquadFilter(): MockFilter {
    const node = new MockFilter();
    this.filters.push(node);
    return node;
  }

  createBufferSource(): MockBufferSource {
    const node = new MockBufferSource();
    this.sources.push(node);
    return node;
  }

  createBuffer(channels: number, length: number, sampleRate: number): MockBuffer {
    return new MockBuffer(channels, length, sampleRate);
  }
}

export function memoryStorage(seed?: Record<string, string>): Storage {
  const map = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) ?? null) : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
}
