# Build System for Generating Short Movies

## Broad Context
This core library is a build system that allows users the specify a query (e.g. "Tell me about the Civil War") together with some configurations and the AI goes ahead, does a research, creates a script and creates all the necessary assets like images, videos, narration audio, background music etc. to create a timeline for a video presentation. The timeline will then be fed into a Remotion video to generate a full video presentation. 

The library will expose an API that will be used both from a locally running CLI and also from a cloud hosted system. The API will be asking for a generation or regeneration of a movie (using the timeline which is fed into Remotion along with links to the artefacts generated.) The storage here is intended for a single movie but will include all the metadata and revision information needed. Some important points:
- For the first generation: The API will accept a user inquiry prompt ("I want to learn about Civil War"), default configurations and user specified overrides. 
    - The outputs will be the generated timeline with links to assets, the generated prompts, error states (if there are errors)
- For the subsequent revision requests, so the API will accept the necessary parameters. 
    - It may be that the full generation did not end up generating all required artefacts and the movie timeline, so the user can change some of the configurations or simply retry.
    - User may change some of the generated prompts and retry the generation. Or chaneg some of the configurations (e.g. use different voice)

We expect multiple regenerations of the movie as the users try, tweak or error, so the revisions may grow in median case to 5-10 revision and in 90 percentile up to 20-30. This is intended for generating somewhat short movies (at least in the short term) due to the cost of generation of all artefacts via AI models. The duration will be initially capped to 5min, max 30 segments of 10s each. And the number of images per segment will be capped to 5. So at max we will be generating 150 images.

## Generation Graph Diagram
This diagram attempts to explain the data flow of the video timeline generation. 

- *Configuration & User Input*: (*InputSource*) These are denoted by rectangles and one diamond shape with a red background, where the user creates the initial input through configuration settings (e.g. edit-configuration) or editing prompts directly in the UI or by using the CLI.
    - The diamond shaped *UseVideo* and *IsImageToVideo* is a special one that instructs conditional generation (video or image based timeline)
    - If there is denotion on the top right corner (e.g. n, m, (n+m)), those show the cardinality of those. I.e. User Modified Script with n -> there may be n instances of those.
    - These are the user specified configurations or user editable (when editing a generated part of the overall video) fields.
        - *InquiryPrompt*: The user prompt that starts the overal video lecture generation
        - *Duration*: The user configured duration of the video. Number of segments(n) are deduced from this, as each segment is 10s long. The duration can only be multiples of 10s up to 3 minutes (in this initial MVP)
        - *Audience*: An enumerated list of intended audience for the video. This changes the tone, difficulty and depth of the script. 
        - *Language*: The language to use for generating the content, it is an enumerated list of languages
        - *MusicPromptInput*: User modified music prompt. User can edit the auto generated music generation prompt in the UI.
        - *SegmentNarrationInput*: User modified narration script for the segment. 
        - *VoiceId*: The voiceId that defines the voice to use to narrate the segment. Depends on the audio generation model.
        - *Emotion*: (Optional) emotion description that helps set the tone of the narration. Depends on the audio generation model.
        - *UseVideo*: (Default is False) an overall video level flag that instructs whether to use video or images (using KenBurns or similar effects) in each segment. This cannot be changed per segment (currently)
        - *ImagesPerSegment*: The number of images to generate per segment
        - *SegmentImagePromptInput*: User modified segment image prompt, if the user choose the modify to auto generated prompt.
        - *ImageStyle*: Enumerated list of image styles to set the style of image to be generated.
        - *Size*: Enumerated list of the size of image (or video) to be generated. This depends on the models.
        - *AspectRatio*: Enumerated list of aspect ratios for the image (or video) to be generated. This depends on the models.
        - *IsImageToVideo*: A flag to use image to video vs. text to video for video generation. (currently not implemented)
        - *StartingImagePromptInput*: User modified starting image prompt for the video in the segment.
        - *MovieDirectionPromptInput*: User modified movie direction prompt for the video in the segment.
        - *AssemblyStrategy*: An enumerated list of assembly strategy for segments that gets fed into the timeline assembler. Does not have any impact in the generations only impacts timeline assembly at the end.
