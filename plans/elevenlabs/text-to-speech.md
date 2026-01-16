# Quickstart
---
title: Developer quickstart
subtitle: Learn how to make your first ElevenLabs API request.
---

The ElevenLabs API provides a simple interface to state-of-the-art audio [models](/docs/overview/models) and [features](/docs/api-reference/introduction). Follow this guide to learn how to create lifelike speech with our Text to Speech API. See the [developer guides](/docs/developers/quickstart#explore-our-developer-guides) for more examples with our other products.

## Using the Text to Speech API

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
          ```python
          pip install elevenlabs
          pip install python-dotenv
          ```
      
          ```typescript
          npm install @elevenlabs/elevenlabs-js
          npm install dotenv
          ```
      
      </CodeBlocks>
      

      <Note>
        To play the audio through your speakers, you may be prompted to install [MPV](https://mpv.io/)
      and/or [ffmpeg](https://ffmpeg.org/).
      </Note>
    </Step>
    <Step title="Make your first request">
      Create a new file named `example.py` or `example.mts`, depending on your language of choice and add the following code:
       {/* This snippet was auto-generated */}
       <CodeBlocks>
       ```python
       from dotenv import load_dotenv
       from elevenlabs.client import ElevenLabs
       from elevenlabs.play import play
       import os
       
       load_dotenv()
       
       elevenlabs = ElevenLabs(
         api_key=os.getenv("ELEVENLABS_API_KEY"),
       )
       
       audio = elevenlabs.text_to_speech.convert(
           text="The first move is what sets everything in motion.",
           voice_id="JBFqnCBsd6RMkjVDRZzb",
           model_id="eleven_multilingual_v2",
           output_format="mp3_44100_128",
       )
       
       play(audio)
       
       ```
       
       ```typescript
       import { ElevenLabsClient, play } from '@elevenlabs/elevenlabs-js';
       import { Readable } from 'stream';
       import 'dotenv/config';
       
       const elevenlabs = new ElevenLabsClient();
       const audio = await elevenlabs.textToSpeech.convert('JBFqnCBsd6RMkjVDRZzb', {
         text: 'The first move is what sets everything in motion.',
         modelId: 'eleven_multilingual_v2',
         outputFormat: 'mp3_44100_128',
       });
       
       const reader = audio.getReader();
       const stream = new Readable({
         async read() {
           const { done, value } = await reader.read();
           if (done) {
             this.push(null);
           } else {
             this.push(value);
           }
         },
       });
       
       await play(stream);
       
       ```
       
       </CodeBlocks>
    </Step>
    <Step title="Run the code">
        <CodeBlocks>
            ```python
            python example.py
            ```

            ```typescript
            npx tsx example.mts
            ```
        </CodeBlocks>

        You should hear the audio play through your speakers.
    </Step>

</Steps>



# Create speech

POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}
Content-Type: application/json

Converts text into speech using a voice of your choice and returns audio.

Reference: https://elevenlabs.io/docs/api-reference/text-to-speech/convert

## OpenAPI Specification

```yaml
openapi: 3.1.1
info:
  title: Create speech
  version: endpoint_textToSpeech.convert
paths:
  /v1/text-to-speech/{voice_id}:
    post:
      operationId: convert
      summary: Create speech
      description: >-
        Converts text into speech using a voice of your choice and returns
        audio.
      tags:
        - - subpackage_textToSpeech
      parameters:
        - name: voice_id
          in: path
          description: >-
            ID of the voice to be used. Use the [Get
            voices](/docs/api-reference/voices/search) endpoint list all the
            available voices.
          required: true
          schema:
            type: string
        - name: enable_logging
          in: query
          description: >-
            When enable_logging is set to false zero retention mode will be used
            for the request. This will mean history features are unavailable for
            this request, including request stitching. Zero retention mode may
            only be used by enterprise customers.
          required: false
          schema:
            type: boolean
            default: true
        - name: optimize_streaming_latency
          in: query
          description: >
            You can turn on latency optimizations at some cost of quality. The
            best possible final latency varies by model. Possible values:

            0 - default mode (no latency optimizations)

            1 - normal latency optimizations (about 50% of possible latency
            improvement of option 3)

            2 - strong latency optimizations (about 75% of possible latency
            improvement of option 3)

            3 - max latency optimizations

            4 - max latency optimizations, but also with text normalizer turned
            off for even more latency savings (best latency, but can
            mispronounce eg numbers and dates).


            Defaults to None.
          required: false
          schema:
            type:
              - integer
              - 'null'
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
            $ref: >-
              #/components/schemas/V1TextToSpeechVoiceIdPostParametersOutputFormat
        - name: xi-api-key
          in: header
          required: true
          schema:
            type: string
      responses:
        '200':
          description: The generated audio file
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
              $ref: '#/components/schemas/Body_text_to_speech_full'
components:
  schemas:
    V1TextToSpeechVoiceIdPostParametersOutputFormat:
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
      default: mp3_44100_128
    VoiceSettingsResponseModel:
      type: object
      properties:
        stability:
          type:
            - number
            - 'null'
          format: double
          default: 0.5
          description: >-
            Determines how stable the voice is and the randomness between each
            generation. Lower values introduce broader emotional range for the
            voice. Higher values can result in a monotonous voice with limited
            emotion.
        use_speaker_boost:
          type:
            - boolean
            - 'null'
          default: true
          description: >-
            This setting boosts the similarity to the original speaker. Using
            this setting requires a slightly higher computational load, which in
            turn increases latency.
        similarity_boost:
          type:
            - number
            - 'null'
          format: double
          default: 0.75
          description: >-
            Determines how closely the AI should adhere to the original voice
            when attempting to replicate it.
        style:
          type:
            - number
            - 'null'
          format: double
          default: 0
          description: >-
            Determines the style exaggeration of the voice. This setting
            attempts to amplify the style of the original speaker. It does
            consume additional computational resources and might increase
            latency if set to anything other than 0.
        speed:
          type:
            - number
            - 'null'
          format: double
          default: 1
          description: >-
            Adjusts the speed of the voice. A value of 1.0 is the default speed,
            while values less than 1.0 slow down the speech, and values greater
            than 1.0 speed it up.
    PronunciationDictionaryVersionLocatorRequestModel:
      type: object
      properties:
        pronunciation_dictionary_id:
          type: string
          description: The ID of the pronunciation dictionary.
        version_id:
          type:
            - string
            - 'null'
          description: >-
            The ID of the version of the pronunciation dictionary. If not
            provided, the latest version will be used.
      required:
        - pronunciation_dictionary_id
    BodyTextToSpeechFullApplyTextNormalization:
      type: string
      enum:
        - value: auto
        - value: 'on'
        - value: 'off'
      default: auto
    Body_text_to_speech_full:
      type: object
      properties:
        text:
          type: string
          description: The text that will get converted into speech.
        model_id:
          type: string
          default: eleven_multilingual_v2
          description: >-
            Identifier of the model that will be used, you can query them using
            GET /v1/models. The model needs to have support for text to speech,
            you can check this using the can_do_text_to_speech property.
        language_code:
          type:
            - string
            - 'null'
          description: >-
            Language code (ISO 639-1) used to enforce a language for the model
            and text normalization. If the model does not support provided
            language code, an error will be returned.
        voice_settings:
          oneOf:
            - $ref: '#/components/schemas/VoiceSettingsResponseModel'
            - type: 'null'
          description: >-
            Voice settings overriding stored settings for the given voice. They
            are applied only on the given request.
        pronunciation_dictionary_locators:
          type:
            - array
            - 'null'
          items:
            $ref: >-
              #/components/schemas/PronunciationDictionaryVersionLocatorRequestModel
          description: >-
            A list of pronunciation dictionary locators (id, version_id) to be
            applied to the text. They will be applied in order. You may have up
            to 3 locators per request
        seed:
          type:
            - integer
            - 'null'
          description: >-
            If specified, our system will make a best effort to sample
            deterministically, such that repeated requests with the same seed
            and parameters should return the same result. Determinism is not
            guaranteed. Must be integer between 0 and 4294967295.
        previous_text:
          type:
            - string
            - 'null'
          description: >-
            The text that came before the text of the current request. Can be
            used to improve the speech's continuity when concatenating together
            multiple generations or to influence the speech's continuity in the
            current generation.
        next_text:
          type:
            - string
            - 'null'
          description: >-
            The text that comes after the text of the current request. Can be
            used to improve the speech's continuity when concatenating together
            multiple generations or to influence the speech's continuity in the
            current generation.
        previous_request_ids:
          type:
            - array
            - 'null'
          items:
            type: string
          description: >-
            A list of request_id of the samples that were generated before this
            generation. Can be used to improve the speech's continuity when
            splitting up a large task into multiple requests. The results will
            be best when the same model is used across the generations. In case
            both previous_text and previous_request_ids is send, previous_text
            will be ignored. A maximum of 3 request_ids can be send.
        next_request_ids:
          type:
            - array
            - 'null'
          items:
            type: string
          description: >-
            A list of request_id of the samples that come after this generation.
            next_request_ids is especially useful for maintaining the speech's
            continuity when regenerating a sample that has had some audio
            quality issues. For example, if you have generated 3 speech clips,
            and you want to improve clip 2, passing the request id of clip 3 as
            a next_request_id (and that of clip 1 as a previous_request_id) will
            help maintain natural flow in the combined speech. The results will
            be best when the same model is used across the generations. In case
            both next_text and next_request_ids is send, next_text will be
            ignored. A maximum of 3 request_ids can be send.
        use_pvc_as_ivc:
          type: boolean
          default: false
          description: >-
            If true, we won't use PVC version of the voice for the generation
            but the IVC version. This is a temporary workaround for higher
            latency in PVC versions.
        apply_text_normalization:
          $ref: '#/components/schemas/BodyTextToSpeechFullApplyTextNormalization'
          description: >-
            This parameter controls text normalization with three modes: 'auto',
            'on', and 'off'. When set to 'auto', the system will automatically
            decide whether to apply text normalization (e.g., spelling out
            numbers). With 'on', text normalization will always be applied,
            while with 'off', it will be skipped.
        apply_language_text_normalization:
          type: boolean
          default: false
          description: >-
            This parameter controls language text normalization. This helps with
            proper pronunciation of text in some supported languages. WARNING:
            This parameter can heavily increase the latency of the request.
            Currently only supported for Japanese.
      required:
        - text

```

## SDK Code Examples

```typescript
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

async function main() {
    const client = new ElevenLabsClient({
        environment: "https://api.elevenlabs.io",
    });
    await client.textToSpeech.convert("JBFqnCBsd6RMkjVDRZzb", {
        outputFormat: "mp3_44100_128",
        text: "The first move is what sets everything in motion.",
        modelId: "eleven_multilingual_v2",
    });
}
main();

```
