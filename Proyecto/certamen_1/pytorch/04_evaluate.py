"""
MTG Card Scanner — Certamen 1
04_evaluate.py: Evaluación del sistema de reconocimiento de cartas.

Protocolo de evaluación:
    1. Dividir el dataset en galería (80%) y consultas (20%).
    2. Para cada carta de consulta, aplicar augmentaciones que simulan
       una fotografía real: perspectiva, brillo, blur, rotación.
    3. Re-extraer el embedding con EfficientNet_b0 (PyTorch).
    4. Buscar las k cartas más similares en la galería usando similitud coseno.
    5. Registrar Top-1, Top-5 y MRR (Mean Reciprocal Rank).
    6. Medir tiempo de extracción de embedding e inferencia de búsqueda.

Métricas:
    Top-1 Accuracy : la carta correcta está en el primer resultado
    Top-5 Accuracy : la carta correcta está entre los 5 primeros
    MRR            : promedio de 1/rank de la carta correcta (0 si no aparece en top-5)
    Tiempo extracción (ms/imagen) : tiempo de EfficientNet en inferencia
    Tiempo búsqueda  (ms/query)   : tiempo de búsqueda coseno en la galería

Salida:
    results/metrics_pt.json   — métricas numéricas
    results/eval_examples.png — grid de ejemplos correctos e incorrectos
"""

import json
import pathlib
import time
import random

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import torchvision.models as models
import torchvision.transforms as T
from PIL import Image, ImageEnhance, ImageFilter
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
DATA_DIR   = SCRIPT_DIR / "data"                    # artefactos locales (embeddings, índice)
SHARED_DATA_DIR = SCRIPT_DIR.parent / "data"         # dataset compartido (cards.json, imágenes)
IMAGES_DIR = SHARED_DATA_DIR / "images"
RESULTS_DIR = pathlib.Path("results")
IMG_SIZE   = 224
BATCH_SIZE = 32
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SEED   = 42
TEST_SPLIT = 0.20    # 20% consultas, 80% galería
TOP_K  = 5

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

TRANSFORM_CLEAN = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

random.seed(SEED)
np.random.seed(SEED)


# ── Augmentación (simula foto real) ──────────────────────────────────────────

def augmentar_imagen(img_path: str, rng: random.Random) -> Image.Image:
    """
    Aplica transformaciones que emulan condiciones fotográficas:
    - Variación de brillo y contraste (iluminación imperfecta)
    - Rotación leve (carta no alineada perfectamente)
    - Blur gaussiano leve (desenfoque de cámara)
    - Perspectiva aleatoria (ángulo de disparo)
    Retorna imagen PIL.
    """
    img = Image.open(img_path).convert("RGB")

    # Perspectiva más agresiva (simula foto tomada en ángulo)
    img = T.RandomPerspective(distortion_scale=0.30, p=1.0)(img)

    # Brillo — rango más amplio (sombra / sobreexposición)
    factor = rng.uniform(0.60, 1.40)
    img = ImageEnhance.Brightness(img).enhance(factor)

    # Contraste
    factor = rng.uniform(0.70, 1.30)
    img = ImageEnhance.Contrast(img).enhance(factor)

    # Saturación (color shift de iluminación artificial)
    factor = rng.uniform(0.80, 1.20)
    img = ImageEnhance.Color(img).enhance(factor)

    # Rotación más amplia
    angle = rng.uniform(-15, 15)
    img = img.rotate(angle, expand=False, fillcolor=(0, 0, 0))

    # Crop aleatorio (carta parcialmente visible en la foto)
    w, h = img.size
    crop_scale = rng.uniform(0.80, 1.0)
    cw, ch = int(w * crop_scale), int(h * crop_scale)
    x0 = rng.randint(0, w - cw)
    y0 = rng.randint(0, h - ch)
    img = img.crop((x0, y0, x0 + cw, y0 + ch)).resize((w, h), Image.BILINEAR)

    # Blur variable (desenfoque / movimiento de cámara)
    if rng.random() < 0.6:
        img = img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.5, 2.0)))

    return img


