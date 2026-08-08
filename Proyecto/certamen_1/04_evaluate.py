"""
MTG Card Scanner — Certamen 1
04_evaluate.py: punto de entrada único para evaluar uno o ambos frameworks.

Cada framework (pytorch/, tensorFlow/) mantiene su propio venv y su propia
implementación de evaluación (pytorch/04_evaluate.py, tensorFlow/04_evaluate.py).
Este script:
    1. Decide qué framework(s) evaluar (--model pytorch|tensorflow|both, default: both).
    2. Se asegura de que el venv de cada framework exista; si no, lo crea e instala
       sus requirements.txt.
    3. Corre la evaluación de cada framework dentro de su propio venv.
    4. Guarda cada corrida en output/<framework>/<timestamp>/ (y actualiza
       output/<framework>/latest -> <timestamp>/), para llevar un historial de
       cómo evolucionan las métricas a medida que cambian los modelos.

Uso:
    python 04_evaluate.py                    # evalúa ambos frameworks
    python 04_evaluate.py --model pytorch     # solo PyTorch
    python 04_evaluate.py --model tensorflow  # solo TensorFlow

Requisitos previos (por framework): dataset compartido (01_scraper.py /
02_downloader.py) + índice de embeddings propio (pytorch/03_pt_embedder.py o
tensorFlow/03_build_embeddings.py).
"""

import argparse
import datetime
import pathlib
import re
import shutil
import subprocess
import sys
import time

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

# TensorFlow no publica wheels para versiones de Python demasiado nuevas
# (a veces tarda meses en dar soporte a un release nuevo de Python). Si el
# intérprete por defecto falla instalando un requirements.txt que pide
# tensorflow, se reintenta con un Python en este rango instalado vía pyenv.
PYENV_MINOR_RANGE = (9, 12)  # Python 3.9–3.12

CERTAMEN_DIR = pathlib.Path(__file__).resolve().parent
OUTPUT_DIR = CERTAMEN_DIR / "output"

FRAMEWORKS = {
    "pytorch": {
        "dir": CERTAMEN_DIR / "pytorch",
        "label": "PyTorch (EfficientNet_b0)",
    },
    "tensorflow": {
        "dir": CERTAMEN_DIR / "tensorFlow",
        "label": "TensorFlow (MobileNetV3Small)",
    },
}


def _venv_python(framework_dir: pathlib.Path) -> pathlib.Path:
    for candidato in (framework_dir / ".venv" / "bin" / "python",
                       framework_dir / ".venv" / "Scripts" / "python.exe"):
        if candidato.exists():
            return candidato
    return framework_dir / ".venv" / "bin" / "python"


def _requirements_piden(req_file: pathlib.Path, paquete: str) -> bool:
    return req_file.exists() and paquete.lower() in req_file.read_text().lower()


def _pip_bin(python_bin: pathlib.Path) -> pathlib.Path:
    return python_bin.parent / ("pip.exe" if python_bin.suffix == ".exe" else "pip")


def _python_pyenv_compatible() -> pathlib.Path | None:
    """Busca, entre los Python instalados vía pyenv, uno dentro de PYENV_MINOR_RANGE.

    Prefiere el minor más alto disponible. Retorna None si no hay pyenv o
    ninguna versión instalada cae en el rango.
    """
    versions_dir = pathlib.Path.home() / ".pyenv" / "versions"
    if not versions_dir.exists():
        return None

    candidatos = []
    for d in versions_dir.iterdir():
        m = re.match(r"^3\.(\d+)\.\d+$", d.name)
        if m and PYENV_MINOR_RANGE[0] <= int(m.group(1)) <= PYENV_MINOR_RANGE[1]:
            python_bin = d / "bin" / "python"
            if python_bin.exists():
                candidatos.append((int(m.group(1)), python_bin))

    if not candidatos:
        return None
    candidatos.sort(reverse=True)
    return candidatos[0][1]


