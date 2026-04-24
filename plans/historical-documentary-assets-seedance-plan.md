# Historical Documentary Assets Seedance Plan

## Summary

This plan describes a new historical documentary asset pipeline that is:

- generic across historical topics
- specialized for Seedance 2.0 as the first execution family
- asset-only, with no timeline composer or video exporter
- designed so recurring historical characters and other references are actually used downstream

The key design decision is:

- the planning can stay general across topics
- the execution cannot stay general across advanced video model families

So the proposed system is:

- one shared historical documentary planning layer
- one Seedance-specific execution blueprint
- later, separate Kling and Veo execution variants built on the same planning idea

## Why the current blueprint is not enough

The current documentary asset blueprint proves that an asset-only documentary flow is possible, but it has one fundamental weakness:

- it creates portraits and character sheets
- then the video branch mostly ignores them
- the video branch uses one generic text-to-video path
- the planner emits one generic video prompt shape

That makes the reference assets decorative instead of functional.

This is not mainly a "prompt quality" problem. It is a topology problem.

## Top-level shape of the new solution

The first implementation should be a new catalog blueprint for Seedance 2.0 with this overall shape:

- one root blueprint
- one or two child blueprints for repeatable units
- several local producers inside the blueprint folder

The root blueprint should stay readable and should own:

- user inputs
- shared outputs
- loops
- high-level orchestration

The child blueprints should own repeatable multi-step units, especially motion clips.

The local producers should own model-specific prompt formatting and model-specific generation contracts.

## Recommended file shape

Example directory layout:

```text
catalog/blueprints/historical-documentary-assets-seedance/
  historical-documentary-assets-seedance.yaml
  input-template.yaml

  planning/
    documentary-plan-director/
      producer.yaml
      prompts.toml
      output-schema.json
    expert-casting-director/
      producer.yaml
      prompts.toml
      output-schema.json
    historical-character-director/
      producer.yaml
      prompts.toml
      output-schema.json

  motion/
    seedance-motion-clip.yaml
    seedance-prompt-adapter/
      producer.yaml
      prompts.toml
      output-schema.json
    seedance-text-clip/
      producer.yaml
    seedance-reference-clip/
      producer.yaml
    seedance-start-end-clip/
      producer.yaml
    seedance-multishot-clip/
      producer.yaml

  experts/
    expert-talking-head-unit.yaml

  stills/
    still-image-unit.yaml
```

The exact folder names can change, but the shape should stay shallow and explicit.

## Root blueprint responsibilities

The root blueprint should orchestrate:

- the topic-level documentary plan
- expert casting
- historical character design
- expert portraits and character sheets
- historical portraits and character sheets
- narration generation
- map generation
- still image generation
- motion clip generation
- expert talking head generation
- final published asset outputs
- the scene-by-scene markdown plan for the external compositor

The root blueprint should not try to contain every motion branch inline. That would quickly become hard to read and hard to maintain.

## Child blueprint responsibilities

The main child blueprint should be a unit that generates one motion clip.

Example:

- `SeedanceMotionClip[segment][motion]`

This child blueprint should accept inputs like:

- clip intent
- workflow type
- camera intent
- whether references are needed
- start image if needed
- end image if needed
- reference images if needed
- whether native clip audio is desired

Inside that child blueprint, the correct Seedance-specific local producer should be selected.

This keeps the root blueprint clean while still allowing rich behavior.

## Local producers vs catalog producers

This design should not force everything through the catalog producers when they are too generic.

Local producers are the right tool here.

For Seedance 2.0, the blueprint folder should likely define local producers such as:

- `seedance-text-clip`
- `seedance-reference-clip`
- `seedance-start-end-clip`
- `seedance-multishot-clip`
- `seedance-prompt-adapter`

These local producers make it possible to:

- expose only the inputs that fit that exact Seedance workflow
- write prompts in the right Seedance style
- make the blueprint readable
- avoid pretending the workflow is generic when it is not