# ── Modelo ────────────────────────────────────────────────────────────────────

def cargar_modelo() -> nn.Module:
    model = models.efficientnet_b0(
        weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1
    )
    model.classifier = nn.Identity()
    model.eval()
    return model.to(DEVICE)


def imagen_a_embedding(img: Image.Image, model: nn.Module) -> np.ndarray:
    """Convierte imagen PIL a embedding L2-normalizado (1280,)."""
    tensor = TRANSFORM_CLEAN(img).unsqueeze(0).to(DEVICE)
    with torch.no_grad():
        feats = model(tensor)
        feats = F.normalize(feats, p=2, dim=-1)
    return feats.cpu().numpy()[0]


# ── Búsqueda ──────────────────────────────────────────────────────────────────

def buscar_topk(query_emb: np.ndarray, gallery_emb: np.ndarray, k: int) -> np.ndarray:
    """
    Retorna los índices de las k cartas más similares en la galería.
    Similitud coseno = producto punto (embeddings ya L2-normalizados).
    """
    sims = gallery_emb @ query_emb          # (N_gallery,)
    return np.argsort(sims)[::-1][:k]


def evaluar(cards_info: dict) -> dict:
    emb_matrix = np.load(DATA_DIR / "embeddings_pt.npy")
    with open(DATA_DIR / "index_pt.json") as f:
        all_ids = json.load(f)

    # ── Galería = TODOS los embeddings (imágenes limpias de Scryfall) ──────────
    # Las queries son versiones AUGMENTADAS de un 20% de esas mismas cartas.
    # La carta buscada SÍ existe en la galería → evaluación correcta.
    gallery_emb = emb_matrix                     # (N, 1280)
    n_total     = len(all_ids)

    # Seleccionar 20% de posiciones como queries (sin reemplazar)
    rng_np = np.random.default_rng(SEED)
    query_positions = rng_np.choice(n_total, size=int(n_total * TEST_SPLIT), replace=False)

    model = cargar_modelo()
    print(f"Device    : {next(model.parameters()).device}")
    rng   = random.Random(SEED)

    top1_ok, top5_ok = 0, 0
    mrr_vals = []
    tiempos_extraccion_ms = []
    tiempos_busqueda_ms   = []

    ejemplos_ok   = []
    ejemplos_fail = []

    print(f"Galería   : {n_total:,} cartas")
    print(f"Consultas : {len(query_positions):,} cartas (imágenes augmentadas)")
    print(f"Evaluando {len(query_positions):,} queries...\n")

    for qi_pos, qi in enumerate(query_positions):
        card_id = all_ids[qi]
        card    = cards_info.get(card_id)
        if not card:
            continue

        ruta = IMAGES_DIR / f"{card_id}.jpg"
        if not ruta.exists():
            continue

        # Augmentar imagen (simula foto de carta física)
        img_aug = augmentar_imagen(str(ruta), rng)

        # Extraer embedding
        t0 = time.perf_counter()
        query_emb = imagen_a_embedding(img_aug, model)
        t1 = time.perf_counter()
        tiempos_extraccion_ms.append((t1 - t0) * 1000)

        # Buscar en galería
        t0 = time.perf_counter()
        topk_idx = buscar_topk(query_emb, gallery_emb, TOP_K)
        t1 = time.perf_counter()
        tiempos_busqueda_ms.append((t1 - t0) * 1000)

        # gallery_emb = emb_matrix completo → índices == posiciones en all_ids
        retrieved_ids = [all_ids[i] for i in topk_idx]
        sim_scores    = (gallery_emb @ query_emb)

        correcto = card_id in retrieved_ids

        if retrieved_ids[0] == card_id:
            top1_ok += 1

        if correcto:
            top5_ok += 1
            rank = retrieved_ids.index(card_id) + 1
            mrr_vals.append(1.0 / rank)
        else:
            mrr_vals.append(0.0)

        # Guardar ejemplos para visualización
        top1_card = cards_info.get(retrieved_ids[0], {})
        if correcto and len(ejemplos_ok) < 4:
            ejemplos_ok.append({
                "query_path"  : str(ruta),
                "query_name"  : card["name"],
                "match_path"  : str(IMAGES_DIR / f"{retrieved_ids[0]}.jpg"),
                "match_name"  : top1_card.get("name", "?"),
                "sim"         : float(sim_scores[topk_idx[0]]),
            })
        elif not correcto and len(ejemplos_fail) < 4:
            ejemplos_fail.append({
                "query_path"  : str(ruta),
                "query_name"  : card["name"],
                "match_path"  : str(IMAGES_DIR / f"{retrieved_ids[0]}.jpg"),
                "match_name"  : top1_card.get("name", "?"),
                "sim"         : float(sim_scores[topk_idx[0]]),
            })

        if (qi_pos + 1) % 100 == 0:
            n_done = qi_pos + 1
            print(f"  {n_done:>4}/{len(query_positions)}  Top-1: {top1_ok/n_done:.3f}  "
                  f"Top-5: {top5_ok/n_done:.3f}  MRR: {np.mean(mrr_vals):.3f}")

    n = len(mrr_vals)
    metricas = {
        "framework"            : "PyTorch",
        "backbone"             : "EfficientNet_b0",
        "n_gallery"            : n_total,
        "n_query"              : n,
        "top1_accuracy"        : top1_ok / n,
        "top5_accuracy"        : top5_ok / n,
        "mrr"                  : float(np.mean(mrr_vals)),
        "mean_extraction_ms"   : float(np.mean(tiempos_extraccion_ms)),
        "std_extraction_ms"    : float(np.std(tiempos_extraccion_ms)),
        "mean_search_ms"       : float(np.mean(tiempos_busqueda_ms)),
        "std_search_ms"        : float(np.std(tiempos_busqueda_ms)),
    }

    return metricas, ejemplos_ok, ejemplos_fail