def asegurar_venv(framework_dir: pathlib.Path) -> pathlib.Path:
    """Retorna el intérprete del venv del framework, creándolo si no existe.

    Siempre corre `pip install -r requirements.txt` (idempotente: si ya está
    todo instalado, pip no hace nada) en vez de confiar en que el venv exista
    para asumir que sus dependencias están instaladas — un venv creado a mano
    y nunca usado (carpeta .venv/ presente pero vacía) es indistinguible de
    uno completo si solo se mira si existe el binario de python.

    Si el intérprete por defecto no tiene wheel disponible para tensorflow
    (versión de Python demasiado nueva), reintenta el venv con un Python
    3.9–3.12 instalado vía pyenv, si hay alguno.
    """
    venv_dir = framework_dir / ".venv"
    req_file = framework_dir / "requirements.txt"

    python_bin = _venv_python(framework_dir)
    if not python_bin.exists():
        print(f"  Entorno virtual no encontrado en {venv_dir} — creando...")
        subprocess.run([sys.executable, "-m", "venv", str(venv_dir)], check=True)
        python_bin = _venv_python(framework_dir)

    if not req_file.exists():
        print(f"  Aviso: no existe {req_file}, el venv puede quedar sin dependencias instaladas.")
        return python_bin

    print(f"  Verificando dependencias ({req_file})...")
    resultado = subprocess.run([str(_pip_bin(python_bin)), "install", "-r", str(req_file)])
    if resultado.returncode == 0:
        return python_bin

    if not _requirements_piden(req_file, "tensorflow"):
        raise subprocess.CalledProcessError(resultado.returncode, resultado.args)

    alterno = _python_pyenv_compatible()
    if alterno is None:
        print(f"  El intérprete usado para este venv ({python_bin}) no pudo instalar tensorflow")
        print(f"  (posiblemente su versión de Python es demasiado nueva), y no se encontró un")
        print(f"  Python 3.9–3.12 instalado vía pyenv para reintentar. Instalá uno con, por ejemplo:")
        print(f"    pyenv install 3.12.9")
        raise subprocess.CalledProcessError(resultado.returncode, resultado.args)

    print(f"  El intérprete usado no tiene wheel de tensorflow disponible.")
    print(f"  Reintentando el venv con {alterno} (encontrado vía pyenv)...")
    shutil.rmtree(venv_dir)
    subprocess.run([str(alterno), "-m", "venv", str(venv_dir)], check=True)
    python_bin = _venv_python(framework_dir)
    subprocess.run([str(_pip_bin(python_bin)), "install", "-r", str(req_file)], check=True)
    return python_bin


def _actualizar_latest(framework_output_dir: pathlib.Path, run_dir: pathlib.Path) -> None:
    latest = framework_output_dir / "latest"
    if latest.exists() or latest.is_symlink():
        if latest.is_symlink() or latest.is_file():
            latest.unlink()
        else:
            shutil.rmtree(latest)
    try:
        latest.symlink_to(run_dir.name, target_is_directory=True)
    except OSError:
        # Symlinks pueden no estar disponibles (p.ej. Windows sin privilegios) — copiar en su lugar.
        shutil.copytree(run_dir, latest)


def evaluar_framework(nombre: str) -> bool:
    info = FRAMEWORKS[nombre]
    framework_dir = info["dir"]

    print(f"\n{'═' * 70}")
    print(f"  Evaluando {info['label']}")
    print(f"{'═' * 70}")

    if not framework_dir.exists():
        print(f"  Error: {framework_dir} no existe.")
        return False

    try:
        python_bin = asegurar_venv(framework_dir)
    except subprocess.CalledProcessError as e:
        print(f"\n  ✗ No se pudo preparar el entorno virtual de {info['label']}: {e}")
        return False

    timestamp = datetime.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    framework_output_dir = OUTPUT_DIR / nombre
    run_dir = framework_output_dir / timestamp
    run_dir.mkdir(parents=True, exist_ok=True)

    cmd = [str(python_bin), "04_evaluate.py", "--output-dir", str(run_dir)]
    t0 = time.perf_counter()
    proc = subprocess.run(cmd, cwd=framework_dir)
    elapsed = time.perf_counter() - t0

    if proc.returncode != 0:
        print(f"\n  ✗ {info['label']} terminó con error (exit code {proc.returncode}, {elapsed:.1f}s).")
        return False

    _actualizar_latest(framework_output_dir, run_dir)
    print(f"\n  ✓ {info['label']} evaluado en {elapsed:.1f}s.")
    print(f"    Resultados: {run_dir}")
    print(f"    Último enlace: {framework_output_dir / 'latest'}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evalúa el sistema de retrieval de uno o ambos frameworks.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python 04_evaluate.py
  python 04_evaluate.py --model pytorch
  python 04_evaluate.py --model tensorflow
        """
    )
    parser.add_argument("--model", choices=["pytorch", "tensorflow", "both"], default="both",
                        help="Qué framework(s) evaluar (default: both).")
    args = parser.parse_args()

    modelos = list(FRAMEWORKS.keys()) if args.model == "both" else [args.model]

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    resultados = {nombre: evaluar_framework(nombre) for nombre in modelos}

    print(f"\n{'═' * 70}")
    print("  Resumen")
    print(f"{'═' * 70}")
    for nombre, ok in resultados.items():
        estado = "OK" if ok else "ERROR"
        print(f"  {FRAMEWORKS[nombre]['label']:<28} {estado}")

    if not all(resultados.values()):
        sys.exit(1)


if __name__ == "__main__":
    main()
