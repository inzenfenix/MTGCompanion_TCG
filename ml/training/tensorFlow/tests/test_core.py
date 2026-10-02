import unittest
from pathlib import Path

import numpy as np

from src.config import ProjectPaths
from src.embeddings import normalize_embedding
from src.predictor import rank_candidates


class CoreTests(unittest.TestCase):
    def test_project_paths_default_to_project_relative_locations(self):
        paths = ProjectPaths.from_project_root(Path("/tmp/certamen_1/tensorFlow"))

        self.assertEqual(paths.catalog_json, Path("/tmp/certamen_1/data/cards.json"))
        self.assertEqual(paths.images_dir, Path("/tmp/certamen_1/data/images"))
        self.assertEqual(paths.embedding_index, Path("/tmp/certamen_1/tensorFlow/data/indexes/magic_embeddings.pkl"))

    def test_normalize_embedding_returns_unit_vector_without_mutating_input(self):
        original = np.array([3.0, 4.0], dtype=np.float32)

        normalized = normalize_embedding(original)

        np.testing.assert_allclose(normalized, np.array([0.6, 0.8], dtype=np.float32))
        np.testing.assert_allclose(original, np.array([3.0, 4.0], dtype=np.float32))

    def test_rank_candidates_orders_by_cosine_similarity_descending(self):
        index = {
            "names": ["Island", "Lightning Bolt", "Black Lotus"],
            "embeddings": np.array(
                [
                    [0.0, 1.0],
                    [1.0, 0.0],
                    [0.8, 0.6],
                ],
                dtype=np.float32,
            ),
        }
        query = np.array([1.0, 0.0], dtype=np.float32)

        candidates = rank_candidates(index=index, query_embedding=query, top_k=2)

        self.assertEqual(
            candidates,
            [
                {
                    "rank": 1,
                    "name": "Lightning Bolt",
                    "id": None,
                    "similarity": 1.0,
                    "index": 1,
                },
                {
                    "rank": 2,
                    "name": "Black Lotus",
                    "id": None,
                    "similarity": 0.8,
                    "index": 2,
                },
            ],
        )


if __name__ == "__main__":
    unittest.main()
