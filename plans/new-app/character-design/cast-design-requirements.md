# Cast Design Interface Requirements

Date: 2026-05-03

Status: discovery draft

## Purpose

This document organizes the early product requirements for the **Cast Design** area of Renku Movie Studio.

The goal of this iteration is to design the user interface, not the full data model or generation runtime.

Cast Design should help a user and an agent collaboratively design reusable character assets through many iterations. The user should be able to review generated takes, compare alternatives, pick preferred results, and continue refining until the character is ready for production use.

The interaction model should follow the boundary described in [Agent File Ownership And State Boundaries](../arch/agent-file-ownership-and-state-boundaries.md):

> Agents edit creative intent and desired generation intent.
>
> Renku records system state and facts.

That means the character-design agent or skill may update authored character design files and desired generation settings. It should not directly mark a run as complete, select a take, approve an artifact, or synthesize artifact state by editing files.

## Product Context

Movie Studio has a persistent production shell:

- a left navigation panel with movie structure and casting entries,
- a main detail area that changes based on the selected item,
- a persistent queue and cost area for long-running generation jobs.

When the user selects a cast character, the main detail area becomes the Cast Design workspace for that character.

The Cast Design workspace is not a rigid wizard. It is an iterative design surface where the user may move back and forth between character description, character sheets, and voice design.

## Core User Goal

The user wants to create a character that is useful across the movie.

For each character, they may optionally define:

- **Character description**
  - Textual description.
  - One or more character reference images.

- **Character sheet**
  - Generated visual sheets for the character.
  - Potentially more than one selected sheet.
  - Useful when a character needs multiple accepted looks, outfits, or visual references.

- **Voice design**
  - Voice direction and generated voice samples.
  - Likely only one selected final voice, though multiple candidate takes may be compared during iteration.

None of these sections is required.

A character can start as just a name and gradually accumulate description, images, sheets, and voice.

## Primary Interaction Model

The design should feel like a conversation between:

- the **user**, who gives creative direction and selects preferred outcomes,
- the **agent**, which proposes and applies changes through a character-design skill,
- **Renku**, which owns generation execution, artifacts, run records, selection state, and validation.

Example interaction:

```text
User: Make Mehmed II feel younger, more intense, but not villainous.

Agent:
  - updates the character description intent,
  - proposes a new image-generation prompt,
  - adjusts the desired model or parameters if needed,
  - asks Renku to generate new takes.

Renku:
  - creates the run record,
  - records generated artifacts,
  - exposes completed takes in the UI,
  - applies selection through a command or service when the user picks one.
```

The UI should show the resulting character design work. The conversation itself happens outside Movie Studio in an external agent tool such as Codex or Claude Code.

## Top-Level Workspace Structure

The character detail view should have three top-level tabs:

1. **Description**
2. **Character Sheet**
3. **Voice Design**

These tabs represent the current design area the user is working on.

The tabs should not imply a required order. A user may start with voice, skip character sheets, or only use description images.

Each tab should support:

- seeing the current selected or accepted result,
- seeing past and current iterations,
- starting a new generation from scratch,
- starting an edit based on an existing take,
- choosing or adjusting generation settings when needed,
- selecting a preferred result where that action makes sense.

## Shared Tab Layout Pattern

Each tab should probably share a common layout:

1. **Current result area**
   - Shows the currently selected or accepted design output for this section.
   - If nothing has been selected, shows an empty state that invites generation or manual authoring.

2. **Iteration gallery**
   - Shows generated takes as cards.
   - Supports comparing multiple takes.
   - Shows selected and generation-status states.

3. **Generation settings area**
   - Lets the user see and adjust the model and model-specific parameters.
   - Should feel secondary to the take gallery.
   - Should not become the place where the user inspects or works with generated media.

Generated media should be reviewed in a large modal dialog, not in a cramped side pane.

The layout should support a large number of iterations without becoming visually noisy.

## Take Cards

Generated outputs should be represented as take cards.

Each card should show:

- preview content,
- status,
- whether it is selected or only a candidate,
- model used,
- generation mode:
  - new generation,
  - edit or variation of a previous take,
- useful technical details in the footer.

The footer should make the model visible because model choice is part of creative evaluation.

Example footer content:

```text
GPT-Image-2 · Edit from Take 04 · 4 images · 16:9
```

or:

```text
ElevenLabs Voice Design · New take · 12 sec sample
```

The card itself should not expose the full technical catalog. Model selection should come from a short app-configured list, not the full provider catalog.

## Large Preview Modal

Clicking a take should open a large modal dialog for review.

The modal should be large enough for the user to properly review the output:

- character reference images,
- character sheets,
- voice samples and playback controls.

The modal is for reviewing generated output, not for editing generation parameters.

## Generation Settings Area

Generation settings should be available, but they should not dominate the UI.

This area is technical and should stay focused on generation controls:

- model selection,
- model-specific parameters,
- mode-specific settings for new generation versus edit generation.

This area should not contain:

- large media review,
- agent conversation,
- comparison workflows,
- selection workflows.

The important requirement is that it remains a focused technical controls area.

