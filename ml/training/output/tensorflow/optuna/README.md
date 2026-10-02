# Optuna TensorFlow — detener, trasladar y reanudar

Este directorio contiene los estudios Optuna del clasificador binario
MTG/no-MTG de TensorFlow.

La corrida nocturna iniciada el 21 de julio de 2026 usa este directorio:

```text
2026-07-21_104919/
```

Su archivo `study.db` conserva los trials terminados y permite continuar el
estudio en otro computador.

## 1. Comprobar si la corrida ya terminó

Desde `Proyecto/certamen_1/tensorFlow`:

```powershell
Test-Path "..\output\tensorflow\optuna\2026-07-21_104919\final_metrics.json"
```

- `True`: la corrida terminó, reentrenó el modelo final y no hace falta
  reanudarla.
- `False`: la corrida todavía está activa, fue interrumpida o aún no alcanzó el
  reentrenamiento final.

También se puede comprobar si existe un proceso Optuna activo:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
  Where-Object { $_.CommandLine -like '*08_optuna_binary_classifier.py*' } |
  Select-Object ProcessId, ParentProcessId, CommandLine
```

## 2. Ver el progreso actual

Desde la raíz del repositorio:

```powershell
Get-Content -Wait -Encoding UTF8 `
  "Proyecto\certamen_1\output\tensorflow\optuna\nightly_2026-07-21_103637.stdout.log"
```

Este comando **solo muestra el log**. No inicia, reinicia ni detiene el
entrenamiento. `Ctrl+C` cierra únicamente la visualización del log.

Los mensajes y advertencias separados están en:

```text
Proyecto/certamen_1/output/tensorflow/optuna/nightly_2026-07-21_103637.stderr.log
```

## 3. Detener la corrida en este computador

La corrida original fue iniciada como proceso oculto. Para detener todos los
procesos Python que ejecuten específicamente `08_optuna_binary_classifier.py`:

```powershell
$optunaPids = Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
  Where-Object { $_.CommandLine -like '*08_optuna_binary_classifier.py*' } |
  Select-Object -ExpandProperty ProcessId

if ($optunaPids) {
  Stop-Process -Id $optunaPids
}
```

Esta detención puede interrumpir el trial que esté entrenándose. Los trials que
ya terminaron permanecen guardados en `study.db`. Al reanudar, los estados
abandonados `RUNNING` o `WAITING` no se cuentan como trials terminados.

Confirmar que ya no quedan procesos:

```powershell
Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" |
  Where-Object { $_.CommandLine -like '*08_optuna_binary_classifier.py*' }
```

Si el comando no muestra resultados, la corrida está detenida.

## 4. Archivos que deben llegar al computador nuevo

Antes de copiar o sincronizar, detener la corrida y esperar a que OneDrive
termine de sincronizar. Se necesitan:

```text
Proyecto/certamen_1/data/
Proyecto/certamen_1/output/tensorflow/optuna/2026-07-21_104919/
Proyecto/certamen_1/tensorFlow/08_optuna_binary_classifier.py
Proyecto/certamen_1/tensorFlow/src/
Proyecto/certamen_1/tensorFlow/requirements.txt
```

Lo más sencillo es sincronizar el repositorio completo junto con
`Proyecto/certamen_1/data/`. La carpeta `.venv` no debe trasladarse: se crea de
nuevo en el otro computador.

Es importante copiar el dataset existente, y no solamente `study.db`, para que
los trials reanudados usen las mismas imágenes MTG y Pokémon.

## 5. Preparar Python en el computador nuevo

Instalar Python 3.12. Desde la raíz del repositorio:

```powershell
py -3.12 -m venv "Proyecto\certamen_1\tensorFlow\.venv"

& "Proyecto\certamen_1\tensorFlow\.venv\Scripts\python.exe" `
  -m pip install --upgrade pip

& "Proyecto\certamen_1\tensorFlow\.venv\Scripts\python.exe" `
  -m pip install -r "Proyecto\certamen_1\tensorFlow\requirements.txt"
```

## 6. Reanudar el estudio en el computador nuevo

Desde la raíz del repositorio:

```powershell
Set-Location "Proyecto\certamen_1\tensorFlow"
$env:PYTHONUTF8 = "1"

.\.venv\Scripts\python.exe 08_optuna_binary_classifier.py `
  --resume-dir "..\output\tensorflow\optuna\2026-07-21_104919" `
  --n 3000 `
  --trials 20 `
  --trial-epochs 6 `
  --final-epochs 15 `
  --skip-download
```

`--trials 20` representa el total objetivo de trials terminados, no veinte
trials adicionales. Los trials completos almacenados en SQLite se conservan y
solo se ejecutan los que falten.

`--skip-download` supone que `Proyecto/certamen_1/data/` fue copiado o
sincronizado correctamente. Si faltan las imágenes, primero hay que reconstruir
el dataset siguiendo el README de `certamen_2`.

## 7. Detener una ejecución iniciada en primer plano

Si el comando anterior está ejecutándose directamente en una terminal, usar:

```text
Ctrl+C
```

Esta es la forma preferida de detenerlo: el script conserva el SQLite, genera
los artefactos disponibles y muestra el comando exacto de reanudación. Cerrar la
visualización de un `Get-Content -Wait` no detiene el entrenamiento.

## 8. Resultado esperado al finalizar

La carpeta `2026-07-21_104919/` debe contener:

```text
study.db
run_config.json
trials.csv
best_params.json
optuna_historia.png
optuna_importancia.png
final_metrics.json
final_training_history.json
```

El modelo final se guarda en:

```text
Proyecto/certamen_1/tensorFlow/models/mtg_detector.keras
```

`output/tensorflow/optuna/latest` se actualiza cuando la ejecución termina
correctamente.
