import { describe, expect, it } from 'vitest';
import {
  createRationalTime,
  createTimeRange,
  createZeroTime,
  framesToSeconds,
  secondsToFrames,
  addRationalTimes,
  getTimeRangeEndTime,
  rationalTimeToSeconds,
  timeRangeDurationSeconds,
} from './time-utils.js';

describe('createRationalTime', () => {
  it('converts seconds to frames at 30fps', () => {
    const time = createRationalTime(2.5, 30);

    expect(time.OTIO_SCHEMA).toBe('RationalTime.1');
    expect(time.value).toBe(75); // 2.5 * 30 = 75 frames
    expect(time.rate).toBe(30);
  });

  it('converts seconds to frames at 24fps', () => {
    const time = createRationalTime(1.0, 24);

    expect(time.value).toBe(24);
    expect(time.rate).toBe(24);
  });

  it('rounds to nearest frame', () => {
    // 1.016666... seconds at 30fps = 30.5 frames -> rounds to 31
    const time = createRationalTime(1.016667, 30);
    expect(time.value).toBe(31);
  });

  it('handles zero seconds', () => {
    const time = createRationalTime(0, 30);
    expect(time.value).toBe(0);
    expect(time.rate).toBe(30);
  });
});

describe('createTimeRange', () => {
  it('creates a time range with start and duration', () => {
    const range = createTimeRange(5.0, 10.0, 30);

    expect(range.OTIO_SCHEMA).toBe('TimeRange.1');
    expect(range.start_time.value).toBe(150); // 5 * 30
    expect(range.start_time.rate).toBe(30);
    expect(range.duration.value).toBe(300); // 10 * 30
    expect(range.duration.rate).toBe(30);
  });

  it('handles fractional seconds', () => {
    const range = createTimeRange(0.5, 2.5, 24);

    expect(range.start_time.value).toBe(12); // 0.5 * 24
    expect(range.duration.value).toBe(60); // 2.5 * 24
  });
});

describe('createZeroTime', () => {
  it('creates zero time at specified fps', () => {
    const time = createZeroTime(30);

    expect(time.OTIO_SCHEMA).toBe('RationalTime.1');
    expect(time.value).toBe(0);
    expect(time.rate).toBe(30);
  });
});

describe('framesToSeconds', () => {
  it('converts frames to seconds', () => {
    expect(framesToSeconds(75, 30)).toBe(2.5);
    expect(framesToSeconds(24, 24)).toBe(1.0);
    expect(framesToSeconds(0, 30)).toBe(0);
  });
});

describe('secondsToFrames', () => {
  it('converts seconds to frames', () => {
    expect(secondsToFrames(2.5, 30)).toBe(75);
    expect(secondsToFrames(1.0, 24)).toBe(24);
    expect(secondsToFrames(0, 30)).toBe(0);
  });

  it('rounds to nearest frame', () => {
    expect(secondsToFrames(1.016667, 30)).toBe(31);
  });
});

describe('addRationalTimes', () => {
  it('adds two times with same rate', () => {
    const a = createRationalTime(1.0, 30);
    const b = createRationalTime(2.0, 30);
    const result = addRationalTimes(a, b);

    expect(result.value).toBe(90); // 30 + 60
    expect(result.rate).toBe(30);
  });

  it('throws on mismatched rates', () => {
    const a = createRationalTime(1.0, 30);
    const b = createRationalTime(1.0, 24);

    expect(() => addRationalTimes(a, b)).toThrow('Cannot add RationalTimes with different rates');
  });
});

describe('getTimeRangeEndTime', () => {
  it('returns start + duration', () => {
    const range = createTimeRange(5.0, 10.0, 30);
    const endTime = getTimeRangeEndTime(range);

    expect(endTime.value).toBe(450); // (5 + 10) * 30
    expect(endTime.rate).toBe(30);
  });
});

describe('rationalTimeToSeconds', () => {
  it('converts rational time to seconds', () => {
    const time = createRationalTime(2.5, 30);
    expect(rationalTimeToSeconds(time)).toBe(2.5);
  });

  it('handles zero', () => {
    const time = createZeroTime(30);
    expect(rationalTimeToSeconds(time)).toBe(0);
  });
});

describe('timeRangeDurationSeconds', () => {
  it('returns duration in seconds', () => {
    const range = createTimeRange(5.0, 10.0, 30);
    expect(timeRangeDurationSeconds(range)).toBe(10.0);
  });
});
