"""
MTG Card Scanner — Certamen 1
04_evaluate.py: Evaluación del sistema de reconocimiento de cartas (TensorFlow).

Protocolo de evaluación:
    1. Galería = TODOS los embeddings (imágenes limpias de Scryfall).
    2. Queries = 20% de cartas con augmentaciones que simulan foto real.
    3. Para cada query: buscar las k más similares por similitud coseno.
    4. Registrar métricas de retrieval y de clasificación binaria.

Métricas de retrieval:
    Top-1 Accuracy : la carta correcta es el 1er resultado
    Top-5 Accuracy : la carta correcta está entre los 5 primeros
    MRR            : promedio de 1/rank (Mean Reciprocal Rank)

Métricas de clasificación (top-1 correcto vs incorrecto):
    Accuracy       : fracción de queries con top-1 correcto
    Precision      : TP / (TP + FP) al umbral de similitud óptimo
    Recall         : TP / (TP + FN) al umbral de similitud óptimo
    F1-Score       : media armónica de precision y recall
    ROC-AUC        : área bajo la curva ROC (similitud como score)
    Confusion Matrix por rareza: cómo se confunden cartas de distinta rareza

Salida:
    results/metrics_tf.json               — todas las métricas numéricas
    results/metrics_tf.png                — barras Top-1/Top-5/MRR
    results/eval_examples_tf.png          — grid ejemplos correctos / incorrectos
    results/roc_retrieval_tf.png          — curva ROC de retrieval
    results/confusion_rareza_tf.png       — confusion matrix por rareza
    results/metricas_clasificacion_tf.png — barras accuracy/precision/recall/F1/AUC

Requiere haber corrido antes: python 03_build_embeddings.py
"""

import json
import pathlib
import random
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.metrics import (
    accuracy_score,
    auc,
    confusion_matrix,
    f1_score,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_curve,
)

from src.config import PATHS
from src.embeddings import build_feature_extractor, embed_pil_image, load_index

RESULTS_DIR = pathlib.Path("results")
SEED = 42
TEST_SPLIT = 0.20    # 20% consultas, 80% galería
TOP_K = 5
RARITY_ORDER = ["common", "uncommon", "rare", "mythic"]

random.seed(SEED)
np.random.seed(SEED)


# ── Augmentación (simula foto real, solo PIL) ────────────────────────────────

def _find_perspective_coeffs(pa: list, pb: list) -> np.ndarray:
    """Coeficientes para Image.transform(..., Image.PERSPECTIVE, ...).
    pa: 4 esquinas del cuadro de SALIDA. pb: de dónde vienen en la imagen de ENTRADA."""
    matrix = []
    for p1, p2 in zip(pa, pb):
        matrix.append([p1[0], p1[1], 1, 0, 0, 0, -p2[0] * p1[0], -p2[0] * p1[1]])
        matrix.append([0, 0, 0, p1[0], p1[1], 1, -p2[1] * p1[0], -p2[1] * p1[1]])
    a = np.array(matrix, dtype=np.float64)
    b = np.array(pb, dtype=np.float64).reshape(8)
    return np.linalg.solve(a, b)


def _perspectiva_aleatoria(img: Image.Image, distortion_scale: float, rng: random.Random) -> Image.Image:
    width, height = img.size
    jitter_w = distortion_scale * width / 2
    jitter_h = distortion_scale * height / 2
    pa = [(0, 0), (width, 0), (width, height), (0, height)]
    pb = [
        (rng.uniform(0, jitter_w), rng.uniform(0, jitter_h)),
        (width - rng.uniform(0, jitter_w), rng.uniform(0, jitter_h)),
        (width - rng.uniform(0, jitter_w), height - rng.uniform(0, jitter_h)),
        (rng.uniform(0, jitter_w), height - rng.uniform(0, jitter_h)),
    ]
    coeffs = _find_perspective_coeffs(pa, pb)
    return img.transform((width, height), Image.PERSPECTIVE, coeffs, Image.BICUBIC, fillcolor=(0, 0, 0))


