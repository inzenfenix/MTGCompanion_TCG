from pathlib import Path
from typing import Any

import numpy as np

from src.embeddings import build_feature_extractor, extract_embedding, load_index


def rank_candidates(index: dict[str, Any], query_embedding: np.ndarray, top_k: int) -> list[dict[str, Any]]:
    similarities = index["embeddings"] @ query_embedding
    top_indices = np.argsort(similarities)[::-1][:top_k]

    ids = index.get("ids")
    candidates: list[dict[str, Any]] = []
    for rank, candidate_index in enumerate(top_indices, start=1):
        candidates.append(
            {
                "rank": rank,
                "name": index["names"][int(candidate_index)],
                "id": ids[int(candidate_index)] if ids else None,
                "similarity": round(float(similarities[int(candidate_index)]), 6),
                "index": int(candidate_index),
            }
        )
    return candidates


def predict_from_index(
    image_path: Path,
    index: dict[str, Any],
    top_k: int,
    threshold: float,
    model=None,
) -> dict[str, Any]:
    feature_extractor = model or build_feature_extractor()
    query_embedding = extract_embedding(feature_extractor, image_path)
    candidates = rank_candidates(index=index, query_embedding=query_embedding, top_k=top_k)
    best = candidates[0]
    return {
        "is_magic": best["similarity"] >= threshold,
        "card_name": best["name"],
        "similarity": best["similarity"],
        "top_k": candidates,
    }


def predict_image(image_path: Path, index_path: Path, top_k: int, threshold: float) -> dict[str, Any]:
    index = load_index(index_path)
    return predict_from_index(image_path=image_path, index=index, top_k=top_k, threshold=threshold)
