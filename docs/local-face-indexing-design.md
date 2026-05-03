# Local Face Indexing Design and Status

This document describes the local-only face indexing architecture in Snoolink Lens and clarifies what is already implemented versus what is still planned.

## Scope

- Local face detection and embeddings during local indexing.
- Local person-group clustering persisted under `data/`.
- User-facing people-group review/naming workflow in the Faces workspace.
- No cloud dependency for face indexing.

Out of scope:

- Cloud face recognition APIs.
- Cross-device identity sync.

## Current Implementation Status

Implemented:

- Face analysis during local indexing with non-fatal error handling.
- Face metadata persisted per media row.
- Local face clustering output persisted.
- Faces workspace UI for group browsing, refresh/rebuild, and name save.
- User-facing terminology shifted to People/Person Group language.

Planned:

- Deeper person search/filter integration in the main search bar workflow.
- Optional face overlays and richer person-level controls.

## Runtime Stack

- Face inference: `@vladmandic/face-api`
- Tensor backend: `@tensorflow/tfjs`
- Image decode: `sharp`

This stack keeps face indexing local and avoids requiring a Python/C++ toolchain in the normal app path.

## Integration Points

- `main.js`: indexing orchestration, checkpoint writes, face workflow coordination
- `local-image-metadata-extractor.js`: per-image metadata enrichment path
- `renderer.js` + `faces-ui.html`: Faces workspace rendering and actions

## Data Model

### Per-item face metadata

Stored under each row in `data/local-image_metadata_results.json`:

- `local_metadata.face_analysis`
  - `version`
  - `processed_at`
  - `face_count`
  - `faces[]`
    - `face_id`
    - `bbox` (normalized)
    - `detection_confidence`
    - `embedding`
    - `quality_score`
    - `cluster_id`
    - `person_label`

If face analysis fails for a row, indexing continues and stores a diagnostics field (`face_analysis_error`) without failing the full row.

### Global cluster output

Stored in `data/local_face_clusters.json`.

Contains generated cluster/group information used by the Faces workspace.

## Pipeline Behavior

### During local indexing

1. Run normal local metadata extraction.
2. Run face analysis for eligible image items.
3. Merge face analysis into row metadata.
4. Persist incremental checkpoints.

### Incremental reruns

- Existing rows are reused where possible.
- Rows can be reprocessed when face-analysis version requirements change.
- Face-analysis errors do not stop index completion.

## Configuration

App settings keys used by the face pipeline are stored in `data/app_settings.json`:

- `enable_face_indexing`
- `face_model_version`
- `face_min_detection_confidence`
- `face_min_quality_score`
- `face_cluster_distance_threshold`

Optional environment key:

- `FACE_API_MODEL_DIR`

If not set, the app attempts default model locations (for example `models/face-api`).

## UI Behavior (Faces Workspace)

- People-group tiles are displayed in a responsive multi-column layout.
- Naming actions are single-row and optimized for faster labeling.
- Action buttons use semantic visual roles (refresh/rebuild/save/toggle distinctions).

## Roadmap

1. Add person-aware filters to broader search/gallery surfaces.
2. Add optional face-bounding-box overlays in preview surfaces.
3. Add richer merge/split controls for ambiguous groups.

## Acceptance Baseline

1. Local indexing completes even when face analysis fails on individual files.
2. Face metadata is persisted for successful detections.
3. Local cluster output is generated and usable by Faces workspace.
4. Faces workspace supports practical review, naming, and refresh/rebuild loops.
