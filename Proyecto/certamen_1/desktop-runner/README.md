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
  binario, búsqueda de hiperparámetros con Optuna, export a ONNX (Stage 1 y
  Stage 4 — condición), scanner.
- **TensorFlow**: embeddings, visualización, clasificador binario, búsqueda de
  hiperparámetros con Optuna, export a ONNX (Stage 1 y Stage 4 — condición),
  scanner.
- **Testing**: comparar ambos scanners, descargar carta aleatoria y comparar.

Los scripts de entrenamiento de Stage 4 (`10_condition_grader.py` /
`11_optuna_condition_grader.py` en pytorch/, `09_condition_grader.py` /
`10_optuna_condition_grader.py` en tensorFlow/) todavía no están registrados
acá — solo sus exports a ONNX. Se corren manualmente por ahora; sus
resultados (`final_metrics.json`) sí se leen y comparan en la pestaña
"Export ONNX".

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

## Export ONNX: comparar frameworks y exportar

Pestaña "Export ONNX", al lado de las demás. Por cada etapa del pipeline que
entrena los dos frameworks (Stage 1 — detector MTG/no-MTG, Stage 4 —
clasificador de condición NM/LP/MP/HP/DMG; Stage 2/3 no aparecen acá, no son
dual-framework) muestra:

- Las métricas reales del último `final_metrics.json` de PyTorch y
  TensorFlow (`output/<framework>/optuna/latest/` para Stage 1,
  `output/<framework>/optuna_condition/latest/` para Stage 4), leídas del
  disco tal cual las dejó la corrida de Optuna — nada se recalcula en la UI.
- Cuál framework "gana" según `accuracy` (Stage 1) o `f1_macro` (Stage 4) —
  si la diferencia es menor a 0.5 puntos porcentuales se reporta empate en
  vez de forzar un ganador (típico en Stage 1, donde ambos rondan el 100%).
- "No entrenado todavía" en vez de romper, si algún modelo no se corrió
  todavía en esta máquina (mismo criterio de degradación gradual que el
  resto del runner).

Debajo de la comparación de cada etapa aparecen los `ScriptCard` reales de
sus dos scripts de export (`09_export_onnx.py` de cada framework para Stage
1; `12_export_onnx_condition.py` / `11_export_onnx_condition.py` para Stage
4) — son los mismos scripts ya registrados en las pestañas de PyTorch/
TensorFlow (venv, logs en vivo, botón "Detener", todo se comparte), solo se
muestran también acá en formato de comparación para poder elegir y exportar
sin cambiar de pestaña. Ninguno de los cuatro reentrena nada: toman el
modelo ya publicado (`.pth`/`.keras`) y lo convierten a `.onnx`, verificando
paridad numérica contra el modelo original antes de publicarlo.

Los datos de comparación salen de `GET /export/comparison` (server NestJS).

## Scraper: porcentaje del catálogo en vez de un número

El campo "Cap de cartas" de `01 · Scraper de catálogo` es un slider 1–100%
en vez de un número suelto:

- **100% = todo lo que permiten los filtros del scraper** (`--max-cards 0`),
  no "cada impresión de cada carta que existe" — `01_scraper.py` sigue
  deduplicando hasta `MAX_PRINTINGS_POR_CARTA` (3) impresiones por nombre de
  carta y aplicando sus filtros de siempre (idioma inglés, `set_type`
  permitido, sin tokens/emblemas/cartas de arte). El slider nunca "hornea"
  un número fijo para el 100% — manda `0` tal cual, así el propio scraper
  decide cuánto es "todo" el día que corre (el catálogo de Scryfall cambia).
- **1%–99% se traduce a un entero real** (`--max-cards <n>`) usando el
  tamaño real del catálogo, consultado una vez por sesión del server contra
  `/cards/search` de Scryfall (`GET /scripts/shared-scraper/card-count`,
  cacheado en el server — no vuelve a pegarle a Scryfall en cada render) en
  vez de descargar el bulk dump completo (varios cientos de MB) solo para
  mostrar un número en un slider.
- Ese total es una **aproximación** (`min(impresiones_totales,
  nombres_únicos × 3)`) — el número exacto solo se conoce corriendo el
  scraper de verdad; alcanza para escalar el slider, no hace falta más
  precisión.
- El dropdown de calidad de imagen ahora marca **"small (Recomendado)"**:
  todo el pipeline redimensiona las imágenes a 224×224 antes de entrenar
  (`pytorch/03_pt_embedder.py`, `tensorFlow/src/config.py`), así que pedir
  más resolución de origen no mejora el modelo, solo alarga la descarga.

**Judgment calls que quedaron para decisión del usuario, no se tocaron solas:**

- `ALLOWED_SET_TYPES` en `01_scraper.py` ya incluye `commander` (no excluye
  cartas de mazos Commander). No incluye `duel_deck`, `premium_deck` ni
  `starter` (Duel Decks, Premium Deck Series, Planeswalker/Intro/Clash
  decks) — son reimpresiones reales con arte a veces exclusivo, similares en
  espíritu a `masters`/`commander`, que hoy quedan afuera del 100%. No se
  agregaron por las suyas: es una decisión de alcance del dataset, no un bug.

## Pendiente / fuera de alcance de esta primera versión

- **Empaquetar como instalador** (`.exe`/`.dmg`): hoy se corre con
  `npm run electron` desde la terminal (una sola vez, para abrir la app — ya
  no hace falta volver a la terminal para correr los `.py`). Si querés un
  ejecutable de doble clic, se puede agregar `electron-builder`.
- El scraping/descarga de dataset (`01_scraper.py`, `02_downloader.py`) puede
  tardar minutos/horas según `--max-cards`; la consola de logs muestra
  progreso en vivo pero no hay barra de progreso dedicada.