def augmentar_imagen(img_path: pathlib.Path, rng: random.Random) -> Image.Image:
    """
    Aplica transformaciones que emulan condiciones fotográficas:
    - Perspectiva aleatoria (ángulo de disparo)
    - Variación de brillo, contraste y saturación (iluminación imperfecta)
    - Rotación leve (carta no alineada perfectamente)
    - Crop aleatorio (carta parcialmente visible en la foto)
    - Blur gaussiano leve (desenfoque de cámara)
    Retorna imagen PIL.
    """
    img = Image.open(img_path).convert("RGB")

    img = _perspectiva_aleatoria(img, distortion_scale=0.30, rng=rng)

    factor = rng.uniform(0.60, 1.40)
    img = ImageEnhance.Brightness(img).enhance(factor)

    factor = rng.uniform(0.70, 1.30)
    img = ImageEnhance.Contrast(img).enhance(factor)

    factor = rng.uniform(0.80, 1.20)
    img = ImageEnhance.Color(img).enhance(factor)

    angle = rng.uniform(-15, 15)
    img = img.rotate(angle, expand=False, fillcolor=(0, 0, 0))

    w, h = img.size
    crop_scale = rng.uniform(0.80, 1.0)
    cw, ch = int(w * crop_scale), int(h * crop_scale)
    x0 = rng.randint(0, w - cw)
    y0 = rng.randint(0, h - ch)
    img = img.crop((x0, y0, x0 + cw, y0 + ch)).resize((w, h), Image.BILINEAR)

    if rng.random() < 0.6:
        img = img.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.5, 2.0)))

    return img


# ── Búsqueda ──────────────────────────────────────────────────────────────────

def buscar_topk(query_emb: np.ndarray, gallery_emb: np.ndarray, k: int) -> np.ndarray:
    """Índices de las k cartas más similares (similitud coseno = producto punto, embeddings L2-normalizados)."""
    sims = gallery_emb @ query_emb
    return np.argsort(sims)[::-1][:k]


def evaluar(cards_info: dict) -> tuple:
    index = load_index(PATHS.embedding_index)
    gallery_emb = index["embeddings"]
    all_ids = index.get("ids")
    if not all_ids:
        raise SystemExit(
            "El indice no tiene IDs de carta. Reconstruyelo con: python 03_build_embeddings.py --force"
        )
    n_total = len(all_ids)

    rng_np = np.random.default_rng(SEED)
    query_positions = rng_np.choice(n_total, size=int(n_total * TEST_SPLIT), replace=False)

    model = build_feature_extractor()
    rng = random.Random(SEED)

    top1_ok, top5_ok = 0, 0
    mrr_vals: list = []
    tiempos_extraccion_ms: list = []
    tiempos_busqueda_ms: list = []

    top1_correcto: list = []   # etiqueta binaria: ¿el top-1 fue la carta correcta?
    top1_scores: list = []     # similitud del top-1 (score de confianza)
    rarezas_true: list = []
    rarezas_pred: list = []

    ejemplos_ok: list = []
    ejemplos_fail: list = []

    print(f"Galería   : {n_total:,} cartas")
    print(f"Consultas : {len(query_positions):,} cartas (imágenes augmentadas)")
    print(f"Evaluando {len(query_positions):,} queries...\n")

    for qi_pos, qi in enumerate(query_positions):
        card_id = all_ids[qi]
        card = cards_info.get(card_id)
        if not card:
            continue

        ruta = PATHS.images_dir / f"{card_id}.jpg"
        if not ruta.exists():
            continue

        img_aug = augmentar_imagen(ruta, rng)

        t0 = time.perf_counter()
        query_emb = embed_pil_image(model, img_aug)
        t1 = time.perf_counter()
        tiempos_extraccion_ms.append((t1 - t0) * 1000)

        t0 = time.perf_counter()
        topk_idx = buscar_topk(query_emb, gallery_emb, TOP_K)
        t1 = time.perf_counter()
        tiempos_busqueda_ms.append((t1 - t0) * 1000)

        retrieved_ids = [all_ids[i] for i in topk_idx]
        sim_scores = gallery_emb @ query_emb

        correcto = card_id in retrieved_ids
        top1_es_correcto = retrieved_ids[0] == card_id

        if top1_es_correcto:
            top1_ok += 1

        if correcto:
            top5_ok += 1
            rank = retrieved_ids.index(card_id) + 1
            mrr_vals.append(1.0 / rank)
        else:
            mrr_vals.append(0.0)

        top1_card = cards_info.get(retrieved_ids[0], {})

        top1_correcto.append(int(top1_es_correcto))
        top1_scores.append(float(sim_scores[topk_idx[0]]))
        rarezas_true.append(card.get("rarity", "unknown"))
        rarezas_pred.append(top1_card.get("rarity", "unknown"))

        entry = {
            "query_path": str(ruta),
            "query_name": card["name"],
            "match_path": str(PATHS.images_dir / f"{retrieved_ids[0]}.jpg"),
            "match_name": top1_card.get("name", "?"),
            "sim": float(sim_scores[topk_idx[0]]),
        }
        if correcto and len(ejemplos_ok) < 4:
            ejemplos_ok.append(entry)
        elif not correcto and len(ejemplos_fail) < 4:
            ejemplos_fail.append(entry)

        if (qi_pos + 1) % 100 == 0:
            n_done = qi_pos + 1
            print(f"  {n_done:>4}/{len(query_positions)}  Top-1: {top1_ok/n_done:.3f}  "
                  f"Top-5: {top5_ok/n_done:.3f}  MRR: {np.mean(mrr_vals):.3f}")

    n = len(mrr_vals)
    metricas = {
        "framework": "TensorFlow",
        "backbone": "MobileNetV2",
        "n_gallery": n_total,
        "n_query": n,
        "top1_accuracy": top1_ok / n,
        "top5_accuracy": top5_ok / n,
        "mrr": float(np.mean(mrr_vals)),
        "mean_extraction_ms": float(np.mean(tiempos_extraccion_ms)),
        "std_extraction_ms": float(np.std(tiempos_extraccion_ms)),
        "mean_search_ms": float(np.mean(tiempos_busqueda_ms)),
        "std_search_ms": float(np.std(tiempos_busqueda_ms)),
    }

    clasificacion = {
        "y_true": top1_correcto,
        "scores": top1_scores,
        "rarezas_true": rarezas_true,
        "rarezas_pred": rarezas_pred,
    }

    return metricas, clasificacion, ejemplos_ok, ejemplos_fail


