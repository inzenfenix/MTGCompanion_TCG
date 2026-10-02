"""
MTG Card Scanner — Certamen 2, Stage 4
download_roboflow_condition_data.py: descarga los dos datasets públicos de
Roboflow Universe usados por import_roboflow_condition_data.py (ver
README.md, sección 9) — fotos reales de cartas con daño/desgaste anotado.

Requiere una API key personal de Roboflow (gratis, ver
https://docs.roboflow.com/api-reference/authentication) en la variable de
entorno ROBOFLOW_API_KEY. En el desktop-runner esto se configura desde la
pestaña "Scraper" (se guarda en la config local de la app, no en el repo).

Salida:
    data/roboflow_raw/mtg_v6/{train,valid,test}/_annotations.coco.json + imágenes
    data/roboflow_raw/cross_tcg_v2/{train,valid,test}/_annotations.coco.json + imágenes

Idempotente: si un dataset ya tiene sus 3 splits con _annotations.coco.json,
no se vuelve a descargar.

Uso:
    ROBOFLOW_API_KEY=... python download_roboflow_condition_data.py
"""

import os
import pathlib
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

CERTAMEN2_DIR = pathlib.Path(__file__).resolve().parent
ROBOFLOW_RAW_DIR = CERTAMEN2_DIR / "data" / "roboflow_raw"

# (carpeta local, workspace, project slug, versión) — ver README.md sección 9
# para el origen de cada dataset.
DATASETS = [
    ("mtg_v6", "stall-ysun2", "mtg-card-grading", 6),
    ("cross_tcg_v2", "group-6-major-project", "card-grader", 2),
]


def _ya_descargado(carpeta: pathlib.Path) -> bool:
    return all((carpeta / split / "_annotations.coco.json").exists() for split in ("train", "valid", "test"))


def main():
    api_key = os.environ.get("ROBOFLOW_API_KEY")
    if not api_key:
        print("Error: falta ROBOFLOW_API_KEY. Configurala en la pestaña 'Scraper' del "
              "desktop-runner, o exportala a mano antes de correr este script.")
        sys.exit(1)

    try:
        from roboflow import Roboflow
    except ImportError:
        print("Error: falta el paquete 'roboflow'. Instalar con: pip install roboflow")
        sys.exit(1)

    ROBOFLOW_RAW_DIR.mkdir(parents=True, exist_ok=True)
    rf = Roboflow(api_key=api_key)

    for carpeta_nombre, workspace, project_slug, version in DATASETS:
        destino = ROBOFLOW_RAW_DIR / carpeta_nombre
        if _ya_descargado(destino):
            print(f"{carpeta_nombre}: ya descargado, se omite ({destino}).")
            continue

        print(f"{carpeta_nombre}: descargando {workspace}/{project_slug} v{version}...")
        proyecto = rf.workspace(workspace).project(project_slug)
        proyecto.version(version).download("coco", location=str(destino))
        print(f"{carpeta_nombre}: listo ({destino}).")

    print("\nSiguiente paso: python import_roboflow_condition_data.py")


if __name__ == "__main__":
    main()
