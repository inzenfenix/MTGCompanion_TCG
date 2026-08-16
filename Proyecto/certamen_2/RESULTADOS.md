# Resultados consolidados — Certamen 2 (Stage 2 y Stage 3)

Documento de reporting (workstream H de [ROADMAP.md](../../ROADMAP.md)). Junta
las métricas que cada script de entrenamiento ya escribe por separado en
`certamen_1/output/{pytorch,tensorflow}/**/metrics_*.json` y
`final_metrics.json`, para tener una sola fuente de verdad "qué framework
ganó, por stage" — la misma comparación que `ExportPanel.tsx` calcula en vivo
para el desktop-runner, pero como documento estático para el informe.

Regla de empate del proyecto (la misma que usa `scripts.service.ts` /
`ExportPanel.tsx`): si la diferencia entre PyTorch y TensorFlow en la métrica
principal es **< 0.005**, se considera empate; si no, gana el valor más alto
(o más bajo, cuando la métrica es "menor es mejor").

---

## Stage 3 — Price estimator (regresión)

**Métrica principal: R² en espacio log(precio+1)** — es la que optimizó el
sweep de Optuna (B4) y la que usa `ExportPanel.tsx` (`log_space.r2`) para
decidir el ganador, en vez de R² en espacio USD (ver nota al final: ese valor
sale cerca de cero por el sesgo/outliers de precios, es un artefacto
esperado, no un bug).

Dataset: 51,939 cartas con precio (36,359 train / 7,790 val / 7,790 test),
split por `card_id`.

| Modelo | n (test) | MAE (log) | RMSE (log) | **R² (log)** | MAE (USD) | Mediana AE (USD) | RMSE (USD) | R² (USD) |
|---|---|---|---|---|---|---|---|---|
| Baseline tabular (RF, sin imagen) | 10,325 | 0.317 | 0.531 | **0.521** | $2.59 | $0.20 | $45.23 | 0.191 |
| PyTorch — plain | 7,790 | 0.340 | 0.592 | **0.427** | $3.19 | $0.19 | $64.08 | 0.044 |
| PyTorch — Optuna (tuned) | 7,790 | 0.337 | 0.585 | **0.441** | $3.17 | $0.19 | $61.62 | 0.116 |
| TensorFlow — plain | 7,790 | 0.362 | 0.592 | **0.427** | $3.26 | $0.24 | $65.04 | 0.015 |
| TensorFlow — Optuna (tuned) | 7,790 | 0.334 | 0.591 | **0.430** | $3.24 | $0.18 | $63.02 | 0.075 |

**Ganador (tuned, R² log): PyTorch, 0.4411 vs. TensorFlow 0.4300** — diferencia
0.0111, mayor al umbral de empate (0.005), así que no es un empate: PyTorch
gana esta stage. Coincide con lo que ya reporta en vivo el endpoint
`/export/comparison` del desktop-runner (C5).

**Hiperparámetros ganadores (Optuna, ambos frameworks convergieron casi
idénticos):**

| Parámetro | PyTorch | TensorFlow |
|---|---|---|
| learning_rate | 2.09e-4 | 1.62e-4 |
| weight_decay | 5.21e-6 | 5.60e-6 |
| batch_size | 32 | 32 |
| hidden_units | 256 | 256 |
| dropout | 0.1 | 0.1 |
| optimizer | adam | adam |

**Observaciones:**

- El tuning de Optuna aporta una ganancia chica en ambos frameworks (+0.014
  PyTorch, +0.003 TensorFlow sobre el entrenamiento plano) pero **ninguno
  cierra la brecha con el baseline tabular-only** (0.521). Esto es el techo
  de información ya diagnosticado en B6 del ROADMAP: las features
  categóricas actuales (`rarity`/`set_type`/`frame`/`border_color`, sin señal
  de identidad de carta) no distinguen una común de $0.10 de una rara "chase"
  de $40 con los mismos valores categóricos — el precio lo maneja demanda/
  escasez, que hoy no está capturado. Agregar `edhrec_rank` (B6, no
  implementado) es el camino propuesto para cerrar esa brecha, no más
  hiperparámetros.
