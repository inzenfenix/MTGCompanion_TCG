"""
MTG Card Scanner — Certamen 1
07_binary_classifier.py: Clasificador binario "¿Es una carta MTG?"

Pipeline:
    1. Descarga metadatos e imágenes de cartas Pokémon desde pokemontcg.io (negativos).
    2. Construye dataset balanceado: N cartas MTG + N cartas Pokémon (clases iguales).
    3. Fine-tune EfficientNet_b0 con cabeza binaria (BCEWithLogitsLoss).
    4. Evalúa: confusion matrix, F1-score, ROC-AUC.
    5. Guarda modelo en models/mtg_detector.pth para usar en scanner.py.

Uso:
    python 07_binary_classifier.py                # descarga + entrena + evalúa
    python 07_binary_classifier.py --skip-download # usa imágenes ya descargadas
    python 07_binary_classifier.py --n 2000        # 2000 cartas por clase (default: 3000)
    python 07_binary_classifier.py --epochs 20     # más épocas de entrenamiento
"""

import argparse
import json
import pathlib
import random
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import requests
import torch
import torch.nn as nn
import torchvision.transforms as T
from PIL import Image
from sklearn.metrics import (
    accuracy_score, confusion_matrix, f1_score,
    precision_score, recall_score, roc_auc_score, roc_curve,
)
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm

from src.binary_classifier import FREEZE_RATIO, MTGDetector, build_binary_classifier

# ── Configuración ─────────────────────────────────────────────────────────────
SCRIPT_DIR      = pathlib.Path(__file__).resolve().parent
DATA_DIR        = SCRIPT_DIR / "data"                    # artefactos locales PyTorch
SHARED_DATA_DIR = SCRIPT_DIR.parent / "data"             # dataset compartido PT+TF
IMAGES_MTG      = SHARED_DATA_DIR / "images"             # cartas MTG (flat: {id}.jpg)
IMAGES_NEG      = SHARED_DATA_DIR / "images_negatives"   # cartas no-MTG
MODELS_DIR      = SCRIPT_DIR / "models"
RESULTS_DIR     = SCRIPT_DIR / "results"

IMG_SIZE     = 224
DEVICE       = "cuda" if torch.cuda.is_available() else "cpu"
SEED         = 42
N_PER_CLASS  = 3000   # cartas por clase (MTG y no-MTG)
EPOCHS       = 15
BATCH_SIZE   = 32
VAL_SPLIT    = 0.20
# LR, weight decay, freeze ratio, arquitectura de cabeza: ver defaults de
# build_binary_classifier() en src/binary_classifier.py (única fuente de verdad,
# compartida con 08_optuna_binary_classifier.py).

POKEMON_API   = "https://api.pokemontcg.io/v2/cards"
POKEMON_HDR   = {"User-Agent": "MTG-Scanner-Academic/1.0 (UDD Frameworks de IA)"}
POKEMON_DELAY = 0.06  # 60 ms entre descargas de imagen

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

torch.manual_seed(SEED)
random.seed(SEED)
np.random.seed(SEED)


# ── SECCIÓN 1: Descarga de negativos (Pokémon TCG) ────────────────────────────

def _get_con_reintentos(url: str, max_reintentos: int = 5, backoff: float = 2.0, **kwargs):
    """GET con reintentos y backoff exponencial ante fallos de red transitorios
    (timeouts, conexión reseteada, 5xx). Relanza la excepción tras agotar reintentos."""
    for intento in range(1, max_reintentos + 1):
        try:
            resp = requests.get(url, **kwargs)
            resp.raise_for_status()
            return resp
        except requests.exceptions.RequestException as e:
            if intento == max_reintentos:
                raise
            espera = backoff ** (intento - 1)
            print(f"    ⚠ {e.__class__.__name__} (intento {intento}/{max_reintentos}), "
                  f"reintentando en {espera:.0f}s...")
            time.sleep(espera)


