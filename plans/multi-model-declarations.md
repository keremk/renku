# Changes to Blueprints 
I am proposing new changes to the format of the blueprints. 

## Challenges & Goals:
- Currently we have some of the critical inputs declared in the blueprint YAML files. This means that when we change these inputs we can not do an incremental edit flow. E.g. changing models require changing the blueprint YAML file. Likewise changing any of the model configuration also requires changing the blueprint file.
- The producer inputs, artifacts and models are defined in a "generator" file. This creates confusion of naming and also these definitions should actually be part of the producer definitions.
- The naming is confusing. We need better and clear guidelines.
- We don't have any formal declaration of the input schemas accepted by Media and LLM model providers. Therefore there is no discoverability of what can be changed other than reading some docs, nor there is any validation of what are acceptable values. This may cause unnecessary calling the model provider APIs and then getting error back. We should detect and validate them earlier. 

## New Producer YAML files
- We are removing the adhoc blueprint YAML files (e.g. `audio-generator.yaml`) and introducing a better defined producer YAML files. (`catalog/blueprints/modules/producers/audio.yaml`)
- In the current implementation, there is a lot of boilerplate that can be avoided and therefore we are removing them:
    - `connections` are not need for the producer configuration as they can easily be inferred. (i.e. connect all inputs to the producer and connect producer to all artifacts --- outputs)
    - `producers` is unnecessary as the full file is about describing one producer. `name` and `id` of the producer is declared in one place in the `meta` section.
- Currently only one model is connected to the producer. In this proposal `models` is an array of provider/model definitions. User is in charge of declaring which model to use for a given run in the `inputs.yaml` file.
- `jsonSchema` was an ambigous term. I.e. is it for input or output? So we changed the names to `inputSchema` and `outputSchema`
- `sdkMapping` was not a good term. We instead name it to `inputs` and make it a 1:1 mapping between the inputs declared in the YAML and the corresponding field name that the producer code will need when crafting the request for the external model/provider SDK.
    - `inputSchema` points to a JSON schema (obtained from the model/provider SDK) so inputs can be validated before calling the API. Also in dry-run this can be validated, so users can be sure that things are configured properly. See the Input Mapping section below on how that should work.
- `outputs`: Each model can define their outputs here. This is unchanged from the previous one, but only now is declared per model.

### Input JSON Schema Files
- We are creating inputSchema file that are JSON schemas. Each producer refers to it.
- These files define the schema model/provider accepts and are used for validating the inputs and also providing guidance on what values are available and valid for tools like agents.
- These are located under `catalog/blueprints/modules/schemas` together with the output schemas that were already in place.

### Prompt TOML Files
- Prompt TOML files are now only containing user and system prompts and the variables that can be inserted in those prompts. 
- The variables array maps directly to the `inputs` declared in the producer files. There is no change in locating and substituting values.
- The prior LLM configuration properties now moved to the producer YAML files and also added to the inputSchema JSON Schema files. See `catalog/blueprints/modules/schemas/openai-input.json` which defines what OpenAI API accepts as configuration.
> We access OpenAI API through Vercel AI SDK's OpenAI provider. We have not yet checked these are what the Vercel AI SDK also uses, which is crucial. If not we need to migrate to that.

### LLM Producers
- For now we are only using the OpenAI provider through the Vercel AI SDK.
- Like the media generating producer files, we also support multiple models for the LLM producers.
- We moved `text_format` from the TOML file into the producer YAML. (See `catalog/blueprints/modules/prompts/script.toml` as an example) It is also reflected in the JSON schema file. 
  - This is one example of a config property that is mentioned in the producer YAML as it is not something the user controls through input properties and is critical to the functioning of the overall workflow.  

### Input Mapping
Before calling the provider/model APIs in the producer implementation, we need to collect all the inputs and ensure they are mapped to what the SDK is expecting (as enforced by the inputSchema)

Inputs come from 2 sources:
- *Input Nodes*: Declared as part of the Producer YAML in the `inputs` section. These are generally intended to be connected to other nodes in the graph, therefore they are declared as nodes.
    - These are explicitly mapped to the API expected SDK names in the `models`->`inputs` section in the YAML file
