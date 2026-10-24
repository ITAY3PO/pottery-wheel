/** Horizontal angle of the historical side camera: almost level, a hair above the bat. */
const SIDE_POLAR = Math.atan2(1, 0.02);

export type ViewPreset = 'top' | 'three-quarter' | 'side';

export const VIEW_PRESETS: readonly { id: ViewPreset; label: string; polar: number; azimuth: number }[] = [
  { id: 'top', label: 'Top', polar: 0.18, azimuth: 0 },
  { id: 'three-quarter', label: '3/4', polar: Math.PI / 4, azimuth: 0.62 },
  { id: 'side', label: 'Side', polar: SIDE_POLAR, azimuth: 0 },
];