def obtener_metadata_pokemon(n_target: int) -> list:
    """
    Descarga metadatos de cartas Pokémon desde pokemontcg.io.
    No requiere API key (tier gratuito: 1000 req/día).
    Retorna lista de dicts {id, name, image_url}.

    Si una página falla tras agotar reintentos, se detiene y retorna lo
    acumulado hasta ese punto (en vez de perder todo el progreso).
    """
    cartas = []
    page   = 1
    print(f"  Descargando metadatos Pokémon TCG (objetivo: {n_target:,} cartas)...")

    while len(cartas) < n_target:
        try:
            resp = _get_con_reintentos(
                POKEMON_API,
                params={"pageSize": 250, "page": page},
                headers=POKEMON_HDR,
                timeout=60,
            )
        except requests.exceptions.RequestException as e:
            print(f"    ✗ Página {page} falló tras reintentos ({e}); "
                  f"continuando con {len(cartas)} cartas obtenidas.")
            break

        data  = resp.json()
        batch = data.get("data", [])
        if not batch:
            break

        for card in batch:
            imgs = card.get("images", {})
            url  = imgs.get("large") or imgs.get("small")
            if url:
                cartas.append({"id": card["id"], "name": card["name"], "image_url": url})

        total = data.get("totalCount", 0)
        print(f"    Página {page}: +{len(batch)} cartas  ({len(cartas)}/{min(n_target, total)} cargadas)")

        if page * 250 >= total or not data.get("data"):
            break
        page += 1
        time.sleep(0.25)  # respetar rate-limit de la API

    return cartas[:n_target]


def _descargar_una(card: dict, dest_dir: pathlib.Path) -> bool:
    dest = dest_dir / f"{card['id']}.jpg"
    if dest.exists():
        return True
    try:
        resp = _get_con_reintentos(
            card["image_url"], max_reintentos=3, headers=POKEMON_HDR, timeout=30,
        )
        dest.write_bytes(resp.content)
        time.sleep(POKEMON_DELAY)
        return True
    except Exception:
        return False


def descargar_negativos(n_target: int, skip: bool = False) -> list:
    """
    Descarga imágenes de cartas Pokémon como ejemplos negativos.
    Retorna lista de rutas a archivos descargados existentes.
    """
    poke_dir  = IMAGES_NEG / "pokemon"
    poke_dir.mkdir(parents=True, exist_ok=True)

    meta_path = IMAGES_NEG / "pokemon_meta.json"
    if meta_path.exists():
        with open(meta_path) as f:
            cartas = json.load(f)
        print(f"  Metadatos Pokémon en caché: {len(cartas):,} cartas")
        if len(cartas) < n_target:
            # Descargar más páginas si el caché es insuficiente
            print(f"  Caché insuficiente ({len(cartas)} < {n_target}), expandiendo...")
            cartas = obtener_metadata_pokemon(n_target)
            with open(meta_path, "w") as f:
                json.dump(cartas, f)
    else:
        cartas = obtener_metadata_pokemon(n_target)
        with open(meta_path, "w") as f:
            json.dump(cartas, f)

    if not skip:
        pendientes = [c for c in cartas if not (poke_dir / f"{c['id']}.jpg").exists()]
        ya_ok      = len(cartas) - len(pendientes)
        print(f"  Ya descargadas: {ya_ok:,}  |  Pendientes: {len(pendientes):,}")
        if pendientes:
            print(f"  Descargando imágenes Pokémon (4 hilos, ~{len(pendientes)*100//1024} MB estimado)...")
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = {pool.submit(_descargar_una, c, poke_dir): c for c in pendientes}
                ok = sum(1 for f in tqdm(as_completed(futures), total=len(pendientes), desc="    Pokémon") if f.result())
            print(f"  Descargadas: {ok:,} nuevas")

    rutas = [str(poke_dir / f"{c['id']}.jpg") for c in cartas
             if (poke_dir / f"{c['id']}.jpg").exists()]
    return rutas


