---
name: generate-skill
description: This skill uses the Renku CLI to generate video compositions given an inquiry prompt. It can generate all the media files required for the composition and stitches them into a final video. 
---

# Overview
This skill is designed to generate video compositions given an inquiry prompt. It can generate all the media files, required for the composition and composes them into a final video. There are various blueprints (which are workflows connecting producers in a dependency graph) that can be used to generate the final video composition.

# Usage
Generating a video costs quite a lot, so users should be in the loop for approval. When a user wants to generate a video or do subsequent edits on it, they should know the estimated cost of the video and be sure that they have specified it as correctly as possible. 

## Initiate the Workspace
Renku requires an initialization, which sets up a folder where all the builds and outputs are stored. This is stored in the .config/renku folder of the user's home folder. So always first check if that folder exists and has the config file cli-config.json setup. If not then use the below command to set it up:

```bash
renku init --root=~/claude-renku
```
This sets up claude-renku as the root folder of all movie generation. Tell the user that path, so they can go and check it out.

**IMPORTANT** Never initialize if the .config/renku/cli-config.json already exists.

## Generating a new video
When generating a new video from scratch, user might be in 2 frames of mind (or experience level):

- **Beginner**: The user is new to the platform, and they want to quickly generate a video without any prior knowledge. They will generally be starting with a high level goal and a basic idea of what they want to achieve. E.g. "I want to create a video about the history of the Roman Empire. It should be 30 seconds long and use Kenn Burns style image transitions with audio narrative and background music."
- **Advanced**: The user is familiar with the platform and can provide detailed instructions. The user will specify a blueprint file (either by vague name or by actual link to the yaml file) and a link to the inputs yaml file.

For **Beginner** users or inquiries, follow the below process:

- Ensure you have the right information from the user and if not ask clarifying questions:
  - There should be clear inquiry prompt. E.g. "I want to create a video about the history of the Roman Empire. It should be 30 seconds long and use Kenn Burns style image transitions with audio narrative and background music."
  - The user must specify the length of the video.
- Using the above basic information, search the catalog for the blueprint that best fits the user's needs. The catalog location is in the `.config/renku/cli-config.json` and the blueprints are stored in the `blueprints` folder. Here are some tips to help in the selection.
  - Is the video going to be composed of images animated using effects like Kenn Burns style image transitions or is it going to be stitching together smaller video clips? If not clear, make best guesses for the type of video the user wants to generate.
  - Is the video going to be a single take continuous movie or is it going to have multiple segments of clips over a span of time?
- In the same folder as the blueprint, you will find an inputs template `inputs-template.yaml`. These list all the relevant information to generate the video using the blueprint. There are some default values on that and that can be used as a starting point. Make a copy of this template and rename it with a name in kebab-case that reflects the inquiry using only 3-5 words. (e.g. `history-of-roman-empire.yaml`)
- You will need to pick the models from a catalog of models the producers can use. To see the choices, you can run the following:

```bash
renku producers-list --blueprint=<Path to the blueprint file>
```
  - You will see the prices for each model and the different options. Select models mostly on the price unless the user specified it in the inquiry prompt.
  - You need to edit the inputs yaml file with these new model selections.
- Now you should run the below command and make sure that it is going to run with those inputs.
```bash
renku generate --blueprint=<Path to the blueprint file> --inputs=<Path to the inputs yaml file> --dry-run
```
  - If you see errors in the dry run, read those errors and see if they are fixable by adjusting the inputs. If not, you should tell the user that there is an incompatibility with the available blueprints and inputs. 
- Once the dry-run is correct, you should now run the below command to estimate the costs:
```bash
renku generate --blueprint=<Path to the blueprint file> --inputs=<Path to the inputs yaml file> --costs-only
```
  - **VERY IMPORTANT** Always present the costs to the user and ask if they are okay with the costs before running the full generation. 
- If the user is okay with the costs, you can run the full generation by running the below command:
```bash
renku generate --blueprint=<Path to the blueprint file> --inputs=<Path to the inputs yaml file> --non-interactive
```
- Once the generation is complete, present the user with where they can find the generations and with the movie-id. Also launch the viewer by running this command:
```bash
renku viewer:view --last
```

For **Advanced** users or inquiries, follow the below process:
- In this case the user has already provided you with the blueprint file and the inputs yaml file. So you will not need to figure these out yourself. Just use the provided files and continue the rest of the process the same way as before.

## Editing an existing generation
Once a generation is complete, users may want to iterate on that and make some changes. 
