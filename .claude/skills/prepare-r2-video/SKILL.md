---
name: prepare-r2-video
description: Convert a local video into a web-friendly video asset for Cloudflare R2. Inspects the source with ffprobe, encodes with ffmpeg while preserving aspect ratio, and asks for explicit confirmation before running npx wrangler upload.
disable-model-invocation: true
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion
---

# Prepare R2 Video

Convert a local video into a web-optimized MP4 and upload it to a Cloudflare R2 bucket.

## When to Use

Use this skill when a user wants to publish or iterate on a video hosted on Cloudflare R2.

## Workflow

### Step 1: Collect Required Inputs

R2 bucket name: videos
Public hostname for verification: videos.gorenku.com
Versioned key format: videos/{filename}-v{version}.mp4 (for example, `videos/renku-hero-v1.mp4`)

Collect and confirm all remaining required inputs before running commands:

- Source video absolute path (extract filename without extension for output key)
- Version number for the output key (for example, `1` for `videos/renku-hero-v1.mp4`)

Collect optional inputs when relevant:

- Encoded output path
- Poster frame output path

Do not guess missing required values. Ask for missing values explicitly.

### Step 2: Run Tooling Preflight

Run:

```bash
ffprobe -version
ffmpeg -version
npx wrangler r2 object put --help
```

Stop and report the missing dependency if any command fails.

### Step 3: Assess Source Video

Run:

```bash
ffprobe -hide_banner -v error -show_format -show_streams "<source>"
```

Report the source profile:

- Codec
- Width and height
- Frame rate
- Duration
- Bit rate
- Container format
- Audio stream presence

Preserve aspect ratio end-to-end. Never crop or stretch.

### Step 4: Encode with ffmpeg

Use this baseline encode profile unless the user explicitly requests a different one:

```bash
ffmpeg -i "<source>" \
  -an \
  -vf "fps=30,format=yuv420p" \
  -c:v libx264 -preset slow -crf 23 \
  -profile:v high -level 4.1 \
  -movflags +faststart \
  "<output>.mp4"
```

Encoding notes:

- Keep dimensions unchanged by default so the original aspect ratio is preserved.
- Use `+faststart` for faster playback startup.
- Remove audio (`-an`) for silent background or loop playback. Keep audio only when explicitly requested.

### Step 5: Validate Encoded Output

Run:

```bash
ffprobe -hide_banner -v error -show_format -show_streams "<output>.mp4"
```

Confirm and report:

- `codec_name=h264`
- `pix_fmt=yuv420p`
- Expected dimensions/aspect ratio
- Audio stream behavior matches the user request
- Source size vs output size

### Step 6: Optional Poster Extraction

When poster output is requested, run:

```bash
ffmpeg -ss 00:00:01 -i "<output>.mp4" -frames:v 1 -q:v 2 "<poster>.jpg"
```

### Step 7: Prepare Upload Command and Ask Before Executing

Build the upload command:

```bash
npx wrangler r2 object put "<bucket>/<key>" \
  --file "<output>.mp4" \
  --remote \
  --content-type "video/mp4" \
  --cache-control "public, max-age=31536000, immutable"
```

Ask for explicit confirmation before executing the command. Include:

- Bucket and key
- Local file path
- Full upload command

Do not upload until confirmation is received.

### Step 8: Upload and Verify Delivery

After confirmation, run upload and verify public delivery:

```bash
curl -I "https://<public-host>/<key>"
curl -I -H "Range: bytes=0-1023" "https://<public-host>/<key>"
```

Check and report:

- `200` for object HEAD request
- `206` for range request
- `content-type: video/mp4`

### Step 9: Recommend Cache Rule for Production

Recommend a Cloudflare Cache Rule on the custom domain:

- Match host equals video domain and path starts with the video prefix (for example `/videos/`)
- Set cache eligibility to cache
- Set Edge TTL to 1 year
- Ignore query string in cache key to reduce bot-driven cache fragmentation

Prefer custom domain delivery over `r2.dev` for production traffic.

### Step 10: Optional Cache Behavior Verification

After a cache rule is enabled, verify cache behavior on the published URL:

```bash
curl -sI "https://<public-host>/<key>" | grep -i "cf-cache-status"
```

Interpretation:

- `cf-cache-status: MISS` can be expected on a first request at an edge
- `cf-cache-status: HIT` confirms serving from Cloudflare edge cache

When Smart Tiered Cache is enabled, an edge MISS can be satisfied by the upper tier before reaching R2.

### Step 11: Support Iterative Updates

For each new encode, use a new versioned key such as:

- `videos/renku-hero-v1.mp4`
- `videos/renku-hero-v2.mp4`

Avoid overwriting existing keys unless explicitly requested.
