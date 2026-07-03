"""
MTG Card Scanner — Certamen 1
Testing/compare_scanners.py: compara el scanner de PyTorch y el de TensorFlow
sobre las mismas imagenes.

Corre cada scanner con su propio venv (pytorch/.venv, tensorFlow/.venv) como
subproceso y muestra, para cada imagen, que carta identifico cada framework,
con que similitud y si la considera Magic o no.

Uso:
    python compare_scanners.py                          # compara todo testing_photos/
    python compare_scanners.py testing_photos/carta.jpg  # compara una imagen puntual
    python compare_scanners.py foto1.jpg foto2.jpg
    python compare_scanners.py --top 10 --threshold 0.8
    python compare_scanners.py --skip-detect             # omite el clasificador binario de PyTorch

Requisitos:
    - pytorch/.venv y tensorFlow/.venv creados con sus dependencias instaladas.
    - Indices de embeddings generados en ambos frameworks
      (pytorch/data/embeddings_pt.npy, tensorFlow/data/indexes/magic_embeddings.pkl).
"""

import argparse
import pathlib
import re
import subprocess
import sys
import time

TESTING_DIR  = pathlib.Path(__file__).resolve().parent
CERTAMEN_DIR = TESTING_DIR.parent
PT_DIR       = CERTAMEN_DIR / "pytorch"
TF_DIR       = CERTAMEN_DIR / "tensorFlow"
PHOTOS_DIR   = TESTING_DIR / "testing_photos"

IMG_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
TIMEOUT_S = 300


def _venv_python(framework_dir: pathlib.Path) -> str:
    """Retorna el interprete del venv del framework si existe; si no, cae a sys.executable."""
    for candidato in (framework_dir / ".venv" / "bin" / "python",
                       framework_dir / ".venv" / "Scripts" / "python.exe"):
        if candidato.exists():
            return str(candidato)
    return sys.executable


def _run(cmd: list, cwd: pathlib.Path) -> tuple:
    t0 = time.perf_counter()
    try:
        proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=TIMEOUT_S)
        return proc.stdout, proc.stderr, proc.returncode, time.perf_counter() - t0
    except subprocess.TimeoutExpired:
        return "", f"timeout ({TIMEOUT_S}s)", -1, time.perf_counter() - t0


def _extraer_campo(patron: str, texto: str):
    m = re.search(patron, texto, re.MULTILINE)
    return m.group(1) if m else None


def _parse_pt_output(stdout: str) -> dict:
    prob = _extraer_campo(r"P\(MTG\)\s*=\s*([\d.]+)", stdout)
    gate_rejected = "NO parece una carta MTG" in stdout
    verdict = _extraer_campo(r"^(MAGIC|NO_MAGIC)$", stdout)
    nombre = _extraer_campo(r"^card_name=(.*)$", stdout)
    similitud = _extraer_campo(r"^similarity=([\d.]+)$", stdout)

    return {
        "detector_prob": float(prob) if prob else None,
        "gate_rejected": gate_rejected,
        "verdict": verdict or ("BLOQUEADO" if gate_rejected else "ERROR"),
        "card_name": nombre.strip() if nombre else None,
        "similarity": float(similitud) if similitud else None,
    }


def _parse_tf_output(stdout: str) -> dict:
    es_magic = _extraer_campo(r"^(Es Magic|Probablemente NO es Magic)$", stdout)
    nombre = _extraer_campo(r"^Carta top-1\s*:\s*(.+)$", stdout)
    similitud_pct = _extraer_campo(r"^Similitud\s*:\s*([\d.]+)%$", stdout)

    return {
        "verdict": ("MAGIC" if es_magic == "Es Magic" else "NO_MAGIC") if es_magic else "ERROR",
        "card_name": nombre.strip() if nombre else None,
        "similarity": float(similitud_pct) / 100 if similitud_pct else None,
    }


