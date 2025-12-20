Let's create a structured documentation plan. 

# Audience:
- Users of CLI, who will use existing blueprints/producers and models. 
- Advanced users who will create new blueprints/producers and add some basic models that are available from the existing providers.
- Developers who may import new models, new provider integrations

We also have an audience which is the AI (Claude Code Skills) that will use the documentation to create:
- New producer and blueprint YAMLs
- Now how to use the CLI to issue new inquiries with inputs

# Structure
We should have the following sections:

## Introduction
- What is Renku?
  - Reliable build system (akin to software build tools), that builds the artifacts used in a longer form video composition.
  - A simple prompt to a fully build video composition
- What problems does it solve? Problems:
  - Long form video has many components (narrative audio, lipsync audio, short video segments, music, images, characters, ...) Creating these require lots of manual work going to each provider, creating prompts downloading and stitching them.
  - Specialized prompting techniques needed per model for best results, keeping them in one place and using LLMs to generate best prompts per each piece
  - Hand built scripts do not keep track of the state of the build and only build the necessary parts when a change happens -> increases costs
  - Each media generation can take significant time, there is an opportunity to parallelize the generation process for faster overall generation
  - The system is designed to be extensible, so that new models and providers can be added easily
- High level overview of the architecture and how it works
- Introduction to the important concepts: Blueprint, Producers (Prompt vs. Media producers), Model, Artifacts, Layers (for parallelism and dependencies)

## Quick Start
- Should explain how to install and get up and running with one of the existing blueprints
  - Run install (It will be in the npm under the name renku/cli) 
  - Renku init for the workspace creation
  - Setup API keys for providers
    - Replicate, mediawave, Fal-ai OpenAI.
    - Getting API Keys from each provider  (We don't need detailed instructions but just links to the provider web sites)
    - Exporting them in the shell.
  - Cd into that workspace and observe the folders (catalog, builds)
  - Use the kenn-burns template
  - Copy the input-template file to the root of the workspace for a blueprint and rename it to inputs
  - Do a dry run with some inputs
  - Run the full thing and observe the outputs


## Main Usage Flows
- Specifying the inputs in the yaml file. (E.g. plain text inputs, blob inputs via file references, ...)
- Browsing and discovering the available blueprints and producers
- Browsing the available models
- Using dry-run to ensure everything works before calling the real API endpoints
- Doing the generation (e.g. renku generate) for the first time, where to find to artifacts (e.g. movies folder with symlinks etc. in workspace)
- Editing flow
  - Changing the inputs and running generating again
  - Changing the generated prompts. Examples include using VSCode and editing the symlink artifact file with the prompt text
- Layer by layer generation - Generating up to a certain layer (useful for inspecting the outputs of prior steps before running their downstream dependencies, cost saving measure)


## CLI usage reference
- This section has all the CLI commands and the flags you can pass in. It also gives examples.
  - The existing @docs/cli-commands.md file captures this. Make sure it is up to date and consistent with the code

## Blueprint Authoring
- Blueprint authoring is a more advanced topic that requires the user to have deeper understanding the graphs, connections etc. 
- Use the @docs/comprehensive-blueprint-guide.md for the documentation
  - No changes needed, except the initial overview section is not needed. Move the architecture overview to the Introduction section above.

