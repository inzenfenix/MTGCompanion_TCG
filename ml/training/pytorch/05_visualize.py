"""
MTG Card Scanner — Certamen 1
05_visualize.py: Visualizaciones del espacio de embeddings.

Genera tres figuras:
    results/tsne_pt.png         — t-SNE de embeddings coloreados por color de maná MTG
    results/rarity_tsne_pt.png  — t-SNE coloreados por rareza de carta
    results/stats_dataset.png   — EDA del dataset: distribuciones de rareza, color, CMC
"""

import json
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from sklearn.manifold import TSNE

# ── Configuración ─────────────────────────────────────────────────────────────
SCRIPT_DIR  = pathlib.Path(__file__).resolve().parent
DATA_DIR    = SCRIPT_DIR / "data"                    # artefactos locales (embeddings, índice)
SHARED_DATA_DIR = SCRIPT_DIR.parent / "data"         # dataset compartido (cards.json, imágenes)
RESULTS_DIR = pathlib.Path("results")
SEED = 42
N_TSNE = 2000   # máximo de puntos para t-SNE (más = más lento pero más preciso)

# Paleta de colores MTG → hex
COLOR_MTG = {
    "W": "#F5E6C8",   # White (marfil)
    "U": "#3498DB",   # Blue
    "B": "#2C3E50",   # Black (gris oscuro para visibilidad)
    "R": "#E74C3C",   # Red
    "G": "#27AE60",   # Green
}
MULTI_COLOR    = "#F39C12"   # Gold (multicolor)
COLORLESS_COLOR = "#95A5A6"  # Silver (incoloro)

RARITY_COLORS = {
    "common"   : "#7F8C8D",
    "uncommon" : "#95A5A6",
    "rare"     : "#F39C12",
    "mythic"   : "#E67E22",
    "special"  : "#9B59B6",
    "bonus"    : "#E91E63",
}


# ── Helpers ───────────────────────────────────────────────────────────────────

def color_de_carta(colors: list) -> str:
    if not colors:
        return COLORLESS_COLOR
    if len(colors) > 1:
        return MULTI_COLOR
    return COLOR_MTG.get(colors[0], COLORLESS_COLOR)


def construir_leyenda_colores() -> list:
    return [
        mpatches.Patch(color=COLOR_MTG["W"], label="White (W)", edgecolor="gray", linewidth=0.5),
        mpatches.Patch(color=COLOR_MTG["U"], label="Blue (U)"),
        mpatches.Patch(color=COLOR_MTG["B"], label="Black (B)"),
        mpatches.Patch(color=COLOR_MTG["R"], label="Red (R)"),
        mpatches.Patch(color=COLOR_MTG["G"], label="Green (G)"),
        mpatches.Patch(color=MULTI_COLOR,    label="Multicolor"),
        mpatches.Patch(color=COLORLESS_COLOR, label="Colorless"),
    ]


def construir_leyenda_rareza() -> list:
    return [
        mpatches.Patch(color=v, label=k.capitalize())
        for k, v in RARITY_COLORS.items()
    ]


# ── t-SNE ────────────────────────────────────────────────────────────────────

def calcular_tsne(emb_matrix: np.ndarray, n: int) -> np.ndarray:
    """
    Reduce dimensionalidad de 1280-dim → 2-dim con t-SNE.
    Usa una muestra aleatoria de n puntos si el dataset es más grande.
    """
    np.random.seed(SEED)
    idx = np.random.choice(len(emb_matrix), min(n, len(emb_matrix)), replace=False)
    sample = emb_matrix[idx]

    print(f"  Calculando t-SNE para {len(idx):,} puntos (perplexity=40)...")
    tsne = TSNE(
        n_components=2,
        perplexity=40,
        learning_rate="auto",
        init="pca",
        random_state=SEED,
        max_iter=1000,
        n_jobs=-1,
    )
    coords = tsne.fit_transform(sample)
    return coords, idx


