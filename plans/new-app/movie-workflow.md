Yes. I would name the workflow around a core idea:

> **Research → Story Architecture → Cinematic Plan → Clip Production → Edit Assembly**

The key is to separate **story decisions** from **production decisions**. Otherwise the tool becomes a mess of prompts too early.

Here’s a strong terminology stack.

---

# Recommended workflow stages

## 0. Research Notes

**Input stage**

This is where your external research system hands off material to the filmmaking system.

**Contains:**

* historical facts
* sources
* dates
* people
* places
* quotes
* visual references
* uncertainties
* contradictions
* possible angles

Better product term:

> **Research Dossier**

I’d avoid just “notes” because “dossier” implies structured source material.

```text
Research Dossier
→ the factual and thematic raw material for the film
```

---

## 1. Story Brief

**Purpose:** define what the film is about before decomposing it.

This is the first transformation from research into a creative artifact.

**Contains:**

* central question
* thesis or angle
* audience promise
* tone
* runtime target
* format
* constraints
* historical scope
* excluded topics

Example:

```text
Story Brief:
A 25-minute historical documentary about how Mehmed II prepared the siege of Constantinople, focusing not on the battle itself but on the strategic, technological, and logistical machine assembled before April 1453.
```

Alternative names:

| Term              | Feel                         |
| ----------------- | ---------------------------- |
| Story Brief       | Clear, professional          |
| Creative Brief    | More advertising/agency-like |
| Documentary Brief | Specific to documentary      |
| Film Intent       | More artsy                   |
| Narrative Brief   | Good if story-first          |

My pick: **Story Brief**.

---

## 2. Narrative Spine

**Purpose:** define the main progression of the film.

This is not yet scenes. It is the big dramatic logic.

Example:

```text
Ambition → Target → Strangulation → Technology → Logistics → Isolation → Dread → Arrival
```

The Narrative Spine answers:

> What is the viewer’s journey?

It should describe how curiosity, tension, and understanding evolve.

**Contains:**

* beginning state
* ending state
* major turns
* escalation logic
* recurring motif
* emotional arc

Alternative names:

| Term                 | Feel                 |
| -------------------- | -------------------- |
| Narrative Spine      | Best term            |
| Story Arc            | Familiar but generic |
| Argument Arc         | Good for essays/docs |
| Viewer Journey       | Product-friendly     |
| Dramatic Throughline | Film-school-ish      |

My pick: **Narrative Spine**.

---

## 3. Sequence Outline

**Purpose:** break the film into large story sections.

This corresponds to what we did first.

Example:

```text
Sequence 1: The Young Sultan’s Obsession
Sequence 2: The City That Had Survived Everyone
Sequence 3: Cutting the Bosphorus Throat
Sequence 4: The Gunmaker and the Walls
Sequence 5: The Logistics of Impossible Weight
Sequence 6: Diplomacy, Isolation, and Delay
Sequence 7: The City Prepares to Die
Sequence 8: The Ottoman Army Arrives
```

**Contains per sequence:**

* title
* purpose
* historical scope
* emotional function
* key facts
* estimated duration
* transition in/out

Alternative names:

| Term             | Feel                             |
| ---------------- | -------------------------------- |
| Sequence Outline | Industry-compatible              |
| Chapter Outline  | Better for documentaries/YouTube |
| Story Blocks     | More product-y                   |
| Film Map         | Friendly                         |
| Macrostructure   | Too academic                     |

My pick: **Sequence Outline**, with optional UI label **Chapters**.

In the UI, I might show:

> **Sequences / Chapters**

That helps both film people and normal users.

---

## 4. Scene Plan

**Purpose:** decompose one sequence into concrete scenes.

This is where the story becomes filmable.

Example for Sequence 5:

```text
Scene 5.1: The Weapon Is Too Heavy for War
Scene 5.2: Edirne: The Foundry at Night
Scene 5.3: Roads for a Monster
Scene 5.4: The Cannon Begins to Move
Scene 5.5: Villages Hear the Earth Shake
Scene 5.6: The Long Road to Constantinople
Scene 5.7: First Sight of the Walls
```

**Contains per scene:**

* scene title
* purpose
* location/time
* dominant visual
* emotional state
* historical facts to preserve
* narration role
* estimated duration
* continuity notes

Alternative names:

| Term            | Feel                 |
| --------------- | -------------------- |
| Scene Plan      | Clear                |
| Scene Breakdown | More production-like |
| Scene Map       | Nice UI term         |
| Scene Treatment | More prose-heavy     |
| Segment Plan    | Good for documentary |

My pick: **Scene Plan**.

---

## 5. Beat Sheet

