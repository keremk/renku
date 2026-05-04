import {
  Tabs,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import type { CastDesignTab } from './cast-types';

const tabs: Array<{ id: CastDesignTab; label: string }> = [
  { id: 'description', label: 'Description' },
  { id: 'character-sheet', label: 'Character Sheet' },
  { id: 'voice-design', label: 'Voice Design' },
];

interface CastTabsProps {
  activeTab: CastDesignTab;
  onTabChange: (tab: CastDesignTab) => void;
}

export function CastTabs({ activeTab, onTabChange }: CastTabsProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => onTabChange(value as CastDesignTab)}
      className='shrink-0 gap-0'
    >
      <TabsList
        variant='line'
        className='h-[45px] w-full justify-start rounded-none border-b border-border/40 bg-sidebar-header-bg p-0'
      >
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.id}
            value={tab.id}
            className='h-full flex-none rounded-none border-0 px-5 text-[11px] uppercase tracking-[0.12em] font-semibold data-[state=active]:bg-item-active-bg data-[state=active]:text-foreground data-[state=active]:after:bg-primary'
          >
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