def evaluar_pytorch(image_path: pathlib.Path, top: int, threshold: float, skip_detect: bool) -> dict:
    cmd = [_venv_python(PT_DIR), str(PT_DIR / "scanner.py"), str(image_path),
           "--top", str(top), "--threshold", str(threshold)]
    if skip_detect:
        cmd.append("--skip-detect")

    stdout, stderr, code, elapsed = _run(cmd, cwd=PT_DIR)
    if code != 0:
        detalle = stderr.strip().splitlines()[-1] if stderr.strip() else f"exit code {code}"
        return {"error": detalle, "elapsed": elapsed}

    resultado = _parse_pt_output(stdout)
    resultado["elapsed"] = elapsed
    return resultado


def evaluar_tensorflow(image_path: pathlib.Path, top: int, threshold: float) -> dict:
    cmd = [_venv_python(TF_DIR), str(TF_DIR / "scanner.py"), str(image_path),
           "--top-k", str(top), "--threshold", str(threshold)]

    stdout, stderr, code, elapsed = _run(cmd, cwd=TF_DIR)
    if code != 0:
        detalle = stderr.strip().splitlines()[-1] if stderr.strip() else f"exit code {code}"
        return {"error": detalle, "elapsed": elapsed}

    resultado = _parse_tf_output(stdout)
    resultado["elapsed"] = elapsed
    return resultado


def imprimir_comparacion(image_path: pathlib.Path, pt: dict, tf: dict) -> None:
    ancho = 96
    print("═" * ancho)
    print(f"  Imagen: {image_path.name}")
    print("─" * ancho)
    print(f"  {'Framework':<12}{'Veredicto':<12}{'Carta identificada':<38}{'Similitud':>10}{'Tiempo':>10}")
    print("─" * ancho)

    for label, r in (("PyTorch", pt), ("TensorFlow", tf)):
        if "error" in r:
            print(f"  {label:<12}{'ERROR':<12}{r['error'][:56]}")
            continue
        nombre = (r.get("card_name") or "-")[:37]
        sim = f"{r['similarity'] * 100:.1f}%" if r.get("similarity") is not None else "-"
        print(f"  {label:<12}{r['verdict']:<12}{nombre:<38}{sim:>10}{r['elapsed']:>9.2f}s")
        if label == "PyTorch" and r.get("detector_prob") is not None:
            print(f"  {'':<12}(clasificador binario: P(MTG) = {r['detector_prob']:.4f})")

    print("═" * ancho)
    print()


def comparar_imagen(image_path: pathlib.Path, top: int, threshold: float, skip_detect: bool) -> None:
    pt = evaluar_pytorch(image_path, top, threshold, skip_detect)
    tf = evaluar_tensorflow(image_path, top, threshold)
    imprimir_comparacion(image_path, pt, tf)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Compara el scanner de PyTorch y el de TensorFlow sobre las mismas imagenes.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python compare_scanners.py
  python compare_scanners.py testing_photos/carta.jpg
  python compare_scanners.py --top 10 --threshold 0.8
  python compare_scanners.py --skip-detect
        """
    )
    parser.add_argument("imagenes", nargs="*", type=pathlib.Path,
                        help="Imagenes a comparar. Si se omite, usa todas las de testing_photos/.")
    parser.add_argument("--top", type=int, default=5, metavar="N",
                        help="Cantidad de candidatos a mostrar (default: 5).")
    parser.add_argument("--threshold", type=float, default=0.75, metavar="T",
                        help="Umbral de similitud para decidir Magic/No-Magic (default: 0.75).")
    parser.add_argument("--skip-detect", action="store_true",
                        help="Omite el clasificador binario de PyTorch (deja solo el umbral de similitud).")
    args = parser.parse_args()

    if args.imagenes:
        imagenes = [p.resolve() for p in args.imagenes]
    elif PHOTOS_DIR.exists():
        imagenes = sorted(p.resolve() for p in PHOTOS_DIR.iterdir() if p.suffix.lower() in IMG_EXTENSIONS)
    else:
        imagenes = []

    if not imagenes:
        print(f"No hay imagenes para comparar. Agrega archivos a {PHOTOS_DIR} o pasa una ruta como argumento.")
        return

    for img in imagenes:
        if not img.exists():
            print(f"Aviso: {img} no existe, se omite.")
            continue
        comparar_imagen(img, args.top, args.threshold, args.skip_detect)


if __name__ == "__main__":
    main()
