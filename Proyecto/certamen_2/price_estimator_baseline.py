"""
MTG Card Scanner — Certamen 2
price_estimator_baseline.py: baseline de regresión de precio (Stage 3), solo metadata.

Este es el primer paso de Stage 3 del pipeline (ver README.md, sección 1): un
baseline tabular framework-agnóstico (scikit-learn) que NO necesita el dataset
de imágenes descargado — solo `certamen_1/data/cards.json` (metadata + `prices`).
Sirve para medir qué tan lejos llega la metadata sola antes de sumarle el
embedding visual (PyTorch EfficientNet_b0 / TensorFlow MobileNetV3) en la
siguiente iteración de este modelo, que sí duplica Stage 3 por framework.

Target: prices.usd (log1p-transformado durante el entrenamiento — el precio de
cartas MTG está muy sesgado: la mayoría son bulk de centavos, unas pocas
"chase cards" valen cientos de dólares).

Uso:
    python price_estimator_baseline.py                     # RandomForest, dataset completo
    python price_estimator_baseline.py --model gb           # GradientBoosting
    python price_estimator_baseline.py --n 5000              # sub-muestra para iterar rápido
    python price_estimator_baseline.py --output-dir out/custom
"""

import argparse
import datetime
import json
import pathlib
import shutil
import sys

import joblib
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.metrics import mean_absolute_error, median_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

CERTAMEN2_DIR = pathlib.Path(__file__).resolve().parent
CARDS_JSON = CERTAMEN2_DIR.parent / "certamen_1" / "data" / "cards.json"
OUTPUT_ROOT = CERTAMEN2_DIR / "output" / "price_baseline"
MODELS_DIR = CERTAMEN2_DIR / "models"  # binarios locales, gitignored (igual que pytorch/models, tensorFlow/models)

SEED = 42
ANIO_ACTUAL = datetime.date.today().year

COLORES = ["W", "U", "B", "R", "G"]
TIPOS_PRIMARIOS = [
    "Creature", "Instant", "Sorcery", "Artifact", "Enchantment",
    "Land", "Planeswalker", "Battle", "Kindred", "Tribal",
]
COLUMNAS_CATEGORICAS = ["rarity", "set_type", "frame", "border_color"]


def extraer_usd(card: dict) -> float | None:
    """Extrae prices.usd como float, o None si falta/es inválido/es <= 0."""
    usd_raw = (card.get("prices") or {}).get("usd")
    if usd_raw is None:
        return None
    try:
        usd = float(usd_raw)
    except (TypeError, ValueError):
        return None
    return usd if usd > 0 else None


def fila_features(card: dict) -> dict:
    """
    Aplana una carta a su fila de features (sin el target `usd`) — la misma
    transformación que usa el entrenamiento, reusable para inferencia
    (ver full_pipeline_demo.py, que predice el precio de una carta recién
    identificada sin pasar por construir_features/el dataset completo).
    """
    type_line = card.get("type_line") or ""
    colors = card.get("colors") or []
    color_identity = card.get("color_identity") or []
    finishes = card.get("finishes") or []
    frame_effects = card.get("frame_effects") or []
    released_at = card.get("released_at") or ""
    anio_str = released_at[:4]
    anio = int(anio_str) if anio_str.isdigit() else None

    fila = {
        "cmc": card.get("cmc") or 0,
        "rarity": card.get("rarity") or "unknown",
        "set_type": card.get("set_type") or "unknown",
        "frame": str(card.get("frame") or "unknown"),
        "border_color": card.get("border_color") or "unknown",
        "n_colores": len(color_identity),
        "es_incoloro": int(len(colors) == 0),
        "es_legendaria": int("Legendary" in type_line),
        "n_frame_effects": len(frame_effects),
        "tiene_foil": int("foil" in finishes),
        "tiene_etched": int("etched" in finishes),
        "anio": anio if anio is not None else 2000,
        "antiguedad_anios": (ANIO_ACTUAL - anio) if anio is not None else 25,
    }
    for color in COLORES:
        fila[f"color_{color}"] = int(color in colors)
    for tipo in TIPOS_PRIMARIOS:
        fila[f"tipo_{tipo.lower()}"] = int(tipo in type_line)
    return fila


def construir_features(cards: list) -> pd.DataFrame:
    """Aplana cada carta del dataset compartido a features tabulares + target `usd`."""
    filas = []
    for c in cards:
        usd = extraer_usd(c)
        if usd is None:
            continue
        fila = {"usd": usd, **fila_features(c)}
        filas.append(fila)

    return pd.DataFrame(filas)


def construir_pipeline(modelo: str) -> Pipeline:
    columnas_categoricas = COLUMNAS_CATEGORICAS
    preprocesador = ColumnTransformer(
        transformers=[("cat", OneHotEncoder(handle_unknown="ignore"), columnas_categoricas)],
        remainder="passthrough",
    )

    if modelo == "gb":
        regresor = GradientBoostingRegressor(random_state=SEED)
    else:
        # max_depth=None (sin límite) + 300 árboles sobre ~40k filas con
        # features one-hot producía un pipeline de ~800 MB en disco sin
        # mejora medible de R² sobre esta config acotada — árboles sin límite
        # de profundidad memorizan filas individuales en vez de generalizar.
        regresor = RandomForestRegressor(
            n_estimators=200, max_depth=18, min_samples_leaf=3,
            n_jobs=-1, random_state=SEED,
        )

    return Pipeline([("prep", preprocesador), ("reg", regresor)])


