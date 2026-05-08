# Snoolink Lens

Snoolink Lens is an Electron desktop app to scan media folders, index image/video metadata, and search with semantic ranking plus practical filters.

It is designed for fast local workflows first, with optional cloud enrichment.

## Features Overview

- Scan local drives and custom folders for images and videos.
- Build a persistent master catalog with stable item IDs.
- Run local indexing for rich technical and content metadata.
- Run optional cloud indexing for description + OCR metadata.
- Use semantic search with query expansion and intent-aware matching.
- Filter with dynamic metadata controls (including multi-select tag filters).
- Review people groups in the Faces workspace and assign names.

## Install and Run Desktop App

### Prerequisites

- Node.js LTS (recommended)
- Windows (primary target)

### Install dependencies

```powershell
npm install
```

### Start in development mode

```powershell
npm start
```

### Build shareable desktop app

Windows (installer + portable):

```powershell
npm run dist:all
```

macOS:

```bash
npm install --include=optional
npm run dist:mac
# or
npm run dist:mac:universal
```

## Developer Setup (Windows + macOS)

Use this if you are cloning the repo and starting development from scratch.

### 1) Clone and install Node dependencies

Windows (PowerShell):

```powershell
git clone <your-repo-url>
cd snoolink-lens
npm install
```

macOS (Terminal):

```bash
git clone <your-repo-url>
cd snoolink-lens
npm install
```

### 2) Initialize environment file (recommended)

The app can seed `.env` automatically on first run, but you can also create it manually.

Windows (PowerShell):

```powershell
Copy-Item .\config\default.env .\.env
```

macOS (Terminal):

```bash
cp ./config/default.env ./.env
```

Then edit `.env` if you plan to use cloud indexing:

- AWS_REGION
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- BEDROCK_VISION_MODEL

### 3) Create Python virtual environment (optional)

Python is optional for the Electron app runtime, but useful for helper scripts and experiments.

Windows (PowerShell):

```powershell
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
```

