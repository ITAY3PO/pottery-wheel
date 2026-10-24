import type { StudioEventMap, StudioEventName, StudioEvents } from './types';

const listeners = new Map<StudioEventName, Set<(payload: StudioEventMap[StudioEventName]) => void>>();

function bucket<K extends StudioEventName>(type: K): Set<(payload: StudioEventMap[K]) => void> {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  return set as Set<(payload: StudioEventMap[K]) => void>;
}

export const events: StudioEvents = {
  on(type, handler) {
    bucket(type).add(handler);
    return () => {
      bucket(type).delete(handler);
    };
  },
  off(type, handler) {
    bucket(type).delete(handler);
  },
  emit(type, payload) {
    for (const handler of [...bucket(type)]) {
      try {
        handler(payload);
      } catch (error) {
        console.error('pottery event handler failed', error);
      }
    }
  },
};