# ── Métricas de clasificación (top-1 correcto vs incorrecto) ────────────────

def calcular_metricas_clasificacion(top1_accuracy: float, y_true: list, scores: list) -> dict:
    """
    Trata la similitud del top-1 como score de confianza y la corrección del
    top-1 como etiqueta binaria. Precision/Recall/F1 se calculan en el umbral
    que maximiza F1 (el punto donde el sistema debería aceptar o rechazar
    una coincidencia según su similitud).
    """
    y_true_arr = np.array(y_true)
    scores_arr = np.array(scores)

    fpr, tpr, _ = roc_curve(y_true_arr, scores_arr)
    roc_auc = float(auc(fpr, tpr))

    precisions, recalls, pr_thresholds = precision_recall_curve(y_true_arr, scores_arr)
    f1s = 2 * precisions * recalls / (precisions + recalls + 1e-12)
    if len(pr_thresholds) > 0:
        best_idx = int(np.argmax(f1s[:-1]))
        threshold_optimo = float(pr_thresholds[best_idx])
    else:
        threshold_optimo = 0.5

    y_pred = (scores_arr >= threshold_optimo).astype(int)

    metrics = {
        "threshold_optimo": threshold_optimo,
        "accuracy": float(top1_accuracy),
        "precision": float(precision_score(y_true_arr, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true_arr, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true_arr, y_pred, zero_division=0)),
        "roc_auc": roc_auc,
    }
    return metrics, (fpr, tpr, roc_auc)


# ── Gráficos ──────────────────────────────────────────────────────────────────

