"""
MTG Card Scanner — Certamen 2
text_validator_baseline.py: baseline del validador de texto (Stage 2), OpenCV + OCR.

Igual que price_estimator_baseline.py para Stage 3: un baseline framework-
agnóstico antes de construir las dos versiones "de verdad" (PyTorch/TensorFlow)
del README, sección 1. Mide si "recortar la caja de texto + OCR + comparar
contra oracle_text" alcanza como señal de confirmación, antes de invertir en
un modelo propio entrenado.

Por qué imágenes en calidad "large" y no las ya descargadas por 02_downloader.py:
el dataset compartido (certamen_1/data/images/) está en calidad "small"
(146×204px) — de sobra para detección/embeddings, pero ilegible para OCR. Las
URLs de Scryfall codifican la calidad en el path
(.../small/front/... → .../large/front/...), así que este script descarga
una sub-muestra aparte en calidad "large" a certamen_2/data/ocr_images/, sin
tocar ni duplicar el dataset "small" de certamen_1.

Pipeline por carta:
    1. Descargar (o reusar) la imagen en calidad "large".
    2. OpenCV: recortar la caja de texto de reglas (proporciones aproximadas
       del frame moderno de Magic — ver CROP_TEXTO).
    3. pytesseract: OCR sobre el recorte (grayscale + threshold).
    4. Comparar el texto leído contra `name` + `oracle_text` de la carta
       candidata (positivo = su propia carta, negativo = una carta al azar)
       con un score de similitud (difflib), igual criterio que el umbral de
       similitud coseno de Certamen 1.

Uso:
    python text_validator_baseline.py                # 800 cartas de muestra
    python text_validator_baseline.py --n 200          # muestra chica, iterar rápido
    python text_validator_baseline.py --quality normal # más rápido de descargar, menos nítido
"""

import argparse
import datetime
import difflib
import json
import os
import pathlib
import random
import re
import shutil
import sys
import time

import cv2
import matplotlib.pyplot as plt
import numpy as np
import pytesseract
import requests
from sklearn.metrics import roc_auc_score, roc_curve

CERTAMEN2_DIR = pathlib.Path(__file__).resolve().parent
CARDS_JSON = CERTAMEN2_DIR.parent / "certamen_1" / "data" / "cards.json"
OCR_IMAGES_DIR = CERTAMEN2_DIR / "data" / "ocr_images"  # gitignored, calidad "large" aparte del dataset compartido
OUTPUT_ROOT = CERTAMEN2_DIR / "output" / "text_validator_baseline"

# El paquete de idioma de tesseract (`eng.traineddata`) se instala vía el
# gestor de paquetes del sistema en la mayoría de las máquinas (apt install
# tesseract-ocr-eng, choco install tesseract, etc.).
_TESSDATA_LOCAL = CERTAMEN2_DIR / ".tessdata"


def asegurar_tessdata() -> None:
    """
    Se asegura de que tesseract tenga el paquete de idioma inglés disponible.
    Si la instalación del sistema no lo tiene, descarga una copia local
    (~4 MB, una sola vez, gitignored) en vez de fallar con un error de
    configuración poco claro.
    """
    try:
        if "eng" in pytesseract.get_languages(config=""):
            return
    except pytesseract.TesseractNotFoundError:
        print("Error: el binario de tesseract no está instalado (apt/pacman install tesseract, choco install tesseract).")
        sys.exit(1)
    except Exception:
        pass  # get_languages puede fallar por otras razones; probamos igual con el fallback local

    eng_local = _TESSDATA_LOCAL / "eng.traineddata"
    if not eng_local.exists():
        print("Paquete de idioma inglés de tesseract no encontrado — descargando copia local (~4 MB, una vez)...")
        _TESSDATA_LOCAL.mkdir(exist_ok=True)
        url = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata"
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        eng_local.write_bytes(resp.content)

    os.environ["TESSDATA_PREFIX"] = str(_TESSDATA_LOCAL)

HEADERS = {"User-Agent": "MTG-Scanner-Academic/1.0"}
SEED = 42

# Proporciones aproximadas de la caja de texto de reglas sobre el frame
# moderno de Magic (x0, y0, x1, y1), como fracción del tamaño de la carta.
# No es perspective-correction real (para eso está OpenCV en la app Ionic,
# ver examen/README.md) — acá las imágenes de Scryfall ya vienen encuadradas,
# solo hace falta recortar la región de texto dentro del encuadre.
CROP_TEXTO = (0.07, 0.52, 0.93, 0.88)