- *Config Properties*: Non-node configuration parameters expected by the model/provider SDK. 

The input JSON schema of the producer defines the complete list of acceptable inputs for the model/provider API call. This is a superset of all the inputs.
    - So it is combination of *Input Nodes* + *Config Properties*
    - At any time, producer YAML file may decide to declare one of these *config properties* as an *input node*, if there is a need to connect it to other nodes.  
    - In the `inputs.yaml` the *config properties* can be referred using their SDK names directly.
    - If they apply to all producer instances and don't need to be configured per run, they can also declared in `config` section under the `models` definition again using their SDK names.
    - The JSON schema defines default values, so if no user or producer provided value is present, then the default value is used.

When producers are called, they should be provided with JSON input schema for validation. Producers will also be needing a consolidated internal JSON representation for the instances. Then they can validate the instance with the schema. To create the instance JSON:
- *Input Nodes*: names are mapped from their canonical Input ID names using the mapping provided producer YAML. (`models`->`inputs` section). Their values are located using the Canonical ID look up from the manifest in the `builds` folder. If it is coming from an artifact, the resolved value (extracted from the corresponding BLOB)is the value to be used. If it is a direct user input, similar lookup happens again from the data in the `builds` folder.
    - So discover what SDK API call expects using the mapping.
    - Find the value by the Canonical ID lookup from manifests.
- *Config Properties*: for these there is no mapping needed. The values will be available in the SDK expected naming. But we need to ensure that they participated in the overall iterative edit flow. I.e. if a user changes a config value for a model, the nodes and their downstream dependencies need to rerun (the planner needs to plan them for running). Currently this does not happen. So we need to automap to inputs with canonical input ids --- same name as their sdk name: (e.g. for a video model, camera_fixed property is represented as Input:camera_fixed and represented in the manifest as such)
  - If an config property is mentioned in the inputs.yaml or in the producer yaml, then it should be treated as an input with canonical IDs in the manifest and the dirty calculation etc. should be taken into account in the planner to plan for the new run when changes happen.

All of the above creates an internal JSON representation and gets validated against acceptable input types and values.

### User inputs - `inputs.yaml`
The users provide `inputs.yaml` file as before. An example of this file is here: `catalog/blueprints/cut-scene-video/input-template.yaml`
- Here all the inputs that are necessary to run the workflow are provided, except for the InquiryPrompt. As before this is provided through the CLI. See below (unchanged) 
```bash
tutopanda query "My inquiry prompt" --inputs=catalog/blueprints/cut-scene-video/input-template.yaml --usingBlueprint=catalog/blueprints/video-audio-music.yaml --concurrency=2
```
- The format of the inputs file has changed though. Now it includes, models to be used, their config properties. 
- We also renamed and consolidated prior input node names `ImageStyle`, `MovieStyle`, `VideoStyle` to just `Style`
  - Changed the test files etc. as well, so there should be no mention of the prior names (other than in the client project but that is a deprecated and unmaintained project at the moment) 

- **IMPORTANT** Currently we are hardcoding and validating the inputs.yaml file in code. That should be removed. The input file contents depends on the user definable blueprints and producers.

### Timeline Composer
- We have changed the format of the configuration to match the other YAML files for models/providers.
- It can accept multiple models like others, but currently there is only one `OrderedTimeline`. This is the same one as before. There should be no changes to how it composes the timeline. The only thing changing is how we input the values and configure it.
- We created a JSON schema for this as well `catalog/blueprints/modules/schemas/timeline-input.json`
- The input mapping is as follows:
  - We are using a "." syntax to reach into a property of an object type. (e.g. imageClip.artifact) We did not have this supported before as the JSON schemas were all flat, this is the first schema that is not flat. So our parser should support this.
  - This is another example we are embedding configuration properties directly inside the YAML.
