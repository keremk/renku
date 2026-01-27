import { useState, useCallback, useEffect, type RefObject } from "react";

export interface UsePanelResizerOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  minPercent: number;
  maxPercent: number;
  defaultPercent: number;
}

export interface UsePanelResizerResult {
  percent: number;
  isDragging: boolean;
  handleMouseDown: (e: React.MouseEvent) => void;
}

/**
 * Hook for managing a resizable panel with mouse drag behavior.
 * Returns the current percentage and drag handlers.
 */
export function usePanelResizer(options: UsePanelResizerOptions): UsePanelResizerResult {
  const { containerRef, minPercent, maxPercent, defaultPercent } = options;

  const [percent, setPercent] = useState(defaultPercent);
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - containerRect.top;
      // Calculate top panel percent from top, then derive bottom panel percent
      const topPercent = (relativeY / containerRect.height) * 100;
      const bottomPercent = 100 - topPercent;
      const clampedPercent = Math.max(minPercent, Math.min(maxPercent, bottomPercent));
      setPercent(clampedPercent);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, containerRef, minPercent, maxPercent]);

  return {
    percent,
    isDragging,
    handleMouseDown,
  };
}
