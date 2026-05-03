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
cd snoolink-studios
npm install
```

macOS (Terminal):

```bash
git clone <your-repo-url>
cd snoolink-studios
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
$env:FACE_API_MODEL_DIR = "C:\path\to\snoolink-studios\models\face-api"
```

Example (macOS Terminal):

```bash
export FACE_API_MODEL_DIR="/path/to/snoolink-studios/models/face-api"
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

## Faces Workspace

Faces workspace provides person-group review and labeling tools.

- Group tiles are optimized for easier browsing.
- Save-name action is streamlined for fast labeling.
- Refresh/rebuild controls help maintain group quality after reindex.

Design and implementation notes:

- docs/local-face-indexing-design.md

## App Configuration and Environment

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
