"""
MTG Card Scanner — Certamen 1
07_binary_classifier.py: Clasificador binario "¿Es una carta MTG?" (TensorFlow)

Pipeline:
    1. Descarga metadatos e imágenes de cartas Pokémon (pokemontcg.io),
       Star Wars: Unlimited (api.swu-db.com), y fotos genéricas "no hay
       ninguna carta acá" (Wikimedia Commons) como negativos.
    2. Construye dataset balanceado: N cartas MTG + N cartas no-MTG (clases iguales).
    3. Fine-tune MobileNetV3Small con cabeza binaria (binary_crossentropy).
    4. Evalúa: confusion matrix, F1-score, ROC-AUC.
    5. Guarda modelo en models/mtg_detector.keras para usar en scanner.py.

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
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import requests
import tensorflow as tf
from sklearn.metrics import (
    accuracy_score, confusion_matrix, f1_score,
    precision_score, recall_score, roc_auc_score, roc_curve,
)
from tqdm import tqdm

from src.binary_classifier import build_binary_classifier
from src.config import IMG_SIZE

# ── Configuración ─────────────────────────────────────────────────────────────
SCRIPT_DIR      = pathlib.Path(__file__).resolve().parent
SHARED_DATA_DIR = SCRIPT_DIR.parent / "data"             # dataset compartido PT+TF
IMAGES_MTG      = SHARED_DATA_DIR / "images"             # cartas MTG (flat: {id}.jpg)
IMAGES_NEG      = SHARED_DATA_DIR / "images_negatives"   # cartas no-MTG
MODELS_DIR      = SCRIPT_DIR / "models"
RESULTS_DIR     = SCRIPT_DIR / "results"

SEED         = 42
N_PER_CLASS  = 3000   # cartas por clase (MTG y no-MTG)
EPOCHS       = 15
BATCH_SIZE   = 32
VAL_SPLIT    = 0.20

POKEMON_API   = "https://api.pokemontcg.io/v2/cards"
POKEMON_HDR   = {"User-Agent": "MTG-Scanner-Academic/1.0 (UDD Frameworks de IA)"}
POKEMON_DELAY = 0.06  # 60 ms entre descargas de imagen

SWU_API = "https://api.swu-db.com"  # Star Wars: Unlimited — ver obtener_metadata_star_wars()
COMMONS_API = "https://commons.wikimedia.org/w/api.php"  # ver obtener_metadata_generic_scenes()

random.seed(SEED)
np.random.seed(SEED)
tf.random.set_seed(SEED)


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
    page = 1
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

        data = resp.json()
        batch = data.get("data", [])
        if not batch:
            break

        for card in batch:
            imgs = card.get("images", {})
            url = imgs.get("large") or imgs.get("small")
            if url:
                cartas.append({"id": card["id"], "name": card["name"], "image_url": url})

        total = data.get("totalCount", 0)
        print(f"    Página {page}: +{len(batch)} cartas  ({len(cartas)}/{min(n_target, total)} cargadas)")

        if page * 250 >= total or not data.get("data"):
            break
        page += 1
        time.sleep(0.25)  # respetar rate-limit de la API

    return cartas[:n_target]


def obtener_metadata_star_wars(n_target: int) -> list:
    """
    Descarga metadatos de cartas Star Wars: Unlimited desde api.swu-db.com
    (comunitaria, sin API key). Se sumó como segunda fuente de negativos
    porque pruebas reales en dispositivo (Smart Scan) encontraron que
    Stage 1 confunde cartas de Star Wars: Unlimited con MTG con alta
    confianza — su layout moderno (barra de título arriba, caja de texto
    de reglas abajo, proporciones de carta similares) se parece mucho más
    a Magic que Pokémon, la única fuente que este script tenía hasta ahora
    (ver ROADMAP.md, ítem I18). Pagina por set (GET /sets → lista de
    setId, GET /cards/{setId} → cartas de ese set) hasta juntar n_target
    cartas. Retorna lista de dicts {id, name, image_url}.
    """
    cartas = []
    print(f"  Descargando metadatos Star Wars: Unlimited (objetivo: {n_target:,} cartas)...")

    try:
        resp = _get_con_reintentos(f"{SWU_API}/sets", headers=POKEMON_HDR, timeout=30)
    except requests.exceptions.RequestException as e:
        print(f"    ✗ No se pudo obtener la lista de sets ({e}); 0 cartas obtenidas.")
        return cartas

    for s in resp.json():
        if len(cartas) >= n_target:
            break
        set_id = s.get("setId")
        if not set_id:
            continue
        try:
            resp = _get_con_reintentos(f"{SWU_API}/cards/{set_id}", headers=POKEMON_HDR, timeout=60)
        except requests.exceptions.RequestException as e:
            print(f"    ✗ Set {set_id} falló tras reintentos ({e}); saltando.")
            continue

        batch = resp.json().get("data", [])
        for card in batch:
            url = card.get("FrontArt")
            if not url:
                continue
            cid = f"{card.get('Set', set_id)}_{card.get('Number', len(cartas))}"
            cartas.append({"id": cid, "name": card.get("Name", cid), "image_url": url})

        print(f"    Set {set_id}: +{len(batch)} cartas  ({len(cartas)}/{n_target} cargadas)")
        if len(cartas) >= n_target:
            break
        time.sleep(0.25)  # sin rate-limit documentado, pero cortesía con la API

    return cartas[:n_target]


def _commons_category_files(category: str) -> list[str]:
    """Lista todos los títulos de archivo de una categoría de Wikimedia Commons
    (con paginación vía cmcontinue). Ver certamen_1/pytorch/07_binary_classifier.py,
    misma función — duplicada acá porque este script no importa de pytorch/."""
    titles: list[str] = []
    params = {
        "action": "query", "list": "categorymembers", "cmtitle": f"Category:{category}",
        "cmlimit": 100, "cmtype": "file", "format": "json",
    }
    while True:
        resp = _get_con_reintentos(COMMONS_API, params=params, headers=POKEMON_HDR, timeout=30)
        data = resp.json()
        titles += [m["title"] for m in data.get("query", {}).get("categorymembers", [])]
        cont = data.get("continue")
        if not cont:
            break
        params = {**params, **cont}
    return titles


def _commons_resolve_urls(titles: list[str], width: int = 800) -> dict[str, str]:
    """Resuelve títulos de archivo de Commons a una URL de imagen directa
    (thumburl, con fallback a la URL original). La API acepta hasta 50
    títulos por request."""
    urls: dict[str, str] = {}
    for i in range(0, len(titles), 50):
        batch = titles[i:i + 50]
        resp = _get_con_reintentos(
            COMMONS_API,
            params={
                "action": "query", "titles": "|".join(batch),
                "prop": "imageinfo", "iiprop": "url", "iiurlwidth": width,
                "format": "json",
            },
            headers=POKEMON_HDR, timeout=30,
        )
        data = resp.json()
        for page in data.get("query", {}).get("pages", {}).values():
            info = (page.get("imageinfo") or [{}])[0]
            url = info.get("thumburl") or info.get("url")
            if url and page.get("title"):
                urls[page["title"]] = url
        time.sleep(0.2)  # ser educados con la API de Commons
    return urls


def _commons_id(title: str, prefix: str) -> str:
    """'File:Some room.jpg' → 'prefix_Some_room'."""
    stem = title.split(":", 1)[-1].rsplit(".", 1)[0]
    return f"{prefix}_{stem.replace(' ', '_')}"


GENERIC_SCENE_CATEGORIES = [
    "Living rooms", "Bedrooms", "Classrooms", "Kitchens", "Human hands",
    "Laptops", "Television sets", "Computer monitors", "Crowds", "Parks",
]


def obtener_metadata_generic_scenes(n_target: int) -> list:
    """
    Descarga metadatos de fotos genéricas "no hay ninguna carta acá" desde
    Wikimedia Commons — cuartos, manos, pantallas/laptops/TVs, multitudes,
    exteriores — sumadas como tercera fuente de negativos porque un reporte
    real en dispositivo (Smart Scan) encontró a Stage 1 aceptando un video
    reproduciéndose en la pantalla de un laptop, con poca luz, como si fuera
    una carta MTG (ver ROADMAP.md, ítem I31). Ni Pokémon ni Star Wars:
    Unlimited son "no hay carta en cuadro" — ambas son fotos limpias y bien
    iluminadas de OTRA carta coleccionable — así que la tarea que entrenan
    (MTG vs. otro TCG) es más fácil que la tarea real desplegada (MTG vs.
    cualquier cosa que vea una cámara de celular). Mismo patrón que
    `pytorch/07_binary_classifier.py`'s versión de esta función — ver ahí
    para el detalle completo, duplicado acá byte-a-byte donde el código lo
    permite porque este script no importa de pytorch/.
    Retorna lista de dicts {id, name, image_url}.
    """
    print(f"  Descargando metadatos de escenas genéricas (objetivo: {n_target:,} fotos, "
          f"{len(GENERIC_SCENE_CATEGORIES)} categorías Commons)...")
    cartas: list = []
    vistos: set = set()
    rng = random.Random(SEED)
    por_categoria = max(n_target // len(GENERIC_SCENE_CATEGORIES), 20)

    for cat in GENERIC_SCENE_CATEGORIES:
        try:
            titles = _commons_category_files(cat)
        except requests.exceptions.RequestException as e:
            print(f"    ✗ Categoría {cat!r} falló tras reintentos ({e}); saltando.")
            continue
        rng.shuffle(titles)
        titles = titles[:por_categoria]
        urls = _commons_resolve_urls(titles)
        prefijo = re.sub(r"[^a-z0-9]+", "_", cat.lower()).strip("_")
        nuevos = 0
        for t, u in urls.items():
            if t in vistos:
                continue
            vistos.add(t)
            cartas.append({"id": _commons_id(t, prefijo), "name": t, "image_url": u})
            nuevos += 1
        print(f"    {cat}: +{nuevos} fotos  ({len(cartas)}/{n_target} acumuladas)")

    rng.shuffle(cartas)
    return cartas[:n_target]


def _descargar_una(card: dict, dest_dir: pathlib.Path, delay: float = POKEMON_DELAY,
                    max_reintentos: int = 3, backoff: float = 2.0) -> bool:
    dest = dest_dir / f"{card['id']}.jpg"
    if dest.exists():
        return True
    try:
        resp = _get_con_reintentos(
            card["image_url"], max_reintentos=max_reintentos, backoff=backoff, headers=POKEMON_HDR, timeout=30,
        )
        dest.write_bytes(resp.content)
        time.sleep(delay)
        return True
    except Exception:
        return False


# Wikimedia Commons (upload.wikimedia.org) devuelve 429 "Too many requests"
# incluso en serie con el delay/backoff por defecto — mismas fuentes lentas
# que en el lado PyTorch (ver ese script's `_COMMONS_DL`).
_COMMONS_DL = {"workers": 1, "delay": 1.5, "max_reintentos": 6, "backoff": 3.0}


def _descargar_fuente(nombre: str, fetch_meta, n_target: int, skip: bool, workers: int = 4,
                       delay: float = POKEMON_DELAY, max_reintentos: int = 3, backoff: float = 2.0) -> list:
    """Descarga (con caché) las imágenes de UNA fuente de negativos —
    factorizado de descargar_negativos() para no duplicar la lógica de
    caché/descarga entre fuentes."""
    dir_ = IMAGES_NEG / nombre
    dir_.mkdir(parents=True, exist_ok=True)

    meta_path = IMAGES_NEG / f"{nombre}_meta.json"
    if meta_path.exists():
        with open(meta_path) as f:
            cartas = json.load(f)
        print(f"  Metadatos en caché ({nombre}): {len(cartas):,} cartas")
        if len(cartas) < n_target:
            print(f"  Caché insuficiente ({len(cartas)} < {n_target}), expandiendo...")
            cartas = fetch_meta(n_target)
            with open(meta_path, "w") as f:
                json.dump(cartas, f)
    else:
        cartas = fetch_meta(n_target)
        with open(meta_path, "w") as f:
            json.dump(cartas, f)

    if not skip:
        pendientes = [c for c in cartas if not (dir_ / f"{c['id']}.jpg").exists()]
        ya_ok = len(cartas) - len(pendientes)
        print(f"  Ya descargadas: {ya_ok:,}  |  Pendientes: {len(pendientes):,}")
        if pendientes:
            print(f"  Descargando imágenes {nombre} ({workers} hilo{'s' if workers != 1 else ''}, ~{len(pendientes)*100//1024} MB estimado)...")
            with ThreadPoolExecutor(max_workers=workers) as pool:
                futures = {
                    pool.submit(_descargar_una, c, dir_, delay, max_reintentos, backoff): c
                    for c in pendientes
                }
                ok = sum(1 for f in tqdm(as_completed(futures), total=len(pendientes), desc=f"    {nombre}") if f.result())
            print(f"  Descargadas: {ok:,} nuevas")

    return [str(dir_ / f"{c['id']}.jpg") for c in cartas if (dir_ / f"{c['id']}.jpg").exists()]


def descargar_negativos(n_target: int, skip: bool = False) -> list:
    """
    Descarga imágenes de tres fuentes como ejemplos negativos — Pokémon TCG,
    Star Wars: Unlimited (ver obtener_metadata_star_wars()), y escenas
    genéricas "no hay carta acá" (ver obtener_metadata_generic_scenes(),
    ROADMAP I31) — repartiendo el presupuesto n_target parejo entre las
    tres. Retorna lista de rutas a archivos descargados existentes.
    """
    n_poke = n_target // 3
    n_sw   = n_target // 3
    n_gen  = n_target - n_poke - n_sw

    print(f"  ── Fuente de negativos: pokemon (objetivo: {n_poke:,} cartas) ──")
    rutas = _descargar_fuente("pokemon", obtener_metadata_pokemon, n_poke, skip)

    print(f"  ── Fuente de negativos: star_wars_unlimited (objetivo: {n_sw:,} cartas) ──")
    rutas += _descargar_fuente("star_wars_unlimited", obtener_metadata_star_wars, n_sw, skip)

    print(f"  ── Fuente de negativos: generic_scenes (objetivo: {n_gen:,} fotos) ──")
    rutas += _descargar_fuente("generic_scenes", obtener_metadata_generic_scenes, n_gen, skip, **_COMMONS_DL)

    return rutas


# ── SECCIÓN 2: Dataset balanceado (tf.data) ───────────────────────────────────

AUGMENT = tf.keras.Sequential([
    tf.keras.layers.RandomFlip("horizontal"),
    tf.keras.layers.RandomRotation(10 / 360),
    tf.keras.layers.RandomContrast(0.3),
    tf.keras.layers.RandomBrightness(0.3, value_range=(0, 255)),
    tf.keras.layers.RandomCrop(IMG_SIZE[0], IMG_SIZE[1]),
])


def _decode_resize(path: tf.Tensor, label: tf.Tensor, size: tuple) -> tuple:
    img = tf.io.read_file(path)
    img = tf.io.decode_jpeg(img, channels=3)
    img = tf.image.resize(img, size)
    return img, label


def preparar_muestras(rutas_mtg: list, rutas_neg: list, n: int) -> tuple:
    """
    Construye splits train/val con N muestras balanceadas por clase.
    Retorna (train_samples, val_samples) donde cada sample = (path, label).
    """
    n = min(len(rutas_mtg), len(rutas_neg), n)
    rng = random.Random(SEED)

    pos = [(p, 1) for p in rng.sample(rutas_mtg, n)]   # MTG = 1
    neg = [(p, 0) for p in rng.sample(rutas_neg, n)]   # no-MTG = 0
    todos = pos + neg
    rng.shuffle(todos)

    split = int(len(todos) * (1 - VAL_SPLIT))
    return todos[:split], todos[split:]


def build_dataset(samples: list, training: bool, batch_size: int = BATCH_SIZE) -> tf.data.Dataset:
    paths = [s[0] for s in samples]
    labels = [float(s[1]) for s in samples]
    # MobileNetV3 incluye el rescaling como parte del modelo; preprocess_input
    # es un passthrough (espera pixeles en [0, 255], que es lo que produce
    # _decode_resize/AUGMENT).
    preprocess = tf.keras.applications.mobilenet_v3.preprocess_input

    ds = tf.data.Dataset.from_tensor_slices((paths, labels))
    if training:
        ds = ds.shuffle(len(samples), seed=SEED, reshuffle_each_iteration=True)
        grande = (IMG_SIZE[0] + 32, IMG_SIZE[1] + 32)
        ds = ds.map(lambda p, l: _decode_resize(p, l, grande), num_parallel_calls=tf.data.AUTOTUNE)
        ds = ds.map(lambda img, l: (AUGMENT(img, training=True), l), num_parallel_calls=tf.data.AUTOTUNE)
    else:
        ds = ds.map(lambda p, l: _decode_resize(p, l, IMG_SIZE), num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.map(lambda img, l: (preprocess(img), l), num_parallel_calls=tf.data.AUTOTUNE)
    ds = ds.batch(batch_size).prefetch(tf.data.AUTOTUNE)
    return ds


# ── SECCIÓN 3: Entrenamiento ───────────────────────────────────────────────────

class _HistoryJsonWriter(tf.keras.callbacks.Callback):
    """Reescribe `history_path` con el historial acumulado tras cada época,
    para que un proceso externo (el desktop-runner) pueda pollear el archivo
    y mostrar el loss en vivo mientras entrena."""

    def __init__(self, history_path: pathlib.Path):
        super().__init__()
        self.history_path = history_path
        self.historial: list = []

    def on_epoch_end(self, epoch, logs=None):
        logs = logs or {}
        self.historial.append({
            "epoch": epoch + 1,
            "train_loss": float(logs.get("loss", 0.0)),
            "val_loss": float(logs.get("val_loss", 0.0)),
        })
        with open(self.history_path, "w") as f:
            json.dump(self.historial, f, indent=2)


def entrenar(model: tf.keras.Model, train_ds: tf.data.Dataset, val_ds: tf.data.Dataset, epochs: int,
             history_path: pathlib.Path | None = None) -> list:
    """Fine-tune del detector. Guarda el mejor checkpoint según val_loss."""
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_path = MODELS_DIR / "mtg_detector.keras"

    checkpoint = tf.keras.callbacks.ModelCheckpoint(
        filepath=str(model_path), monitor="val_loss", save_best_only=True, verbose=0,
    )
    scheduler = tf.keras.callbacks.LearningRateScheduler(
        lambda epoch, lr: float(3e-4 * 0.5 * (1 + np.cos(np.pi * epoch / epochs)))
    )
    callbacks = [checkpoint, scheduler]
    if history_path is not None:
        callbacks.append(_HistoryJsonWriter(history_path))

    history = model.fit(
        train_ds,
        validation_data=val_ds,
        epochs=epochs,
        callbacks=callbacks,
        shuffle=False,  # el shuffle ya se hace en build_dataset() via tf.data
        verbose=2,
    )

    return [
        {"epoch": i + 1, "train_loss": tl, "val_loss": vl}
        for i, (tl, vl) in enumerate(zip(history.history["loss"], history.history["val_loss"]))
    ]


# ── SECCIÓN 4: Evaluación ──────────────────────────────────────────────────────

def evaluar(model: tf.keras.Model, val_ds: tf.data.Dataset, y_true: np.ndarray) -> tuple:
    """Inferencia sobre el set de validación con el mejor checkpoint."""
    y_prob = model.predict(val_ds, verbose=0).flatten()
    y_pred = (y_prob >= 0.5).astype(int)

    fpr, tpr, _ = roc_curve(y_true, y_prob)
    auc = roc_auc_score(y_true, y_prob)

    metricas = {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "precision": float(precision_score(y_true, y_pred, zero_division=0)),
        "recall": float(recall_score(y_true, y_pred, zero_division=0)),
        "f1": float(f1_score(y_true, y_pred, zero_division=0)),
        "roc_auc": float(auc),
        "threshold": 0.5,
        "n_val": int(len(y_true)),
        "n_mtg_val": int(y_true.sum()),
        "n_no_mtg_val": int((1 - y_true).sum()),
    }

    return metricas, y_true, y_pred, y_prob, fpr, tpr


# ── SECCIÓN 5: Visualizaciones ─────────────────────────────────────────────────

def graficar_loss(historial: list):
    epochs = [h["epoch"] for h in historial]
    train_loss = [h["train_loss"] for h in historial]
    val_loss = [h["val_loss"] for h in historial]

    fig, ax = plt.subplots(figsize=(8, 5))
    ax.plot(epochs, train_loss, color="#E74C3C", lw=2, label="Train Loss")
    ax.plot(epochs, val_loss, color="#3498DB", lw=2, label="Val Loss")
    ax.set(xlabel="Época", ylabel="BCE Loss",
           title="Curva de Pérdida — Clasificador MTG / No-MTG (TensorFlow)")
    ax.legend(); ax.grid(alpha=0.3)
    plt.tight_layout()
    out = RESULTS_DIR / "loss_binary.png"
    plt.savefig(out, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  → {out}")


def graficar_confusion(y_true, y_pred):
    cm = confusion_matrix(y_true, y_pred)
    labels = ["No MTG", "MTG"]

    fig, ax = plt.subplots(figsize=(6, 5))
    im = ax.imshow(cm, interpolation="nearest", cmap="Blues")
    plt.colorbar(im, ax=ax)
    ax.set(
        xticks=range(2), yticks=range(2),
        xticklabels=labels, yticklabels=labels,
        xlabel="Predicción", ylabel="Real",
        title="Confusion Matrix — Clasificador MTG / No-MTG (TensorFlow)",
    )
    thresh = cm.max() / 2
    for i in range(2):
        for j in range(2):
            ax.text(j, i, f"{cm[i, j]:,}",
                    ha="center", va="center", fontsize=18, fontweight="bold",
                    color="white" if cm[i, j] > thresh else "black")
    plt.tight_layout()
    out = RESULTS_DIR / "confusion_matrix_binary.png"
    plt.savefig(out, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  → {out}")


def graficar_roc(fpr, tpr, auc_score: float):
    fig, ax = plt.subplots(figsize=(7, 6))
    ax.plot(fpr, tpr, color="#3498DB", lw=2.5, label=f"ROC (AUC = {auc_score:.4f})")
    ax.plot([0, 1], [0, 1], "--", color="gray", lw=1.5, label="Clasificador aleatorio")
    ax.fill_between(fpr, tpr, alpha=0.12, color="#3498DB")
    ax.set(
        xlim=(0, 1), ylim=(0, 1.02),
        xlabel="False Positive Rate",
        ylabel="True Positive Rate (Recall)",
        title="Curva ROC — Clasificador MTG / No-MTG (TensorFlow)",
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
               metricas["recall"], metricas["f1"], metricas["roc_auc"]]
    colores = ["#27AE60", "#3498DB", "#E67E22", "#E74C3C", "#9B59B6"]

    fig, ax = plt.subplots(figsize=(8, 5))
    bars = ax.bar(nombres, valores, color=colores, edgecolor="black", linewidth=0.7)
    ax.set_ylim(0, 1.15)
    ax.axhline(1.0, linestyle="--", color="gray", linewidth=0.8)
    ax.set(ylabel="Score", title="Métricas — Clasificador MTG / No-MTG (TensorFlow)")
    ax.grid(axis="y", alpha=0.3)
    for bar, val in zip(bars, valores):
        ax.text(bar.get_x() + bar.get_width() / 2, val + 0.02,
                f"{val:.3f}", ha="center", fontsize=12, fontweight="bold")
    plt.tight_layout()
    out = RESULTS_DIR / "metrics_binary_bar.png"
    plt.savefig(out, dpi=150, bbox_inches="tight"); plt.close()
    print(f"  → {out}")


# ── Main ────────────────────────────────────────────────────────────────────────

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

    n = args.n
    epochs = args.epochs

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_NEG.mkdir(parents=True, exist_ok=True)

    print("=" * 60)
    print("  MTG Card Scanner — Clasificador Binario (TensorFlow)")
    print(f"  Por clase  : {n:,} cartas  |  Total: {n * 2:,}")
    print(f"  Épocas     : {epochs}")
    print("=" * 60)

    # ── 1. Rutas MTG ─────────────────────────────────────────────────────
    print("\n[1/5] Buscando imágenes MTG...")
    rutas_mtg = [str(p) for p in IMAGES_MTG.glob("*.jpg")]
    print(f"  Encontradas: {len(rutas_mtg):,} imágenes MTG")
    if len(rutas_mtg) < 500:
        print("  Error: muy pocas imágenes MTG. Ejecuta ../02_downloader.py primero.")
        sys.exit(1)

    # ── 2. Negativos (Pokémon) ────────────────────────────────────────────
    print("\n[2/5] Preparando imágenes no-MTG (Pokémon TCG)...")
    rutas_neg = descargar_negativos(n, skip=args.skip_download)
    print(f"  Disponibles: {len(rutas_neg):,} imágenes no-MTG")
    if len(rutas_neg) < 100:
        print("  Error: muy pocas imágenes negativas. Verifica conexión a internet.")
        sys.exit(1)

    # ── 3. Dataset ────────────────────────────────────────────────────────
    print("\n[3/5] Construyendo dataset balanceado...")
    train_samples, val_samples = preparar_muestras(rutas_mtg, rutas_neg, n)
    n_eff = len(train_samples) + len(val_samples)
    print(f"  Train : {len(train_samples):,}  ({sum(1 for _, l in train_samples if l==1):,} MTG "
          f"+ {sum(1 for _, l in train_samples if l==0):,} no-MTG)")
    print(f"  Val   : {len(val_samples):,}  ({sum(1 for _, l in val_samples if l==1):,} MTG "
          f"+ {sum(1 for _, l in val_samples if l==0):,} no-MTG)")
    print(f"  Total efectivo: {n_eff:,} muestras ({n_eff // 2:,} por clase)")

    train_ds = build_dataset(train_samples, training=True)
    val_ds = build_dataset(val_samples, training=False)
    y_true_val = np.array([l for _, l in val_samples], dtype=int)

    # ── 4. Modelo + entrenamiento ─────────────────────────────────────────
    print(f"\n[4/5] Entrenando MTGDetector (MobileNetV3Small, {epochs} épocas)...")
    model = build_binary_classifier()
    n_trainable = sum(np.prod(v.shape) for v in model.trainable_variables)
    print(f"  Parámetros entrenables: {n_trainable / 1e6:.2f}M\n")

    historial = entrenar(model, train_ds, val_ds, epochs,
                          history_path=RESULTS_DIR / "training_history.json")

    # ── 5. Evaluación ─────────────────────────────────────────────────────
    print("\n[5/5] Evaluando mejor checkpoint...")
    model = tf.keras.models.load_model(MODELS_DIR / "mtg_detector.keras")
    metricas, y_true, y_pred, y_prob, fpr, tpr = evaluar(model, val_ds, y_true_val)

    print("\n── Resultados ──────────────────────────────────────────────")
    print(f"  Accuracy  : {metricas['accuracy']:.4f}")
    print(f"  Precision : {metricas['precision']:.4f}")
    print(f"  Recall    : {metricas['recall']:.4f}")
    print(f"  F1-Score  : {metricas['f1']:.4f}")
    print(f"  ROC-AUC   : {metricas['roc_auc']:.4f}")

    # Curva ROC y matriz de confusión — para graficar en el desktop-runner
    # (ya se calculan para las figuras PNG, acá se persisten además en JSON).
    metricas["roc_curve"] = {"fpr": fpr.tolist(), "tpr": tpr.tolist()}
    metricas["confusion_matrix"] = confusion_matrix(y_true, y_pred).tolist()

    metricas_path = RESULTS_DIR / "metrics_binary.json"
    with open(metricas_path, "w") as f:
        json.dump(metricas, f, indent=2)
    print(f"\n  → {metricas_path}")

    cfg = {
        "threshold": 0.5,
        "model_path": "models/mtg_detector.keras",
        "n_per_class": n,
        "img_size": list(IMG_SIZE),
    }
    cfg_path = MODELS_DIR / "mtg_detector_cfg.json"
    with open(cfg_path, "w") as f:
        json.dump(cfg, f, indent=2)

    print("\nGenerando gráficos...")
    graficar_loss(historial)
    graficar_confusion(y_true, y_pred)
    graficar_roc(fpr, tpr, metricas["roc_auc"])
    graficar_metricas_bar(metricas)

    print(f"\n  Modelo guardado   : {MODELS_DIR / 'mtg_detector.keras'}")
    print(f"  Resultados en     : {RESULTS_DIR}/")
    print("\nPróximo paso: python scanner.py <imagen>")


if __name__ == "__main__":
    main()