def graficar_ejemplos(ejemplos_ok: list, ejemplos_fail: list):
    """Grid 2x4: fila superior = correctas, fila inferior = incorrectas."""
    fig, axes = plt.subplots(2, 4, figsize=(16, 8))
    fig.suptitle("MTG Card Scanner — PyTorch (EfficientNet_b0)\nEjemplos de recuperación con imagen augmentada",
                 fontsize=13, fontweight="bold")

    def mostrar_par(ax_q, ax_m, ejemplo, ok: bool):
        color = "#2ECC71" if ok else "#E74C3C"
        label = "✓ Correcto" if ok else "✗ Incorrecto"

        try:
            img_q = Image.open(ejemplo["query_path"]).convert("RGB")
            ax_q.imshow(img_q)
        except Exception:
            ax_q.text(0.5, 0.5, "Error\ncargando", ha="center", va="center", transform=ax_q.transAxes)
        ax_q.set_title(f"Query\n{ejemplo['query_name'][:20]}", fontsize=8)
        ax_q.axis("off")

        try:
            img_m = Image.open(ejemplo["match_path"]).convert("RGB")
            ax_m.imshow(img_m)
        except Exception:
            ax_m.text(0.5, 0.5, "Error\ncargando", ha="center", va="center", transform=ax_m.transAxes)
        ax_m.set_title(f"{label}\n{ejemplo['match_name'][:20]}\nsim={ejemplo['sim']:.3f}",
                       fontsize=8, color=color, fontweight="bold")
        ax_m.axis("off")
        for spine in ax_m.spines.values():
            spine.set_edgecolor(color)
            spine.set_linewidth(2)

    for col, ej in enumerate(ejemplos_ok[:4]):
        mostrar_par(axes[0][col * 0], axes[0][col], ej, ok=True)

    for col, ej in enumerate(ejemplos_fail[:4]):
        mostrar_par(axes[1][col * 0], axes[1][col], ej, ok=False)

    # Labels de fila
    axes[0][0].set_ylabel("Correctas", fontsize=11, fontweight="bold", color="#2ECC71")
    axes[1][0].set_ylabel("Incorrectas", fontsize=11, fontweight="bold", color="#E74C3C")

    plt.tight_layout()
    out = RESULTS_DIR / "eval_examples.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


