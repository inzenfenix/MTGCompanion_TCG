"""
MTG Card Scanner — Certamen 2
full_pipeline_demo.py: encadena las 3 etapas del pipeline sobre una sola foto.

Muestra el flujo completo funcionando hoy, con lo que ya existe (bases +
baselines), como preview de lo que la app Ionic hará en el cliente una vez
estén los modelos "de verdad" (ver README.md, secciones 1 y 3):

    foto ─▶ Stage 1 (pytorch/scanner.py, subproceso en su propio venv)
              → carta candidata + similitud + veredicto MTG/no-MTG
                    │
                    ▼
         Stage 2 (text_validator_baseline: OpenCV + OCR)
              → ¿el texto leído en la foto es consistente con esa carta?
                    │
                    ▼
         Stage 3 (price_estimator_baseline: metadata → USD)
              → precio estimado, comparado contra prices.usd real (si existe)

Requisitos: pytorch/.venv ya creado (Certamen 1) + certamen_2/.venv con este
mismo requirements.txt. No corre el clasificador binario de PyTorch como
gate (usa --skip-detect en el scanner) porque acá interesa forzar las 3
etapas incluso sobre fotos limpias de Scryfall.

Uso:
    python full_pipeline_demo.py ruta/a/carta.jpg
    python full_pipeline_demo.py ruta/a/carta.jpg --top 5
    python full_pipeline_demo.py ruta/a/carta.jpg --condition LP   # carta con desgaste visible

Nota sobre condición: Stage 3 predice un precio de referencia (~near-mint —
no hay señal de condición en los datos, ver price_estimator_baseline.py). Sin
un clasificador visual de condición entrenado (necesita fotos etiquetadas por
condición que no tenemos), `--condition` es la condición que declara quien
escanea, no algo que el modelo infiere de la foto.
"""

import argparse
import json
import pathlib
import re
import subprocess
import sys

import joblib
import numpy as np
import pandas as pd

from price_estimator_baseline import (
    ajustar_por_condicion,
    CONDITION_MULTIPLIERS,
    fila_features,
    MODELS_DIR as PRICE_MODELS_DIR,
)
from text_validator_baseline import (
    asegurar_tessdata,
    normalizar,
    ocr_texto,
    recortar_texto,
    similitud,
    texto_referencia,
)

CERTAMEN2_DIR = pathlib.Path(__file__).resolve().parent
CERTAMEN1_DIR = CERTAMEN2_DIR.parent / "certamen_1"
PYTORCH_DIR = CERTAMEN1_DIR / "pytorch"
CARDS_JSON = CERTAMEN1_DIR / "data" / "cards.json"

_PT_LINE_RE = {
    "card_name": re.compile(r"^card_name=(.+)$"),
    "similarity": re.compile(r"^similarity=([\d.]+)$"),
    "verdict": re.compile(r"^(MAGIC|NO_MAGIC)$"),
}


def _venv_python(framework_dir: pathlib.Path) -> pathlib.Path:
    for candidato in (framework_dir / ".venv" / "bin" / "python",
                      framework_dir / ".venv" / "Scripts" / "python.exe"):
        if candidato.exists():
            return candidato
    return framework_dir / ".venv" / "bin" / "python"


def stage1_identificar(imagen: pathlib.Path, top: int) -> dict:
    """Corre pytorch/scanner.py como subproceso (su propio venv) y parsea la salida."""
    python_bin = _venv_python(PYTORCH_DIR)
    if not python_bin.exists():
        print(f"Error: no existe {python_bin}. Corré Certamen 1 (pytorch/) primero.")
        sys.exit(1)

    cmd = [str(python_bin), "scanner.py", str(imagen.resolve()), "--top", str(top), "--skip-detect"]
    proc = subprocess.run(cmd, cwd=PYTORCH_DIR, capture_output=True, text=True)
    if proc.returncode != 0:
        print("Error: scanner.py de PyTorch falló.")
        print(proc.stderr[-2000:])
        sys.exit(1)

    resultado = {}
    for linea in proc.stdout.splitlines():
        linea = linea.strip()
        for campo, patron in _PT_LINE_RE.items():
            m = patron.match(linea)
            if m:
                resultado[campo] = m.group(1)

    if "card_name" not in resultado:
        print("Error: no se pudo parsear la salida de scanner.py.")
        print(proc.stdout[-2000:])
        sys.exit(1)

    resultado["similarity"] = float(resultado.get("similarity", 0.0))
    resultado["es_magic"] = resultado.get("verdict") == "MAGIC"
    return resultado


def stage2_validar_texto(imagen: pathlib.Path, carta: dict) -> dict:
    """OpenCV + OCR sobre la foto original, comparado contra la carta identificada en Stage 1."""
    asegurar_tessdata()
    recorte = recortar_texto(imagen)
    if recorte is None:
        return {"ocr_text": "", "score": 0.0, "confirma": False}

    texto_ocr = ocr_texto(recorte)
    score = similitud(texto_ocr, texto_referencia(carta))
    return {
        "ocr_text": normalizar(texto_ocr)[:120],
        "score": score,
        "confirma": score >= 0.35,  # umbral óptimo medido en output/text_validator_baseline/latest/
    }


