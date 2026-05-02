import { useState } from 'react';
import {
  Clapperboard,
  Layers3,
  ListTree,
  Sparkles,
  UserRound,
  UsersRound,
} from 'lucide-react';
import type { MovieStudioProject, Selection } from '@/types/movie-project';
import { toggleSetValue } from '../model/movie-selection';
import { NavButton } from './nav-button';
import { NavigationSection } from './navigation-section';

interface MovieNavigationProps {
  project: MovieStudioProject;
  selection: Selection;
  onSelect: (selection: Selection) => void;
}

export function MovieNavigation({
  project,
  selection,
  onSelect,
}: MovieNavigationProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(['sequences', 'casting'])
  );
  const [expandedSequences, setExpandedSequences] = useState<Set<string>>(
    () => new Set(project.sequences.slice(0, 1).map((sequence) => sequence.id))
  );
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(
    () => new Set()
  );
  const sequencesExpanded = expandedSections.has('sequences');
  const castingExpanded = expandedSections.has('casting');

  const toggleSection = (section: string) => {
    setExpandedSections((current) => toggleSetValue(current, section));
  };

  const toggleSequence = (sequenceId: string) => {
    setExpandedSequences((current) => toggleSetValue(current, sequenceId));
  };

  const toggleScene = (sceneId: string) => {
    setExpandedScenes((current) => toggleSetValue(current, sceneId));
  };

  return (
    <aside className='min-h-0 rounded-(--radius-panel) border border-sidebar-border bg-sidebar-bg overflow-hidden flex flex-col'>
      <div className='h-[45px] px-4 border-b border-border/40 bg-sidebar-header-bg flex items-center justify-between shrink-0'>
        <div className='flex items-center gap-2'>
          <ListTree className='w-4 h-4 text-muted-foreground' />
          <h2 className='text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground'>
            Movie Structure
          </h2>
        </div>
        <span className='text-[10px] text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full font-medium'>
          {project.totals.clips}
        </span>
      </div>

      <div className='flex-1 min-h-0 overflow-y-auto p-2 space-y-4'>
        <NavigationSection
          title='Sequences'
          detail={`${project.totals.sequences} sequences, ${project.totals.clips} clips`}
          icon={<Layers3 className='h-4 w-4' />}
          active={selection.type === 'storyboard'}
          expanded={sequencesExpanded}
          onSelect={() => onSelect({ type: 'storyboard' })}
          onToggle={() => toggleSection('sequences')}
        >
          {sequencesExpanded
            ? project.sequences.map((sequence) => {
                const sequenceExpanded = expandedSequences.has(sequence.id);
                return (
                  <div key={sequence.id} className='space-y-1'>
                    <NavButton
                      active={
                        selection.type === 'sequence' && selection.id === sequence.id
                      }
                      icon={<Layers3 className='h-4 w-4' />}
                      label={sequence.shortTitle ?? sequence.title}
                      detail={`${sequence.scenes.length} scenes`}
                      onClick={() => onSelect({ type: 'sequence', id: sequence.id })}
                      disclosure={{
                        expanded: sequenceExpanded,
                        label: `${sequenceExpanded ? 'Collapse' : 'Expand'} ${
                          sequence.shortTitle ?? sequence.title
                        }`,
                        onToggle: () => toggleSequence(sequence.id),
                      }}
                    />
                    {sequenceExpanded ? (
                      <div className='ml-4 border-l border-border/30 pl-2 space-y-1'>
                        {sequence.scenes.map((scene) => {
                          const sceneExpanded = expandedScenes.has(scene.id);
                          return (
                            <div key={scene.id} className='space-y-1'>
                              <NavButton
                                active={
                                  selection.type === 'scene' &&
                                  selection.id === scene.id
                                }
                                icon={<Clapperboard className='h-4 w-4' />}
                                label={scene.title}
                                detail={`${scene.clips.length} clips`}
                                onClick={() =>
                                  onSelect({ type: 'scene', id: scene.id })
                                }
                                disclosure={{
                                  expanded: sceneExpanded,
                                  label: `${sceneExpanded ? 'Collapse' : 'Expand'} ${
                                    scene.title
                                  }`,
                                  onToggle: () => toggleScene(scene.id),
                                }}
                              />
                              {sceneExpanded ? (
                                <div className='ml-4 border-l border-border/20 pl-2 space-y-1'>
                                  {scene.clips.map((clip) => (
                                    <NavButton
                                      key={clip.id}
                                      active={
                                        selection.type === 'clip' &&
                                        selection.id === clip.id
                                      }
                                      icon={<Sparkles className='h-3.5 w-3.5' />}
                                      label={clip.title}
                                      detail={clip.summary ?? 'Clip workspace'}
                                      compact
                                      onClick={() =>
                                        onSelect({ type: 'clip', id: clip.id })
                                      }
                                    />
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })
            : null}
        </NavigationSection>

        <NavigationSection
          title='Cast'
          detail={`${project.cast.length} entries`}
          icon={<UsersRound className='h-4 w-4' />}
          active={selection.type === 'casting'}
          expanded={castingExpanded}
          onSelect={() => onSelect({ type: 'casting' })}
          onToggle={() => toggleSection('casting')}
        >
          {castingExpanded
            ? project.cast.map((castEntry) => (
                <NavButton
                  key={castEntry.id}
                  active={selection.type === 'cast' && selection.id === castEntry.id}
                  icon={<UserRound className='h-4 w-4' />}
                  label={castEntry.name}
                  detail={castEntry.role ?? castEntry.kind ?? 'Cast entry'}
                  compact
                  onClick={() => onSelect({ type: 'cast', id: castEntry.id })}
                />
              ))
            : null}
        </NavigationSection>
      </div>
    </aside>
  );
}