- **R² en espacio USD es sistemáticamente bajo (0.02–0.19) mientras que en
  espacio log ronda 0.43–0.52** — no es un bug: los precios de MTG tienen
  cola muy larga (unas pocas cartas "chase" a $100+ dominan la varianza en
  escala lineal), por eso el target real del entrenamiento es
  `log1p(precio)`. El log-space R² es la métrica justa para comparar
  frameworks; el USD-space se reporta como referencia descriptiva únicamente.
- La mediana de error absoluto en USD (no sensible a esos outliers) es más
  chica y estable: $0.18–$0.24 en los 4 modelos reales, $0.20 en el
  baseline — todos los modelos, reales y baseline, aciertan razonablemente
  bien la mayoría de las cartas comunes/baratas; la varianza que explica el
  R² bajo en USD-space viene de las pocas cartas caras.

---

## Stage 2 — Text validator (OCR match)

**Métrica principal: ROC-AUC** (misma que usó A4 para elegir hiperparámetros
vía Optuna), con F1 en el umbral óptimo de Youden como métrica secundaria
(H2, agregada esta sesión — ver nota abajo).

Dataset: 785 cartas OCR'd (de 800 muestreadas, 15 saltadas por falla de
descarga/OCR), 1,570 pares, split por `card_id` (314 pares de validación).

| Modelo | ROC-AUC | Umbral óptimo (Youden) | Accuracy en umbral | **F1 en umbral** |
|---|---|---|---|---|
| Baseline (difflib) | 0.818 | — | — | — |
| PyTorch — plain | 0.9872 | 0.199 | 0.9618 | **0.9615** |
| PyTorch — Optuna (tuned) | **0.9906** | 0.123 | 0.9618 | **0.9610** |
| TensorFlow — plain | 0.9861 | 0.531 | 0.9490 | **0.9470** |
| TensorFlow — Optuna (tuned) | **0.9886** | 0.085 | 0.9618 | **0.9613** |

**Ganador (tuned, ROC-AUC): diferencia 0.0020 entre frameworks — empate**
según la regla de 0.005 del proyecto (mismo criterio que Stage 3 arriba).
PyTorch's Optuna run picked `hidden_units=384, dropout=0.4, lr=2.07e-3,
optimizer=adamw`; TensorFlow's picked `hidden_units=192, dropout=0.3,
lr=1.31e-3, optimizer=adam` — different architectures landing at
essentially the same discriminative power, consistent with A4's original
tie finding.

**Nota sobre H2 (agregar F1) — cómo se resolvió:** el código para calcular
F1 en el umbral de Youden ya estaba listo (`evaluar()` en
`pytorch/14_text_validator.py`/`tensorFlow/12_text_validator.py`, reusado
por los scripts de Optuna), pero re-correr los 4 scripts para generar
números reales requería datos que no existían en esta máquina: el
`certamen_1/data/cards.json` local era un scrape parcial viejo (5,000
cartas, **sin el campo `oracle_text` en absoluto** — no es que estuviera
vacío para algunas cartas, la clave ni existía), así que un primer intento
de regenerar el dataset de pares dio ROC-AUC 0.63 (comparando OCR contra
solo el *nombre* de la carta, sin texto de reglas) — descartado, no
reportado como resultado real. Se instaló `tesseract` (winget,
`UB-Mannheim.TesseractOCR`), se re-scrapeó el catálogo completo sin cap
(`01_scraper.py --max-cards 0`, 58,174 cartas con `oracle_text` en 56,073 de
ellas) y se regeneró `text_pairs/index.csv` contra ese catálogo real antes
de re-entrenar. Los 4 números de la tabla de arriba son de esa corrida real,
no un placeholder.

---

*Última actualización: 2026-08-15. Datos de Stage 3 leídos directamente de
`certamen_1/output/{pytorch,tensorflow}/{price_estimator,optuna_price_estimator}/latest/`
y `certamen_2/output/price_baseline/latest/`. Datos de Stage 2 pendientes de
re-run (ver sección de arriba).*
