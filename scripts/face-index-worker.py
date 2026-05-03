import argparse
import hashlib
import json
import os
from datetime import datetime, timezone


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def build_empty_face_analysis(model_version):
    return {
        "version": model_version,
        "processed_at": utc_now_iso(),
        "face_count": 0,
        "faces": [],
    }


def run_insightface(image_path, model_version, min_confidence, min_quality):
    try:
        import cv2
        import numpy as np
        from insightface.app import FaceAnalysis
    except Exception as error:
        return {
            "ok": False,
            "error": f"Missing face worker dependencies (insightface/cv2/onnxruntime): {error}",
        }

    image = cv2.imread(image_path)
    if image is None:
        return {
            "ok": False,
            "error": f"Could not read image: {image_path}",
        }

    height, width = image.shape[:2]
    if width <= 0 or height <= 0:
        return {
            "ok": False,
            "error": "Invalid image dimensions.",
        }

    providers = ["CPUExecutionProvider"]
    app = FaceAnalysis(name="buffalo_l", providers=providers)
    app.prepare(ctx_id=-1, det_size=(640, 640))

    faces = app.get(image)
    rows = []
    for idx, face in enumerate(faces):
        det_score = float(getattr(face, "det_score", 0.0) or 0.0)
        if det_score < min_confidence:
            continue

        bbox = getattr(face, "bbox", None)
        if bbox is None or len(bbox) < 4:
            continue

        x1 = max(0.0, float(bbox[0]))
        y1 = max(0.0, float(bbox[1]))
        x2 = min(float(width), float(bbox[2]))
        y2 = min(float(height), float(bbox[3]))
        bw = max(0.0, x2 - x1)
        bh = max(0.0, y2 - y1)
        if bw <= 0 or bh <= 0:
            continue

        area_ratio = (bw * bh) / float(width * height)
        quality_score = max(0.0, min(1.0, (det_score * 0.7) + (area_ratio * 0.3)))
        if quality_score < min_quality:
            continue

        embedding_raw = getattr(face, "embedding", None)
        if embedding_raw is None:
            embedding = []
        else:
            if hasattr(embedding_raw, "tolist"):
                embedding = [float(v) for v in embedding_raw.tolist()]
            else:
                embedding = [float(v) for v in embedding_raw]

        face_key = f"{os.path.abspath(image_path)}:{idx}:{x1:.2f}:{y1:.2f}:{x2:.2f}:{y2:.2f}"
        face_id = hashlib.sha1(face_key.encode("utf-8")).hexdigest()[:16]

        rows.append(
            {
                "face_id": face_id,
                "bbox": {
                    "x": round(x1 / float(width), 6),
                    "y": round(y1 / float(height), 6),
                    "width": round(bw / float(width), 6),
                    "height": round(bh / float(height), 6),
                },
                "detection_confidence": round(det_score, 6),
                "embedding": embedding,
                "quality_score": round(quality_score, 6),
                "cluster_id": None,
                "person_label": None,
            }
        )

    return {
        "ok": True,
        "face_analysis": {
            "version": model_version,
            "processed_at": utc_now_iso(),
            "face_count": len(rows),
            "faces": rows,
        },
    }


def main():
    parser = argparse.ArgumentParser(description="Local face indexing worker")
    parser.add_argument("--image", required=True, help="Absolute image path")
    parser.add_argument("--model-version", default="insightface-arcface-v1")
    parser.add_argument("--min-confidence", type=float, default=0.6)
    parser.add_argument("--min-quality", type=float, default=0.45)
    args = parser.parse_args()

    image_path = str(args.image or "").strip()
    if not image_path:
        print(json.dumps({"ok": False, "error": "--image is required"}))
        return

    if not os.path.exists(image_path):
        print(json.dumps({"ok": False, "error": f"Image path not found: {image_path}"}))
        return

    model_version = str(args.model_version or "insightface-arcface-v1").strip() or "insightface-arcface-v1"
    min_confidence = max(0.0, min(1.0, float(args.min_confidence)))
    min_quality = max(0.0, min(1.0, float(args.min_quality)))

    result = run_insightface(image_path, model_version, min_confidence, min_quality)
    if not result.get("ok"):
        result["face_analysis"] = build_empty_face_analysis(model_version)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
