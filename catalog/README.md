# Bundled Blueprint Reference

This folder contains the canonical catalog that ships with the Renku CLI. It includes:

- `blueprints/<slug>/<slug>.yaml` – public blueprints grouped by folder (each folder also includes an `input-template.yaml` you can copy).
- `producers/<name>/` – producer definitions, prompt TOML files, and input/output schemas collocated per producer.
- `producers/shared/` – shared schemas referenced across producers.

When you run `renku init`, the entire `catalog/` directory is copied into `<root>/catalog/` (defaults to `~/.renku/catalog/`). The files under the repo-level `catalog/` directory remain the source of truth for development or when you want to inspect the latest examples directly from the repo.

Use the CLI commands to explore what’s available:

```bash
tutopanda blueprints:list
tutopanda blueprints:describe audio-only.yaml
tutopanda blueprints:validate image-audio.yaml
```

## Blueprint Overview

| File                        | Summary                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `audio-only/audio-only.yaml` | Generates narration scripts and audio segments only                      |
| `image-only/image-only.yaml` | Creates narration plus prompt-driven images (no audio)                   |
| `kenn-burns/image-audio.yaml`| Full workflow: narration, images, audio, and timeline composition        |
| `cut-scene-video/video-audio-music.yaml` | Narration, video, and music generation with timeline composition |

Each YAML blueprint follows the format documented in `core/docs/yaml-blueprint-spec.md`. At a high level, you declare:

- `meta`: id, name, version, author info
- `inputs`: required/optional inputs users must provide
- `artifacts`: outputs the workflow produces
- `loops`: optional iteration dimensions (e.g., segment, image)
- `modules`: imported producer definitions (`../../producers/<name>/<file>.yaml`)
- `connections`: wiring between inputs, modules, and artefacts

## Running a Blueprint

After `tutopanda init`, you can invoke the CLI with a positional inquiry prompt:

```bash
tutopanda query "Tell me about Waterloo" \
  --inputs=~/movies/waterloo-inputs.yaml \
  --using-blueprint=audio-only.yaml
```

- `--inputs`: path to your YAML inputs file (`inputs: { InquiryPrompt: ..., Duration: ... }`)
- `--using-blueprint`: either a path or a file name. When you pass only the file name, the CLI resolves it relative to `<root>/catalog/blueprints/` first, then falls back to the bundled copy.

You can list providers for a blueprint:

```bash
tutopanda providers:list --using-blueprint=image-audio.yaml
```

Or inspect/validate:

```bash
tutopanda blueprints:describe image-only.yaml
tutopanda blueprints:validate ~/.tutopanda/blueprints/image-audio.yaml
```

## Creating / Editing Blueprints

1. Copy one of the existing YAMLs into your CLI root (e.g., `~/.tutopanda/blueprints/custom.yaml`).
2. Modify `inputs`, `artifacts`, `modules`, and `connections` as needed. Keep supporting producer files under `<root>/catalog/producers/`.
3. Validate changes before running:

   ```bash
   tutopanda blueprints:validate ~/.tutopanda/blueprints/custom.yaml
   ```

4. Run the workflow:

   ```bash
   tutopanda query "My custom prompt" \
  --inputs=~/movies/custom-inputs.yaml \
     --using-blueprint=custom.yaml
   ```

### Tips
- Keep producers self-contained under `producers/<name>/` so they can be reused by other blueprints.
- `promptFile` references (e.g., `producers/<name>/*.toml`) and JSON schemas live alongside the producer files.
- Always include `InquiryPrompt` in your inputs and optionally override it via the positional argument to `tutopanda query`.
- Track your blueprint files in version control; only the copies under `<root>/catalog/blueprints/` are used at runtime.
