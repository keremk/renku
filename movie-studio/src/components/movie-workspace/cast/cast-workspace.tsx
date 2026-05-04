import { useMemo, useState } from 'react';
import type { CastEntry } from '@/types/movie-project';
import { castDesignMocks } from './mocks/cast-design-mocks';
import { CastTabPanel } from './cast-tab-panel';
import { CastTabs } from './cast-tabs';
import type { CastDesignTab, CastTake, GenerationSettings } from './cast-types';
import { GenerationSettingsPane } from './generation-settings-pane';

interface CastWorkspaceProps {
  castEntry: CastEntry;
}

export function CastWorkspace({ castEntry }: CastWorkspaceProps) {
  const [activeTab, setActiveTab] = useState<CastDesignTab>('description');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const content = castDesignMocks[activeTab];

  const settings = useMemo<GenerationSettings>(() => {
    return content.settings;
  }, [content.settings]);

  const openNewTake = () => {
    setSettingsOpen(true);
  };

  const openTakeDetails = (_take: CastTake) => {
    setSettingsOpen(true);
  };

  return (
    <section className='h-full min-h-0 rounded-(--radius-panel) border border-panel-border bg-panel-bg overflow-hidden flex flex-col'>
      <header className='h-[52px] shrink-0 border-b border-border/40 bg-panel-header-bg px-4 flex items-center justify-between gap-4'>
        <div className='min-w-0'>
          <h2 className='truncate text-base font-semibold'>{castEntry.name}</h2>
          <p className='mt-0.5 text-xs text-muted-foreground'>Cast design</p>
        </div>
      </header>

      <CastTabs activeTab={activeTab} onTabChange={setActiveTab} />

      <div className='flex-1 min-h-0 flex'>
        <div className='flex-1 min-w-0 min-h-0'>
          <CastTabPanel
            activeTab={activeTab}
            content={content}
            onNewTake={openNewTake}
            onOpenDetails={openTakeDetails}
          />
        </div>

        {settingsOpen ? (
          <GenerationSettingsPane
            settings={settings}
            onClose={() => setSettingsOpen(false)}
          />
        ) : null}
      </div>
    </section>
  );
}
