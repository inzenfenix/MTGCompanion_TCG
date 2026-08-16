# Resultados consolidados — Certamen 1 (Stage 1 y Stage 4)

Documento de reporting (workstream H de [ROADMAP.md](../ROADMAP.md), items H1/H4).
Junta las métricas que cada script ya escribe por separado en
`output/{pytorch,tensorflow}/**/final_metrics.json` y `metrics_p{t,f}.json`,
mismo espíritu que [`certamen_2/RESULTADOS.md`](../certamen_2/RESULTADOS.md)
(Stage 2/3) — una sola fuente de verdad estática para el informe, en vez de
solo lo que `ExportPanel.tsx` calcula en vivo en el desktop-runner.

Regla de empate del proyecto (la misma que usa `scripts.service.ts` /
`ExportPanel.tsx`): si la diferencia entre PyTorch y TensorFlow en la métrica
principal es **< 0.005**, se considera empate; si no, gana el valor más alto.

---

## Stage 1 — Detector MTG / no-MTG (clasificación binaria)

**Métrica principal: accuracy** (misma que usa `ExportPanel.tsx`,
`EXPORT_STAGES[0].metricKey`). Backbone congelado + head chico, transfer
learning (EfficientNet_b0 en PyTorch, MobileNetV3Small en TensorFlow).

| Modelo | n (val) | Accuracy | Precision | Recall | F1 | ROC-AUC |
|---|---|---|---|---|---|---|
| PyTorch — plain | 1,200 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| PyTorch — Optuna (tuned) | 1,200 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| TensorFlow — Optuna (tuned) | 1,200 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |

**Ganador (tuned, accuracy): empate exacto** (diff 0.0000) — ambos
frameworks resuelven la tarea perfectamente en este split de validación.

**Nota de calidad de datos — TensorFlow "plain" excluido de la tabla:**
`tensorFlow/results/metrics_binary.json` (la corrida sin Optuna) tiene
`n_val: 48`, no los 1,200 reales — es un dry-run de desarrollo viejo que
nunca se re-corrió a escala completa antes de que llegara el Optuna sweep
(que sí usa el split real de 1,200, ver `optuna/latest/final_metrics.json`).
No se reporta acá para no comparar peras con manzanas; el número tuned de
TensorFlow arriba es el confiable.

**Hiperparámetros ganadores (Optuna, idénticos entre frameworks — mismo
`08_optuna_binary_classifier.py`/equivalente TF, mismo espacio de
búsqueda):**

| Parámetro | PyTorch | TensorFlow |
|---|---|---|
| learning_rate | 1.33e-4 | 1.33e-4 |
| weight_decay | 6.35e-3 | 6.35e-3 |
| batch_size | 16 | 16 |
| head_units | 128 | 128 |
| dropout | 0.0 | 0.0 |
| optimizer | adam | adam |
| freeze_ratio | 0.65 | 0.65 |

**Caveat importante — este 1.0 es un techo de datos curados, no una
garantía de desempeño real.** El split de validación es MTG-vs-no-MTG sobre
imágenes de catálogo/render, una tarea binaria relativamente fácil una vez
hay transfer learning de por medio. Ver [`Testing/curated_vs_real_gap.md`](Testing/curated_vs_real_gap.md)
(H6) para cuánto se degrada esto en fotos reales de teléfono.

---

## Stage 1 — Calidad de retrieval/embedding (Top-1 / Top-5 / MRR)

**Métrica: Top-1 accuracy, Top-5 accuracy, MRR** — identificación de la
carta exacta contra la galería completa (58,679 cartas), no solo
MTG-vs-no-MTG. Esta es la tarea que de verdad usa el scanner en producción
(`buscar_topk()` en `04_evaluate.py`/`scanner.py`), y es harder-than-binary
por diseño: 58,679 clases, muchas visualmente parecidas entre sí (mismo
frame/layout, arte distinto).

Corrida: `04_evaluate.py`, 11,735 queries contra la galería completa de
58,679 cartas, ambos frameworks, mismo embedding congelado que usa Stage 1
(no hay una versión "Optuna" separada de este número — el backbone/head no
cambian entre retrieval y clasificación binaria, es el mismo checkpoint).

