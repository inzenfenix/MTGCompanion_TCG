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


def extract_embedding(model, image_path: Path) -> np.ndarray:
    from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
    from tensorflow.keras.preprocessing import image as keras_image

    image = keras_image.load_img(image_path, target_size=IMG_SIZE)
    array = keras_image.img_to_array(image)
    array = np.expand_dims(array, axis=0)
    array = preprocess_input(array)
    embedding = model.predict(array, verbose=0)[0]
    return normalize_embedding(embedding)


def build_index(image_list: list[tuple[Path, str]], output_path: Path) -> dict[str, np.ndarray | list[str]]:
    model = build_feature_extractor()
    embeddings = []
    names = []

    for image_path, card_name in image_list:
        try:
            embeddings.append(extract_embedding(model, image_path))
            names.append(card_name)
        except Exception as exc:
            print(f"Error en {image_path}: {exc}; saltando")

    index = {
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
