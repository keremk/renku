# Image Models

## Nano Banana Pro (Provider: Google)
- **Strengths**: High visual fidelity, consistency across prompts/styles; outperforms in reasoning, text rendering, detail; best for image generation/editing overall; clean outputs.
- **Weaknesses**: Poor portrait consistency—facial features shift, skin appears plastic; identity preservation fails quickly; not ideal for humans or dynamic poses.
- **Best For**: Realistic non-portrait visuals like architecture/objects; moderate prompt adherence for general tasks; cinematic styles.
- **Prompting Techniques**: Use high-precision descriptors for details; leverage references for ads; strong for collages with transitions; camera techniques like low-angle for best shots.
- **Concrete Example Prompts**:
  1. Continuous long segments (chain images): "Begin frame: serene mountain landscape at dawn; End frame: same landscape at dusk with fading light --ar 16:9"
  2. Dynamic cuts: N/A (static image model; simulate via multi-panel: "4-panel collage with scene cuts: forest path to river crossing, quick transitions")
  3. Camera techniques: "Low-angle shot of ancient ruins, emphasizing height and mystery, 35mm lens, dramatic shadows"
  4. Ads from references: Upload ref image + "Create ad poster preserving product from reference, add slogan 'Discover Adventure', vibrant colors, centered composition"
  5. Collages with transitions: "Collage of urban scenes: street to skyline with fade transition, interesting wipe effects, high contrast"

## GPT Image 1.5 (Provider: OpenAI)
- **Strengths**: Tops benchmarks for likeness, pose retention, detail transfer, text/font accuracy; strong realism and consistency in portraits; handles complex visuals.
- **Weaknesses**: Minor drift in repeated generations; less effective for highly stylized outputs.
- **Best For**: Realistic and cinematic human portraits; good prompt adherence for detailed scenes; anime/cartoon if specified.
- **Prompting Techniques**: Structure with color grading, negative prompts; use references for ads; create collages with seamless prompts.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: cozy cabin interior; End frame: same cabin with fire lit, warm glow transition --style cinematic"
  2. Dynamic cuts: N/A (static; use grid: "Grid of scenes with dynamic cuts: office to beach, abrupt transitions")
  3. Camera techniques: "Dutch angle portrait of warrior, low light, intense gaze, for dramatic effect"
  4. Ads from references: Upload ref + "Generate ad from reference image, preserve likeness, add text 'Unleash Power', bold fonts"
  5. Collages: "Collage of fantasy realms cutting from forest to castle with swirling mist transitions"

## Seedream 4.5 (Provider: ByteDance/Dreamina)
- **Strengths**: Near-perfect character consistency in portraits; stable face structure, human-like skin; high prompt coherence; excels in people generation.
- **Weaknesses**: Less versatile for non-portrait tasks.
- **Best For**: Realistic portraits, anime/manga; excellent identity preservation; cinematic breakdowns.
- **Prompting Techniques**: Use references for identity; begin/end frames for segments; camera like Dutch angle.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: character in forest; End frame: character at river, consistent identity"
  2. Dynamic cuts: N/A (simulate: "Multi-scene panel with cuts: day to night, dynamic shifts")
  3. Camera techniques: "High-angle shot of cityscape, bird's eye view for scale, soft focus"
  4. Ads from references: Upload ref + "Ad from reference, maintain portrait, add 'Timeless Beauty' tagline"
  5. Collages: "Collage of portraits transitioning from casual to formal with gradient blends"

## Grok Imagine (Aurora) (Provider: xAI)
- **Strengths**: Unrestricted creativity; speed; photorealism across styles (portraits, anime, cyberpunk); image-to-video with sound.
- **Weaknesses**: Weak at identifying requirements; artifacts.
- **Best For**: Realistic, anime, edgy; unrestricted content; cinematic with sound.
- **Prompting Techniques**: Chat iterations; specify modes; camera via orbit; ads/collages from refs.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: cyberpunk street; End frame: alley chase, continuous flow"
  2. Dynamic cuts: N/A (use for video extension: "Extend image with cuts: scene1 to scene2")
  3. Camera techniques: "Orbit shot around neon sign, zoom-in for detail, night vibe"
  4. Ads from references: Upload ref + "Edgy ad from reference, add 'Future Awaits', unrestricted style"
  5. Collages: "Collage of dystopian scenes with glitch transitions"

## Qwen-Image-2512 (Provider: Alibaba)
- **Strengths**: More realistic humans; finer textures; stronger text rendering; ranks #1 in blind tests; competitive with closed-source.
- **Best For**: Realistic faces, text, textures; anime/cartoon; cinematic outputs.
- **Prompting Techniques**: Detailed descriptions; layers for edits; collages via decomposition.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: landscape dawn; End frame: sunset, seamless layer transition"
  2. Dynamic cuts: "Decompose into layers with cuts: scene A to B, dynamic effects"
  3. Camera techniques: "Wide-angle view of mountain, panoramic for immersion"
  4. Ads from references: Upload ref + "Ad poster from ref, accurate text 'New Era', detailed textures"
  5. Collages: "Layered collage with scenes fading into each other, interesting overlays"

