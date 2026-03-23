# How to determine Size, AspectRatio and Resolution

Currently various different image and video generation models use different combinations of Size, AspectRatio and Resolution to determine the resolution and aspect ratio of the generated image and video. Since our tool uses a variety of models, this creates a lot of ambiguity for the users and also cause models to fail or generate the wrong image or videos. 

Renku Inputs will support one standard system canonical property called Resolution. This will be the canonical property that will be mapped to the models from the different properties using transformers. 

We will also introduce a type that is called Resolution. The canonical property Resolution will be of type Resolution. Any other input property can be defined as a user defined property of type Resolution and will have the same UI rendering, validation, and transformation properties to models. 

## Resolution type 
Properties of this type (including the system canonical Resolution property) have this schema shape. It is an explicit width & height.  

### Persistence
The values are persisted in width & height in the inputs.yaml file for the build.

### UI
The viewer UI (for the inputs panel) will provide this:

- We will expose this in this way: (see the screenshot for the wireframe of the UI)
  - On the left is a drop-down that lets the user pick a user friendly description of aspect ratio: The values are:
    - Custom, Default, Square, Portrait(3:4), Portrait(9:16), Landscape(4:3), Landscape(16:9), Widescreen(21:9)
  - On the right is width and height. They change, as the user alters the left aspect ratio to adjust. User can type in a value but also can use a drop down to select from common values (for the height). These values correspond to the classic XXXp definitions: 240, 360, 480, 720, 1080, 1440, 2160. 
    - When a user selects square we should use the square equivalent based on this mapping (if height is) by default. (But the user can override by typing in another value. E.g. user can type in 512 for width and 512 for height and it is also a square)
      - 240 -> 320
      - 360 -> 480
      - 480 -> 640
      - 720 -> 960
      - 1080 -> 1440
      - 1440 -> 1920
      - 2160 -> 2180
- When the viewer reads the persisted values in width & height, it will determine the current aspect ratio enumeration from the width& height values, if not it will show custom. 

### CLI 
CLI will consume the inputs.yaml file as before. 


## How does the Resolution input value flow
There are these cases:
1) One Resolution value is consistently applied throughout all the assets (image and video). Blueprint wires them to the inputs of all producers 
  - This is the System canonical Resolution property of type Resolution.
  - Unless overriden this is connected through the blueprint producers to ensure consistency across the pipeline. But custom properties of type Resolution can override (see below case)
2) A custom Resolution value is selectively wired into some producers and some producers have inputs with specific values. Example: An image producer generates images with lower resolution or different aspect ratio because it is generating some reference images for the downstream video or image producers.
  - This can be handled by a custom blueprint defined property of type Resolution that is wired into those producers that need it. E.g. ReferenceImageResolution -> This property should still be of type "Resolution". The UI should be able to render the Resolution drop-down, validate against the values and transform into the model expected properties. 
  - This overrides the system property Resolution. 

## How do the Resolution type properties map to model/provider specific providers
We need to automatically transform the Resolution values into what provider model schemas aspect. Here are the cases:

- Schema expects "any" of an explicit size (e.g. 1024x1024) or a pre-defined enumeration
  - We should always transform into the explicit size as it is the most accurate and ignore the enumeration
- Schema expects an enumerated resolution and aspect ratio
  - We need to find an equivalent by rounding the width and height if no perfect match exists. Rounding should follow rounding down and rounding up rules in math. E.g. 
    - We have 2180x1100 -> we round down to the 1080p
    - We have 1500x1000 -> we round up to 1080p
  - We need to respect the aspect ratio. Aspect ratio wins over resolution.
- Schema expects an enumerated resolution (aspect ratio part of enumeration)

- Schema expects other property names like size



How we should handle this with one canonical Resolution:
- Keep canonical value as { width, height }.
- Track origin internally: explicit (user-entered) vs derived_from_input_image.
- At mapping edge:
  - if model supports exact dimensions -> send width/height (or equivalent object).
  - if model uses tokenized size/resolution -> map to exact token when possible.
  - if model supports custom token + width/height -> send custom + explicit dims.
  - if model supports match_input_image and origin is input-derived -> use that token.
  - if model ignores aspect/resolution when image input exists -> warn and follow model behavior.
- If no safe representation exists, fail before provider call.

1. Run full migration on catalog/models (likely dry-run first, then real write) and review diff quality.
2. Add curated override support for ambiguous models (the source: override path) in the same constraints pipeline.
3. Start catalog blueprint/producer migration away from canonical AspectRatio/Size toward Resolution projections.
