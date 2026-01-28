/**
 * @vitest-environment jsdom
 */
/**
 * Tests for useBottomPanelTabs hook.
 * Covers auto-switching behavior and manual tab switching.
 */

import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBottomPanelTabs } from './use-bottom-panel-tabs';

describe('useBottomPanelTabs', () => {
  describe('initial state', () => {
    it('starts with blueprint tab active', () => {
      const { result } = renderHook(() =>
        useBottomPanelTabs({ isExecuting: false, bottomPanelVisible: false })
      );

      expect(result.current.activeTab).toBe('blueprint');
    });
  });

  describe('manual tab switching', () => {
    it('allows switching to execution tab', () => {
      const { result } = renderHook(() =>
        useBottomPanelTabs({ isExecuting: false, bottomPanelVisible: false })
      );

      act(() => {
        result.current.setActiveTab('execution');
      });

      expect(result.current.activeTab).toBe('execution');
    });

    it('allows switching back to blueprint tab', () => {
      const { result } = renderHook(() =>
        useBottomPanelTabs({ isExecuting: false, bottomPanelVisible: false })
      );

      act(() => {
        result.current.setActiveTab('execution');
      });

      act(() => {
        result.current.setActiveTab('blueprint');
      });

      expect(result.current.activeTab).toBe('blueprint');
    });
  });

  describe('auto-switch on isExecuting change', () => {
    it('switches to execution tab when isExecuting becomes true', async () => {
      const { result, rerender } = renderHook(
        ({ isExecuting, bottomPanelVisible }) =>
          useBottomPanelTabs({ isExecuting, bottomPanelVisible }),
        { initialProps: { isExecuting: false, bottomPanelVisible: false } }
      );

      expect(result.current.activeTab).toBe('blueprint');

      // Trigger execution start
      rerender({ isExecuting: true, bottomPanelVisible: false });

      // Wait for queueMicrotask to process
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.activeTab).toBe('execution');
    });

    it('does not switch when isExecuting stays true', async () => {
      const { result, rerender } = renderHook(
        ({ isExecuting, bottomPanelVisible }) =>
          useBottomPanelTabs({ isExecuting, bottomPanelVisible }),
        { initialProps: { isExecuting: true, bottomPanelVisible: false } }
      );

      // Manually switch to blueprint
      act(() => {
        result.current.setActiveTab('blueprint');
      });

      expect(result.current.activeTab).toBe('blueprint');

      // Rerender with same isExecuting value
      rerender({ isExecuting: true, bottomPanelVisible: false });

      // Wait for any microtasks
      await act(async () => {
        await Promise.resolve();
      });

      // Should not auto-switch since isExecuting didn't transition from false to true
      expect(result.current.activeTab).toBe('blueprint');
    });

    it('does not switch when isExecuting becomes false', async () => {
      const { result, rerender } = renderHook(
        ({ isExecuting, bottomPanelVisible }) =>
          useBottomPanelTabs({ isExecuting, bottomPanelVisible }),
        { initialProps: { isExecuting: true, bottomPanelVisible: false } }
      );

      // Rerender with isExecuting false
      rerender({ isExecuting: false, bottomPanelVisible: false });

      // Wait for any microtasks
      await act(async () => {
        await Promise.resolve();
      });

      // Should stay on current tab (blueprint is default)
      expect(result.current.activeTab).toBe('blueprint');
    });
  });

  describe('auto-switch on bottomPanelVisible change', () => {
    it('switches to execution tab when bottomPanelVisible becomes true', async () => {
      const { result, rerender } = renderHook(
        ({ isExecuting, bottomPanelVisible }) =>
          useBottomPanelTabs({ isExecuting, bottomPanelVisible }),
        { initialProps: { isExecuting: false, bottomPanelVisible: false } }
      );

      expect(result.current.activeTab).toBe('blueprint');

      // Bottom panel becomes visible
      rerender({ isExecuting: false, bottomPanelVisible: true });

      // Wait for queueMicrotask to process
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.activeTab).toBe('execution');
    });

    it('does not switch when bottomPanelVisible stays true', async () => {
      const { result, rerender } = renderHook(
        ({ isExecuting, bottomPanelVisible }) =>
          useBottomPanelTabs({ isExecuting, bottomPanelVisible }),
        { initialProps: { isExecuting: false, bottomPanelVisible: true } }
      );

      // Manually switch to blueprint
      act(() => {
        result.current.setActiveTab('blueprint');
      });

      expect(result.current.activeTab).toBe('blueprint');

      // Rerender with same bottomPanelVisible value
      rerender({ isExecuting: false, bottomPanelVisible: true });

      // Wait for any microtasks
      await act(async () => {
        await Promise.resolve();
      });

      // Should not auto-switch since bottomPanelVisible didn't transition from false to true
      expect(result.current.activeTab).toBe('blueprint');
    });

    it('does not switch when bottomPanelVisible becomes false', async () => {
      const { result, rerender } = renderHook(
        ({ isExecuting, bottomPanelVisible }) =>
          useBottomPanelTabs({ isExecuting, bottomPanelVisible }),
        { initialProps: { isExecuting: false, bottomPanelVisible: true } }
      );

      // Manually switch to execution
      act(() => {
        result.current.setActiveTab('execution');
      });

      expect(result.current.activeTab).toBe('execution');

      // Bottom panel becomes hidden
      rerender({ isExecuting: false, bottomPanelVisible: false });

      // Wait for any microtasks
      await act(async () => {
        await Promise.resolve();
      });

      // Should stay on execution (no auto-switch on hide)
      expect(result.current.activeTab).toBe('execution');
    });
  });

  describe('combined triggers', () => {
    it('switches when both isExecuting and bottomPanelVisible become true', async () => {
      const { result, rerender } = renderHook(
        ({ isExecuting, bottomPanelVisible }) =>
          useBottomPanelTabs({ isExecuting, bottomPanelVisible }),
        { initialProps: { isExecuting: false, bottomPanelVisible: false } }
      );

      expect(result.current.activeTab).toBe('blueprint');

      // Both become true at once
      rerender({ isExecuting: true, bottomPanelVisible: true });

      // Wait for queueMicrotask to process
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.activeTab).toBe('execution');
    });

    it('switches when isExecuting becomes true and bottomPanelVisible was already true', async () => {
      const { result, rerender } = renderHook(
        ({ isExecuting, bottomPanelVisible }) =>
          useBottomPanelTabs({ isExecuting, bottomPanelVisible }),
        { initialProps: { isExecuting: false, bottomPanelVisible: true } }
      );

      // Auto-switches on initial bottomPanelVisible true -> wait for it
      await act(async () => {
        await Promise.resolve();
      });

      // Manually switch back to blueprint
      act(() => {
        result.current.setActiveTab('blueprint');
      });

      expect(result.current.activeTab).toBe('blueprint');

      // isExecuting becomes true
      rerender({ isExecuting: true, bottomPanelVisible: true });

      // Wait for queueMicrotask to process
      await act(async () => {
        await Promise.resolve();
      });

      expect(result.current.activeTab).toBe('execution');
    });
  });
});