def graficar_feature_importance(pipeline: Pipeline, out_path: pathlib.Path) -> None:
    nombres = pipeline.named_steps["prep"].get_feature_names_out()
    importancias = pipeline.named_steps["reg"].feature_importances_
    orden = np.argsort(importancias)[::-1][:20]

    plt.figure(figsize=(9, 7))
    plt.barh(range(len(orden)), importancias[orden][::-1], color="#4C72B0")
    plt.yticks(range(len(orden)), [nombres[i] for i in orden][::-1], fontsize=8)
    plt.xlabel("Importancia")
    plt.title("Stage 3 — Estimador de precio (baseline): feature importance")
    plt.tight_layout()
    plt.savefig(out_path, dpi=130)
    plt.close()


def graficar_pred_vs_actual(y_true_usd: np.ndarray, y_pred_usd: np.ndarray, out_path: pathlib.Path) -> None:
    plt.figure(figsize=(7, 7))
    plt.scatter(y_true_usd, y_pred_usd, alpha=0.25, s=10, color="#55A868")
    lim = max(y_true_usd.max(), y_pred_usd.max())
    plt.plot([0, lim], [0, lim], "--", color="gray", linewidth=1)
    plt.xscale("log")
    plt.yscale("log")
    plt.xlabel("Precio real (USD, log)")
    plt.ylabel("Precio predicho (USD, log)")
    plt.title("Stage 3 — Estimador de precio (baseline): predicho vs. real")
    plt.tight_layout()
    plt.savefig(out_path, dpi=130)
    plt.close()


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
    parser = argparse.ArgumentParser(description="Baseline tabular de estimación de precio (Stage 3, Certamen 2).")
    parser.add_argument("--model", choices=["rf", "gb"], default="rf",
                        help="rf = RandomForestRegressor, gb = GradientBoostingRegressor. default: rf")
    parser.add_argument("--n", type=int, default=0, help="Sub-muestra de N cartas con precio (0 = todas).")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--output-dir", default=None, help="Override del directorio de salida (default: versionado bajo output/price_baseline/).")
    args = parser.parse_args()

    if not CARDS_JSON.exists():
        print(f"Error: no existe {CARDS_JSON}. Corré certamen_1/01_scraper.py primero.")
        sys.exit(1)

    with open(CARDS_JSON, encoding="utf-8") as f:
        cards = json.load(f)

    print(f"Cartas en el dataset compartido : {len(cards):,}")
    df = construir_features(cards)
    print(f"Cartas con precio usd utilizable : {len(df):,} ({len(df) / max(len(cards), 1):.1%})")

    if df.empty:
        print("Error: ninguna carta tiene prices.usd utilizable. ¿01_scraper.py corrió con el CAMPOS actualizado?")
        sys.exit(1)

    if args.n and len(df) > args.n:
        df = df.sample(n=args.n, random_state=SEED).reset_index(drop=True)
        print(f"Sub-muestreado a               : {len(df):,}")

    y_usd = df["usd"].to_numpy()
    X = df.drop(columns=["usd"])
    y_log = np.log1p(y_usd)

    X_train, X_test, y_train_log, y_test_log, y_train_usd, y_test_usd = train_test_split(
        X, y_log, y_usd, test_size=args.test_size, random_state=SEED,
    )
    print(f"Train / Test                   : {len(X_train):,} / {len(X_test):,}")

    pipeline = construir_pipeline(args.model)
    print(f"Entrenando ({'RandomForest' if args.model == 'rf' else 'GradientBoosting'})...")
    pipeline.fit(X_train, y_train_log)

    pred_log = pipeline.predict(X_test)
    pred_usd = np.expm1(pred_log)
    pred_usd = np.clip(pred_usd, 0, None)

    metricas = {
        "modelo": args.model,
        "n_train": len(X_train),
        "n_test": len(X_test),
        "log_space": {
            "mae": float(mean_absolute_error(y_test_log, pred_log)),
            "rmse": float(np.sqrt(mean_squared_error(y_test_log, pred_log))),
            "r2": float(r2_score(y_test_log, pred_log)),
        },
        "usd_space": {
            "mae": float(mean_absolute_error(y_test_usd, pred_usd)),
            "median_ae": float(median_absolute_error(y_test_usd, pred_usd)),
            "rmse": float(np.sqrt(mean_squared_error(y_test_usd, pred_usd))),
            "r2": float(r2_score(y_test_usd, pred_usd)),
        },
    }

    print("\n── Resultados (test set) ─────────────────────────")
    print(f"  MAE (USD)     : ${metricas['usd_space']['mae']:.2f}")
    print(f"  Median AE(USD): ${metricas['usd_space']['median_ae']:.2f}")
    print(f"  RMSE (USD)    : ${metricas['usd_space']['rmse']:.2f}")
    print(f"  R² (USD)      : {metricas['usd_space']['r2']:.3f}")
    print(f"  R² (log-USD)  : {metricas['log_space']['r2']:.3f}  (más representativo dado el sesgo del precio)")

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    run_dir = pathlib.Path(args.output_dir) if args.output_dir else OUTPUT_ROOT / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    with open(run_dir / "metrics_price_baseline.json", "w", encoding="utf-8") as f:
        json.dump(metricas, f, indent=2, ensure_ascii=False)

    graficar_feature_importance(pipeline, run_dir / "feature_importance.png")
    graficar_pred_vs_actual(y_test_usd, pred_usd, run_dir / "pred_vs_actual.png")

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    modelo_path = MODELS_DIR / "price_baseline_model.joblib"
    joblib.dump(pipeline, modelo_path)

    if args.output_dir is None:
        _actualizar_latest(OUTPUT_ROOT, run_dir)

    print(f"\nResultados (metrics + gráficos, versionado): {run_dir}")
    print(f"Modelo entrenado (binario local, no versionado): {modelo_path}")
    print("Siguiente paso: sumar el embedding visual (PyTorch/TensorFlow) como feature adicional — ver README.md, Stage 3.")


if __name__ == "__main__":
    main()