def graficar_metricas(metricas: dict):
    """Barras horizontales con las tres métricas principales."""
    nombres = ["Top-1 Accuracy", "Top-5 Accuracy", "MRR"]
    valores = [metricas["top1_accuracy"], metricas["top5_accuracy"], metricas["mrr"]]
    colores = ["#3498DB", "#9B59B6", "#E67E22"]

    fig, ax = plt.subplots(figsize=(8, 4))
    bars = ax.barh(nombres, valores, color=colores, edgecolor="black", linewidth=0.7)
    ax.set_xlim(0, 1.05)
    ax.set_xlabel("Score")
    ax.set_title(f"MTG Card Scanner — PyTorch EfficientNet_b0\n"
                 f"Galería: {metricas['n_gallery']:,} cartas  |  Consultas: {metricas['n_query']:,}",
                 fontsize=11, fontweight="bold")

    for bar, val in zip(bars, valores):
        ax.text(val + 0.01, bar.get_y() + bar.get_height() / 2,
                f"{val:.3f}", va="center", fontsize=12, fontweight="bold")

    # Tiempo de inferencia como anotación
    ax.text(0.98, 0.05,
            f"Extracción: {metricas['mean_extraction_ms']:.1f}±{metricas['std_extraction_ms']:.1f} ms\n"
            f"Búsqueda:   {metricas['mean_search_ms']:.2f}±{metricas['std_search_ms']:.2f} ms",
            transform=ax.transAxes, ha="right", va="bottom", fontsize=9,
            bbox={"boxstyle": "round,pad=0.3", "facecolor": "#F8F9FA", "edgecolor": "#ADB5BD"})

    ax.grid(axis="x", alpha=0.3)
    plt.tight_layout()
    out = RESULTS_DIR / "metrics_pt.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


def main():
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    if not (DATA_DIR / "embeddings_pt.npy").exists():
        print("Error: data/embeddings_pt.npy no existe. Ejecuta 03_pt_embedder.py primero.")
        return

    with open(SHARED_DATA_DIR / "cards.json", encoding="utf-8") as f:
        cards_info = {c["id"]: c for c in json.load(f)}

    metricas, ejemplos_ok, ejemplos_fail = evaluar(cards_info)

    # Guardar JSON de métricas
    out_json = RESULTS_DIR / "metrics_pt.json"
    with open(out_json, "w") as f:
        json.dump(metricas, f, indent=2)

    print(f"\n{'═' * 50}")
    print(f"  Framework        : {metricas['framework']}")
    print(f"  Backbone         : {metricas['backbone']}")
    print(f"  Galería / Queries: {metricas['n_gallery']:,} / {metricas['n_query']:,}")
    print(f"  Top-1 Accuracy   : {metricas['top1_accuracy']:.4f}")
    print(f"  Top-5 Accuracy   : {metricas['top5_accuracy']:.4f}")
    print(f"  MRR              : {metricas['mrr']:.4f}")
    print(f"  Extracción emb.  : {metricas['mean_extraction_ms']:.1f} ± {metricas['std_extraction_ms']:.1f} ms")
    print(f"  Búsqueda coseno  : {metricas['mean_search_ms']:.2f} ± {metricas['std_search_ms']:.2f} ms")
    print(f"{'═' * 50}")

    print("\nGenerando gráficos...")
    graficar_metricas(metricas)
    if ejemplos_ok or ejemplos_fail:
        graficar_ejemplos(ejemplos_ok, ejemplos_fail)

    print(f"\nResultados en: {RESULTS_DIR}/")
    print(f"Siguiente paso: python 05_visualize.py")


if __name__ == "__main__":
    main()
