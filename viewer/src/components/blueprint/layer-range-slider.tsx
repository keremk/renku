/**
 * Custom layer range slider for controlling execution range.
 * A clean, properly sized dual-handle range slider.
 */

import { useCallback, useRef, useState, useEffect } from "react";
import type { LayerRange } from "@/types/generation";

interface LayerRangeSliderProps {
  totalLayers: number;
  value: LayerRange;
  onChange: (range: LayerRange) => void;
  disabled?: boolean;
}

export function LayerRangeSlider({
  totalLayers,
  value,
  onChange,
  disabled = false,
}: LayerRangeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<"start" | "end" | null>(null);

  // Don't show if only 1 layer or less
  if (totalLayers <= 1) {
    return null;
  }

  const startValue = value.reRunFrom ?? 0;
  const endValue = value.upToLayer ?? totalLayers - 1;

  // Calculate positions as percentages
  const startPercent = (startValue / (totalLayers - 1)) * 100;
  const endPercent = (endValue / (totalLayers - 1)) * 100;

  const getValueFromPosition = useCallback(
    (clientX: number): number => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
      return Math.round((percent / 100) * (totalLayers - 1));
    },
    [totalLayers]
  );

  const handleMouseDown = useCallback(
    (handle: "start" | "end") => (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      setDragging(handle);
    },
    [disabled]
  );

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newValue = getValueFromPosition(e.clientX);

      if (dragging === "start") {
        // Start handle can't go past end handle
        const clampedValue = Math.min(newValue, endValue);
        onChange({
          reRunFrom: clampedValue === 0 ? null : clampedValue,
          upToLayer: value.upToLayer,
        });
      } else {
        // End handle can't go before start handle
        const clampedValue = Math.max(newValue, startValue);
        onChange({
          reRunFrom: value.reRunFrom,
          upToLayer: clampedValue === totalLayers - 1 ? null : clampedValue,
        });
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [dragging, startValue, endValue, totalLayers, value, onChange, getValueFromPosition]);

  return (
    <div className={`flex items-center gap-4 ${disabled ? "opacity-50 pointer-events-none" : ""}`}>
      <span className="text-xs text-muted-foreground">Layers</span>

      {/* Start value */}
      <span className="text-sm font-mono text-foreground w-5 text-right tabular-nums">
        {startValue}
      </span>

      {/* Slider track */}
      <div
        ref={trackRef}
        className="relative w-40 h-6 flex items-center cursor-pointer"
      >
        {/* Background track */}
        <div className="absolute inset-x-0 h-2 bg-muted rounded-full" />

        {/* Active range - uses primary color like tab underline */}
        <div
          className="absolute h-2 bg-primary rounded-full"
          style={{
            left: `${startPercent}%`,
            right: `${100 - endPercent}%`,
          }}
        />

        {/* Layer tick marks */}
        {Array.from({ length: totalLayers }, (_, i) => (
          <div
            key={i}
            className="absolute w-0.5 h-1 bg-muted-foreground/30 rounded-full top-1/2 -translate-y-1/2"
            style={{ left: `calc(${(i / (totalLayers - 1)) * 100}% - 1px)` }}
          />
        ))}

        {/* Start handle */}
        <div
          className={`
            absolute w-5 h-5 -translate-x-1/2 rounded-full cursor-grab
            bg-card border-2 border-primary
            shadow-md
            transition-transform duration-100
            hover:scale-110
            ${dragging === "start" ? "scale-110 cursor-grabbing ring-4 ring-ring" : ""}
          `}
          style={{ left: `${startPercent}%` }}
          onMouseDown={handleMouseDown("start")}
        />

        {/* End handle */}
        <div
          className={`
            absolute w-5 h-5 -translate-x-1/2 rounded-full cursor-grab
            bg-card border-2 border-primary
            shadow-md
            transition-transform duration-100
            hover:scale-110
            ${dragging === "end" ? "scale-110 cursor-grabbing ring-4 ring-ring" : ""}
          `}
          style={{ left: `${endPercent}%` }}
          onMouseDown={handleMouseDown("end")}
        />
      </div>

      {/* End value */}
      <span className="text-sm font-mono text-foreground w-5 tabular-nums">
        {endValue}
      </span>
    </div>
  );
}