Catalog producers can still be reused where they truly fit, but they should not be treated as a hard constraint.

## Planning model

The planning layer should stay topic-generic.

That means it should work for many historical topics, not just wars or biographies.

Examples:

- Napoleonic Wars
- Silk Road
- history of sanitation
- Bretton Woods
- Ottoman administration
- history of vaccines

To support that, the planner should decide which kinds of assets are needed, not just emit raw prompts.

The planner should be able to request asset intents such as:

- still image
- map
- motion clip
- expert talking head
- document or manuscript visual
- place-establishing visual
- process visual
- symbolic visual
- character-focused reenactment visual

For motion specifically, the planner should describe:

- what the clip is about
- whether character consistency is needed
- whether a start image is needed
- whether a start and end image are needed
- whether the clip should be multi-shot
- what the camera should do
- whether native audio is needed

This is more useful than one generic `VideoPrompt`.

## Historical references

The new blueprint should keep generating:

- historical portraits
- historical character sheets

But these assets must no longer be passive outputs.

They should be treated as a reusable reference bundle for each historical character.

Downstream still and motion generation should explicitly decide whether to use:

- portrait only
- portrait plus character sheet
- no references

That choice should come from the planner and the motion unit, not from vague prompting.

## Seedance 2.0 execution model

Seedance 2.0 should be treated as a workflow family, not one generic model.

The Seedance motion child blueprint should support at least these modes:

- text-driven clip
- image-anchored clip
- start/end-frame clip
- reference-driven clip
- multi-shot clip

The Seedance-specific prompt adapter should turn one semantic clip description into the correct prompt for the chosen mode.

The planner should not directly emit final Seedance prompts.

## Viewer and model selection implications

This blueprint should not be designed around the idea that the viewer can safely swap to any advanced video model just by changing a dropdown.

That assumption is the wrong abstraction for this problem.

Safe swaps are only realistic within a compatible execution family, for example:

- Seedance 2.0 to Seedance 2.0 Fast

Cross-family changes such as:

- Seedance to Kling
- Seedance to Veo

should eventually be handled by separate execution blueprints, not by pretending the topology stays valid.

## Outputs

The root blueprint should publish artifacts such as:

- `AssetPlan`
- `ExpertSet`
- `HistoricalCharacterSet`
- `ScenePlanMarkdown`
- `SegmentNarrationAudio`
- `SegmentStillImages`
- `SegmentMapImages`
- `SegmentMotionVideos`
- `SegmentMotionAudio`
- `ExpertCharacterSheets`
- `ExpertPortraits`
- `HistoricalCharacterSheets`
- `HistoricalPortraits`
- `SegmentExpertTalkingHeadAudio`
- `SegmentExpertTalkingHeadVideos`

The output names can change slightly, but there should be a clear separation between:

- narration audio
- motion clip audio
- expert talking head audio

This is important for the downstream external compositor.

## First implementation goal

The first implementation should deliver:

- one new catalog blueprint under `catalog/blueprints`
- a working Seedance-specific version
- dry-run validation through the normal CLI flow
- build creation in `~/videos` using `renku new:blueprint --using`

The first implementation does not need to solve Kling and Veo yet.

It only needs to establish the correct shape so those variants can be added later without redesigning the whole documentary planning layer.



