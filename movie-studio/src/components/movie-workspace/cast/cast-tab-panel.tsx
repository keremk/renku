import type { CastDesignTab, CastTabContent, CastTake } from './cast-types';
import { CastGrid } from './cast-grid';
import { CastSection } from './cast-section';
import { EmptyCastSection } from './empty-cast-section';

interface CastTabPanelProps {
  activeTab: CastDesignTab;
  content: CastTabContent;
  onNewTake: () => void;
  onOpenDetails: (take: CastTake) => void;
}

export function CastTabPanel({
  activeTab,
  content,
  onNewTake,
  onOpenDetails,
}: CastTabPanelProps) {
  return (
    <div className='h-full min-h-0 p-5 flex flex-col gap-4'>
      <CastSection title='Selected Assets' className='shrink-0'>
        {content.selectedAssets.length > 0 ? (
          <div className='max-h-[280px] overflow-y-auto'>
            <CastGrid
              key={`${activeTab}-selected`}
              activeTab={activeTab}
              takes={content.selectedAssets}
              emptyMessage={content.emptySelected}
              selectedSection
              onNewTake={onNewTake}
              onOpenDetails={onOpenDetails}
            />
          </div>
        ) : (
          <EmptyCastSection message={content.emptySelected} />
        )}
      </CastSection>

      <CastSection title='Takes' className='flex-1'>
        <CastGrid
          key={`${activeTab}-takes`}
          activeTab={activeTab}
          takes={content.takes}
          emptyMessage={content.emptyTakes}
          includeNewTake
          onNewTake={onNewTake}
          onOpenDetails={onOpenDetails}
        />
      </CastSection>
    </div>
  );
}
