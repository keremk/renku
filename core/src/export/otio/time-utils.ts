/**
 * Time conversion utilities for OpenTimelineIO export.
 *
 * OTIO uses RationalTime for precise frame-based time representation.
 * Time is expressed as (value / rate), where:
 * - value: number of frames (or time units)
 * - rate: frames per second (or time units per second)
 */

import type { OTIORationalTime, OTIOTimeRange } from './types.js';

/**
 * Creates a RationalTime from seconds and frame rate.
 *
 * @param seconds - Time in seconds
 * @param fps - Frames per second
 * @returns OTIO RationalTime object
 *
 * @example
 * // 2.5 seconds at 30 fps = 75 frames
 * createRationalTime(2.5, 30) // { value: 75, rate: 30 }
 */
export function createRationalTime(seconds: number, fps: number): OTIORationalTime {
  // Convert seconds to frames, rounding to nearest frame
  const frames = Math.round(seconds * fps);

  return {
    OTIO_SCHEMA: 'RationalTime.1',
    value: frames,
    rate: fps,
  };
}

/**
 * Creates a TimeRange from start time and duration in seconds.
 *
 * @param startSeconds - Start time in seconds
 * @param durationSeconds - Duration in seconds
 * @param fps - Frames per second
 * @returns OTIO TimeRange object
 */
export function createTimeRange(
  startSeconds: number,
  durationSeconds: number,
  fps: number,
): OTIOTimeRange {
  return {
    OTIO_SCHEMA: 'TimeRange.1',
    start_time: createRationalTime(startSeconds, fps),
    duration: createRationalTime(durationSeconds, fps),
  };
}

/**
 * Creates a RationalTime representing zero.
 *
 * @param fps - Frames per second
 * @returns OTIO RationalTime with value 0
 */
export function createZeroTime(fps: number): OTIORationalTime {
  return {
    OTIO_SCHEMA: 'RationalTime.1',
    value: 0,
    rate: fps,
  };
}

/**
 * Converts frames to seconds.
 *
 * @param frames - Number of frames
 * @param fps - Frames per second
 * @returns Time in seconds
 */
export function framesToSeconds(frames: number, fps: number): number {
  return frames / fps;
}

/**
 * Converts seconds to frames.
 *
 * @param seconds - Time in seconds
 * @param fps - Frames per second
 * @returns Number of frames (rounded to nearest integer)
 */
export function secondsToFrames(seconds: number, fps: number): number {
  return Math.round(seconds * fps);
}

/**
 * Adds two RationalTimes together.
 * Both times must have the same rate.
 *
 * @param a - First time
 * @param b - Second time
 * @returns Sum of the two times
 * @throws If the rates don't match
 */
export function addRationalTimes(a: OTIORationalTime, b: OTIORationalTime): OTIORationalTime {
  if (a.rate !== b.rate) {
    throw new Error(`Cannot add RationalTimes with different rates: ${a.rate} vs ${b.rate}`);
  }

  return {
    OTIO_SCHEMA: 'RationalTime.1',
    value: a.value + b.value,
    rate: a.rate,
  };
}

/**
 * Gets the end time of a TimeRange.
 *
 * @param range - The time range
 * @returns The end time (start + duration)
 */
export function getTimeRangeEndTime(range: OTIOTimeRange): OTIORationalTime {
  return addRationalTimes(range.start_time, range.duration);
}

/**
 * Converts a RationalTime to seconds.
 *
 * @param time - The RationalTime to convert
 * @returns Time in seconds
 */
export function rationalTimeToSeconds(time: OTIORationalTime): number {
  return time.value / time.rate;
}

/**
 * Converts a TimeRange duration to seconds.
 *
 * @param range - The TimeRange
 * @returns Duration in seconds
 */
export function timeRangeDurationSeconds(range: OTIOTimeRange): number {
  return rationalTimeToSeconds(range.duration);
}
