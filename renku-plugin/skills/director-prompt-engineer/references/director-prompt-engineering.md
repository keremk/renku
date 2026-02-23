# Director Prompt Engineering Guide

The director prompt producer is the highest-leverage file in any Renku blueprint. It is the "meta-prompt" that generates ALL downstream image, video, audio, and narration prompts. Investing time in the director has cascading quality effects on every generated asset. A mediocre director prompt will produce mediocre visuals, narration, and pacing regardless of how good the downstream models are.

This guide covers seven critical areas that existing catalog directors frequently lack or handle inconsistently. Apply these patterns when writing new director TOML files.

---

## A. Narrative Arc Structure

Every director prompt should instruct the LLM to follow a narrative arc, even for non-narrative content. This prevents the most common failure mode: generating N segments that feel disconnected or monotonously paced, as if each segment were written in isolation.

### Standard Arc Template

```
Segment 1 (Hook): Open with the most compelling visual or statement. Grab attention immediately.
Segments 2-3 (Context): Establish the setting, introduce the subject, provide necessary background.
Segments 4-(N-2) (Development): Build the story. Introduce complexity, tension, or new information.
Segment N-1 (Climax): The most dramatic, revealing, or emotionally resonant moment.
Segment N (Resolution): Conclude with reflection, significance, or call-to-action.
```

### Adapting the Arc by Use Case

- **Documentary**: Hook with a surprising fact or striking image. Follow with chronological development. Conclude with legacy, impact, or an open question.
- **Ads**: Product tease or problem statement. Agitate the problem. Demonstrate the solution. Show social proof. End with a clear call-to-action.
- **Educational**: Open with an attention-grabbing question or counterintuitive fact. Introduce the concept. Walk through examples with increasing complexity. Close with a quiz, recap, or "what's next" prompt.
- **Music video / storyboard**: Establish the mood and visual world. Build intensity through escalating visuals and motion. Hit the peak at the emotional climax of the track. Wind down with a denouement or callback to the opening.

### Implementation in System Prompt

Add this block to the director's system prompt in the TOML file:

```
## Narrative Arc
Structure your {{NumOfSegments}} segments following this arc:
- Segment 1: Hook — open with the most visually striking or surprising element
- Segments 2-3: Context — establish the setting and subject
- Middle segments: Development — build complexity, add layers
- Second-to-last segment: Climax — the most dramatic or revealing moment
- Final segment: Resolution — conclude with impact, reflection, or call-to-action

Do NOT create segments that are interchangeable in order. Each segment should feel like it belongs in its specific position.
```

### Why This Matters

Without arc guidance, LLMs tend to produce segments of uniform intensity and tone. The result feels like a slideshow rather than a story. Even a 30-second ad benefits from a mini-arc: tension, release, payoff.

---

## B. Cross-Segment Visual Consistency

The most common quality failure in generated videos is visual incoherence between segments. Characters change appearance, lighting shifts randomly, color palettes clash, and the style drifts. The director must enforce consistency rules explicitly because image and video models have no memory across API calls.

### Rules to Include in System Prompts

1. **Color Palette Locking**: "Establish a consistent color palette in segment 1. Use the SAME palette keywords in ALL subsequent image and video prompts."

2. **Lighting Direction Consistency**: "Choose a lighting direction (e.g., 'golden hour side-lighting from the left') and repeat it in every visual prompt. Do NOT vary lighting between segments unless narratively motivated (e.g., day-to-night transition)."

3. **Character Anchor Descriptions**: "When a character appears across segments, use an identical 15-20 word anchor phrase describing their appearance in every prompt they appear in. Example: 'middle-aged woman with silver-streaked dark hair, wearing a navy blazer and wire-rimmed glasses'"

4. **Environment Continuity**: "When segments share a location, repeat the same 10-word environment description. Example: 'sun-dappled oak forest with moss-covered stone path and distant mountains'"

5. **Style Keyword Repetition**: "Include the user-provided style keyword (e.g., '{{Style}}') in EVERY image and video prompt without exception."

6. **No Embedded Text**: "Never add text, labels, titles, or watermarks to image or video prompts. Text overlays are handled by separate producers."

### Template Block

Add this to the director system prompt:

