/**
 * Isometric 3D camera visualization with interactive handles and parameter sliders.
 * Ported from the image-edit-playground.html prototype.
 */

import { useRef, useEffect, useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { useDarkMode } from '@/hooks/use-dark-mode';
import { generateShotDescription, type CameraParams } from './camera-utils';

export type { CameraParams } from './camera-utils';

export interface CameraControlProps {
  /** Current camera parameters */
  params: CameraParams;
  /** Callback when any parameter changes */
  onChange: (params: CameraParams) => void;
  /** Optional class name for the root container */
  className?: string;
}

// ============================================================================
// Isometric Projection Helpers
// ============================================================================

const VIEW_ROT_RAD = 0;
const VIEW_TILT_RAD = (22 * Math.PI) / 180;
const VIEW_SCALE_FACTOR = 27 / 100;
const ARC_AZ_RAD = (315 * Math.PI) / 180;

function iso(
  wx: number,
  wy: number,
  wz: number,
  cx: number,
  cy: number,
  S: number
): [number, number] {
  const cosR = Math.cos(VIEW_ROT_RAD);
  const sinR = Math.sin(VIEW_ROT_RAD);
  const rx = wx * cosR - wz * sinR;
  const rz = wx * sinR + wz * cosR;
  const cosT = Math.cos(VIEW_TILT_RAD);
  const sinT = Math.sin(VIEW_TILT_RAD);
  const sx = (rx - rz) * cosT * S;
  const sy = -(rx + rz) * sinT * S - wy * S;
  return [cx + sx, cy + sy];
}

// ============================================================================
// Theme Color Palettes
// ============================================================================

interface CanvasColors {
  bg: string;
  gridStroke: string;
  gridAlpha: number;
  axisAlpha: number;
  orbitRing: string;
  cardBorder: string;
  cardInner: string;
  shadow: string;
  labelFill: string;
  legendText: string;
  distanceLine: string;
}

const DARK_COLORS: CanvasColors = {
  bg: 'hsl(225 20% 11%)',
  gridStroke: '#8af',
  gridAlpha: 0.055,
  axisAlpha: 0.12,
  orbitRing: 'hsl(175 85% 55% / 0.45)',
  cardBorder: 'hsl(240 12% 24%)',
  cardInner: 'hsl(225 15% 15%)',
  shadow: 'rgba(0,0,0,0.25)',
  labelFill: 'hsl(0 0% 45%)',
  legendText: 'hsl(0 0% 50%)',
  distanceLine: 'hsl(42 80% 55% / 0.25)',
};

const LIGHT_COLORS: CanvasColors = {
  bg: 'hsl(48 30% 93%)',
  gridStroke: 'hsl(220 30% 55%)',
  gridAlpha: 0.1,
  axisAlpha: 0.18,
  orbitRing: 'hsl(175 65% 32% / 0.5)',
  cardBorder: 'hsl(240 8% 72%)',
  cardInner: 'hsl(240 6% 84%)',
  shadow: 'rgba(0,0,0,0.1)',
  labelFill: 'hsl(0 0% 35%)',
  legendText: 'hsl(0 0% 40%)',
  distanceLine: 'hsl(42 70% 45% / 0.3)',
};

// ============================================================================
// Canvas Drawing
// ============================================================================

type HandleKey = 'az' | 'el' | 'dist';

interface HandlePositions {
  az: [number, number] | null;
  el: [number, number] | null;
  dist: [number, number] | null;
}

function pathPoint(
  ctx: CanvasRenderingContext2D,
  i: number,
  sx: number,
  sy: number
) {
  if (i === 0) {
    ctx.moveTo(sx, sy);
  } else {
    ctx.lineTo(sx, sy);
  }
}

/** Draw a two-tone circular handle, scaled up when hovered. */
function drawHandle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  outerR: number,
  innerR: number,
  outerColor: string,
  innerColor: string,
  hovered: boolean
) {
  const scale = hovered ? 1.35 : 1;
  ctx.fillStyle = outerColor;
  ctx.beginPath();
  ctx.arc(x, y, outerR * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = innerColor;
  ctx.beginPath();
  ctx.arc(x, y, innerR * scale, 0, Math.PI * 2);
  ctx.fill();
}

function drawCanvas(
  canvas: HTMLCanvasElement,
  azimuth: number,
  elevation: number,
  distance: number,
  isDark: boolean,
  hovering: HandleKey | null
): HandlePositions {
  const wrap = canvas.parentElement;
  if (!wrap) return { az: null, el: null, dist: null };

  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  if (!ctx) return { az: null, el: null, dist: null };
  ctx.scale(dpr, dpr);

  const cx = W * 0.5;
  const cy = H * 0.55;
  const S = Math.min(W, H) * VIEW_SCALE_FACTOR;
  const handles: HandlePositions = { az: null, el: null, dist: null };
  const colors = isDark ? DARK_COLORS : LIGHT_COLORS;

  // Background
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, W, H);

  // Ground grid
  ctx.save();
  ctx.globalAlpha = colors.gridAlpha;
  ctx.strokeStyle = colors.gridStroke;
  ctx.lineWidth = 0.5;
  const gN = 7;
  const gS = 0.45;
  for (let i = -gN; i <= gN; i++) {
    const v = i * gS;
    let [x1, y1] = iso(-gN * gS, 0, v, cx, cy, S);
    let [x2, y2] = iso(gN * gS, 0, v, cx, cy, S);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    [x1, y1] = iso(v, 0, -gN * gS, cx, cy, S);
    [x2, y2] = iso(v, 0, gN * gS, cx, cy, S);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.restore();

  // Coordinate axes
  ctx.save();
  ctx.globalAlpha = colors.axisAlpha;
  ctx.lineWidth = 1;
  const axL = 2.8;
  const [o0, o1] = iso(0, 0, 0, cx, cy, S);
  ctx.strokeStyle = '#f66';
  let [a2, b2] = iso(axL, 0, 0, cx, cy, S);
  ctx.beginPath();
  ctx.moveTo(o0, o1);
  ctx.lineTo(a2, b2);
  ctx.stroke();
  ctx.strokeStyle = '#66f';
  [a2, b2] = iso(0, 0, axL, cx, cy, S);
  ctx.beginPath();
  ctx.moveTo(o0, o1);
  ctx.lineTo(a2, b2);
  ctx.stroke();
  ctx.strokeStyle = '#6f6';
  [a2, b2] = iso(0, axL, 0, cx, cy, S);
  ctx.beginPath();
  ctx.moveTo(o0, o1);
  ctx.lineTo(a2, b2);
  ctx.stroke();
  ctx.restore();

  // Orbit ring
  const R = 1.8;
  ctx.strokeStyle = colors.orbitRing;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i <= 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    const [sx, sy] = iso(Math.sin(a) * R, 0, Math.cos(a) * R, cx, cy, S);
    pathPoint(ctx, i, sx, sy);
  }
  ctx.closePath();
  ctx.stroke();

  // Subject card — faces X axis (stretches along Z, stands in Y)
  const cW = 0.8;
  const cH = 0.95;
  const corners: [number, number, number][] = [
    [0, 0, -cW / 2],
    [0, 0, cW / 2],
    [0, cH, cW / 2],
    [0, cH, -cW / 2],
  ];
  const c2d = corners.map((c) => iso(c[0], c[1], c[2], cx, cy, S));

  // Shadow
  ctx.fillStyle = colors.shadow;
  const sw = cW * 0.6;
  const shd: [number, number, number][] = [
    [0.3, 0, -sw],
    [0.3, 0, sw],
    [-0.15, 0, sw],
    [-0.15, 0, -sw],
  ];
  const shd2d = shd.map((c) => iso(c[0], c[1], c[2], cx, cy, S));
  ctx.beginPath();
  ctx.moveTo(shd2d[0][0], shd2d[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(shd2d[i][0], shd2d[i][1]);
  ctx.closePath();
  ctx.fill();

  // Card border
  ctx.fillStyle = colors.cardBorder;
  ctx.beginPath();
  ctx.moveTo(c2d[0][0], c2d[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(c2d[i][0], c2d[i][1]);
  ctx.closePath();
  ctx.fill();

  // Card inner
  const ins = 0.06;
  const inner: [number, number, number][] = [
    [0, ins, -cW / 2 + ins],
    [0, ins, cW / 2 - ins],
    [0, cH - ins, cW / 2 - ins],
    [0, cH - ins, -cW / 2 + ins],
  ];
  const in2d = inner.map((c) => iso(c[0], c[1], c[2], cx, cy, S));
  ctx.fillStyle = colors.cardInner;
  ctx.beginPath();
  ctx.moveTo(in2d[0][0], in2d[0][1]);
  for (let i = 1; i < 4; i++) ctx.lineTo(in2d[i][0], in2d[i][1]);
  ctx.closePath();
  ctx.fill();

  // Azimuth handle (green dot) — ALWAYS on the orbit ring at radius R, ground plane
  const azRad = (azimuth * Math.PI) / 180;
  const azWx = Math.sin(azRad) * R;
  const azWz = Math.cos(azRad) * R;
  const [azSx, azSy] = iso(azWx, 0, azWz, cx, cy, S);

  drawHandle(
    ctx, azSx, azSy, 8, 4.5,
    'hsl(160 85% 42%)', 'hsl(160 85% 65%)',
    hovering === 'az'
  );
  handles.az = [azSx, azSy];

  // Elevation arc (fixed at arcAzDeg)
  const arcR = R;
  const minElRad = (-30 * Math.PI) / 180;
  const maxElRad = (60 * Math.PI) / 180;

  ctx.strokeStyle = 'hsl(330 80% 65% / 0.6)';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  const nArc = 40;
  for (let i = 0; i <= nArc; i++) {
    const t = i / nArc;
    const elA = minElRad + t * (maxElRad - minElRad);
    const aH = Math.sin(elA) * arcR;
    const aR = Math.cos(elA) * arcR;
    const aWx = Math.sin(ARC_AZ_RAD) * aR;
    const aWz = Math.cos(ARC_AZ_RAD) * aR;
    const [sx, sy] = iso(aWx, aH, aWz, cx, cy, S);
    pathPoint(ctx, i, sx, sy);
  }
  ctx.stroke();

  // Elevation handle (pink dot on arc)
  const elRad = (elevation * Math.PI) / 180;
  const elH = Math.sin(elRad) * arcR;
  const elGR = Math.cos(elRad) * arcR;
  const elWx = Math.sin(ARC_AZ_RAD) * elGR;
  const elWz = Math.cos(ARC_AZ_RAD) * elGR;
  const [elSx, elSy] = iso(elWx, elH, elWz, cx, cy, S);

  drawHandle(
    ctx, elSx, elSy, 7, 3.5,
    'hsl(330 80% 65%)', 'hsl(330 80% 82%)',
    hovering === 'el'
  );
  handles.el = [elSx, elSy];

  // Camera position — incorporates azimuth, elevation, AND distance
  // Camera orbits around the card center (0, cH/2, 0) at distance d
  const d = distance * R;
  const camGroundR = d * Math.cos(elRad); // horizontal distance shrinks with elevation
  const camWx = Math.sin(azRad) * camGroundR;
  const camWy = cH / 2 + d * Math.sin(elRad); // rises/dips with elevation
  const camWz = Math.cos(azRad) * camGroundR;
  const [camSx, camSy] = iso(camWx, camWy, camWz, cx, cy, S);

  // Subject center — target the camera always points at
  const [subjectCx, subjectCy] = iso(0, cH / 2, 0, cx, cy, S);

  // Dashed line from card center to camera position
  ctx.strokeStyle = colors.distanceLine;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(subjectCx, subjectCy);
  ctx.lineTo(camSx, camSy);
  ctx.stroke();
  ctx.setLineDash([]);

  // Camera body sprite — rotated to face the subject center
  const angleToSubject = Math.atan2(subjectCy - camSy, subjectCx - camSx);
  const bodyLen = 10;
  const bodyH = 7;
  const lensLen = 4;
  const lensH = 5;

  ctx.save();
  ctx.translate(camSx, camSy);
  ctx.rotate(angleToSubject);

  // Main body (extends backward from the lens)
  ctx.fillStyle = isDark ? 'hsl(220 10% 28%)' : 'hsl(220 8% 50%)';
  ctx.beginPath();
  ctx.roundRect(-bodyLen - lensLen + 1, -bodyH / 2, bodyLen, bodyH, 2);
  ctx.fill();

  // Lens barrel (front, connects to the gold dot)
  ctx.fillStyle = isDark ? 'hsl(220 12% 38%)' : 'hsl(220 10% 58%)';
  ctx.beginPath();
  ctx.roundRect(-lensLen, -lensH / 2, lensLen + 1, lensH, [0, 2, 2, 0]);
  ctx.fill();

  ctx.restore();

  // Distance handle (gold dot — the camera lens)
  drawHandle(
    ctx, camSx, camSy, 6, 2.8,
    'hsl(42 85% 55%)', 'hsl(42 85% 78%)',
    hovering === 'dist'
  );
  handles.dist = [camSx, camSy];

  // Axis labels
  ctx.font = '600 8px Montserrat, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = colors.labelFill;
  const [fLx, fLy] = iso(0, 0, R + 0.55, cx, cy, S);
  ctx.fillText('front', fLx, fLy);
  const [bLx, bLy] = iso(0, 0, -R - 0.55, cx, cy, S);
  ctx.fillText('back', bLx, bLy);
  const [rLx, rLy] = iso(R + 0.55, 0, 0, cx, cy, S);
  ctx.fillText('R', rLx, rLy);
  const [lLx, lLy] = iso(-R - 0.55, 0, 0, cx, cy, S);
  ctx.fillText('L', lLx, lLy);

  // Legend
  ctx.font = '600 7px Montserrat, system-ui, sans-serif';
  ctx.textAlign = 'left';
  const legY = H - 8;
  ctx.fillStyle = 'hsl(160 85% 55%)';
  ctx.fillText('\u25CF', 6, legY);
  ctx.fillStyle = colors.legendText;
  ctx.fillText('Azimuth', 16, legY);
  ctx.fillStyle = 'hsl(330 80% 65%)';
  ctx.fillText('\u25CF', 60, legY);
  ctx.fillStyle = colors.legendText;
  ctx.fillText('Elevation', 70, legY);
  ctx.fillStyle = 'hsl(42 85% 55%)';
  ctx.fillText('\u25CF', 118, legY);
  ctx.fillStyle = colors.legendText;
  ctx.fillText('Distance', 128, legY);

  return handles;
}

// ============================================================================
// Slider Sub-Component
// ============================================================================

function CameraSlider({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  hints,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  hints: [string, string, string];
  onChange: (value: number) => void;
}) {
  return (
    <div className='flex flex-col gap-0.5'>
      <div className='flex justify-between items-center text-[10px]'>
        <span className='text-muted-foreground font-medium uppercase tracking-[0.06em]'>
          {label}
        </span>
        <span className='text-[10px] font-semibold text-foreground tabular-nums bg-muted/60 px-1.5 py-px rounded-[3px]'>
          {displayValue}
        </span>
      </div>
      <input
        type='range'
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className='w-full h-1 bg-muted/60 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-background'
      />
      <div className='flex justify-between text-[8px] text-muted-foreground/60'>
        <span>{hints[0]}</span>
        <span>{hints[1]}</span>
        <span>{hints[2]}</span>
      </div>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function CameraControl({
  params,
  onChange,
  className,
}: CameraControlProps) {
  const isDark = useDarkMode();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<HandlePositions>({ az: null, el: null, dist: null });
  const [dragging, setDragging] = useState<HandleKey | null>(null);
  const [hovering, setHovering] = useState<HandleKey | null>(null);
  const dragStartRef = useRef<[number, number] | null>(null);
  const paramsRef = useRef(params);
  const isDarkRef = useRef(isDark);
  const hoveringRef = useRef(hovering);

  /** Previous screen-space angle for angular azimuth dragging */
  const prevScreenAngleRef = useRef<number | null>(null);

  // Sync refs in an effect (not during render) per react-hooks/refs
  useEffect(() => {
    paramsRef.current = params;
  });

  useEffect(() => {
    isDarkRef.current = isDark;
  });

  useEffect(() => {
    hoveringRef.current = hovering;
  });

  // Draw canvas whenever params, theme, or hover state change
  const redraw = useCallback(() => {
    if (!canvasRef.current) return;
    handlesRef.current = drawCanvas(
      canvasRef.current,
      paramsRef.current.azimuth,
      paramsRef.current.elevation,
      paramsRef.current.distance,
      isDarkRef.current,
      hoveringRef.current
    );
  }, []);

  useEffect(() => {
    redraw();
  }, [params, isDark, hovering, redraw]);

  // ResizeObserver for responsive redraw
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = new ResizeObserver(() => redraw());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [redraw]);

  // Canvas coordinate helper
  const canvasCoords = useCallback(
    (e: MouseEvent): [number, number] => {
      if (!canvasRef.current) return [0, 0];
      const r = canvasRef.current.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    },
    []
  );

  // Hit test for handle dragging — test dist first to handle overlap with az at distance≈1.0
  const hitTest = useCallback(
    (mx: number, my: number): HandleKey | null => {
      const thresh = 16;
      for (const key of ['dist', 'el', 'az'] as const) {
        const p = handlesRef.current[key];
        if (!p) continue;
        const dx = mx - p[0];
        const dy = my - p[1];
        if (Math.sqrt(dx * dx + dy * dy) < thresh) return key;
      }
      return null;
    },
    []
  );

  // Hover tracking — update when mouse moves over canvas (skip while dragging)
  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (dragging) return;
      if (!canvasRef.current) return;
      const r = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      setHovering(hitTest(mx, my));
    },
    [dragging, hitTest]
  );

  const handleCanvasMouseLeave = useCallback(() => {
    if (!dragging) setHovering(null);
  }, [dragging]);

  // Mouse down on canvas
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!canvasRef.current) return;
      const r = canvasRef.current.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const hit = hitTest(mx, my);
      if (hit) {
        setDragging(hit);
        dragStartRef.current = [mx, my];

        // For azimuth: initialize screen-space angle for angular tracking
        if (hit === 'az') {
          const W = canvasRef.current.clientWidth;
          const H = canvasRef.current.clientHeight;
          const centerX = W * 0.5;
          const centerY = H * 0.55;
          prevScreenAngleRef.current = Math.atan2(my - centerY, mx - centerX);
        }

        e.preventDefault();
      }
    },
    [hitTest]
  );

  // Global mouse move/up for drag
  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const [mx, my] = canvasCoords(e);
      const start = dragStartRef.current;
      if (!start) return;
      const p = paramsRef.current;

      let newAz = p.azimuth;
      let newEl = p.elevation;
      let newDist = p.distance;

      if (dragging === 'az' && canvasRef.current) {
        // Angular tracking: compute screen-space angle delta around canvas center
        const W = canvasRef.current.clientWidth;
        const H = canvasRef.current.clientHeight;
        const centerX = W * 0.5;
        const centerY = H * 0.55;
        const currAngle = Math.atan2(my - centerY, mx - centerX);
        const prevAngle = prevScreenAngleRef.current ?? currAngle;

        let angleDelta = currAngle - prevAngle;
        // Normalize to [-PI, PI] for smooth wrapping
        if (angleDelta > Math.PI) angleDelta -= 2 * Math.PI;
        if (angleDelta < -Math.PI) angleDelta += 2 * Math.PI;

        // Positive screen angle delta (clockwise with Y-down) = increasing azimuth
        newAz = ((p.azimuth + (angleDelta * 180) / Math.PI) % 360 + 360) % 360;
        prevScreenAngleRef.current = currAngle;
      } else if (dragging === 'el') {
        const dy = my - start[1];
        newEl = Math.max(-30, Math.min(60, p.elevation - dy * 0.5));
      } else if (dragging === 'dist' && canvasRef.current) {
        // Radial tracking: moving mouse outward from center increases distance
        const W = canvasRef.current.clientWidth;
        const H = canvasRef.current.clientHeight;
        const centerX = W * 0.5;
        const centerY = H * 0.55;
        const prevR = Math.sqrt(
          (start[0] - centerX) ** 2 + (start[1] - centerY) ** 2
        );
        const currR = Math.sqrt(
          (mx - centerX) ** 2 + (my - centerY) ** 2
        );
        const radialDelta = currR - prevR;
        newDist = Math.max(0.6, Math.min(1.4, p.distance + radialDelta * 0.005));
      }

      dragStartRef.current = [mx, my];
      onChange({
        azimuth: Math.round(newAz),
        elevation: Math.round(newEl),
        distance: Math.round(newDist * 100) / 100,
        shotDescription: generateShotDescription(
          Math.round(newAz),
          Math.round(newEl),
          Math.round(newDist * 100) / 100
        ),
      });
    };

    const handleMouseUp = () => {
      setDragging(null);
      setHovering(null);
      dragStartRef.current = null;
      prevScreenAngleRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, canvasCoords, onChange]);

  // Slider change handlers
  const updateParam = useCallback(
    (key: 'azimuth' | 'elevation' | 'distance', value: number) => {
      const next = { ...paramsRef.current, [key]: value };
      next.shotDescription = generateShotDescription(
        next.azimuth,
        next.elevation,
        next.distance
      );
      onChange(next);
    },
    [onChange]
  );

  const canvasBg = isDark ? DARK_COLORS.bg : LIGHT_COLORS.bg;

  let cursor = 'default';
  if (dragging) cursor = 'grabbing';
  else if (hovering) cursor = 'grab';

  return (
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className='text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground flex items-center gap-1.5'>
        <span className='text-sm'>&#127909;</span> Camera Control
      </div>

      {/* Canvas */}
      <div
        ref={wrapRef}
        className='w-full rounded-lg overflow-hidden flex-shrink-0'
        style={{ height: 200, background: canvasBg }}
      >
        <canvas
          ref={canvasRef}
          className='block w-full'
          style={{ cursor }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleCanvasMouseMove}
          onMouseLeave={handleCanvasMouseLeave}
        />
      </div>

      {/* Sliders */}
      <div className='flex flex-col gap-1.5'>
        <CameraSlider
          label='Azimuth'
          value={params.azimuth}
          min={0}
          max={360}
          step={1}
          displayValue={`${params.azimuth}\u00B0`}
          hints={['front', 'right', 'back']}
          onChange={(v) => updateParam('azimuth', v)}
        />
        <CameraSlider
          label='Elevation'
          value={params.elevation}
          min={-30}
          max={60}
          step={1}
          displayValue={`${params.elevation}\u00B0`}
          hints={['low', 'eye level', 'high']}
          onChange={(v) => updateParam('elevation', v)}
        />
        <CameraSlider
          label='Distance'
          value={params.distance}
          min={0.6}
          max={1.4}
          step={0.05}
          displayValue={params.distance.toFixed(2)}
          hints={['close-up', 'medium', 'wide']}
          onChange={(v) => updateParam('distance', v)}
        />
      </div>

      {/* Shot description output */}
      <div className='flex items-center gap-1.5'>
        <span className='text-[9px] uppercase tracking-[0.06em] text-muted-foreground/60 font-semibold whitespace-nowrap'>
          Prompt:
        </span>
        <div className='flex-1 text-[10px] text-primary font-mono bg-muted/30 border border-border/40 rounded-[5px] px-2 py-1 truncate'>
          {params.shotDescription}
        </div>
      </div>
    </div>
  );
}
