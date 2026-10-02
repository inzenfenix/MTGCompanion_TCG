# Diseño: Optuna para el clasificador binario TensorFlow

## Objetivo

Aplicar Optuna al clasificador MTG/no-MTG de TensorFlow existente en
`ml/training/tensorFlow/`, determinar una combinación ganadora de
hiperparámetros mediante un conjunto de validación fijo y reentrenar el modelo
final en la ruta documentada por el proyecto.

La entrega debe poder ejecutarse durante la noche en un equipo sin GPU
detectable, reanudarse después de una interrupción y dejar evidencia
reproducible en `ml/training/output/tensorflow/optuna/{timestamp}/`.

## Alcance

Se incluye:

- Reconstrucción del dataset con los scripts existentes de `ml/training`.
- Optimización exclusivamente del pipeline TensorFlow.
- Parametrización retrocompatible del constructor del clasificador.
- Estudio Optuna persistente con TPE y poda de trials.
- Gráficos, tabla de trials y parámetros ganadores.
- Reentrenamiento y evaluación del modelo final.
- Actualización del README de `ml/data-prep` con instrucciones y artefactos.

Se excluye:

- Aplicación de Optuna al pipeline PyTorch.
- Los dos modelos nuevos del resto de Certamen 2.
- Integración del clasificador binario con `tensorFlow/scanner.py`. El scanner
  actual decide por similitud y no carga `mtg_detector.keras`.
- Descarga automática del dataset MTG desde el script Optuna; se conservan como
  puntos de entrada `01_scraper.py` y `02_downloader.py`.

## Arquitectura

### Constructor parametrizable

`ml/training/tensorFlow/src/binary_classifier.py` ampliará
`build_binary_classifier()` con parámetros opcionales para:

- `learning_rate`
- `weight_decay`
- `head_units`
- `dropout`
- `optimizer_name`
- `freeze_ratio`

Los defaults reproducirán el comportamiento actual: Adam, `3e-4`, cabeza de
256 unidades, dropouts `0.3` y `0.2`, y `freeze_ratio=0.65`. Para conservar los
dos dropouts actuales sin añadir otra dimensión al estudio, el constructor
aceptará `dropout=None` como modo retrocompatible (`0.3` y `0.2`). Cuando Optuna
proporcione un valor numérico, ese mismo valor se aplicará a ambos dropouts.

Los optimizadores admitidos serán Adam, AdamW y SGD. Adam y AdamW recibirán el
`weight_decay` propuesto; SGD usará momentum fijo de `0.9` y el mismo
`weight_decay` soportado por la API moderna de Keras. El backbone continuará
invocándose con `training=False` para no actualizar las estadísticas de
BatchNormalization durante el fine-tuning.

### Script de optimización

`ml/training/tensorFlow/08_optuna_binary_classifier.py` será el punto
de entrada. Reutilizará del pipeline existente las funciones de descarga de
negativos, preparación de muestras y construcción de `tf.data.Dataset`. La
carga del archivo cuyo nombre comienza por `07_` se encapsulará en una función
pequeña mediante `importlib`, evitando duplicar el pipeline y evitando renombrar
un script público existente.

El script ofrecerá estos argumentos:

- `--skip-download`: reutilizar negativos Pokémon existentes.
- `--n`: imágenes por clase; default `3000`.
- `--trials`: trials solicitados; default `20`.
- `--trial-epochs`: máximo de épocas por trial; default `6`.
- `--final-epochs`: épocas del reentrenamiento final; default `15`.
- `--timeout-hours`: límite temporal opcional; sin límite por default.
- `--study-name`: nombre estable del estudio; default
  `mtg_detector_tensorflow`.
- `--resume-dir`: directorio de una corrida anterior que contiene la base
  SQLite; si se omite se crea un nuevo timestamp.
- `--seed`: default `42`.
- `--no-final-train`: generar resultados del estudio sin reemplazar el modelo.

El script Optuna tendrá su propio ciclo de entrenamiento y sus propios
callbacks. No reutilizará `entrenar()` de `07_binary_classifier.py`, porque esa
función contiene un scheduler anclado al learning rate fijo `3e-4`.

### Espacio de búsqueda

Cada trial propondrá:

| Parámetro | Distribución |
|---|---|
| `learning_rate` | flotante logarítmico entre `1e-5` y `1e-2` |
| `weight_decay` | flotante logarítmico entre `1e-6` y `1e-2` |
| `batch_size` | categórico: `16`, `32`, `64` |
| `head_units` | entero de `64` a `512`, paso `64` |
| `dropout` | flotante de `0.0` a `0.5`, paso `0.05` |
| `optimizer` | categórico: `adam`, `adamw`, `sgd` |
| `freeze_ratio` | categórico: `0.50`, `0.65`, `0.80`, `1.00` |

Se excluye batch size `128` del default para reducir el riesgo de falta de
memoria en CPU. El usuario aún podrá incorporarlo posteriormente si una medición
local demuestra memoria suficiente.

## Flujo de datos y entrenamiento

1. El usuario ejecuta `01_scraper.py --max-cards 5000 --quality small`.
2. El usuario ejecuta `02_downloader.py`.
3. El script Optuna valida la presencia de al menos 500 imágenes MTG.
4. El script descarga o reutiliza 3.000 imágenes Pokémon mediante el código de
   `07_binary_classifier.py`.