```yaml
models:
  - model: OrderedTimeline
    provider: Tutopanda
    inputSchema: ../schemas/timeline-input.json
    config:
      imageClip:
        artifact: ImageSegments[Image]
      videoClip:
        artifact: VideoSegments
      audioClip:
        artifact: AudioSegments
      musicClip:
        artifact: MusicSegments
```
  - We moved out other config properties to the inputs.yaml file to again allow incremental editing flow where changing one of these invalidates the Timeline composition and that is the only thing runs again in `tutopanda edit` 
```yaml
 - model: OrderedTimeline
    provider: tutopanda
    producerId: TimelineComposer
    config:
      masterTrack: Audio
      musicClip:
        volume: 0.4
      tracks: ["Image", "Audio", "Music"]
```
  - The configuration schema has changed as well. `tracks` property has an ordered list of the tracks with clip kinds. And for each clip kind we created a new object: `musicClip`, `imageClip`, `videoClip`, `audioClip`
- We noticed that the rootFolder was specified here is a configuration in the YAML file before. That should not have been necessary and I thought the code was already passing this automatically based on the `cli-config.json` file. Please double check if it is not passed on.  

### VideoExporter
- Again we adopted this to be consistent with other producer YAML files. 
- We noticed that the rootFolder was specified here is a configuration in the YAML file before. That should not have been necessary and I thought the code was already passing this automatically based on the `cli-config.json` file. Please double check if it is not passed on.
- No other changes.

# Implementation Guidelines
- This change is mostly about the blueprint formats (YAML, JSON Schemas, TOML prompts). We should try and contain the change mostly in the parsing code. 
  - **IMPORTANT** This does not mean we should hack things. The code architecture is very important and no shortcuts should be taken and if needed changes can be made elsewhere.
- The config properties should be first class input values (like others) and changing them should alter the plan, marking it dirty and ensuring only the producer and its downstream dependencies run.
- We removed the verbose connections declarations in the producer yaml files. This is going to create a different shape for the blueprint yaml files. We still want to have the option to have modules as before. So implement this as a new type of blueprint definition specifically for the producers. 
  - **IMPORTANT** This should not change the internal representation of the graph though, it is more of syntactic sugar and simplification on the YAML format.
> Ensure that the connections can be inferred as I was proposing. 
- When implementing do not break the canonical Input and Artifact IDs and how we always locate using the one and only canonical ID and never use aliases, some "clever" looking inferences or fallbacks.
- There is no backwards compat requirement. Do not introduce unnecessary code (fallbacks etc.) for backwards compatibility. Do not leave dead code after the refactor. I do not need any intermediate running versions, keep the code clean. This is already in a separate branch. 

# CODEX response and implementation plan

## Findings

  - The new producer YAMLs (e.g., catalog/blueprints/modules/producers/audio.yaml, video.yaml, music.yaml, timeline-composer.yaml)
    no longer declare producers/connections; models holds multiple provider options. The current loader (core/src/blueprint-loader/
    yaml-parser.ts) only understands the old schema, so these files currently parse as “no producers, no edges,” which will break the
    graph/plan.
  - Several producer files still use old keys or bad paths: jsonSchema/inputsMap instead of inputSchema/inputs; schema paths use ./
    schemas/... but the files live in ../schemas/...; timeline-composer references MusicSegments while the input is Music, and it has
    no outputs declared. These will fail even after parser changes.
  - The new inputs.yaml format (catalog/blueprints/cut-scene-video/input-template.yaml) adds a models: array and per-model config, but cli/src/lib/input-loader.ts
    discards everything except inputs.* and hardcodes InquiryPrompt validation. Model selection/config changes will not affect
    planning/dirty detection today.
  - Provider selection is still static: buildProducerOptionsFromBlueprint/buildProducerCatalog pick the single provider/model from
    the blueprint. There is no way to choose among models[], and config properties are not treated as inputs, so edits won’t mark
    jobs dirty.
  - Input/schema handling is misaligned with the proposal: prompt TOMLs are still parsed for config and jsonSchema; SchemaRegistry
    is only fed via config.sdkMapping in dry-run; runtime.sdk.buildPayload only knows sdkMapping, not the new inputs mapping; no
    validation of inputSchema/outputSchema before hitting providers.
  - Timeline composer provider (providers/src/producers/timeline/ordered-timeline.ts) still expects the old config.clips[] shape; the
    new schema (modules/schemas/timeline-input.json) and YAML propose a different structure (track lists + nested artifacts via dot
    syntax), which the code does not parse.
  - Video exporter/timeline composer rootFolder is still expected from blueprint config; build already injects Input:StorageRoot/
    Input:StorageBasePath, so the YAML rootFolder override should become unnecessary but isn’t wired automatically.
  - Remaining blueprints (audio-only.yaml, image-only.yaml, etc.) are still in the old format and will stay broken once backward
    compatibility is removed.

