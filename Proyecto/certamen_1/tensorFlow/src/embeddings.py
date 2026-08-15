import pickle
import sys
from pathlib import Path

import numpy as np

from src.config import IMG_SIZE

# card_preprocessing vive en certamen_2/ — mismo import cruzado que el lado
# PyTorch (pytorch/scanner.py, ver ROADMAP.md G4b). Necesario para que
# extract_embedding() pueda localizar/encuadrar la carta antes de embeber en
# vez de embeber la foto cruda con fondo, como hacía antes.
_CERTAMEN2_DIR = Path(__file__).resolve().parents[3] / "certamen_2"
sys.path.insert(0, str(_CERTAMEN2_DIR))

# Tamaño de batch para build_index() — alinea con el BATCH_SIZE que usa el
# DataLoader del lado PyTorch (03_pt_embedder.py) para el mismo paso.
BATCH_SIZE = 32


def normalize_embedding(embedding: np.ndarray) -> np.ndarray:
    vector = np.array(embedding, dtype=np.float32, copy=True)
    norm = np.linalg.norm(vector)
    if norm > 0:
        vector = vector / norm
    return vector


def build_feature_extractor():
    from tensorflow.keras.applications import MobileNetV3Small

    model = MobileNetV3Small(
        weights="imagenet",
        include_top=False,
        pooling="avg",
        input_shape=(*IMG_SIZE, 3),
    )
    model.trainable = False
    return model


def _preprocesar(image) -> np.ndarray:
    """PIL → array float32 (H, W, 3) sin batch dim. MobileNetV3 incluye el
    rescaling como parte del modelo (capa Rescaling); espera píxeles en
    rango [0, 255], no hace falta normalizar acá."""
    image = image.convert("RGB").resize(IMG_SIZE)
    return np.asarray(image, dtype=np.float32)


def embed_pil_image(model, image) -> np.ndarray:
    array = np.expand_dims(_preprocesar(image), axis=0)
    # Llamada directa al modelo en vez de model.predict(): predict() arma un
    # tf.function de predicción + chequeos de distribución/callbacks en cada
    # llamada, overhead pensado para batches grandes — para un batch de 1
    # (como acá, una imagen a la vez) ese overhead termina pesando más que
    # el forward pass en sí. La llamada directa hace exactamente el forward
    # pass sin ese aparataje.
    embedding = model(array, training=False).numpy()[0]
    return normalize_embedding(embedding)


def extract_embedding(model, image_path: Path, intentar_localizar: bool = True) -> np.ndarray:
    """
    Extrae el embedding de una imagen de query (no de construcción del
    índice — `build_index()` usa `_preprocesar()` directo sobre renders
    limpios de Scryfall, sin pasar por acá).

    `intentar_localizar=True` (default): antes de embeber, localiza/encuadra
    la carta dentro de la foto (card_preprocessing.normalizar_carta) — antes
    de esto se embebía la foto cruda completa, fondo incluido, siempre (ver
    ROADMAP.md G4b; mismo fix que el lado PyTorch, `pytorch/scanner.py`).
    Pasar `False` si la imagen ya es un recorte ajustado (un render de
    Scryfall, por ejemplo) — ver el docstring de `normalizar_carta` sobre
    por qué la detección de contornos no es confiable en ese caso.
    """
    import cv2
    from PIL import Image

    from card_preprocessing import mejorar_contraste, normalizar_carta

    if intentar_localizar:
        img_bgr = cv2.imread(str(image_path))
        if img_bgr is not None:
            carta, _ = normalizar_carta(img_bgr, intentar_localizar=True)
            carta = mejorar_contraste(carta)
            image = Image.fromarray(cv2.cvtColor(carta, cv2.COLOR_BGR2RGB))
            return embed_pil_image(model, image)

    with Image.open(image_path) as image:
        return embed_pil_image(model, image)


def build_index(image_list: list[tuple[str, Path, str]], output_path: Path) -> dict[str, np.ndarray | list[str]]:
    """
    Antes esto llamaba a model.predict() UNA IMAGEN A LA VEZ (batch de 1) por
    cada carta del catálogo — con ~59k cartas eso es ~59k llamadas separadas
    a Keras, cada una pagando el overhead de predict() descrito en
    embed_pil_image(). Acá se arman batches de BATCH_SIZE imágenes y se hace
    UN forward pass por batch — el mismo principio que el DataLoader por
    lotes del lado PyTorch (03_pt_embedder.py) para este mismo paso. No hay
    GPU disponible para TensorFlow en esta máquina (ver README § GPU
    AMD/ROCm), así que la ganancia acá es de reducir llamadas + mejor uso de
    los kernels vectorizados de la CPU con batches grandes, no de paralelismo
    de GPU.
    """
    from PIL import Image

    model = build_feature_extractor()
    embeddings: list[np.ndarray] = []
    ids: list[str] = []
    names: list[str] = []

    batch_arrays: list[np.ndarray] = []
    batch_ids: list[str] = []
    batch_names: list[str] = []

    def flush_batch() -> None:
        if not batch_arrays:
            return
        batch = np.stack(batch_arrays, axis=0)
        feats = model(batch, training=False).numpy()
        for card_id, card_name, feat in zip(batch_ids, batch_names, feats):
            embeddings.append(normalize_embedding(feat))
            ids.append(card_id)
            names.append(card_name)
        batch_arrays.clear()
        batch_ids.clear()
        batch_names.clear()

    total = len(image_list)
    for position, (card_id, image_path, card_name) in enumerate(image_list, start=1):
        try:
            with Image.open(image_path) as image:
                batch_arrays.append(_preprocesar(image))
            batch_ids.append(card_id)
            batch_names.append(card_name)
        except Exception as exc:
            print(f"Error en {image_path}: {exc}; saltando")

        if len(batch_arrays) >= BATCH_SIZE:
            flush_batch()
        if position % 50 == 0 or position == total:
            print(f"Procesadas {position:,}/{total:,} imagenes")

    flush_batch()   # último batch, puede quedar más chico que BATCH_SIZE

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
