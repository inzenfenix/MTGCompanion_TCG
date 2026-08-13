# MTG Scanner — Desktop Runner

App de escritorio para correr los scripts de `certamen_1/` (pipelines PyTorch y
TensorFlow) desde una interfaz gráfica, sin ejecutar cada `.py` manualmente en
la terminal.

## Stack

- **Electron** — shell de escritorio.
- **NestJS** (embebido) — backend que arma el registro de scripts, crea/instala
  los venvs de `pytorch/`, `tensorFlow/` y `Testing/` cuando faltan, lanza cada
  `.py` como child process y streamea su output por WebSocket.
- **React + Tailwind + componentes estilo shadcn/ui** — interfaz: tabs por
  framework, formulario de parámetros por script, consola de logs en vivo,
  "Correr todo" con reporte final.

## Estructura

```
desktop-runner/
├── apps/
│   ├── server/     # NestJS — registro de scripts, venvs, WebSocket de logs
│   ├── renderer/   # React (Vite) — UI
│   └── electron/   # main.ts (levanta el server + ventana) y preload.ts (file picker nativo)
└── package.json    # workspaces npm
```

El server ubica `certamen_1/` en runtime de forma relativa (no hace falta
configurar nada) — ver `apps/server/src/scripts/scripts.config.ts`.

## Primer uso

```bash
cd desktop-runner
npm install
```

**Nota:** este proyecto queda dentro de una carpeta sincronizada con OneDrive.
`node_modules` tiene miles de archivos chicos — si notás que OneDrive se pone
lento después de instalar, marcá `desktop-runner/node_modules` para que
OneDrive no lo sincronice ("Liberar espacio" / excluir la carpeta), no afecta
al proyecto.

## Correr en desarrollo

```bash
npm run electron
```

Esto compila server + renderer + electron y abre la ventana. La primera vez
que corras un script de `pytorch/`, `tensorFlow/` o `Testing/`, la UI te va a
ofrecer crear el venv correspondiente (crea `.venv/` e instala su
`requirements.txt`) — no hace falta prepararlo a mano.

Si todavía falta preparar algún venv al arrancar, la app abre primero una
pantalla de **Configuración inicial** (detección de GPU + un botón
"Preparar" por entorno) en vez de la lista de scripts — se puede reabrir en
cualquier momento con el botón "⚙ Configuración inicial" del header. Ver
la sección siguiente.

Alternativa solo para iterar en la UI en el navegador (sin Electron, sin file
picker nativo):

```bash
npm run dev
```

Levanta el server NestJS (puerto `4550`) y el renderer con Vite (puerto
`5173`) juntos.

## Qué scripts están registrados

- **Dataset compartido**: `01_scraper.py`, `02_downloader.py`,
  `04_evaluate.py` (orquestador de evaluación).
- **PyTorch**: embeddings, visualización, fine-tuning (opcional), clasificador
  binario, scanner.
- **TensorFlow**: embeddings, visualización, clasificador binario, búsqueda de
  hiperparámetros con Optuna, scanner.
- **Testing**: comparar ambos scanners, descargar carta aleatoria y comparar.

Cada script muestra sus parámetros reales (los mismos flags de
`argparse` que ves en `Proyecto/certamen_1/README.md`), con sus valores por
defecto. Los que necesitan una imagen (`scanner.py`, `compare_scanners.py`)
tienen un botón "Elegir…" que abre el file picker nativo de Electron.

"Correr todo" (en las tabs de PyTorch/TensorFlow) ejecuta la secuencia
recomendada del framework y se detiene en el primer error, con un reporte
final de qué pasos quedaron OK.

**"Correr TODO"** — panel fijo arriba de las tabs (no vive adentro de
ninguna, aplica a las dos): PyTorch completo → TensorFlow completo →
comparación de ambos scanners sobre `testing_photos/`, un solo click, se
detiene en el primer error igual que el de arriba. Deliberadamente no
incluye scraper/downloader (dataset compartido) — eso se corre una vez
aparte, no en cada corrida de entrenamiento.

## GPU: detección automática (NVIDIA / AMD / CPU)

Al preparar el venv de `pytorch` o `tensorFlow` (desde la pantalla de
Configuración inicial o desde el botón "Crear venv" de cualquier script), el
server detecta la GPU disponible (`apps/server/src/scripts/gpu-detect.ts`) e
instala el wheel que corresponda **antes** de `requirements.txt` — no hace
falta editar nada a mano, y en ninguna PC se rompe: si no encuentra nada
usable, cae a CPU.

- **NVIDIA** (`nvidia-smi` presente): no hace nada especial — el wheel
  default de PyPI ya trae soporte CUDA.
- **AMD, Linux, ROCm** (`/dev/kfd` + `rocminfo` funcionando): instala PyTorch
  desde `download.pytorch.org/whl/rocmX.Y`, probando `rocm7.1` → `rocm6.4` →
  `rocm6.2` en orden hasta que uno instale sin error. Si la GPU detectada es
  una variante móvil de RDNA2 sin kernels ROCm precompilados oficialmente
  (ej. RX 6800S/6700S, `gfx1032`/`gfx1031`), el runner corre automáticamente
  con `HSA_OVERRIDE_GFX_VERSION=10.3.0` (medido y confirmado funcionando en
  una RX 6800S real — sin el override, cualquier operación en GPU segfaultea
  aunque `torch.cuda.is_available()` diga `True`).
- **TensorFlow + AMD**: no hay wheel ROCm mantenido para `tensorflow>=2.16`
  vía pip (el paquete `tensorflow-rocm` de PyPI quedó en 2.9.4; el camino
  actual de AMD es Docker — imágenes `rocm/tensorflow`, no un venv). El
  runner lo loguea claramente en la pantalla de configuración y sigue con
  TensorFlow en modo CPU — PyTorch sí queda acelerado.
- **Nada detectado / todo falló**: wheels CPU explícitos (`.../whl/cpu`,
  livianos), sin frenar el resto de la instalación.

El resultado de la detección se puede consultar en `GET /gpu` (el server
NestJS embebido, puerto 4550) y se cachea una sola vez por corrida de la app.

## Pendiente / fuera de alcance de esta primera versión

- **Empaquetar como instalador** (`.exe`/`.dmg`): hoy se corre con
  `npm run electron` desde la terminal (una sola vez, para abrir la app — ya
  no hace falta volver a la terminal para correr los `.py`). Si querés un
  ejecutable de doble clic, se puede agregar `electron-builder`.
- El scraping/descarga de dataset (`01_scraper.py`, `02_downloader.py`) puede
  tardar minutos/horas según `--max-cards`; la consola de logs muestra
  progreso en vivo pero no hay barra de progreso dedicada.