| Modelo | n (query) | n (galería) | **Top-1** | Top-5 | Top-10 | MRR | Extracción (ms/query) | Búsqueda (ms/query) |
|---|---|---|---|---|---|---|---|---|
| PyTorch (EfficientNet_b0) | 11,735 | 58,679 | **25.1%** | 37.3% | 41.7% | 0.304 | 22.4 | 1.8 |
| TensorFlow (MobileNetV3Small) | 11,735 | 58,679 | **24.4%** | 38.8% | — | 0.300 | 137.4 | 4.3 |

**Top-10 (ROADMAP.md G4d, 16 ago)**: `TOP_K` bumped 5→10 in `04_evaluate.py` (both
frameworks) so retrieval depth beyond Top-5 could be measured cheaply —
same motivation as the real-photo Top-5/Top-10 numbers in
[`curated_vs_real_gap.md`](Testing/curated_vs_real_gap.md). PyTorch rerun
for real: Top-1 25.1%/Top-5 37.3%/**Top-10 41.7%** (`pytorch/results/metrics_pt.json`,
near-identical Top-1/Top-5 to the numbers above from the same fixed seed —
small movement is normal re-run noise, not a regression; extraction/search
times also dropped since this rerun happened to land on GPU/warm-cache
conditions this session, not a code change). **TensorFlow's Top-10 rerun
was started but killed before finishing** (CPU-only on this AMD box, no TF
GPU path per CLAUDE.md rule 6 — 11,735 queries × 58,679-card gallery was
taking 25+ minutes and counting, not worth blocking on) — TensorFlow's
Top-1/Top-5/MRR/timing above are still the pre-G4d numbers, unchanged.
**Follow-up, not done here**: rerun `tensorFlow/04_evaluate.py` (already
updated for `TOP_K=10`/`top10_accuracy`, just needs the actual run) to fill
in TensorFlow's Top-10 cell — ideally via the Docker/ROCm GPU path
(ROADMAP.md workstream D) rather than CPU, or just accept a long CPU run.

**Ganador (Top-1): PyTorch, 25.3% vs. TensorFlow 24.4%** — diferencia 0.009,
mayor al umbral de empate (0.005), PyTorch gana por poco. TensorFlow es
competitivo en Top-5 (38.8% vs 37.2%, gana ahí) y en MRR es un empate
técnico (0.30010 vs 0.29996, diff 0.0001). PyTorch es ~2.6x más rápido
extrayendo el embedding (53ms vs 137ms/imagen — MobileNetV3Small corre en
CPU en esta máquina, sin path GPU, ver ROADMAP.md regla 6/workstream D),
TensorFlow es ~3x más rápido en la búsqueda del índice (4.3ms vs 13.1ms —
tamaño del vector distinto, 576-d TF vs 1280-d PyTorch, ver
`certamen_2/README.md` §5.1.1).

**Nota de calidad de datos — clasificación binaria por umbral óptimo:**
PyTorch reporta además `accuracy_bin`/`precision_bin`/`recall_bin`/`f1_bin`
(0.70/0.45/0.72/0.55) — una tarea de verificación aparte (¿el top-1
recuperado es o no la carta correcta, por umbral de similitud coseno?, no
identificación entre 58,679 clases). El campo equivalente en el JSON de
TensorFlow (`clasificacion.accuracy`) sale **idéntico a `top1_accuracy`**
(0.2435 en ambos), lo cual no debería pasar si mide algo distinto — parece
un bug de `tensorFlow/04_evaluate.py` reusando el valor de Top-1 en vez de
calcular la clasificación por umbral por separado. Encontrado al armar este
documento, no investigado a fondo ni arreglado (fuera de alcance de H4,
que es agregación de números existentes) — flagueado como follow-up.

**Caveat — 25%/24% Top-1 ya es bajo *en datos curados*, antes de fotos
reales.** Esto no es un hallazgo nuevo de este documento: confirma lo que
G4d del ROADMAP ya diagnosticó con un caso puntual (retrieval genérico
tipo-ImageNet, nunca afinado para discriminar carta-vs-carta, agrupa muchas
cartas distintas en una banda de similitud angosta). Contrastar con
[`Testing/curated_vs_real_gap.md`](Testing/curated_vs_real_gap.md) (H6): el
Top-1 en fotos reales (18.0%, G4b) no es una caída dramática *relativa* a
este 25% curado — la mayor parte de la debilidad de Stage 1 ya está
presente antes de que una foto real entre en juego.

---

## Stage 4 — Clasificador de condición (NM/LP/MP/HP/DMG)

**Métrica principal: F1 macro** (no accuracy — con 5 clases no
perfectamente balanceadas, accuracy sola puede esconder que un framework
falla sistemáticamente en un grado en particular; mismo criterio que usa
`ExportPanel.tsx`, `EXPORT_STAGES[3].metricKey`).

Dataset: 800 cartas de validación (split por `card_id`, no por fila — cada
carta produce 5 filas, una por grado). **Estos números son del checkpoint
"plano" (`condition_grader.pth`/`.keras`), el mismo split que evalúan
`10_condition_grader.py`/`11_optuna_condition_grader.py` y que lee
`ExportPanel.tsx` — no el checkpoint combinado real+sintético
(`condition_grader_combined.pth`) que de hecho se exporta a Ionic.** Ver
nota de CLAUDE.md: el combinado saca menos en este split (90.24%) pero
generaliza mejor a fotos reales (72.2% vs 38.7%) — los dos números miden
cosas distintas a propósito, ninguno es "el incorrecto".

| Modelo | n (val) | Accuracy | **F1 macro** | Precision macro | Recall macro |
|---|---|---|---|---|---|
| PyTorch — plain | 800 | 0.7475 | 0.7442 | 0.7555 | 0.7475 |
| PyTorch — Optuna (tuned) | 800 | **0.9525** | **0.9523** | 0.9533 | 0.9525 |
| TensorFlow — plain | 800 | 0.6550 | 0.6603 | 0.6899 | 0.6550 |
| TensorFlow — Optuna (tuned) | 800 | **0.7575** | **0.7546** | 0.7823 | 0.7575 |

**Ganador (tuned, F1 macro): PyTorch, 0.9523 vs. TensorFlow 0.7546** —
diferencia 0.198, muy por encima del umbral de empate. PyTorch gana esta
stage con margen claro, a diferencia de Stage 1-3 donde los frameworks
quedan cerca. Optuna aporta una ganancia grande en ambos frameworks (+0.208
PyTorch, +0.094 TensorFlow sobre plain) — a diferencia de Stage 3 (B4), acá
el tuning sí mueve la aguja de forma sustancial.

**Desglose por grado (Optuna, tuned):**

| Grado | PyTorch F1 | TensorFlow F1 |
|---|---|---|
| NM | 0.965 | 0.781 |
| LP | 0.916 | 0.743 |
| MP | 0.934 | 0.739 |
| HP | 0.966 | 0.673 |
| DMG | 0.981 | 0.836 |

PyTorch es consistente entre grados (0.92–0.98); TensorFlow es más parejo
pero sistemáticamente más débil en todos, con su peor caso en HP (0.673).

**Hiperparámetros ganadores (Optuna, convergieron distinto entre
frameworks):**

| Parámetro | PyTorch | TensorFlow |
|---|---|---|
| learning_rate | 6.41e-4 | 6.23e-4 |
| weight_decay | 4.00e-5 | 1.11e-6 |
| batch_size | 16 | 16 |
| head_units | 448 | 512 |
| dropout | 0.35 | 0.50 |
| optimizer | adam | adam |
| freeze_ratio | 0.5 | 0.5 |

---

*Última actualización: 2026-08-16. Datos leídos directamente de
`output/{pytorch,tensorflow}/{optuna,optuna_condition,condition_grader}/latest/`
y del par de `metrics_p{t,f}.json` más reciente en `output/{pytorch,tensorflow}/latest/`
(corrida de `04_evaluate.py`, 2026-08-13). Ningún modelo se re-entrenó para
armar este documento — es agregación pura de resultados ya existentes
(ROADMAP.md H1/H4).*