- *Text or Assets Generated*: (*Artifact*) These are denoted by rectangles with blue background and are generated through the process. When the flow is first run, they don't exist. In subsequent runs new versions are generated replacing the older ones.
    - If there is denotion on the top right corner denoted by n, m, (n+m), that shows the cardinality. If there is nothing denoted, then cardinality is 1. E.g. SegmentNarration with n -> there are n instances of those. (n: # of segments in video, m: # of images per segment)
    - These are the assets we generate:
        - *SegmentNarration*: Contains the text of the script to be narrated per segment (n)
        - *MovieSummary*: Contains the summary of the script. (1)
        - *MovieTitle*: Contains the title of the script. (1)
        - *MusicPrompt*: Contains the text prompt for generating music. (1)
        - *MusicTrack*: The music asset (mp3) for the whole video. (1)
        - *SegmentAudio*: The narration audio asset (mp3). (n)
        - *SegmentImagePrompt*: Contains the prompt to generate segment images. (n*m)
        - *SegmentImage*: The image asset. (n*m)
        - *StartingImagePrompt*: Contains the prompt to generate starting images for the video in a segment. (n)
        - *TextToMovieDirectionPrompt*: Contains the prompt for generating the video using text only. (n)
        - *ImageToMovieDirectionPrompt*: Contains the prompt for generating the video using both image and text. (n)
        - *StartingImage*: The image asset used as an input to generate video in a segment. (n)
        - *SegmentVideo*: The video asset in a segment. (n)
- *Producers*: (*Producer*) These are denoted by circles with a green background. They are external API calls to LLMs, or model (audio, video, music etc.) generators to generate text or other asset types. 
    - The incoming arrows show the input for those generators and they represent their dependencies. I.e. if any of the incoming sources change (e.g. user changing a setting or prompt, or a generated asset changing because of an upstream generator) then they need to regenerate the text or assets.
    - We denote the number of executions (i.e. calls to these API providers to generate) as 1, n, m execution. Since these generations take multiple minutes or more time, it is important to be able to concurrently send those requests. But at the same time, if we send too many requests than we run the risk of being rate limited (Also the classic n+1 queries problem, but in these case 1 user request causing n+1 -- even more requests to API providers downstream)
    - These are the current generators (Producers) we have: (n: # of segments in video, m: # of images per segment)
        - *ScriptProducer*: LLM call that generates the full text script of the video in n segments. (1 call generates n text scripts, summary and title)
        - *TextToMusicPromptProducer*: LLM call that generates a music generation prompt. (1 call to the model )
        - *MusicProducer*: Music generation model call that takes the prompt and generates music -- background score. (1 call to the model)
        - *AudioProducer*: Voice audio generation model call that takes the script (for a given segment out of n) and produces an audio narration. (n calls to the model) 
        - *TextToImagePromptProducer*: LLM call that generates a prompt for the image. (n calls to the model each generating m prompts for a total of (n*m))
        - *TextToImageProducer*: Image generation model call that takes the image prompt and generates image. (n*m calls to the model)
        - *TextToVideoPromptProducer*: LLM call that generates a prompt generating video from text only. (n calls to the model)
        - *ImageToVideoPromptProducer*: LLM call to generate a movie direction prompt and a prompt for a starting image. (n calls to the model)
        - StartingImageProducer (*TextToImageProducer*): Image generation model call that takes image prompt and generates the starting image. This image is only used as an input to the ImageToVideoProducer. (n calls to the model)
        - *TextToVideoProducer*: Video generation model call to generate video from text. (n calls to the model)
        - *ImageToVideoProducer*: Video generation model call to generate video from an image and text. (n calls to the model)
- Types of Generation: These are denoted by not-filled rectangles surrounding the related nodes. The represent a logical grouping types of asset generation for the timeline.
    - There are 5 of them. From left to right: 
        - *MusicGeneration*
        - *AudioNarrationGeneration* 
        - *ImageGeneration*
        - *VideoFromTextGeneration*
        - *VideoFromImageGeneration*
    - These finally make up all the tracks and clips in those tracks in the timeline
- Timeline Assembler: Denoted by a yellow background rectangle. Takes all the generations and creates a stitched timeline with tracks to be fed into remotion to play or render.

## Other observations:
- This is a directed acyclic graph composed of edges (arrows) that connects InputSources and Artifacts to Producers.
    - Each Producer has an incoming and outgoing nodes. Incoming nodes are the dependencies of the Producer. If one of them is dirty, the Producer needs to run again and generate the outgoing nodes.
    - InputSources don't have any incoming nodes (i.e. dependencies). They are edited by the users.
    - Artifacts always have an incoming node, which always is a Producer. The Artifacts are generated by Producers. 
    - The nodes are shown as single rectangles, circles on the diagram but they have a cardinality number on their left corner which shows the actual numbes of instance of each node. (For Artifacts they are identified as "x executions" where x = 1, n, (n*m) etc.)
    - Here is how you can use cardinality numbers to expand the diagram to the actual number of nodes and edges: 
        - If the cardinality of the incoming node is 1, and the cardinality of the outgoing node is also 1, then it is equivalent to 1 node connected to another with 1 edge. (e.g. MusicPrompt -> MusicProducer -> MusicTrack)
        - If the cardinality of the incoming node is 1, and the cardinality of the outgoing node is n, then it means that the incoming node is fanning out to n nodes through n edges. (e.g. User Prompt ->LLM (ScriptProducer) -(n)-> SegmentNarration1, SegmentNarration2 ...)
        - If the cardinality of the incoming node is n, and the cardinality of the outgoing node is n, then it means that there are n nodes connecting to n other nodes through n edges with a matching index. (E.g. StartingImagePrompt1 -> TextToImageProducer1, StartingImagePrompt2 -> TextToImageProducer2, ... )
        - If the cardinality of the incoming node is n, and the cardinality of the outgoing node is 1, then it means that the incomings nodes are fanning in to 1 node as their n dependency nodes. Currently there is no example of such node.
- IMPORTANT SIMPLIFICATION:
    - InputSources do not actually have to be in the fully expanded final tree, since they are not generated and always user specified. They can only be annotations to the Producer nodes as dependencies. This simplifies the tree and dependency management significantly.
    - If a Producer node is creating 2 or more different types of Artifacts but in a single pass (and usually in reality this will be one asset of JSON type), then we can special case this as follows:
        - ScriptProducer creating MovieSummary, MovieTitle and SegmentNarration(n) - 3 types of assets.
- Producer nodes correspond to the place where we gather the incoming node data and feed that into the API call for the LLM or the Asset Gen Model. And we decide if a Producer needs run, by looking at their incoming nodes and see if any of them are dirty (i.e. changed). If so then the Producer needs to run. 
- For the 5 different types of generation:
    - MusicGeneration: 1 + 1 calls. Two stages LLM -> MusicProducer
    - AudioNarrationGeneration: n calls. One stage AudioProducer. All parallelizable 
    - ImageGeneration: n + (n x m) calls. Two stages LLM -> TextToImageProducer. First n parallelizable then (n x m) parallelizable
    - VideoFromTextGeneration: n + n calls. Two stages LLM -> TextToVideoProducer. All stages n parallelizable, waiting on previous stage.
    - VideoFromImageGeneration: n + n + n calls. Three stages LLM -> TextToImageProducer -> ImageToVideoProducer. All stages n parallelizable, waiting on previous stage.
- Latency: (made up numbers for illustration)
    - Median
        - ScriptProducer = 50s
        - TextToMusicPromptGen = 5s
        - MusicProducer = 10s
        - AudioProducer = 10s
        - TextToImagePromptProducer = 5s
        - TextToImageProducer = 30s
        - TextToVideoPromptProducer = 5s
        - TextToVideoProducer = 90s
        - ImageToVideoPromptProducer = 5s
        - StartingImageProducer = 30s
        - ImageToVideoProducer = 120s
- Latency Formula: (max parallization) 
    - MusicGeneration = TextToMusicPromptGen + MusicProducer
    - AudioNarrationGeneration = AudioProducer (all parallelizable)
    - ImageGeneration = TextToImagePromptProducer + TextToImageProducer
    - VideoFromTextGeneration = TextToVideoPromptProducer + TextToVideoProducer
    - VideoFromImageGeneration = ImageToVideoPromptProducer +  StartingImageProducer + ImageToVideoProducer
    - !UseVideo:
        - ScriptProducer + max(MusicProducer, AudioNarrationGeneration, ImageGeneration) 
    - UseVideo & !IsImageToVideo:
        - ScriptProducer + max(MusicProducer, AudioNarrationGeneration, VideoFromTextGeneration)
    - UseVideo & IsImageToVideo:
        - ScriptProducer + max(MusicProducer, AudioNarrationGeneration, VideoFromImageGeneration)
- Median Latency (if all parallel): 
    - !UseVideo: 50 + max(15, 10, 35) = 85s
    - UseVideo & !IsImageToVideo: 50 + max(15, 10, 95) = 145s
    - UseVideo & IsImageToVideo: 50 + max(15, 10, 155s) = 205s
- Inherent parallelism: Parallelism depends simply on the depth of the tree where depth is the # of Producer nodes in a given branch. 

## Generation and Regenaration Process
- We will always need a pass of the algorithm as below for preparation of jobs and then run the runner to execute them

### Blueprint Graphs
- We will create 3 blueprint subgraphs encoded in a typescript file. There is no plan for creating these blueprints using UI. 
    - *ImageOnlyGraph*: This one is for users who specify *UseVideo*=false configuration, which generates a movie with image only segments that are animated using traditional effects like KennBurns etc.
        - In the Graph image, this corresponds to the branch under UseVideo=no, up to the SegmentImage node, also conveniently specified within an empty rectangle (ImageGeneration)
    - *VideoByTextGraph*: This one is for user who specify *UseVideo*=true && *IsImageToVideo*=false configuration, which generates video segments but generates the video from a text only. These are faster and cheaper to generate but the starting images can not be specified.
        - In the Graph image, this corresponds to the branch under UseVideo=yes && IsImageToVideo=no, up to the SegmentVideo node, also conveniently specified within an empty rectangle (VideoFromTextGeneration)
    - *VideoByImageGraph*: This one is for users who specify *UseVideo*=true && *IsImageToVideo*=true configuration, which generates video segments from starting images and text prompts. These are slower and more expensive but has the potential to give better results.
        - In the Graph image, this corresponds to the branch under UseVideo=yes && IsImageToVideo=yes, up to the SegmentVideo node, also conveniently specified within an empty rectangle (VideoFromImageGeneration)
- We will create 2 other blueprint subgraphs:
    - *MusicGeneration* & *AudioNarrationGeneration* (again as seen in their corresponding boxes)
- There will be a final encapsulating blueprint graph that composes the above subgraphs with their names and conditions. 
- The blueprint graphs indicate the cardinalities but does not expand those as they can only be expanded when the user wants to generate the movie with their inputs (n, m, useVideo, isImageToVideo)

### What triggers a regenaration:
- This is always an explicit call by the user. But below cases may require a regeneration request by user:
    - Initial pass has some errors that were not resolved by retrying in the Workflow tool and possibly required user intervention to change prompts (4xx type errors). Or the retries did not succeed within the allowed attempts but a later try can resolve (5xx type errors)
    - User does not like some of the generations and manually edits the prompts or configurations.

### Planning Algorithm
- Planning needs to first expand the blueprint graphs according to the cardinality and conditions specified in the inputs.
    - The conditions useVideo and isImageToVideo can be specified on a per segment basis or can be globally set for the whole movie. So the expansion needs to take that into account when choosing the subgraphs to create the full expanded graph.
- We need to initalize the storage structure (folders, revisions etc.) for the movie generation 
- We will use a topological search using Kahn's algorithm to generate layers of executions queued up based on readiness of their inputs. Planning runs always before a generation and regeneration to identify which subgraphs need to be executed and produce new artifacts.

### Execution
- The plan generated (in the form of queues and lists of jobs that can be done in parallel in queues), the executor will go through the plan and start issuing requests to LLM and model providers through the adopters. 
- The artefact and all necessary metadata storage: (using FlyStorage abstraction and plugins)
    - LocalStorage Plugin: Stored locally in the machines (or sandbox) filesystem
    - S3Storage Plugin: Stored in an S3 compatible cloud store.
- Producers:
    - These are API calls to various LLM and Model providers using different models. 
    - These will be implemented in this core package and used by CL
- Execution Loop:
    - The implementation of this loop is highly dependent on whether it is happening locally on a machine or in a cloud using Vercel Workflow.
    - Rate limiting, batching/grouping of concurrent requests are also highly dependent.
    - At this point we will have 2 separate implementations in the CLI and Server packages.
    - The reusable utility calls will be implemented here.