# ── SECCIÓN 2: Dataset balanceado ─────────────────────────────────────────────

TRANSFORM_TRAIN = T.Compose([
    T.Resize((IMG_SIZE + 32, IMG_SIZE + 32)),
    T.RandomCrop(IMG_SIZE),
    T.RandomHorizontalFlip(),
    T.ColorJitter(brightness=0.3, contrast=0.3, saturation=0.2, hue=0.05),
    T.RandomRotation(10),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])

TRANSFORM_VAL = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


class BinaryDataset(Dataset):
    """Dataset binario: label 1 = MTG, label 0 = no-MTG."""

    def __init__(self, samples: list, transform):
        self.samples   = samples   # [(path, label), ...]
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx: int):
        path, label = self.samples[idx]
        try:
            img = Image.open(path).convert("RGB")
        except Exception:
            img = Image.new("RGB", (IMG_SIZE, IMG_SIZE), color=(128, 128, 128))
        return self.transform(img), torch.tensor(label, dtype=torch.float32)


def preparar_muestras(rutas_mtg: list, rutas_neg: list, n: int) -> tuple:
    """
    Construye splits train/val con N muestras balanceadas por clase.
    Retorna (train_samples, val_samples) donde cada sample = (path, label).
    """
    n = min(len(rutas_mtg), len(rutas_neg), n)
    rng = random.Random(SEED)

    pos   = [(p, 1) for p in rng.sample(rutas_mtg, n)]  # MTG = 1
    neg   = [(p, 0) for p in rng.sample(rutas_neg,  n)]  # no-MTG = 0
    todos = pos + neg
    rng.shuffle(todos)

    split = int(len(todos) * (1 - VAL_SPLIT))
    return todos[:split], todos[split:]


# ── SECCIÓN 3: Arquitectura del modelo ────────────────────────────────────────
# MTGDetector y build_binary_classifier viven en src/binary_classifier.py —
# compartido con 08_optuna_binary_classifier.py para que ambos entrenen
# exactamente la misma arquitectura (ver ese módulo para el detalle).


# ── SECCIÓN 4: Entrenamiento ──────────────────────────────────────────────────

def entrenar(model: MTGDetector, optimizador: torch.optim.Optimizer,
             train_dl: DataLoader, val_dl: DataLoader, epochs: int,
             model_path: pathlib.Path | None = None) -> list:
    """
    Fine-tune del MTGDetector. Guarda el mejor checkpoint según val_loss.
    Retorna historial [{epoch, train_loss, val_loss}, ...].

    `optimizador` se recibe ya construido (en vez de armarlo acá adentro) para
    que 08_optuna_binary_classifier.py pueda reusar esta misma función con el
    optimizer/hiperparámetros que esté probando cada trial.
    """
    criterio    = nn.BCEWithLogitsLoss()
    scheduler   = torch.optim.lr_scheduler.CosineAnnealingLR(optimizador, T_max=epochs)

    mejor_val   = float("inf")
    historial   = []
    model_path  = model_path or (MODELS_DIR / "mtg_detector.pth")
    model_path.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, epochs + 1):
        # ── Train ──────────────────────────────────────────────────────────
        model.train()
        train_loss = 0.0
        for imgs, labels in train_dl:
            imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
            optimizador.zero_grad()
            loss = criterio(model(imgs), labels)
            loss.backward()
            optimizador.step()
            train_loss += loss.item() * len(imgs)
        train_loss /= len(train_dl.dataset)

        # ── Val ────────────────────────────────────────────────────────────
        model.eval()
        val_loss = 0.0
        with torch.no_grad():
            for imgs, labels in val_dl:
                imgs, labels = imgs.to(DEVICE), labels.to(DEVICE)
                val_loss += criterio(model(imgs), labels).item() * len(imgs)
        val_loss /= len(val_dl.dataset)

        scheduler.step()
        historial.append({"epoch": epoch, "train_loss": train_loss, "val_loss": val_loss})

        marker = ""
        if val_loss < mejor_val:
            mejor_val = val_loss
            torch.save(model.state_dict(), model_path)
            marker = "  ← guardado"

        print(f"  Época {epoch:02d}/{epochs}  train={train_loss:.4f}  val={val_loss:.4f}{marker}")

    return historial


