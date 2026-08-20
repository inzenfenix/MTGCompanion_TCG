"""
MTG Card Scanner — Certamen 1
real_negatives_downloader.py: descarga un set de fotos reales (no sintéticas,
no scrapeadas de un catálogo) de cartas NO-MTG desde Google Drive, para usar
como negativos del detector Stage 1 (ROADMAP.md I31) — a diferencia de
07_binary_classifier.py's NEG_SOURCES (Pokémon/Yu-Gi-Oh!/SWU/naipes/escenas
genéricas, todo scrapeado de catálogos o Wikimedia Commons), estas son fotos
sacadas con teléfono real, en escenas reales, subidas manualmente por el
usuario — la misma fidelidad de captura que G4's 03_real_photos_downloader.py
ya usa para el chequeo end-to-end, pero acá el contenido es justo lo
opuesto: cartas que el detector debe RECHAZAR, no aceptar.

Doble uso, no solo Stage 1 (ver ROADMAP.md I31/I33): al tener una carta real
(tamaño estándar de trading card) dentro de una escena real, estas fotos
también sirven para poner a prueba al localizador geométrico
(`card_preprocessing.py::localizar_carta()`) en condiciones reales, no solo
al clasificador Stage 1 — algo que ni las fotos scrapeadas (sin carta en
escena real) ni los renders sintéticos pueden ofrecer.

Mismo patrón que 03_real_photos_downloader.py: idempotente (omite archivos ya
descargados en disco) y resiliente a errores puntuales (Google Drive limita
descargas anónimas en ráfaga).

Estructura de salida (carpeta compartida data/, junto a este script):
    data/images_negatives/real_negatives/{nombre_archivo_original}.jpg

Uso:
    python real_negatives_downloader.py
    python real_negatives_downloader.py --folder-id <otro-id-de-carpeta>
"""

import argparse
import json
import pathlib
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

try:
    import gdown
except ImportError:
    print("Error: falta 'gdown'. Instalar con: pip install gdown")
    sys.exit(1)

# ── Configuración ─────────────────────────────────────────────────────────────
DATA_DIR = pathlib.Path(__file__).resolve().parent / "data"
REAL_NEGATIVES_DIR = DATA_DIR / "images_negatives" / "real_negatives"

# Carpeta pública de Google Drive con fotos reales de cartas Star Wars: Unlimited
# (mismo tamaño físico que una carta MTG, ROADMAP.md I18) en escenas reales,
# subidas por el usuario — carpeta "Negatives_MTG" en su Drive.
DEFAULT_FOLDER_ID = "1P-x_DoXAxkdN4x5f8lZfFCuOgdEEO6RE"

MAX_REINTENTOS = 2  # intentos extra tras el primero, con backoff corto
BACKOFF_S = 2.0


def main():
    parser = argparse.ArgumentParser(
        description="Descarga fotos reales de cartas negativas (no-MTG) desde Google Drive, para Stage 1 (ROADMAP.md I31/I33)."
    )
    parser.add_argument("--folder-id", default=DEFAULT_FOLDER_ID, help="ID de la carpeta de Google Drive.")
    args = parser.parse_args()

    REAL_NEGATIVES_DIR.mkdir(parents=True, exist_ok=True)

    print("Consultando listado de la carpeta de Google Drive...")
    archivos = gdown.download_folder(
        id=args.folder_id,
        output=str(REAL_NEGATIVES_DIR),
        quiet=True,
        skip_download=True,
    )
    if not archivos:
        print("Error: no se pudo listar la carpeta de Google Drive (o está vacía). "
              "Chequeá que el acceso general esté en \"Cualquier persona con el enlace\" - "
              "Editor fuerza inicio de sesión incluso para lectura anónima, Viewer no.")
        sys.exit(1)

    # Fotos subidas dos veces desde el teléfono (mismo nombre, dos IDs de Drive
    # distintos) generan una entrada por ID en `archivos` — sin deduplicar acá,
    # cada duplicado consume igual un intento de descarga anónima (aunque
    # termine pisando el mismo archivo en disco), así que gastan presupuesto
    # del rate-limit de Drive al doble de velocidad de la necesaria. Se
    # queda con el primer ID de cada nombre y avisa cuántos se descartaron.
    vistos = set()
    duplicados = 0
    unicos = []
    for archivo in archivos:
        if archivo.path in vistos:
            duplicados += 1
            continue
        vistos.add(archivo.path)
        unicos.append(archivo)

    pendientes = [f for f in unicos if not pathlib.Path(f.local_path).exists()]
    ya_ok = len(unicos) - len(pendientes)

    print(f"Total en la carpeta remota : {len(archivos):,} ({duplicados:,} duplicados por nombre, ignorados)")
    print(f"Fotos únicas               : {len(unicos):,}")
    print(f"Ya descargadas             : {ya_ok:,}")
    print(f"Por descargar              : {len(pendientes):,}")

    if not pendientes:
        print("\nTodo descargado.")
        return

    errores = []
    completados = 0

    for archivo in pendientes:
        for intento in range(MAX_REINTENTOS + 1):
            try:
                gdown.download(id=archivo.id, output=archivo.local_path, quiet=True)
                completados += 1
                break
            except Exception as e:
                if intento < MAX_REINTENTOS:
                    print(f"  reintentando {archivo.path} ({intento + 1}/{MAX_REINTENTOS}) tras {type(e).__name__}...",
                          file=sys.stderr, flush=True)
                    time.sleep(BACKOFF_S * (intento + 1))
                    continue
                errores.append((archivo.path, str(e)))
        print(f"  [{completados + len(errores)}/{len(pendientes)}] {archivo.path}", flush=True)

    print(f"\n{'─' * 50}")
    print(f"Descargados OK : {completados:,}")
    print(f"Errores        : {len(errores):,}")

    if errores:
        print("\nPrimeros errores:")
        for path, msg in errores[:10]:
            print(f"  {path}: {msg}")

        log_path = DATA_DIR / "real_negatives_download_errors.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump([{"path": p, "error": m} for p, m in errores], f, indent=2)
        print(f"\nLog de errores guardado en: {log_path}")
        print("Podés volver a correr el script para reintentar solo lo que falta (es idempotente).")

    total = sum(1 for _ in REAL_NEGATIVES_DIR.glob("*") if _.is_file())
    print(f"\nTotal en disco : {total:,} archivos")


if __name__ == "__main__":
    main()