def stage3_estimar_precio(carta: dict, condicion: str = "NM") -> dict:
    """
    Predice prices.usd (near-mint) con el baseline tabular entrenado
    (certamen_2/models/) y lo ajusta por la condición declarada — el modelo
    no infiere condición de la foto, ver docstring del módulo.
    """
    modelo_path = PRICE_MODELS_DIR / "price_baseline_model.joblib"
    if not modelo_path.exists():
        return {"disponible": False}

    pipeline = joblib.load(modelo_path)
    fila = pd.DataFrame([fila_features(carta)])
    pred_log = pipeline.predict(fila)[0]
    pred_nm_usd = max(0.0, float(np.expm1(pred_log)))
    pred_usd = ajustar_por_condicion(pred_nm_usd, condicion)

    precio_real = (carta.get("prices") or {}).get("usd")
    return {
        "disponible": True,
        "condicion": condicion.upper(),
        "precio_estimado_nm_usd": pred_nm_usd,
        "precio_estimado_usd": pred_usd,
        "precio_real_usd": float(precio_real) if precio_real else None,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Corre las 3 etapas del pipeline sobre una foto.")
    parser.add_argument("imagen", type=pathlib.Path, help="Ruta a la foto de la carta")
    parser.add_argument("--top", type=int, default=5, help="Candidatos a mostrar en Stage 1 (default: 5)")
    parser.add_argument("--condition", default="NM", choices=list(CONDITION_MULTIPLIERS),
                        help="Condición declarada de la carta física (default: NM = near-mint)")
    args = parser.parse_args()

    if not args.imagen.exists():
        print(f"Error: no existe {args.imagen}")
        sys.exit(1)
    if not CARDS_JSON.exists():
        print(f"Error: no existe {CARDS_JSON}. Corré certamen_1/01_scraper.py primero.")
        sys.exit(1)

    with open(CARDS_JSON, encoding="utf-8") as f:
        cards_by_name = {c["name"]: c for c in json.load(f)}

    print("═" * 78)
    print("  Pipeline completo — Certamen 2 (Stage 1 → 2 → 3)")
    print(f"  Foto: {args.imagen}")
    print("═" * 78)

    print("\n[Stage 1] Identificando carta (PyTorch, EfficientNet_b0)...")
    s1 = stage1_identificar(args.imagen, args.top)
    print(f"  Carta candidata : {s1['card_name']}")
    print(f"  Similitud       : {s1['similarity'] * 100:.1f}%")
    print(f"  Veredicto       : {'MAGIC' if s1['es_magic'] else 'NO_MAGIC'}")

    carta = cards_by_name.get(s1["card_name"])
    if carta is None:
        print("\nAviso: la carta candidata no está en el dataset local actual (cards.json"
              " puede haberse regenerado desde el scanner) — no se puede continuar a Stage 2/3.")
        sys.exit(0)

    print("\n[Stage 2] Validando texto (OpenCV + OCR)...")
    s2 = stage2_validar_texto(args.imagen, carta)
    print(f"  OCR leído (recortado) : \"{s2['ocr_text']}\"")
    print(f"  Score de confirmación : {s2['score']:.3f}")
    print(f"  ¿Confirma la carta?   : {'sí' if s2['confirma'] else 'no'}")

    print(f"\n[Stage 3] Estimando precio (metadata → USD, condición declarada: {args.condition})...")
    s3 = stage3_estimar_precio(carta, condicion=args.condition)
    if not s3["disponible"]:
        print("  Aviso: no existe certamen_2/models/price_baseline_model.joblib —")
        print("  corré price_estimator_baseline.py primero.")
    else:
        print(f"  Precio estimado (near-mint) : ${s3['precio_estimado_nm_usd']:.2f}")
        print(f"  Precio estimado ({s3['condicion']})".ljust(30) + f": ${s3['precio_estimado_usd']:.2f}")
        if s3["precio_real_usd"] is not None:
            print(f"  Precio real (Scryfall, NM)  : ${s3['precio_real_usd']:.2f}"
                  "  — referencia near-mint, no comparable 1:1 si la condición declarada no es NM")
        else:
            print("  Precio real     : no disponible en Scryfall para esta carta")

    print("\n" + "═" * 78)
    print(f"  Resultado: {s1['card_name']}"
          f"{' ✓ texto confirma' if s2['confirma'] else ' ✗ texto no confirma'}"
          + (f"  |  ~${s3['precio_estimado_usd']:.2f}" if s3.get("disponible") else ""))
    print("═" * 78)


if __name__ == "__main__":
    main()
