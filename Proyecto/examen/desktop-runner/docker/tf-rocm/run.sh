#!/usr/bin/env bash
# Escape hatch: run a certamen_1/certamen_2 TensorFlow script inside the
# official rocm/tensorflow Docker image, with the host's AMD GPU passed
# through. This is a MANUAL step — desktop-runner does not shell out to
# Docker automatically (ROADMAP.md workstream D2, option (b): documented
# escape hatch, venv/CPU stays the default UI path). See README.md in this
# folder for host setup per OS and why.
#
# Usage:
#   ./run.sh <script-path-relative-to-repo-root> [script-args...]
#
# Examples:
#   ./run.sh Proyecto/certamen_1/tensorFlow/07_binary_classifier.py --epochs 3
#   ./run.sh Proyecto/certamen_2/prepare_price_dataset.py
#
# First run pulls the image (~11GB, tag chosen to match this host's
# installed ROCm 7.1.1 userspace — see README's "Why this tag" section).
# Subsequent runs are instant (image cached) and reuse a persistent pip
# cache in the "tf-rocm-pip-cache" Docker volume.

set -euo pipefail

IMAGE="rocm/tensorflow:rocm7.1.1-py3.12-tf2.20-dev"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
# requirements.txt lives under certamen_1/tensorFlow; certamen_2 scripts
# reuse the same dependency set (no separate TF requirements file there yet).
REQUIREMENTS="Proyecto/certamen_1/tensorFlow/requirements.txt"
# Volumen nombrado, no bind mount: un bind mount a un dir del host queda con
# el UID del host, y el contenedor corre como root (UID 0) — pip ve el cache
# "no owned by the current user" y lo deshabilita (confirmado en el spike de
# D1). Un volumen nombrado lo crea Docker ya con el UID que lo escribe.
PIP_CACHE_VOLUME="tf-rocm-pip-cache"

if [ $# -lt 1 ]; then
  echo "Uso: $0 <script-relativo-a-la-raiz-del-repo> [args-del-script...]" >&2
  echo "  ej:  $0 Proyecto/certamen_1/tensorFlow/07_binary_classifier.py --epochs 3" >&2
  exit 1
fi

if [ ! -e "/dev/kfd" ]; then
  echo "ADVERTENCIA: /dev/kfd no existe en este host — el driver de kernel" >&2
  echo "amdgpu/ROCm no está cargado. El contenedor va a correr en modo CPU" >&2
  echo "(TensorFlow igual funciona, solo que sin GPU). Ctrl+C para cancelar." >&2
fi

# --group-add necesita GIDs numéricos, no nombres: la imagen no tiene un
# grupo "render"/"video" en su propio /etc/group, y Docker resuelve nombres
# contra el /etc/group *del contenedor*, no del host (confirmado en el spike
# de D1 — con nombres tira "Unable to find group render").
VIDEO_GID="$(getent group video | cut -d: -f3)"
RENDER_GID="$(getent group render | cut -d: -f3)"
DOCKER_GROUP_ARGS=()
[ -n "${VIDEO_GID:-}" ] && DOCKER_GROUP_ARGS+=(--group-add "$VIDEO_GID")
[ -n "${RENDER_GID:-}" ] && DOCKER_GROUP_ARGS+=(--group-add "$RENDER_GID")

# Igual que gpu-detect.ts en el server de desktop-runner: HSA_OVERRIDE_GFX_VERSION
# es opt-in, nunca un default hardcodeado (CLAUDE.md regla 1) — solo se
# propaga si quien corre el script ya lo exportó (ver README: variantes
# móviles RDNA2 como la RX 6800S/6700S, gfx1032/gfx1031, lo necesitan).
DOCKER_ENV_ARGS=()
if [ -n "${HSA_OVERRIDE_GFX_VERSION:-}" ]; then
  DOCKER_ENV_ARGS+=(-e "HSA_OVERRIDE_GFX_VERSION=${HSA_OVERRIDE_GFX_VERSION}")
fi

# -it solo si hay una TTY real (uso interactivo en terminal) — un run
# lanzado desde un script/cron/agente sin TTY se cuelga si se fuerza (Docker
# rechaza "-it" sin stdin de terminal).
TTY_ARGS=()
if [ -t 0 ] && [ -t 1 ]; then
  TTY_ARGS+=(-it)
fi

# --device=/dev/kfd + /dev/dri + group-add video/render: acceso estándar a
# la GPU AMD desde un contenedor ROCm (ver README de este folder para el
# detalle por distro). --ipc=host + --shm-size grande: TensorFlow/XLA usan
# shared memory agresivamente, el default de Docker (64MB) hace crashear
# el data loading con datasets grandes.
exec docker run --rm "${TTY_ARGS[@]}" \
  --device=/dev/kfd \
  --device=/dev/dri \
  "${DOCKER_GROUP_ARGS[@]}" \
  --ipc=host \
  --shm-size=8g \
  --security-opt seccomp=unconfined \
  -v "${REPO_ROOT}:/workspace" \
  -v "${PIP_CACHE_VOLUME}:/root/.cache/pip" \
  -w /workspace \
  "${DOCKER_ENV_ARGS[@]}" \
  "$IMAGE" \
  bash -c '
    # La imagen ya trae TensorFlow compilado contra ROCm. requirements.txt
    # pide "tensorflow>=2.16" sin pin exacto — pip no reconoce el string de
    # versión local de la imagen (algo tipo "2.20.0-dev0+selfbuilt", no es
    # PEP440 normal) como que satisface el rango, y "resuelve" bajándose el
    # wheel CPU-only de PyPI encima, rompiendo el import (confirmado en el
    # spike de D1 — ImportError por símbolo indefinido tras el downgrade
    # accidental). optuna-integration[tfkeras] arrastra el mismo problema por
    # su extra "tfkeras" (que solo pide "tensorflow" sin versión, nada más —
    # confirmado contra los metadatos de PyPI). Se sanean ambas líneas antes
    # de instalar; ninguna otra dependencia del archivo toca tensorflow.
    sed -E "/^tensorflow/Id; s/optuna-integration\[tfkeras\]/optuna-integration/" "$1" > /tmp/requirements-sin-tf.txt
    pip install --quiet -r /tmp/requirements-sin-tf.txt
    shift
    exec python "$@"
  ' tf-rocm-run "$REQUIREMENTS" "$@"
