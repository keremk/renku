# @gorenku/compositions

> Shared Remotion compositions and renderers for Renku video generation

[![npm version](https://img.shields.io/npm/v/@gorenku/compositions.svg)](https://www.npmjs.com/package/@gorenku/compositions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Remotion](https://img.shields.io/badge/Remotion-4.0+-blue)](https://www.remotion.dev/)

Remotion-based video rendering components and timeline document format for Renku. Supports both browser and Node.js environments for video playback and export.

## Overview

`@gorenku/compositions` provides the video rendering layer for Renku using [Remotion](https://www.remotion.dev/). It defines:

- **Timeline document format** - JSON structure for representing video timelines
- **Remotion compositions** - React components for rendering video content
- **Track system** - Support for image, audio, video, music, and caption tracks
- **Effects system** - Built-in effects like Ken Burns pan/zoom
- **Dual environment support** - Works in both browser (via Remotion Player) and Node.js (via @remotion/renderer)

This package is designed for developers who want to customize video rendering or build alternative viewers.

## Installation

```bash
npm install @gorenku/compositions
```

## Key Exports

### Compositions

- `DocumentaryComposition` - Main video composition component
- `DocumentaryRoot` - Remotion root component configuration
- `DOCUMENTARY_COMPOSITION_ID` - Composition identifier constant

### Types

- `TimelineDocument` - Main timeline structure
- **Track Types**: `ImageTrack`, `AudioTrack`, `MusicTrack`, `VideoTrack`, `CaptionsTrack`
- **Clip Types**: `ImageClip`, `AudioClip`, `MusicClip`, `VideoClip`, `CaptionsClip`
- `KenBurnsEffect` - Image pan/zoom effect definition
- `AssetMap` - Asset reference mapping

### Utilities

- `remapSpeed()` - Speed adjustment utilities for timeline clips

### Entry Points

- **Main export** (`index.ts`) - Full composition exports for Node.js
- **Browser export** (`browser.ts`) - Browser-safe composition exports

## Timeline Document Format

The timeline document is a JSON structure that describes the complete video composition:

```typescript
{
  fps: 30,                    // Frames per second
  durationInFrames: 600,      // Total duration in frames
  width: 1920,                // Video width
  height: 1080,               // Video height
  tracks: [
    {
      kind: "Image",          // Track type
      clips: [
        {
          id: "image-1",
          start: 0,            // Start frame
          duration: 150,       // Duration in frames
          src: "image.png",    // Asset reference
          effect: {            // Optional effect
            kind: "KenBurns",
            from: { x: 0, y: 0, scale: 1 },
            to: { x: 100, y: 50, scale: 1.2 }
          }
        }
      ]
    },
    {
      kind: "Audio",
      clips: [
        {
          id: "audio-1",
          start: 0,
          duration: 150,
          src: "narration.mp3",
          volume: 0.8         // Optional volume (0-1)
        }
      ]
    }
  ]
}
```

### Supported Track Types

- **ImageTrack** - Static images with optional effects (Ken Burns, etc.)
- **AudioTrack** - Narration or sound effects
- **MusicTrack** - Background music
- **VideoTrack** - Video clips
- **CaptionsTrack** - Subtitles and captions

### Supported Effects

- **KenBurns** - Pan and zoom effects for images
  - Define start and end positions (x, y, scale)
  - Smooth interpolation between keyframes

## Usage Example

### Browser Playback (Remotion Player)

```typescript
import { Player } from '@remotion/player';
import { DocumentaryComposition } from '@gorenku/compositions/browser';
import type { TimelineDocument } from '@gorenku/compositions';

const timeline: TimelineDocument = {
  fps: 30,
  durationInFrames: 600,
  width: 1920,
  height: 1080,
  tracks: [
    // Your tracks here
  ]
};

const assetMap = {
  'image.png': '/path/to/image.png',
  'narration.mp3': '/path/to/audio.mp3'
};

function App() {
  return (
    <Player
      component={DocumentaryComposition}
      inputProps={{ timeline, assetMap }}
      durationInFrames={timeline.durationInFrames}
      fps={timeline.fps}
      compositionWidth={timeline.width}
      compositionHeight={timeline.height}
    />
  );
}
```

### Server-Side Rendering (Node.js)

```typescript
import { bundle } from '@remotion/bundler';
import { renderMedia } from '@remotion/renderer';
import { DocumentaryRoot } from '@gorenku/compositions';

// Bundle the composition
const bundled = await bundle({
  entryPoint: DocumentaryRoot,
  webpackOverride: (config) => config
});

// Render to video
await renderMedia({
  composition: {
    id: 'documentary',
    fps: 30,
    durationInFrames: 600,
    width: 1920,
    height: 1080
  },
  serveUrl: bundled,
  codec: 'h264',
  outputLocation: './output.mp4',
  inputProps: {
    timeline,
    assetMap
  }
});
```

## Development

### Setup

```bash
# Clone the monorepo
git clone https://github.com/yourusername/renku.git
cd renku

# Install dependencies
pnpm install
```

### Build

```bash
# Build the compositions package
pnpm --filter @gorenku/compositions build

# Watch mode for development
pnpm --filter @gorenku/compositions dev
```

### Type Checking

```bash
# Type check the package
pnpm --filter @gorenku/compositions type-check
```

## Project Structure

```
compositions/
├── src/
│   ├── compositions/        # Remotion composition components
│   │   └── documentary/     # Documentary composition
│   ├── remotion/            # Remotion configuration
│   ├── lib/                 # Utility libraries
│   │   └── remotion/        # Remotion utilities
│   ├── types/               # TypeScript type definitions
│   │   └── timeline.ts      # Timeline document types
│   ├── index.ts             # Main entry point (Node.js)
│   └── browser.ts           # Browser entry point
├── dist/                    # Build output
└── package.json
```

## Rendering with Remotion CLI

You can also use the Remotion CLI directly:

```bash
# Install Remotion CLI
npm install -g @remotion/cli

# Render a composition
remotion render src/index.ts documentary output.mp4 \
  --props='{"timeline": ..., "assetMap": ...}'
```

## Contributing

When contributing to the compositions package:

- Follow Remotion best practices for performance
- Ensure effects are smooth and GPU-accelerated where possible
- Test compositions in both browser and Node.js environments
- Follow the coding conventions in [CLAUDE.md](../CLAUDE.md)
- Add tests for new composition types or effects

## License

MIT