## Flux 2 Pro (Provider: Black Forest Labs)
- **Strengths**: Firm, controlled outputs with minimal artifacts; balanced performance.
- **Weaknesses**: Less dynamic or creative.
- **Best For**: Realistic and cinematic; strong adherence.
- **Prompting Techniques**: Detail scenes, gestures; collages with perspective.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: quiet village; End frame: bustling market, gradual change"
  2. Dynamic cuts: N/A (multi-image: "Panels with scene cuts, controlled transitions")
  3. Camera techniques: "Perspective shift with Dutch angle for momentum"
  4. Ads from references: Upload ref + "Controlled ad from ref, minimal artifacts, 'Pure Innovation'"
  5. Collages: "Collage of nature scenes with perspective transitions"

## NewBie-image-Exp0.1 (Provider: NewBieAI-Lab/ModelScope)
- **Strengths**: Excellent for anime; precise, fast; dual encoders; XML prompts for control; LoRA-friendly.
- **Weaknesses**: Non-commercial; 8GB VRAM min.
- **Best For**: Anime/cartoon with multi-character; detailed textures.
- **Prompting Techniques**: XML for control; noise refiner; chain for dynamics.
- **Concrete Example Prompts**:
  1. Continuous segments: "<begin> anime hero standing; <end> hero running, continuous action"
  2. Dynamic cuts: "XML scenes with cuts: battle to victory, dynamic effects"
  3. Camera techniques: "Still shot with zoom on character eyes for emotion"
  4. Ads from references: Upload ref + "Anime ad from ref, XML control <product> glowing sword"
  5. Collages: "Collage of anime panels with transition tags"

## Qwen-Image-Layered (Provider: Alibaba/Tongyi Lab)
- **Strengths**: Native layered generation; infinite decomposition; prompt precision; lossless editing.
- **Weaknesses**: Multi-step for complex.
- **Best For**: Detailed decompositions; cinematic breakdowns.
- **Prompting Techniques**: Specify layers; isolate for ads; recombine for collages.
- **Concrete Example Prompts**:
  1. Continuous segments: "Decompose begin/end frames into layers for segment: city day to night"
  2. Dynamic cuts: "Layered cuts within scene: add/remove elements dynamically"
  3. Camera techniques: "Layered view with tracking shot, editable angles"
  4. Ads from references: Upload ref + "Decompose ref into 5 layers for ad, reassemble with text"
  5. Collages: "Recombine layers into collage with custom transitions like dissolve"

# Video Models

## Kling 2.6 (Provider: Kuaishou/Kling AI)
- **Strengths**: Top image quality; natural expressions, realistic skin; motion handling; 3D reconstruction; UGC motion control.
- **Weaknesses**: Noisy audio; not bold in sound.
- **Best For**: Realistic humans/scenes; motion/camera adherence; cinematic.
- **Prompting Techniques**: Motion control with refs; seamless transitions; camera tracking.
- **Concrete Example Prompts**:
  1. Continuous long segments: "Begin frame: calm lake; End frame: stormy waves, 20s continuous motion"
  2. Dynamic cuts: "Video with cuts: forest walk to cliff edge, dynamic jump cuts"
  3. Camera techniques: "Tracking shot following runner, steady cam for smooth pursuit"
  4. Ads from references: Upload ref image + "Ad video from ref, product reveal with motion control"
  5. Collages: "Collage video of scenes with whip pan transitions"

## Veo 3.1 (Provider: Google)
- **Strengths**: HD quality; lip movement/timing; native audio (dialogue, music, SFX); understands pro terms.
- **Weaknesses**: Slightly stiff; auto-adds dialogue.
- **Best For**: Cinematic; audio effects; realistic/anime.
- **Prompting Techniques**: JSON for multi-shots; canvas with images; instant cuts.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: empty stage; End frame: performer bowing, long 15s segment"
  2. Dynamic cuts: "Multi-shot with instant jump cuts: city day to night"
  3. Camera techniques: "Dutch angle for tension, dolly zoom on face"
  4. Ads from references: Upload ref + "Cinematic ad from ref, with SFX and music"
  5. Collages: "Video collage with smooth fade transitions between scenes"

## Sora 2 Pro (Provider: OpenAI)
- **Strengths**: Best for animated shows; matches texture/lighting/motion; 25s clips; physics simulation; consistency.
- **Weaknesses**: Weak causality/memory/jokes; desynced audio.
- **Best For**: Cartoon/realistic animations; motion adherence.
- **Prompting Techniques**: Ground in actions; specify camera; transitions for collages.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: ball rolling; End frame: basket score, physics-based 25s"
  2. Dynamic cuts: "Video with multiple cuts: adventure scenes, dynamic effects"
  3. Camera techniques: "Pan shot across landscape for epic feel"
  4. Ads from references: Upload ref + "Animated ad from ref, consistent character"
  5. Collages: "Collage of cartoon scenes with crossfade transitions"

