"""
MTG Card Scanner — Certamen 2, Stage 4 (ver ../../certamen_2/README.md, sección 9)
13_analizar_generalizacion_real.py: dos análisis sobre el clasificador de
condición, corridos juntos porque comparten la misma preparación de datos.

(A) Comparación cabeza a cabeza en fotos reales: ¿el modelo entrenado con
    dataset combinado (`condition_grader_combined.pth`) generaliza mejor a
    fotos reales que el modelo sintético-solo tuneado por Optuna
    (`condition_grader.pth`)? Ambos comparten arquitectura idéntica
    (freeze_ratio=0.5, head_units=448, dropout=0.35 — los hiperparámetros de
    Optuna) así que la única variable es qué datos vio cada uno durante el
    entrenamiento.

    Comparación justa: se evalúa a ambos sobre las fotos reales del split de
    VALIDACIÓN de `12_condition_grader_combined.py` (mismo seed=42, mismo
    código de split) — esas fotos están holdout para el modelo combinado
    (nunca las vio en train) Y también son holdout para el modelo
    sintético-solo (nunca vio NINGUNA foto real, ni en train ni en val, así
    que cualquier foto real le sirve de test). Usar solo las del split de val
    evita darle una ventaja desleal al modelo combinado.

(B) Diagnóstico del label noise en HP: `import_roboflow_condition_data.py`
    asigna el grado por cuartiles del conteo de cajas de daño anotadas, con
    umbrales distintos por dataset (mtg_v6: 0/12/18/33 — grueso;
    cross_tcg_v2: 0/4/7/11 — mucho más fino). La hipótesis es que buena parte
    de los errores en HP no son fallas del modelo sino ejemplos cerca de un
    umbral, donde ±1 caja de diferencia en la anotación original cambia el
    grado asignado. Este script re-lee los COCO JSON originales para
    recuperar el conteo real por imagen (no se guardó en index.csv) y lo
    cruza con los errores de predicción del modelo combinado.

Uso:
    python 13_analizar_generalizacion_real.py
"""

import csv
import json
import pathlib
import random
from collections import Counter, defaultdict

import numpy as np
import torch
from PIL import Image
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score
from torch.utils.data import DataLoader, Dataset
import torchvision.transforms as T

from src.condition_classifier import GRADOS, ConditionGrader

SCRIPT_DIR = pathlib.Path(__file__).resolve().parent
CERTAMEN2_DIR = SCRIPT_DIR.parent.parent / "certamen_2"
DATASET_INDEX = CERTAMEN2_DIR / "data" / "condition_dataset" / "index.csv"
ROBOFLOW_RAW_DIR = CERTAMEN2_DIR / "data" / "roboflow_raw"
MODELS_DIR = SCRIPT_DIR / "models"

IMG_SIZE = 224
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SEED = 42
VAL_SPLIT = 0.20
ARCH = {"freeze_ratio": 0.5, "head_units": 448, "dropout": 0.35}  # ganadores de Optuna, ambos modelos

# Mismos umbrales que import_roboflow_condition_data.py — se necesitan acá
# para recalcular el conteo_dano por imagen (no se guarda en index.csv).
DATASETS_CFG = {
    "roboflow_mtg": {
        "carpeta": "mtg_v6",
        "categorias_dano": {"Dano"},
        "umbrales": [(0, "NM"), (12, "LP"), (18, "MP"), (33, "HP"), (float("inf"), "DMG")],
    },
    "roboflow_cross": {
        "carpeta": "cross_tcg_v2",
        "categorias_dano": {"Corner Wear", "Edge Wear", "Scratch"},
        "umbrales": [(0, "NM"), (4, "LP"), (7, "MP"), (11, "HP"), (float("inf"), "DMG")],
    },
}

IMAGENET_MEAN = [0.485, 0.456, 0.406]
IMAGENET_STD = [0.229, 0.224, 0.225]
TRANSFORM_VAL = T.Compose([
    T.Resize((IMG_SIZE, IMG_SIZE)),
    T.ToTensor(),
    T.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
])


