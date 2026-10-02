# Resultados consolidados — Certamen 2 (Stage 2 y Stage 3)

Documento de reporting (workstream H de [ROADMAP.md](../../ROADMAP.md)). Junta
las métricas que cada script de entrenamiento ya escribe por separado en
`ml/training/output/{pytorch,tensorflow}/**/metrics_*.json` y
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
split por `card_id`. Features tabulares: 50-dim (48 originales + `edhrec_rank_conocido`/
`edhrec_rank_log`, agregados en B6, ver más abajo).

| Modelo | n (test) | MAE (log) | RMSE (log) | **R² (log)** | MAE (USD) | Mediana AE (USD) | RMSE (USD) | R² (USD) |
|---|---|---|---|---|---|---|---|---|
| Baseline tabular (RF, sin imagen) | 10,325 | 0.317 | 0.531 | **0.521** | $2.59 | $0.20 | $45.23 | 0.191 |
| PyTorch — plain | 7,790 | 0.261 | 0.462 | **0.651** | $2.86 | $0.16 | $60.95 | 0.135 |
| PyTorch — Optuna (tuned) | 7,790 | 0.249 | 0.457 | **0.658** | $2.77 | $0.12 | $59.48 | 0.176 |
| TensorFlow — plain | 7,790 | 0.254 | 0.464 | **0.648** | $2.89 | $0.14 | $64.61 | 0.028 |
| TensorFlow — Optuna (tuned) | 7,790 | 0.240 | 0.463 | **0.649** | $2.89 | $0.11 | $64.72 | 0.025 |

**Ganador (tuned, R² log): PyTorch, 0.6585 vs. TensorFlow 0.6491** —
diferencia 0.0094, mayor al umbral de empate (0.005), así que no es un
empate: PyTorch gana esta stage. Coincide con lo que ya reporta en vivo el
endpoint `/export/comparison` del desktop-runner (C5).

**Actualización (B6, mismo día — la tabla de arriba ya la refleja, esta nota
documenta el cambio):** los números originales de esta sección (PyTorch
0.4411 / TensorFlow 0.4300) eran de *antes* de B6 del ROADMAP, que agregó
`edhrec_rank` (popularidad/demanda, desde `ml/training/merge_edhrec_rank.py`)
como feature tabular — el R² log saltó de 0.427–0.441 a 0.648–0.658 en
ambos frameworks, cerrando y superando la brecha con el baseline tabular
(0.521) que esta sección originalmente señalaba como sin cerrar. Ver B6 en
ROADMAP.md para el diagnóstico completo (era un techo de información — sin
señal de demanda/escasez, no un problema de tuning).

**Hiperparámetros ganadores (Optuna, post-B6):**

| Parámetro | PyTorch | TensorFlow |
|---|---|---|
| learning_rate | 2.73e-4 | 2.73e-4 |
| weight_decay | 1.07e-4 | 7.15e-5 |
| batch_size | 32 | 32 |
| hidden_units | 448 | 384 |
| dropout | 0.0 | 0.3 |
| optimizer | adam | adam |

**Observaciones:**

- Con `edhrec_rank` en el feature set, **ambos frameworks superan
  claramente al baseline tabular-only** (0.658/0.649 vs. 0.521) — el techo
  de información diagnosticado en B6 (features categóricas sin señal de
  demanda/escasez) era el problema real, no falta de tuning: el tuning de
  Optuna post-`edhrec_rank` aporta una ganancia chica (+0.007 PyTorch,
  +0.001 TensorFlow sobre el entrenamiento plano), consistente con "ya casi
  no queda techo de información por cerrar con hiperparámetros".
- **R² en espacio USD es sistemáticamente bajo (0.02–0.18) mientras que en
  espacio log ronda 0.65** — no es un bug: los precios de MTG tienen cola
  muy larga (unas pocas cartas "chase" a $100+ dominan la varianza en
  escala lineal), por eso el target real del entrenamiento es
  `log1p(precio)`. El log-space R² es la métrica justa para comparar
  frameworks; el USD-space se reporta como referencia descriptiva únicamente.
- La mediana de error absoluto en USD (no sensible a esos outliers) es más
  chica y estable: $0.11–$0.16 en los 4 modelos reales, $0.20 en el
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
`ml/training/data/cards.json` local era un scrape parcial viejo (5,000
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

*Última actualización: 2026-08-16 (Stage 3 refrescado post-B6/`edhrec_rank`,
ver nota en esa sección). Datos de Stage 3 leídos directamente de
`ml/training/output/{pytorch,tensorflow}/{price_estimator,optuna_price_estimator}/latest/`
y `ml/data-prep/output/price_baseline/latest/`. Datos de Stage 2 de la corrida
real documentada arriba (H2).*