```
## Visual Consistency Rules
Maintain visual coherence across all segments:
1. Establish your color palette in the first segment. Repeat the SAME color keywords (e.g., "warm amber tones", "desaturated blues") in every image and video prompt.
2. Lock the lighting direction. State it once (e.g., "dramatic side-lighting from the left") and include it in every visual prompt.
3. For recurring characters, write a 15-20 word appearance anchor and paste it verbatim into every prompt featuring that character.
4. For recurring locations, write a 10-word environment anchor and paste it verbatim.
5. Always include the style "{{Style}}" in every image and video prompt.
6. Never add text, labels, titles, or watermarks to image or video prompts — text overlays are handled separately.
```

### Common Pitfalls

- **Vague style references**: "cinematic look" is too vague. Push for specific anchors: "cinematic anamorphic look, shallow depth of field, warm tungsten highlights, cool shadow fill."
- **Forgetting negative constraints**: Without "no text, no labels, no watermarks," image models frequently burn text into the image, which is impossible to remove in post.
- **Describing mood instead of visuals**: "a feeling of melancholy" gives the model nothing to render. "Overcast sky, muted blue-gray tones, a single figure on an empty bench" does.

---

## C. Model-Specific Prompting Best Practices

Different AI models respond to different prompt structures. The director prompt should guide the LLM to generate prompts optimized for the target model category. Prompt ordering, specificity, and structure all affect output quality.

### Video Prompt Structure (Order Matters)

Video models respond best to prompts structured in this order:

1. **Context/Setting** -- Where and when (e.g., "1920s jazz club interior at night")
2. **Action/Motion** -- What happens (e.g., "a dancer spins across the polished floor, her dress fanning outward")
3. **Camera Movement** -- How we see it (e.g., "slow dolly forward, tracking the movement at waist height")
4. **Mood/Atmosphere** -- Emotional tone (e.g., "smoky, intimate, warm amber lighting with sharp spotlight pools")

Placing camera movement after action is important: it anchors the model's "virtual camera" to the described motion rather than producing random drift.

### [cut] Scene Syntax

For video producers that support multi-scene segments (e.g., Kling, Wan), use [cut] markers to separate scenes within a single segment:

```
Camera transition description between scenes
First scene: action and camera movement description
[cut] Second scene: new angle, action, camera movement
[cut] Third scene: climax action, dramatic camera
```

Rules for [cut] usage:
- The transition description goes BEFORE the first scene
- Each [cut] starts a new scene of approximately 4-5 seconds
- Vary camera movements between cuts (dolly, then pan, then close-up) for visual rhythm
- The first scene inherits from the input start image -- describe the motion, not the static image
- Number of [cut] markers = CutScenesPerSegment - 1 (the initial image defines the first scene)
- Do not exceed 3-4 cuts per segment. More cuts produce jarring, disorienting results.

### Image Prompt Structure

Image models respond best to prompts structured as:

1. **Shot type** -- "Wide establishing shot", "Medium close-up", "Bird's eye view", "Low angle"
2. **Subject** -- What is in the image, described concretely with physical details
3. **Composition** -- Layout, framing, rule of thirds placement, depth layers
4. **Lighting** -- Direction, quality, color temperature, shadow character
5. **Style** -- The user-provided style keyword applied consistently
6. **Negative constraints** -- "No text, no labels, no watermarks, no UI elements, no borders"

### Camera Movement Instructions

Always instruct the director to specify camera movements for video prompts. Without explicit camera direction, video models produce static frames or random, unmotivated motion.

Common camera movements and when to use them:
- **Dolly** (forward/backward): Approaching or retreating from subjects. Creates intimacy or distance.
- **Pan** (horizontal rotation): Revealing wide scenes, following horizontal action. Establishes geography.
- **Tilt** (vertical rotation): Revealing tall subjects, looking up at grandeur or down at detail.
- **Crane** (vertical movement): Establishing shots rising over landscapes, dramatic reveals.
- **Tracking** (following a subject laterally): Action sequences, following a character's movement.
- **Orbit** (circular movement around subject): Dramatic reveals, hero shots, showing all sides.
- **Zoom** (focal length change): Use sparingly. Most AI video models handle zoom poorly, producing warping artifacts. Prefer dolly instead.
- **Static** (locked camera): Use intentionally for contemplative moments or to contrast with preceding movement.

### Template Block for Video Prompts

```
## Video Prompt Guidelines
Structure every video prompt in this order:
1. Setting and context (where and when)
2. Action and motion (what happens — be specific about movement direction and speed)
3. Camera movement (how we see it — always specify a camera movement)
4. Mood and atmosphere (lighting, color, emotional tone)

Always specify a camera movement. "The camera slowly dollies forward" is better than no camera direction. Vary camera movements across segments for visual rhythm.
```

---

## D. TTS-Friendly Narration Writing

