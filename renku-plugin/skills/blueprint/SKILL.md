---
name: blueprint-skill
description: This skill can create the blueprints used by the Renku client to generate video compositions. These blueprints define the workflow to generate the media files. They have define a dependency graph of prompt producers (from an inquiry prompt), media producers and finally bringing all of them together into a timeline composition.
---

# Overview
Renku uses blueprints to define the workflow to generate the media files. Blueprints define a dependency graph of various types of producers accepting inputs and generating outputs(artifacts), where the artifacts are fed into the next producer in the graph as inputs. The blueprints are defined in a YAML file and can be executed using the Renku CLI.

# Blueprint YAML Documentation
There is a comprehensive documentation on how Blueprints work and what the YAML file should look like. 

# Create a Blueprint
Users may want to create a new blueprint. This could be a combination of creating a new producer or creating a new blueprint consisting of existing or new producers. Producers are also defined as blueprint YAML files but have a slightly simpler structure, as they only define one node (producer) with its inputs and outputs (artifacts).

## Create a Producer
Producers are defined under `catalog/producers` folder. Each creates its own folder in kebab-case names. There are currently 2 types of producers, the users can define:
- Prompt producers: These use an LLM to generate prompts that will be used as input prompts to the media producers. They can create structured output (`json_schema`) or simple text output (`text`). With structured output, prompt producers can generate multiple prompts.  
- Media producers: These generate the media files that form the individual segments(clips) in the final video composition. They can generate video, audio, image outputs. They can take other images, audio, or video as input as well as well as text based prompts.

All available models are listed in the `catalog/models` folder. They are organized by the name of the model provider. We currently support replicate, fal-ai and mediawave-ai as the 3 model providers for media producers and openai as the model provider for prompt producers.