**Purpose:** break a scene into viewer-state changes.

This is one of the most important stages.

A beat is not just a moment. It is a **change**.

Example:

```text
Scene 5.4: The Cannon Begins to Move

Beat 1: The cannon is revealed as impossibly large.
Beat 2: Engineers and workers prepare the transport.
Beat 3: First attempt fails.
Beat 4: Men, animals, road, and command align.
Beat 5: The cannon finally moves.
Beat 6: The movement becomes symbolic destiny.
```

**Contains per beat:**

* beat title
* story change
* viewer learns/feels
* narration idea
* visual idea
* expected duration
* whether it should become one clip or several

Alternative names:

| Term              | Feel               |
| ----------------- | ------------------ |
| Beat Sheet        | Best industry term |
| Moment Map        | More accessible    |
| Story Beats       | Clear              |
| Viewer-State Plan | Accurate but nerdy |
| Dramatic Beats    | Good for fiction   |

My pick: **Beat Sheet**.

This is where your tool becomes smarter than a prompt generator.

---

## 6. Clip Plan

**Purpose:** convert beats into AI-generation-sized production units.

This is where your world differs from traditional filmmaking.

A **clip** is a production unit, not a story unit.

Example:

```text
Clip 5.4.1: The Sleeping Monster
Clip 5.4.2: Ropes, Axles, Timber
Clip 5.4.3: The Weight Refuses
Clip 5.4.4: All Force in One Direction
Clip 5.4.5: The Earth Gives Way
Clip 5.4.6: Toward the Walls
```

Each clip usually maps to one beat, but not always.

**Contains per clip:**

* linked beat
* clip title
* intended duration
* visual objective
* action
* setting
* characters
* camera behavior
* continuity constraints
* generation model target
* prompt strategy
* negative constraints
* output requirements

Alternative names:

| Term            | Feel                   |
| --------------- | ---------------------- |
| Clip Plan       | Clear                  |
| Generation Plan | AI-specific            |
| Clip Breakdown  | Production-like        |
| Video Unit Plan | Too dry                |
| Gen Clip Plan   | Practical, but jargony |

My pick: **Clip Plan** or **Generation Plan**.

In-product, I’d probably use:

> **Clip Plan**
> Subtext: “AI generation units derived from story beats.”

---

## 7. Shot Design

**Purpose:** describe the internal camera language for a clip.

Even if the AI model generates all shots in one clip, you still want to guide the internal structure.

Example:

```text
Clip 5.4.5: The Earth Gives Way

Shot 1: Extreme close-up — wheel turns one inch.
Shot 2: Medium-wide — workers shout, oxen surge.
Shot 3: Tracking shot — camera moves alongside cannon.
Shot 4: Reaction shot — young soldier smiles in disbelief.
Shot 5: Low rear shot — deep tracks carved into road.
```

**Contains per shot:**

* shot type
* framing
* camera movement
* subject
* action
* mood
* transition
* must-have visual detail

Alternative names:

| Term            | Feel              |
| --------------- | ----------------- |
| Shot Design     | Best              |
| Shot List       | Industry standard |
| Internal Shots  | AI-specific       |
| Camera Plan     | Accessible        |
| Visual Coverage | Professional      |

My pick: **Shot Design**.

I would use **Shot List** only if these are actual separate outputs. If they are internal instructions inside one AI clip, **Shot Design** is better.

---

## 8. Prompt Package

**Purpose:** turn the clip plan and shot design into model-ready generation instructions.

This is not just “the prompt.” It is a package.

**Contains:**

* main prompt
* style prompt
* camera prompt
* continuity prompt
* historical constraints
* character consistency references
* negative prompt
* duration
* aspect ratio
* seed/reference image/model params
* expected output notes

Alternative names:

| Term                  | Feel                    |
| --------------------- | ----------------------- |
| Prompt Package        | Good                    |
| Generation Spec       | More professional       |
| Render Brief          | Nice for creative tools |
| Model Instruction Set | Too technical           |
| Clip Prompt           | Too narrow              |

My pick: **Generation Spec**.

Why? Because it sounds less like casual prompting and more like a production artifact.

```text
Generation Spec
→ everything needed to generate one clip
```

---

## 9. Clip Production

**Purpose:** generate, review, iterate, and approve clips.

This is execution.

**Contains:**

* generation attempts
* variants
* selected take
* notes
* rejected reasons
* continuity issues
* regeneration instructions
* approval state

Alternative names:

| Term            | Feel           |
| --------------- | -------------- |
| Clip Production | Clear          |
| Generation Run  | Technical      |
| Takes           | Film-native    |
| Renders         | VFX/CG-native  |
| Variants        | Product-native |

