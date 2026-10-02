# `desktop-runner/` — the pipeline orchestration GUI

Electron shell + NestJS server (`apps/server`, port 4550) + React renderer
(`apps/renderer`). Wraps every Python script in `ml/training/`/`ml/data-prep/`
so the whole training/export pipeline can run without a terminal, plus a
"Deploy" tab for AWS/Terraform (see `docs/context/infra/README.md`).

## Process orchestration

- **`ScriptsService`** (`apps/server/src/scripts/scripts.service.ts`) owns
  all process spawn/stream/kill — this is the one place in the app
  responsible for that, including Terraform commands (see `docs/context/infra`), not
  a separate service class. `execAndStream(runId, cmd, args, cwd)` and the
  fuller `runScript()`/`stopRun()` (POSIX process-group kill via
  `detached:true` + `process.kill(-pid,'SIGTERM')`) are the reusable
  primitives.
- **`LogsGateway`** (socket.io) emits live log/status events; the renderer
  connects via `getSocket()` (`apps/renderer/src/lib/api.ts`).
- **`settings.ts`**'s `RunnerSettings`/`readSettings()`/`writeSettings()`
  persists to `~/.mtg-desktop-runner/settings.json` — **outside the git
  working tree**, the same place Roboflow API keys and (now) AWS
  credentials live. Exposed via `GET`/`POST /settings`.

## `RUN_ALL_*` sequences (`scripts.config.ts`) — the declarative pipeline manifest

Root `CLAUDE.md` rule 7: these arrays are the single source of truth for
what "Correr TODO" runs, in order — don't add a parallel "run everything"
path when a new stage/script needs registering, extend these instead.

1. `RUN_ALL_DOWNLOAD_SEQUENCE` = `['shared-downloader', 'shared-real-photos']`
   — deliberately **excludes** `shared-scraper` (destructive, see
   `docs/context/tools/README.md`).
2. `RUN_ALL_SEQUENCES.pytorch` / `.tensorflow` — embed/evaluate/visualize →
   binary classifier → text validator → price estimator → condition grader,
   per framework.
3. `RUN_ALL_EXPORT_SEQUENCE` — exports everything just trained to ONNX and
   publishes it to `apps/mobile/public/models/`. **Order matters for
   Stage 3 specifically** (TensorFlow's export runs before PyTorch's, so
   PyTorch's is always what's left published — see `docs/context/models/README.md`
   for the dimension-mismatch reason); Stage 1/2/4 are order-independent
   ("last exporter wins" is harmless there).

`runEverything()` in `scripts.service.ts` runs phases 1→2→3 in sequence.

## UI conventions worth knowing

- `App.tsx`'s `TabValue` union + `TABS` array + a ternary render chain keeps
  every tab always-mounted (hidden via CSS), so tab state survives
  switching.
- `apps/renderer/src/lib/types.ts` mirrors every server type 1:1 by
  convention ("Mismo shape que X del server") — keep it in sync when server
  types change.
- Reusable component templates: `ScriptCard.tsx` + `useRunLogs.ts` +
  `LogConsole.tsx` (Card+Badge+live-log+stop, generic over any `runId`);
  `RoboflowApiKeyBox.tsx` (paste-a-secret box pattern, reused/adapted for
  AWS credentials in the Deploy tab); `ArgForm.tsx`'s `Checkbox` control.

## GPU/venv handling

Auto-detects AMD ROCm and applies `HSA_OVERRIDE_GFX_VERSION=10.3.0` for
PyTorch automatically; falls TensorFlow back to CPU cleanly on AMD (no
maintained ROCm wheel for `tensorflow>=2.16` — see `docs/context/environment/README.md`).
Venv creation/dependency install follows the same `asegurar_venv()` pattern
described in `docs/context/tools/README.md` — the app invokes the actual Python
scripts for this rather than reimplementing it in JS/TS.