def url_calidad(image_url: str, calidad: str) -> str:
    """Reemplaza la calidad codificada en la URL de Scryfall (.../small/front/... -> .../{calidad}/front/...)."""
    return re.sub(r"/(small|normal|large|png)/", f"/{calidad}/", image_url, count=1)


def descargar_imagen(card: dict, calidad: str, session: requests.Session) -> pathlib.Path | None:
    ruta = OCR_IMAGES_DIR / f"{card['id']}.jpg"
    if ruta.exists():
        return ruta

    url = url_calidad(card["image_url"], calidad)
    try:
        resp = session.get(url, headers=HEADERS, timeout=30)
        resp.raise_for_status()
        ruta.write_bytes(resp.content)
        time.sleep(0.06)
        return ruta
    except requests.RequestException as e:
        print(f"  aviso: no se pudo descargar {card['id']}: {e}")
        return None


def recortar_texto(imagen_path: pathlib.Path) -> np.ndarray | None:
    img = cv2.imread(str(imagen_path))
    if img is None:
        return None
    h, w = img.shape[:2]
    x0, y0, x1, y1 = CROP_TEXTO
    recorte = img[int(y0 * h):int(y1 * h), int(x0 * w):int(x1 * w)]

    gris = cv2.cvtColor(recorte, cv2.COLOR_BGR2GRAY)
    # Upscale — el recorte es chico incluso en calidad "large"; tesseract rinde mejor con más DPI efectivo.
    gris = cv2.resize(gris, None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    _, binaria = cv2.threshold(gris, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return binaria


def ocr_texto(imagen_bin: np.ndarray) -> str:
    return pytesseract.image_to_string(imagen_bin, lang="eng")


def normalizar(texto: str) -> str:
    texto = texto.lower()
    texto = re.sub(r"[^a-z0-9\s]", " ", texto)
    return re.sub(r"\s+", " ", texto).strip()


def similitud(ocr: str, referencia: str) -> float:
    a, b = normalizar(ocr), normalizar(referencia)
    if not a or not b:
        return 0.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def texto_referencia(card: dict) -> str:
    return f"{card.get('name') or ''} {card.get('oracle_text') or ''}"


def _actualizar_latest(output_root: pathlib.Path, run_dir: pathlib.Path) -> None:
    latest = output_root / "latest"
    if latest.exists() or latest.is_symlink():
        if latest.is_symlink() or latest.is_file():
            latest.unlink()
        else:
            shutil.rmtree(latest)
    try:
        latest.symlink_to(run_dir.name, target_is_directory=True)
    except OSError:
        shutil.copytree(run_dir, latest)


def main() -> None:
    parser = argparse.ArgumentParser(description="Baseline OpenCV+OCR del validador de texto (Stage 2, Certamen 2).")
    parser.add_argument("--n", type=int, default=800, help="Cantidad de cartas a muestrear.")
    parser.add_argument("--quality", default="large", choices=["normal", "large", "png"],
                         help="Calidad de descarga para OCR (small es ilegible). default: large")
    parser.add_argument("--output-dir", default=None)
    args = parser.parse_args()

    asegurar_tessdata()

    if not CARDS_JSON.exists():
        print(f"Error: no existe {CARDS_JSON}. Corré certamen_1/01_scraper.py primero.")
        sys.exit(1)

    with open(CARDS_JSON, encoding="utf-8") as f:
        cards = json.load(f)

    candidatas = [c for c in cards if c.get("image_url")]
    print(f"Cartas con imagen disponible : {len(candidatas):,}")

    rng = random.Random(SEED)
    muestra = rng.sample(candidatas, min(args.n, len(candidatas)))
    print(f"Muestra                       : {len(muestra):,}  (calidad de descarga: {args.quality})")

    OCR_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()

    scores, labels = [], []
    ejemplos = []

    for i, card in enumerate(muestra):
        ruta = descargar_imagen(card, args.quality, session)
        if ruta is None:
            continue

        recorte = recortar_texto(ruta)
        if recorte is None:
            continue

        texto_ocr = ocr_texto(recorte)

        # Positivo: contra su propia carta. Negativo: contra otra carta al azar del batch.
        otra = rng.choice([c for c in muestra if c["id"] != card["id"]])

        score_pos = similitud(texto_ocr, texto_referencia(card))
        score_neg = similitud(texto_ocr, texto_referencia(otra))

        scores.extend([score_pos, score_neg])
        labels.extend([1, 0])

        if len(ejemplos) < 6:
            ejemplos.append((ruta, recorte, texto_ocr, card["name"], score_pos))

        if (i + 1) % 100 == 0:
            print(f"  {i + 1}/{len(muestra)} procesadas...")

    scores = np.array(scores)
    labels = np.array(labels)

    if len(set(labels)) < 2:
        print("Error: no se generaron suficientes pares positivos/negativos (¿fallaron todas las descargas?).")
        sys.exit(1)

    auc = roc_auc_score(labels, scores)
    fpr, tpr, thresholds = roc_curve(labels, scores)
    youden = tpr - fpr
    umbral_optimo = thresholds[np.argmax(youden)]
    accuracy_umbral = ((scores >= umbral_optimo).astype(int) == labels).mean()

    metricas = {
        "n_muestra": len(muestra),
        "n_pares": len(scores),
        "calidad_descarga": args.quality,
        "roc_auc": float(auc),
        "umbral_optimo": float(umbral_optimo),
        "accuracy_en_umbral_optimo": float(accuracy_umbral),
        "score_promedio_positivo": float(scores[labels == 1].mean()),
        "score_promedio_negativo": float(scores[labels == 0].mean()),
    }

    print("\n── Resultados ─────────────────────────────────────")
    print(f"  ROC-AUC                : {auc:.3f}")
    print(f"  Umbral óptimo (Youden) : {umbral_optimo:.3f}")
    print(f"  Accuracy en ese umbral : {accuracy_umbral:.3f}")
    print(f"  Score prom. positivo   : {metricas['score_promedio_positivo']:.3f}")
    print(f"  Score prom. negativo   : {metricas['score_promedio_negativo']:.3f}")

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = pathlib.Path(args.output_dir) if args.output_dir else OUTPUT_ROOT / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    with open(run_dir / "metrics_text_validator_baseline.json", "w", encoding="utf-8") as f:
        json.dump(metricas, f, indent=2, ensure_ascii=False)

    # ROC + distribución de scores
    fig, axes = plt.subplots(1, 2, figsize=(12, 5))
    axes[0].plot(fpr, tpr, color="#4C72B0")
    axes[0].plot([0, 1], [0, 1], "--", color="gray")
    axes[0].set_xlabel("FPR")
    axes[0].set_ylabel("TPR")
    axes[0].set_title(f"ROC — Stage 2 baseline (AUC={auc:.3f})")

    axes[1].hist(scores[labels == 1], bins=30, alpha=0.6, label="positivo (misma carta)", color="#55A868")
    axes[1].hist(scores[labels == 0], bins=30, alpha=0.6, label="negativo (otra carta)", color="#C44E52")
    axes[1].axvline(umbral_optimo, color="black", linestyle="--", label="umbral óptimo")
    axes[1].set_xlabel("Similitud OCR vs. texto de referencia")
    axes[1].set_title("Distribución de scores")
    axes[1].legend(fontsize=8)

    plt.tight_layout()
    plt.savefig(run_dir / "roc_y_distribucion.png", dpi=130)
    plt.close()

    # Grid de ejemplos para inspección visual (¿el OCR está leyendo algo razonable?)
    if ejemplos:
        fig, axes = plt.subplots(2, 3, figsize=(13, 7))
        for ax, (ruta, recorte, texto_ocr, nombre, score) in zip(axes.flat, ejemplos):
            ax.imshow(recorte, cmap="gray")
            ocr_corto = (texto_ocr.strip()[:60] + "…") if len(texto_ocr.strip()) > 60 else texto_ocr.strip()
            ax.set_title(f"{nombre}\nOCR: \"{ocr_corto}\"\nscore={score:.2f}", fontsize=7)
            ax.axis("off")
        for ax in axes.flat[len(ejemplos):]:
            ax.axis("off")
        plt.tight_layout()
        plt.savefig(run_dir / "ejemplos_ocr.png", dpi=130)
        plt.close()

    if args.output_dir is None:
        _actualizar_latest(OUTPUT_ROOT, run_dir)

    print(f"\nResultados: {run_dir}")
    print(f"Imágenes OCR cacheadas (calidad {args.quality}, reusables entre corridas): {OCR_IMAGES_DIR}")


if __name__ == "__main__":
    main()
