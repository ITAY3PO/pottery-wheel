/** Synthesized one-shots. `kilnLoop` is the only sound with a matching `stop`. */
export type SoundId = 'wire' | 'splash' | 'kilnDoor' | 'kilnLoop' | 'ting';

/**
 * Pottery audio. Safe to call before the first tap and in environments
 * with no AudioContext: those calls are ignored or deferred, never thrown.
 *
 * `setWheel` speed is 0..1 (1 = full speed). `setContact` pressure and
 * moisture are 0..1.
 */
export interface Audio {
  unlock(): void;
  setWheel(speed: number): void;
  setContact(pressure: number, moisture: number): void;
  play(id: SoundId): void;
  stop(id: 'kilnLoop'): void;
  setMuted(m: boolean): void;
}