## Generation Modes

The UI needs a simple, explicit way to choose how the next generation should start.

1. **New generation**
   - Starts from the current character intent or tab intent.
   - Example: “Create a character sheet for Mehmed II.”

2. **Edit from previous take**
   - Uses an existing take as source material.
   - Example: “Modify the outfit so it is a blue kaftan.”

This distinction matters because models treat these operations differently.

The exact UI for this is still unresolved and should be designed next.

## Description Tab Requirements

The Description tab covers:

- character description text,
- character reference image iterations,
- selected or accepted reference images,
- generation settings used for future character image generation.

The text description probably has one current version rather than multiple selected versions.

Character images are different. Multiple selected images may make sense because the character can have several useful visual references.

Possible selected image examples:

- face close-up,
- full-body costume reference,
- expression reference.

The Description tab should support:

- editing or reviewing the current text description,
- generating image candidates from the description,
- selecting multiple image references if desired,
- starting image edits from an existing image take.

## Character Sheet Tab Requirements

The Character Sheet tab covers generated visual sheets.

A character may have more than one selected character sheet.

This is important because the user may want separate accepted sheets for:

- base appearance,
- alternate costume.

However, the current product direction says a meaningfully different age version, such as “Young Mehmed II,” should usually be represented as a separate character rather than a variation inside one character.

The Character Sheet tab should support:

- generating multiple character sheet takes,
- comparing generated sheets,
- selecting one or more accepted sheets,
- starting a new sheet from scratch,
- editing an existing sheet.

The UI should distinguish between:

- all generated sheet takes,
- selected sheets that become reusable production references.

## Voice Design Tab Requirements

The Voice Design tab covers voice direction and voice samples.

Voice design probably has a single selected final voice for the character, but it still needs iteration.

The user may compare many voice takes before choosing one.

The Voice Design tab should support:

- voice direction text,
- generated voice samples,
- audio playback,
- model/provider used,
- voice parameters if exposed,
- selecting the preferred voice,
- starting a new voice take,
- editing or refining from a prior voice take if the provider supports it.

The UI should avoid forcing visual take concepts onto voice design where they do not fit.

For example:

- the large preview modal should prioritize playback,
- multiple selected final voices may not be needed unless the product later supports voice modes.

## Model And Parameter Requirements

Model selection is part of generation intent.

The app should expose a short curated list of models configured for Movie Studio, rather than the giant current provider catalog.

Model selection may happen per take or per generation request.

The UI should support:

- showing the model used for every take,
- selecting a model before generating,
- showing model-specific parameters,
- keeping model settings scoped to the relevant generation mode and tab,
- making it clear whether settings are inherited from the current tab defaults or customized for a specific generation.

The model settings UI should be present, but not dominate the creative surface.

## External Agent Interaction

The Cast Design workflow is conversational, but the conversation does not happen inside Movie Studio.

The user talks to an external agent tool such as Codex or Claude Code. That agent can use a character-design skill to update intent files and trigger Renku commands.

Movie Studio should focus on showing:

- the selected character,
- the selected cast-design tab,
- current selected outputs,
- generated takes,
- generation status,
- generation settings.

Movie Studio should not include an in-app chat thread or conversation transcript.

## Selection And State Requirements

Selection is system-owned state.

The UI should let the user select or approve takes, but the underlying state transition should be handled by Renku commands or services.

Examples of system-owned facts:

- this take was generated,
- this run completed,
- this artifact exists,
- this character sheet is selected,
- this voice take is selected,
- this card is currently focused in the UI,
- this generation failed.

Examples of agent-editable intent:

- character description text,
- voice direction,
- desired model selection for the next generation,
- desired generation parameters,
- desired reference inputs by exact declared ID.

The UI should make selected results easy to see without making selection look like a normal text edit.

## Empty States

Because no section is required, empty states are important.

For each tab, the empty state should:

- clearly say that this section is optional,
- offer a primary action to start designing,
- avoid implying the user has made a mistake by leaving it blank.

Examples:

- Description: “No description yet. Describe the character or ask the agent to draft one.”
- Character Sheet: “No character sheets selected. Generate candidates when you need visual continuity.”
- Voice Design: “No voice selected. Add this only if the character speaks or needs narration continuity.”

## Relationship To Clip Production

Cast Design produces reusable references for later clip production.

Clip Production should be able to use selected character assets as inputs:

- selected character images,
- selected character sheets,
- selected voice design,
- possibly description text.

The Cast Design UI should show where a character appears in the movie, but it should not become a narrative editor.

Useful context could include:

- list of scenes or clips where the character appears,
- readiness indicators for required cast assets,
- warnings if a clip needs a character reference but none is selected.

## Non-Goals For This Iteration

This document does not yet define:

- final file layout,
- exact YAML schema,
- command names,
- provider implementation,
- model configuration format,
- full artifact lifecycle,
- queue implementation,
- exact visual styling,
- permissions or multi-user collaboration rules.

Those can be designed after the product behavior and UI flow are clearer.

## Clarifying Questions

### Selected Results

1. For character description images, can multiple images be selected at once?
YES

