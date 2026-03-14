# Landing Page 

## Sections:
### Header
- The navigation items should not be centered, they should be right-aligned to the left of the Github Icon with proper spacing.

### Hero 
This section will have the tagline and slightly longer explanation and a looped video of a highlight demo. We will have a Download action item (for MacOS only for now) 

We need to improve the copy below: Explanation is too long. Better action naming
- *Tagline* Build Tool for AI Generated Videos
- *Explanation* Go beyond the 10 seconds. Create videos using AI generative models, with automatic prompt generation, and cost effective incremental builds.
- *Action* Download For MacOS

Layout Enhancements Needed:
- The middle hero section is clearly not vertically centered. The hero section is correctly sizing to the available viewport of the browser. The vertical centering should take into account the header. 



### Features
You will need to link to 2 different images based on the current theme. They are prepended by -dark, and -light and in the web/public/features folder. For the layout of features use the Bento style. Boxes will be of different sizes and shapes based on the image aspect ratio and size. The images will be accompanied by text that explains the feature briefly. Use a heading and a short explanatory text under it.

- Blueprints
  - Two boxes represent it, side by side at the top. 
    - Display the blueprint-xxx image which is horizontal. Headline: Blueprints Text: Some texts that explains that they represent how the various stages of production come together through connection and declarations.
    - Display the blueprint-yaml image. This should be a square like box next to the previous. Headline: YAML-based Text: Some text that describes that it is easy to read, can be created using Skills in Codex, Claude etc. 
- Tweak Assets
  - Headline: Tweak 
  - Users can tweak assets, use hand-crafted prompts, edit prompts, upload their own image 
  - Use the edit-xxx image 
- Regenerate Selectively
  - Headline: Full Control
  - Users can regenerate the assets. Pinning them prevents some assets being regenerated, regenerate explicitly forces generation. Full manual control 
  - Use the pin-regenerate-xxx image
- Preview all assets
  - Headline: Rich Previews
  - Users can preview all assets generated, they can play back audio/video, see images 
  - Use the rich-previews-xxx image
- Generate subtitles
  - Headline: Karaoke Subtitles
  - Users can configure rich karaoke style subtitles that highlight as the narration goes on.
  - Use subtitles-xxx image
- Preview movies
  - Headline: Preview movies
  - Users can preview and playback the movies, see the subtitles generated
  - Use play-xxx image
- Timeline
  - Headline: Multi-track timeline
  - Users can inspect the multitrack timeline, scrub and interact.
  - Use timeline-xxx.image
- Run Plan
  - Headline: View Build Plan
  - Users can view the build plan, select up to which stage the generation should happen allowing them to first preview earlier generated assets and tweak them if necessary. They also see estimated costs per generation group
  - Use run-plan-xxx image


Layout: 
- Bento style 



### How it Works

I want you to build a section in the @web/src landing page that demonstrates how Renku works. The image gives a rough wireframe description and I am looking for an
animated illustration that looks professional and nice and uses icons, playful animations etc. I copied some SVG logos for the provides that you can use @web/public/ I
want something with vibrant colors like the example animation screenshot I posted, but also the overall background should fit the theme of the page (light and dark) The
animation should be a live one (not a movie) Possible small interactivity to make it more playful could be welcome. In terms of what we are demonstrating 1) The
blueprint defined pipeline 2) Users can create simple prompts then the producers turn that into a storyboard, enhanced prompts for asset generation 3) Then those are
sent for asset generation and then finally stitched together to build a movie with background music, narration, video snippets etc. 4) It is much easier than doing this
by hand and going to each provider and copy paste stuff around 5) The system also allows for retries, generating only parts and leaving the rest (surgical generations),
keeping track of errors -> This should be demonstrated in the animation like an error happening and retry etc. The animation should essentially loop showing a pipeline
of generation, occasionally failing but regenerating the failed ones and continuing and also user occasionally editing and substituting assets. The section also
highlight these phases with text under the animated section as the things move along.

Actually the pipeline is factually incorrect. The last stage is not asset generation it is still calling the Fal and Replicate API and feeding in the intermediate
assets generated. The final asset generation is the timeline composer, which stitches those to a timeline. That does not call into an external provider like others. I
gave 3 boxes just to illustrate and you literally used 3 boxes and missed the whole point behind multiple stages connected together consuming assets generated from the
prior. Also there is no asset flow. You are only highlighting the producer boxes. When I look at it I just see some boxes lighting up, no idea what is really happening.
Like in the screenshots how assets flow along the lines, they are colorful shows that things are moving not just lighting up. A prompt flows in, sent to OpenAI comes
back as a story prompt than that flows into the next stage goes to Fal.ai and comes back as an image. Image flows in to a video producer sent to Fal.ai again and comes
back as a video. The timeline composer collects and stitches them and generates the stitched video at the end. We need to demonstrate that flow. And then demonstrate for
 example fal.ai failing and then being retried to generate again. And another one a user (icon perhaps) not liking the image and regenerating. Without regenerating the
uneffected assets. This is what we are trying to convey. Now come up with a plan to redo this. Do not take those images I gave you as literally the same, they just help
me demonstrate the concept. You should create your own I added the flow diagram again to take a look but it is not just those 3 boxes ok.

Build a section in the @web/src landing page that demonstrates how Renku works. The image gives a rough wireframe description and I am looking for an animated illustration that looks professional and nice and uses icons, playful animations etc. I copied some SVG logos for the provides that you can use @web/public/ I want something with vibrant colors like the example animation screenshot I posted, but also the overall background should fit the theme of the page (light and dark). 

What we want to demonstrate:
- The blueprint defined pipeline. Take this example: StoryboardProducer -> CharacterImageProducer & AudioProducer -> VideoProducer -> TimelineProducer 
  - Storyboard creates the overall story from a simple user prompt. It also produces the prompts that will be fed into the asset producers (image/video) downstream so they use best prompt practices and enhanced. It takes into account other user inputs like aspect ratio, voice id etc.
  - CharacterImageProducer creates images for the characters in the story based on the prompt created by the previous StoryBoard. This will be used as an input image downstream
  - AudioProducer creates audio narration for each segment of the video this will be used as a narration track downstream by TimelineComposer
  - VideoProducer takes in a VideoPrompt (from StoryBoard producer) and input character images. This is for character consistency and creates a segment of the video. Many s

Example flow:
- 

### FAQ