"""
MTG Card Scanner — Certamen 1
02_downloader.py: Descarga imágenes de cartas MTG desde Scryfall.
Script compartido por ambos pipelines (pytorch/ y tensorFlow/).

Lee data/cards.json generado por 01_scraper.py y descarga la imagen de cada carta.
El script es idempotente: omite imágenes ya descargadas, por lo que puede
interrumpirse y reanudarse sin problemas.

Estructura de salida (carpeta compartida data/, junto a este script):
    data/images/{card_id}.jpg

Scryfall pide un delay de ~50–100 ms entre requests para no sobrecargar su CDN.
Usamos un thread pool pequeño con delay para respetar esta política.
"""

import argparse
import json
import pathlib
import sys
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

try:
    from tqdm import tqdm
    TQDM = True
except ImportError:
    TQDM = False

# ── Configuración ─────────────────────────────────────────────────────────────
DATA_DIR    = pathlib.Path(__file__).resolve().parent / "data"
IMAGES_DIR  = DATA_DIR / "images"
MAX_WORKERS = 4          # paralelo conservador (política Scryfall)
DELAY_S     = 0.06       # 60 ms entre requests por worker
TIMEOUT_S   = 30
USER_AGENT  = "MTG-Scanner-Academic/1.0"


# ── Descarga de una sola carta ────────────────────────────────────────────────

def descargar_carta(card: dict, session: requests.Session) -> tuple:
    """
    Descarga la imagen de una carta y la guarda en disco.
    Retorna (card_id, ok: bool, detalle: str).
    """
    ruta = IMAGES_DIR / f"{card['id']}.jpg"
    if ruta.exists():
        return card["id"], True, "cached"

    try:
        resp = session.get(card["image_url"], timeout=TIMEOUT_S)
        resp.raise_for_status()

        # Verificar que sea una imagen válida (Scryfall retorna JPEG)
        content_type = resp.headers.get("Content-Type", "")
        if "image" not in content_type:
            return card["id"], False, f"Content-Type inesperado: {content_type}"

        ruta.write_bytes(resp.content)
        time.sleep(DELAY_S)
        return card["id"], True, str(ruta)

    except requests.HTTPError as e:
        return card["id"], False, f"HTTP {e.response.status_code}"
    except Exception as e:
        return card["id"], False, str(e)


def main():
    parser = argparse.ArgumentParser(description="Descarga las imágenes del catálogo local a la carpeta compartida.")
    parser.add_argument("--workers", type=int, default=MAX_WORKERS, help="Cantidad de workers en paralelo.")
    parser.add_argument("--delay", type=float, default=DELAY_S, help="Pausa entre requests por worker (segundos).")
    args = parser.parse_args()

    cards_path = DATA_DIR / "cards.json"
    if not cards_path.exists():
        print("Error: data/cards.json no existe. Ejecuta 01_scraper.py primero.")
        return

    with open(cards_path, encoding="utf-8") as f:
        cards = json.load(f)

    IMAGES_DIR.mkdir(parents=True, exist_ok=True)

    # Separar descargadas de pendientes
    pendientes = [c for c in cards if not (IMAGES_DIR / f"{c['id']}.jpg").exists()]
    ya_ok = len(cards) - len(pendientes)

    print(f"Total cartas en dataset : {len(cards):,}")
    print(f"Ya descargadas          : {ya_ok:,}")
    print(f"Por descargar           : {len(pendientes):,}")

    if not pendientes:
        print("\nTodo descargado. Siguiente paso: python 03_pt_embedder.py (pytorch) o 03_build_embeddings.py (tensorFlow)")
        return

    # Estimar tiempo
    tiempo_est = len(pendientes) * args.delay / args.workers
    print(f"Tiempo estimado         : ~{tiempo_est / 60:.0f} min con {args.workers} workers\n")

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    errores = []
    completadas = 0

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(descargar_carta, card, session): card
            for card in pendientes
        }

        if TQDM:
            progreso = tqdm(as_completed(futures), total=len(pendientes), unit="img", ncols=80)
        else:
            progreso = as_completed(futures)

        for future in progreso:
            card_id, ok, detalle = future.result()
            if ok:
                completadas += 1
            else:
                errores.append((card_id, detalle))
                if TQDM:
                    progreso.set_postfix({"errores": len(errores)})

    print(f"\n{'─' * 50}")
    print(f"Descargadas OK : {completadas:,}")
    print(f"Errores        : {len(errores):,}")

    if errores:
        print("\nPrimeros errores:")
        for cid, msg in errores[:10]:
            print(f"  {cid}: {msg}")

    # Guardar log de errores si los hay
    if errores:
        log_path = DATA_DIR / "download_errors.json"
        with open(log_path, "w") as f:
            json.dump([{"id": cid, "error": msg} for cid, msg in errores], f, indent=2)
        print(f"\nLog de errores guardado en: {log_path}")

    total_imgs = sum(1 for _ in IMAGES_DIR.glob("*.jpg"))
    total_mb   = sum(f.stat().st_size for f in IMAGES_DIR.glob("*.jpg")) / 1e6
    print(f"\nTotal en disco : {total_imgs:,} imágenes  ({total_mb:.0f} MB)")
    print(f"Siguiente paso : python 03_pt_embedder.py (pytorch) o 03_build_embeddings.py (tensorFlow)")


if __name__ == "__main__":
    main()
