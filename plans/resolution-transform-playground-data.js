window.RESOLUTION_TOOL_DATA = {
  "generatedAt": "2026-03-22T17:55:09.511Z",
  "producers": [
    {
      "id": "catalog/producers/image/image-compose.yaml",
      "name": "Image Composer",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "bytedance/seedream/v4.5/edit",
          "id": "fal-ai/bytedance/seedream/v4.5/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bytedance-seedream-v4-5-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. Width and height must be between 1920 and 4096, or total number of pixels must be between 2560*1440 and 4096*4096.",
              "default": {
                "height": 2048,
                "width": 2048
              },
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto_2K",
                "auto_4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "ImageSize",
              "ruleType": "object",
              "source": "ImageSize",
              "field": "image_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "+2K": "auto_2K",
                "+4K": "auto_4K",
                "16:9+": "landscape_16_9",
                "9:16+": "portrait_16_9",
                "4:3+": "landscape_4_3",
                "3:4+": "portrait_4_3",
                "1:1+": "square_hd",
                "16:9+2K": "auto_2K",
                "16:9+4K": "auto_4K",
                "1:1+2K": "auto_2K",
                "1:1+4K": "auto_4K"
              },
              "transformTable": null,
              "text": "`ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "bytedance/seedream/v4/edit",
          "id": "fal-ai/bytedance/seedream/v4/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bytedance-seedream-v4-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. The minimum total image area is 921600 pixels. Failing this, the image size will be adjusted to by scaling it up, while maintaining the aspect ratio.",
              "default": {
                "height": 2048,
                "width": 2048
              },
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto",
                "auto_2K",
                "auto_4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "bytedance/seedream/v5/lite/edit",
          "id": "fal-ai/bytedance/seedream/v5/lite/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bytedance-seedream-v5-lite-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. Total pixels must be between 2560x1440 and 3072x3072. In case the image size does not fall within these parameters, the image size will be adjusted to by scaling.",
              "default": "auto_2K",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto_2K",
                "auto_3K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "ImageSize",
              "ruleType": "object",
              "source": "ImageSize",
              "field": "image_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "+2K": "auto_2K",
                "+4K": "auto_3K",
                "16:9+": "landscape_16_9",
                "9:16+": "portrait_16_9",
                "4:3+": "landscape_4_3",
                "3:4+": "portrait_4_3",
                "1:1+": "square_hd",
                "16:9+2K": "auto_2K",
                "16:9+4K": "auto_3K",
                "1:1+2K": "auto_2K",
                "1:1+4K": "auto_3K"
              },
              "transformTable": null,
              "text": "`ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "flux-2/edit",
          "id": "fal-ai/flux-2/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-2-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the image to generate. The width and height must be between 512 and 2048 pixels.",
              "default": null,
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "flux-2/flash/edit",
          "id": "fal-ai/flux-2/flash/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-2-flash-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the image to generate. The width and height must be between 512 and 2048 pixels.",
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "flux-2/turbo/edit",
          "id": "fal-ai/flux-2/turbo/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-2-turbo-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the image to generate. The width and height must be between 512 and 2048 pixels.",
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "gpt-image-1.5/edit",
          "id": "fal-ai/gpt-image-1.5/edit",
          "caseId": "CASE_D_IMAGE_SIZE_TOKEN",
          "caseSummary": "Model expects image_size token/string.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/gpt-image-1-5-edit.json",
          "sizeFields": {
            "image_size": {
              "type": "string",
              "description": "Aspect ratio for the generated image",
              "default": "auto",
              "stringEnums": [
                "auto",
                "1024x1024",
                "1536x1024",
                "1024x1536"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "hunyuan-image/v3/instruct/edit",
          "id": "fal-ai/hunyuan-image/v3/instruct/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/hunyuan-image-v3-instruct-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The desired size of the generated image. If auto, image size will be determined by the model.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "nano-banana-2/edit",
          "id": "fal-ai/nano-banana-2/edit",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/nano-banana-2-edit.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "The aspect ratio of the generated image.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "21:9",
                "16:9",
                "3:2",
                "4:3",
                "5:4",
                "1:1",
                "4:5",
                "3:4",
                "2:3",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the image to generate.",
              "default": "1K",
              "stringEnums": [
                "1K",
                "2K",
                "4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "nano-banana-pro/edit",
          "id": "fal-ai/nano-banana-pro/edit",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/nano-banana-pro-edit.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated image.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "21:9",
                "16:9",
                "3:2",
                "4:3",
                "5:4",
                "1:1",
                "4:5",
                "3:4",
                "2:3",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the image to generate.",
              "default": "1K",
              "stringEnums": [
                "1K",
                "2K",
                "4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "qwen-image-2/edit",
          "id": "fal-ai/qwen-image-2/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/qwen-image-2-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. If not provided, the size of the final input image will be used.  Total number of pixels must be between 512x512 and 2048x2048.",
              "default": null,
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "qwen-image-2/pro/edit",
          "id": "fal-ai/qwen-image-2/pro/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/qwen-image-2-pro-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. If not provided, the size of the final input image will be used.  Total number of pixels must be between 512x512 and 2048x2048.",
              "default": null,
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "qwen-image-edit-2511",
          "id": "fal-ai/qwen-image-edit-2511",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/qwen-image-edit-2511.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. If None, uses the input image dimensions.",
              "default": null,
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "wan/v2.6/image-to-image",
          "id": "fal-ai/wan/v2.6/image-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/wan-v2-6-image-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "Output image size. Use presets like 'square_hd', 'landscape_16_9', 'portrait_9_16', or specify exact dimensions with ImageSize(width=1280, height=720). Total pixels must be between 768*768 and 1280*1280.",
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "xai/grok-imagine-image/edit",
          "id": "fal-ai/xai/grok-imagine-image/edit",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/xai-grok-imagine-image-edit.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "black-forest-labs/flux-2-flex",
          "id": "replicate/black-forest-labs/flux-2-flex",
          "caseId": "CASE_J_MEGAPIXELS_WITH_ASPECT",
          "caseSummary": "Model expects megapixels plus aspect ratio.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/black-forest-labs-flux-2-flex.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio for the generated image. Use 'match_input_image' to match the first input image's aspect ratio.",
              "default": "1:1",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "height": {
              "type": "integer",
              "description": "Height of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": null,
              "description": "Resolution in megapixels. Up to 4 MP is possible, but 2 MP or below is recommended. The maximum image size is 2048x2048, which means that high-resolution images may not respect the resolution if aspect ratio is not 1:1.\n\nResolution is not used when aspect_ratio is 'custom'. When aspect_ratio is 'match_input_image', use 'match_input_image' to match the input image's resolution (clamped to 0.5-4 MP).",
              "default": "1 MP",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "width": {
              "type": "integer",
              "description": "Width of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "black-forest-labs/flux-2-max",
          "id": "replicate/black-forest-labs/flux-2-max",
          "caseId": "CASE_J_MEGAPIXELS_WITH_ASPECT",
          "caseSummary": "Model expects megapixels plus aspect ratio.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/black-forest-labs-flux-2-max.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio for the generated image. Use 'match_input_image' to match the first input image's aspect ratio.",
              "default": "1:1",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "height": {
              "type": "integer",
              "description": "Height of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": null,
              "description": "Resolution in megapixels. Up to 4 MP is possible, but 2 MP or below is recommended. The maximum image size is 2048x2048, which means that high-resolution images may not respect the resolution if aspect ratio is not 1:1.\n\nResolution is not used when aspect_ratio is 'custom'. When aspect_ratio is 'match_input_image', use 'match_input_image' to match the input image's resolution (clamped to 0.5-4 MP).",
              "default": "1 MP",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "width": {
              "type": "integer",
              "description": "Width of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "black-forest-labs/flux-2-pro",
          "id": "replicate/black-forest-labs/flux-2-pro",
          "caseId": "CASE_J_MEGAPIXELS_WITH_ASPECT",
          "caseSummary": "Model expects megapixels plus aspect ratio.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/black-forest-labs-flux-2-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio for the generated image. Use 'match_input_image' to match the first input image's aspect ratio.",
              "default": "1:1",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "height": {
              "type": "integer",
              "description": "Height of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": null,
              "description": "Resolution in megapixels. Up to 4 MP is possible, but 2 MP or below is recommended. The maximum image size is 2048x2048, which means that high-resolution images may not respect the resolution if aspect ratio is not 1:1.\n\nResolution is not used when aspect_ratio is 'custom'. When aspect_ratio is 'match_input_image', use 'match_input_image' to match the input image's resolution (clamped to 0.5-4 MP).",
              "default": "1 MP",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "width": {
              "type": "integer",
              "description": "Width of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "black-forest-labs/flux-kontext-pro",
          "id": "replicate/black-forest-labs/flux-kontext-pro",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/black-forest-labs-flux-kontext-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated image. Use 'match_input_image' to match the aspect ratio of the input image.",
              "default": "match_input_image",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedream-4",
          "id": "replicate/bytedance/seedream-4",
          "caseId": "CASE_F_WIDTH_HEIGHT_FIELDS",
          "caseSummary": "Model expects explicit width and height fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/bytedance-seedream-4.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Image aspect ratio. Only used when size is not 'custom'. Use 'match_input_image' to automatically match the input image's aspect ratio.",
              "default": "match_input_image",
              "stringEnums": [
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
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "height": {
              "type": "integer",
              "description": "Custom image height (only used when size='custom'). Range: 1024-4096 pixels.",
              "default": 2048,
              "stringEnums": [],
              "minimum": 1024,
              "maximum": 4096,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "output_size": {
              "type": "string",
              "description": "Image resolution: 1K (1024px), 2K (2048px), 4K (4096px), or 'custom' for specific dimensions.",
              "default": "2K",
              "stringEnums": [
                "1K",
                "2K",
                "4K",
                "custom"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "size": {
              "type": "string",
              "description": "Image resolution: 1K (1024px), 2K (2048px), 4K (4096px), or 'custom' for specific dimensions.",
              "default": "2K",
              "stringEnums": [
                "1K",
                "2K",
                "4K",
                "custom"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "width": {
              "type": "integer",
              "description": "Custom image width (only used when size='custom'). Range: 1024-4096 pixels.",
              "default": 2048,
              "stringEnums": [],
              "minimum": 1024,
              "maximum": 4096,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "object",
              "source": "Resolution",
              "field": "size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": {
                "1K": "1K",
                "2K": "2K",
                "4K": "4K",
                "custom": "custom"
              },
              "text": "`Resolution`: source=`Resolution`, field=`size`, transform.entries=4"
            },
            {
              "alias": "Width",
              "ruleType": "object",
              "source": "Width",
              "field": null,
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": null,
              "text": "`Width`: source=`Width`, conditional=true"
            },
            {
              "alias": "Height",
              "ruleType": "object",
              "source": "Height",
              "field": null,
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": null,
              "text": "`Height`: source=`Height`, conditional=true"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedream-4.5",
          "id": "replicate/bytedance/seedream-4.5",
          "caseId": "CASE_F_WIDTH_HEIGHT_FIELDS",
          "caseSummary": "Model expects explicit width and height fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/bytedance-seedream-4-5.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Image aspect ratio. Only used when size is not 'custom'. Use 'match_input_image' to automatically match the input image's aspect ratio.",
              "default": "match_input_image",
              "stringEnums": [
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
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "height": {
              "type": "integer",
              "description": "Custom image height (only used when size='custom'). Range: 1024-4096 pixels.",
              "default": 2048,
              "stringEnums": [],
              "minimum": 1024,
              "maximum": 4096,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "size": {
              "type": "string",
              "description": "Image resolution: 2K (2048px), 4K (4096px), or 'custom' for specific dimensions. Note: 1K resolution is not supported in Seedream 4.5.",
              "default": "2K",
              "stringEnums": [
                "2K",
                "4K",
                "custom"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "width": {
              "type": "integer",
              "description": "Custom image width (only used when size='custom'). Range: 1024-4096 pixels.",
              "default": 2048,
              "stringEnums": [],
              "minimum": 1024,
              "maximum": 4096,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "object",
              "source": "Resolution",
              "field": "size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": {
                "1K": "2K",
                "2K": "2K",
                "4K": "4K",
                "custom": "custom"
              },
              "text": "`Resolution`: source=`Resolution`, field=`size`, transform.entries=4"
            },
            {
              "alias": "Width",
              "ruleType": "object",
              "source": "Width",
              "field": null,
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": null,
              "text": "`Width`: source=`Width`, conditional=true"
            },
            {
              "alias": "Height",
              "ruleType": "object",
              "source": "Height",
              "field": null,
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": null,
              "text": "`Height`: source=`Height`, conditional=true"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedream-5-lite",
          "id": "replicate/bytedance/seedream-5-lite",
          "caseId": "CASE_E_SIZE_TOKEN_OR_DIM_UNRESOLVED",
          "caseSummary": "Model has size field with unresolved enum/token references.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/bytedance-seedream-5-lite.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Image aspect ratio. Use 'match_input_image' to automatically match the input image's aspect ratio.",
              "default": "match_input_image",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "size": {
              "type": null,
              "description": "Image resolution: 2K (2048px) or 3K (3072px).",
              "default": "2K",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "size"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "object",
              "source": "Resolution",
              "field": "size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": {
                "1K": "2K",
                "2K": "2K",
                "4K": "3K"
              },
              "text": "`Resolution`: source=`Resolution`, field=`size`, transform.entries=3"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "google/nano-banana",
          "id": "replicate/google/nano-banana",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/google-nano-banana.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated image",
              "default": "match_input_image",
              "stringEnums": [
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
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "google/nano-banana-2",
          "id": "replicate/google/nano-banana-2",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/google-nano-banana-2.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated image",
              "default": "match_input_image",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution of the generated image. Higher resolutions take longer to generate.",
              "default": "1K",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "google/nano-banana-pro",
          "id": "replicate/google/nano-banana-pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/google-nano-banana-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated image",
              "default": "match_input_image",
              "stringEnums": [
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
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the generated image",
              "default": "2K",
              "stringEnums": [
                "1K",
                "2K",
                "4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "qwen/qwen-image-edit-2511",
          "id": "replicate/qwen/qwen-image-edit-2511",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/qwen-qwen-image-edit-2511.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio for the generated image.",
              "default": "match_input_image",
              "stringEnums": [
                "1:1",
                "16:9",
                "9:16",
                "4:3",
                "3:4",
                "match_input_image"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        }
      ]
    },
    {
      "id": "catalog/producers/image/image-edit.yaml",
      "name": "Image Editor",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "bria/fibo-edit/edit",
          "id": "fal-ai/bria/fibo-edit/edit",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bria-fibo-edit-edit.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "bytedance/seedream/v4.5/edit",
          "id": "fal-ai/bytedance/seedream/v4.5/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bytedance-seedream-v4-5-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. Width and height must be between 1920 and 4096, or total number of pixels must be between 2560*1440 and 4096*4096.",
              "default": {
                "height": 2048,
                "width": 2048
              },
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto_2K",
                "auto_4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "ImageSize",
              "ruleType": "object",
              "source": "ImageSize",
              "field": "image_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "+2K": "auto_2K",
                "+4K": "auto_4K",
                "16:9+": "landscape_16_9",
                "9:16+": "portrait_16_9",
                "4:3+": "landscape_4_3",
                "3:4+": "portrait_4_3",
                "1:1+": "square_hd",
                "16:9+2K": "auto_2K",
                "16:9+4K": "auto_4K",
                "1:1+2K": "auto_2K",
                "1:1+4K": "auto_4K"
              },
              "transformTable": null,
              "text": "`ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "bytedance/seedream/v4/edit",
          "id": "fal-ai/bytedance/seedream/v4/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bytedance-seedream-v4-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. The minimum total image area is 921600 pixels. Failing this, the image size will be adjusted to by scaling it up, while maintaining the aspect ratio.",
              "default": {
                "height": 2048,
                "width": 2048
              },
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto",
                "auto_2K",
                "auto_4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "bytedance/seedream/v5/lite/edit",
          "id": "fal-ai/bytedance/seedream/v5/lite/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bytedance-seedream-v5-lite-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. Total pixels must be between 2560x1440 and 3072x3072. In case the image size does not fall within these parameters, the image size will be adjusted to by scaling.",
              "default": "auto_2K",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto_2K",
                "auto_3K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "ImageSize",
              "ruleType": "object",
              "source": "ImageSize",
              "field": "image_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "+2K": "auto_2K",
                "+4K": "auto_3K",
                "16:9+": "landscape_16_9",
                "9:16+": "portrait_16_9",
                "4:3+": "landscape_4_3",
                "3:4+": "portrait_4_3",
                "1:1+": "square_hd",
                "16:9+2K": "auto_2K",
                "16:9+4K": "auto_3K",
                "1:1+2K": "auto_2K",
                "1:1+4K": "auto_3K"
              },
              "transformTable": null,
              "text": "`ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "flux-2/edit",
          "id": "fal-ai/flux-2/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-2-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the image to generate. The width and height must be between 512 and 2048 pixels.",
              "default": null,
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "flux-2/flash/edit",
          "id": "fal-ai/flux-2/flash/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-2-flash-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the image to generate. The width and height must be between 512 and 2048 pixels.",
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "flux-2/turbo/edit",
          "id": "fal-ai/flux-2/turbo/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-2-turbo-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the image to generate. The width and height must be between 512 and 2048 pixels.",
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "flux-pro/kontext",
          "id": "fal-ai/flux-pro/kontext",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-pro-kontext.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated image.",
              "default": null,
              "stringEnums": [
                "21:9",
                "16:9",
                "4:3",
                "3:2",
                "1:1",
                "2:3",
                "3:4",
                "9:16",
                "9:21"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "gpt-image-1.5/edit",
          "id": "fal-ai/gpt-image-1.5/edit",
          "caseId": "CASE_D_IMAGE_SIZE_TOKEN",
          "caseSummary": "Model expects image_size token/string.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/gpt-image-1-5-edit.json",
          "sizeFields": {
            "image_size": {
              "type": "string",
              "description": "Aspect ratio for the generated image",
              "default": "auto",
              "stringEnums": [
                "auto",
                "1024x1024",
                "1536x1024",
                "1024x1536"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "hunyuan-image/v3/instruct/edit",
          "id": "fal-ai/hunyuan-image/v3/instruct/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/hunyuan-image-v3-instruct-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The desired size of the generated image. If auto, image size will be determined by the model.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "nano-banana-2/edit",
          "id": "fal-ai/nano-banana-2/edit",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/nano-banana-2-edit.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "The aspect ratio of the generated image.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "21:9",
                "16:9",
                "3:2",
                "4:3",
                "5:4",
                "1:1",
                "4:5",
                "3:4",
                "2:3",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the image to generate.",
              "default": "1K",
              "stringEnums": [
                "1K",
                "2K",
                "4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "nano-banana-pro/edit",
          "id": "fal-ai/nano-banana-pro/edit",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/nano-banana-pro-edit.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated image.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "21:9",
                "16:9",
                "3:2",
                "4:3",
                "5:4",
                "1:1",
                "4:5",
                "3:4",
                "2:3",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the image to generate.",
              "default": "1K",
              "stringEnums": [
                "1K",
                "2K",
                "4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "qwen-image-2/edit",
          "id": "fal-ai/qwen-image-2/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/qwen-image-2-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. If not provided, the size of the final input image will be used.  Total number of pixels must be between 512x512 and 2048x2048.",
              "default": null,
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "qwen-image-2/pro/edit",
          "id": "fal-ai/qwen-image-2/pro/edit",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/qwen-image-2-pro-edit.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. If not provided, the size of the final input image will be used.  Total number of pixels must be between 512x512 and 2048x2048.",
              "default": null,
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "qwen-image-edit-2511",
          "id": "fal-ai/qwen-image-edit-2511",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/qwen-image-edit-2511.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. If None, uses the input image dimensions.",
              "default": null,
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "wan/v2.6/image-to-image",
          "id": "fal-ai/wan/v2.6/image-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/wan-v2-6-image-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "Output image size. Use presets like 'square_hd', 'landscape_16_9', 'portrait_9_16', or specify exact dimensions with ImageSize(width=1280, height=720). Total pixels must be between 768*768 and 1280*1280.",
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "xai/grok-imagine-image/edit",
          "id": "fal-ai/xai/grok-imagine-image/edit",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/xai-grok-imagine-image-edit.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "z-image/turbo/image-to-image",
          "id": "fal-ai/z-image/turbo/image-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/z-image-turbo-image-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image.",
              "default": "auto",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedream-5-lite",
          "id": "replicate/bytedance/seedream-5-lite",
          "caseId": "CASE_E_SIZE_TOKEN_OR_DIM_UNRESOLVED",
          "caseSummary": "Model has size field with unresolved enum/token references.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/bytedance-seedream-5-lite.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Image aspect ratio. Use 'match_input_image' to automatically match the input image's aspect ratio.",
              "default": "match_input_image",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "size": {
              "type": null,
              "description": "Image resolution: 2K (2048px) or 3K (3072px).",
              "default": "2K",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "size"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "size",
              "text": "`Resolution` -> `size`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "google/nano-banana-2",
          "id": "replicate/google/nano-banana-2",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/google-nano-banana-2.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated image",
              "default": "match_input_image",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution of the generated image. Higher resolutions take longer to generate.",
              "default": "1K",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "prunaai/flux-kontext-fast",
          "id": "replicate/prunaai/flux-kontext-fast",
          "caseId": "CASE_K_LONGEST_SIDE_INTEGER",
          "caseSummary": "Model expects integer image_size field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/prunaai-flux-kontext-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the output image",
              "default": "match_input_image",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "image_size": {
              "type": "integer",
              "description": "Base image size (longest side)",
              "default": 1024,
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "qwen/qwen-image",
          "id": "replicate/qwen/qwen-image",
          "caseId": "CASE_D_IMAGE_SIZE_TOKEN",
          "caseSummary": "Model expects image_size token/string.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/qwen-qwen-image.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio for the generated image",
              "default": "16:9",
              "stringEnums": [
                "1:1",
                "16:9",
                "9:16",
                "4:3",
                "3:4",
                "3:2",
                "2:3"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "image_size": {
              "type": "string",
              "description": "Image size for the generated image",
              "default": "optimize_for_quality",
              "stringEnums": [
                "optimize_for_quality",
                "optimize_for_speed"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "object",
              "source": "Resolution",
              "field": "image_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": {
                "1K": "optimize_for_speed",
                "2K": "optimize_for_quality",
                "4K": "optimize_for_quality"
              },
              "text": "`Resolution`: source=`Resolution`, field=`image_size`, transform.entries=3"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "qwen/qwen-image-edit-2511",
          "id": "replicate/qwen/qwen-image-edit-2511",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/qwen-qwen-image-edit-2511.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio for the generated image.",
              "default": "match_input_image",
              "stringEnums": [
                "1:1",
                "16:9",
                "9:16",
                "4:3",
                "3:4",
                "match_input_image"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        }
      ]
    },
    {
      "id": "catalog/producers/image/text-to-grid-images.yaml",
      "name": "Text-to-Grid Image Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "gpt-image-1.5",
          "id": "fal-ai/gpt-image-1.5",
          "caseId": "CASE_D_IMAGE_SIZE_TOKEN",
          "caseSummary": "Model expects image_size token/string.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/gpt-image-1-5.json",
          "sizeFields": {
            "image_size": {
              "type": "string",
              "description": "Aspect ratio for the generated image",
              "default": "1024x1024",
              "stringEnums": [
                "1024x1024",
                "1536x1024",
                "1024x1536"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "nano-banana-pro",
          "id": "fal-ai/nano-banana-pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/nano-banana-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated image.",
              "default": "1:1",
              "stringEnums": [
                "21:9",
                "16:9",
                "3:2",
                "4:3",
                "5:4",
                "1:1",
                "4:5",
                "3:4",
                "2:3",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the image to generate.",
              "default": "1K",
              "stringEnums": [
                "1K",
                "2K",
                "4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/image/text-to-image.yaml",
      "name": "Text-to-Image Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "bytedance/seedream/v4.5/text-to-image",
          "id": "fal-ai/bytedance/seedream/v4.5/text-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bytedance-seedream-v4-5-text-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. Width and height must be between 1920 and 4096, or total number of pixels must be between 2560*1440 and 4096*4096.",
              "default": {
                "height": 2048,
                "width": 2048
              },
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto_2K",
                "auto_4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "ImageSize",
              "ruleType": "object",
              "source": "ImageSize",
              "field": "image_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "+2K": "auto_2K",
                "+4K": "auto_4K",
                "16:9+": "landscape_16_9",
                "9:16+": "portrait_16_9",
                "4:3+": "landscape_4_3",
                "3:4+": "portrait_4_3",
                "1:1+": "square_hd",
                "16:9+2K": "auto_2K",
                "16:9+4K": "auto_4K",
                "1:1+2K": "auto_2K",
                "1:1+4K": "auto_4K"
              },
              "transformTable": null,
              "text": "`ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "bytedance/seedream/v4/text-to-image",
          "id": "fal-ai/bytedance/seedream/v4/text-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bytedance-seedream-v4-text-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. Width and height must be between 1024 and 4096.",
              "default": {
                "height": 2048,
                "width": 2048
              },
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto",
                "auto_2K",
                "auto_4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "bytedance/seedream/v5/lite/text-to-image",
          "id": "fal-ai/bytedance/seedream/v5/lite/text-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/bytedance-seedream-v5-lite-text-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. Total pixels must be between 2560x1440 and 3072x3072. In case the image size does not fall within these parameters, the image size will be adjusted to by scaling.",
              "default": "auto_2K",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9",
                "auto_2K",
                "auto_3K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "ImageSize",
              "ruleType": "object",
              "source": "ImageSize",
              "field": "image_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "+2K": "auto_2K",
                "+4K": "auto_3K",
                "16:9+": "landscape_16_9",
                "9:16+": "portrait_16_9",
                "4:3+": "landscape_4_3",
                "3:4+": "portrait_4_3",
                "1:1+": "square_hd",
                "16:9+2K": "auto_2K",
                "16:9+4K": "auto_3K",
                "1:1+2K": "auto_2K",
                "1:1+4K": "auto_3K"
              },
              "transformTable": null,
              "text": "`ImageSize`: source=`ImageSize`, field=`image_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "flux-2",
          "id": "fal-ai/flux-2",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-2.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the image to generate. The width and height must be between 512 and 2048 pixels.",
              "default": "landscape_4_3",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "flux-2/flash",
          "id": "fal-ai/flux-2/flash",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-2-flash.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the image to generate. The width and height must be between 512 and 2048 pixels.",
              "default": "landscape_4_3",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "flux-2/turbo",
          "id": "fal-ai/flux-2/turbo",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-2-turbo.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the image to generate. The width and height must be between 512 and 2048 pixels.",
              "default": "landscape_4_3",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "flux-pro/kontext/text-to-image",
          "id": "fal-ai/flux-pro/kontext/text-to-image",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/flux-pro-kontext-text-to-image.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated image.",
              "default": "1:1",
              "stringEnums": [
                "21:9",
                "16:9",
                "4:3",
                "3:2",
                "1:1",
                "2:3",
                "3:4",
                "9:16",
                "9:21"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "gpt-image-1.5",
          "id": "fal-ai/gpt-image-1.5",
          "caseId": "CASE_D_IMAGE_SIZE_TOKEN",
          "caseSummary": "Model expects image_size token/string.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/gpt-image-1-5.json",
          "sizeFields": {
            "image_size": {
              "type": "string",
              "description": "Aspect ratio for the generated image",
              "default": "1024x1024",
              "stringEnums": [
                "1024x1024",
                "1536x1024",
                "1024x1536"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "hunyuan-image/v3/instruct/text-to-image",
          "id": "fal-ai/hunyuan-image/v3/instruct/text-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/hunyuan-image-v3-instruct-text-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The desired size of the generated image. If auto, image size will be determined by the model.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "nano-banana-2",
          "id": "fal-ai/nano-banana-2",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/nano-banana-2.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "The aspect ratio of the generated image. Use \"auto\" to let the model decide based on the prompt.",
              "default": "1:1",
              "stringEnums": [
                "auto",
                "21:9",
                "16:9",
                "3:2",
                "4:3",
                "5:4",
                "1:1",
                "4:5",
                "3:4",
                "2:3",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the image to generate.",
              "default": "1K",
              "stringEnums": [
                "1K",
                "2K",
                "4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "nano-banana-pro",
          "id": "fal-ai/nano-banana-pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/nano-banana-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated image.",
              "default": "1:1",
              "stringEnums": [
                "21:9",
                "16:9",
                "3:2",
                "4:3",
                "5:4",
                "1:1",
                "4:5",
                "3:4",
                "2:3",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the image to generate.",
              "default": "1K",
              "stringEnums": [
                "1K",
                "2K",
                "4K"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "qwen-image-2/pro/text-to-image",
          "id": "fal-ai/qwen-image-2/pro/text-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/qwen-image-2-pro-text-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. Total number of pixels must be between 512x512 and 2048x2048.",
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "qwen-image-2/text-to-image",
          "id": "fal-ai/qwen-image-2/text-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/qwen-image-2-text-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image. Total number of pixels must be between 512x512 and 2048x2048.",
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "qwen-image-2512",
          "id": "fal-ai/qwen-image-2512",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/qwen-image-2512.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image.",
              "default": "landscape_4_3",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "ImageSize",
              "ruleType": "object",
              "source": "ImageSize",
              "field": null,
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": null,
              "text": "`ImageSize`: source=`ImageSize`, conditional=true"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "recraft/v4/pro/text-to-image",
          "id": "fal-ai/recraft/v4/pro/text-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/recraft-v4-pro-text-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": null,
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "recraft/v4/text-to-image",
          "id": "fal-ai/recraft/v4/text-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/recraft-v4-text-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": null,
              "default": "square_hd",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "wan/v2.6/text-to-image",
          "id": "fal-ai/wan/v2.6/text-to-image",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/wan-v2-6-text-to-image.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "Output image size. If not set: matches input image size (up to 1280*1280). Use presets like 'square_hd', 'landscape_16_9', or specify exact dimensions.",
              "default": null,
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "xai/grok-imagine-image",
          "id": "fal-ai/xai/grok-imagine-image",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/xai-grok-imagine-image.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated image.",
              "default": "1:1",
              "stringEnums": [
                "2:1",
                "20:9",
                "19.5:9",
                "16:9",
                "4:3",
                "3:2",
                "1:1",
                "2:3",
                "3:4",
                "9:16",
                "9:19.5",
                "9:20",
                "1:2"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "z-image/turbo",
          "id": "fal-ai/z-image/turbo",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via image_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/image/z-image-turbo.json",
          "sizeFields": {
            "image_size": {
              "type": null,
              "description": "The size of the generated image.",
              "default": "landscape_4_3",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "black-forest-labs/flux-2-klein-9b",
          "id": "replicate/black-forest-labs/flux-2-klein-9b",
          "caseId": "CASE_J_MEGAPIXELS_WITH_ASPECT",
          "caseSummary": "Model expects megapixels plus aspect ratio.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/black-forest-labs-flux-2-klein-9b.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio for the generated image. Use 'match_input_image' to match the aspect ratio of the first input image.",
              "default": "1:1",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "megapixels",
              "text": "`Resolution` -> `megapixels`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "black-forest-labs/flux-2-max",
          "id": "replicate/black-forest-labs/flux-2-max",
          "caseId": "CASE_J_MEGAPIXELS_WITH_ASPECT",
          "caseSummary": "Model expects megapixels plus aspect ratio.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/black-forest-labs-flux-2-max.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio for the generated image. Use 'match_input_image' to match the first input image's aspect ratio.",
              "default": "1:1",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "height": {
              "type": "integer",
              "description": "Height of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": null,
              "description": "Resolution in megapixels. Up to 4 MP is possible, but 2 MP or below is recommended. The maximum image size is 2048x2048, which means that high-resolution images may not respect the resolution if aspect ratio is not 1:1.\n\nResolution is not used when aspect_ratio is 'custom'. When aspect_ratio is 'match_input_image', use 'match_input_image' to match the input image's resolution (clamped to 0.5-4 MP).",
              "default": "1 MP",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "width": {
              "type": "integer",
              "description": "Width of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "black-forest-labs/flux-2-pro",
          "id": "replicate/black-forest-labs/flux-2-pro",
          "caseId": "CASE_J_MEGAPIXELS_WITH_ASPECT",
          "caseSummary": "Model expects megapixels plus aspect ratio.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/black-forest-labs-flux-2-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio for the generated image. Use 'match_input_image' to match the first input image's aspect ratio.",
              "default": "1:1",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "height": {
              "type": "integer",
              "description": "Height of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": null,
              "description": "Resolution in megapixels. Up to 4 MP is possible, but 2 MP or below is recommended. The maximum image size is 2048x2048, which means that high-resolution images may not respect the resolution if aspect ratio is not 1:1.\n\nResolution is not used when aspect_ratio is 'custom'. When aspect_ratio is 'match_input_image', use 'match_input_image' to match the input image's resolution (clamped to 0.5-4 MP).",
              "default": "1 MP",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "width": {
              "type": "integer",
              "description": "Width of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 32 (if it's not, it will be rounded to nearest multiple of 32).",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 2048,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedream-4",
          "id": "replicate/bytedance/seedream-4",
          "caseId": "CASE_F_WIDTH_HEIGHT_FIELDS",
          "caseSummary": "Model expects explicit width and height fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/bytedance-seedream-4.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Image aspect ratio. Only used when size is not 'custom'. Use 'match_input_image' to automatically match the input image's aspect ratio.",
              "default": "match_input_image",
              "stringEnums": [
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
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "height": {
              "type": "integer",
              "description": "Custom image height (only used when size='custom'). Range: 1024-4096 pixels.",
              "default": 2048,
              "stringEnums": [],
              "minimum": 1024,
              "maximum": 4096,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "output_size": {
              "type": "string",
              "description": "Image resolution: 1K (1024px), 2K (2048px), 4K (4096px), or 'custom' for specific dimensions.",
              "default": "2K",
              "stringEnums": [
                "1K",
                "2K",
                "4K",
                "custom"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "size": {
              "type": "string",
              "description": "Image resolution: 1K (1024px), 2K (2048px), 4K (4096px), or 'custom' for specific dimensions.",
              "default": "2K",
              "stringEnums": [
                "1K",
                "2K",
                "4K",
                "custom"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "width": {
              "type": "integer",
              "description": "Custom image width (only used when size='custom'). Range: 1024-4096 pixels.",
              "default": 2048,
              "stringEnums": [],
              "minimum": 1024,
              "maximum": 4096,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "size",
              "text": "`Resolution` -> `size`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedream-4.5",
          "id": "replicate/bytedance/seedream-4.5",
          "caseId": "CASE_F_WIDTH_HEIGHT_FIELDS",
          "caseSummary": "Model expects explicit width and height fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/bytedance-seedream-4-5.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Image aspect ratio. Only used when size is not 'custom'. Use 'match_input_image' to automatically match the input image's aspect ratio.",
              "default": "match_input_image",
              "stringEnums": [
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
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "height": {
              "type": "integer",
              "description": "Custom image height (only used when size='custom'). Range: 1024-4096 pixels.",
              "default": 2048,
              "stringEnums": [],
              "minimum": 1024,
              "maximum": 4096,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "size": {
              "type": "string",
              "description": "Image resolution: 2K (2048px), 4K (4096px), or 'custom' for specific dimensions. Note: 1K resolution is not supported in Seedream 4.5.",
              "default": "2K",
              "stringEnums": [
                "2K",
                "4K",
                "custom"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "width": {
              "type": "integer",
              "description": "Custom image width (only used when size='custom'). Range: 1024-4096 pixels.",
              "default": 2048,
              "stringEnums": [],
              "minimum": 1024,
              "maximum": 4096,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "size",
              "text": "`Resolution` -> `size`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedream-5-lite",
          "id": "replicate/bytedance/seedream-5-lite",
          "caseId": "CASE_E_SIZE_TOKEN_OR_DIM_UNRESOLVED",
          "caseSummary": "Model has size field with unresolved enum/token references.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/bytedance-seedream-5-lite.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Image aspect ratio. Use 'match_input_image' to automatically match the input image's aspect ratio.",
              "default": "match_input_image",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "size": {
              "type": null,
              "description": "Image resolution: 2K (2048px) or 3K (3072px).",
              "default": "2K",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "size"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "size",
              "text": "`Resolution` -> `size`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "google/imagen-4",
          "id": "replicate/google/imagen-4",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/google-imagen-4.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated image",
              "default": "1:1",
              "stringEnums": [
                "1:1",
                "9:16",
                "16:9",
                "3:4",
                "4:3"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "google/nano-banana",
          "id": "replicate/google/nano-banana",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/google-nano-banana.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated image",
              "default": "match_input_image",
              "stringEnums": [
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
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "google/nano-banana-2",
          "id": "replicate/google/nano-banana-2",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/google-nano-banana-2.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated image",
              "default": "match_input_image",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution of the generated image. Higher resolutions take longer to generate.",
              "default": "1K",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "prunaai/p-image",
          "id": "replicate/prunaai/p-image",
          "caseId": "CASE_F_WIDTH_HEIGHT_FIELDS",
          "caseSummary": "Model expects explicit width and height fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/prunaai-p-image.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio for the generated image.",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "height": {
              "type": "integer",
              "description": "Height of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 16.",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 1440,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "width": {
              "type": "integer",
              "description": "Width of the generated image. Only used when aspect_ratio=custom. Must be a multiple of 16.",
              "default": null,
              "stringEnums": [],
              "minimum": 256,
              "maximum": 1440,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "prunaai/z-image-turbo",
          "id": "replicate/prunaai/z-image-turbo",
          "caseId": "CASE_F_WIDTH_HEIGHT_FIELDS",
          "caseSummary": "Model expects explicit width and height fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/prunaai-z-image-turbo.json",
          "sizeFields": {
            "height": {
              "type": "integer",
              "description": "Height of the generated image",
              "default": 1024,
              "stringEnums": [],
              "minimum": 64,
              "maximum": 1440,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "width": {
              "type": "integer",
              "description": "Width of the generated image",
              "default": 1024,
              "stringEnums": [],
              "minimum": 64,
              "maximum": 1440,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "ImageSize",
              "ruleType": "object",
              "source": "ImageSize",
              "field": null,
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": null,
              "text": "`ImageSize`: source=`ImageSize`, conditional=true"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "recraft-ai/recraft-v4",
          "id": "replicate/recraft-ai/recraft-v4",
          "caseId": "CASE_E_SIZE_DIMENSION_STRING",
          "caseSummary": "Model expects size dimension string.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/recraft-ai-recraft-v4.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated image",
              "default": "Not set",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "size": {
              "type": null,
              "description": "Width and height of the generated image. Size is ignored if an aspect ratio is set.",
              "default": "1024x1024",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "size"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "object",
              "source": "Resolution",
              "field": "size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": {
                "1K": "1024x1024",
                "2K": "2048x2048"
              },
              "text": "`Resolution`: source=`Resolution`, field=`size`, transform.entries=2"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "xai/grok-imagine-image",
          "id": "replicate/xai/grok-imagine-image",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/image/xai-grok-imagine-image.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated image. Ignored when editing an image.",
              "default": "1:1",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": []
        },
        {
          "provider": "wavespeed-ai",
          "model": "bytedance/seedream-v4.5",
          "id": "wavespeed-ai/bytedance/seedream-v4.5",
          "caseId": "CASE_E_SIZE_DIMENSION_STRING",
          "caseSummary": "Model expects size dimension string.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/wavespeed-ai/image/bytedance-seedream-v4-5.json",
          "sizeFields": {
            "size": {
              "type": "string",
              "description": "Specify the width and height pixel values of the generated image.",
              "default": "2048*2048",
              "stringEnums": [],
              "minimum": 1024,
              "maximum": 4096,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "object",
              "source": "Resolution",
              "field": "size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": null,
              "combineTable": null,
              "transformTable": {
                "1K": "1024*1024",
                "2K": "2048*2048",
                "4K": "4096*4096"
              },
              "text": "`Resolution`: source=`Resolution`, field=`size`, transform.entries=3"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/video/extend-video.yaml",
      "name": "Video Extension Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "ltx-2-19b/distilled/extend-video",
          "id": "fal-ai/ltx-2-19b/distilled/extend-video",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via video_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-19b-distilled-extend-video.json",
          "sizeFields": {
            "video_size": {
              "type": null,
              "description": "The size of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "video_size",
              "text": "`Resolution` -> `video_size`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2.3/extend-video",
          "id": "fal-ai/ltx-2.3/extend-video",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-3-extend-video.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/extend-video",
          "id": "fal-ai/veo3.1/extend-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-extend-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "object",
              "source": "Resolution",
              "field": null,
              "expand": true,
              "resolutionMode": "aspectRatioAndPresetObject",
              "aspectRatioField": "aspect_ratio",
              "presetField": "resolution",
              "combineInputs": null,
              "combineTable": null,
              "transformTable": null,
              "text": "`Resolution`: source=`Resolution`, expand=true, resolution.mode=`aspectRatioAndPresetObject` (aspectRatioField=`aspect_ratio`, presetField=`resolution`)"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/fast/extend-video",
          "id": "fal-ai/veo3.1/fast/extend-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-fast-extend-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "object",
              "source": "Resolution",
              "field": null,
              "expand": true,
              "resolutionMode": "aspectRatioAndPresetObject",
              "aspectRatioField": "aspect_ratio",
              "presetField": "resolution",
              "combineInputs": null,
              "combineTable": null,
              "transformTable": null,
              "text": "`Resolution`: source=`Resolution`, expand=true, resolution.mode=`aspectRatioAndPresetObject` (aspectRatioField=`aspect_ratio`, presetField=`resolution`)"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/video/image-to-video.yaml",
      "name": "Image-to-Video Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "bytedance/seedance/v1.5/pro/image-to-video",
          "id": "fal-ai/bytedance/seedance/v1.5/pro/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/bytedance-seedance-v1-5-pro-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "21:9",
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution - 480p for faster generation, 720p for balance",
              "default": "720p",
              "stringEnums": [
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "bytedance/seedance/v1/pro/fast/image-to-video",
          "id": "fal-ai/bytedance/seedance/v1/pro/fast/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/bytedance-seedance-v1-pro-fast-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "auto",
              "stringEnums": [
                "21:9",
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16",
                "auto"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution - 480p for faster generation, 720p for balance, 1080p for higher quality",
              "default": "1080p",
              "stringEnums": [
                "480p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "decart/lucy-14b/image-to-video",
          "id": "fal-ai/decart/lucy-14b/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/decart-lucy-14b-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated video.",
              "default": "16:9",
              "stringEnums": [
                "9:16",
                "16:9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the generated video",
              "default": "720p",
              "stringEnums": [
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/v2.5-turbo/pro/image-to-video",
          "id": "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-v2-5-turbo-pro-image-to-video.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/v2.6/pro/image-to-video",
          "id": "fal-ai/kling-video/v2.6/pro/image-to-video",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-v2-6-pro-image-to-video.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/v3/pro/image-to-video",
          "id": "fal-ai/kling-video/v3/pro/image-to-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-v3-pro-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video frame",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/v3/standard/image-to-video",
          "id": "fal-ai/kling-video/v3/standard/image-to-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-v3-standard-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video frame",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2-19b/distilled/image-to-video",
          "id": "fal-ai/ltx-2-19b/distilled/image-to-video",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via video_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-19b-distilled-image-to-video.json",
          "sizeFields": {
            "video_size": {
              "type": null,
              "description": "The size of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "VideoSize",
              "ruleType": "object",
              "source": "VideoSize",
              "field": "video_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "16:9+480p": {
                  "width": 848,
                  "height": 480
                },
                "16:9+720p": {
                  "width": 1280,
                  "height": 720
                },
                "9:16+480p": {
                  "width": 480,
                  "height": 848
                },
                "9:16+720p": {
                  "width": 720,
                  "height": 1280
                },
                "4:3+480p": {
                  "width": 640,
                  "height": 480
                },
                "4:3+720p": {
                  "width": 960,
                  "height": 720
                },
                "3:4+480p": {
                  "width": 480,
                  "height": 640
                },
                "3:4+720p": {
                  "width": 720,
                  "height": 960
                },
                "1:1+480p": {
                  "width": 512,
                  "height": 512
                },
                "1:1+720p": {
                  "width": 720,
                  "height": 720
                },
                "16:9+": "auto",
                "9:16+": "auto",
                "4:3+": "auto",
                "3:4+": "auto",
                "1:1+": "auto",
                "auto+": "auto"
              },
              "transformTable": null,
              "text": "`VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2.3/image-to-video",
          "id": "fal-ai/ltx-2.3/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-3-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video. If 'auto', the aspect ratio will be determined automatically based on the input image.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "1080p",
              "stringEnums": [
                "1080p",
                "1440p",
                "2160p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2.3/image-to-video/fast",
          "id": "fal-ai/ltx-2.3/image-to-video/fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-3-image-to-video-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "1080p",
              "stringEnums": [
                "1080p",
                "1440p",
                "2160p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "pixverse/v5/image-to-video",
          "id": "fal-ai/pixverse/v5/image-to-video",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/pixverse-v5-image-to-video.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "720p",
              "stringEnums": [
                "360p",
                "540p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "sora-2/image-to-video",
          "id": "fal-ai/sora-2/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/sora-2-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "auto",
              "stringEnums": [
                "auto",
                "9:16",
                "16:9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "auto",
              "stringEnums": [
                "auto",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "sora-2/image-to-video/pro",
          "id": "fal-ai/sora-2/image-to-video/pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/sora-2-image-to-video-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "auto",
              "stringEnums": [
                "auto",
                "9:16",
                "16:9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "auto",
              "stringEnums": [
                "auto",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/fast/image-to-video",
          "id": "fal-ai/veo3.1/fast/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-fast-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video. Only 16:9 and 9:16 are supported.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "1080p",
                "4k"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/image-to-video",
          "id": "fal-ai/veo3.1/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video. Only 16:9 and 9:16 are supported.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "vidu/q3/image-to-video",
          "id": "fal-ai/vidu/q3/image-to-video",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/vidu-q3-image-to-video.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Output video resolution. Note: 360p is not available when end_image_url is provided.",
              "default": "720p",
              "stringEnums": [
                "360p",
                "540p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "vidu/q3/image-to-video/turbo",
          "id": "fal-ai/vidu/q3/image-to-video/turbo",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/vidu-q3-image-to-video-turbo.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Output video resolution. Note: 360p is not available when end_image_url is provided.",
              "default": "720p",
              "stringEnums": [
                "360p",
                "540p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "wan-25-preview/image-to-video",
          "id": "fal-ai/wan-25-preview/image-to-video",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/wan-25-preview-image-to-video.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Video resolution. Valid values: 480p, 720p, 1080p",
              "default": "1080p",
              "stringEnums": [
                "480p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "wan/v2.6/image-to-video",
          "id": "fal-ai/wan/v2.6/image-to-video",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/wan-v2-6-image-to-video.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Video resolution. Valid values: 720p, 1080p",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "wan/v2.6/image-to-video/flash",
          "id": "fal-ai/wan/v2.6/image-to-video/flash",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/wan-v2-6-image-to-video-flash.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Video resolution. Valid values: 720p, 1080p",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "xai/grok-imagine-video/image-to-video",
          "id": "fal-ai/xai/grok-imagine-video/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/xai-grok-imagine-video-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "4:3",
                "3:2",
                "1:1",
                "2:3",
                "3:4",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the output video.",
              "default": "720p",
              "stringEnums": [
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedance-1-pro-fast",
          "id": "replicate/bytedance/seedance-1-pro-fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/bytedance-seedance-1-pro-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio. Ignored if an image is used.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16",
                "21:9",
                "9:21"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution",
              "default": "1080p",
              "stringEnums": [
                "480p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedance-1.5-pro",
          "id": "replicate/bytedance/seedance-1.5-pro",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/bytedance-seedance-1-5-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio. Ignored if an image is used.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16",
                "21:9",
                "9:21"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "google/veo-3.1-fast",
          "id": "replicate/google/veo-3.1-fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/google-veo-3-1-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the generated video",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-v2-5-turbo-pro",
          "id": "replicate/kwaivgi/kling-v2-5-turbo-pro",
          "caseId": "CASE_I_SCHEMA_UNRESOLVED",
          "caseSummary": "MODEL_NOT_FOUND",
          "schemaStatus": "MODEL_NOT_FOUND",
          "schemaPath": null,
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-v2-6",
          "id": "replicate/kwaivgi/kling-v2-6",
          "caseId": "CASE_I_SCHEMA_UNRESOLVED",
          "caseSummary": "MODEL_NOT_FOUND",
          "schemaStatus": "MODEL_NOT_FOUND",
          "schemaPath": null,
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-v3-video",
          "id": "replicate/kwaivgi/kling-v3-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/kwaivgi-kling-v3-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio. Ignored when start_image is provided.",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "lightricks/ltx-2.3-fast",
          "id": "replicate/lightricks/ltx-2.3-fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/lightricks-ltx-2-3-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution quality of the generated video. Only 1080p is supported for audio_to_video, retake, and extend tasks.",
              "default": "1080p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "lightricks/ltx-2.3-pro",
          "id": "replicate/lightricks/ltx-2.3-pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/lightricks-ltx-2-3-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution quality of the generated video. Only 1080p is supported for audio_to_video, retake, and extend tasks.",
              "default": "1080p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "minimax/hailuo-02",
          "id": "replicate/minimax/hailuo-02",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/minimax-hailuo-02.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Pick between standard 512p, 768p, or pro 1080p resolution. The pro model is not just high resolution, it is also higher quality.",
              "default": "1080p",
              "stringEnums": [
                "512p",
                "768p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "minimax/hailuo-02-fast",
          "id": "replicate/minimax/hailuo-02-fast",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/minimax-hailuo-02-fast.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "The resolution to render (should be 512P).",
              "default": "512P",
              "stringEnums": [
                "512P"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "minimax/hailuo-2.3",
          "id": "replicate/minimax/hailuo-2.3",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/minimax-hailuo-2-3.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Pick between 768p or 1080p resolution. 1080p supports only 6-second duration.",
              "default": "768p",
              "stringEnums": [
                "768p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "minimax/hailuo-2.3-fast",
          "id": "replicate/minimax/hailuo-2.3-fast",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/minimax-hailuo-2-3-fast.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Pick between 768p or 1080p resolution. 1080p supports only 6-second duration.",
              "default": "768p",
              "stringEnums": [
                "768p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "pixverse/pixverse-v5-6",
          "id": "replicate/pixverse/pixverse-v5-6",
          "caseId": "CASE_I_SCHEMA_UNRESOLVED",
          "caseSummary": "MODEL_NOT_FOUND",
          "schemaStatus": "MODEL_NOT_FOUND",
          "schemaPath": null,
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "runwayml/gen-4-5",
          "id": "replicate/runwayml/gen-4-5",
          "caseId": "CASE_I_SCHEMA_UNRESOLVED",
          "caseSummary": "MODEL_NOT_FOUND",
          "schemaStatus": "MODEL_NOT_FOUND",
          "schemaPath": null,
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "vidu/q3-pro",
          "id": "replicate/vidu/q3-pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/vidu-q3-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the output video. Only used in text-to-video mode (ignored when images are provided).",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution of the output video.",
              "default": "720p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "vidu/q3-turbo",
          "id": "replicate/vidu/q3-turbo",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/vidu-q3-turbo.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the output video. Only used in text-to-video mode (ignored when images are provided).",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution of the output video.",
              "default": "720p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "wan-video/wan-2.6-i2v",
          "id": "replicate/wan-video/wan-2.6-i2v",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/wan-video-wan-2-6-i2v.json",
          "sizeFields": {
            "resolution": {
              "type": null,
              "description": "Video resolution",
              "default": "720p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "wan-video/wan2.6-i2v-flash",
          "id": "replicate/wan-video/wan2.6-i2v-flash",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/wan-video-wan2-6-i2v-flash.json",
          "sizeFields": {
            "resolution": {
              "type": null,
              "description": "Video resolution",
              "default": "720p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "xai/grok-imagine-video",
          "id": "replicate/xai/grok-imagine-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/xai-grok-imagine-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the video. Ignored when editing a video or when providing an input image.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "9:16",
                "3:4",
                "3:2",
                "2:3"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the video. Ignored when editing a video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "480p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/video/ref-image-to-video.yaml",
      "name": "Reference-Image-to-Video Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "kling-video/o1/reference-to-video",
          "id": "fal-ai/kling-video/o1/reference-to-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-o1-reference-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video frame.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/o1/standard/reference-to-video",
          "id": "fal-ai/kling-video/o1/standard/reference-to-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-o1-standard-reference-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video frame.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/o3/pro/reference-to-video",
          "id": "fal-ai/kling-video/o3/pro/reference-to-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-o3-pro-reference-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video frame.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/o3/standard/reference-to-video",
          "id": "fal-ai/kling-video/o3/standard/reference-to-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-o3-standard-reference-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video frame.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/reference-to-video",
          "id": "fal-ai/veo3.1/reference-to-video",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-reference-to-video.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "wan/v2.6/reference-to-video/flash",
          "id": "fal-ai/wan/v2.6/reference-to-video/flash",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/wan-v2-6-reference-to-video-flash.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1",
                "4:3",
                "3:4"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution tier. R2V Flash only supports 720p and 1080p.",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedance-1-lite",
          "id": "replicate/bytedance/seedance-1-lite",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/bytedance-seedance-1-lite.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio. Ignored if an image is used.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16",
                "21:9",
                "9:21"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution",
              "default": "720p",
              "stringEnums": [
                "480p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-o1",
          "id": "replicate/kwaivgi/kling-o1",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/kwaivgi-kling-o1.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated video. Required for text-to-video. Ignored when using first frame image or video editing.",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-v3-omni-video",
          "id": "replicate/kwaivgi/kling-v3-omni-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/kwaivgi-kling-v3-omni-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio. Required when not using start frame or video editing.",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": []
        }
      ]
    },
    {
      "id": "catalog/producers/video/ref-video-to-video.yaml",
      "name": "Reference-Video-to-Video Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "wan/v2.6/reference-to-video",
          "id": "fal-ai/wan/v2.6/reference-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/wan-v2-6-reference-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1",
                "4:3",
                "3:4"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution tier. R2V only supports 720p and 1080p (no 480p).",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "wan/v2.6/reference-to-video/flash",
          "id": "fal-ai/wan/v2.6/reference-to-video/flash",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/wan-v2-6-reference-to-video-flash.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1",
                "4:3",
                "3:4"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution tier. R2V Flash only supports 720p and 1080p.",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/video/start-end-frame-to-video.yaml",
      "name": "Start-End Frame to Video Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "bytedance/seedance/v1.5/pro/image-to-video",
          "id": "fal-ai/bytedance/seedance/v1.5/pro/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/bytedance-seedance-v1-5-pro-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "21:9",
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution - 480p for faster generation, 720p for balance",
              "default": "720p",
              "stringEnums": [
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/v2.5-turbo/pro/image-to-video",
          "id": "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-v2-5-turbo-pro-image-to-video.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2-19b/distilled/image-to-video",
          "id": "fal-ai/ltx-2-19b/distilled/image-to-video",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via video_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-19b-distilled-image-to-video.json",
          "sizeFields": {
            "video_size": {
              "type": null,
              "description": "The size of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "VideoSize",
              "ruleType": "object",
              "source": "VideoSize",
              "field": "video_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "16:9+480p": {
                  "width": 848,
                  "height": 480
                },
                "16:9+720p": {
                  "width": 1280,
                  "height": 720
                },
                "9:16+480p": {
                  "width": 480,
                  "height": 848
                },
                "9:16+720p": {
                  "width": 720,
                  "height": 1280
                },
                "4:3+480p": {
                  "width": 640,
                  "height": 480
                },
                "4:3+720p": {
                  "width": 960,
                  "height": 720
                },
                "3:4+480p": {
                  "width": 480,
                  "height": 640
                },
                "3:4+720p": {
                  "width": 720,
                  "height": 960
                },
                "1:1+480p": {
                  "width": 512,
                  "height": 512
                },
                "1:1+720p": {
                  "width": 720,
                  "height": 720
                },
                "16:9+": "auto",
                "9:16+": "auto",
                "4:3+": "auto",
                "3:4+": "auto",
                "1:1+": "auto",
                "auto+": "auto"
              },
              "transformTable": null,
              "text": "`VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2.3/image-to-video",
          "id": "fal-ai/ltx-2.3/image-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-3-image-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video. If 'auto', the aspect ratio will be determined automatically based on the input image.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "1080p",
              "stringEnums": [
                "1080p",
                "1440p",
                "2160p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2.3/image-to-video/fast",
          "id": "fal-ai/ltx-2.3/image-to-video/fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-3-image-to-video-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "1080p",
              "stringEnums": [
                "1080p",
                "1440p",
                "2160p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/fast/first-last-frame-to-video",
          "id": "fal-ai/veo3.1/fast/first-last-frame-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-fast-first-last-frame-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/first-last-frame-to-video",
          "id": "fal-ai/veo3.1/first-last-frame-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-first-last-frame-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "1080p",
                "4k"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "vidu/q3/image-to-video",
          "id": "fal-ai/vidu/q3/image-to-video",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/vidu-q3-image-to-video.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Output video resolution. Note: 360p is not available when end_image_url is provided.",
              "default": "720p",
              "stringEnums": [
                "360p",
                "540p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "vidu/q3/image-to-video/turbo",
          "id": "fal-ai/vidu/q3/image-to-video/turbo",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/vidu-q3-image-to-video-turbo.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Output video resolution. Note: 360p is not available when end_image_url is provided.",
              "default": "720p",
              "stringEnums": [
                "360p",
                "540p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedance-1.5-pro",
          "id": "replicate/bytedance/seedance-1.5-pro",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/bytedance-seedance-1-5-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio. Ignored if an image is used.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16",
                "21:9",
                "9:21"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "google/veo-3.1-fast",
          "id": "replicate/google/veo-3.1-fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/google-veo-3-1-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the generated video",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-v2-5-turbo-pro",
          "id": "replicate/kwaivgi/kling-v2-5-turbo-pro",
          "caseId": "CASE_I_SCHEMA_UNRESOLVED",
          "caseSummary": "MODEL_NOT_FOUND",
          "schemaStatus": "MODEL_NOT_FOUND",
          "schemaPath": null,
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-v3-video",
          "id": "replicate/kwaivgi/kling-v3-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/kwaivgi-kling-v3-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio. Ignored when start_image is provided.",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "lightricks/ltx-2.3-fast",
          "id": "replicate/lightricks/ltx-2.3-fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/lightricks-ltx-2-3-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution quality of the generated video. Only 1080p is supported for audio_to_video, retake, and extend tasks.",
              "default": "1080p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "lightricks/ltx-2.3-pro",
          "id": "replicate/lightricks/ltx-2.3-pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/lightricks-ltx-2-3-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution quality of the generated video. Only 1080p is supported for audio_to_video, retake, and extend tasks.",
              "default": "1080p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "minimax/hailuo-02",
          "id": "replicate/minimax/hailuo-02",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/minimax-hailuo-02.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Pick between standard 512p, 768p, or pro 1080p resolution. The pro model is not just high resolution, it is also higher quality.",
              "default": "1080p",
              "stringEnums": [
                "512p",
                "768p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "minimax/hailuo-02-fast",
          "id": "replicate/minimax/hailuo-02-fast",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/minimax-hailuo-02-fast.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "The resolution to render (should be 512P).",
              "default": "512P",
              "stringEnums": [
                "512P"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "pixverse/pixverse-v5-6",
          "id": "replicate/pixverse/pixverse-v5-6",
          "caseId": "CASE_I_SCHEMA_UNRESOLVED",
          "caseSummary": "MODEL_NOT_FOUND",
          "schemaStatus": "MODEL_NOT_FOUND",
          "schemaPath": null,
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "vidu/q3-pro",
          "id": "replicate/vidu/q3-pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/vidu-q3-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the output video. Only used in text-to-video mode (ignored when images are provided).",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution of the output video.",
              "default": "720p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "vidu/q3-turbo",
          "id": "replicate/vidu/q3-turbo",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/vidu-q3-turbo.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the output video. Only used in text-to-video mode (ignored when images are provided).",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution of the output video.",
              "default": "720p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/video/talking-head.yaml",
      "name": "Talking Head Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "bytedance/omnihuman/v1.5",
          "id": "fal-ai/bytedance/omnihuman/v1.5",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/bytedance-omnihuman-v1-5.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video. Defaults to 1080p. 720p generation is faster and higher in quality. 1080p generation is limited to 30s audio and 720p generation is limited to 60s audio.",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "creatify/aurora",
          "id": "fal-ai/creatify/aurora",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/creatify-aurora.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "infinitalk",
          "id": "fal-ai/infinitalk",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/infinitalk.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Resolution of the video to generate. Must be either 480p or 720p.",
              "default": "480p",
              "stringEnums": [
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/ai-avatar/v2/pro",
          "id": "fal-ai/kling-video/ai-avatar/v2/pro",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-ai-avatar-v2-pro.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/ai-avatar/v2/standard",
          "id": "fal-ai/kling-video/ai-avatar/v2/standard",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-ai-avatar-v2-standard.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2-19b/audio-to-video",
          "id": "fal-ai/ltx-2-19b/audio-to-video",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via video_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-19b-audio-to-video.json",
          "sizeFields": {
            "video_size": {
              "type": null,
              "description": "The size of the generated video. Use 'auto' to match the input image dimensions if provided.",
              "default": "landscape_4_3",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "VideoSize",
              "ruleType": "object",
              "source": "VideoSize",
              "field": "video_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "16:9+480p": {
                  "width": 848,
                  "height": 480
                },
                "16:9+720p": {
                  "width": 1280,
                  "height": 720
                },
                "9:16+480p": {
                  "width": 480,
                  "height": 848
                },
                "9:16+720p": {
                  "width": 720,
                  "height": 1280
                },
                "4:3+480p": {
                  "width": 640,
                  "height": 480
                },
                "4:3+720p": {
                  "width": 960,
                  "height": 720
                },
                "3:4+480p": {
                  "width": 480,
                  "height": 640
                },
                "3:4+720p": {
                  "width": 720,
                  "height": 960
                },
                "1:1+480p": {
                  "width": 512,
                  "height": 512
                },
                "1:1+720p": {
                  "width": 720,
                  "height": 720
                },
                "16:9+": "landscape_16_9",
                "9:16+": "portrait_16_9",
                "4:3+": "landscape_4_3",
                "3:4+": "portrait_4_3",
                "1:1+": "square_hd"
              },
              "transformTable": null,
              "text": "`VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2-19b/distilled/audio-to-video",
          "id": "fal-ai/ltx-2-19b/distilled/audio-to-video",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via video_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-19b-distilled-audio-to-video.json",
          "sizeFields": {
            "video_size": {
              "type": null,
              "description": "The size of the generated video. Use 'auto' to match the input image dimensions if provided.",
              "default": "landscape_4_3",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "VideoSize",
              "ruleType": "object",
              "source": "VideoSize",
              "field": "video_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "16:9+480p": {
                  "width": 848,
                  "height": 480
                },
                "16:9+720p": {
                  "width": 1280,
                  "height": 720
                },
                "9:16+480p": {
                  "width": 480,
                  "height": 848
                },
                "9:16+720p": {
                  "width": 720,
                  "height": 1280
                },
                "4:3+480p": {
                  "width": 640,
                  "height": 480
                },
                "4:3+720p": {
                  "width": 960,
                  "height": 720
                },
                "3:4+480p": {
                  "width": 480,
                  "height": 640
                },
                "3:4+720p": {
                  "width": 720,
                  "height": 960
                },
                "1:1+480p": {
                  "width": 512,
                  "height": 512
                },
                "1:1+720p": {
                  "width": 720,
                  "height": 720
                },
                "16:9+": "landscape_16_9",
                "9:16+": "portrait_16_9",
                "4:3+": "landscape_4_3",
                "3:4+": "portrait_4_3",
                "1:1+": "square_hd"
              },
              "transformTable": null,
              "text": "`VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2.3/audio-to-video",
          "id": "fal-ai/ltx-2.3/audio-to-video",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-3-audio-to-video.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "veed/fabric-1.0/fast",
          "id": "fal-ai/veed/fabric-1.0/fast",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veed-fabric-1-0-fast.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Resolution",
              "default": null,
              "stringEnums": [
                "720p",
                "480p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-avatar-v2",
          "id": "replicate/kwaivgi/kling-avatar-v2",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/kwaivgi-kling-avatar-v2.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "wavespeed-ai",
          "model": "wavespeed-ai/infinitetalk",
          "id": "wavespeed-ai/wavespeed-ai/infinitetalk",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/wavespeed-ai/video/wavespeed-ai-infinitetalk.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "The resolution of the output video.",
              "default": "480p",
              "stringEnums": [
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/video/text-to-talking-head.yaml",
      "name": "Text-to-Talking-Head Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "infinitalk/single-text",
          "id": "fal-ai/infinitalk/single-text",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/infinitalk-single-text.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Resolution of the video to generate. Must be either 480p or 720p.",
              "default": "480p",
              "stringEnums": [
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veed/fabric-1.0/text",
          "id": "fal-ai/veed/fabric-1.0/text",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veed-fabric-1-0-text.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Resolution",
              "default": null,
              "stringEnums": [
                "720p",
                "480p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/video/text-to-video.yaml",
      "name": "Text-to-Video Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "bytedance/seedance/v1.5/pro/text-to-video",
          "id": "fal-ai/bytedance/seedance/v1.5/pro/text-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/bytedance-seedance-v1-5-pro-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "21:9",
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution - 480p for faster generation, 720p for balance",
              "default": "720p",
              "stringEnums": [
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "bytedance/seedance/v1/pro/fast/text-to-video",
          "id": "fal-ai/bytedance/seedance/v1/pro/fast/text-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/bytedance-seedance-v1-pro-fast-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "21:9",
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution - 480p for faster generation, 720p for balance, 1080p for higher quality",
              "default": "1080p",
              "stringEnums": [
                "480p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/v3/pro/text-to-video",
          "id": "fal-ai/kling-video/v3/pro/text-to-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-v3-pro-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video frame",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "kling-video/v3/standard/text-to-video",
          "id": "fal-ai/kling-video/v3/standard/text-to-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/kling-video-v3-standard-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video frame",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2-19b/distilled/text-to-video",
          "id": "fal-ai/ltx-2-19b/distilled/text-to-video",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via video_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-19b-distilled-text-to-video.json",
          "sizeFields": {
            "video_size": {
              "type": null,
              "description": "The size of the generated video.",
              "default": "landscape_4_3",
              "stringEnums": [
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "VideoSize",
              "ruleType": "object",
              "source": "VideoSize",
              "field": "video_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "16:9+480p": {
                  "width": 848,
                  "height": 480
                },
                "16:9+720p": {
                  "width": 1280,
                  "height": 720
                },
                "9:16+480p": {
                  "width": 480,
                  "height": 848
                },
                "9:16+720p": {
                  "width": 720,
                  "height": 1280
                },
                "4:3+480p": {
                  "width": 640,
                  "height": 480
                },
                "4:3+720p": {
                  "width": 960,
                  "height": 720
                },
                "3:4+480p": {
                  "width": 480,
                  "height": 640
                },
                "3:4+720p": {
                  "width": 720,
                  "height": 960
                },
                "1:1+480p": {
                  "width": 512,
                  "height": 512
                },
                "1:1+720p": {
                  "width": 720,
                  "height": 720
                },
                "16:9+": "landscape_16_9",
                "9:16+": "portrait_16_9",
                "4:3+": "landscape_4_3",
                "3:4+": "portrait_4_3",
                "1:1+": "square_hd"
              },
              "transformTable": null,
              "text": "`VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2.3/text-to-video",
          "id": "fal-ai/ltx-2.3/text-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-3-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "1080p",
              "stringEnums": [
                "1080p",
                "1440p",
                "2160p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "pixverse/v5/text-to-video",
          "id": "fal-ai/pixverse/v5/text-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/pixverse-v5-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "720p",
              "stringEnums": [
                "360p",
                "540p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "sora-2/text-to-video",
          "id": "fal-ai/sora-2/text-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/sora-2-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "9:16",
                "16:9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video",
              "default": "720p",
              "stringEnums": [
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1",
          "id": "fal-ai/veo3.1",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "1080p",
                "4k"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/fast",
          "id": "fal-ai/veo3.1/fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "vidu/q3/text-to-video",
          "id": "fal-ai/vidu/q3/text-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/vidu-q3-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the output video",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "4:3",
                "3:4",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Output video resolution",
              "default": "720p",
              "stringEnums": [
                "360p",
                "540p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "vidu/q3/text-to-video/turbo",
          "id": "fal-ai/vidu/q3/text-to-video/turbo",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/vidu-q3-text-to-video-turbo.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the output video",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "4:3",
                "3:4",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Output video resolution",
              "default": "720p",
              "stringEnums": [
                "360p",
                "540p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "wan-25-preview/text-to-video",
          "id": "fal-ai/wan-25-preview/text-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/wan-25-preview-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution tier",
              "default": "1080p",
              "stringEnums": [
                "480p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "wan/v2.6/text-to-video",
          "id": "fal-ai/wan/v2.6/text-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/wan-v2-6-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video. Wan 2.6 supports additional ratios.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16",
                "1:1",
                "4:3",
                "3:4"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution tier. Wan 2.6 T2V only supports 720p and 1080p (no 480p).",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "xai/grok-imagine-video/text-to-video",
          "id": "fal-ai/xai/grok-imagine-video/text-to-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/xai-grok-imagine-video-text-to-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the generated video.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "3:2",
                "1:1",
                "2:3",
                "3:4",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the output video.",
              "default": "720p",
              "stringEnums": [
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedance-1-lite",
          "id": "replicate/bytedance/seedance-1-lite",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/bytedance-seedance-1-lite.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio. Ignored if an image is used.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16",
                "21:9",
                "9:21"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution",
              "default": "720p",
              "stringEnums": [
                "480p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedance-1-pro-fast",
          "id": "replicate/bytedance/seedance-1-pro-fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/bytedance-seedance-1-pro-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio. Ignored if an image is used.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16",
                "21:9",
                "9:21"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Video resolution",
              "default": "1080p",
              "stringEnums": [
                "480p",
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "bytedance/seedance-1.5-pro",
          "id": "replicate/bytedance/seedance-1.5-pro",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/bytedance-seedance-1-5-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio. Ignored if an image is used.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "3:4",
                "9:16",
                "21:9",
                "9:21"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "google/veo-3.1-fast",
          "id": "replicate/google/veo-3.1-fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/google-veo-3-1-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Video aspect ratio",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the generated video",
              "default": "1080p",
              "stringEnums": [
                "720p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-v2-6",
          "id": "replicate/kwaivgi/kling-v2-6",
          "caseId": "CASE_I_SCHEMA_UNRESOLVED",
          "caseSummary": "MODEL_NOT_FOUND",
          "schemaStatus": "MODEL_NOT_FOUND",
          "schemaPath": null,
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "kwaivgi/kling-v3-video",
          "id": "replicate/kwaivgi/kling-v3-video",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/kwaivgi-kling-v3-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio. Ignored when start_image is provided.",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio"
          ],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "lightricks/ltx-2.3-fast",
          "id": "replicate/lightricks/ltx-2.3-fast",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/lightricks-ltx-2-3-fast.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution quality of the generated video. Only 1080p is supported for audio_to_video, retake, and extend tasks.",
              "default": "1080p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "lightricks/ltx-2.3-pro",
          "id": "replicate/lightricks/ltx-2.3-pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/lightricks-ltx-2-3-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the generated video",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution quality of the generated video. Only 1080p is supported for audio_to_video, retake, and extend tasks.",
              "default": "1080p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "minimax/hailuo-2.3",
          "id": "replicate/minimax/hailuo-2.3",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/minimax-hailuo-2-3.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Pick between 768p or 1080p resolution. 1080p supports only 6-second duration.",
              "default": "768p",
              "stringEnums": [
                "768p",
                "1080p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "openai/sora-2",
          "id": "replicate/openai/sora-2",
          "caseId": "CASE_G_ASPECT_ONLY",
          "caseSummary": "Model expects aspect ratio only.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/openai-sora-2.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the video. Portrait is 720x1280, landscape is 1280x720",
              "default": "portrait",
              "stringEnums": [
                "portrait",
                "landscape"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "pixverse/pixverse-v5-6",
          "id": "replicate/pixverse/pixverse-v5-6",
          "caseId": "CASE_I_SCHEMA_UNRESOLVED",
          "caseSummary": "MODEL_NOT_FOUND",
          "schemaStatus": "MODEL_NOT_FOUND",
          "schemaPath": null,
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "runwayml/gen-4-5",
          "id": "replicate/runwayml/gen-4-5",
          "caseId": "CASE_I_SCHEMA_UNRESOLVED",
          "caseSummary": "MODEL_NOT_FOUND",
          "schemaStatus": "MODEL_NOT_FOUND",
          "schemaPath": null,
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "vidu/q3-pro",
          "id": "replicate/vidu/q3-pro",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/vidu-q3-pro.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the output video. Only used in text-to-video mode (ignored when images are provided).",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution of the output video.",
              "default": "720p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "vidu/q3-turbo",
          "id": "replicate/vidu/q3-turbo",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/vidu-q3-turbo.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": null,
              "description": "Aspect ratio of the output video. Only used in text-to-video mode (ignored when images are provided).",
              "default": "16:9",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            },
            "resolution": {
              "type": null,
              "description": "Resolution of the output video.",
              "default": "720p",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "aspect_ratio",
            "resolution"
          ],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "wan-video/wan-2.6-t2v",
          "id": "replicate/wan-video/wan-2.6-t2v",
          "caseId": "CASE_E_SIZE_DIMENSION_STRING",
          "caseSummary": "Model expects size dimension string.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/wan-video-wan-2-6-t2v.json",
          "sizeFields": {
            "size": {
              "type": null,
              "description": "Video resolution and aspect ratio",
              "default": "1280*720",
              "stringEnums": [],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": true
            }
          },
          "unresolvedRefFields": [
            "size"
          ],
          "mappingRules": []
        },
        {
          "provider": "replicate",
          "model": "xai/grok-imagine-video",
          "id": "replicate/xai/grok-imagine-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/xai-grok-imagine-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the video. Ignored when editing a video or when providing an input image.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "9:16",
                "3:4",
                "3:2",
                "2:3"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the video. Ignored when editing a video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "480p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/video/video-edit.yaml",
      "name": "Video Edit Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "decart/lucy-edit/fast",
          "id": "fal-ai/decart/lucy-edit/fast",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/decart-lucy-edit-fast.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "decart/lucy-edit/pro",
          "id": "fal-ai/decart/lucy-edit/pro",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/decart-lucy-edit-pro.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Resolution of the generated video",
              "default": "720p",
              "stringEnums": [
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2.3/retake-video",
          "id": "fal-ai/ltx-2.3/retake-video",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-3-retake-video.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "xai/grok-imagine-video/edit-video",
          "id": "fal-ai/xai/grok-imagine-video/edit-video",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/xai-grok-imagine-video-edit-video.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Resolution of the output video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "xai/grok-imagine-video",
          "id": "replicate/xai/grok-imagine-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/xai-grok-imagine-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the video. Ignored when editing a video or when providing an input image.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "9:16",
                "3:4",
                "3:2",
                "2:3"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the video. Ignored when editing a video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "480p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        }
      ]
    },
    {
      "id": "catalog/producers/video/video-to-video.yaml",
      "name": "Video-to-Video Generator",
      "rows": [
        {
          "provider": "fal-ai",
          "model": "decart/lucy-edit/fast",
          "id": "fal-ai/decart/lucy-edit/fast",
          "caseId": "CASE_H_NO_SIZE_FIELD",
          "caseSummary": "Schema has no size/aspect fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/decart-lucy-edit-fast.json",
          "sizeFields": {},
          "unresolvedRefFields": [],
          "mappingRules": []
        },
        {
          "provider": "fal-ai",
          "model": "decart/lucy-edit/pro",
          "id": "fal-ai/decart/lucy-edit/pro",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/decart-lucy-edit-pro.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Resolution of the generated video",
              "default": "720p",
              "stringEnums": [
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2-19b/distilled/extend-video",
          "id": "fal-ai/ltx-2-19b/distilled/extend-video",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via video_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-19b-distilled-extend-video.json",
          "sizeFields": {
            "video_size": {
              "type": null,
              "description": "The size of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "VideoSize",
              "ruleType": "object",
              "source": "VideoSize",
              "field": "video_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "16:9+480p": {
                  "width": 848,
                  "height": 480
                },
                "16:9+720p": {
                  "width": 1280,
                  "height": 720
                },
                "9:16+480p": {
                  "width": 480,
                  "height": 848
                },
                "9:16+720p": {
                  "width": 720,
                  "height": 1280
                },
                "4:3+480p": {
                  "width": 640,
                  "height": 480
                },
                "4:3+720p": {
                  "width": 960,
                  "height": 720
                },
                "3:4+480p": {
                  "width": 480,
                  "height": 640
                },
                "3:4+720p": {
                  "width": 720,
                  "height": 960
                },
                "1:1+480p": {
                  "width": 512,
                  "height": 512
                },
                "1:1+720p": {
                  "width": 720,
                  "height": 720
                },
                "16:9+": "auto",
                "9:16+": "auto",
                "4:3+": "auto",
                "3:4+": "auto",
                "1:1+": "auto",
                "auto+": "auto"
              },
              "transformTable": null,
              "text": "`VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "ltx-2-19b/distilled/video-to-video",
          "id": "fal-ai/ltx-2-19b/distilled/video-to-video",
          "caseId": "CASE_C_SIZE_OBJECT",
          "caseSummary": "Model accepts object size via video_size.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/ltx-2-19b-distilled-video-to-video.json",
          "sizeFields": {
            "video_size": {
              "type": null,
              "description": "The size of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "square_hd",
                "square",
                "portrait_4_3",
                "portrait_16_9",
                "landscape_4_3",
                "landscape_16_9"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": true,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "VideoSize",
              "ruleType": "object",
              "source": "VideoSize",
              "field": "video_size",
              "expand": false,
              "resolutionMode": null,
              "aspectRatioField": null,
              "presetField": null,
              "combineInputs": [
                "AspectRatio",
                "Resolution"
              ],
              "combineTable": {
                "16:9+480p": {
                  "width": 848,
                  "height": 480
                },
                "16:9+720p": {
                  "width": 1280,
                  "height": 720
                },
                "9:16+480p": {
                  "width": 480,
                  "height": 848
                },
                "9:16+720p": {
                  "width": 720,
                  "height": 1280
                },
                "4:3+480p": {
                  "width": 640,
                  "height": 480
                },
                "4:3+720p": {
                  "width": 960,
                  "height": 720
                },
                "3:4+480p": {
                  "width": 480,
                  "height": 640
                },
                "3:4+720p": {
                  "width": 720,
                  "height": 960
                },
                "1:1+480p": {
                  "width": 512,
                  "height": 512
                },
                "1:1+720p": {
                  "width": 720,
                  "height": 720
                },
                "16:9+": "auto",
                "9:16+": "auto",
                "4:3+": "auto",
                "3:4+": "auto",
                "1:1+": "auto",
                "auto+": "auto"
              },
              "transformTable": null,
              "text": "`VideoSize`: source=`VideoSize`, field=`video_size`, combine.inputs=[AspectRatio, Resolution]"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/extend-video",
          "id": "fal-ai/veo3.1/extend-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-extend-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "veo3.1/fast/extend-video",
          "id": "fal-ai/veo3.1/fast/extend-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/veo3-1-fast-extend-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "The aspect ratio of the generated video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "16:9",
                "9:16"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "The resolution of the generated video.",
              "default": "720p",
              "stringEnums": [
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "fal-ai",
          "model": "xai/grok-imagine-video/edit-video",
          "id": "fal-ai/xai/grok-imagine-video/edit-video",
          "caseId": "CASE_B_RESOLUTION_PRESET_ONLY",
          "caseSummary": "Model expects resolution preset field.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/fal-ai/video/xai-grok-imagine-video-edit-video.json",
          "sizeFields": {
            "resolution": {
              "type": "string",
              "description": "Resolution of the output video.",
              "default": "auto",
              "stringEnums": [
                "auto",
                "480p",
                "720p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        },
        {
          "provider": "replicate",
          "model": "xai/grok-imagine-video",
          "id": "replicate/xai/grok-imagine-video",
          "caseId": "CASE_A_ASPECT_PLUS_PRESET",
          "caseSummary": "Model expects aspect_ratio and resolution fields.",
          "schemaStatus": "OK",
          "schemaPath": "catalog/models/replicate/video/xai-grok-imagine-video.json",
          "sizeFields": {
            "aspect_ratio": {
              "type": "string",
              "description": "Aspect ratio of the video. Ignored when editing a video or when providing an input image.",
              "default": "16:9",
              "stringEnums": [
                "16:9",
                "4:3",
                "1:1",
                "9:16",
                "3:4",
                "3:2",
                "2:3"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            },
            "resolution": {
              "type": "string",
              "description": "Resolution of the video. Ignored when editing a video.",
              "default": "720p",
              "stringEnums": [
                "720p",
                "480p"
              ],
              "minimum": null,
              "maximum": null,
              "exclusiveMinimum": null,
              "exclusiveMaximum": null,
              "multipleOf": null,
              "hasObjectCapability": false,
              "unresolvedRefAllOf": false
            }
          },
          "unresolvedRefFields": [],
          "mappingRules": [
            {
              "alias": "Resolution",
              "ruleType": "direct",
              "source": "Resolution",
              "field": "resolution",
              "text": "`Resolution` -> `resolution`"
            }
          ]
        }
      ]
    }
  ]
};