My pick: combine film and AI terms:

> **Takes / Variants**

A single generated output can be called a **Take**.

Example:

```text
Clip 5.4.5
  Take A: too modern-looking wheels
  Take B: great motion, bad faces
  Take C: approved
```

That maps beautifully to filmmaking language.

---

## 10. Assembly Plan

**Purpose:** define how approved clips are ordered into a scene.

This is pre-editing logic.

**Contains:**

* clip order
* narration timing
* transitions
* music cues
* sound design
* cut points
* pacing notes
* overlays/maps/text

Alternative names:

| Term           | Feel             |
| -------------- | ---------------- |
| Assembly Plan  | Best             |
| Edit Plan      | Clear            |
| Timeline Plan  | Product-friendly |
| Scene Assembly | Very good        |
| Rough Cut Plan | Later-stage      |

My pick: **Scene Assembly**.

---

## 11. Timeline Assembly

**Purpose:** actual edited sequence or film timeline.

This is where clips, narration, music, captions, maps, and graphics become a watchable thing.

**Contains:**

* edited timeline
* selected takes
* audio layers
* captions
* graphics
* transitions
* color/sound notes
* review status

Alternative names:

| Term              | Feel                           |
| ----------------- | ------------------------------ |
| Timeline Assembly | Best                           |
| Edit Timeline     | Familiar                       |
| Rough Cut         | Industry stage                 |
| Cut               | Film-native                    |
| Composition       | Good for Remotion-like systems |

Given your Renku/media-pipeline orientation, **Composition** may be the strongest term technically.

I’d use:

> **Timeline / Composition**

---

# The full workflow

Here is the clean version:

```text
Research Dossier
  ↓
Story Brief
  ↓
Narrative Spine
  ↓
Sequence Outline
  ↓
Scene Plan
  ↓
Beat Sheet
  ↓
Clip Plan
  ↓
Shot Design
  ↓
Generation Spec
  ↓
Takes / Variants
  ↓
Scene Assembly
  ↓
Timeline / Composition
  ↓
Final Cut
```

This is the workflow I would build.

---

# The same workflow with user-facing descriptions

| Stage                      | User-facing description                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| **Research Dossier**       | Source notes, facts, quotes, people, places, dates, and visual references.    |
| **Story Brief**            | Defines the film’s angle, promise, scope, tone, and target runtime.           |
| **Narrative Spine**        | The core journey of the film: how the viewer’s understanding changes.         |
| **Sequence Outline**       | The film broken into major chapters or sections.                              |
| **Scene Plan**             | Each sequence broken into concrete scenes.                                    |
| **Beat Sheet**             | Each scene broken into story beats: moments of change.                        |
| **Clip Plan**              | Beats converted into AI-generation-sized video units.                         |
| **Shot Design**            | The internal camera structure of each generated clip.                         |
| **Generation Spec**        | Model-ready instructions for generating a clip.                               |
| **Takes / Variants**       | Generated outputs, alternatives, retries, and selected takes.                 |
| **Scene Assembly**         | Approved clips arranged into a scene with narration, pacing, and transitions. |
| **Timeline / Composition** | The full edited film or sequence timeline.                                    |
| **Final Cut**              | Polished export-ready version.                                                |

---

# My recommended product terminology

For a tool, I’d avoid making the UI feel too film-school-heavy.

I’d use this public-facing terminology:

```text
Dossier
Brief
Spine
Sequences
Scenes
Beats
Clips
Shots
Generation Specs
Takes
Assembly
Timeline
Final Cut
```

That’s short, elegant, and layered.

For tooltips:

```text
Dossier = factual source material
Brief = what we are making
Spine = the viewer journey
Sequence = major chapter
Scene = concrete dramatic/explanatory unit
Beat = meaningful change inside a scene
Clip = AI generation unit
Shot = internal camera moment
Generation Spec = model-ready clip instructions
Take = one generated result
Assembly = ordered edit plan
Timeline = actual composition
```

---

# Important conceptual distinction

I’d strongly encode this into the product:

```text
Story Layer:
  Brief → Spine → Sequences → Scenes → Beats

Production Layer:
  Clips → Shots → Generation Specs → Takes

Edit Layer:
  Assembly → Timeline → Final Cut
```

This prevents confusion.

A **beat** should remain a story object.

A **clip** should remain a production object.

A **take** should be an output object.

A **timeline item** should be an editing object.

That separation will make your data model much cleaner.

---

# Suggested data model

At a simplified level:

```ts
ResearchDossier
  StoryBrief
    NarrativeSpine
      Sequence[]
        Scene[]
          Beat[]
            Clip[]
              ShotDesign[]
              GenerationSpec
              Take[]
```

