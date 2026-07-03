import pickle
from pathlib import Path

import numpy as np

from src.config import IMG_SIZE


def normalize_embedding(embedding: np.ndarray) -> np.ndarray:
    vector = np.array(embedding, dtype=np.float32, copy=True)
    norm = np.linalg.norm(vector)
    if norm > 0:
        vector = vector / norm
    return vector


def build_feature_extractor():
    from tensorflow.keras.applications import MobileNetV2

    model = MobileNetV2(
        weights="imagenet",
        include_top=False,
        pooling="avg",
        input_shape=(*IMG_SIZE, 3),
    )
    model.trainable = False
    return model


def embed_pil_image(model, image) -> np.ndarray:
    from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

    image = image.convert("RGB").resize(IMG_SIZE)
    array = np.asarray(image, dtype=np.float32)
    array = np.expand_dims(array, axis=0)
    array = preprocess_input(array)
    embedding = model.predict(array, verbose=0)[0]
    return normalize_embedding(embedding)


def extract_embedding(model, image_path: Path) -> np.ndarray:
    from PIL import Image

    with Image.open(image_path) as image:
        return embed_pil_image(model, image)


def build_index(image_list: list[tuple[str, Path, str]], output_path: Path) -> dict[str, np.ndarray | list[str]]:
    model = build_feature_extractor()
    embeddings = []
    ids = []
    names = []

    total = len(image_list)
    for position, (card_id, image_path, card_name) in enumerate(image_list, start=1):
        try:
            embeddings.append(extract_embedding(model, image_path))
            ids.append(card_id)
            names.append(card_name)
        except Exception as exc:
            print(f"Error en {image_path}: {exc}; saltando")
        if position % 50 == 0 or position == total:
            print(f"Procesadas {position:,}/{total:,} imagenes")

    index = {
        "ids": ids,
        "names": names,
        "embeddings": np.array(embeddings, dtype=np.float32),
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as file:
        pickle.dump(index, file)
    print(f"Indice guardado: {output_path} ({len(names):,} cartas)")
    return index


def load_index(index_path: Path) -> dict[str, np.ndarray | list[str]]:
    if not index_path.exists():
        raise FileNotFoundError(f"No existe el indice: {index_path}")
    with index_path.open("rb") as file:
        return pickle.load(file)