def graficar_ejemplos(ejemplos_ok: list, ejemplos_fail: list):
    """Grid 2x4: fila superior = correctas, fila inferior = incorrectas."""
    fig, axes = plt.subplots(2, 4, figsize=(16, 8))
    fig.suptitle("MTG Card Scanner — TensorFlow (MobileNetV2)\nEjemplos de recuperación con imagen augmentada",
                 fontsize=13, fontweight="bold")

    def mostrar(ax, ejemplo: dict, ok: bool):
        color = "#2ECC71" if ok else "#E74C3C"
        label = "Correcto" if ok else "Incorrecto"

        try:
            img_m = Image.open(ejemplo["match_path"]).convert("RGB")
            ax.imshow(img_m)
        except Exception:
            ax.text(0.5, 0.5, "Error\ncargando", ha="center", va="center", transform=ax.transAxes)
        ax.set_title(
            f"Query: {ejemplo['query_name'][:18]}\n{label}: {ejemplo['match_name'][:18]}\nsim={ejemplo['sim']:.3f}",
            fontsize=8, color=color, fontweight="bold",
        )
        ax.axis("off")
        for spine in ax.spines.values():
            spine.set_edgecolor(color)
            spine.set_linewidth(2)

    for col in range(4):
        if col < len(ejemplos_ok):
            mostrar(axes[0][col], ejemplos_ok[col], ok=True)
        else:
            axes[0][col].axis("off")
        if col < len(ejemplos_fail):
            mostrar(axes[1][col], ejemplos_fail[col], ok=False)
        else:
            axes[1][col].axis("off")

    plt.tight_layout()
    out = RESULTS_DIR / "eval_examples_tf.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


def graficar_metricas(metricas: dict):
    """Barras horizontales con las tres métricas principales de retrieval."""
    nombres = ["Top-1 Accuracy", "Top-5 Accuracy", "MRR"]
    valores = [metricas["top1_accuracy"], metricas["top5_accuracy"], metricas["mrr"]]
    colores = ["#3498DB", "#9B59B6", "#E67E22"]

    fig, ax = plt.subplots(figsize=(8, 4))
    bars = ax.barh(nombres, valores, color=colores, edgecolor="black", linewidth=0.7)
    ax.set_xlim(0, 1.05)
    ax.set_xlabel("Score")
    ax.set_title(f"MTG Card Scanner — TensorFlow MobileNetV2\n"
                 f"Galería: {metricas['n_gallery']:,} cartas  |  Consultas: {metricas['n_query']:,}",
                 fontsize=11, fontweight="bold")

    for bar, val in zip(bars, valores):
        ax.text(val + 0.01, bar.get_y() + bar.get_height() / 2,
                f"{val:.3f}", va="center", fontsize=12, fontweight="bold")

    ax.text(0.98, 0.05,
            f"Extracción: {metricas['mean_extraction_ms']:.1f}±{metricas['std_extraction_ms']:.1f} ms\n"
            f"Búsqueda:   {metricas['mean_search_ms']:.2f}±{metricas['std_search_ms']:.2f} ms",
            transform=ax.transAxes, ha="right", va="bottom", fontsize=9,
            bbox={"boxstyle": "round,pad=0.3", "facecolor": "#F8F9FA", "edgecolor": "#ADB5BD"})

    ax.grid(axis="x", alpha=0.3)
    plt.tight_layout()
    out = RESULTS_DIR / "metrics_tf.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


def graficar_roc(roc_data: tuple):
    fpr, tpr, roc_auc = roc_data
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.plot(fpr, tpr, color="#3498DB", linewidth=2, label=f"ROC (AUC = {roc_auc:.3f})")
    ax.plot([0, 1], [0, 1], color="#BDC3C7", linestyle="--", linewidth=1, label="Azar (AUC = 0.500)")
    ax.set_xlabel("Tasa de Falsos Positivos (FPR)")
    ax.set_ylabel("Tasa de Verdaderos Positivos (TPR)")
    ax.set_title("MTG Card Scanner — TensorFlow MobileNetV2\nCurva ROC — similitud top-1 como score de confianza",
                 fontsize=11, fontweight="bold")
    ax.legend(loc="lower right")
    ax.grid(alpha=0.3)
    plt.tight_layout()
    out = RESULTS_DIR / "roc_retrieval_tf.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


