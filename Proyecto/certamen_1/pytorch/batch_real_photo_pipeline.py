"""
MTG Card Scanner — Certamen 2, G4 (ROADMAP.md workstream G, item G4a)
batch_real_photo_pipeline.py: corre las 4 etapas reales del pipeline sobre
un directorio entero de fotos, cargando cada modelo UNA sola vez.

full_pipeline_demo.py --real-models (certamen_2/) es correcto pero corre
como 4 subprocesos por foto (scanner.py, predict_condition.py,
predict_text_validator.py, predict_price.py) — cada uno reimporta
torch/torchvision (lento bajo ROCm) y recarga su checkpoint desde cero,
nada se cachea entre fotos. Medido: ~66s/foto → horas para un dataset de
tamaño real. Este script hace el mismo trabajo (mismas funciones de carga/
predicción, reusadas directamente, no reimplementadas) pero en UN solo
proceso: cada modelo se carga una vez y el loop sobre fotos son solo
forward passes (mismo motivo por el que ONNX Runtime en la app Ionic será
rápido — carga una vez, se queda residente).

OCR (pytesseract) y las utilidades de card_preprocessing.py/
text_validator_baseline.py viven en certamen_2/ — se importan acá vía un
sys.path.insert (import cruzado, mismo espíritu que full_pipeline_demo.py
pero invertido: acá pytorch/ importa de certamen_2/ en vez de certamen_2/
shell-eando a pytorch/). Requiere pytesseract instalado en pytorch/.venv
(ver requirements.txt) y el binario de sistema `tesseract`.

Uso:
    python batch_real_photo_pipeline.py
    python batch_real_photo_pipeline.py --limit 10          # subset rápido para iterar
    python batch_real_photo_pipeline.py --photos-dir DIR --output archivo.json
"""

import argparse
import json
import pathlib
import sys
import time

import cv2
import numpy as np
import torch

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
CERTAMEN1_DIR = SCRIPT_DIR.parent
CERTAMEN2_DIR = CERTAMEN1_DIR.parent / "certamen_2"
CARDS_JSON = CERTAMEN1_DIR / "data" / "cards.json"
DEFAULT_PHOTOS_DIR = CERTAMEN1_DIR / "data" / "real_photos"
DEFAULT_OUTPUT = CERTAMEN1_DIR / "Testing" / "real_photo_eval_raw.json"

sys.path.insert(0, str(CERTAMEN2_DIR))

from card_preprocessing import mejorar_contraste, normalizar_carta  # noqa: E402
from orientation_fix import corregir_orientacion  # noqa: E402
from text_validator_baseline import (  # noqa: E402
    _recortar_caja_texto, asegurar_tessdata, normalizar, ocr_texto, recortar_texto, texto_referencia,
)

import scanner  # noqa: E402
from predict_condition import cargar_grader, predecir as predecir_condicion  # noqa: E402
from predict_text_validator import cargar_matcher, predecir as predecir_texto  # noqa: E402
from predict_price import (  # noqa: E402
    cargar_extractor_visual, cargar_regresor, cargar_scaler, embeber_imagen,
)
from src.price_features import build_tabular_vector, escalar_numericos, raw_card_fields  # noqa: E402

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def cargar_todo() -> dict:
    """Carga los 4 modelos + índice de Stage 1 UNA vez. Falla rápido y claro si algo falta."""
    print("Cargando modelos (una sola vez)...")
    t0 = time.perf_counter()

    modelo_s1 = scanner.cargar_modelo()
    gallery_emb, gallery_ids, cards_info = scanner.cargar_indice(finetuned=False)

    grader = cargar_grader()
    if grader is None:
        print("Error: no existe models/condition_grader_combined.pth — corré 12_condition_grader_combined.py primero.")
        sys.exit(1)

    matcher, vectorizador, umbral_texto = cargar_matcher()
    if matcher is None:
        print("Error: no existe models/text_matcher.pth — corré 14_text_validator.py primero.")
        sys.exit(1)

    extractor = cargar_extractor_visual()
    regresor = cargar_regresor()
    if extractor is None or regresor is None:
        print("Error: no existen models/mtg_detector.pth y/o models/price_regressor.pth.")
        sys.exit(1)
    medias, desvios = cargar_scaler()

    asegurar_tessdata()

    with open(CARDS_JSON, encoding="utf-8") as f:
        cards_by_name = {c["name"]: c for c in json.load(f)}

    print(f"  Listo en {time.perf_counter() - t0:.1f}s  |  {len(gallery_ids):,} cartas en el índice  |  device: {DEVICE}")

    return {
        "modelo_s1": modelo_s1, "gallery_emb": gallery_emb, "gallery_ids": gallery_ids, "cards_info": cards_info,
        "grader": grader,
        "matcher": matcher, "vectorizador": vectorizador, "umbral_texto": umbral_texto,
        "extractor": extractor, "regresor": regresor, "medias": medias, "desvios": desvios,
        "cards_by_name": cards_by_name,
    }