Text-to-speech engines produce dramatically better results when the input text follows specific conventions. Most LLMs, when generating narration, produce text optimized for reading rather than speaking. The director must explicitly instruct the LLM to write for the ear, not the eye.

### Pacing and Punctuation

- Use em-dashes (--) for dramatic pauses: "The city was empty -- completely abandoned."
- Use ellipses (...) for trailing off or building suspense: "And then, just beyond the ridge..."
- Use commas to create natural breathing points. A 20-word sentence without commas will sound rushed.
- Short sentences create urgency and impact. Longer sentences create a flowing, contemplative feel. Alternate between them.
- Avoid parenthetical asides -- TTS engines read them in the same breath and they sound unnatural.
- Avoid semicolons. Split into two sentences instead.

### Pronunciation Guidance

- Spell out all numbers: "nineteen forty-five" not "1945"
- Spell out abbreviations: "United States" not "US" or "U.S."
- Spell out units: "three hundred kilometers" not "300 km"
- Use phonetic hints for uncommon proper nouns only in comments, never in the spoken text itself
- Avoid acronyms unless they are universally spoken as words (NASA, UNESCO). Spell out all others.
- For dates, use natural speech: "March fifteenth, twenty twenty-four" not "3/15/2024"

### Sentence Rhythm

- Vary sentence length to prevent monotony. Follow a short-medium-long-short pattern.
- Start some sentences with dependent clauses for variety: "As the sun set over the ridge, the last soldiers retreated."
- Do not start multiple consecutive sentences with the same word. Three sentences starting with "The" in a row sounds robotic.
- Avoid passive voice when possible. "Scientists discovered the fossil" sounds more natural than "The fossil was discovered by scientists."

### Emotion Matching

Match narration energy to the visual content of the segment:
- **Action segments**: Shorter, punchy sentences. Active verbs. Present tense can add immediacy.
- **Reflective segments**: Longer, flowing sentences. Past tense. More descriptive language.
- **Dramatic reveals**: A sentence fragment for impact, followed by a full explanation. "Gone. The entire village -- gone in a single night."
- **Transitions**: Use bridging phrases that connect the previous segment's idea to the next. "But that was only the beginning."

### Multilingual Narration

When the blueprint supports multiple languages via a Language variable:
- Instruct the LLM to write narration in the specified language: "Write all narration text in {{Language}}."
- Remind the LLM that word count limits still apply. Different languages have different word densities (German tends to be wordier than English; Chinese is more compact by character but similar by concept).
- Numbers and proper nouns should follow the conventions of the target language.

### Template Block

```
## Narration Writing Rules
Write narration that will be read by a text-to-speech engine:
1. Write ONLY spoken words. No stage directions, no [pause], no (whispered), no action notes.
2. Spell out all numbers: "nineteen forty-five" not "1945".
3. Spell out abbreviations: "United States" not "US".
4. Use em-dashes (—) for dramatic pauses.
5. Vary sentence length: alternate short punchy sentences with longer flowing ones.
6. Match energy to content: action segments get short sentences; reflective segments get longer ones.
7. Do NOT start consecutive sentences with the same word.
8. Avoid parenthetical asides and semicolons.
```

---

## E. Timing and Pacing Enforcement

The single most common failure in generated videos is narration that far exceeds the segment duration. A 10-second segment with 40 words of narration will either be cut off or require unnatural speech speed. Directors must enforce HARD timing limits with concrete calibration.

### Word Count Formula

**Target: 2 words per second** (this leaves breathing room for natural TTS cadence, pauses at punctuation, and segment transitions)

| SegmentDuration | Max Words per Segment |
|-----------------|-----------------------|
| 5 seconds       | 10 words              |
| 6 seconds       | 12 words              |
| 8 seconds       | 16 words              |
| 10 seconds      | 20 words              |
| 12 seconds      | 24 words              |
| 15 seconds      | 30 words              |
| 20 seconds      | 40 words              |

Note: 2 words/second is a conservative target. Natural English speech averages 2.5-3 words/second, but TTS engines add micro-pauses at punctuation, and the narration needs to feel unhurried. Err on the side of fewer words.

### Calibration Examples

Include concrete examples in the system prompt. LLMs calibrate far better from examples than from rules alone.