macOS (Terminal):

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt
```

Notes:

- `requirements-face.txt` is legacy/reference and currently does not install required packages.
- Main local face indexing in the app uses Node/Electron face-api backend.

### 4) Face model setup

Face-api model manifests are already in `models/face-api/`.

By default, the app resolves model files from the project model folder. If you need a custom path, set:

- `FACE_API_MODEL_DIR`

Example (Windows PowerShell):

```powershell
$env:FACE_API_MODEL_DIR = "C:\path\to\snoolink-lens\models\face-api"
```

Example (macOS Terminal):

```bash
export FACE_API_MODEL_DIR="/path/to/snoolink-lens/models/face-api"
```

### 5) Run the app in dev mode

Windows or macOS:

```bash
npm start
```

## How the App Works (End-to-End)

1. Scan creates or refreshes the master media catalog.
2. Indexing enriches catalog items with local or cloud metadata.
3. Search ranks matches with semantic + lexical + fuzzy signals.
4. Filtering narrows results with metadata rules.
5. Preview merges local + cloud details in one panel.

## Data Models and Metrics

### 1) Master directory model

File: data/master_image_directory.json

Purpose:

- Source-of-truth catalog for discovered media.
- Stable IDs used by indexing and UI.

Main fields:

- generated_at
- total
- items[]
  - id
  - path
  - name
  - extension
  - directory
  - size_bytes
  - created_at
  - modified_at

Key metrics from this model:

- Total catalog size: total
- New vs existing items after scan
- Media distribution by extension/directory

### 2) Local indexing model

File: data/local-image_metadata_results.json

Purpose:

- Technical/content metadata from local extractors.
- Primary source for local filtering.

Main fields:

- generated_at
- results[]
  - id
  - path
  - status
  - metadata (normalized searchable fields)
  - local_metadata (detailed technical payload)
  - error (if failed)

Important metrics:

- Indexed rows count
- Success/failure count by status
- Orientation distribution (portrait/landscape/square)
- Size-category distribution
- Brightness/style distributions

### 3) Cloud indexing model

File: data/cloud-image_metadata_results.json

Purpose:

- Bedrock-generated semantic description and OCR data.

Main fields:

- generated_at
- model
- results[]
  - id
  - image_path
  - description
  - ocr
  - status
  - error

Important metrics:

- Cloud success/failure counts
- Average OCR text coverage per item
- Description richness (token count)

### 4) Face clustering model

File: data/local_face_clusters.json

Purpose:

- Group similar faces for people workflows.

Main metrics:

- Cluster count
- Members per cluster
- Named vs unnamed person groups

## Scanning, Indexing, Searching, Matching, Filtering

### Scanning

What happens:

- Walk selected paths and detect supported media files.
- Exclude known noise/system files.
- Upsert master catalog while keeping stable IDs.

Example:

- Input folders: D:/Albums/Travel, E:/Camera Roll
- Scan result:
  - total: 14,280
  - new_items: 412
  - refreshed_items: 13,868

### Indexing

What happens:

- Incremental processing skips already indexed rows when valid.
- Local index extracts orientation, format, quality hints, and more.
- Cloud index adds description/OCR (optional).

Example local indexing output snippet:

```json
{
  "id": 2231,
  "path": "D:/Albums/Travel/beach-01.jpg",
  "status": "ok",
  "metadata": {
    "orientation": "landscape",
    "sizeCategory": "large",
    "containsPeople": true,
    "sceneTag": ["Beach", "Sunset"],
    "objectTag": ["Sunglasses", "Hat"]
  }
}
```

### Searching

What happens:

- Query is expanded with related terms.
- Candidate rows are ranked using hybrid scoring.
- Intent signals (when available) guide better ordering.

Example query:

- Query: beach sunset with sunglasses
- Typical top match traits:
  - description contains beach/sunset vocabulary
  - tags include beach and eyewear-related objects
  - lexical and semantic scores both strong

### Matching

Matching combines multiple signals, not exact string only.

Signals include:

- Semantic similarity
- Lexical token overlap
- Fuzzy trigram similarity
- Phrase coverage and intent constraints

Simple conceptual score:

score = 0.55 * semantic + 0.25 * lexical + 0.15 * fuzzy + 0.05 * phraseCoverage

This improves recall for natural queries and typo-prone input.

### Filtering

Filter behavior supports practical metadata slicing after or before search.

Examples:

1. containsPeople = true and orientation = portrait
2. containsText = true and format = png
3. sceneTag includes Beach OR Sunset
4. objectTag includes Sunglasses OR Hat

Multi-select tag fields:

- Scene Tag
- Object Tag
- Activity Tag

For each field above, selecting multiple values uses OR logic.

Example:

- Selected Object Tag: Sunglasses, Hat
- Row passes if it has Sunglasses OR Hat (not required to have both)

## Available Filters

| Name                | Description                                 | Indexing Type | Best Used For (Use Cases)                                  |
|---------------------|---------------------------------------------|--------------|------------------------------------------------------------|
| People              | Filter images/videos containing people       | Local        | Finding photos with faces, portraits, group shots           |
| Text                | Filter items containing detected text        | Local/Cloud  | Finding screenshots, documents, slides, memes               |
| OCR Text Contains   | Search for specific text in images/videos    | Cloud        | Locating receipts, signs, documents by visible text         |
| Media Type          | Filter by image or video                     | Local        | Separating photos from videos, focusing on one media type   |
| Resolution / Megapixels | Filter by image resolution or megapixels | Local        | Finding high-res images for print, web, or archive          |
| Aspect Ratio        | Filter by aspect ratio (e.g., 16:9, 4:3)     | Local        | Finding wide, square, or tall images                        |
| File Type           | Filter by file extension/type                | Local        | Isolating JPEGs, PNGs, GIFs, RAW, etc.                     |
| Duration            | Filter videos by duration                    | Local        | Finding short clips, long videos, or highlights             |
| FPS                 | Filter videos by frames per second           | Local        | Locating slow-mo, high-FPS, or cinematic videos             |
| Has Audio           | Filter videos with/without audio             | Local        | Finding silent videos, music videos, or interviews          |
| Audio Type          | Filter by audio codec/type                   | Local        | Isolating videos with specific audio formats                |
| Has Captions        | Filter videos with captions/subtitles        | Local/Cloud  | Finding accessible or subtitled content                     |
| Motion Level        | Filter by detected motion amount             | Local        | Finding action shots, stills, or surveillance footage       |
| Style               | Filter by AI-detected style                  | Cloud        | Finding artistic, documentary, or candid images             |
| Orientation         | Filter by image orientation                  | Local        | Portrait vs. landscape, correcting rotated images           |
| Brightness          | Filter by brightness category                | Local        | Finding dark, bright, or well-lit images                    |
| Scene Tag           | Filter by AI-detected scene tags             | Cloud        | Finding beaches, mountains, cityscapes, etc.                |
| Object Tag          | Filter by AI-detected object tags            | Cloud        | Finding images with cars, animals, products, etc.           |
| Activity Tag        | Filter by AI-detected activity tags          | Cloud        | Finding sports, events, or specific actions                 |
| Social Score        | Filter by social media suitability           | Cloud        | Finding images likely to perform well on social platforms   |
| Instagram Score     | Filter by Instagram suitability              | Cloud        | Finding images optimized for Instagram                      |
| Aspect Ratio Suitability | Filter by suitability for aspect ratios  | Cloud        | Finding images for stories, posts, banners                  |
| Aesthetic Style     | Filter by AI-detected aesthetic style        | Cloud        | Finding minimal, vibrant, or vintage images                 |
| Editing Level       | Filter by AI-detected editing level          | Cloud        | Finding raw, lightly, or heavily edited images              |
| Visual Complexity   | Filter by AI-detected complexity             | Cloud        | Finding simple, busy, or detailed images                    |
| Hero Element        | Filter by detected main subject              | Cloud        | Finding images with clear subjects or focal points          |
| Depth Of Field      | Filter by detected depth of field            | Cloud        | Finding portraits, macro, or landscape shots                |
| Person Label        | Filter by assigned person label              | Local        | Finding images of specific people (after labeling)          |
| Person Group        | Filter by detected face cluster/group        | Local        | Finding all images of the same person/group                 |

## Faces Workspace

Faces workspace provides person-group review and labeling tools.

- Group tiles are optimized for easier browsing.
- Save-name action is streamlined for fast labeling.
- Refresh/rebuild controls help maintain group quality after reindex.

Design and implementation notes:

- docs/local-face-indexing-design.md

## App Configuration and Environment

### Where app data is stored

Packaged desktop builds store data in each OS user-data location:

- Windows: `%APPDATA%\\Snoolink Lens\\data`
- macOS: `~/Library/Application Support/Snoolink Lens/data`

Packaged desktop `.env` location:

- Windows: `%APPDATA%\\Snoolink Lens\\.env`
- macOS: `~/Library/Application Support/Snoolink Lens/.env`

Development runs from source still use the project-local `data/` folder.

### Core runtime settings

File: data/app_settings.json

Examples:

- enable_face_indexing
- face_model_version
- face_min_detection_confidence
- face_cluster_distance_threshold

### Cloud environment variables

- AWS_REGION
- AWS_ACCESS_KEY_ID
- AWS_SECRET_ACCESS_KEY
- AWS_SESSION_TOKEN (optional)
- BEDROCK_VISION_MODEL
- BEDROCK_QUERY_MODEL (optional)

### Local face model environment variable

- FACE_API_MODEL_DIR (optional)

## Project Structure (High-Level)

- main.js: orchestration, IPC, persistence
- renderer.js: UI behavior and dynamic filters
- preload.js / preload.cjs: secure bridge
- searchEngine.js: ranking and filter application
- local-image-metadata-extractor.js: local image metadata
- local-video-metadata-extractor.js: local video metadata
- cloud-image-metadata-extractor.js: cloud image metadata
- cloud-video-metadata-extractor.js: cloud video metadata
- imagePreviewPanel.js: detail preview panel
- query_expander.js: query expansion + intent helpers

## Useful NPM Scripts

- start: run desktop app
- dist: Windows NSIS build
- dist:portable: Windows portable build
- dist:all: both Windows outputs
- dist:mac: macOS outputs
- dist:mac:universal: universal macOS outputs

## Troubleshooting

### App does not start

- Re-run npm install
- Ensure Node.js LTS is active

### Local indexing fails on some files

- Keep indexing running; row-level failures are isolated
- Check extractor dependencies (example: sharp)

### Cloud indexing fails

- Verify AWS credentials and model access
- Validate region/model environment values

### Search returns too few results

- Broaden query terms and reduce strict filters
- Use OR-capable multi-select tags for better recall

## Notes

- Utility script available: scripts/rerun-local-index.mjs
- Root test helper scripts were removed to keep runtime surface clean

## How Cloud Indexing Works

Cloud indexing in Snoolink Lens uses a cloud AI vision model (such as AWS Bedrock Vision) to extract rich semantic metadata, scene descriptions, tags, and OCR (text-in-image) from your media. This is optional and augments local metadata with deeper content understanding.

### Cloud Indexing for Images

- **Process:**
  1. The app uploads a resized, optimized version of the image to the cloud model.
  2. The model analyzes the image and returns a detailed JSON object with:
     - Rich prose description of the scene, subjects, and context
     - Scene tags (e.g., “beach”, “city”, “portrait”)
     - Object tags (e.g., “car”, “dog”, “laptop”)
     - Activity tags (e.g., “running”, “meeting”)
     - Social media suitability scores
     - Aesthetic and editing style
     - Visual complexity, hero element, depth of field
     - OCR: all visible text, with location and confidence
  3. This metadata is merged into your catalog for advanced search and filtering.

- **Use Cases:**
  - Find images by content, activity, or objects (e.g., “dog in park”, “people hiking”)
  - Search for images containing specific text (e.g., receipts, signs)
  - Filter by style, mood, or suitability for social media

### Cloud Indexing for Videos

- **Process:**
  1. The app extracts frames from the video at regular intervals using ffmpeg. The interval is chosen based on video length:
     - Videos < 6 seconds: 1 frame per second
     - 6–15 seconds: 1 frame every 1.5 seconds
     - 15–30 seconds: 1 frame every 2 seconds
     - 30–60 seconds: 1 frame every 3 seconds
     - > 60 seconds: 1 frame every 5 seconds
  2. Each extracted frame is sent to the cloud model for the same deep analysis as images.
  3. The results from all frames are aggregated:
     - Combined scene/object/activity tags
     - Average social/Instagram scores
     - Aggregated OCR text from all frames
     - Combined description summarizing the video content
  4. The final metadata object includes per-frame details and overall video-level tags.

- **Use Cases:**
  - Find videos by what’s happening in them (e.g., “wedding ceremony”, “dog playing fetch”)
  - Search for videos containing specific text in any frame (e.g., “conference 2024”)
  - Filter by detected activities, objects, or social suitability

**Privacy & Cost:**
- Only optimized images/frames are sent to the cloud, not originals.
- Requires cloud credentials (AWS) and may incur API costs depending on usage.
