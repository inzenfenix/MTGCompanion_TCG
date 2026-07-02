"""
MTG Card Scanner — Certamen 1
03_pt_embedder.py: Extrae embeddings visuales con PyTorch (EfficientNet_b0).

Arquitectura:
    EfficientNet_b0 preentrenado en ImageNet
    → se elimina la cabeza clasificadora (classifier → Identity)
    → GlobalAveragePooling ya incorporado en el backbone (avgpool)
    → salida: vector de 1280 dimensiones
    → normalización L2  →  similitud coseno == producto punto

Salida:
    data/embeddings_pt.npy   — matriz float32 (N, 1280)
    data/index_pt.json       — lista de card IDs en el mismo orden que las filas

El índice (index_pt.json) es fundamental: relaciona cada fila de la matriz
con el ID de la carta correspondiente para poder hacer búsquedas.
"""

import json
import pathlib
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.models as models
import torchvision.transforms as T
from torch.utils.data import Dataset, DataLoader
from PIL import Image

# ── Configuración ─────────────────────────────────────────────────────────────
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
DATA_DIR   = SCRIPT_DIR / "data"                    # artefactos locales (embeddings, índice)
SHARED_DATA_DIR = SCRIPT_DIR.parent / "data"         # dataset compartido (cards.json, imágenes)
IMAGES_DIR = SHARED_DATA_DIR / "images"
IMG_SIZE   = 224
BATCH_SIZE = 32
NUM_WORKERS = 4
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Normalización estándar ImageNet
IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

TRANSFORM = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


# ── Dataset ───────────────────────────────────────────────────────────────────

class CartasDataset(Dataset):
    """
    Dataset de imágenes de cartas MTG.
    __getitem__ retorna (tensor_imagen, card_id).
    Si la imagen no se puede leer, retorna un tensor de ceros y card_id vacío.
    """

    def __init__(self, entradas: list):
        self.entradas = entradas  # lista de (card_id, ruta_imagen)

    def __len__(self):
        return len(self.entradas)

    def __getitem__(self, idx: int):
        card_id, ruta = self.entradas[idx]
        try:
            img = Image.open(ruta).convert("RGB")
            return TRANSFORM(img), card_id
        except Exception:
            return torch.zeros(3, IMG_SIZE, IMG_SIZE), ""


#Modelo
def construir_extractor() -> nn.Module:
    """
    EfficientNet_b0 sin cabeza clasificadora.
    producido por model.avgpool → forma (B, 1280, 1, 1) → flatten → (B, 1280).
    """
    model = models.efficientnet_b0(
        weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
    )
    model.classifier = nn.Identity()
    model.eval()
    return model.to(DEVICE)


def extraer_todos(model: nn.Module, entradas: list) -> tuple:
    """
    Procesa todas las imágenes en batches y retorna (embeddings, ids).
    """
    dataset = CartasDataset(entradas)
    loader  = DataLoader(
        dataset,
        batch_size=BATCH_SIZE,
        num_workers=NUM_WORKERS,
        pin_memory=(DEVICE == "cuda"),
        shuffle=False,
    )

    all_embs = []
    all_ids  = []

    t_start = time.perf_counter()

    with torch.no_grad():
        for i, (imgs, card_ids) in enumerate(loader):
            # Filtrar entradas con imagen corrupta (card_id == "")
            validos = [j for j, cid in enumerate(card_ids) if cid]
            if not validos:
                continue

            imgs_valid = imgs[validos].to(DEVICE)
            feats = model(imgs_valid)                      # (B, 1280)
            feats = F.normalize(feats, p=2, dim=-1)        # L2-normalización

            all_embs.append(feats.cpu().numpy())
            all_ids.extend(card_ids[j] for j in validos)

            if i % 20 == 0:
                elapsed = time.perf_counter() - t_start
                print(f"  Batch {i + 1:>4}/{len(loader)} — {len(all_ids):,} cartas — {elapsed:.0f}s")

    t_total = time.perf_counter() - t_start
    emb_matrix = np.vstack(all_embs).astype(np.float32)

    print(f"\n  Tiempo total   : {t_total:.1f}s")
    print(f"  ms por carta   : {t_total / len(all_ids) * 1000:.2f} ms")

    return emb_matrix, all_ids


def main():
    cards_path = SHARED_DATA_DIR / "cards.json"
    if not cards_path.exists():
        print("Error: ../data/cards.json no existe. Ejecuta ../01_scraper.py primero.")
        return

    with open(cards_path, encoding="utf-8") as f:
        cards = json.load(f)

    # Solo cartas con imagen descargada
    entradas = [
        (c["id"], str(IMAGES_DIR / f"{c['id']}.jpg"))
        for c in cards
        if (IMAGES_DIR / f"{c['id']}.jpg").exists()
    ]

    total_sin_img = len(cards) - len(entradas)
    print(f"Device         : {DEVICE}")
    print(f"Cartas total   : {len(cards):,}")
    print(f"Sin imagen     : {total_sin_img:,} (no descargadas o con error)")
    print(f"A procesar     : {len(entradas):,}")

    model = construir_extractor()
    n_params = sum(p.numel() for p in model.parameters())
    print(f"Modelo         : EfficientNet_b0  ({n_params / 1e6:.1f}M parámetros)")
    print(f"Batch size     : {BATCH_SIZE}  |  Workers: {NUM_WORKERS}\n")

    emb_matrix, ids = extraer_todos(model, entradas)

    # Guardar resultados
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    emb_path   = DATA_DIR / "embeddings_pt.npy"
    index_path = DATA_DIR / "index_pt.json"

    np.save(emb_path, emb_matrix)
    with open(index_path, "w") as f:
        json.dump(ids, f)

    print(f"\nEmbeddings     : {emb_path}  {emb_matrix.shape}  ({emb_matrix.nbytes / 1e6:.1f} MB)")
    print(f"Índice         : {index_path}  ({len(ids):,} entradas)")
    print(f"\nSiguiente paso : python 04_evaluate.py")


if __name__ == "__main__":
    main()