def graficar_confusion_rareza(rarezas_true: list, rarezas_pred: list):
    etiquetas = list(RARITY_ORDER)
    presentes = set(rarezas_true) | set(rarezas_pred)
    extra = sorted(r for r in presentes if r not in etiquetas)
    etiquetas += extra

    matriz = confusion_matrix(rarezas_true, rarezas_pred, labels=etiquetas)

    fig, ax = plt.subplots(figsize=(7, 6))
    im = ax.imshow(matriz, cmap="Blues")
    ax.set_xticks(range(len(etiquetas)))
    ax.set_yticks(range(len(etiquetas)))
    ax.set_xticklabels(etiquetas, rotation=30, ha="right")
    ax.set_yticklabels(etiquetas)
    ax.set_xlabel("Rareza predicha (top-1)")
    ax.set_ylabel("Rareza real")
    ax.set_title("MTG Card Scanner — TensorFlow MobileNetV2\nConfusion Matrix por Rareza",
                 fontsize=11, fontweight="bold")

    umbral = matriz.max() / 2 if matriz.max() else 0
    for i in range(matriz.shape[0]):
        for j in range(matriz.shape[1]):
            valor = matriz[i, j]
            color = "white" if valor > umbral else "black"
            ax.text(j, i, f"{valor:,}", ha="center", va="center", color=color, fontsize=9)

    fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04, label="Cantidad de queries")
    plt.tight_layout()
    out = RESULTS_DIR / "confusion_rareza_tf.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


def graficar_metricas_clasificacion(clas_metrics: dict):
    nombres = ["Accuracy", "Precision", "Recall", "F1-Score", "ROC-AUC"]
    valores = [
        clas_metrics["accuracy"],
        clas_metrics["precision"],
        clas_metrics["recall"],
        clas_metrics["f1"],
        clas_metrics["roc_auc"],
    ]
    colores = ["#3498DB", "#2ECC71", "#F39C12", "#9B59B6", "#E74C3C"]

    fig, ax = plt.subplots(figsize=(8, 4.5))
    bars = ax.barh(nombres, valores, color=colores, edgecolor="black", linewidth=0.7)
    ax.set_xlim(0, 1.05)
    ax.set_xlabel("Score")
    ax.set_title(
        f"MTG Card Scanner — TensorFlow MobileNetV2\n"
        f"Métricas de clasificación (umbral óptimo = {clas_metrics['threshold_optimo']:.3f})",
        fontsize=11, fontweight="bold",
    )

    for bar, val in zip(bars, valores):
        ax.text(val + 0.01, bar.get_y() + bar.get_height() / 2,
                f"{val:.3f}", va="center", fontsize=12, fontweight="bold")

    ax.grid(axis="x", alpha=0.3)
    plt.tight_layout()
    out = RESULTS_DIR / "metricas_clasificacion_tf.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


def main():
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    if not PATHS.embedding_index.exists():
        print("Error: indice de embeddings no existe. Ejecuta 03_build_embeddings.py primero.")
        return

    with open(PATHS.catalog_json, encoding="utf-8") as f:
        cards_info = {c["id"]: c for c in json.load(f)}

    metricas, clasificacion, ejemplos_ok, ejemplos_fail = evaluar(cards_info)

    clas_metrics, roc_data = calcular_metricas_clasificacion(
        top1_accuracy=metricas["top1_accuracy"],
        y_true=clasificacion["y_true"],
        scores=clasificacion["scores"],
    )
    metricas["clasificacion"] = clas_metrics

    out_json = RESULTS_DIR / "metrics_tf.json"
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
    print(f"  {'─' * 46}")
    print(f"  Precision        : {clas_metrics['precision']:.4f}")
    print(f"  Recall           : {clas_metrics['recall']:.4f}")
    print(f"  F1-Score         : {clas_metrics['f1']:.4f}")
    print(f"  ROC-AUC          : {clas_metrics['roc_auc']:.4f}")
    print(f"  Umbral óptimo    : {clas_metrics['threshold_optimo']:.4f}")
    print(f"{'═' * 50}")

    print("\nGenerando gráficos...")
    graficar_metricas(metricas)
    if ejemplos_ok or ejemplos_fail:
        graficar_ejemplos(ejemplos_ok, ejemplos_fail)
    graficar_roc(roc_data)
    graficar_confusion_rareza(clasificacion["rarezas_true"], clasificacion["rarezas_pred"])
    graficar_metricas_clasificacion(clas_metrics)

    print(f"\nResultados en: {RESULTS_DIR}/")
    print(f"Siguiente paso: python 05_visualize.py")


if __name__ == "__main__":
    main()
