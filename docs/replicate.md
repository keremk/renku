# Replicate SDK Samples
- SDK already installed
```bash
pnpm add replicate
```

## Client Setup
```js
import Replicate from "replicate";
import fs from "node:fs";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN,
});
```

## API Usage
- Sample API usage for a video model, others similar
```js
const input = {
  fps: 24,
  image: "https://replicate.delivery/pbxt/NwRbjj1ioMkKuMv81xtRn7qVVoCt1E5RvCQt0PVBaoMEHztB/86bd15b6-63fa-4a9d-a54c-de4d694a509a.jpg",
  prompt: "The coffee is piping hot, outside it starts to snow and accumulate on the trees",
  duration: 5,
  resolution: "1080p",
  aspect_ratio: "3:4",
  camera_fixed: false
};

const output = await replicate.run("bytedance/seedance-1-pro-fast", { input });

// To access the file URL:
console.log(output.url()); //=> "http://example.com"

// To write the file to disk:
fs.writeFile("my-image.png", output);
```
- To cancel
```js
await replicate.predictions.cancel(prediction.id);
```

- Make sure to use the full model names like below
- Each model will have slightly different inputs

## Rate Limits
We limit the number of API requests that can be made to Replicate:

*   You can [create predictions](/docs/reference/http#create-a-prediction) at 600 requests per minute.
*   All other endpoints you can call at 3000 requests per minute.

[](#throttling)Throttling
-------------------------

You can make short bursts of requests above the default rate limits before being throttled.

As you approach running out of credit, we apply stronger rate limits. We do this to stop you from accidentally overspending and going into arrears, and to give you some time to increase your balance when it’s running low before getting shut off entirely. To avoid this, set up [credit auto-reload](/docs/topics/billing/prepaid-credit) to keep your credit balance above $20.

If you have been granted credit and don’t have a payment method on file, you’ll also be rate limited to 1 request per second with a maximum of 6 requests per minute.

[](#api-response)API response
-----------------------------

If you hit a limit, you will receive a response with status `429` with a body like:

```json
{"detail":"Request was throttled. Your rate limit resets in ~30s."}
```

[](#higher-limits)Higher limits
-------------------------------

If you want higher limits, [contact us](https://replicate.com/support).

## Secrets
Some models require sensitive information like API keys, authentication tokens, or passwords to function properly. For example, some models need a Hugging Face API key to publish trained model weights to the Hugging Face Hub, or a Weights & Biases API key to log training data for later inspection. When a model has secret inputs, you can provide them securely through Replicate’s web interface or API.

[](#what-are-secret-inputs)What are secret inputs?
--------------------------------------------------

Secret inputs are model parameters marked with the `Secret` type that contain sensitive information. These inputs are handled specially by Replicate:

*   Values are redacted in logs and prediction metadata after being sent to the model
*   The web interface shows password-style input fields for secrets
*   API responses never include the secret values

[](#providing-secrets-via-the-web-interface)Providing secrets via the web interface
-----------------------------------------------------------------------------------

When you run a model with secret inputs on replicate.com:

1.  Navigate to the model page
2.  Secret inputs will appear as password fields (showing dots instead of characters as you type)
3.  Enter your secret values and run the prediction
4.  The secret values will be redacted from the prediction details after the model receives them

[](#providing-secrets-via-the-api)Providing secrets via the API
---------------------------------------------------------------

When using the Replicate API, you should provide secrets using environment variables rather than hardcoding them. Here’s how:

```bash
# Use your secret from an environment variable
curl -X POST \
  -H "Authorization: Token $REPLICATE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "input": {
      "prompt": "Hello world",
      "api_key": "'$MODEL_API_KEY'"
    }
  }' \
  https://api.replicate.com/v1/models/owner/model-name/predictions
```

### [](#using-client-libraries)Using client libraries

**Python:**

```python
import replicate
import os
output = replicate.run(
    "owner/model-name",
    input={
        "prompt": "Hello world",
        "api_key": os.environ["MODEL_API_KEY"]
    }
)
```

**Node.js:**

```javascript
const replicate = new Replicate();
const output = await replicate.run(
    "owner/model-name",
    {
        input: {
            prompt: "Hello world",
            api_key: process.env.MODEL_API_KEY
        }
    }
);
```

[](#identifying-secret-inputs)Identifying secret inputs
-------------------------------------------------------

You can identify which inputs are secrets by looking at the model’s schema:

*   In the web interface, secret inputs appear as password fields
*   In the API, secret inputs have `"x-cog-secret": true` in their OpenAPI schema
*   The input type will be `"string"` with `"format": "password"`

[](#security-considerations)Security considerations
---------------------------------------------------

*   **Never hardcode secrets**: Always store secrets in environment variables, never commit them to version control
*   **Secrets are redacted after use**: Once the model receives your secret, it’s removed from Replicate’s systems
*   **Rotate secrets regularly**: If you suspect a secret has been compromised, rotate it immediately
*   **Trust model authors**: Only provide secrets to models from authors you trust, as they could potentially misuse them

[](#best-practices)Best practices
---------------------------------

### [](#store-secrets-securely)Store secrets securely

Instead of hardcoding secrets in your code:

```python
# Don't do this
output = replicate.run("model", input={"api_key": "sk-abc123..."})
# Do this instead
import os
output = replicate.run("model", input={"api_key": os.environ["API_KEY"]})
```

### [](#validate-secret-requirements)Validate secret requirements

Before running a model, check if it requires secrets and ensure you have them available:

```python
import replicate
# Get model information
model = replicate.models.get("owner/model-name")
schema = model.latest_version.openapi_schema
# Check for secret inputs
secret_inputs = []
for param, details in schema["components"]["schemas"]["Input"]["properties"].items():
    if details.get("x-cog-secret"):
        secret_inputs.append(param)
if secret_inputs:
    print(f"This model requires these secrets: {secret_inputs}")
```

### [](#handle-errors-gracefully)Handle errors gracefully

Models may fail if required secrets are missing or invalid:

```python
import os
try:
    output = replicate.run("model", input={"api_key": os.environ["MODEL_API_KEY"]})
except Exception as e:
    if "authentication" in str(e).lower():
        print("Invalid API key provided")
    else:
        print(f"Error: {e}")
```

[](#next-steps)Next steps
-------------------------

*   Learn how model authors implement secret inputs in the [model secrets documentation](/docs/topics/models/secrets)
*   Read about [input files](/docs/topics/predictions/input-files) for handling file uploads
*   Explore [prediction lifecycle](/docs/topics/predictions/lifecycle) to understand how predictions work

## Image Models

### bytedance/seedream-4
- *Link*: https://replicate.com/bytedance/seedream-4
- *Cost*: $0.03 per output image
- *Median*: 14.4 seconds
- *InputSchema*
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "size": {
      "enum": [
        "1K",
        "2K",
        "4K",
        "custom"
      ],
      "type": "string",
      "title": "size",
      "description": "Image resolution: 1K (1024px), 2K (2048px), 4K (4096px), or 'custom' for specific dimensions.",
      "default": "2K",
      "x-order": 2
    },
    "width": {
      "type": "integer",
      "title": "Width",
      "default": 2048,
      "maximum": 4096,
      "minimum": 1024,
      "x-order": 4,
      "description": "Custom image width (only used when size='custom'). Range: 1024-4096 pixels."
    },
    "height": {
      "type": "integer",
      "title": "Height",
      "default": 2048,
      "maximum": 4096,
      "minimum": 1024,
      "x-order": 5,
      "description": "Custom image height (only used when size='custom'). Range: 1024-4096 pixels."
    },
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "x-order": 0,
      "description": "Text prompt for image generation"
    },
    "max_images": {
      "type": "integer",
      "title": "Max Images",
      "default": 1,
      "maximum": 15,
      "minimum": 1,
      "x-order": 7,
      "description": "Maximum number of images to generate when sequential_image_generation='auto'. Range: 1-15. Total images (input + generated) cannot exceed 15."
    },
    "image_input": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri"
      },
      "title": "Image Input",
      "default": [],
      "x-order": 1,
      "description": "Input image(s) for image-to-image generation. List of 1-10 images for single or multi-reference generation."
    },
    "aspect_ratio": {
      "enum": [
        "match_input_image",
        "1:1",
        "4:3",
        "3:4",
        "16:9",
        "9:16",
        "3:2",
        "2:3",
        "21:9"
      ],
      "type": "string",
      "title": "aspect_ratio",
      "description": "Image aspect ratio. Only used when size is not 'custom'. Use 'match_input_image' to automatically match the input image's aspect ratio.",
      "default": "match_input_image",
      "x-order": 3
    },
    "enhance_prompt": {
      "type": "boolean",
      "title": "Enhance Prompt",
      "default": true,
      "x-order": 8,
      "description": "Enable prompt enhancement for higher quality results, this will take longer to generate."
    },
    "sequential_image_generation": {
      "enum": [
        "disabled",
        "auto"
      ],
      "type": "string",
      "title": "sequential_image_generation",
      "description": "Group image generation mode. 'disabled' generates a single image. 'auto' lets the model decide whether to generate multiple related images (e.g., story scenes, character variations).",
      "default": "disabled",
      "x-order": 6
    }
  }
}
```

### google/nano-banana
- *Link*: https://replicate.com/google/nano-banana
- *Cost*: $0.039 per output image
- *Median*: 10.5 seconds
- *InputSchema*:
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "x-order": 0,
      "description": "A text description of the image you want to generate"
    },
    "image_input": {
      "type": "array",
      "items": {
        "type": "string",
        "format": "uri"
      },
      "title": "Image Input",
      "default": [],
      "x-order": 1,
      "description": "Input images to transform or use as reference (supports multiple images)"
    },
    "aspect_ratio": {
      "enum": [
        "match_input_image",
        "1:1",
        "2:3",
        "3:2",
        "3:4",
        "4:3",
        "4:5",
        "5:4",
        "9:16",
        "16:9",
        "21:9"
      ],
      "type": "string",
      "title": "aspect_ratio",
      "description": "Aspect ratio of the generated image",
      "default": "match_input_image",
      "x-order": 2
    },
    "output_format": {
      "enum": [
        "jpg",
        "png"
      ],
      "type": "string",
      "title": "output_format",
      "description": "Format of the output image",
      "default": "jpg",
      "x-order": 3
    }
  }
}
```

### qwen/qwen-image
- *Link*: https://replicate.com/qwen/qwen-image
- *Cost*: 0.025 per output image
- *Median*: 3.5 seconds
- *InputSchema*:
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "seed": {
      "type": "integer",
      "title": "Seed",
      "nullable": true,
      "description": "Random seed. Set for reproducible generation"
    },
    "image": {
      "type": "string",
      "title": "Image",
      "format": "uri",
      "description": "Input image for img2img pipeline"
    },
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "description": "Prompt for generated image"
    },
    "go_fast": {
      "type": "boolean",
      "title": "Go Fast",
      "default": true,
      "description": "Run faster predictions with additional optimizations."
    },
    "guidance": {
      "type": "number",
      "title": "Guidance",
      "default": 3,
      "maximum": 10,
      "minimum": 0,
      "description": "Guidance for generated image. Lower values can give more realistic images. Good values to try are 2, 2.5, 3 and 3.5"
    },
    "strength": {
      "type": "number",
      "title": "Strength",
      "default": 0.9,
      "maximum": 1,
      "minimum": 0,
      "description": "Strength for img2img pipeline"
    },
    "image_size": {
      "enum": [
        "optimize_for_quality",
        "optimize_for_speed"
      ],
      "type": "string",
      "title": "image_size",
      "description": "Image size for the generated image",
      "default": "optimize_for_quality",
      "x-order": 11
    },
    "lora_scale": {
      "type": "number",
      "title": "Lora Scale",
      "default": 1,
      "description": "Determines how strongly the main LoRA should be applied."
    },
    "aspect_ratio": {
      "enum": [
        "1:1",
        "16:9",
        "9:16",
        "4:3",
        "3:4",
        "3:2",
        "2:3"
      ],
      "type": "string",
      "title": "aspect_ratio",
      "description": "Aspect ratio for the generated image",
      "default": "16:9",
      "x-order": 10
    },
    "lora_weights": {
      "type": "string",
      "title": "Lora Weights",
      "nullable": true,
      "description": "Load LoRA weights. Only works with text to image pipeline. Supports arbitrary .safetensors URLs, tar files, and zip files from the Internet (for example, 'https://huggingface.co/flymy-ai/qwen-image-lora/resolve/main/pytorch_lora_weights.safetensors', 'https://example.com/lora_weights.tar.gz', or 'https://example.com/lora_weights.zip')"
    },
    "output_format": {
      "enum": [
        "webp",
        "jpg",
        "png"
      ],
      "type": "string",
      "title": "output_format",
      "description": "Format of the output images",
      "default": "webp",
      "x-order": 16
    },
    "enhance_prompt": {
      "type": "boolean",
      "title": "Enhance Prompt",
      "default": false,
      "description": "Enhance the prompt with positive magic."
    },
    "output_quality": {
      "type": "integer",
      "title": "Output Quality",
      "default": 80,
      "maximum": 100,
      "minimum": 0,
      "description": "Quality when saving the output images, from 0 to 100. 100 is best quality, 0 is lowest quality. Not relevant for .png outputs"
    },
    "negative_prompt": {
      "type": "string",
      "title": "Negative Prompt",
      "default": " ",
      "description": "Negative prompt for generated image"
    },
    "extra_lora_scale": {
      "type": "string",
      "title": "Extra Lora Scale",
      "nullable": true,
      "description": "Scales for additional LoRAs as comma-separated floats (e.g., '0.5,0.7'). Must match the number of weights in extra_lora_weights."
    },
    "extra_lora_weights": {
      "type": "string",
      "title": "Extra Lora Weights",
      "nullable": true,
      "description": "Additional LoRA weights as comma-separated URLs. Same formats supported as lora_weights (e.g., 'https://huggingface.co/flymy-ai/qwen-image-lora/resolve/main/pytorch_lora_weights.safetensors,https://huggingface.co/flymy-ai/qwen-image-realism-lora/resolve/main/flymy_realism.safetensors')"
    },
    "num_inference_steps": {
      "type": "integer",
      "title": "Num Inference Steps",
      "default": 30,
      "maximum": 50,
      "minimum": 1,
      "description": "Number of denoising steps. Recommended range is 28-50, and lower number of steps produce lower quality outputs, faster."
    },
    "disable_safety_checker": {
      "type": "boolean",
      "title": "Disable Safety Checker",
      "default": false,
      "description": "Disable safety checker for generated images."
    }
  }
}
```

### openai/gpt-image-1-mini
- *Cost* ?
- *Median*: 29.1 seconds
- We need to use the OpenAI API key here:
```js
import { writeFile } from "fs/promises";
import Replicate from "replicate";
const replicate = new Replicate();

const input = {
    prompt: "A cute baby sea otter",
    openai_api_key: "[REDACTED]"
};

const output = await replicate.run("openai/gpt-image-1-mini", { input });

// To access the file URLs:
console.log(output[0].url());
//=> "https://replicate.delivery/.../output_0.webp"

// To write the files to disk:
for (const [index, item] of Object.entries(output)) {
  await writeFile(`output_${index}.webp`, item);
}
//=> output_0.webp written to disk
```
- *InputSchema*
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "openai_api_key",
    "prompt"
  ],
  "properties": {
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "x-order": 1,
      "description": "A text description of the desired image"
    },
    "quality": {
      "enum": [
        "low",
        "medium",
        "high",
        "auto"
      ],
      "type": "string",
      "title": "quality",
      "description": "The quality of the generated image",
      "default": "auto",
      "x-order": 6
    },
    "user_id": {
      "type": "string",
      "title": "User Id",
      "x-order": 11,
      "nullable": true,
      "description": "An optional unique identifier representing your end-user. This helps OpenAI monitor and detect abuse."
    },
    "background": {
      "enum": [
        "auto",
        "transparent",
        "opaque"
      ],
      "type": "string",
      "title": "background",
      "description": "Set whether the background is transparent or opaque or choose automatically",
      "default": "auto",
      "x-order": 7
    },
    "moderation": {
      "enum": [
        "auto",
        "low"
      ],
      "type": "string",
      "title": "moderation",
      "description": "Content moderation level",
      "default": "auto",
      "x-order": 10
    },
    "aspect_ratio": {
      "enum": [
        "1:1",
        "3:2",
        "2:3"
      ],
      "type": "string",
      "title": "aspect_ratio",
      "description": "The aspect ratio of the generated image",
      "default": "1:1",
      "x-order": 2
    },
    "input_images": {
      "type": "array",
      "items": {
        "type": "string",
        "anyOf": [],
        "format": "uri"
      },
      "title": "Input Images",
      "x-order": 4,
      "nullable": true,
      "description": "A list of images to use as input for the generation"
    },
    "output_format": {
      "enum": [
        "png",
        "jpeg",
        "webp"
      ],
      "type": "string",
      "title": "output_format",
      "description": "Output format",
      "default": "webp",
      "x-order": 9
    },
    "input_fidelity": {
      "enum": [
        "low",
        "high"
      ],
      "type": "string",
      "title": "input_fidelity",
      "description": "Control how much effort the model will exert to match the style and features, especially facial features, of input images",
      "default": "low",
      "x-order": 3
    },
    "openai_api_key": {
      "type": "string",
      "title": "Openai Api Key",
      "format": "password",
      "x-order": 0,
      "writeOnly": true,
      "description": "Your OpenAI API key",
      "x-cog-secret": true
    },
    "number_of_images": {
      "type": "integer",
      "title": "Number Of Images",
      "default": 1,
      "maximum": 10,
      "minimum": 1,
      "x-order": 5,
      "description": "Number of images to generate (1-10)"
    },
    "output_compression": {
      "type": "integer",
      "title": "Output Compression",
      "default": 90,
      "maximum": 100,
      "minimum": 0,
      "x-order": 8,
      "description": "Compression level (0-100%)"
    }
  }
}
```

## Video Models

### bytedance/seedance-1-lite
- *Link*: https://replicate.com/bytedance/seedance-1-lite
- *Cost*
    - *480p*: 0.018 per second of video
    - *720p*: 0.036 per second of video
    - *1080p*: 0.072 per second of video
- *Median*: 38.1 seconds
- *InputSchema*: 
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "fps": {
      "enum": [
        24
      ],
      "type": "integer",
      "title": "fps",
      "description": "Frame rate (frames per second)",
      "default": 24,
      "x-order": 7
    },
    "seed": {
      "type": "integer",
      "title": "Seed",
      "nullable": true,
      "description": "Random seed. Set for reproducible generation"
    },
    "image": {
      "type": "string",
      "title": "Image",
      "format": "uri",
      "nullable": true,
      "description": "Input image for image-to-video generation"
    },
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "description": "Text prompt for video generation"
    },
    "duration": {
      "type": "integer",
      "title": "Duration",
      "default": 5,
      "maximum": 12,
      "minimum": 2,
      "description": "Video duration in seconds"
    },
    "resolution": {
      "enum": [
        "480p",
        "720p",
        "1080p"
      ],
      "type": "string",
      "title": "resolution",
      "description": "Video resolution",
      "default": "720p",
      "x-order": 5
    },
    "aspect_ratio": {
      "enum": [
        "16:9",
        "4:3",
        "1:1",
        "3:4",
        "9:16",
        "21:9",
        "9:21"
      ],
      "type": "string",
      "title": "aspect_ratio",
      "description": "Video aspect ratio. Ignored if an image is used.",
      "default": "16:9",
      "x-order": 6
    },
    "camera_fixed": {
      "type": "boolean",
      "title": "Camera Fixed",
      "default": false,
      "description": "Whether to fix camera position"
    },
    "last_frame_image": {
      "type": "string",
      "title": "Last Frame Image",
      "format": "uri",
      "nullable": true,
      "description": "Input image for last frame generation. This only works if an image start frame is given too."
    },
    "reference_images": {
      "type": "array",
      "items": {
        "type": "string",
        "anyOf": [],
        "format": "uri"
      },
      "title": "Reference Images",
      "nullable": true,
      "description": "Reference images (1-4 images) to guide video generation for characters, avatars, clothing, environments, or multi-character interactions. Reference images cannot be used with 1080p resolution or first frame or last frame images."
    }
  }
}
```

### bytedance/seedance-1-pro-fast
- *Link*: https://replicate.com/bytedance/seedance-1-pro-fast
- *Cost*
    - *480p*: 0.015 per second of video
    - *720p*: 0.025 per second of video
    - *1080p*: 0.06 per second of video
- *Median*: 47 seconds
- *InputSchema*
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "fps": {
      "enum": [
        24
      ],
      "type": "integer",
      "title": "fps",
      "description": "Frame rate (frames per second)",
      "default": 24,
      "x-order": 5
    },
    "seed": {
      "type": "integer",
      "title": "Seed",
      "x-order": 7,
      "nullable": true,
      "description": "Random seed. Set for reproducible generation"
    },
    "image": {
      "type": "string",
      "title": "Image",
      "format": "uri",
      "x-order": 1,
      "nullable": true,
      "description": "Input image for image-to-video generation"
    },
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "x-order": 0,
      "description": "Text prompt for video generation"
    },
    "duration": {
      "type": "integer",
      "title": "Duration",
      "default": 5,
      "maximum": 12,
      "minimum": 2,
      "x-order": 2,
      "description": "Video duration in seconds"
    },
    "resolution": {
      "enum": [
        "480p",
        "720p",
        "1080p"
      ],
      "type": "string",
      "title": "resolution",
      "description": "Video resolution",
      "default": "1080p",
      "x-order": 3
    },
    "aspect_ratio": {
      "enum": [
        "16:9",
        "4:3",
        "1:1",
        "3:4",
        "9:16",
        "21:9",
        "9:21"
      ],
      "type": "string",
      "title": "aspect_ratio",
      "description": "Video aspect ratio. Ignored if an image is used.",
      "default": "16:9",
      "x-order": 4
    },
    "camera_fixed": {
      "type": "boolean",
      "title": "Camera Fixed",
      "default": false,
      "x-order": 6,
      "description": "Whether to fix camera position"
    }
  }
}
```

### google/veo-3.1-fast
- *Link*: https://replicate.com/google/veo-3.1-fast
- *Cost*: 
    - (with_audio) 0.15 per second of video
    - (without_audio) 0.10 per second of video
- *Median*: 62.4 seconds
- *InputSchema*:
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "seed": {
      "type": "integer",
      "title": "Seed",
      "x-order": 8,
      "nullable": true,
      "description": "Random seed. Omit for random generations"
    },
    "image": {
      "type": "string",
      "title": "Image",
      "format": "uri",
      "x-order": 3,
      "nullable": true,
      "description": "Input image to start generating from. Ideal images are 16:9 or 9:16 and 1280x720 or 720x1280, depending on the aspect ratio you choose."
    },
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "x-order": 0,
      "description": "Text prompt for video generation"
    },
    "duration": {
      "enum": [
        4,
        6,
        8
      ],
      "type": "integer",
      "title": "duration",
      "description": "Video duration in seconds",
      "default": 8,
      "x-order": 2
    },
    "last_frame": {
      "type": "string",
      "title": "Last Frame",
      "format": "uri",
      "x-order": 4,
      "nullable": true,
      "description": "Ending image for interpolation. When provided with an input image, creates a transition between the two images."
    },
    "resolution": {
      "enum": [
        "720p",
        "1080p"
      ],
      "type": "string",
      "title": "resolution",
      "description": "Resolution of the generated video",
      "default": "1080p",
      "x-order": 6
    },
    "aspect_ratio": {
      "enum": [
        "16:9",
        "9:16"
      ],
      "type": "string",
      "title": "aspect_ratio",
      "description": "Video aspect ratio",
      "default": "16:9",
      "x-order": 1
    },
    "generate_audio": {
      "type": "boolean",
      "title": "Generate Audio",
      "default": true,
      "x-order": 7,
      "description": "Generate audio with the video"
    },
    "negative_prompt": {
      "type": "string",
      "title": "Negative Prompt",
      "x-order": 5,
      "nullable": true,
      "description": "Description of what to exclude from the generated video"
    }
  }
}
```


## Speech Models(Audio)

### minimax/speech-02-hd
- *Link*: https://replicate.com/minimax/speech-02-hd
- *Cost*: 0.10 per thousand input tokens
- *Median*: 2.4 seconds
- *InputSchema*
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "text"
  ],
  "properties": {
    "text": {
      "type": "string",
      "title": "Text",
      "x-order": 0,
      "description": "Text to convert to speech. Every character is 1 token. Maximum 5000 characters. Use <#x#> between words to control pause duration (0.01-99.99s)."
    },
    "pitch": {
      "type": "integer",
      "title": "Pitch",
      "default": 0,
      "maximum": 12,
      "minimum": -12,
      "x-order": 4,
      "description": "Speech pitch"
    },
    "speed": {
      "type": "number",
      "title": "Speed",
      "default": 1,
      "maximum": 2,
      "minimum": 0.5,
      "x-order": 2,
      "description": "Speech speed"
    },
    "volume": {
      "type": "number",
      "title": "Volume",
      "default": 1,
      "maximum": 10,
      "minimum": 0,
      "x-order": 3,
      "description": "Speech volume"
    },
    "bitrate": {
      "enum": [
        32000,
        64000,
        128000,
        256000
      ],
      "type": "integer",
      "title": "bitrate",
      "description": "Bitrate for the generated speech",
      "default": 128000,
      "x-order": 8
    },
    "channel": {
      "enum": [
        "mono",
        "stereo"
      ],
      "type": "string",
      "title": "channel",
      "description": "Number of audio channels",
      "default": "mono",
      "x-order": 9
    },
    "emotion": {
      "enum": [
        "auto",
        "neutral",
        "happy",
        "sad",
        "angry",
        "fearful",
        "disgusted",
        "surprised"
      ],
      "type": "string",
      "title": "emotion",
      "description": "Speech emotion",
      "default": "auto",
      "x-order": 5
    },
    "voice_id": {
      "type": "string",
      "title": "Voice Id",
      "default": "Wise_Woman",
      "x-order": 1,
      "description": "Desired voice ID. Use a voice ID you have trained (https://replicate.com/minimax/voice-cloning), or one of the following system voice IDs: Wise_Woman, Friendly_Person, Inspirational_girl, Deep_Voice_Man, Calm_Woman, Casual_Guy, Lively_Girl, Patient_Man, Young_Knight, Determined_Man, Lovely_Girl, Decent_Boy, Imposing_Manner, Elegant_Man, Abbess, Sweet_Girl_2, Exuberant_Girl"
    },
    "sample_rate": {
      "enum": [
        8000,
        16000,
        22050,
        24000,
        32000,
        44100
      ],
      "type": "integer",
      "title": "sample_rate",
      "description": "Sample rate for the generated speech",
      "default": 32000,
      "x-order": 7
    },
    "language_boost": {
      "enum": [
        "None",
        "Automatic",
        "Chinese",
        "Chinese,Yue",
        "English",
        "Arabic",
        "Russian",
        "Spanish",
        "French",
        "Portuguese",
        "German",
        "Turkish",
        "Dutch",
        "Ukrainian",
        "Vietnamese",
        "Indonesian",
        "Japanese",
        "Italian",
        "Korean",
        "Thai",
        "Polish",
        "Romanian",
        "Greek",
        "Czech",
        "Finnish",
        "Hindi"
      ],
      "type": "string",
      "title": "language_boost",
      "description": "Enhance recognition of specific languages and dialects",
      "default": "None",
      "x-order": 10
    },
    "english_normalization": {
      "type": "boolean",
      "title": "English Normalization",
      "default": false,
      "x-order": 6,
      "description": "Enable English text normalization for better number reading (slightly increases latency)"
    }
  }
}

```
### minimax/speech-2.6-hd
- *Link*: https://replicate.com/minimax/speech-2.6-hd
- *Cost*: 0.10 per thousand input tokens
- *Median*: 3.8 seconds
- *InputFormat*:
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "text"
  ],
  "properties": {
    "text": {
      "type": "string",
      "title": "Text",
      "description": "Text to convert to speech. Every character is 1 token. Maximum 10000 characters. Use <#x#> between words to control pause duration (0.01-99.99s)."
    },
    "pitch": {
      "type": "integer",
      "title": "Pitch",
      "default": 0,
      "maximum": 12,
      "minimum": -12,
      "description": "Speech pitch"
    },
    "speed": {
      "type": "number",
      "title": "Speed",
      "default": 1,
      "maximum": 2,
      "minimum": 0.5,
      "description": "Speech speed"
    },
    "volume": {
      "type": "number",
      "title": "Volume",
      "default": 1,
      "maximum": 10,
      "minimum": 0,
      "description": "Speech volume"
    },
    "bitrate": {
      "enum": [
        32000,
        64000,
        128000,
        256000
      ],
      "type": "integer",
      "title": "bitrate",
      "description": "Bitrate for the generated speech",
      "default": 128000,
      "x-order": 8
    },
    "channel": {
      "enum": [
        "mono",
        "stereo"
      ],
      "type": "string",
      "title": "channel",
      "description": "Number of audio channels",
      "default": "mono",
      "x-order": 10
    },
    "emotion": {
      "enum": [
        "auto",
        "happy",
        "sad",
        "angry",
        "fearful",
        "disgusted",
        "surprised",
        "calm",
        "fluent",
        "neutral"
      ],
      "type": "string",
      "title": "emotion",
      "description": "Speech emotion",
      "default": "auto",
      "x-order": 5
    },
    "voice_id": {
      "type": "string",
      "title": "Voice Id",
      "default": "Wise_Woman",
      "description": "Desired voice ID. Use a voice ID you have trained (https://replicate.com/minimax/voice-cloning), or one of the following system voice IDs: Wise_Woman, Friendly_Person, Inspirational_girl, Deep_Voice_Man, Calm_Woman, Casual_Guy, Lively_Girl, Patient_Man, Young_Knight, Determined_Man, Lovely_Girl, Decent_Boy, Imposing_Manner, Elegant_Man, Abbess, Sweet_Girl_2, Exuberant_Girl"
    },
    "sample_rate": {
      "enum": [
        8000,
        16000,
        22050,
        24000,
        32000,
        44100
      ],
      "type": "integer",
      "title": "sample_rate",
      "description": "Sample rate for the generated speech",
      "default": 32000,
      "x-order": 7
    },
    "audio_format": {
      "enum": [
        "mp3",
        "wav",
        "flac",
        "pcm"
      ],
      "type": "string",
      "title": "audio_format",
      "description": "Audio format for the generated speech",
      "default": "mp3",
      "x-order": 9
    },
    "output_format": {
      "enum": [
        "hex",
        "url"
      ],
      "type": "string",
      "title": "output_format",
      "description": "Transport format for the generated audio payload",
      "default": "hex",
      "x-order": 12
    },
    "language_boost": {
      "enum": [
        "None",
        "Automatic",
        "Chinese",
        "Chinese,Yue",
        "Cantonese",
        "English",
        "Arabic",
        "Russian",
        "Spanish",
        "French",
        "Portuguese",
        "German",
        "Turkish",
        "Dutch",
        "Ukrainian",
        "Vietnamese",
        "Indonesian",
        "Japanese",
        "Italian",
        "Korean",
        "Thai",
        "Polish",
        "Romanian",
        "Greek",
        "Czech",
        "Finnish",
        "Hindi",
        "Bulgarian",
        "Danish",
        "Hebrew",
        "Malay",
        "Persian",
        "Slovak",
        "Swedish",
        "Croatian",
        "Filipino",
        "Hungarian",
        "Norwegian",
        "Slovenian",
        "Catalan",
        "Nynorsk",
        "Tamil",
        "Afrikaans"
      ],
      "type": "string",
      "title": "language_boost",
      "description": "Enhance recognition of specific languages and dialects",
      "default": "None",
      "x-order": 13
    },
    "subtitle_enable": {
      "type": "boolean",
      "title": "Subtitle Enable",
      "default": false,
      "description": "Return subtitle metadata alongside audio (non-streaming only)"
    },
    "english_normalization": {
      "type": "boolean",
      "title": "English Normalization",
      "default": false,
      "description": "Enable English text normalization for better number reading (slightly increases latency)"
    }
  }
}
```
\
### elevenlabs/v3
- *Link*: https://replicate.com/elevenlabs/v3
- *Cost*: $0.10 per thousand input characters
- *Median*: 4.7 seconds
- *InputSchema*: 
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "speed": {
      "type": "number",
      "title": "Speed",
      "default": 1,
      "maximum": 1.2,
      "minimum": 0.7,
      "x-order": 5,
      "description": "Speed of speech (0.25 to 4.0)"
    },
    "style": {
      "type": "number",
      "title": "Style",
      "default": 0,
      "maximum": 1,
      "minimum": 0,
      "x-order": 4,
      "description": "Style exaggeration (0.0 to 1.0)"
    },
    "voice": {
      "enum": [
        "Rachel",
        "Drew",
        "Clyde",
        "Paul",
        "Aria",
        "Domi",
        "Dave",
        "Roger",
        "Fin",
        "Sarah",
        "James",
        "Jane",
        "Juniper",
        "Arabella",
        "Hope",
        "Bradford",
        "Reginald",
        "Gaming",
        "Austin",
        "Kuon",
        "Blondie",
        "Priyanka",
        "Alexandra",
        "Monika",
        "Mark",
        "Grimblewood"
      ],
      "type": "string",
      "title": "voice",
      "description": "Voice choice for speech generation",
      "default": "Rachel",
      "x-order": 1
    },
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "x-order": 0,
      "description": "The text to convert to speech"
    },
    "next_text": {
      "type": "string",
      "title": "Next Text",
      "default": "",
      "x-order": 7,
      "description": "Next text for context"
    },
    "stability": {
      "type": "number",
      "title": "Stability",
      "default": 0.5,
      "maximum": 1,
      "minimum": 0,
      "x-order": 2,
      "description": "Stability setting for voice generation (0.0 to 1.0)"
    },
    "language_code": {
      "type": "string",
      "title": "Language Code",
      "default": "en",
      "x-order": 8,
      "description": "Language code (e.g., 'en', 'es', 'fr')"
    },
    "previous_text": {
      "type": "string",
      "title": "Previous Text",
      "default": "",
      "x-order": 6,
      "description": "Previous text for context"
    },
    "similarity_boost": {
      "type": "number",
      "title": "Similarity Boost",
      "default": 0.75,
      "maximum": 1,
      "minimum": 0,
      "x-order": 3,
      "description": "Similarity boost setting (0.0 to 1.0)"
    }
  }
}
```

