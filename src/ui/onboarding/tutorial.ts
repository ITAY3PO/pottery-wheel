export interface TutorialTool {
  id: string;
  label: string;
  instruction: string;
}

export interface TutorialStep {
  id: 'center' | 'open' | 'pull';
  title: string;
  /** Gesture, in one line. */
  gesture: string;
  /** Tool instruction from the registry when that tool is loaded. */
  body: string;
}

const ORDER = ['center', 'open', 'pull'] as const;

const COPY: Record<(typeof ORDER)[number], TutorialStep> = {
  center: {
    id: 'center',
    title: 'Center',
    gesture: 'One finger into the side, while the wheel spins.',
    body: 'Start the wheel and press into the side until the lump runs true.',
  },
  open: {
    id: 'open',
    title: 'Open',
    gesture: 'One finger down the middle, then outward.',
    body: 'Push down near the center, then move outward to widen the floor.',
  },
  pull: {
    id: 'pull',
    title: 'Pull',
    gesture: 'One finger, drag up the wall.',
    body: 'Drag up the wall. Keep the wheel turning and don’t rush the thin spots.',
  },
};

/** Center, open, pull — titles and instructions prefer the tool registry. */
export function tutorialSteps(tools: readonly TutorialTool[]): TutorialStep[] {
  return ORDER.map((id) => {
    const tool = tools.find((entry) => entry.id === id);
    const fallback = COPY[id];
    return {
      id,
      title: tool?.label || fallback.title,
      gesture: fallback.gesture,
      body: tool?.instruction || fallback.body,
    };
  });
}