class ConditionDataset(Dataset):
    def __init__(self, samples: list, transform):
        self.samples = samples  # [(path, label_idx, card_id), ...]
        self.transform = transform

    def __len__(self):
        return len(self.samples)

    def __getitem__(self, idx: int):
        path, label, _card_id = self.samples[idx]
        img = Image.open(path).convert("RGB")
        return self.transform(img), torch.tensor(label, dtype=torch.long)


def cargar_indice(index_path: pathlib.Path) -> dict:
    por_carta: dict = {}
    with open(index_path, encoding="utf-8") as f:
        for fila in csv.DictReader(f):
            por_carta.setdefault(fila["card_id"], []).append((fila["path"], fila["grado"]))
    return por_carta


def preparar_muestras_val(por_carta: dict, val_split: float, seed: int) -> list:
    """Replica EXACTA del split de 12_condition_grader_combined.py — misma
    lista de card_ids, mismo shuffle, mismo seed. Devuelve solo el val."""
    card_ids = list(por_carta.keys())
    rng = random.Random(seed)
    rng.shuffle(card_ids)
    split = int(len(card_ids) * (1 - val_split))
    val_ids = card_ids[split:]

    grado_a_idx = {g: i for i, g in enumerate(GRADOS)}
    muestras = []
    for cid in val_ids:
        for path, grado in por_carta[cid]:
            muestras.append((path, grado_a_idx[grado], cid))
    rng.shuffle(muestras)
    return muestras


def cargar_modelo(nombre_pth: str) -> ConditionGrader:
    model = ConditionGrader(**ARCH).to(DEVICE)
    state = torch.load(MODELS_DIR / nombre_pth, map_location=DEVICE, weights_only=True)
    model.load_state_dict(state)
    model.eval()
    return model


def predecir(model: ConditionGrader, dl: DataLoader) -> np.ndarray:
    preds = []
    with torch.no_grad():
        for imgs, _ in dl:
            preds.extend(model(imgs.to(DEVICE)).argmax(dim=1).cpu().numpy())
    return np.array(preds)


def reconstruir_conteos_dano() -> dict:
    """{(prefijo, image_id_original): conteo_dano} re-leyendo los COCO JSON originales."""
    conteos = {}
    for prefijo, cfg in DATASETS_CFG.items():
        base_dir = ROBOFLOW_RAW_DIR / cfg["carpeta"]
        if not base_dir.exists():
            print(f"  Aviso: no está {base_dir} — se salta el diagnóstico de conteo para {prefijo}.")
            continue
        for split in ("train", "valid", "test"):
            json_path = base_dir / split / "_annotations.coco.json"
            if not json_path.exists():
                continue
            with open(json_path, encoding="utf-8") as f:
                coco = json.load(f)
            cat_por_id = {c["id"]: c["name"] for c in coco["categories"]}
            dano_ids = {cid for cid, name in cat_por_id.items() if name in cfg["categorias_dano"]}
            conteo_por_imagen = Counter()
            for ann in coco["annotations"]:
                if ann["category_id"] in dano_ids:
                    conteo_por_imagen[ann["image_id"]] += 1
            for img in coco["images"]:
                conteos[f"{prefijo}_{img['id']}"] = conteo_por_imagen.get(img["id"], 0)
    return conteos


def distancia_a_umbral(conteo: int, umbrales: list) -> int:
    """Distancia (en cajas) al límite de cuartil más cercano — 0 = justo en el borde."""
    limites = [lim for lim, _ in umbrales if lim != float("inf")]
    return min(abs(conteo - lim) for lim in limites) if limites else 999


