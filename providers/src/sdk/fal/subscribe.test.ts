import { describe, it, expect } from 'vitest';
import {
  getPollIntervalForModel,
  getTimeoutForModel,
  FalTimeoutError,
} from './subscribe.js';

describe('fal subscribe utilities', () => {
  describe('getPollIntervalForModel', () => {
    it('returns 5 seconds for video models', () => {
      expect(getPollIntervalForModel('kling-video')).toBe(5000);
      expect(getPollIntervalForModel('fal-ai/kling')).toBe(5000);
      expect(getPollIntervalForModel('runway-gen3')).toBe(5000);
      expect(getPollIntervalForModel('minimax-video-01')).toBe(5000);
      expect(getPollIntervalForModel('luma-dream-machine')).toBe(5000);
    });

    it('returns 2 seconds for image models', () => {
      expect(getPollIntervalForModel('flux-pro')).toBe(2000);
      expect(getPollIntervalForModel('stable-diffusion-xl')).toBe(2000);
      expect(getPollIntervalForModel('sdxl')).toBe(2000);
    });

    it('returns 3 seconds for other models', () => {
      expect(getPollIntervalForModel('some-other-model')).toBe(3000);
      expect(getPollIntervalForModel('audio-generator')).toBe(3000);
    });
  });

  describe('getTimeoutForModel', () => {
    it('returns 15 minutes for video models', () => {
      expect(getTimeoutForModel('kling-video')).toBe(15 * 60 * 1000);
      expect(getTimeoutForModel('runway-gen3')).toBe(15 * 60 * 1000);
      expect(getTimeoutForModel('minimax-video')).toBe(15 * 60 * 1000);
    });

    it('returns 5 minutes for image models', () => {
      expect(getTimeoutForModel('flux-pro')).toBe(5 * 60 * 1000);
      expect(getTimeoutForModel('stable-diffusion')).toBe(5 * 60 * 1000);
    });

    it('returns 10 minutes for other models', () => {
      expect(getTimeoutForModel('some-model')).toBe(10 * 60 * 1000);
    });
  });

  describe('FalTimeoutError', () => {
    it('includes requestId in the error', () => {
      const error = new FalTimeoutError('Timed out', 'req-123');
      expect(error.requestId).toBe('req-123');
      expect(error.message).toBe('Timed out');
      expect(error.provider).toBe('fal-ai');
      expect(error.recoverable).toBe(true);
    });

    it('has correct name', () => {
      const error = new FalTimeoutError('Timed out', 'req-123');
      expect(error.name).toBe('FalTimeoutError');
    });

    it('is instanceof Error', () => {
      const error = new FalTimeoutError('Timed out', 'req-123');
      expect(error).toBeInstanceOf(Error);
    });
  });
});

describe('falSubscribe', () => {
  // Note: Full integration tests would require mocking fal.subscribe
  // These are unit tests for the helper functions
  // Integration tests should be added with actual fal.ai credentials in a separate test file

  it.todo('should capture requestId via onEnqueue callback');
  it.todo('should throw FalTimeoutError on timeout with requestId');
  it.todo('should use configured pollInterval');
  it.todo('should use configured timeout');
});
