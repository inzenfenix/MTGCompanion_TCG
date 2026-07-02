from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ProjectPaths:
    catalog_json: Path
    images_dir: Path
    embedding_index: Path

    @classmethod
    def from_project_root(cls, project_root: Path = PROJECT_ROOT) -> "ProjectPaths":
        shared_data_dir = project_root.parent / "data"  # dataset compartido (01_scraper.py / 02_downloader.py)
        local_data_dir = project_root / "data"           # artefactos locales (índice de embeddings)
        return cls(
            catalog_json=shared_data_dir / "cards.json",
            images_dir=shared_data_dir / "images",
            embedding_index=local_data_dir / "indexes" / "magic_embeddings.pkl",
        )

    def ensure_directories(self) -> None:
        self.embedding_index.parent.mkdir(parents=True, exist_ok=True)


PATHS = ProjectPaths.from_project_root()

IMG_SIZE = (224, 224)
SIMILARITY_THRESHOLD = 0.75
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
TOP_K = 3