5. Con semilla fija se construye una única partición train/validation. La misma
   lista de rutas se reutiliza en todos los trials.
6. Cada trial limpia la sesión Keras, construye sus datasets con el batch size
   propuesto, crea el modelo parametrizado y entrena hasta seis épocas.
7. La poda observa `val_accuracy` y puede terminar trials no prometedores.
8. El objective retorna el máximo `val_accuracy` observado por el trial.
9. TPE selecciona nuevos parámetros a partir del historial del estudio.
10. Al terminar, el script guarda artefactos y reentrena desde pesos ImageNet
    con los parámetros ganadores durante 15 épocas.
11. El mejor checkpoint final se escribe primero en una ruta temporal y solo
    después reemplaza atómicamente `models/mtg_detector.keras`.
12. El modelo final se evalúa sobre el mismo conjunto de validación y sus
    métricas quedan identificadas como validación, no como estimación imparcial
    sobre un test independiente.

El uso del mismo validation split para selección y reporte final es coherente
con la consigna inmediata, pero se documentará como limitación metodológica. No
se afirmará rendimiento de generalización sobre datos no vistos sin crear un
test hold-out separado.

## Persistencia y artefactos

Cada corrida nueva crea:

`ml/training/output/tensorflow/optuna/YYYY-MM-DD_HHMMSS/`

con:

- `study.db`: almacenamiento SQLite para reanudar.
- `run_config.json`: argumentos, semilla, espacio de búsqueda y timestamp.
- `trials.csv`: estado, valor, duración y parámetros de todos los trials.
- `best_params.json`: parámetros ganadores, mejor `val_accuracy`, número de
  trial y metadatos del estudio.
- `optuna_historia.png`: historia de optimización.
- `optuna_importancia.png`: importancia de hiperparámetros cuando existan
  suficientes trials completos para calcularla.
- `final_metrics.json`: accuracy, precision, recall, F1 y ROC-AUC del modelo
  reentrenado sobre validación.
- `final_training_history.json`: curvas numéricas de entrenamiento final.

`output/tensorflow/optuna/latest` apuntará a la corrida más reciente siguiendo
el patrón tolerante a Windows de `04_evaluate.py`: enlace de directorio cuando
el sistema lo permita y copia como fallback.

El modelo final permanecerá en la ruta documentada actual:
`ml/training/tensorFlow/models/mtg_detector.keras`. También se
actualizará `models/mtg_detector_cfg.json` con los hiperparámetros ganadores,
el umbral `0.5`, el tamaño de imagen y la ruta de los resultados Optuna.

Una interrupción conserva todos los trials finalizados en SQLite. Al pasar
`--resume-dir`, `load_if_exists=True` continúa el mismo estudio y solo ejecuta
los trials adicionales solicitados.

## Manejo de errores

- Si falta el dataset MTG, se aborta antes de crear el estudio y se imprimen
  los dos comandos exactos para reconstruirlo.
- Si hay menos muestras que `--n`, se usa el mínimo común disponible y se
  informa el total efectivo.
- Si un trial agota memoria o produce un error recuperable de TensorFlow, se
  marca como fallido, se limpia la sesión y el estudio continúa.
- Si un trial produce `NaN`, se considera fallido y no puede ganar.
- Si no hay trials completos, no se reentrena ni se reemplaza el modelo.
- Si la importancia de parámetros no puede calcularse, se conserva el resto de
  artefactos y se genera un gráfico explicativo en vez de abortar la corrida.
- `Ctrl+C` conserva la base SQLite y muestra el comando de reanudación.
- El modelo público no se reemplaza hasta que el checkpoint final exista y se
  pueda cargar correctamente con Keras.

## Dependencias

`ml/training/tensorFlow/requirements.txt` agregará versiones compatibles
de `optuna` y `optuna-integration[tfkeras]`. TensorFlow se ejecutará con Python
3.12 porque el único intérprete detectado actualmente es Python 3.14 y la
instalación debe usar una versión para la cual existan wheels compatibles.

## Verificación

Las pruebas automatizadas cubrirán sin entrenamiento pesado:

- Defaults retrocompatibles del constructor.
- Validación de nombres de optimizador.
- Determinismo del split de muestras.
- Creación y serialización de artefactos con un estudio Optuna sintético.
- Reanudación de un estudio SQLite temporal.
- Manejo de ausencia de dataset y de ausencia de trials completos.

La verificación de integración se hará en dos fases:

1. Smoke test: dataset pequeño, dos trials y una época, sin reemplazar el modelo.
2. Corrida nocturna: 20 trials, seis épocas máximas y reentrenamiento final de
   15 épocas.

La corrida se considera satisfactoria cuando termina con código `0`, existen
`best_params.json`, ambos gráficos, `trials.csv` y `final_metrics.json`, y el
modelo final puede cargarse con `tf.keras.models.load_model()`.

## Comandos previstos

Desde `ml/training`:

```powershell
python 01_scraper.py --max-cards 5000 --quality small
python 02_downloader.py
```

Desde `ml/training/tensorFlow`, usando el Python 3.12 del entorno
virtual:

```powershell
python 08_optuna_binary_classifier.py --trials 20 --trial-epochs 6 --final-epochs 15
```

Para reanudar:

```powershell
python 08_optuna_binary_classifier.py --resume-dir ..\output\tensorflow\optuna\2026-07-21_220000 --trials 20
```