## Music Models

### stability-ai/stable-audio-2.5
- *Link*: https://replicate.com/stability-ai/stable-audio-2.5
- *Cost*:  $0.20 per audio file
- *Median*: 5.8 seconds
- *InputSchema*
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "seed": {
      "type": "integer",
      "title": "Seed",
      "x-order": 4,
      "nullable": true,
      "description": "Random seed for reproducible results. Leave blank for random seed."
    },
    "steps": {
      "type": "integer",
      "title": "Steps",
      "default": 8,
      "maximum": 8,
      "minimum": 4,
      "x-order": 2,
      "description": "Number of diffusion steps (higher = better quality but slower)"
    },
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "x-order": 0,
      "description": "Text prompt describing the desired audio"
    },
    "duration": {
      "type": "integer",
      "title": "Duration",
      "default": 190,
      "maximum": 190,
      "minimum": 1,
      "x-order": 1,
      "description": "Duration of generated audio in seconds"
    },
    "cfg_scale": {
      "type": "number",
      "title": "Cfg Scale",
      "default": 1,
      "maximum": 25,
      "minimum": 1,
      "x-order": 3,
      "description": "Classifier-free guidance scale (higher = more prompt adherence)"
    }
  }
}
```

### elevenlabs/music
- *Link*: https://replicate.com/elevenlabs/music
- *Cost*: 8.30 per thousand seconds of output audio
- *Median*: 13.3 seconds
- *InputSchema*:
```json
{
  "type": "object",
  "title": "Input",
  "required": [
    "prompt"
  ],
  "properties": {
    "prompt": {
      "type": "string",
      "title": "Prompt",
      "description": "Description of the music you want to generate"
    },
    "output_format": {
      "enum": [
        "mp3_standard",
        "mp3_high_quality",
        "wav_16khz",
        "wav_22khz",
        "wav_24khz",
        "wav_cd_quality"
      ],
      "type": "string",
      "title": "output_format",
      "description": "Audio output format: mp3_standard (128kbps MP3, balanced quality/size), mp3_high_quality (192kbps MP3, higher quality), wav_16khz (16kHz WAV, good for voice), wav_22khz (22kHz WAV), wav_24khz (24kHz WAV), wav_cd_quality (44.1kHz WAV, uncompressed CD quality)",
      "default": "mp3_standard",
      "x-order": 3
    },
    "music_length_ms": {
      "type": "integer",
      "title": "Music Length Ms",
      "default": 10000,
      "maximum": 300000,
      "minimum": 5000,
      "description": "Target duration of the music in milliseconds (optional, defaults to ~10 seconds)"
    },
    "force_instrumental": {
      "type": "boolean",
      "title": "Force Instrumental",
      "default": true,
      "description": "If true, removes vocal elements from the generated music"
    }
  }
}
```