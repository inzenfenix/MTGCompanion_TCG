"""
MTG Card Scanner — Certamen 1
scanner.py: Demo de reconocimiento de cartas MTG desde una imagen.

Pipeline completo (dos etapas):
    1. Clasificador binario (MTGDetector): ¿es esto una carta MTG?
       Si la probabilidad < umbral → informa y termina.
    2. Recuperación por similitud coseno: ¿qué carta MTG es?
       Retorna las Top-N cartas más similares.

Uso:
    python scanner.py <ruta_imagen> [--top N]
    python scanner.py mi_carta.jpg --tta 5          # Test-Time Augmentation
    python scanner.py foto.png --skip-detect        # saltar paso 1

Requisitos para el clasificador binario:
    Ejecutar primero: python 07_binary_classifier.py
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
SCRIPT_DIR      = pathlib.Path(__file__).resolve().parent
DATA_DIR        = SCRIPT_DIR / "data"                    # artefactos locales (embeddings, índice)
SHARED_DATA_DIR = SCRIPT_DIR.parent / "data"             # dataset compartido (cards.json, imágenes)
IMAGES_DIR      = SHARED_DATA_DIR / "images"
MODELS_DIR      = SCRIPT_DIR / "models"
IMG_SIZE   = 224
DEVICE     = "cuda" if torch.cuda.is_available() else "cpu"
SIMILARITY_THRESHOLD = 0.75   # umbral de similitud óptimo (ver pytorch/results/metrics_pt.json → opt_threshold)

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


# ── Clasificador binario MTG / No-MTG ─────────────────────────────────────────

class MTGDetector(nn.Module):
    """
    EfficientNet_b0 con cabeza binaria.
    Misma arquitectura que 07_binary_classifier.py.
    Salida: logit escalar (aplicar sigmoid para obtener P(MTG)).
    """

    def __init__(self):
        super().__init__()
        base = models.efficientnet_b0(
            weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
        )
        self.features = base.features
        self.avgpool  = base.avgpool
        self.flatten  = nn.Flatten()
        self.head     = nn.Sequential(
            nn.Dropout(0.3),
            nn.Linear(1280, 256),
            nn.ReLU(inplace=True),
            nn.Dropout(0.2),
            nn.Linear(256, 1),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        h = self.flatten(self.avgpool(self.features(x)))
        return self.head(h).squeeze(1)


_detector_cache = None

def cargar_detector(threshold: float = 0.5) -> tuple:
    """
    Carga el clasificador binario MTGDetector desde models/mtg_detector.pth.
    Retorna (model, threshold) o None si el archivo no existe.
    """
    global _detector_cache
    model_path = MODELS_DIR / "mtg_detector.pth"
    cfg_path   = MODELS_DIR / "mtg_detector_cfg.json"

    if not model_path.exists():
        return None

    if _detector_cache is None:
        if cfg_path.exists():
            with open(cfg_path) as f:
                cfg = json.load(f)
            threshold = cfg.get("threshold", 0.5)

        detector = MTGDetector()
        detector.load_state_dict(
            torch.load(model_path, map_location=DEVICE, weights_only=True)
        )
        detector.eval()
        _detector_cache = (detector.to(DEVICE), threshold)

    return _detector_cache


def clasificar_imagen(img_path: str, detector: nn.Module, threshold: float) -> tuple:
    """
    Clasifica si una imagen es una carta MTG o no.
    Retorna (es_mtg: bool, prob: float).
    """
    img = Image.open(img_path).convert("RGB")
    tensor = TRANSFORM(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        logit = detector(tensor)
        prob  = torch.sigmoid(logit).item()
    return prob >= threshold, prob


# ── Modelo de embeddings ───────────────────────────────────────────────────────

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
    cards_path = SHARED_DATA_DIR / "cards.json"

    if finetuned and not emb_path.exists():
        print("Embeddings fine-tuneados no encontrados, usando baseline.")
        emb_path   = DATA_DIR / "embeddings_pt.npy"
        index_path = DATA_DIR / "index_pt.json"

    for p in [emb_path, index_path, cards_path]:
        if not p.exists():
            raise FileNotFoundError(
                f"{p} no existe.\n"
                "Ejecuta los pasos previos:\n"
                "  1. python ../01_scraper.py\n"
                "  2. python ../02_downloader.py\n"
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


def imprimir_resultados(resultados: list, cards_info: dict, query_path: str, tiempos: dict, threshold: float):
    ancho = 90
    top1_sim = resultados[0][1]
    es_magic = top1_sim >= threshold
    top1_nombre = cards_info.get(resultados[0][0], {}).get("name", "?")

    print()
    print("═" * ancho)
    print(f"  MTG Card Scanner — PyTorch (EfficientNet_b0)")
    print(f"  Query : {query_path}")
    print(f"  Embed : {tiempos['extraccion_ms']:.1f} ms   Búsqueda: {tiempos['busqueda_ms']:.2f} ms")
    print("─" * ancho)
    veredicto = "✓ ES Magic (por similitud)" if es_magic else "✗ Probablemente NO es Magic (por similitud)"
    print(f"  {veredicto}  |  Top-1 = {top1_nombre}  |  Similitud = {top1_sim * 100:.1f}%  |  Umbral = {threshold * 100:.1f}%")
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
    print("MAGIC" if es_magic else "NO_MAGIC")
    print(f"card_name={top1_nombre}")
    print(f"similarity={top1_sim:.6f}")
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
  python scanner.py foto.png --skip-detect   # saltar clasificador binario
  python scanner.py foto.png --threshold 0.8 # umbral de similitud más estricto
        """
    )
    parser.add_argument("imagen", help="Ruta a la imagen de la carta (JPG, PNG, etc.)")
    parser.add_argument("--top", type=int, default=5, metavar="N",
                        help="Número de resultados/candidatos a mostrar (default: 5)")
    parser.add_argument("--threshold", type=float, default=SIMILARITY_THRESHOLD, metavar="T",
                        help=f"Umbral de similitud coseno para decidir si el top-1 es Magic (default: {SIMILARITY_THRESHOLD})")
    parser.add_argument("--tta", type=int, default=1, metavar="N",
                        help="Test-Time Augmentation: promedia N embeddings (default: 1 = sin TTA, recomendado: 5-9)")
    parser.add_argument("--finetuned", action="store_true",
                        help="Usar embeddings del modelo fine-tuneado (requiere 06_finetune.py)")
    parser.add_argument("--skip-detect", action="store_true",
                        help="Saltar clasificador binario MTG/no-MTG (útil para depurar)")
    args = parser.parse_args()

    img_path = pathlib.Path(args.imagen)
    if not img_path.exists():
        print(f"Error: archivo no encontrado: {img_path}")
        return

    if args.top < 1:
        print("Error: --top debe ser >= 1")
        return

    n_tta = max(1, args.tta)

    # ── Paso 1: Clasificador binario MTG / No-MTG ─────────────────────────
    if not args.skip_detect:
        resultado = cargar_detector()
        if resultado is not None:
            detector, threshold = resultado
            es_mtg, prob = clasificar_imagen(str(img_path), detector, threshold)

            ancho = 90
            print()
            print("═" * ancho)
            print(f"  Clasificador MTG/No-MTG  |  P(MTG) = {prob:.4f}  |  Umbral = {threshold}")
            if not es_mtg:
                print(f"  ✗ La imagen NO parece una carta MTG (P={prob:.4f} < {threshold})")
                print(f"    Para forzar la búsqueda de todas formas: --skip-detect")
                print("═" * ancho)
                print()
                return
            print(f"  ✓ Carta MTG detectada (P={prob:.4f})")
            print("═" * ancho)
        else:
            print("  Nota: clasificador binario no entrenado.")
            print("  Ejecuta 07_binary_classifier.py para habilitarlo.")

    # ── Paso 2: Recuperación por similitud coseno ─────────────────────────
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
    imprimir_resultados(resultados, cards_info, str(img_path), tiempos, args.threshold)


if __name__ == "__main__":
    main()
