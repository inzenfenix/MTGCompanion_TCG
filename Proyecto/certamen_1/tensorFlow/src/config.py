from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class ProjectPaths:
    catalog_json: Path
    images_dir: Path
    embedding_index: Path
    card_names_json: Path

    @classmethod
    def from_project_root(cls, project_root: Path = PROJECT_ROOT) -> "ProjectPaths":
        data_dir = project_root / "data"
        images_dir = data_dir / "images"
        return cls(
            catalog_json=data_dir / "raw" / "scryfall_cards.json",
            images_dir=images_dir,
            embedding_index=data_dir / "indexes" / "magic_embeddings.pkl",
            card_names_json=images_dir / "card_names.json",
        )

    def ensure_directories(self) -> None:
        self.catalog_json.parent.mkdir(parents=True, exist_ok=True)
        self.images_dir.mkdir(parents=True, exist_ok=True)
        self.embedding_index.parent.mkdir(parents=True, exist_ok=True)


PATHS = ProjectPaths.from_project_root()

SCRYFALL_BULK_API = "https://api.scryfall.com/bulk-data"
BULK_TYPE = "default_cards"
IMAGE_QUALITY = "normal"
DELAY_BETWEEN_REQS = 0.05
MAX_CARDS = 500

IMG_SIZE = (224, 224)
SIMILARITY_THRESHOLD = 0.75
SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
TOP_K = 3

HEADERS = {
    "User-Agent": "MagicDetectorTensorFlowScript/1.0",
    "Accept": "application/json",
}
