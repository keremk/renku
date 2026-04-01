Think of JSON output as one big tree we split into many labeled leaves

Say a prompt producer returns one JSON object:
- Script.Characters[0].ThenImagePrompt
- Script.Characters[0].MeetingVideoPrompt
- Script.Characters[1].ThenImagePrompt
- etc.

At runtime, we do not only keep one giant Script blob.  
We also need those leaf values to flow independently to different downstream producer inputs.
So the system treats those leaves like individual artifacts with canonical IDs, e.g.:
- Artifact:DirectorProducer.Script.Characters[0].ThenImagePrompt
- Artifact:DirectorProducer.Script.Characters[0].MeetingVideoPrompt
That is the whole point of decomposition.
---

How it currently works in generation (and why generation works)
1. Producer metadata has meta.outputSchema (JSON schema file).  
2. Planning loads that schema and applies it to blueprint artifacts (applyOutputSchemasToBlueprintTree in core/src/orchestration/planning-service.ts).
3. Canonical graph decomposition creates leaf artifact nodes from that schema (decomposeJsonSchema in core/src/resolution/schema-decomposition.ts, consumed by core/src/resolution/canonical-graph.ts).
4. Canonical expansion resolves loops/indexes and builds real per-job input bindings (core/src/resolution/canonical-expander.ts).
5. LLM provider gets request.produces containing those leaf artifact IDs and extracts each value from the returned JSON using JSON-path read (buildArtefactsFromResponse in providers/src/sdk/openai/artefacts.ts, readJsonPath in core/src/json-path.ts).
6. Runner stores each leaf as its own artifact event (core/src/runner.ts).
So yes: actual generation depends on this decomposition machinery and that part is real/necessary.
---

What in canonical-expander is necessary vs what is suspicious
Necessary mechanics (should keep):
- loop expansion ([character] -> [0], [1], …),
- collapsing intermediate input nodes into producer bindings,
- element-binding propagation for collection aliases (e.g. SourceImages[0], SourceImages[1]),
- fan-in grouping.
Those are not “hacky fallbacks”; they are required behavior.
Potential masking behavior (should be scrutinized):
- preview summary swallowing runtime errors and silently downgrading behavior (buildProducerBindingSummary fallback block in core/src/resolution/producer-binding-summary.ts),
- string-based source reconstruction when graph source node is missing (resolveSourceBindingFromNodeId in same file),
- any path that turns structural graph problems into “best effort.”