2. For character sheets, can multiple sheets be selected at once?
YES

3. For voice design, is exactly one selected voice enough for now?
YES - multiple does not make sense actually

### Iteration History

4. Should text description iterations be represented as takes, or should only generated media be shown as takes?
Also takes

5. Do users need side-by-side comparison mode, or is a card gallery plus large preview modal enough?
No side by side, that is too much clutter - overdesign 

6. How should the UI represent whether a take was generated from scratch or edited from an existing take?
Editing an existing take is still the same take.

7. Should rejected takes remain visible by default, be collapsed, or move into an archive/filter?
There is no "rejected" state. Users can delete takes to clean things up. Basically simply you can select takes, leave some perhaps for later, or delete the obvious bad ones.

### Agent Interaction

8. What context does Movie Studio need to expose to the external character-design agent?
There is an existing document on how Movie Studio and CLI commands plus existing editing YAML files interact in the architecture folder.

9. Should the external agent be allowed to trigger generation, or should generation always be started from Movie Studio?
Yes external agent also triggers it but this document is not intended to explain that yet.

10. Should selection always require an explicit UI action in Movie Studio?
Again external agent can also select through the use of skills and movie-cli but this is out of scope for now.

### Model Controls

11. How visible should model controls be?
Model controls are in the details pane that opens up on the right. If there is no generation yet (i.e. empty state) it also opens up. User can toggle it on/off from the footer of the cards

12. Are model choices remembered per character, per tab, per generation type, or globally?
They should be remembered per all those and also globally by defaults per type. Although configuring all these defaults etc. can get really complicated and UI wise untractable. So I would rather have some defaults with no UI (config files) for now. 

13. Should users be able to compare models intentionally, for example generating the same prompt with two different models?
Yes those will be takes. You can generate a take with NanoBanana, and another with GPT-Image-2, another with XAI-Image etc. Takes are explorations. Users are exploring and trying to find the best outcome takes and then selecting those. 

Overall, there are lots of models and there many more that come online very regularly (every week even). This area is getting better at rocket pace. The idea will be that for regular users there will be system defaults for different workflows that get updated regularly through configuration updates. Advanced users can edit those YAML files as well or ask for help from AI agents to edit and update. There will be no UI for managing model/workflow config/defaults. It will be all YAML based and can be edited by agents directly or by advanced users. 

The key UI part for models is the ability supply model parameters. Prompts, negative prompts. Override the size, resolutions, ... The stuff we have UI for in the viewer app in the models pane. Advanced users need to tweak these to get better outcomes from the takes.

### Production Integration

14. Should Cast Design show all clips where the character appears, or only warnings and readiness status?
No, cast design is only cast design. It does not have knowledge of the clips. Clips will reference the characters. There is no UI or feature planned to show: Show me all clips this user appears. (May be way in the future but certainly not in this iteration)

15. When a selected character asset changes, should downstream clips be marked stale automatically?
No. Again I don't want any complex dependency management UI or capability. The user can go the clips and regenerated them if they want but not automatic. The UI in the clip should always show the latest selected character sheet if it is edited though. We can later on build something in the clip UI (based on input hashes) that the generations inputs has changed. But from the cast UI we are not controlling or querying for these.

16. Should a clip be able to use a specific selected character sheet?
Yes but will be designed in the clip screen not in casts

### UI Shape

17. Where should the generation settings area live?
The left panel for that generation (explained above in model controls)

18. Should selected assets appear as a horizontal strip above the iteration gallery, or as a separate “Selected” section inside the gallery?
There are two sections and they are collapsible to give enough space to the takes.
- Selected Assets
- Takes

Assets are shown in a grid of cards. The card widths should depend on the aspect ratio of the asset to make sure we are showing as much of the content (image, video etc.) as possible. The grid flows horizontally to the full width (if details pane is visible up to details pane) and then flows to the next row. The # of columns depends on the grid size. Cards can also have different widths due the aspect ratio (e.g. character portrait vs. landscape vs. square)

19. Should the tabs show readiness counts?
   - Example: `Description 2 selected`, `Sheets 1 selected`, `Voice empty`.
No - avoid clutter, too much text, too much information -> Design guideline

20. Should generation jobs appear both in the tab gallery and in the global queue bar?
Only global queue. But the take card should show some generation animation (progress like rotating icon etc.)

21. What should be the default tab when opening a new character: Description, Character Sheet, or the last active tab?
Last active tab and the default is Description.

## Early UI Direction

A plausible first design direction:

```text
Character detail header
  Name, short readiness status

Tabs
  Description | Character Sheet | Voice Design

Selected result strip
  Current accepted text/images/sheets/voice for this tab

Main workspace
  Iteration gallery
    Take cards with previews, status, model, mode, and selection state

  Generation settings area (Left pane opens on demand)
    Model and parameters
    Generation mode controls, still to be designed

Large preview modal
  Opens from a take card
  Shows the generated output at a larger review size

Bottom/global
  Queue and cost bar
```

This keeps the user oriented around the character while allowing each tab to behave slightly differently for text, images, sheets, and audio.
