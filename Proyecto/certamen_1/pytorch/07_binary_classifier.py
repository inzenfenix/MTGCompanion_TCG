"""
MTG Card Scanner — Certamen 1
07_binary_classifier.py: Clasificador binario "¿Es una carta MTG?"

Pipeline:
    1. Descarga metadatos e imágenes de varias fuentes como negativos: dos
       TCGs — Pokémon (pokemontcg.io) + Yu-Gi-Oh! (YGOPRODeck) — y dos mazos
       de naipes fuera del mundo TCG — inglés/francés y español (Wikimedia
       Commons, dominio público). Más de una fuente, y de tipos distintos de
       "no-MTG", evita que el clasificador aprenda un atajo específico de
       una sola fuente en vez de "MTG vs cualquier otra cosa".
    2. Construye dataset balanceado: N cartas MTG + N cartas no-MTG (clases iguales).
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

POKEMON_API = "https://api.pokemontcg.io/v2/cards"
YUGIOH_API  = "https://db.ygoprodeck.com/api/v7/cardinfo.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
NEG_HDR     = {"User-Agent": "MTG-Scanner-Academic/1.0 (UDD Frameworks de IA)"}
NEG_DELAY   = 0.06  # 60 ms entre descargas de imagen, para cualquier fuente

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD  = [0.229, 0.224, 0.225]

torch.manual_seed(SEED)
random.seed(SEED)
np.random.seed(SEED)


# ── SECCIÓN 1: Descarga de negativos (varios juegos de cartas) ────────────────
# Usar más de un juego como clase "no-MTG" evita que el clasificador aprenda
# "Pokémon vs MTG" en vez de "MTG vs cualquier otra cosa" — con una sola
# fuente de negativos, el modelo puede engancharse a rasgos específicos de
# ESE juego (el borde amarillo de Pokémon, por ejemplo) en vez de generalizar
# a lo que en producción va a ser una cámara apuntando a cualquier cosa que
# no sea una carta de Magic (otro TCG, una mano, una mesa, etc.).

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
                headers=NEG_HDR,
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


def obtener_metadata_yugioh(n_target: int) -> list:
    """
    Descarga metadatos de cartas Yu-Gi-Oh! desde YGOPRODeck (db.ygoprodeck.com).
    No requiere API key. A diferencia de Pokémon TCG, un solo request puede
    pedir un bloque grande vía num/offset — igual se pagina para no depender
    de una respuesta gigante de una vez.
    Retorna lista de dicts {id, name, image_url}.
    """
    cartas    = []
    offset    = 0
    page_size = 500
    print(f"  Descargando metadatos Yu-Gi-Oh! (objetivo: {n_target:,} cartas)...")

    while len(cartas) < n_target:
        try:
            resp = _get_con_reintentos(
                YUGIOH_API,
                params={"num": page_size, "offset": offset},
                headers=NEG_HDR,
                timeout=60,
            )
        except requests.exceptions.RequestException as e:
            print(f"    ✗ Offset {offset} falló tras reintentos ({e}); "
                  f"continuando con {len(cartas)} cartas obtenidas.")
            break

        data  = resp.json()
        batch = data.get("data", [])
        if not batch:
            break

        for card in batch:
            imgs = card.get("card_images") or []
            url  = imgs[0]["image_url"] if imgs else None
            if url:
                cartas.append({"id": str(card["id"]), "name": card["name"], "image_url": url})

        print(f"    Offset {offset}: +{len(batch)} cartas  ({len(cartas)}/{n_target} cargadas)")

        if len(batch) < page_size:
            break
        offset += page_size
        time.sleep(0.25)  # respetar rate-limit de la API

    return cartas[:n_target]


def _commons_category_files(category: str) -> list[str]:
    """Lista todos los títulos de archivo de una categoría de Wikimedia Commons
    (con paginación vía cmcontinue)."""
    titles: list[str] = []
    params = {
        "action": "query", "list": "categorymembers", "cmtitle": f"Category:{category}",
        "cmlimit": 100, "cmtype": "file", "format": "json",
    }
    while True:
        resp = _get_con_reintentos(COMMONS_API, params=params, headers=NEG_HDR, timeout=30)
        data = resp.json()
        titles += [m["title"] for m in data.get("query", {}).get("categorymembers", [])]
        cont = data.get("continue")
        if not cont:
            break
        params = {**params, **cont}
    return titles


def _commons_resolve_urls(titles: list[str], width: int = 800) -> dict[str, str]:
    """
    Resuelve títulos de archivo de Commons a una URL de imagen directa.
    Usa thumburl (Commons rasteriza SVG a PNG del lado servidor — no hace
    falta ninguna librería de SVG acá) con fallback a la URL original.
    La API acepta hasta 50 títulos por request.
    """
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
            headers=NEG_HDR, timeout=30,
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
    """'File:English pattern ace of clubs.svg' → 'en_English_pattern_ace_of_clubs'."""
    stem = title.split(":", 1)[-1].rsplit(".", 1)[0]
    return f"{prefix}_{stem.replace(' ', '_')}"


def obtener_metadata_playing_cards_en(n_target: int) -> list:
    """
    Mazo estándar inglés/francés (52 cartas, "English pattern", dominio
    público) desde Wikimedia Commons. Es un mazo FIJO — no hay 52+1 cartas
    que pedir — así que n_target solo importa si es menor a 52 (recorta).
    Sirve de negativo cualitativamente distinto a un TCG: sin arte
    ilustrado, sin caja de texto, formato totalmente distinto a una carta
    de Magic — ver comentario al inicio de esta sección.
    """
    print("  Descargando metadatos: mazo inglés estándar (Wikimedia Commons)...")
    titles = _commons_category_files("SVG English pattern playing cards")
    titles = [t for t in titles if "deck" not in t.lower()]  # excluye imágenes de mazo completo (varias cartas juntas)
    urls = _commons_resolve_urls(titles)
    cartas = [{"id": _commons_id(t, "en"), "name": t, "image_url": u} for t, u in urls.items()]
    print(f"    {len(cartas)} cartas encontradas")
    return cartas[:n_target]


def obtener_metadata_playing_cards_es(n_target: int) -> list:
    """
    Baraja española (40 cartas, patrón Fournier, dominio público) desde
    Wikimedia Commons. Igual que el mazo inglés: fijo, no escalable. La
    categoría de Commons trae de todo mezclado (ilustraciones de jugadas de
    truco/mus, mazos completos, nombres de archivo inconsistentes) — se
    filtra específicamente a la serie "Heraclio Fournier N Palo.jpg", que es
    la única con una carta por archivo y las 40 cartas completas (1-7, 10-12
    × 4 palos, sin 8 ni 9 — el mazo español estándar de 40).
    """
    print("  Descargando metadatos: baraja española (Wikimedia Commons)...")
    titles = _commons_category_files("Castilian pattern")
    patron = re.compile(r"^File:Heraclio Fournier \d+ (Bastos|Copas|Espadas|Oros)\.jpg$")
    titles = [t for t in titles if patron.match(t)]
    urls = _commons_resolve_urls(titles)
    cartas = [{"id": _commons_id(t, "es"), "name": t, "image_url": u} for t, u in urls.items()]
    print(f"    {len(cartas)} cartas encontradas")
    return cartas[:n_target]


# nombre de carpeta/caché → (función que trae metadata, si es "escalable").
# Pokémon y Yu-Gi-Oh! tienen miles de cartas disponibles — el presupuesto se
# reparte parejo entre ellas. Los mazos de naipes (inglés/español) son de
# tamaño FIJO (52 y 40 cartas respectivamente) — se bajan enteros primero y
# el resto del presupuesto se reparte entre las fuentes escalables. Ver
# descargar_negativos().
_COMMONS_DL = {"workers": 1, "delay": 1.5, "max_reintentos": 6, "backoff": 3.0}

NEG_SOURCES = {
    "pokemon":          {"fetch": obtener_metadata_pokemon,          "scalable": True},
    "yugioh":           {"fetch": obtener_metadata_yugioh,           "scalable": True},
    # Wikimedia Commons (upload.wikimedia.org) devuelve 429 "Too many requests"
    # incluso en serie con el delay/backoff por defecto — ver _descargar_fuente.
    "playing_cards_en": {"fetch": obtener_metadata_playing_cards_en, "scalable": False, **_COMMONS_DL},
    "playing_cards_es": {"fetch": obtener_metadata_playing_cards_es, "scalable": False, **_COMMONS_DL},
}


def _descargar_una(card: dict, dest_dir: pathlib.Path, delay: float = NEG_DELAY,
                    max_reintentos: int = 3, backoff: float = 2.0) -> bool:
    dest = dest_dir / f"{card['id']}.jpg"
    if dest.exists():
        return True
    try:
        resp = _get_con_reintentos(
            card["image_url"], max_reintentos=max_reintentos, backoff=backoff, headers=NEG_HDR, timeout=30,
        )
        dest.write_bytes(resp.content)
        time.sleep(delay)
        return True
    except Exception:
        return False


def _descargar_fuente(nombre: str, fetch_meta, n_target: int, skip: bool, workers: int = 4,
                       delay: float = NEG_DELAY, max_reintentos: int = 3, backoff: float = 2.0) -> list:
    """Descarga (con caché) las imágenes de UNA fuente de negativos. Misma
    lógica que antes tenía descargar_negativos(), ahora parametrizada por
    fuente para no duplicarla por cada juego nuevo que se agregue.

    workers/delay/backoff: pokemontcg.io y YGOPRODeck toleran 4 hilos y el
    delay/backoff por defecto sin problema, pero el CDN de Wikimedia Commons
    (upload.wikimedia.org) devuelve 429 "Too many requests" incluso en serie
    con el delay por defecto — para esas fuentes se pasa workers=1, un delay
    más largo entre descargas y más reintentos con backoff más generoso. El
    volumen ahí es chico (52+40 cartas), así que ir más lento no cuesta nada
    en tiempo real.
    """
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
        ya_ok      = len(cartas) - len(pendientes)
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
    Descarga imágenes de varias fuentes como ejemplos negativos — dos TCGs
    (Pokémon, Yu-Gi-Oh!) y dos mazos de naipes fuera del mundo TCG (inglés,
    español) — ver el comentario al inicio de esta sección sobre por qué
    varias fuentes en vez de una sola.

    Las fuentes fijas (naipes) se bajan primero, enteras — no tiene sentido
    pedirles "n_target/4" cuando el mazo entero son 40-52 cartas. El resto
    del presupuesto (n_target menos lo que ya aportaron los mazos fijos) se
    reparte parejo entre las fuentes escalables (Pokémon, Yu-Gi-Oh!), que sí
    tienen miles de cartas para dar.
    """
    fijas      = {k: v for k, v in NEG_SOURCES.items() if not v["scalable"]}
    escalables = {k: v for k, v in NEG_SOURCES.items() if v["scalable"]}

    def _dl_kwargs(cfg: dict) -> dict:
        return {k: cfg[k] for k in ("workers", "delay", "max_reintentos", "backoff") if k in cfg}

    rutas = []
    for nombre, cfg in fijas.items():
        print(f"  ── Fuente de negativos: {nombre} (mazo fijo, se usa completo) ──")
        rutas += _descargar_fuente(nombre, cfg["fetch"], n_target, skip, **_dl_kwargs(cfg))

    resto = max(n_target - len(rutas), 0)
    base, sobra = divmod(resto, len(escalables))
    for i, (nombre, cfg) in enumerate(escalables.items()):
        n_fuente = base + (1 if i < sobra else 0)
        print(f"  ── Fuente de negativos: {nombre} (objetivo: {n_fuente:,} cartas) ──")
        rutas += _descargar_fuente(nombre, cfg["fetch"], n_fuente, skip, **_dl_kwargs(cfg))
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
             model_path: pathlib.Path | None = None,
             history_path: pathlib.Path | None = None) -> list:
    """
    Fine-tune del MTGDetector. Guarda el mejor checkpoint según val_loss.
    Retorna historial [{epoch, train_loss, val_loss}, ...].

    `optimizador` se recibe ya construido (en vez de armarlo acá adentro) para
    que 08_optuna_binary_classifier.py pueda reusar esta misma función con el
    optimizer/hiperparámetros que esté probando cada trial.

    Si se pasa `history_path`, el historial se reescribe completo (JSON) tras
    cada época — permite que un proceso externo (el desktop-runner) haga
    polling del archivo y muestre el loss en vivo mientras entrena.
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

        if history_path is not None:
            with open(history_path, "w") as f:
                json.dump(historial, f, indent=2)

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
    parser.add_argument("--download-only", action="store_true",
                        help="Solo descargar/completar las imágenes negativas (Pokémon + otras "
                             "fuentes) y salir, sin entrenar nada. Ya es idempotente por sí solo "
                             "(descarga lo que falte, reutiliza lo que ya existe) — no necesita "
                             "combinarse con --skip-download.")
    parser.add_argument("--n", type=int, default=N_PER_CLASS,
                        help=f"Cartas por clase (default: {N_PER_CLASS})")
    parser.add_argument("--epochs", type=int, default=EPOCHS,
                        help=f"Épocas de entrenamiento (default: {EPOCHS})")
    args = parser.parse_args()

    n       = args.n
    epochs  = args.epochs

    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    IMAGES_NEG.mkdir(parents=True, exist_ok=True)

    if args.download_only:
        print("=" * 60)
        print("  MTG Card Scanner — Descarga de imágenes negativas (PyTorch)")
        print(f"  Por clase  : {n:,} cartas")
        print("=" * 60)
        print("\n[1/1] Preparando imágenes no-MTG (Pokémon TCG + otras fuentes)...")
        rutas_neg = descargar_negativos(n, skip=False)
        print(f"  Disponibles: {len(rutas_neg):,} imágenes no-MTG")
        return

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

    historial = entrenar(model, optimizador, train_dl, val_dl, epochs,
                          history_path=RESULTS_DIR / "training_history.json")

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

    # Curva ROC y matriz de confusión — para graficar en el desktop-runner
    # (ya se calculan para las figuras PNG, acá se persisten además en JSON).
    metricas["roc_curve"] = {"fpr": fpr.tolist(), "tpr": tpr.tolist()}
    metricas["confusion_matrix"] = confusion_matrix(y_true, y_pred).tolist()

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
