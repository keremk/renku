import { describe, expect, it } from 'vitest';
import type {
  TimelineDocument,
  ImageTrack,
  AudioTrack,
  VideoTrack,
  MusicTrack,
  CaptionsTrack,
} from '@gorenku/compositions';
import { convertTimelineToOTIO } from './converter.js';

function createTestTimeline(tracks: TimelineDocument['tracks'] = []): TimelineDocument {
  return {
    id: 'test-timeline-1',
    duration: 60,
    name: 'Test Timeline',
    movieId: 'test-movie-1',
    movieTitle: 'Test Movie',
    tracks,
  };
}

describe('convertTimelineToOTIO', () => {
  describe('basic timeline conversion', () => {
    it('converts empty timeline', () => {
      const timeline = createTestTimeline([]);
      const result = convertTimelineToOTIO(timeline, {}, { fps: 30 });

      expect(result.timeline.OTIO_SCHEMA).toBe('Timeline.1');
      expect(result.timeline.name).toBe('Test Movie');
      expect(result.timeline.tracks.children).toHaveLength(0);
      expect(result.stats.trackCount).toBe(0);
      expect(result.stats.clipCount).toBe(0);
    });

    it('uses movieName from options when provided', () => {
      const timeline = createTestTimeline([]);
      const result = convertTimelineToOTIO(timeline, {}, { fps: 30, movieName: 'Custom Name' });

      expect(result.timeline.name).toBe('Custom Name');
    });

    it('sets correct fps in global start time', () => {
      const timeline = createTestTimeline([]);
      const result = convertTimelineToOTIO(timeline, {}, { fps: 24 });

      expect(result.timeline.global_start_time?.rate).toBe(24);
      expect(result.stats.fps).toBe(24);
    });

    it('produces valid JSON output', () => {
      const timeline = createTestTimeline([]);
      const result = convertTimelineToOTIO(timeline, {}, { fps: 30 });

      expect(() => JSON.parse(result.otioJson)).not.toThrow();

      const parsed = JSON.parse(result.otioJson);
      expect(parsed.OTIO_SCHEMA).toBe('Timeline.1');
    });

    it('includes renku metadata', () => {
      const timeline = createTestTimeline([]);
      const result = convertTimelineToOTIO(timeline, {}, { fps: 30 });

      const metadata = result.timeline.metadata?.renku as Record<string, unknown>;
      expect(metadata.version).toBe('1.0');
      expect(metadata.sourceTimelineId).toBe('test-timeline-1');
      expect(metadata.sourceMovieId).toBe('test-movie-1');
      expect(metadata.duration).toBe(60);
      expect(metadata.exportedAt).toBeDefined();
    });
  });

  describe('image track conversion', () => {
    it('converts image track with Ken Burns effects', () => {
      const imageTrack: ImageTrack = {
        id: 'image-track-1',
        kind: 'Image',
        clips: [
          {
            id: 'image-clip-1',
            kind: 'Image',
            startTime: 0,
            duration: 10,
            properties: {
              effect: 'KenBurns',
              effects: [
                {
                  name: 'effect-1',
                  style: 'zoom-in',
                  assetId: 'asset-image-1',
                  startScale: 1.0,
                  endScale: 1.2,
                },
                {
                  name: 'effect-2',
                  style: 'pan-right',
                  assetId: 'asset-image-2',
                  startX: 0,
                  endX: 100,
                },
              ],
            },
          },
        ],
      };

      const assetPaths = {
        'asset-image-1': '/path/to/image1.png',
        'asset-image-2': '/path/to/image2.png',
      };

      const timeline = createTestTimeline([imageTrack]);
      const result = convertTimelineToOTIO(timeline, assetPaths, { fps: 30 });

      expect(result.stats.trackCount).toBe(1);
      expect(result.stats.videoTrackCount).toBe(1);

      const track = result.timeline.tracks.children[0];
      expect(track.kind).toBe('Video');

      // Filter out gaps to count clips
      const clips = track.children.filter((c) => c.OTIO_SCHEMA === 'Clip.2');
      expect(clips.length).toBe(2); // Two Ken Burns effects
    });

    it('creates external reference for images with paths', () => {
      const imageTrack: ImageTrack = {
        id: 'image-track-1',
        kind: 'Image',
        clips: [
          {
            id: 'clip-1',
            kind: 'Image',
            startTime: 0,
            duration: 5,
            properties: {
              effects: [{ assetId: 'img-1', name: 'effect-1' }],
            },
          },
        ],
      };

      const timeline = createTestTimeline([imageTrack]);
      const result = convertTimelineToOTIO(
        timeline,
        { 'img-1': '/images/photo.png' },
        { fps: 30 },
      );

      const track = result.timeline.tracks.children[0];
      const clips = track.children.filter((c) => c.OTIO_SCHEMA === 'Clip.2');
      const clip = clips[0];

      if (clip.OTIO_SCHEMA === 'Clip.2') {
        expect(clip.active_media_reference_key).toBe('DEFAULT_MEDIA');
        const mediaRef = clip.media_references['DEFAULT_MEDIA'];
        expect(mediaRef.OTIO_SCHEMA).toBe('ExternalReference.1');
        if (mediaRef.OTIO_SCHEMA === 'ExternalReference.1') {
          // DaVinci Resolve expects paths WITHOUT file:// prefix
          expect(mediaRef.target_url).toBe('/images/photo.png');
        }
      }
    });

    it('creates missing reference when asset path not provided', () => {
      const imageTrack: ImageTrack = {
        id: 'image-track-1',
        kind: 'Image',
        clips: [
          {
            id: 'clip-1',
            kind: 'Image',
            startTime: 0,
            duration: 5,
            properties: {
              effects: [{ assetId: 'missing-asset', name: 'effect-1' }],
            },
          },
        ],
      };

      const timeline = createTestTimeline([imageTrack]);
      const result = convertTimelineToOTIO(timeline, {}, { fps: 30 });

      const track = result.timeline.tracks.children[0];
      const clips = track.children.filter((c) => c.OTIO_SCHEMA === 'Clip.2');
      const clip = clips[0];

      if (clip.OTIO_SCHEMA === 'Clip.2') {
        expect(clip.active_media_reference_key).toBe('DEFAULT_MEDIA');
        const mediaRef = clip.media_references['DEFAULT_MEDIA'];
        expect(mediaRef.OTIO_SCHEMA).toBe('MissingReference.1');
      }
    });
  });

  describe('video track conversion', () => {
    it('converts video track', () => {
      const videoTrack: VideoTrack = {
        id: 'video-track-1',
        kind: 'Video',
        clips: [
          {
            id: 'video-clip-1',
            kind: 'Video',
            startTime: 5,
            duration: 20,
            properties: {
              assetId: 'asset-video-1',
              fitStrategy: 'cover',
              originalDuration: 25,
            },
          },
        ],
      };

      const timeline = createTestTimeline([videoTrack]);
      const result = convertTimelineToOTIO(
        timeline,
        { 'asset-video-1': '/videos/clip.mp4' },
        { fps: 30 },
      );

      expect(result.stats.videoTrackCount).toBe(1);

      const track = result.timeline.tracks.children[0];
      expect(track.kind).toBe('Video');
      expect(track.metadata?.renku).toMatchObject({ originalKind: 'Video' });
    });
  });

  describe('audio track conversion', () => {
    it('converts audio track (narration)', () => {
      const audioTrack: AudioTrack = {
        id: 'audio-track-1',
        kind: 'Audio',
        clips: [
          {
            id: 'narration-1',
            kind: 'Audio',
            startTime: 0,
            duration: 30,
            properties: {
              assetId: 'asset-narration-1',
              volume: 0.8,
              fadeInDuration: 0.5,
              fadeOutDuration: 1.0,
            },
          },
        ],
      };

      const timeline = createTestTimeline([audioTrack]);
      const result = convertTimelineToOTIO(
        timeline,
        { 'asset-narration-1': '/audio/narration.mp3' },
        { fps: 30 },
      );

      expect(result.stats.audioTrackCount).toBe(1);

      const track = result.timeline.tracks.children[0];
      expect(track.kind).toBe('Audio');
      expect(track.metadata?.renku).toMatchObject({ originalKind: 'Audio' });
    });
  });

  describe('music track conversion', () => {
    it('converts music track', () => {
      const musicTrack: MusicTrack = {
        id: 'music-track-1',
        kind: 'Music',
        clips: [
          {
            id: 'music-1',
            kind: 'Music',
            startTime: 0,
            duration: 60,
            properties: {
              assetId: 'asset-music-1',
              volume: 0.3,
              duration: 'match',
              play: 'loop',
            },
          },
        ],
      };

      const timeline = createTestTimeline([musicTrack]);
      const result = convertTimelineToOTIO(
        timeline,
        { 'asset-music-1': '/audio/music.mp3' },
        { fps: 30 },
      );

      expect(result.stats.audioTrackCount).toBe(1);

      const track = result.timeline.tracks.children[0];
      expect(track.kind).toBe('Audio');
      expect(track.metadata?.renku).toMatchObject({ originalKind: 'Music' });
    });
  });

  describe('captions track conversion', () => {
    it('converts captions to markers', () => {
      const captionsTrack: CaptionsTrack = {
        id: 'captions-track-1',
        kind: 'Captions',
        clips: [
          {
            id: 'caption-clip-1',
            kind: 'Captions',
            startTime: 0,
            duration: 10,
            properties: {
              captions: ['Hello world', 'This is a test'],
            },
          },
        ],
      };

      const timeline = createTestTimeline([captionsTrack]);
      const result = convertTimelineToOTIO(timeline, {}, { fps: 30 });

      // Captions become markers on the stack, not a track
      expect(result.stats.trackCount).toBe(0);

      const markers = result.timeline.tracks.markers;
      expect(markers).toBeDefined();
      expect(markers).toHaveLength(2);
      expect(markers?.[0].comment).toBe('Hello world');
      expect(markers?.[1].comment).toBe('This is a test');
    });
  });

  describe('multi-track timeline', () => {
    it('converts timeline with multiple track types', () => {
      const imageTrack: ImageTrack = {
        id: 'images',
        kind: 'Image',
        clips: [
          {
            id: 'img-1',
            kind: 'Image',
            startTime: 0,
            duration: 10,
            properties: { effects: [{ assetId: 'a1', name: 'e1' }] },
          },
        ],
      };

      const audioTrack: AudioTrack = {
        id: 'narration',
        kind: 'Audio',
        clips: [
          {
            id: 'nar-1',
            kind: 'Audio',
            startTime: 0,
            duration: 10,
            properties: { assetId: 'a2' },
          },
        ],
      };

      const musicTrack: MusicTrack = {
        id: 'music',
        kind: 'Music',
        clips: [
          {
            id: 'mus-1',
            kind: 'Music',
            startTime: 0,
            duration: 60,
            properties: { assetId: 'a3' },
          },
        ],
      };

      const timeline = createTestTimeline([imageTrack, audioTrack, musicTrack]);
      const result = convertTimelineToOTIO(
        timeline,
        { a1: '/a1.png', a2: '/a2.mp3', a3: '/a3.mp3' },
        { fps: 30 },
      );

      expect(result.stats.trackCount).toBe(3);
      expect(result.stats.videoTrackCount).toBe(1);
      expect(result.stats.audioTrackCount).toBe(2);
    });
  });
});