But for editing:

```ts
Timeline
  Track[]
    TimelineItem[]
      references ClipTake | Audio | TextCard | Image | Map | Graphic
```

A generated take should not be the same thing as a clip.

```text
Clip = intended production unit
Take = actual generated media output
TimelineItem = how that output is used in the edit
```

This distinction matters a lot.

---

# Example using Constantinople

```text
Research Dossier:
  Notes on Mehmed II, Rumelihisarı, Urban's cannon, Ottoman logistics, Byzantine defenses

Story Brief:
  A documentary about how Constantinople was conquered before the first assault began.

Narrative Spine:
  Ambition → Encirclement → Engineering → Logistics → Isolation → Arrival

Sequence:
  The Logistics of Impossible Weight

Scene:
  The Cannon Begins to Move

Beat:
  The first attempt fails; the cannon refuses to move.

Clip:
  The Weight Refuses

Shot Design:
  - Oxen strain in wide shot
  - Rope fibers stretch in close-up
  - Wheel sinks into mud
  - Officer reacts in frustration

Generation Spec:
  8-second historical cinematic clip, dawn near Edirne, giant Ottoman bombard on wooden carriage, oxen straining, muddy road, tense atmosphere, no modern objects

Takes:
  - Take 1: rejected, cannon too small
  - Take 2: rejected, modern wagon wheels
  - Take 3: approved, strong scale and mood

Scene Assembly:
  Clip 5.4.1 → Clip 5.4.2 → Clip 5.4.3 → Clip 5.4.4 → Clip 5.4.5 → Clip 5.4.6

Timeline:
  Approved takes plus narration, drum hits, mud sound design, map transition
```

---

# A good workflow UI could look like this

```text
1. Import Dossier
2. Create Story Brief
3. Build Narrative Spine
4. Generate Sequence Outline
5. Expand Selected Sequence into Scenes
6. Expand Selected Scene into Beats
7. Convert Beats to Clip Plans
8. Design Shots for Each Clip
9. Create Generation Specs
10. Generate Takes
11. Review & Select Takes
12. Assemble Scene
13. Build Timeline
14. Export Cut
```

That maps nicely to a wizard, pipeline, or graph.

---

# Naming the whole system/workflow

Some possible names for the overall workflow:

## Functional names

| Name                         | Meaning                          |
| ---------------------------- | -------------------------------- |
| **Dossier to Cut**           | Research notes become final film |
| **Notes to Narrative**       | Research becomes story           |
| **Brief to Timeline**        | Planning to edit                 |
| **Story-to-Screen Pipeline** | Classic but clear                |
| **Research-to-Reel**         | Good documentary flavor          |
| **Sequence Builder**         | Focuses on decomposition         |
| **Cinematic Decomposition**  | Precise but academic             |
| **Film Plan Pipeline**       | Practical                        |

My favorite:

> **Research-to-Reel**

It’s memorable and accurate for documentary-style AI filmmaking.

For the specific middle transformation:

> **Narrative Breakdown**

For the clip-generation part:

> **Clip Realization**

So the macro workflow could be:

```text
Research-to-Reel Workflow

1. Narrative Breakdown
2. Clip Realization
3. Timeline Assembly
```

That’s very clean.

---

# Recommended three-phase architecture

If you want the product to feel elegant, group the many stages into three big phases.

## Phase 1: Narrative Breakdown

Turns research into story structure.

```text
Research Dossier
→ Story Brief
→ Narrative Spine
→ Sequence Outline
→ Scene Plan
→ Beat Sheet
```

## Phase 2: Clip Realization

Turns story beats into producible AI video units.

```text
Beat Sheet
→ Clip Plan
→ Shot Design
→ Generation Spec
→ Takes / Variants
```

## Phase 3: Timeline Assembly

Turns approved clips into an edited film.

```text
Approved Takes
→ Scene Assembly
→ Timeline / Composition
→ Final Cut
```

This is probably the best product-level framing.

---

# Final recommended terminology

If I were designing the system, I’d use:

```text
Research Dossier
Story Brief
Narrative Spine
Sequence Outline
Scene Plan
Beat Sheet
Clip Plan
Shot Design
Generation Spec
Takes
Scene Assembly
Timeline
Final Cut
```

And I’d group them as:

```text
Narrative Breakdown
  Research Dossier
  Story Brief
  Narrative Spine
  Sequence Outline
  Scene Plan
  Beat Sheet

Clip Realization
  Clip Plan
  Shot Design
  Generation Spec
  Takes

Timeline Assembly
  Scene Assembly
  Timeline
  Final Cut
```

That gives you a clean conceptual model and a practical implementation model.