# ── SECCIÓN 5: Evaluación ─────────────────────────────────────────────────────

def evaluar(model: MTGDetector, val_dl: DataLoader) -> tuple:
    """
    Inferencia sobre el set de validación con el mejor checkpoint.
    Retorna (metricas_dict, y_true, y_pred, y_prob, fpr, tpr).
    """
    model.eval()
    all_labels, all_probs = [], []

    with torch.no_grad():
        for imgs, labels in val_dl:
            probs = torch.sigmoid(model(imgs.to(DEVICE))).cpu().numpy()
            all_probs.extend(probs)
            all_labels.extend(labels.numpy())

    y_true = np.array(all_labels, dtype=int)
    y_prob = np.array(all_probs)
    y_pred = (y_prob >= 0.5).astype(int)

    fpr, tpr, _ = roc_curve(y_true, y_prob)
    auc         = roc_auc_score(y_true, y_prob)

    metricas = {
        "accuracy"    : float(accuracy_score(y_true, y_pred)),
        "precision"   : float(precision_score(y_true, y_pred, zero_division=0)),
        "recall"      : float(recall_score(y_true, y_pred, zero_division=0)),
        "f1"          : float(f1_score(y_true, y_pred, zero_division=0)),
        "roc_auc"     : float(auc),
        "threshold"   : 0.5,
        "n_val"       : int(len(y_true)),
        "n_mtg_val"   : int(y_true.sum()),
        "n_no_mtg_val": int((1 - y_true).sum()),
    }

    return metricas, y_true, y_pred, y_prob, fpr, tpr


# ── SECCIÓN 6: Visualizaciones ────────────────────────────────────────────────

