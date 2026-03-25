Architectural Checklist (locked)
Locked checklist I will execute against:
- [ ] Only one canonical sizing input: Resolution ({ width, height }).
- [ ] No AspectRatio input declarations in producer inputs.
- [ ] No blueprint input named AspectRatio.
- [ ] No blueprint connections from AspectRatio or to .AspectRatio input paths.
- [ ] Mapping transforms derive SDK fields (aspect_ratio, resolution, size, etc.) from Resolution.
- [ ] Models panel shows those SDK fields at top with SDK names.
- [ ] Model switch re-runs transform for that model.
- [ ] Incompatibility => error indicator.
- [ ] Nearest conversion => warning indicator.
- [ ] Missing graph-connected source for mapped SDK sizing field => warning.
- [ ] No invented alias shapes like ResolutionAspectRatio.
- [ ] Preview uses the exact runtime payload builder logic (single shared providers path), not duplicated logic.
Current Branch Audit Against Checklist
- Fails:
  - catalog/producers/* still has AspectRatio input declarations in multiple producers.
  - I introduced ResolutionAspectRatio/ResolutionPreset mapping aliases (invalid per your rule).
  - mapping-preview has duplicated logic instead of using the exact runtime payload path.
- Partially OK:
  - Models panel top placement and warning/error indicators are wired.
  - Model-switch recompute is wired.
- Not yet trustworthy:
  - Preview parity with final run is not guaranteed until the shared runtime path refactor is done.
Execution Plan (no edits now, plan only)
1. Revert wrong last mapping edits
   - Remove introduced ResolutionAspectRatio/ResolutionPreset aliases.
   - Restore those specific files first:  
     - catalog/producers/video/image-to-video.yaml  
     - catalog/producers/image/text-to-image.yaml
2. Make preview use exact runtime transform path
   - Extract the payload-building core used by runtime.sdk.buildPayload into a shared providers function (single source of truth).
   - runtime.sdk.buildPayload will call that shared function.
   - Preview endpoint will call that same shared function (not reimplement transforms).
   - Include diagnostic report output from that same execution (errors, normalization warnings, nearest-conversion warnings).
3. Catalog migration to canonical Resolution input
   - Remove AspectRatio input declarations from producers.
   - Keep existing mapping keys where present (e.g. AspectRatio, Resolution keys), but map from input: Resolution with resolution.mode (aspectRatio, preset, sizeToken, sizeTokenNearest, etc.) as needed.
   - No invented aliases.
4. Connection-aware warning logic
   - Derive source-connection warnings from graph bindings per mapped field source alias after input: remap is applied (so input: Resolution does not warn incorrectly).
5. Validation gates (must pass before done)
   - Providers tests: parity tests proving preview output equals runtime sdk.buildPayload output for same mapping/context.
   - Viewer tests: top ordering + status indicator rendering.
   - Smoke on your blueprint: /Users/keremk/videos/animated-cartoon
     - CharacterImageProducer (qwen-image-2512) must show resolved image_size from Resolution.
     - SceneVideoProducer (bytedance/seedance/v1.5/pro/image-to-video) must show transformed aspect_ratio + resolution from Resolution.
   - Catalog sync only via CLI update command (renku update), no manual workspace catalog edits.
If you want any wording adjusted in this checklist, tell me now; otherwise I’ll execute strictly against these gates next.