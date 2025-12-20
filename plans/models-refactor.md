I want to cleanup how we organize models. This will introduce breaking changes but no backwards compat is needed, so do not create fallbacks etc. for backwards compatibility. 

# Current Status
Currently the models are referred from the producer yaml files (e.g. @catalog/producers/image/image.yaml) 

## Redundant declarations: 
```yaml
models:
  - model: bytedance/seedream-4
    provider: replicate
    inputSchema: ./bytedance-seedream-4.json
    inputs:
      Prompt: prompt
      AspectRatio: aspect_ratio
      Size: output_size
    outputs:
      SegmentImage:
        type: image
        mimeType: image/png
```
Here the `outputs` field is redundant:
- SegmentImage is the only artefact the model produces. And this is inconsistent anyways, for example @catalog/producers/script/script.yaml file produces multiple artifacts and do not even specify it. 
- Also lock the output to only one mimetype image/png. The model can generate jpg files. This should be something with a default at the model level and then the inputs yaml can override it.

## Definining Input Schemas
The input schema should belong to the model layer and does not need to be defined in each producer, which will be repetitive. Input schema for a given model never can be changed per producer anyways and this opens up the possibility of mistaken schema definitions.
- For the LLM models, we also have output schemas and prompt files. These should be defined at the producer level, so current behavior is correct. The LLM producers will need to define different prompts and output schemas for each use case. (or for text output only, no output schema is defined.)

# Desired Changes
- NOTE: I did the changes in the YAML files, but we need to adjust the code that consumes those.
- Producers should have lean and only necessary model descriptions in their YAML files, with no duplication:
```yaml
models:
  - model: bytedance/seedream-4
    provider: replicate
    inputs:
      Prompt: prompt
      AspectRatio: aspect_ratio
      Size: output_size
``` 
In this case, model and provider specify which to potentially use and how to map the inputs to the model required (input schema) fields. `outputs` and `inputSchema` are no longer part of this definition and should be removed.
- For LLM schemas, 
```yaml
models: 
  - provider: openai
    model: gpt-5-mini
    promptFile: ./script.toml
    outputSchema: ./script-output.json
    config:
      text_format: json_schema
```
In this case, the promptFile and outputSchema are important parts of the declaration that is per producer level. And also per producer level we have the `config` which specifies "producer hard-coded" settings for that model. `config` can also be used for media producers, though we don't have examples of that.
- We will move the input schema json files in the @catalog/models folder, they should not be in the producer folders as they are now. Also we want to have a consistent naming convention for these files.
For example for the below @catalog/models/fal-ai.yaml file:
```yaml
  - name: bytedance/seedream/v4.5/text-to-image
    type: image
    mime: 
      - image/png
    price:
      function: costByImage
      pricePerImage: 0.04
```
The schema JSON file is under: @catalog/models/fal-ai/image/bytedance-seedream-v4-5-text-to-image.json
  - We group schema files under {{ProviderName}}/{{MediaShortDescription}}/ 
    - MediaShortDescription map to the "type" field in the model description.
  - We convert all the . and / to - and create a filename that otherwise fully matches the model name.
  - We should use this by convention, rather than repeating file name in the model description.
  - While loading the model files if the file is not found, we should throw and error and ask the user to fix it.
- We also moved the model description files under the @catalog/models/{{ProviderName}} folder. (E.g. catalog/models/fal-ai/fal-ai.yaml)
- There is an optional `inputSchema` field that overrides the automatic naming of input schemas. For example:
```yaml
models:
  - name: gpt-5-mini
    type: text
    inputSchema: ./llm/openai.json
    mime:
      - text/plain
      - application/json
    price: 0
```
  - In this case we are using the inputSchema field to override the automatic naming of input schemas.

## Other Changes
- New cost calculations: (We need to add these to our cost-functions)
  - costByCharacters This is used in the fal-ai.yaml file.
  - costByAudioSeconds This is used in the fal-ai.yaml file.
  - costByImageSizeAndQuality This is used in the fal-ai.yaml file.
  - costByVideoDurationAndResolution This is used in the fal-ai.yaml file. The calculation is (height * width * duration * fps) / 1024 In the case of the bytedance/seedance/v1/pro/fast/text-to-video model, fps is fixed at 30. You need to do the calculation from resolution and aspect ratio the width and height. Test Case: Each 1080p 5 second video costs roughly $0.245
- Some costs are by run, but we have different function names, we should all consolidate them to `costByRun` function, which is a fixed cost per run
  - costByImage, costByAudioFile, 
  - Also renamed the price fields to a uniform `price` instead of `pricePerImage` etc.
- Fal.ai has a bit more complex schemas (See catalog/models/fal-ai/audio/minimax-speech-02-hd.json for an example) which references other parts. We need to handle this. The references in the example schema also needs to be fixed as it was copied pasted from another file.
- Also we should hormonize the definitions for the internal renku models. You can see the proposal here: @catalog/models/renku/renku.yaml and the folders under @catalog/models/renku 
  - Followed the same pattern of naming and declaration.
  - Included missing Schema JSON files