def graficar_tsne_color(coords: np.ndarray, idx: np.ndarray, cards_info: dict, all_ids: list):
    """t-SNE coloreado por color de maná MTG."""
    colores = [
        color_de_carta(cards_info.get(all_ids[i], {}).get("colors", []))
        for i in idx
    ]

    fig, ax = plt.subplots(figsize=(13, 10))
    ax.scatter(coords[:, 0], coords[:, 1],
               c=colores, s=6, alpha=0.75, linewidths=0)

    ax.set_title(
        f"t-SNE — Embeddings EfficientNet_b0 (PyTorch)\n"
        f"{len(idx):,} cartas MTG coloreadas por color de maná",
        fontsize=13, fontweight="bold"
    )
    ax.axis("off")
    ax.legend(handles=construir_leyenda_colores(), loc="lower right",
              fontsize=10, framealpha=0.9)

    plt.tight_layout()
    out = RESULTS_DIR / "tsne_pt.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


def graficar_tsne_rareza(coords: np.ndarray, idx: np.ndarray, cards_info: dict, all_ids: list):
    """t-SNE coloreado por rareza de carta."""
    colores = [
        RARITY_COLORS.get(cards_info.get(all_ids[i], {}).get("rarity", ""), COLORLESS_COLOR)
        for i in idx
    ]

    fig, ax = plt.subplots(figsize=(13, 10))
    ax.scatter(coords[:, 0], coords[:, 1],
               c=colores, s=6, alpha=0.75, linewidths=0)

    ax.set_title(
        f"t-SNE — Embeddings EfficientNet_b0 (PyTorch)\n"
        f"{len(idx):,} cartas MTG coloreadas por rareza",
        fontsize=13, fontweight="bold"
    )
    ax.axis("off")
    ax.legend(handles=construir_leyenda_rareza(), loc="lower right",
              fontsize=10, framealpha=0.9)

    plt.tight_layout()
    out = RESULTS_DIR / "rarity_tsne_pt.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


# ── EDA del dataset ──────────────────────────────────────────────────────────

