import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface TimelineSliderProps {
  currentTime: number;
  totalContentDuration: number;
  needsHorizontalScroll: boolean;
  effectiveWidth: number;
  onSeek: (time: number) => void;
  className?: string;
}

export const TimelineSlider = ({
  currentTime,
  totalContentDuration,
  onSeek,
  className,
}: TimelineSliderProps) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragStartTime, setDragStartTime] = useState(0);
  const sliderRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();

      if (!sliderRef.current) {
        return;
      }

      const rect = sliderRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;

      setIsDragging(true);
      setDragStartX(x);
      setDragStartTime(currentTime);
    },
    [currentTime],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!isDragging || !sliderRef.current) {
        return;
      }

      const rect = sliderRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const deltaX = x - dragStartX;
      const deltaPercent = (deltaX / rect.width) * 100;
      const deltaTime = (deltaPercent / 100) * totalContentDuration;
      const newTime = Math.max(
        0,
        Math.min(totalContentDuration, dragStartTime + deltaTime),
      );

      onSeek(newTime);
    },
    [isDragging, dragStartX, dragStartTime, totalContentDuration, onSeek],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleTimelineClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (isDragging || !sliderRef.current) {
        return;
      }

      const rect = sliderRef.current.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const percent = (x / rect.width) * 100;
      const newTime = Math.max(
        0,
        Math.min((percent / 100) * totalContentDuration, totalContentDuration),
      );

      onSeek(newTime);
    },
    [isDragging, totalContentDuration, onSeek],
  );

  useEffect(() => {
    if (!isDragging) {
      return;
    }

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp, isDragging]);

  const safeDuration = totalContentDuration > 0 ? totalContentDuration : 1;
  const playheadPercent = Math.min(
    100,
    Math.max(0, (currentTime / safeDuration) * 100),
  );

  return (
    <div className={cn("p-4 pb-2 border-b border-border/40", className)}>
      <div className="px-2">
        <div
          ref={sliderRef}
          className="relative h-8 cursor-pointer w-full"
          onClick={handleTimelineClick}
        >
          <div className="absolute top-4 left-0 right-0 h-0.5 bg-muted-foreground/30" />

          <div
            className="absolute top-4 left-0 h-0.5 bg-linear-to-r from-orange-400 to-yellow-500 transition-all"
            style={{ width: `${playheadPercent}%` }}
          />

          {Array.from({ length: Math.floor(safeDuration / 5) + 1 }, (_, index) => {
            const seconds = index * 5;
            const position = (seconds / safeDuration) * 100;
            const transform = seconds === 0 ? "none" : "translateX(-50%)";
            return (
              <div
                key={`major-${seconds}`}
                className={`absolute flex flex-col pointer-events-none ${
                  seconds === 0 ? "items-start" : "items-center"
                }`}
                style={{ left: `${position}%`, transform }}
              >
                <div className="w-px h-3 bg-muted-foreground/70 mb-1" />
                <span className="text-xs text-muted-foreground">
                  {seconds}s
                </span>
              </div>
            );
          })}

          {Array.from({ length: Math.floor(safeDuration) + 1 }, (_, index) => {
            if (index % 5 === 0) {
              return null;
            }
            const position = (index / safeDuration) * 100;
            const transform = index === 0 ? "none" : "translateX(-50%)";
            return (
              <div
                key={`minor-${index}`}
                className="absolute w-px h-1.5 bg-muted-foreground/40 pointer-events-none"
                style={{
                  left: `${position}%`,
                  transform,
                  top: "16px",
                }}
              />
            );
          })}

          <div
            className="absolute top-4 z-10 cursor-grab active:cursor-grabbing"
            style={{
              left: `${playheadPercent}%`,
              transform: "translate(-50%, -50%)",
            }}
            onMouseDown={handleMouseDown}
          >
            <div className="w-4 h-4 rounded-full bg-linear-to-br from-orange-400 to-yellow-500 border-2 border-white shadow-lg hover:scale-110 transition-transform">
              <div className="w-full h-full rounded-full bg-linear-to-br from-white/20 to-transparent" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