# Prior discussions:
The shape I have in mind is:

  - one root blueprint for the Seedance 2.0 version
  - a small number of child blueprints for repeatable sub-jobs
  - several local producers inside the blueprint folder for Seedance-specific prompt building and asset generation

  So not “one giant root with everything inline,” and also not “a huge maze of nested blueprints.”

  I would keep it shallow and explicit.

  Top-Level Proposal

  For the first serious version, I would build:

  - one root blueprint called something like historical-documentary-assets-seedance.yaml
  - one child blueprint for “make one motion clip with Seedance”
  - optionally one child blueprint for “make one expert talking head”
  - local producers for:
      - topic planning
      - historical character design
      - expert casting
      - Seedance prompt formatting
      - Seedance-specific clip generation

  So the main idea is:

  - the root blueprint decides the overall documentary asset flow
  - the child blueprints handle repeatable units
  - the local producers handle model-specific details that the generic catalog producers are too blunt for

  Why I Would Use Local Producers

  I agree with your point completely.

  I would not try to force everything through the catalog producers if they do not match the real workflow.

  For Seedance 2.0 especially, I think local producers are the right move.

  For example, instead of forcing everything through generic things like:

  - video/text-to-video
  - video/ref-image-to-video
  - video/start-end-frame-to-video

  I would likely create local producers such as:

  - seedance-text-clip/producer.yaml
  - seedance-reference-clip/producer.yaml
  - seedance-start-end-clip/producer.yaml
  - seedance-multishot-clip/producer.yaml

  These would live inside the blueprint folder and expose only the inputs that make sense for that exact Seedance workflow.

  That gives us two big advantages:

  - the blueprint becomes easier to read
  - the prompt logic and wiring can match Seedance properly instead of pretending it is generic

  Concrete Shape

  This is the kind of file tree I mean:

  documentary-assets-seedance/
    historical-documentary-assets-seedance.yaml

    planning/
      documentary-plan-director/
        producer.yaml
        prompts.toml
        output-schema.json
      expert-casting-director/
        producer.yaml
        prompts.toml
        output-schema.json
      historical-character-director/
        producer.yaml
        prompts.toml
        output-schema.json

    motion/
      seedance-motion-clip.yaml
      seedance-prompt-adapter/
        producer.yaml
        prompts.toml
        output-schema.json
      seedance-text-clip/
        producer.yaml
      seedance-reference-clip/
        producer.yaml
      seedance-start-end-clip/
        producer.yaml
      seedance-multishot-clip/
        producer.yaml

    experts/
      expert-talking-head-unit.yaml

    stills/
      still-image-unit.yaml

  That is the rough shape.

  Not every folder must exist exactly like this, but this is the kind of organization I would aim for.

  What The Root Blueprint Would Do

  The root blueprint would own:

  - the user inputs
  - the overall outputs
  - the loops
  - the high-level orchestration

  It would do things like:

  - run the planning director
  - run the expert casting director
  - run the historical character director
  - generate historical portraits and character sheets
  - generate expert portraits and character sheets
  - generate narration
  - generate maps
  - generate still images
  - generate motion clips by calling the Seedance motion child blueprint
  - generate expert talking head clips
  - publish the final asset artifacts and scene-plan markdown

  So the root stays the “master wiring diagram.”

  What The Child Blueprint Would Do

  The most important child blueprint would be the Seedance motion clip unit.

  That child blueprint would be responsible for generating one motion clip.

  It would take inputs like:

  - what the clip is about
  - whether it should use references
  - whether it should use a start image
  - whether it should use a start and end image
  - whether it should be multi-shot
  - which historical character references are relevant
  - whether clip audio is wanted

  Then inside that child blueprint, it would choose the correct local Seedance producer.

  So instead of the root having one flat SegmentVideoProducer, it would call:

  - SeedanceMotionClip[segment][motion]

  and that child blueprint would internally decide which Seedance path to use.

  That keeps the root readable.

  How One Clip Would Work

  Here is one concrete example.

  Suppose the planner decides:

  - Segment 3 needs a motion clip
  - it is Napoleon on horseback before battle
  - it needs character consistency
  - it should use references
  - camera should be a low tracking shot
  - no native clip audio

  The flow would be:

  1. The root blueprint gets that clip request from the planning producer.
  2. The root passes the clip request plus Napoleon’s portrait and character sheet into SeedanceMotionClip.
  3. Inside SeedanceMotionClip, a local prompt adapter writes the prompt in the way Seedance likes.
  4. That same child blueprint routes the references into seedance-reference-clip.
  5. The resulting video comes back to the root as SegmentMotionVideos[3][0].

  That is much more concrete than the current design, where everything collapses into one generic VideoPrompt.

  Why This Is Still Topic-Generic

  This does not mean the blueprint becomes “Napoleonic Wars specific.”

  The topic-generic part lives in the planning.

  The planner should be able to handle many kinds of historical topics and ask for assets like:

  - character-focused historical scenes
  - place-focused scenes
  - maps
  - process visuals
  - symbolic visuals
  - document/manuscript visuals
  - expert commentary moments
  - motion clips when motion really helps

  So the planner stays broad.

  What changes is only the execution style for the motion assets.

  That is why I think the idea is still valid.

  What I Would Not Do

  I would not do these things:

  - I would not build one universal root blueprint that tries to serve Seedance, Kling, and Veo equally well.
  - I would not rely on a single generic SegmentVideoProducer.
  - I would not assume the viewer model dropdown can safely switch between advanced model families without changing topology.
  - I would not try to make the local reference assets “automatically useful.” They need to be explicitly wired into the still and motion branches.

  Simple Recommendation

  If I compress all of this into one sentence:

  - build one Seedance-specific root blueprint, with one motion child blueprint, and use local producers for the Seedance-specific generation paths instead of forcing
    everything through generic catalog producers.

  That is the clearest shape I see.

  If useful, the next step can be me writing this out as a much more concrete blueprint design with:

  - exact child blueprints
  - exact local producers
  - exact new outputs and loops
  - and an example of what the new plan schema should look like.

