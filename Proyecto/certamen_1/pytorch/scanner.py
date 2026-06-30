"""
MTG Card Scanner — Certamen 1
scanner.py: Demo de reconocimiento de cartas MTG desde una imagen.

Uso:
    python scanner.py <ruta_imagen> [--top N]

Ejemplos:
    python scanner.py mi_carta.jpg
    python scanner.py foto.png --top 10

El script carga el índice de embeddings PyTorch y busca las N cartas
más similares a la imagen de entrada usando similitud coseno.
"""

import argparse
import json
import pathlib
import time

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.models as models
import torchvision.transforms as T
from PIL import Image

# ── Configuración ─────────────────────────────────────────────────────────────
DATA_DIR   = pathlib.Path("data")
IMAGES_DIR = DATA_DIR / "images"
IMG_SIZE   = 224
DEVICE     = "cuda" if torch.cuda.is_available() else "cpu"

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

TRANSFORM = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

# Augmentaciones leves para TTA (Test-Time Augmentation)
TRANSFORM_TTA = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ColorJitter(brightness=0.15, contrast=0.15, saturation=0.10),
    T.RandomPerspective(distortion_scale=0.10, p=0.8),
    T.RandomRotation(degrees=5),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

# Símbolos de rareza para la tabla de resultados
RARITY_SYMBOLS = {
    "common"   : "●",
    "uncommon" : "◆",
    "rare"     : "★",
    "mythic"   : "✦",
}

COLOR_NAMES = {"W": "White", "U": "Blue", "B": "Black", "R": "Red", "G": "Green"}


# ── Modelo ────────────────────────────────────────────────────────────────────

_model_cache = None

def cargar_modelo() -> nn.Module:
    """Carga EfficientNet_b0 sin cabeza. Cachea en módulo para evitar recargas."""
    global _model_cache
    if _model_cache is None:
        model = models.efficientnet_b0(
            weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
        )
        model.classifier = nn.Identity()
        model.eval()
        _model_cache = model.to(DEVICE)
    return _model_cache


def extraer_embedding(img_path: str, n_tta: int = 1) -> np.ndarray:
    """
    Extrae embedding L2-normalizado de una imagen.

    Con n_tta > 1 aplica Test-Time Augmentation:
    genera n_tta augmentaciones, extrae un embedding por cada una,
    promedia y re-normaliza. El embedding promediado es más estable
    que uno solo porque cancela variaciones aleatorias de la augmentación.
    """
    img   = Image.open(img_path).convert("RGB")
    model = cargar_modelo()

    # Vista limpia siempre incluida
    views = [TRANSFORM(img)]
    for _ in range(n_tta - 1):
        views.append(TRANSFORM_TTA(img))

    batch = torch.stack(views).to(DEVICE)    # (n_tta, C, H, W)

    with torch.no_grad():
        feats = model(batch)                 # (n_tta, 1280)
        feats = F.normalize(feats, p=2, dim=-1)
        avg   = feats.mean(dim=0)            # promedio de n_tta embeddings
        avg   = F.normalize(avg, p=2, dim=-1)

    return avg.cpu().numpy()


# ── Índice de búsqueda ────────────────────────────────────────────────────────

def cargar_indice(finetuned: bool = False) -> tuple:
    """Carga embeddings, IDs de cartas y metadata."""
    suffix     = "ft" if finetuned else "pt"
    emb_path   = DATA_DIR / f"embeddings_{suffix}.npy"
    index_path = DATA_DIR / f"index_{suffix}.json"
    cards_path = DATA_DIR / "cards.json"

    if finetuned and not emb_path.exists():
        print("Embeddings fine-tuneados no encontrados, usando baseline.")
        emb_path   = DATA_DIR / "embeddings_pt.npy"
        index_path = DATA_DIR / "index_pt.json"

    for p in [emb_path, index_path, cards_path]:
        if not p.exists():
            raise FileNotFoundError(
                f"{p} no existe.\n"
                "Ejecuta los pasos previos:\n"
                "  1. python 01_scraper.py\n"
                "  2. python 02_downloader.py\n"
                "  3. python 03_pt_embedder.py"
            )

    emb_matrix = np.load(emb_path)
    with open(index_path) as f:
        gallery_ids = json.load(f)
    with open(cards_path, encoding="utf-8") as f:
        cards_info = {c["id"]: c for c in json.load(f)}

    return emb_matrix, gallery_ids, cards_info


