# TensorFlow + AMD GPU via Docker (ROCm) — manual escape hatch

ROADMAP.md workstream D. There is no maintained ROCm pip wheel for
`tensorflow>=2.16` (`tensorflow-rocm` on PyPI stopped at 2.9.4 — see
CLAUDE.md rule 6). AMD's own supported path for GPU-accelerated TensorFlow
on AMD hardware is their `rocm/tensorflow` Docker image. `desktop-runner`
already detects this automatically and falls back TensorFlow to CPU in the
managed venv — cleanly, no crash (`apps/server/src/scripts/scripts.service.ts`,
`installGpuAwarePackage`). This folder is what you reach for **manually**
when you specifically want TF training to be fast on AMD; it is deliberately
**not** wired into the desktop-runner UI (see "Why a manual escape hatch,
not a UI toggle" below).

PyTorch does not need any of this — its ROCm wheels install straight into
the normal venv (`desktop-runner`'s GPU auto-detect handles it, including
the `HSA_OVERRIDE_GFX_VERSION` override this exact GPU needs). This document
is TensorFlow-only.

## Quick start (Linux)

```bash
# One-time, only if this GPU is a mobile RDNA2 SKU without official
# precompiled ROCm kernels (RX 6800S/6700S = gfx1032/gfx1031 — this laptop).
# Check `rocminfo | grep -A2 Marketing` for your GPU's gfx target; desktop-runner's
# GPU panel (Configuración inicial) shows the same detection result.
export HSA_OVERRIDE_GFX_VERSION=10.3.0

./run.sh ml/training/tensorFlow/07_binary_classifier.py --epochs 3
```

First run pulls the image (~11GB — see disk/bandwidth note below). The
script mounts the whole repo at `/workspace` inside the container, installs
`ml/training/tensorFlow/requirements.txt` (fast — TensorFlow itself is
already in the image and matches the constraint, so pip leaves it alone),
and runs your script with the GPU passed through. Works identically for
`ml/data-prep/` scripts.

## Why this image tag

`rocm/tensorflow:rocm7.1.1-py3.12-tf2.20-dev`, chosen (2026-08-15) by
querying the live Docker Hub tag list and matching the **host's installed
ROCm userspace version exactly** — this laptop has ROCm 7.1.1 installed
(Fedora/Nobara RPM packages: `rocm-core-7.1.1`, `rocminfo-7.1.0`, etc.). The
container ships its own ROCm userspace and only needs kernel-driver ABI
compatibility with the host (`amdgpu`/`amdkfd`), which is broadly stable
across nearby versions — but matching removes that variable entirely rather
than hoping it's compatible. If you're on a different host ROCm version,
check `rpm -qa | grep rocm-core` (Fedora/Nobara) or `dpkg -l | grep rocm-core`
(Ubuntu) and pick the closest `rocm/tensorflow` tag from
[Docker Hub](https://hub.docker.com/r/rocm/tensorflow/tags) — prefer a
`-dev` tag (the `-runtime` variants stopped being published past ROCm 6.4.x
tags at the time of writing).

## Host setup per OS

The container needs the **host kernel driver** (`amdgpu` with KFD/ROCm
support) already working — `rocminfo` and `/dev/kfd` existing on the host is
the prerequisite, same as for PyTorch's ROCm wheels. Docker/Podman only
containerizes the userspace ROCm stack, not the kernel driver.

### Fedora / Nobara (this laptop)

Already satisfied here: `rocminfo`/`rocm-smi` present, user in `docker`,
`video`, `render` groups, Docker 29.6 installed. If starting from scratch:

```bash
sudo dnf install docker rocm-core rocminfo rocm-smi
sudo usermod -aG docker,video,render "$USER"   # log out/in after this
```

### Ubuntu

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker,video,render "$USER"   # log out/in after this

# AMD's installer for the kernel driver + userspace (picks Ubuntu's version
# automatically) — see https://rocm.docs.amd.com for the current one-liner:
#   amdgpu-install --usecase=rocm
```

Everything past this point (the `run.sh` invocation) is identical to
Fedora/Nobara — it's the same Docker image, same flags.

### Windows

**Not a supported path today, full stop — don't try to make this work on
Windows.** As of this writing (Aug 2026), AMD's own compatibility docs
explicitly exclude RDNA2 **mobile** SKUs (RX 6800S/6700S and the rest of the
Radeon 6000M/7000M/8000M laptop lines) from ROCm support entirely, on any
platform — the Docker container approach here relies on kernel-level KFD
access that plain `docker run`/WSL2 passthrough can't provide for these
chips regardless of OS. ROCm-on-WSL2 exists but is scoped to Strix/Strix
Halo APU SKUs, a different product line. On Windows, TensorFlow training on
this project stays CPU-only — `desktop-runner`'s existing auto-detect
already does the right thing (falls back cleanly, no crash). Revisit this
if AMD ships mobile-RDNA2 WSL2 support later.

## Why a manual escape hatch, not a UI toggle

ROADMAP.md D2 offered two options: (a) a "run in Docker" toggle wired into
`desktop-runner`, or (b) document it as a manual step and leave venv/CPU as
the default UI path. Went with (b), matching how AMD PyTorch is already
handled (auto-detected and just works, no separate mode to toggle):

- Every TF script already works today on CPU — this is a speed optimization,
  not a correctness blocker (see ROADMAP.md D's framing).
- A UI toggle would need to special-case log streaming, cancellation, and
  Optuna's multi-run orchestration through `docker exec` instead of a plain
  child process — real work for a P2 nice-to-have.
- Docker/rootless-Podman availability and image pull size (~11GB) aren't
  guaranteed on every dev machine the way a venv is — forcing it into the
  automatic "Correr TODO" sequence (CLAUDE.md rule 7) would make that
  sequence unreliable for anyone without Docker set up.

If TF training speed on AMD becomes an actual bottleneck (e.g. Stage 3's
visual-embedding regression head, workstream B, turns out slow on CPU),
revisit (a) then — this script is the manual version of exactly what that
toggle would automate.

## Known gotchas (found during the D1 spike, already fixed in `run.sh`)

- **`--group-add video`/`render` by name fails.** Docker resolves group
  *names* against the **container's** `/etc/group`, not the host's — and the
  `rocm/tensorflow` image doesn't define a `video`/`render` group at all.
  Fails with `Unable to find group render: no matching entries in group
  file`. Fixed by resolving the host's numeric GIDs (`getent group video`)
  and passing those instead — works regardless of what the image calls its
  groups, or whether it has any.
- **`docker run -it` hangs/errors outside a real terminal.** Any non-TTY
  caller (a script, a cron job, an agent) gets `cannot attach stdin to a
  TTY-enabled container because stdin is not a terminal`. Fixed by only
  adding `-it` when `[ -t 0 ] && [ -t 1 ]`.
- **The biggest one — `pip install -r requirements.txt` silently clobbers
  the image's ROCm-compiled TensorFlow with a stock CPU-only PyPI wheel.**
  `requirements.txt`'s `tensorflow>=2.16` is unpinned, and the image reports
  its version as something like `2.20.0-dev0+selfbuilt` — not a normal
  PEP 440 version, so pip doesn't trust that it satisfies the range and
  fetches a real PyPI `tensorflow` wheel over it instead. Same problem comes
  in a second time via `optuna-integration[tfkeras]`: its `tfkeras` extra
  declares a bare, unversioned `tensorflow` dependency (confirmed against
  PyPI's metadata — that's *all* the extra adds), which trips the exact same
  resolution. Caught this for real in the D1 spike: the first attempt
  installed cleanly, then crashed on `import tensorflow` with `ImportError:
  ... undefined symbol: Wrapped_PyInit__pywrap_tensorflow_lite_metrics_wrapper`
  — a torn install from a partial overwrite. `run.sh` now strips the
  `tensorflow` line and de-extras `optuna-integration[tfkeras]` →
  `optuna-integration` before installing, verified with `pip install
  --dry-run` to confirm tensorflow no longer appears in the install plan.
  **If you ever hand-edit the install step, keep this filter** — it's easy
  to "simplify" back to a plain `pip install -r requirements.txt` and get a
  container that looks like it works (imports fine, trains) but silently
  fell back to CPU.
- **Bind-mounting a host dir as the pip cache disables the cache.** The
  container runs as root (UID 0); a bind-mounted host directory keeps the
  host user's UID (1000 here), so pip sees "cache dir not owned by the
  current user" and disables itself — still works, just no caching between
  runs. Fixed by using a named Docker volume (`tf-rocm-pip-cache`) instead of
  a host bind mount — Docker creates it already owned by whichever UID
  writes to it first.

## Measured: GPU vs CPU (D3)

Measured 2026-08-15 on this laptop (RX 6800S, `HSA_OVERRIDE_GFX_VERSION=10.3.0`),
same script, same tiny slice (`07_binary_classifier.py --n 150 --epochs 2
--skip-download`, MobileNetV3Small backbone frozen, 0.9M trainable params,
8 steps/epoch at batch 32) — CPU run in the normal host venv, GPU run through
`run.sh`:

| | Epoch 1 (cold — graph trace / XLA compile) | Epoch 2 (steady state) | Total wall-clock |
|---|---|---|---|
| CPU (host venv) | 8s (1.0s/step) | 2s (210ms/step) | 20.8s |
| GPU (Docker, RX 6800S) | 31s (4.0s/step) | 1s (139ms/step) | 62.9s |

Two honest, separate findings, not one number:

- **Per-step steady-state, GPU is ~1.5x faster** (139ms vs 210ms/step) —
  the real "does the GPU work and help" answer, and it does.
- **Total wall-clock, GPU was ~3x *slower*** at this toy scale — swallowed by
  one-time fixed costs that don't scale with training size: XLA compiling
  ROCm kernels on first call (~30s), container pip install, and a backbone
  weights re-download (no persisted Keras cache across `--rm` containers).
  For a quick dev-loop check (small `--n`, 1–2 epochs) the plain CPU venv is
  actually faster end-to-end — the Docker path only pays off once training
  is long enough to amortize that fixed cost.

Extrapolating (not measured) to a real run — default `--n 3000 --epochs 15`
(≈150 steps/epoch after the train/val split): CPU ≈ 210ms × 150 × 15 ≈ 7.9
min; GPU ≈ 139ms × 150 × 15 + ~35s fixed cost ≈ 5.8 min — roughly **25–30%
faster wall-clock** once the run is big enough, growing further for
heavier workloads (e.g. Stage 3's planned visual-embedding regression head,
workstream B, which does more compute per step than this frozen-backbone
binary classifier). Worth re-measuring with a real full run once Stage 3
lands, since that's the more representative future workload for this image.