def graficar_eda(cards: list):
    """
    Análisis exploratorio del dataset:
    - Distribución de rareza
    - Distribución de color de maná
    - Distribución de CMC (Converted Mana Cost)
    - Cartas por año de release
    """
    from collections import Counter

    rarezas = Counter(c.get("rarity", "unknown") for c in cards)
    colores_raw = []
    for c in cards:
        cols = c.get("colors") or []
        if not cols:
            colores_raw.append("Colorless")
        elif len(cols) > 1:
            colores_raw.append("Multicolor")
        else:
            colores_raw.append({"W":"White","U":"Blue","B":"Black","R":"Red","G":"Green"}.get(cols[0], cols[0]))

    color_count = Counter(colores_raw)
    cmc_vals = [c.get("cmc") or 0 for c in cards if (c.get("cmc") or 0) <= 15]
    anios = Counter(c.get("released_at", "")[:4] for c in cards if c.get("released_at"))

    fig, axes = plt.subplots(2, 2, figsize=(14, 10))
    fig.suptitle("MTG Card Scanner — Análisis Exploratorio del Dataset (Scryfall)",
                 fontsize=13, fontweight="bold")

    # 1. Rareza
    ax = axes[0][0]
    orden_rareza = ["common", "uncommon", "rare", "mythic"]
    vals_rareza  = [rarezas.get(r, 0) for r in orden_rareza]
    cols_rareza  = [RARITY_COLORS.get(r, "#AAA") for r in orden_rareza]
    bars = ax.bar(orden_rareza, vals_rareza, color=cols_rareza, edgecolor="black", linewidth=0.6)
    ax.set_title("Distribución por Rareza")
    ax.set_ylabel("Cantidad de cartas")
    for bar, val in zip(bars, vals_rareza):
        ax.text(bar.get_x() + bar.get_width()/2, val + 5,
                f"{val:,}", ha="center", fontsize=10, fontweight="bold")
    ax.grid(axis="y", alpha=0.3)

    # 2. Color
    ax = axes[0][1]
    orden_color = ["White","Blue","Black","Red","Green","Multicolor","Colorless"]
    vals_color  = [color_count.get(c, 0) for c in orden_color]
    hex_color   = [
        COLOR_MTG["W"], COLOR_MTG["U"], COLOR_MTG["B"],
        COLOR_MTG["R"], COLOR_MTG["G"], MULTI_COLOR, COLORLESS_COLOR
    ]
    bars = ax.bar(orden_color, vals_color, color=hex_color, edgecolor="black", linewidth=0.6)
    ax.set_title("Distribución por Color de Maná")
    ax.set_ylabel("Cantidad de cartas")
    ax.set_xticks(range(len(orden_color)))
    ax.set_xticklabels(orden_color, rotation=30, ha="right")
    for bar, val in zip(bars, vals_color):
        if val:
            ax.text(bar.get_x() + bar.get_width()/2, val + 3,
                    f"{val:,}", ha="center", fontsize=9)
    ax.grid(axis="y", alpha=0.3)

    # 3. CMC
    ax = axes[1][0]
    bins = np.arange(0, 17) - 0.5
    ax.hist(cmc_vals, bins=bins, color="#3498DB", edgecolor="black", linewidth=0.5)
    ax.set_title("Distribución de CMC (Costo de Maná Convertido)")
    ax.set_xlabel("CMC")
    ax.set_ylabel("Cantidad de cartas")
    ax.set_xticks(range(0, 16))
    ax.grid(axis="y", alpha=0.3)

    # 4. Cartas por año
    ax = axes[1][1]
    sorted_anios = sorted(anios.items())
    anios_labels = [a for a, _ in sorted_anios]
    anios_vals   = [n for _, n in sorted_anios]
    ax.bar(anios_labels, anios_vals, color="#E67E22", edgecolor="black", linewidth=0.5)
    ax.set_title("Cartas por Año de Lanzamiento")
    ax.set_xlabel("Año")
    ax.set_ylabel("Cantidad de cartas")
    ax.set_xticks(range(len(anios_labels)))
    ax.set_xticklabels(anios_labels, rotation=45, ha="right")
    ax.grid(axis="y", alpha=0.3)

    plt.tight_layout()
    out = RESULTS_DIR / "stats_dataset.png"
    plt.savefig(out, dpi=150, bbox_inches="tight")
    plt.close()
    print(f"  → {out}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)

    # Cargar dataset
    with open(SHARED_DATA_DIR / "cards.json", encoding="utf-8") as f:
        cards = json.load(f)
    cards_info = {c["id"]: c for c in cards}

    print(f"Dataset: {len(cards):,} cartas\n")

    # EDA siempre disponible (no requiere embeddings)
    print("Generando EDA del dataset...")
    graficar_eda(cards)

    # t-SNE requiere embeddings
    emb_path = DATA_DIR / "embeddings_pt.npy"
    if not emb_path.exists():
        print("\nEmbeddings no encontrados — saltando t-SNE.")
        print("Ejecuta 03_pt_embedder.py primero para generar los embeddings.")
        return

    emb_matrix = np.load(emb_path)
    with open(DATA_DIR / "index_pt.json") as f:
        all_ids = json.load(f)

    print(f"\nEmbeddings cargados: {emb_matrix.shape}")

    print("\nGenerando t-SNE (puede tardar 2-5 min)...")
    coords, idx = calcular_tsne(emb_matrix, N_TSNE)

    print("Graficando por color de maná...")
    graficar_tsne_color(coords, idx, cards_info, all_ids)

    print("Graficando por rareza...")
    graficar_tsne_rareza(coords, idx, cards_info, all_ids)

    print(f"\nTodas las visualizaciones guardadas en: {RESULTS_DIR}/")


if __name__ == "__main__":
    main()