```
## Timing Enforcement
Each segment's narration must fit within {{SegmentDuration}} seconds of spoken delivery.
Target: 2 words per second maximum.

Examples of correctly timed narration (10-second segment, max 20 words):
GOOD: "The ancient fortress stood silent for centuries. Then, in eighteen fifty-three, everything changed." (14 words)
GOOD: "Beneath the ice, something stirred. Scientists would later call it the discovery of the century." (15 words)
BAD: "The magnificent ancient fortress, which had been standing silently atop the windswept mountain for over five hundred years, suddenly became the center of world attention when archaeologists arrived in eighteen fifty-three." (31 words — FAR too long)

Count your words for EVERY narration segment. If a segment exceeds the limit, rewrite it shorter before moving on.
```

### Handling Variable Duration

When SegmentDuration is a template variable rather than a fixed number:

```
The narration for each segment must not exceed {{SegmentDuration}} x 2 words.
For example, if SegmentDuration is 10, each narration must be 20 words maximum.
Count the words in every narration you write and rewrite if over the limit.
```

### Silent Segments

Some segments may intentionally have no narration (e.g., a dramatic visual-only moment, or a musical interlude). The director should instruct:

```
If a segment is better served by silence (e.g., a dramatic visual reveal or a musical moment), set the narration to an empty string "". Do not force narration into every segment.
```

### Music Prompt Timing

When the blueprint includes MusicPrompt generation, remind the director that music prompts describe mood and genre, not lyrics. Music prompts do not have word count limits but should be concise (1-2 sentences describing tempo, genre, instruments, and mood).

---

## F. Conditional Schema Field Handling

Many blueprints have output schemas where certain fields are only relevant for specific segment types. For example, TalkingHeadText is only meaningful for TalkingHead segments, and ImagePrompt is irrelevant for a pure video segment. Without explicit guidance, LLMs handle these fields poorly.

### The Problem

When a JSON schema marks a field as `required`, the LLM must provide a value even when it is semantically irrelevant to the current segment type. Without guidance, LLMs will:
- Generate meaningless placeholder text ("N/A", "Not applicable", "None")
- Generate content for the wrong segment type (writing a talking head script for an ImageNarration segment)
- Fill in random descriptive text that downstream producers will attempt to render, producing garbage output

All of these are harmful because downstream producers receive and act on these values. "N/A" sent to an image generation model will produce an image of the letters "N/A".

### The Solution

Add explicit empty-field rules to the system prompt:

```
## Conditional Fields
Some output fields are only meaningful for certain segment types:
- If NarrationType is "ImageNarration": set TalkingHeadText to "" and TalkingHeadPrompt to ""
- If NarrationType is "TalkingHead": set ImagePrompts to empty arrays or minimal placeholders
- If NarrationType is "VideoNarration": set TalkingHeadText to "" and TalkingHeadPrompt to ""

For any field that is NOT applicable to the current segment type, use an empty string "".
Do NOT write "N/A", "Not applicable", or descriptive placeholder text — these will be sent to downstream AI models and produce garbage output.
```

### Schema Design Tip

When designing the output JSON schema for a director, mark type-dependent fields with descriptions that state their conditionality:

```json
{
  "TalkingHeadText": {
    "type": "string",
    "description": "Text for the talking head to speak. Use empty string if NarrationType is not TalkingHead."
  },
  "MapPrompt": {
    "type": "string",
    "description": "Prompt for generating a map visual. Use empty string if NarrationType is not MapNarration."
  }
}
```

This gives the LLM two sources of guidance: the system prompt rules AND the schema descriptions. Redundancy here is intentional and reduces errors.

### Boolean and Enum Conditional Fields

For fields like HasTransition (boolean) that control downstream behavior:

```
## Transition Rules
- Set HasTransition to true ONLY when two consecutive segments share the same location or subject and benefit from a smooth visual transition.
- Set HasTransition to false when the scene changes dramatically (e.g., different time period, different location, different subject).
- When HasTransition is false, TransitionPrompt should be an empty string "".
```

---

## G. Two-Pass Research/Generation Pattern

For research-heavy use cases (historical documentaries, educational content, biographical profiles), splitting the director into two producers dramatically improves quality. A **Researcher** gathers and organizes facts. A **Director** crafts prompts from those verified facts. This separation prevents the common failure of an LLM hallucinating historical details while simultaneously trying to write creative prompts.

### When to Use Two-Pass

Use the two-pass pattern when:
- The topic requires factual accuracy (history, science, geography, biography)
- The content benefits from source diversity (multiple perspectives, dates, figures)
- A single mega-prompt would exceed the LLM's ability to both research and craft prompts simultaneously
- The blueprint covers a topic the user provides at runtime (the LLM cannot pre-encode all possible topics)