# Prior discussions

I think a topic-generic historical documentary blueprint is achievable.

  What I do not think is achievable is this:

  - one blueprint
  - one generic prompt shape
  - one generic video branch
  - one model dropdown
  - and it still produces equally good results across Seedance, Kling, Veo, and every historical topic

  That part is the flawed assumption.

  The important distinction

  There are really two different kinds of “generic” here:

  1. Generic across historical topics
  2. Generic across video model workflows

  I think:

  - generic across historical topics: yes, achievable
  - generic across model workflows: no, not really, at least not if you want high quality and control

  That is the cleanest answer.

  Why topic-generic is still possible

  A historical documentary about any topic can still follow a shared high-level structure.

  For example, regardless of topic, the blueprint can still decide things like:

  - what the segments are
  - what needs narration
  - where a map is useful
  - where an expert should speak
  - where a still image is enough
  - where motion is needed
  - whether recurring historical figures exist
  - whether a topic is more about people, places, systems, or processes

  That part can absolutely be generic.

  A blueprint can handle all of these:

  - Napoleonic Wars
  - Silk Road
  - fall of the Roman Republic
  - history of sanitation
  - industrialization
  - Cold War espionage
  - Atlantic slave trade
  - Ottoman administration
  - history of vaccines

  So the topic itself is not the blocker.

  Where the current design becomes too narrow

  The current blueprint quietly assumes a much narrower kind of history documentary than “any historical topic.”

  It is strongest for topics that have:

  - recurring named historical figures
  - cinematic reenactment-style visuals
  - map moments
  - optional expert commentary

  That works for some topics, but not all.

  For example:

  - Napoleonic Wars
      - fits well: leaders, battles, troop movement, maps, recurring characters
  - History of public sanitation
      - much less character-driven
      - likely needs diagrams, city scenes, infrastructure, process visuals, maybe documents
  - The Bretton Woods system
      - more institutional and abstract
      - may need charts, documents, buildings, symbolic scenes, fewer character-consistency shots
  - The Columbian Exchange
      - needs maps, ships, crops, trade flows, ecological/process visuals, some historical figures but not only that

  So the real weakness is not “it can’t do any historical topic.”
  The weakness is that the asset menu is too narrow and the video generation path is too generic.

  What I think is fundamentally flawed

  This is the part where I want to be direct.

  I think the current design is fundamentally flawed in one specific way:

  - it tries to make the same downstream generation strategy work for all advanced video models

  That is the part I do not believe in.

  I do not think the entire idea of a historical-documentary asset blueprint is flawed.

  I think this is the flawed assumption:

  - “we can make one general historical blueprint, and later just swap models in the UI”

  For simple models or simple shots, that can work.

  For controlled historical video generation, I think it breaks down.

  Because the models differ in:

  - how they use references
  - whether they want image-to-video, reference-to-video, or start/end frames
  - whether they support multi-shot well
  - how prompts should be structured
  - how native audio should be handled

  So the flaw is model-generic execution, not topic-generic planning.

  What I think is the sane version

  If you want one blueprint family that can tackle any historical topic, I think the sane version is:

  - one shared historical planning layer
  - one broad asset vocabulary
  - separate model-family-specific execution branches

  In plain English:

  - the planner decides what kind of assets the documentary needs
  - then the Seedance version generates them in a Seedance-friendly way
  - the Kling version generates them in a Kling-friendly way
  - the Veo version generates them in a Veo-friendly way

  That still gives you a system that can handle any historical topic.

  It just does not pretend all video models are interchangeable.

  What the planner would need to understand

  To really be generic across historical topics, the planner needs to be able to request more than just:

  - still image
  - map
  - video clip
  - expert talking head

  It should probably be able to request things like:

  - character-focused historical scene
  - non-character atmospheric scene
  - map
  - document or manuscript close-up
  - process or system explanation visual
  - location-establishing scene
  - symbolic or conceptual visual
  - expert commentary moment

  That is what makes it topic-generic.

  Then each model-family blueprint decides how to generate those requests well.

  Where Seedance 2.0 fits

  Seedance 2.0 actually makes the first version easier, not harder, because it supports more than one useful path in the same family:

  - text-to-video
  - image-to-video
  - start/end-frame
  - reference-driven video
  - multi-shot
  - native audio

  So if I had to build this system starting from one family, Seedance is a strong first choice.

  But even with Seedance, I would still not call the result “fully generic across models.”
  I would call it:

  - generic across historical topics
  - specialized for Seedance execution

  That is a healthy design.

  My honest bottom line

  - If your goal is: “one system that can handle any historical topic”
    I think that is realistic.
  - If your goal is: “one single blueprint that handles any historical topic and also lets me freely swap among advanced video models without redesigning the asset
    generation logic”
    I do not think that is realistic.

  So no, I do not think the whole idea is broken.

  I think the broken part is trying to generalize in the wrong place.

  The planning can be general.
  The execution probably cannot.

  If you want, I can now rewrite the implementation plan around exactly that principle:

  - one topic-generic historical planner
  - a broader set of asset types
  - a Seedance-specific execution blueprint as the first concrete version
  - and a path for later Kling/Veo versions without pretending they are just model swaps


  # Prior discussions
  The proposal was too abstract. Here is the same idea in plain language.

  Top-Level Idea

  I think we should stop trying to make one universal documentary blueprint that works well for every video model.

  Instead, we should build:

  - one documentary planning blueprint that decides what assets are needed
  - one Seedance 2.0 version of the asset generator that knows how to use Seedance properly
  - later, separate Kling and Veo versions that use the same plan but generate assets in their own way

  So the simplest summary is:

  - one shared plan
  - multiple model-specific execution blueprints

  That is the core recommendation.

  Why I’m Recommending That

  Your current blueprint has one big problem:

  - it creates useful reference assets like portraits and character sheets
  - but then the video branch ignores them and just sends a generic text prompt into video/text-to-video

  That means the blueprint is pretending all video models work roughly the same way.

  But they do not.

  With the more advanced models, the differences are not small. They change:

  - what inputs should be wired
  - whether references should be used
  - whether start and end frames should be used
  - whether multi-shot is supported well
  - how prompts should be written
  - whether sound should be part of the prompt
  - whether the model should be given one image, many images, or structured references

  So the current blueprint is too generic for the kind of documentary control you want.

  What I Would Build First

  I would build a new Seedance 2.0 documentary asset blueprint.

  This blueprint would still be asset-only. It would still output:

  - narration audio
  - still images
  - maps
  - expert talking heads
  - short video clips
  - scene-order markdown
  - reusable character/reference assets

  But the difference is:

  - the video clips would be generated in a Seedance-aware way
  - the plan would say what kind of clip is needed
  - the blueprint would choose the right Seedance path for that clip

  For example, a clip could be one of these:

  - a simple text-generated clip
  - a clip animated from one starting image
  - a clip that moves from a start image to an end image
  - a clip using reference images for character consistency
  - a multi-shot clip written in Seedance’s preferred style

  That is much closer to how Seedance actually works.

  What Stays Shared

  Even if we make a Seedance-specific blueprint, a lot of the documentary logic can still stay shared.

  The shared part is:

  - cast the experts
  - create the historical characters
  - create portraits and character sheets
  - write narration
  - decide which scenes need maps
  - decide which scenes need motion clips
  - produce the markdown scene order for the external compositor

  That part is not really Seedance-specific.

  So we are not duplicating the whole documentary system.
  We are mostly splitting:

  - the planning
    from
  - the model-specific asset generation

  What Changes in the Plan

  Right now the plan says something like:

  - this segment has a video clip
  - here is the video prompt

  That is too weak.

  Instead, the plan should say something like:

  - this segment needs 2 motion clips
  - clip 1 is Napoleon on horseback crossing smoke-filled battlefield
  - this clip needs historical character consistency
  - use Napoleon’s portrait as the main identity reference
  - use Napoleon’s character sheet as a secondary detail reference
  - camera intent is low tracking shot
  - no native clip audio
  - generate from references, not from plain text only

  That is a much better description because it tells the blueprint what kind of generation path to use, not just the final wording.

  Very Simple Terminology

  Here are the terms in normal language.

  - Shared plan
      - the part that decides what assets the documentary needs
  - Seedance-specific blueprint
      - the version of the blueprint that knows how to use Seedance 2.0 properly
  - Execution path
      - the actual generation method
      - for example: text-to-video, image-to-video, start/end-frame, reference-based clip
  - Reference bundle
      - the reusable assets for one character
      - for example: portrait + character sheet
  - Model-specific prompt builder
      - a small piece that turns a scene description into the kind of prompt Seedance wants
      - later Kling and Veo would have their own versions

  What This Means for the Viewer UI

  It means the viewer should not pretend all advanced video models are interchangeable.

  I think model swapping is safe only inside a compatible group.

  For example:

  - swapping Seedance 2.0 to Seedance 2.0 Fast is reasonable
  - swapping a Seedance blueprint to Kling just by changing the model dropdown is not really valid
  - Kling may need different prompt structure and different inputs
  - Veo may need start/end or ingredient-style references
  - Seedance may want different reference usage and multi-shot structure

  So I would design this as:

  - choose the blueprint family first
  - then allow model swaps only inside that family

  My Actual Recommendation

  If I strip everything down, my recommendation is:

  1. Keep the documentary asset pipeline idea.
  2. Stop treating the video branch as generic.
  3. Build a new Seedance 2.0 documentary asset blueprint first.
  4. Make that blueprint actually use the historical reference assets.
  5. Later, create Kling and Veo versions built on the same high-level documentary planning idea.

  One Concrete Example

  If the documentary is about the Napoleonic Wars, and one scene needs a short motion clip of Napoleon before battle, the new Seedance blueprint should do this:

  - use the Napoleon portrait and character sheet that were already generated
  - decide whether this should be:
      - reference-based video
      - image-to-video
      - or start/end-frame animation
  - write the prompt in Seedance style
  - feed those references into the correct Seedance-capable producer
  - output that clip as an artifact for the external compositor

  The current blueprint does not do that.
  It just writes a generic video prompt and hopes the model figures it out.

  That is the main flaw.

  If this explanation is much closer to what you want, I can rewrite the full implementation plan in this same plain style, with:

  - first the simple architecture
  - then the exact blueprint pieces
  - then the exact schema changes
  - then the testing plan.