## Implementation Plan

  1. Loader + document model

  - Extend core/src/blueprint-loader/yaml-parser.ts to recognize the new “producer module” shape (meta/inputs/artifacts/models, no
    connections/producers). Normalize it into the existing BlueprintDocument by synthesizing a single producer node (id = meta.id),
    auto-wiring edges from every declared input to the producer and from the producer to every artefact, and generating collectors if
    needed for fan-in inputs.
  - Parse models[] into a new structure on ProducerConfig that retains: provider, model, inputSchema, outputSchema, inputs (renamed
    from sdkMapping), outputs, optional config, and prompt file references. Keep legacy fields only as needed to migrate remaining
    YAMLs.
  - Update prompt parsing so TOMLs now only supply system/user prompts + variables; model/config/schema move to YAML. Reject/ignore
    old TOML config keys to avoid conflicting sources.

  2. Canonical graph & config-as-inputs

  - Create synthetic Input nodes for config properties that are surfaced either in models[].config defaults or in inputs.yaml
    models[].config. Canonical IDs should match the SDK field name (namespaced to the producer to avoid collisions) and feed edges
    into the producer so dirty tracking works via job.inputs.
  - Ensure expandBlueprintGraph/createProducerGraph carry these synthetic inputs through inputBindings so runtime lookups stay
    canonical (no alias heuristics).

  3. Inputs file ingestion

  - Redo cli/src/lib/input-loader.ts to accept the new shape: inputs: map plus models: array (with producerId, provider/model
    choice, optional per-run config). Validate required blueprint inputs using the parsed blueprint (no hardcoded InquiryPrompt), and
    materialize canonical ids for config inputs and model selections so they are persisted in manifests and participate in dirty calc.  - Capture user model selections distinctly (e.g., Input:<Producer>.model, Input:<Producer>.provider or similar), and merge per-model    config into the synthetic input map.

  4. Provider option selection

  - Change cli/src/lib/producer-options.ts to emit options per models[] entry, not per producer only. Build a resolver that, given
    the parsed models: selections from inputs, picks the matching provider/model/config for each producer when constructing the
    ProducerCatalog and when serializing job context.
  - Thread the chosen model/config into ProducerJobContext (e.g., context.providerConfig and job.context.extras.selectedModel) so
    providers can read the exact selection. Ensure the plan JSON records the selected provider/model for reproducibility.

  5. Input mapping & schema validation

  - Rename sdkMapping to inputs throughout types (core/src/types.ts, provider runtime) and teach runtime.sdk.buildPayload to use it.
    Include config-derived synthetic inputs in the bindings so SDK payload assembly can pull both node inputs and config properties.
  - Load inputSchema/outputSchema for the selected model and register them with SchemaRegistry (both live and simulated). Add a
    validation step before invoking providers (either in createProducerRuntime or per-provider helper) to check the assembled SDK
    payload against inputSchema and fail fast with descriptive errors.

  6. Timeline composer alignment

  - Decide on the authoritative config shape (per the new timeline-input.json): implement parsing in ordered-timeline.ts to accept
    the new track/object structure, including dot-path references (imageClip.artifact etc.) that map to canonical input IDs/fan-
    in descriptors.
  - Ensure inputs (ImageSegments, VideoSegments, AudioSegments, Music) are wired with fan-in metadata and adjust default behaviors
    (masterTrack, tracks ordering, volumes) to match the new YAML/schema. Remove reliance on rootFolder from YAML; pull storage paths
    from Input:StorageRoot/Input:StorageBasePath.

  7. Video exporter alignment

  - Remove dependence on YAML rootFolder; rely on injected storage inputs. Validate that the blueprint supplies the needed timeline
    input, and optionally add inputSchema for the exporter.

  8. CLI surface & validation tools

  - Update blueprints:list/describe/validate to surface models[], inputSchema/outputSchema, and inferred connections for producer
    modules. Add validation that schema paths resolve and inputs mappings match declared inputs.
  - Refresh docs/tests (core/src/blueprint-loader/*.test.ts, cli/src/commands/*.test.ts, provider tests) to use the new YAML and
    inputs format; migrate or replace old fixture blueprints.

  9. Blueprint/content fixes

  - Fix schema paths in producer YAMLs (../schemas/...), align keys (inputSchema, inputs), and correct mismatches like MusicSegments
    vs Music. Clean up catalog/blueprints/cut-scene-video/input-template.yaml (remove trailing commas/duplicate keys) and convert remaining blueprints to the new
    format or clearly mark them unsupported until migrated.

  Once these steps are in place, config changes and model swaps will participate in dirty tracking, providers will see validated SDK
  payloads derived from canonical IDs, and the new blueprint/input formats will flow end-to-end without aliasing.

# Q & A:
*Question*
For the InquiryPrompt in inputs, it might be hardcoded because the CLI wires the commandline argument after query directly into InquiryPrompt. Can you check, we don't want to break that behavior

*Answer*
I checked: runQuery passes options.inquiryPrompt to generatePlan, which in turn calls loadInputsFromYaml with inquiryPromptOverride.
That loader currently overwrites values.InquiryPrompt when a non-empty CLI argument is provided. So the CLI “prompt argument wins over inputs.yaml” behavior is intact today.

When we rework the input loader for the new schema, we should keep this override semantics: apply the CLI prompt after parsing the
new inputs file, and emit the canonical Input:InquiryPrompt entry so planning/dirty tracking still sees it. I’ll keep that wiring
unchanged while removing the old hardcoded validation.

*Question*
Keep in mind that all parsing of YAML, JSON and TOML files need to happen in the core package, but they should be converted to an
intermediary format before passed on to the provider implementation. Providers will have the semantic understanding of those and use accordingly. Core remains dumb but does all the initial file format parsing. Please confirm

*Answer*
Understood. All YAML/JSON/TOML parsing will stay in core (the loader + schema ingestion), producing a normalized in-memory
representation (blueprint tree, models array with input/output schemas already read as JSON text, prompt contents, mappings,
and selected provider/model/config). Providers will only receive that intermediary context (via ProducerJobContext/extras and
providerConfig), not raw files, and will apply their own semantics. I’ll keep providers “dumb” to file formats and let them operate on the parsed data that core hands over.


*Question*
How exactly are you planning to deal with the JSON schemas? Are you going to convert all the config properties and input nodes into JSON and validate with a JSON Schema validator library? And where will this code live? In the providers but as a common library tool for all producer implementations to use. Please elaborate

*Answer:*
Here’s how I’d handle schemas under the new format:

  - Parsing stays in core: Core will continue to read YAML/TOML/JSON files, and for each model entry it will load inputSchema/
    outputSchema as JSON text. That text travels in the ProducerJobContext (e.g., job.context.schema.input/schema.output), never raw
    file paths. Core won’t interpret the schema beyond loading it.
  - Validation happens in providers via a shared helper: In providers/ I’ll add a small utility (e.g., sdk/schema-validator.ts) that:
      - Caches compiled AJV validators per provider+model (or per schema hash).
      - Accepts { schemaText, payload, label } and throws a descriptive error if validation fails.
      - Is usable by all producer implementations (OpenAI, Replicate, internal timeline/exporter) so we don’t duplicate logic.
  - What gets validated: Each producer will assemble the exact SDK payload it’s about to send—merged config defaults + user overrides
    + mapped input nodes (via runtime.sdk.buildPayload) + any synthetic config inputs. That final payload is what gets validated
    against inputSchema right before the API call. Optionally, for deterministic providers (e.g., timeline/exporter), we can also
    validate responses against outputSchema when present.
  - Where this is wired: Inside each provider handler (or inside createProducerRuntime if we want a single choke point), right after
    building the SDK payload and before the external call. No validation logic in core; providers just consume the already-parsed
    schema text from the job context.
  - SchemaRegistry integration: We’ll store the parsed schema text alongside sdk-mapping/config in the registry so simulated/mock
    clients and the shared validator both see the same schema. The registry remains in providers/; core just populates it with the
    parsed text.

  Net: core stays “dumb” (loads files, passes strings), providers do the semantic validation using a shared AJV-based helper on the
  concrete request payload they’re about to send.

*Question*
› Dryrun should also ensure that the validators run so it can fail in dryrun if the inputs are not correct. Please confirm

*Answer*
• Confirmed. In dry-run we’ll run the same AJV-based validation before “invoking” providers. The dry-run flow already builds SDK
payloads; we’ll hook the shared validator there so bad inputs/configs fail fast in dry-run just like live runs.


# State of the plan as of Fri 28.
 State of Multi‑Model Plan

  - Core loader now understands the new producer-module shape: when a YAML has only meta/inputs/artifacts/models, core/src/blueprint-
    loader/yaml-parser.ts builds a single producer, loads models[] (including inputSchema/jsonSchema), and infers edges from every
    input to the producer and from the producer to each artifact. Provider options honor models[] and per-run selections (cli/src/
    lib/producer-options.ts), and handlers validate SDK payloads against the loaded schemas via the new providers/src/sdk/schema-
    validator.ts (wired in the Replicate/OpenAI producers).

  Gaps / Not Done

  - Canonical IDs are not created or enforced up front. Inputs are recorded with authored names and only copied to Input:<name> right
    before provider invocation (core/src/provider-context.ts:27-51); manifest/events therefore store non-canonical keys. Timeline code
    also tries to “guess” canonical IDs from base names (providers/src/sdk/config-utils.ts:9-28), which is explicitly disallowed.
  - Fallback/alias parsing remains: the YAML parser still accepts jsonSchema, inputsMap, and prompt-file fallbacks (core/src/
    blueprint-loader/yaml-parser.ts in parseModelVariant), and timeline config uses base-name matching instead of exact canonical IDs
    (providers/src/producers/timeline/ordered-timeline.ts via canonicalizeAuthoredInputId). This keeps alias heuristics alive instead
    of failing fast on missing canonical bindings.
  - Model/provider selections and config properties are not part of the dependency graph, so edits don’t mark jobs dirty.
    applyModelSelectionsToInputs flattens config and even adds Input:<producer>.<key> entries (cli/src/lib/input-loader.ts:104-115),
    but those inputs are never wired into the graph or inputBindings, and determineDirtyInputs only looks at inputs connected by
    edges. Changing a model choice or config in inputs.yaml will not rerun the affected subtree.
  - Inputs.yaml handling is still hardcoded/legacy: the planner insists on InquiryPrompt being present (cli/src/lib/planner.ts:83-90)
    instead of deferring to the blueprint’s declared inputs, and model selections are not validated against the blueprint’s models[].
  - Timeline composer is still on the old shape: it expects clips/imageClip/videoClip shorthands and resolves artifacts by alias
    (providers/src/producers/timeline/ordered-timeline.ts), ignoring the new dot-path schema, missing inputSchema validation, and not
    consuming storage inputs automatically for rootFolder.

  Next steps

  1. Canonicalize immediately: normalize inputs to canonical IDs at parse time, drop alias fallbacks (canonicalizeAuthoredInputId,
     legacy schema/mapping keys), and propagate only canonical IDs into events/manifests/resolvedInputs. 2) Treat model selections
     and model/config properties as first-class inputs in the graph (synthetic input nodes + bindings) so planner dirties and reruns
     affected subtrees when they change. 3) Align timeline/exporter with the new schemas/config flow (dot-path inputs, storage roots
     from injected inputs, schema validation) and remove the remaining legacy prompt/config fallbacks.
