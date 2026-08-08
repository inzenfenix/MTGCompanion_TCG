"""
MTG Card Scanner — Certamen 2, Stage 4
import_roboflow_condition_data.py: mezcla fotos reales (Roboflow) al dataset
sintético de condición.

Los dos datasets encontrados (ver README.md, sección 9) vienen anotados para
detección de objetos (cajas delimitadoras marcando dónde hay daño), no para
clasificación de carta completa como NM/LP/MP/HP/DMG. No hay forma de
mapearlos 1:1 — la heurística acá es contar cajas de daño por imagen y
convertir ese conteo en un grado, con umbrales calculados de la distribución
real de cada dataset (ver README.md para el detalle de cómo se calcularon).
Es una aproximación explícita, no un estándar de grading profesional — mismo
criterio que ya se documentó para `synthetic_wear.py`.

Requiere que los datasets ya estén descargados en
data/roboflow_raw/{mtg_v6,cross_tcg_v2}/ (ver README.md para cómo bajarlos
con la API key de Roboflow — no se corre automático acá porque necesita
una API key personal).

Cada foto real pasa por card_preprocessing.normalizar_carta antes de
guardarse — son fotos con fondo real (listados de eBay), no renders limpios,
mismo motivo que Stage 1/2/4 ya documentado (README.md, secciones 5.3 y 8).

Uso:
    python import_roboflow_condition_data.py
"""

import csv
import json
import pathlib
from collections import Counter

import cv2

from card_preprocessing import mejorar_contraste, normalizar_carta

CERTAMEN2_DIR = pathlib.Path(__file__).resolve().parent
ROBOFLOW_RAW_DIR = CERTAMEN2_DIR / "data" / "roboflow_raw"
DATASET_DIR = CERTAMEN2_DIR / "data" / "condition_dataset"
INDEX_PATH = DATASET_DIR / "index.csv"

# Categorías de "daño" por dataset (excluye la caja que marca la carta entera).
DATASETS = {
    "mtg_v6": {
        "prefijo": "roboflow_mtg",
        "categorias_dano": {"Dano"},
        # Umbrales calculados de la distribución real (803 imágenes, 55% con
        # 0 cajas — señal de que los vendedores fotografían más las cartas en
        # buen estado — y cuartiles de la porción con >0 cajas: 12/18/33).
        "umbrales": [(0, "NM"), (12, "LP"), (18, "MP"), (33, "HP"), (float("inf"), "DMG")],
    },
    "cross_tcg_v2": {
        "prefijo": "roboflow_cross",
        "categorias_dano": {"Corner Wear", "Edge Wear", "Scratch"},
        # 552 imágenes, 144 con 0 cajas; cuartiles de la porción con >0: 4/7/11.
        "umbrales": [(0, "NM"), (4, "LP"), (7, "MP"), (11, "HP"), (float("inf"), "DMG")],
    },
}


def _grado_por_conteo(conteo: int, umbrales: list) -> str:
    for limite, grado in umbrales:
        if conteo <= limite:
            return grado
    return umbrales[-1][1]


def procesar_dataset(nombre: str, cfg: dict) -> list:
    base_dir = ROBOFLOW_RAW_DIR / nombre
    if not base_dir.exists():
        print(f"  Aviso: no existe {base_dir}, saltando (¿lo descargaste? ver README.md sección 9).")
        return []

    filas = []
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
            conteo = conteo_por_imagen.get(img["id"], 0)
            grado = _grado_por_conteo(conteo, cfg["umbrales"])
            ruta_origen = base_dir / split / img["file_name"]
            if not ruta_origen.exists():
                continue
            filas.append({
                "card_id": f"{cfg['prefijo']}_{img['id']}",
                "name": f"(foto real, {nombre})",
                "grado": grado,
                "ruta_origen": ruta_origen,
                "conteo_dano": conteo,
            })

    return filas


def main() -> None:
    print("=" * 62)
    print("  Importando fotos reales (Roboflow) al dataset de condición")
    print("=" * 62)

    todas_las_filas = []
    for nombre, cfg in DATASETS.items():
        filas = procesar_dataset(nombre, cfg)
        print(f"  {nombre}: {len(filas):,} imágenes procesadas")
        todas_las_filas.extend(filas)

    if not todas_las_filas:
        print("\nNada para importar — revisá que data/roboflow_raw/ tenga los datasets descargados.")
        return

    print(f"\nTotal fotos reales a importar: {len(todas_las_filas):,}")
    dist = Counter(f["grado"] for f in todas_las_filas)
    for grado in ["NM", "LP", "MP", "HP", "DMG"]:
        print(f"  {grado}: {dist.get(grado, 0):,}")

    for grado in DATASETS["mtg_v6"]["umbrales"]:
        (DATASET_DIR / grado[1]).mkdir(parents=True, exist_ok=True)

    nuevas_filas_csv = []
    fallidas = 0
    for i, fila in enumerate(todas_las_filas):
        img = cv2.imread(str(fila["ruta_origen"]))
        if img is None:
            fallidas += 1
            continue

        # Fotos reales de eBay con fondo — localizar antes de guardar (mismo
        # criterio que Stage 1/2/4 sobre fotos reales, ver README.md).
        carta, _ = normalizar_carta(img, intentar_localizar=True)
        carta = mejorar_contraste(carta)

        destino = DATASET_DIR / fila["grado"] / f"{fila['card_id']}.jpg"
        cv2.imwrite(str(destino), carta)
        nuevas_filas_csv.append({
            "card_id": fila["card_id"], "name": fila["name"],
            "grado": fila["grado"], "path": str(destino),
        })

        if (i + 1) % 200 == 0:
            print(f"  {i + 1}/{len(todas_las_filas)} procesadas...")

    if INDEX_PATH.exists():
        with open(INDEX_PATH, encoding="utf-8") as f:
            filas_existentes = list(csv.DictReader(f))
    else:
        filas_existentes = []

    todas = filas_existentes + nuevas_filas_csv
    with open(INDEX_PATH, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["card_id", "name", "grado", "path"])
        writer.writeheader()
        writer.writerows(todas)

    print(f"\nImportadas: {len(nuevas_filas_csv):,}  |  fallidas: {fallidas:,}")
    print(f"index.csv actualizado: {INDEX_PATH}  ({len(todas):,} filas totales)")


if __name__ == "__main__":
    main()