def main() -> None:
    print("=" * 70)
    print("  (A) Comparación cabeza a cabeza en fotos reales holdout")
    print("=" * 70)

    por_carta = cargar_indice(DATASET_INDEX)
    val_samples = preparar_muestras_val(por_carta, VAL_SPLIT, SEED)
    reales = [s for s in val_samples if pathlib.Path(s[0]).name.startswith("roboflow_")]
    print(f"Fotos reales en el split de validación (holdout para ambos modelos): {len(reales):,}")

    dl = DataLoader(ConditionDataset(reales, TRANSFORM_VAL), batch_size=32, shuffle=False, num_workers=2)
    y_true = np.array([label for _, label, _ in reales])

    modelo_sint = cargar_modelo("condition_grader.pth")
    modelo_comb = cargar_modelo("condition_grader_combined.pth")

    pred_sint = predecir(modelo_sint, dl)
    pred_comb = predecir(modelo_comb, dl)

    for nombre, pred in [("Sintético-solo (Optuna)", pred_sint), ("Combinado (sintético+real)", pred_comb)]:
        acc = accuracy_score(y_true, pred)
        f1 = f1_score(y_true, pred, average="macro", zero_division=0)
        print(f"\n{nombre}:")
        print(f"  Accuracy   : {acc:.4f}")
        print(f"  F1 (macro) : {f1:.4f}")
        cm = confusion_matrix(y_true, pred, labels=list(range(len(GRADOS))))
        print(f"  Confusion matrix ({GRADOS}):")
        for fila in cm:
            print("   ", fila.tolist())

    print("\n" + "=" * 70)
    print("  (B) Diagnóstico: ¿los errores en HP son ruido de umbral?")
    print("=" * 70)

    conteos = reconstruir_conteos_dano()
    if not conteos:
        print("No se pudo reconstruir conteos (faltan los COCO JSON originales). Se salta (B).")
        return

    idx_a_grado = {i: g for i, g in enumerate(GRADOS)}
    errores_hp = []
    for (path, label, card_id), pred in zip(reales, pred_comb):
        grado_real, grado_pred = idx_a_grado[label], idx_a_grado[pred]
        if grado_real != grado_pred and (grado_real == "HP" or grado_pred == "HP"):
            conteo = conteos.get(card_id)
            if conteo is None:
                continue
            prefijo = "roboflow_mtg" if card_id.startswith("roboflow_mtg") else "roboflow_cross"
            dist = distancia_a_umbral(conteo, DATASETS_CFG[prefijo]["umbrales"])
            errores_hp.append({
                "card_id": card_id, "real": grado_real, "predicho": grado_pred,
                "conteo_dano": conteo, "dataset": DATASETS_CFG[prefijo]["carpeta"],
                "distancia_a_umbral": dist,
            })

    print(f"\nErrores del modelo combinado que involucran HP (real o predicho): {len(errores_hp)}")
    if errores_hp:
        cerca = sum(1 for e in errores_hp if e["distancia_a_umbral"] <= 2)
        print(f"  De esos, a ≤2 cajas de un umbral de cuartil: {cerca}/{len(errores_hp)} "
              f"({100 * cerca / len(errores_hp):.0f}%)")

        por_dataset = Counter(e["dataset"] for e in errores_hp)
        print(f"  Por dataset de origen: {dict(por_dataset)}")

        print("\n  Detalle (primeros 15):")
        print(f"  {'card_id':<24} {'real':<5} {'predicho':<9} {'conteo':<7} {'dist_umbral':<12} dataset")
        for e in errores_hp[:15]:
            print(f"  {e['card_id']:<24} {e['real']:<5} {e['predicho']:<9} {e['conteo_dano']:<7} "
                  f"{e['distancia_a_umbral']:<12} {e['dataset']}")

    resultado = {
        "comparacion_fotos_reales": {
            "n_fotos_reales_holdout": len(reales),
            "sintetico_solo": {
                "accuracy": float(accuracy_score(y_true, pred_sint)),
                "f1_macro": float(f1_score(y_true, pred_sint, average="macro", zero_division=0)),
            },
            "combinado": {
                "accuracy": float(accuracy_score(y_true, pred_comb)),
                "f1_macro": float(f1_score(y_true, pred_comb, average="macro", zero_division=0)),
            },
        },
        "diagnostico_hp": {
            "total_errores_relacionados_hp": len(errores_hp),
            "cerca_de_umbral_leq_2": sum(1 for e in errores_hp if e["distancia_a_umbral"] <= 2) if errores_hp else 0,
            "por_dataset": dict(Counter(e["dataset"] for e in errores_hp)) if errores_hp else {},
            "detalle": errores_hp,
        },
    }
    out_path = SCRIPT_DIR.parent / "output" / "pytorch" / "condition_grader_combined" / "analisis_generalizacion_real.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(resultado, f, indent=2, ensure_ascii=False)
    print(f"\nResultado completo: {out_path}")


if __name__ == "__main__":
    main()
