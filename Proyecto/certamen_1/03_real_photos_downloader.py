"""
MTG Card Scanner — Certamen 1
03_real_photos_downloader.py: Descarga el set de fotos reales (no sintéticas,
no renders) desde Google Drive — usado por G4 (chequeo end-to-end del
pipeline sobre fotos reales de un mazo físico).

Script compartido por ambos pipelines (pytorch/ y tensorFlow/), mismo espíritu
que 02_downloader.py: idempotente (omite archivos ya descargados en disco) y
resiliente a errores puntuales (Google Drive limita descargas anónimas en
ráfaga — un archivo que falla no debe tirar abajo el resto de la corrida).

Estructura de salida (carpeta compartida data/, junto a este script):
    data/real_photos/{nombre_archivo_original}.jpg
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
REAL_PHOTOS_DIR = DATA_DIR / "real_photos"

# Carpeta pública de Google Drive con las fotos reales (mazo Commander
# "Squirreled Away", Bloomburrow — ver data/real_photos/squirreled_away_decklist.json).
DEFAULT_FOLDER_ID = "183WKHVHJ863hCJq3Kc9uHDJj3UFtC0pw"

MAX_REINTENTOS = 2  # intentos extra tras el primero, con backoff corto
BACKOFF_S = 2.0


def main():
    parser = argparse.ArgumentParser(description="Descarga las fotos reales (Google Drive) a la carpeta compartida.")
    parser.add_argument("--folder-id", default=DEFAULT_FOLDER_ID, help="ID de la carpeta de Google Drive.")
    args = parser.parse_args()

    REAL_PHOTOS_DIR.mkdir(parents=True, exist_ok=True)

    print("Consultando listado de la carpeta de Google Drive...")
    archivos = gdown.download_folder(
        id=args.folder_id,
        output=str(REAL_PHOTOS_DIR),
        quiet=True,
        skip_download=True,
    )
    if not archivos:
        print("Error: no se pudo listar la carpeta de Google Drive (o está vacía).")
        sys.exit(1)

    pendientes = [f for f in archivos if not pathlib.Path(f.local_path).exists()]
    ya_ok = len(archivos) - len(pendientes)

    print(f"Total en la carpeta remota : {len(archivos):,}")
    print(f"Ya descargados             : {ya_ok:,}")
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

        log_path = DATA_DIR / "real_photos_download_errors.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump([{"path": p, "error": m} for p, m in errores], f, indent=2)
        print(f"\nLog de errores guardado en: {log_path}")
        print("Podés volver a correr el script para reintentar solo lo que falta (es idempotente).")

    total = sum(1 for _ in REAL_PHOTOS_DIR.glob("*") if _.is_file())
    print(f"\nTotal en disco : {total:,} archivos")


if __name__ == "__main__":
    main()
