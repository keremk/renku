---
title: Music quickstart
subtitle: Learn how to generate music with Eleven Music.
---

This guide will show you how to generate music with Eleven Music.

<Info>The Eleven Music API is only available to paid users.</Info>

## Using the Eleven Music API

<Steps>
    <Step title="Create an API key">
        [Create an API key in the dashboard here](https://elevenlabs.io/app/settings/api-keys), which you’ll use to securely [access the API](/docs/api-reference/authentication).
        
        Store the key as a managed secret and pass it to the SDKs either as a environment variable via an `.env` file, or directly in your app’s configuration depending on your preference.
        
        ```js title=".env"
        ELEVENLABS_API_KEY=<your_api_key_here>
        ```
        
    </Step>
    <Step title="Install the SDK">
        We'll also use the `dotenv` library to load our API key from an environment variable.
        
        <CodeBlocks>
        
            ```typescript
            npm install @elevenlabs/elevenlabs-js
            npm install dotenv
            ```
        
        </CodeBlocks>
        
    </Step>
    <Step title="Make the API request">
        Create a new file named `example.py` or `example.mts`, depending on your language of choice and add the following code:

        <CodeBlocks>
 
        ```typescript
        // example.mts
        import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
        import { Readable } from "stream";
        import { createWriteStream } from "fs";
        import { pipeline } from "stream/promises";
        import "dotenv/config";

        const elevenlabs = new ElevenLabsClient();

        const track = await elevenlabs.music.compose({
          prompt: "Create an intense, fast-paced electronic track for a high-adrenaline video game scene. Use driving synth arpeggios, punchy drums, distorted bass, glitch effects, and aggressive rhythmic textures. The tempo should be fast, 130–150 bpm, with rising tension, quick transitions, and dynamic energy bursts.",
          musicLengthMs: 10000,
        });

        // Save the track to a file
        await pipeline(Readable.from(track), createWriteStream("path/to/music.mp3"));
        ```
        </CodeBlocks>
    </Step>
     <Step title="Execute the code">
        <CodeBlocks>
            ```python
            python example.py
            ```

            ```typescript
            npx tsx example.mts
            ```
        </CodeBlocks>

        You should hear the generated music playing.
    </Step>

</Steps>

## Composition plans

A composition plan is a JSON object that describes the music you want to generate in finer detail. It can then be used to generate music with Eleven Music.

Using a plan is optional, but it can be used to generate more complex music by giving you more granular control over each section of the generation.

### Generating a composition plan

A composition plan can be generated from a prompt by using the API.

<CodeBlocks>

    ```typescript
    import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
    import "dotenv/config";

    const elevenlabs = new ElevenLabsClient();

    const compositionPlan = await elevenlabs.music.compositionPlan.create({
      prompt: "Create an intense, fast-paced electronic track for a high-adrenaline video game scene. Use driving synth arpeggios, punchy drums, distorted bass, glitch effects, and aggressive rhythmic textures. The tempo should be fast, 130–150 bpm, with rising tension, quick transitions, and dynamic energy bursts.",
      musicLengthMs: 10000,
    });

    console.log(JSON.stringify(compositionPlan, null, 2));
    ```

</CodeBlocks>

The above will generate a composition plan similar to the following:

```json
{
  "positiveGlobalStyles": [
    "electronic",
    "fast-paced",
    "driving synth arpeggios",
    "punchy drums",
    "distorted bass",
    "glitch effects",
    "aggressive rhythmic textures",
    "high adrenaline"
  ],
  "negativeGlobalStyles": ["acoustic", "slow", "minimalist", "ambient", "lo-fi"],
  "sections": [
    {
      "sectionName": "Intro",
      "positiveLocalStyles": [
        "rising synth arpeggio",
        "glitch fx",
        "filtered noise sweep",
        "soft punchy kick building tension"
      ],
      "negativeLocalStyles": ["soft pads", "melodic vocals", "ambient textures"],
      "durationMs": 3000,
      "lines": []
    },
    {
      "sectionName": "Peak Drop",
      "positiveLocalStyles": [
        "full punchy drums",
        "distorted bass stab",
        "aggressive rhythmic hits",
        "rapid arpeggio sequences"
      ],
      "negativeLocalStyles": ["smooth transitions", "clean bass", "slow buildup"],
      "durationMs": 4000,
      "lines": []
    },
    {
      "sectionName": "Final Burst",
      "positiveLocalStyles": [
        "glitch stutter",
        "energy burst vox chopped sample",
        "quick transitions",
        "snare rolls"
      ],
      "negativeLocalStyles": ["long reverb tails", "fadeout", "gentle melodies"],
      "durationMs": 3000,
      "lines": []
    }
  ]
}
```

### Using a composition plan

A composition plan can be used to generate music by passing it to the `compose` method.

<CodeBlocks>
    ```python
    # You can pass in composition_plan or prompt, but not both.
    composition = elevenlabs.music.compose(
        composition_plan=composition_plan,
    )

    play(composition)
    ```

    ```typescript
    // You can pass in compositionPlan or prompt, but not both.
    const composition = await elevenlabs.music.compose({
        compositionPlan,
    });

    await play(composition);
    ```

</CodeBlocks>

## Generating music with details

For each music generation a composition plan is created from the prompt. You can opt to retrieve this plan by using the detailed response endpoint.

<CodeBlocks>

    ```python
    track_details = elevenlabs.music.compose_detailed(
        prompt="Create an intense, fast-paced electronic track for a high-adrenaline video game scene. Use driving synth arpeggios, punchy drums, distorted bass, glitch effects, and aggressive rhythmic textures. The tempo should be fast, 130–150 bpm, with rising tension, quick transitions, and dynamic energy bursts.",
        music_length_ms=10000,
    )

    print(track_details.json) # json contains composition_plan and song_metadata. The composition plan will include lyrics (if applicable)
    print(track_details.filename)
    # track_details.audio contains the audio bytes
    ```

    ```typescript
    const trackDetails = await elevenlabs.music.composeDetailed({
      prompt: 'Create an intense, fast-paced electronic track for a high-adrenaline video game scene. Use driving synth arpeggios, punchy drums, distorted bass, glitch effects, and aggressive rhythmic textures. The tempo should be fast, 30–150 bpm, with rising tension, quick transitions, and dynamic energy bursts.',
      musicLengthMs: 10000,
    });

    console.log(JSON.stringify(trackDetails.json, null, 2)); // json contains composition_plan and song_metadata. The composition plan will include lyrics (if applicable)
    console.log(trackDetails.filename);
    // trackDetails.audio contains the audio bytes
    ```

</CodeBlocks>

## Copyrighted material

Attempting to generate music or a composition plan that contains copyrighted material will result in an error. This includes mentioning a band or musician by name or using copyrighted lyrics.

### Prompts with copyrighted material

In these cases, the API will return a `bad_prompt` error that contains a suggestion of what prompt you could use instead.

<CodeBlocks>
    ```python
    try:
        # This will result in a bad_prompt error
        track = elevenlabs.music.compose(
            prompt="A song that sounds like 'Bohemian Rhapsody'",
            music_length_ms=10000,
        )
      except Exception as e:
          if e.body['detail']['status'] == 'bad_prompt':
              prompt_suggestion = e.body['detail']['data']['prompt_suggestion']
              print(prompt_suggestion) # Prints: An epic rock ballad with dramatic tempo changes, operatic harmonies, and a narrative structure that blends melancholy with bursts of theatrical intensity.

              # Use the prompt suggestion to generate the track instead
    ```

    ```typescript
    try {
      // This will result in a bad_prompt error
      const track = await elevenlabs.music.compose({
        prompt: "A song that sounds like 'Bohemian Rhapsody'",
        musicLengthMs: 10000,
      });
    } catch (error) {
      if (error.body.detail.status === 'bad_prompt') {
        const promptSuggestion = error.body.detail.data.prompt_suggestion;
        console.log(promptSuggestion); // Logs: An epic rock ballad with dramatic tempo changes, operatic harmonies, and a narrative structure that blends melancholy with bursts of theatrical intensity.

        // Use the prompt suggestion to generate the track instead
      }
    }
    ```

</CodeBlocks>

### Composition plans with copyrighted material

If styles using copyrighted material are used when generating a composition plan, a `bad_composition_plan` error will be returned. Similar to music prompts, a suggested composition plan `composition_plan_suggestion` will be returned within the error.

<Warning>
  In the case of a composition plan or prompt that contains harmful material, no suggested prompt
  will be returned.
</Warning>

## Next steps

Explore the [API reference](/docs/api-reference/music/compose) for more information on the Music API and its options.


# Compose music

POST https://api.elevenlabs.io/v1/music
Content-Type: application/json

Compose a song from a prompt or a composition plan.

Reference: https://elevenlabs.io/docs/api-reference/music/compose

## OpenAPI Specification

```yaml
openapi: 3.1.1
info:
  title: Compose Music
  version: endpoint_music.compose
paths:
  /v1/music:
    post:
      operationId: compose
      summary: Compose Music
      description: Compose a song from a prompt or a composition plan.
      tags:
        - - subpackage_music
      parameters:
        - name: output_format
          in: query
          description: >-
            Output format of the generated audio. Formatted as
            codec_sample_rate_bitrate. So an mp3 with 22.05kHz sample rate at
            32kbs is represented as mp3_22050_32. MP3 with 192kbps bitrate
            requires you to be subscribed to Creator tier or above. PCM with
            44.1kHz sample rate requires you to be subscribed to Pro tier or
            above. Note that the μ-law format (sometimes written mu-law, often
            approximated as u-law) is commonly used for Twilio audio inputs.
          required: false
          schema:
            $ref: '#/components/schemas/AllowedOutputFormats'
        - name: xi-api-key
          in: header
          required: true
          schema:
            type: string
      responses:
        '200':
          description: The generated audio file in the format specified
          content:
            application/octet-stream:
              schema:
                type: string
                format: binary
        '422':
          description: Validation Error
          content: {}
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/Body_Compose_music_v1_music_post'
components:
  schemas:
    AllowedOutputFormats:
      type: string
      enum:
        - value: mp3_22050_32
        - value: mp3_24000_48
        - value: mp3_44100_32
        - value: mp3_44100_64
        - value: mp3_44100_96
        - value: mp3_44100_128
        - value: mp3_44100_192
        - value: pcm_8000
        - value: pcm_16000
        - value: pcm_22050
        - value: pcm_24000
        - value: pcm_32000
        - value: pcm_44100
        - value: pcm_48000
        - value: ulaw_8000
        - value: alaw_8000
        - value: opus_48000_32
        - value: opus_48000_64
        - value: opus_48000_96
        - value: opus_48000_128
        - value: opus_48000_192
    TimeRange:
      type: object
      properties:
        start_ms:
          type: integer
        end_ms:
          type: integer
      required:
        - start_ms
        - end_ms
    SectionSource:
      type: object
      properties:
        song_id:
          type: string
          description: >-
            The ID of the song to source the section from. You can find the song
            ID in the response headers when you generate a song.
        range:
          $ref: '#/components/schemas/TimeRange'
          description: The range to extract from the source song.
        negative_ranges:
          type: array
          items:
            $ref: '#/components/schemas/TimeRange'
          description: The ranges to exclude from the 'range'.
      required:
        - song_id
        - range
    SongSection:
      type: object
      properties:
        section_name:
          type: string
          description: The name of the section. Must be between 1 and 100 characters.
        positive_local_styles:
          type: array
          items:
            type: string
          description: >-
            The styles and musical directions that should be present in this
            section. Use English language for best result.
        negative_local_styles:
          type: array
          items:
            type: string
          description: >-
            The styles and musical directions that should not be present in this
            section. Use English language for best result.
        duration_ms:
          type: integer
          description: >-
            The duration of the section in milliseconds. Must be between 3000ms
            and 120000ms.
        lines:
          type: array
          items:
            type: string
          description: The lyrics of the section. Max 200 characters per line.
        source_from:
          oneOf:
            - $ref: '#/components/schemas/SectionSource'
            - type: 'null'
          description: >-
            Optional source to extract the section from. Used for inpainting.
            Only available to enterprise clients with access to the inpainting
            API.
      required:
        - section_name
        - positive_local_styles
        - negative_local_styles
        - duration_ms
        - lines
    MusicPrompt:
      type: object
      properties:
        positive_global_styles:
          type: array
          items:
            type: string
          description: >-
            The styles and musical directions that should be present in the
            entire song. Use English language for best result.
        negative_global_styles:
          type: array
          items:
            type: string
          description: >-
            The styles and musical directions that should not be present in the
            entire song. Use English language for best result.
        sections:
          type: array
          items:
            $ref: '#/components/schemas/SongSection'
          description: The sections of the song.
      required:
        - positive_global_styles
        - negative_global_styles
        - sections
    BodyComposeMusicV1MusicPostModelId:
      type: string
      enum:
        - value: music_v1
      default: music_v1
    Body_Compose_music_v1_music_post:
      type: object
      properties:
        prompt:
          type:
            - string
            - 'null'
          description: >-
            A simple text prompt to generate a song from. Cannot be used in
            conjunction with `composition_plan`.
        composition_plan:
          oneOf:
            - $ref: '#/components/schemas/MusicPrompt'
            - type: 'null'
          description: >-
            A detailed composition plan to guide music generation. Cannot be
            used in conjunction with `prompt`.
        music_length_ms:
          type:
            - integer
            - 'null'
          description: >-
            The length of the song to generate in milliseconds. Used only in
            conjunction with `prompt`. Must be between 3000ms and 600000ms.
            Optional - if not provided, the model will choose a length based on
            the prompt.
        model_id:
          $ref: '#/components/schemas/BodyComposeMusicV1MusicPostModelId'
          description: The model to use for the generation.
        force_instrumental:
          type: boolean
          default: false
          description: >-
            If true, guarantees that the generated song will be instrumental. If
            false, the song may or may not be instrumental depending on the
            `prompt`. Can only be used with `prompt`.
        respect_sections_durations:
          type: boolean
          default: true
          description: >-
            Controls how strictly section durations in the `composition_plan`
            are enforced. Only used with `composition_plan`. When set to true,
            the model will precisely respect each section's `duration_ms` from
            the plan. When set to false, the model may adjust individual section
            durations which will generally lead to better generation quality and
            improved latency, while always preserving the total song duration
            from the plan.
        store_for_inpainting:
          type: boolean
          default: false
          description: >-
            Whether to store the generated song for inpainting. Only available
            to enterprise clients with access to the inpainting API.
        sign_with_c2pa:
          type: boolean
          default: false
          description: >-
            Whether to sign the generated song with C2PA. Applicable only for
            mp3 files.

```

## SDK Code Examples

```typescript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

async function main() {
    const client = new ElevenLabsClient({
        environment: "https://api.elevenlabs.io",
    });
    await client.music.compose({
        prompt: "A relaxing acoustic guitar melody with soft piano accompaniment, evoking a peaceful sunset on the beach.",
        musicLengthMs: 180000,
        modelId: "music_v1",
        forceInstrumental: true,
        respectSectionsDurations: true,
        storeForInpainting: false,
        signWithC2Pa: false,
    });
}
main();

```

