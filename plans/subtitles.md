I added a new model for fal-ai only which does speech to text (json output) @catalog/models/fal-ai/json/elevenlabs-speech-to-text.json First time I introduced a json type here in the asset producers. 

I want to add rich (Karoeke style) subtitle support to ffmpeg exporter. The exporter should be able to support a multitude of model/providers to convert audio(speech) to text with word level timestamps. Currently we only have the fal-ai model available (we may add other providers in the future). Also I want to be able to reuse most of the fal-ai model calls etc. as they are also handling the dry-run (simulation mode) very well, so I don't want to create an entirely new codebase to call those APIs, it should be a clean, reusable solution while not too complex.

The exporter should have additional config options:
- subtitles (true/false)
- font (it checks if the font is installed on the system, otherwise gives an error and lists other alternatives)
- font size
- color and highlight color (to highlight the currently spoken word)

When calling the Speech-to-text model, the audio needs to be extracted and uploaded to S3 (as is the already implemented case anyways but check, also remember we use FlyStorage as the abstraction for filesystem and Cloud storage but all of this already implemented so do not re-invent the wheel)

This does not follow our current mechanism for specifying models in the inputs YAML file though which is the challenging bit. Because the for the exporter we have a Renku model but yet for the Speech-to-Text we will be using another model/provider. So propose me some options how to configure this without creating too much complexity and divergence.