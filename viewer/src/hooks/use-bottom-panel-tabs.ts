import { useState, useRef, useEffect } from 'react';

export type BottomPanelTab = 'blueprint' | 'execution' | 'timeline';

interface UseBottomPanelTabsOptions {
  isExecuting: boolean;
  bottomPanelVisible: boolean;
}

interface UseBottomPanelTabsResult {
  activeTab: BottomPanelTab;
  setActiveTab: (tab: BottomPanelTab) => void;
}

/**
 * Manages bottom panel tab state with auto-switching behavior.
 * Automatically switches to 'execution' tab when:
 * - Execution starts (isExecuting transitions to true)
 * - Bottom panel becomes visible
 */
export function useBottomPanelTabs(
  options: UseBottomPanelTabsOptions
): UseBottomPanelTabsResult {
  const [activeTab, setActiveTab] = useState<BottomPanelTab>('blueprint');
  const prevIsExecutingRef = useRef(options.isExecuting);
  const prevBottomPanelVisibleRef = useRef(options.bottomPanelVisible);

  useEffect(() => {
    const shouldSwitch =
      (options.isExecuting && !prevIsExecutingRef.current) ||
      (options.bottomPanelVisible && !prevBottomPanelVisibleRef.current);

    prevIsExecutingRef.current = options.isExecuting;
    prevBottomPanelVisibleRef.current = options.bottomPanelVisible;

    if (shouldSwitch) {
      queueMicrotask(() => setActiveTab('execution'));
    }
  }, [options.isExecuting, options.bottomPanelVisible]);

  return { activeTab, setActiveTab };
}