Do NOT use two-pass when:
- The content is purely creative/fictional (no facts to verify)
- The blueprint is short (3-4 segments) and simple
- The topic is fully specified by the user's input prompts (no research needed)

### Blueprint Wiring

```yaml
producers:
  - name: Researcher
    path: ./researcher/producer.yaml
  - name: Director
    path: ./director/producer.yaml
    loop: segment

connections:
  # User inquiry goes to researcher
  - from: InquiryPrompt
    to: Researcher.InquiryPrompt

  # Researcher outputs go to director
  - from: Researcher[segment].ResearchNotes
    to: Director[segment].ResearchContext
  - from: Researcher.NarrativeOutline
    to: Director[segment].NarrativeOutline

  # Director outputs go to asset producers
  - from: Director[segment].ImagePrompt
    to: ImageProducer[segment].Prompt
  - from: Director[segment].Narration
    to: TTSProducer[segment].Text
```

### Researcher Prompt Design

The researcher's system prompt should:

1. **Focus on gathering facts**: Key dates, figures, quotes, locations, physical descriptions
2. **Organize by segment**: Output a structured set of research notes, one per segment, following the narrative arc
3. **Output structured notes, NOT prompts**: The researcher should never write image or video prompts. Its output is raw material for the director.
4. **Include source quality guidance**: "Prioritize well-documented events over disputed claims. When a date or figure is uncertain, note the uncertainty."
5. **Provide physical descriptions**: "For every person, place, or object mentioned, include a physical description suitable for image generation: approximate age, clothing, setting, time of day."

Example researcher output structure:
```
Segment 1 Research Notes:
- Key fact: The Berlin Wall fell on November 9, 1989
- Setting: Brandenburg Gate, Berlin, night, large crowds, cold weather
- Key figure: An East German border guard, approximately 30 years old, in olive-green uniform
- Emotional tone: Euphoric, chaotic, disbelief
- Quote source: "This is the happiest day of my life" — anonymous citizen, documented by Reuters
```

### Director Prompt Design

The director's system prompt receives research context and focuses solely on creative execution:

1. Crafting visual prompts from the verified facts (not hallucinating new ones)
2. Writing narration scripts that accurately reflect the research
3. Enforcing visual consistency, timing, and arc structure
4. Applying the user-provided style and format preferences

The director prompt should include:
```
## Research Context
You will receive research notes for each segment. Base ALL factual claims, physical descriptions, and historical details on these notes. Do NOT invent facts, dates, or descriptions not present in the research.
```

This separation produces higher-quality outputs because each LLM call has a focused task. The researcher can dedicate its full context to gathering accurate information. The director can dedicate its full context to creative prompt engineering.

---

## Checklist for Director Prompt Review

Before finalizing any director prompt producer, verify every item on this checklist:

- [ ] **Narrative arc** -- Does the system prompt instruct segment ordering (hook, development, climax, resolution)?
- [ ] **Visual consistency** -- Are there explicit rules for color palette locking, lighting direction, character anchors, environment anchors, and style repetition?
- [ ] **Camera movement** -- Does every video prompt section require a specific camera direction? Is there guidance on varying camera movements across segments?
- [ ] **TTS-friendly narration** -- Are there rules for spelling out numbers, spelling out abbreviations, sentence rhythm variation, and avoiding parenthetical asides?
- [ ] **Timing enforcement** -- Is there a hard word-per-second limit (2 words/sec)? Are there calibration examples showing correct and incorrect narration lengths?
- [ ] **Conditional fields** -- Are empty-string rules specified for type-dependent fields? Does the prompt say "no N/A, no placeholder text"?
- [ ] **Negative constraints** -- Do image and video prompt rules explicitly state "no text, labels, titles, or watermarks"?
- [ ] **Style inclusion** -- Is {{Style}} (or equivalent variable) required in every visual prompt?
- [ ] **Concrete examples** -- Does the system prompt include at least one example prompt per media type (image, video, narration)?
- [ ] **Variable binding** -- Do all {{Variable}} references in the TOML match the variables array and the YAML input template?
- [ ] **Language support** -- If the blueprint supports multilingual narration, does the prompt instruct writing in {{Language}}?
- [ ] **Music prompts** -- If the blueprint generates music, does the prompt describe music prompt format (mood, genre, tempo) separately from narration?
- [ ] **Silent segments** -- Is there guidance for when to leave narration empty?
- [ ] **Cut scene rules** -- If video producers use [cut] syntax, are the rules for number of cuts and camera variation specified?
