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

## Pendiente / fuera de alcance de esta primera versión

- **Empaquetar como instalador** (`.exe`/`.dmg`): hoy se corre con
  `npm run electron` desde la terminal (una sola vez, para abrir la app — ya
  no hace falta volver a la terminal para correr los `.py`). Si querés un
  ejecutable de doble clic, se puede agregar `electron-builder`.
- El scraping/descarga de dataset (`01_scraper.py`, `02_downloader.py`) puede
  tardar minutos/horas según `--max-cards`; la consola de logs muestra
  progreso en vivo pero no hay barra de progreso dedicada.