def procesar_foto(foto: pathlib.Path, ctx: dict, guardar_crops_en: pathlib.Path | None = None) -> dict:
    resultado = {"foto": foto.name}

    img = cv2.imread(str(foto))
    if img is None:
        resultado["error"] = "no se pudo leer la imagen (cv2.imread devolvió None)"
        return resultado

    # ── Stage 1 — identificación ────────────────────────────────────────
    query_emb = scanner.extraer_embedding(str(foto))
    candidatos = scanner.buscar(query_emb, ctx["gallery_emb"], ctx["gallery_ids"], k=1)
    top1_id, top1_sim = candidatos[0]
    card_name = ctx["cards_info"].get(top1_id, {}).get("name", "?")
    resultado["card_name"] = card_name
    resultado["similarity"] = top1_sim
    resultado["verdict"] = "MAGIC" if top1_sim >= scanner.SIMILARITY_THRESHOLD else "NO_MAGIC"

    carta = ctx["cards_by_name"].get(card_name)
    if carta is None:
        resultado["error"] = "carta identificada no está en cards.json local"
        return resultado

    # Normalización compartida por Stage 2 (crop de texto) y Stage 4/3 (carta completa).
    carta_normalizada, _ = normalizar_carta(img, intentar_localizar=True)
    carta_normalizada = mejorar_contraste(carta_normalizada)
    # Corrige 0/90/180/270° — normalizar_carta endereza el cuadrilátero pero
    # no sabe cuál lado es "arriba" (ver ROADMAP.md G4b, orientation_fix.py).
    carta_normalizada, _ = corregir_orientacion(carta_normalizada, _recortar_caja_texto(carta_normalizada))

    if guardar_crops_en is not None:
        # Para inspección visual manual — no lo consume ningún modelo. Deja
        # ver si normalizar_carta() efectivamente aísla la carta del fondo
        # en fotos reales, o si una localización mala explica parte del gap
        # real-vs-curado que ya se viene observando (ver H6 en ROADMAP.md).
        cv2.imwrite(str(guardar_crops_en / foto.name), carta_normalizada)

    # ── Stage 4 — condición ──────────────────────────────────────────────
    tmp_path = pathlib.Path("/tmp") / f"_batch_pipeline_{foto.stem}.jpg"
    try:
        cv2.imwrite(str(tmp_path), carta_normalizada)
        grado, confianza, _ = predecir_condicion(ctx["grader"], str(tmp_path))
        resultado["grado"] = grado
        resultado["confianza"] = confianza

        # ── Stage 3 — precio (mismo recorte normalizado que Stage 4) ────
        x_vis = embeber_imagen(ctx["extractor"], str(tmp_path))
    finally:
        tmp_path.unlink(missing_ok=True)

    x_tab = build_tabular_vector(raw_card_fields(carta))
    x_tab = escalar_numericos(x_tab, ctx["medias"], ctx["desvios"])
    x = np.concatenate([np.array(x_tab, dtype=np.float32), x_vis])
    with torch.no_grad():
        tensor = torch.from_numpy(x).unsqueeze(0).to(DEVICE)
        pred_log = ctx["regresor"](tensor)[0].item()
    precio_estimado = max(0.0, float(np.expm1(pred_log)))
    resultado["precio_estimado"] = precio_estimado

    precio_real = (carta.get("prices") or {}).get("usd")
    if precio_real:
        resultado["precio_real"] = float(precio_real)

    # ── Stage 2 — texto (recorte de foto real, no la carta normalizada — mismo motivo que full_pipeline_demo.py) ──
    recorte = recortar_texto(foto, es_render_pre_recortado=False)
    if recorte is not None:
        texto_ocr = ocr_texto(recorte)
        resultado["ocr_text"] = normalizar(texto_ocr)[:120]
        score = predecir_texto(ctx["matcher"], ctx["vectorizador"], texto_ocr, texto_referencia(carta))
        resultado["score"] = score
        resultado["confirma"] = "sí" if score >= ctx["umbral_texto"] else "no"
    else:
        resultado["ocr_text"] = ""
        resultado["score"] = 0.0
        resultado["confirma"] = "no"

    return resultado


def main() -> None:
    parser = argparse.ArgumentParser(description="G4a — pipeline batch en un solo proceso sobre un directorio de fotos reales.")
    parser.add_argument("--photos-dir", type=pathlib.Path, default=DEFAULT_PHOTOS_DIR)
    parser.add_argument("--output", type=pathlib.Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--limit", type=int, default=None, help="Procesar solo las primeras N fotos (para iterar rápido).")
    parser.add_argument("--save-crops", type=pathlib.Path, default=None,
                         help="Si se pasa, guarda ahí la carta ya localizada/recortada (normalizar_carta) de "
                              "cada foto — solo para inspección visual manual, ningún modelo la consume.")
    args = parser.parse_args()

    fotos = sorted(args.photos_dir.glob("*.jpg"))
    if args.limit:
        fotos = fotos[: args.limit]
    if not fotos:
        print(f"Error: no hay fotos en {args.photos_dir}.")
        sys.exit(1)

    if args.save_crops is not None:
        args.save_crops.mkdir(parents=True, exist_ok=True)

    ctx = cargar_todo()

    print(f"\nProcesando {len(fotos)} fotos...")
    resultados = []
    t0 = time.perf_counter()
    for i, foto in enumerate(fotos, start=1):
        t_foto = time.perf_counter()
        r = procesar_foto(foto, ctx, guardar_crops_en=args.save_crops)
        resultados.append(r)
        dt = time.perf_counter() - t_foto
        estado = f"error: {r['error']}" if r.get("error") else r.get("card_name", "?")
        print(f"  [{i}/{len(fotos)}] {foto.name} ({dt:.2f}s): {estado}")

    total = time.perf_counter() - t0
    print(f"\nTotal: {total:.1f}s  ({total / len(fotos):.2f}s/foto en promedio)")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(resultados, f, indent=2, ensure_ascii=False)
    print(f"Resultados: {args.output}")


if __name__ == "__main__":
    main()