def graficar_loss(historial: list):
    epochs     = [h["epoch"] for h in historial]
    train_loss = [h["train_loss"] for h in historial]
    val_loss   = [h["val_loss"] for h in historial]

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(epochs, train_loss, color="#E74C3C", lw=2, label="Train Loss")
    ax.plot(epochs, val_loss,   color="#3498DB", lw=2, label="Val Loss")
    ax.set(xlabel="Época", ylabel="BCE Loss",
           title="Curva de Pérdida — Clasificador MTG / No-MTG (PyTorch)")
    ax.legend(); ax.grid(alpha=0.3)
    plt.tight_layout()
    out = RESULTS_DIR / "loss_binary.png"
    plt.savefig(out, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  → {out}")


def graficar_confusion(y_true, y_pred):
    cm     = confusion_matrix(y_true, y_pred)
    labels = ["No MTG", "MTG"]

    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm, interpolation="nearest", cmap="Blues")
    plt.colorbar(im, ax=ax)
    ax.set(
        xticks=range(2), yticks=range(2),
        xticklabels=labels, yticklabels=labels,
        xlabel="Predicción", ylabel="Real",
        title="Confusion Matrix — Clasificador MTG / No-MTG",
    )
    thresh = cm.max() / 2
    for i in range(2):
        for j in range(2):
            ax.text(j, i, f"{cm[i,j]:,}",
                    ha="center", va="center", fontsize=18, fontweight="bold",
                    color="white" if cm[i, j] > thresh else "black")
    plt.tight_layout()
    out = RESULTS_DIR / "confusion_matrix_binary.png"
    plt.savefig(out, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  → {out}")


def graficar_roc(fpr, tpr, auc_score: float):
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.plot(fpr, tpr, color="#3498DB", lw=2.5,
            label=f"ROC (AUC = {auc_score:.4f})")
    ax.plot([0, 1], [0, 1], "--", color="gray", lw=1.5, label="Clasificador aleatorio")
    ax.fill_between(fpr, tpr, alpha=0.12, color="#3498DB")
    ax.set(
        xlim=(0, 1), ylim=(0, 1.02),
        xlabel="False Positive Rate",
        ylabel="True Positive Rate (Recall)",
        title="Curva ROC — Clasificador MTG / No-MTG (PyTorch)",
    )
    ax.legend(loc="lower right", fontsize=12)
    ax.grid(alpha=0.3)
    plt.tight_layout()
    out = RESULTS_DIR / "roc_auc.png"
    plt.savefig(out, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  → {out}")


def graficar_metricas_bar(metricas: dict):
    nombres = ["Accuracy", "Precision", "Recall", "F1", "ROC-AUC"]
    valores = [metricas["accuracy"], metricas["precision"],
               metricas["recall"],   metricas["f1"], metricas["roc_auc"]]
    colores = ["#27AE60", "#3498DB", "#E67E22", "#E74C3C", "#9B59B6"]

    fig, ax = plt.subplots(figsize=(8, 5))
    bars = ax.bar(nombres, valores, color=colores, edgecolor="black", linewidth=0.7)
    ax.set_ylim(0, 1.15)
    ax.axhline(1.0, linestyle="--", color="gray", linewidth=0.8)
    ax.set(ylabel="Score",
           title="Métricas — Clasificador MTG / No-MTG (PyTorch)")
    ax.grid(axis="y", alpha=0.3)
    for bar, val in zip(bars, valores):
        ax.text(bar.get_x() + bar.get_width() / 2, val + 0.02,
                f"{val:.3f}", ha="center", fontsize=12, fontweight="bold")
    plt.tight_layout()
    out = RESULTS_DIR / "metrics_binary_bar.png"
    plt.savefig(out, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  → {out}")


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Clasificador binario MTG / No-MTG — descarga, entrena y evalúa.",
    )
    parser.add_argument("--skip-download", action="store_true",
                        help="Omitir descarga de imágenes Pokémon (usar caché)")
    parser.add_argument("--n", type=int, default=N_PER_CLASS,
                        help=f"Cartas por clase (default: {N_PER_CLASS})")
    parser.add_argument("--epochs", type=int, default=EPOCHS,
                        help=f"Épocas de entrenamiento (default: {EPOCHS})")
    args = parser.parse_args()

    n       = args.n
    epochs  = args.epochs

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_NEG.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  MTG Card Scanner — Clasificador Binario (PyTorch)")
    print(f"  Device     : {DEVICE}")
    print(f"  Por clase  : {n:,} cartas  |  Total: {n * 2:,}")
    print(f"  Épocas     : {epochs}")
    print("=" * 60)

    # ── 1. Rutas MTG ─────────────────────────────────────────────────────
    print("\n[1/5] Buscando imágenes MTG...")
    rutas_mtg = [str(p) for p in IMAGES_MTG.glob("*.jpg")]
    print(f"  Encontradas: {len(rutas_mtg):,} imágenes MTG")
    if len(rutas_mtg) < 500:
        print("  Error: muy pocas imágenes MTG. Ejecuta ../02_downloader.py primero.")
        return

    # ── 2. Negativos (Pokémon) ────────────────────────────────────────────
    print("\n[2/5] Preparando imágenes no-MTG (Pokémon TCG)...")
    rutas_neg = descargar_negativos(n, skip=args.skip_download)
    print(f"  Disponibles: {len(rutas_neg):,} imágenes no-MTG")
    if len(rutas_neg) < 100:
        print("  Error: muy pocas imágenes negativas. Verifica conexión a internet.")
        return

    # ── 3. Dataset ────────────────────────────────────────────────────────
    print("\n[3/5] Construyendo dataset balanceado...")
    train_samples, val_samples = preparar_muestras(rutas_mtg, rutas_neg, n)
    n_eff = len(train_samples) + len(val_samples)
    print(f"  Train : {len(train_samples):,}  ({sum(1 for _,l in train_samples if l==1):,} MTG "
          f"+ {sum(1 for _,l in train_samples if l==0):,} no-MTG)")
    print(f"  Val   : {len(val_samples):,}  ({sum(1 for _,l in val_samples if l==1):,} MTG "
          f"+ {sum(1 for _,l in val_samples if l==0):,} no-MTG)")
    print(f"  Total efectivo: {n_eff:,} muestras ({n_eff // 2:,} por clase)")

    train_ds = BinaryDataset(train_samples, TRANSFORM_TRAIN)
    val_ds   = BinaryDataset(val_samples,   TRANSFORM_VAL)
    train_dl = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,
                          num_workers=4, pin_memory=(DEVICE == "cuda"))
    val_dl   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False,
                          num_workers=4, pin_memory=(DEVICE == "cuda"))

    # ── 4. Modelo + entrenamiento ─────────────────────────────────────────
    print(f"\n[4/5] Entrenando MTGDetector (EfficientNet_b0, {epochs} épocas)...")
    model, optimizador = build_binary_classifier(device=DEVICE)
    print(f"  Bloques congelados: 0–{model.freeze_until - 1}  |  entrenables: {model.freeze_until}–8 + cabeza binaria")
    n_trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Parámetros entrenables: {n_trainable / 1e6:.2f}M\n")

    historial = entrenar(model, optimizador, train_dl, val_dl, epochs)

    # ── 5. Evaluación ─────────────────────────────────────────────────────
    print("\n[5/5] Evaluando mejor checkpoint...")
    model.load_state_dict(
        torch.load(MODELS_DIR / "mtg_detector.pth", map_location=DEVICE, weights_only=True)
    )
    metricas, y_true, y_pred, y_prob, fpr, tpr = evaluar(model, val_dl)

    print("\n── Resultados ──────────────────────────────────────────────")
    print(f"  Accuracy  : {metricas['accuracy']:.4f}")
    print(f"  Precision : {metricas['precision']:.4f}")
    print(f"  Recall    : {metricas['recall']:.4f}")
    print(f"  F1-Score  : {metricas['f1']:.4f}")
    print(f"  ROC-AUC   : {metricas['roc_auc']:.4f}")

    # Guardar métricas JSON
    metricas_path = RESULTS_DIR / "metrics_binary.json"
    with open(metricas_path, "w") as f:
        json.dump(metricas, f, indent=2)
    print(f"\n  → {metricas_path}")

    # Guardar config del detector (usada por scanner.py para reconstruir la
    # arquitectura exacta antes de cargar el state_dict — necesario porque
    # 08_optuna_binary_classifier.py puede publicar un modelo con head_units/
    # freeze_ratio/dropout distintos a los defaults de acá).
    cfg = {
        "threshold"    : 0.5,
        "model_path"   : "models/mtg_detector.pth",
        "n_per_class"  : n,
        "freeze_ratio" : model.freeze_ratio,
        "head_units"   : model.head_units,
        "dropout"      : None,
        "img_size"     : IMG_SIZE,
    }
    cfg_path = MODELS_DIR / "mtg_detector_cfg.json"
    with open(cfg_path, "w") as f:
        json.dump(cfg, f, indent=2)

    print("\nGenerando gráficos...")
    graficar_loss(historial)
    graficar_confusion(y_true, y_pred)
    graficar_roc(fpr, tpr, metricas["roc_auc"])
    graficar_metricas_bar(metricas)

    print(f"\n  Modelo guardado   : {MODELS_DIR / 'mtg_detector.pth'}")
    print(f"  Resultados en     : {RESULTS_DIR}/")
    print("\nPróximo paso: python scanner.py <imagen>")
    print("  (El clasificador binario se activa automáticamente.)")


if __name__ == "__main__":
    main()
