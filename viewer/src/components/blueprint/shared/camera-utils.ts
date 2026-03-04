/**
 * Camera utility functions and types shared between CameraControl component and consumers.
 */

// ============================================================================
// Types
// ============================================================================

export interface CameraParams {
  azimuth: number;
  elevation: number;
  distance: number;
  shotDescription: string;
}

// ============================================================================
// Shot Description Generator (pure function)
// ============================================================================

const AZ_LABELS: Record<number, string> = {
  0: 'front view',
  45: 'front-left view',
  90: 'left view',
  135: 'back-left view',
  180: 'back view',
  225: 'back-right view',
  270: 'right view',
  315: 'front-right view',
};

export function generateShotDescription(
  azimuth: number,
  elevation: number,
  distance: number
): string {
  const snap = (Math.round(azimuth / 45) * 45) % 360;
  const azLabel = AZ_LABELS[snap] ?? `${snap}\u00B0 view`;

  let elLabel = 'eye-level shot';
  if (elevation <= -15) elLabel = 'low-angle shot';
  else if (elevation < 0) elLabel = 'slightly low shot';
  else if (elevation >= 45) elLabel = 'overhead shot';
  else if (elevation >= 15) elLabel = 'high-angle shot';

  let distLabel = 'medium shot';
  if (distance <= 0.7) distLabel = 'extreme close-up';
  else if (distance <= 0.85) distLabel = 'close-up';
  else if (distance >= 1.3) distLabel = 'wide shot';
  else if (distance >= 1.15) distLabel = 'full shot';

  return `${azLabel} ${elLabel} ${distLabel}`;
}