def buscar(query_emb: np.ndarray, gallery_emb: np.ndarray, gallery_ids: list, k: int) -> list:
    """
    Búsqueda por similitud coseno (embeddings L2-normalizados → producto punto).
    Retorna lista de (card_id, score).
    """
    sims    = gallery_emb @ query_emb
    top_idx = np.argsort(sims)[::-1][:k]
    return [(gallery_ids[i], float(sims[i])) for i in top_idx]


# ── Presentación de resultados ────────────────────────────────────────────────

def formatear_colores(colors: list) -> str:
    if not colors:
        return "Colorless"
    return " / ".join(COLOR_NAMES.get(c, c) for c in colors)


def imprimir_resultados(resultados: list, cards_info: dict, query_path: str, tiempos: dict):
    ancho = 90
    print()
    print("═" * ancho)
    print(f"  MTG Card Scanner — PyTorch (EfficientNet_b0)")
    print(f"  Query : {query_path}")
    print(f"  Embed : {tiempos['extraccion_ms']:.1f} ms   Búsqueda: {tiempos['busqueda_ms']:.2f} ms")
    print("═" * ancho)
    print(f"  {'#':<3}  {'Sim':>6}  {'Carta':<35}  {'Set':<22}  {'CMC':>4}  {'Colores':<20}  Rareza")
    print("─" * ancho)

    for i, (card_id, sim) in enumerate(resultados, 1):
        card    = cards_info.get(card_id, {})
        nombre  = card.get("name", "?")[:34]
        set_n   = card.get("set_name", "?")[:21]
        cmc     = int(card.get("cmc") or 0)
        colores = formatear_colores(card.get("colors") or [])[:19]
        rareza  = card.get("rarity", "?")
        simbolo = RARITY_SYMBOLS.get(rareza, "?")

        print(f"  {i:<3}  {sim:>6.4f}  {nombre:<35}  {set_n:<22}  {cmc:>4}  {colores:<20}  {simbolo} {rareza}")

    print("═" * ancho)
    print()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="MTG Card Scanner — identifica una carta MTG desde una imagen.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python scanner.py carta.jpg
  python scanner.py foto.png --top 10 --tta 7
  python scanner.py imagen.jpg --finetuned
        """
    )
    parser.add_argument("imagen", help="Ruta a la imagen de la carta (JPG, PNG, etc.)")
    parser.add_argument("--top", type=int, default=5, metavar="N",
                        help="Número de resultados a mostrar (default: 5)")
    parser.add_argument("--tta", type=int, default=1, metavar="N",
                        help="Test-Time Augmentation: promedia N embeddings (default: 1 = sin TTA, recomendado: 5-9)")
    parser.add_argument("--finetuned", action="store_true",
                        help="Usar embeddings del modelo fine-tuneado (requiere 06_finetune.py)")
    args = parser.parse_args()

    img_path = pathlib.Path(args.imagen)
    if not img_path.exists():
        print(f"Error: archivo no encontrado: {img_path}")
        return

    if args.top < 1:
        print("Error: --top debe ser >= 1")
        return

    n_tta = max(1, args.tta)

    # Cargar índice
    print("Cargando índice de embeddings...")
    try:
        gallery_emb, gallery_ids, cards_info = cargar_indice(finetuned=args.finetuned)
    except FileNotFoundError as e:
        print(f"Error: {e}")
        return

    modelo_label = "fine-tuned" if args.finetuned else "baseline"
    print(f"  Índice: {len(gallery_ids):,} cartas  |  Device: {DEVICE}  |  Modelo: {modelo_label}")
    if n_tta > 1:
        print(f"  TTA: {n_tta} vistas por query")

    # Extraer embedding del query
    print(f"Procesando imagen: {img_path.name}")
    t0 = time.perf_counter()
    query_emb = extraer_embedding(str(img_path), n_tta=n_tta)
    t1 = time.perf_counter()
    extraccion_ms = (t1 - t0) * 1000

    # Búsqueda coseno
    t0 = time.perf_counter()
    resultados = buscar(query_emb, gallery_emb, gallery_ids, args.top)
    t1 = time.perf_counter()
    busqueda_ms = (t1 - t0) * 1000

    # Mostrar resultados
    tiempos = {"extraccion_ms": extraccion_ms, "busqueda_ms": busqueda_ms}
    imprimir_resultados(resultados, cards_info, str(img_path), tiempos)


if __name__ == "__main__":
    main()