## WAN 2.6 (Provider: WAN AI)
- **Strengths**: Natural expressions; language precision; voice clarity; rotoscoping.
- **Weaknesses**: Treble-heavy sound.
- **Best For**: Natural motion/lip-syncing; realistic characters.
- **Prompting Techniques**: Ref-based; continuous with frames; collages.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: dialogue start; End frame: end, natural lip-sync"
  2. Dynamic cuts: "Cuts for dynamic: conversation to action"
  3. Camera techniques: "Close-up for expression, static hold"
  4. Ads from references: Upload ref + "Ad with rotoscoping from ref"
  5. Collages: "Scenes collage with seamless cuts"

## Seedance 1.5 Pro (Provider: Seedance AI)
- **Strengths**: Clear voice, pronunciation, expressive faces; multi-person; perfect lip-sync; auto sound/music.
- **Weaknesses**: 720p output; compresses sources.
- **Best For**: Talking characters; realistic lip-sync/audio effects.
- **Prompting Techniques**: Structured scenes; begin/end for long videos; angle specs.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: group chat; End frame: laughter, 10s continuous"
  2. Dynamic cuts: "Video segment with cuts: intro to debate"
  3. Camera techniques: "Any angle lip-sync, rotating camera"
  4. Ads from references: Upload ref + "Talking ad from ref, expressive"
  5. Collages: "Multi-person collage with transition effects"

## LTX-2 (Provider: Lightricks/LTX Studio)
- **Strengths**: Synchronized audio-video; high-speed; camera LoRAs; 4K/50FPS; open-weights; native audio.
- **Weaknesses**: Needs optimization; robotic feel.
- **Best For**: Audio effects/lip-syncing; cinematic with sound.
- **Prompting Techniques**: Text-to-video with first frame; video-to-video for ads; dynamic cuts.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: singer start; End frame: chorus, long segment"
  2. Dynamic cuts: "Cuts within segment: verse to bridge"
  3. Camera techniques: "Pan/tilt/dolly for dynamic shots"
  4. Ads from references: "Video-to-video ad swap from ref"
  5. Collages: "Collage with layered transitions"

## Runway Gen-4 (Provider: Runway)
- **Strengths**: VFX changes (scenes, lighting, angles); film-grade; camera control.
- **Weaknesses**: 5s max; hit/miss; API restrictions.
- **Best For**: VFX and editing; motion in short clips.
- **Prompting Techniques**: Text-based VFX; remove/add for ads; transitions.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: calm; End frame: chaos, 5s continuous"
  2. Dynamic cuts: "Short video with quick cuts"
  3. Camera techniques: "Angle changes for VFX"
  4. Ads from references: "VFX ad, add elements from ref"
  5. Collages: "Transitions for scene collages"

## Hailuo 2.3 (Provider: Hailuo AI)
- **Strengths**: Affordable; high-quality visuals; unlimited generation.
- **Weaknesses**: Less consistent in prompts.
- **Best For**: Visual aesthetics; cinematic content.
- **Prompting Techniques**: For ads and long segments.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin frame: adventure start; End frame: climax"
  2. Dynamic cuts: "Dynamic scene-to-scene effects"
  3. Camera techniques: "Tracking for best shots"
  4. Ads from references: "Ad video from ref image"
  5. Collages: "Cuts with interesting transitions"

## Luma Ray3 (Provider: Luma AI)
- **Strengths**: Smooth motion; visual flow.
- **Weaknesses**: Diluted narrative; lacks authority.
- **Best For**: Elegant animations; motion.
- **Prompting Techniques**: Interpolation for segments.
- **Concrete Example Prompts**:
  1. Continuous segments: "Begin/end frames for smooth long video"
  2. Dynamic cuts: "Cuts for dynamic effects"
  3. Camera techniques: "Low angle for scale"
  4. Ads from references: "From ref to ad video"
  5. Collages: "Scenes with fade transitions"

## Higgsfield Cinema Studio (Provider: Higgsfield AI)
- **Strengths**: Professional-grade; maintains integrity.
- **Best For**: Cinematic videos; ads.
- **Prompting Techniques**: For multi-shots and edits.
- **Concrete Example Prompts**:
  1. Continuous segments: "Long segment using begin/end"
  2. Dynamic cuts: "Scene cuts for dynamics"
  3. Camera techniques: "Smooth movements"
  4. Ads from references: "Pro ad from ref"
  5. Collages: "With seamless transitions"

**Proposed Best Practices**: Use begin/end frames for continuity (Veo, Kling); dynamic cuts like jump (Veo, Sora); camera e.g., dolly zoom (Kling, LTX); ads via ref preservation (Kling, WAN); collages with whip pans or fades (Veo, Runway). For images, chain for segments; multi-panels for cuts/collages.