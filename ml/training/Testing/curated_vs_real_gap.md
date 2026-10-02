# Datos curados vs. fotos reales — el gap por stage

Documento de reporting (workstream H de [ROADMAP.md](../../../ROADMAP.md), item
H6). Formaliza algo ya observado de forma anecdótica durante el proyecto:
las métricas de validación/Optuna se miden sobre datos curados (renders de
catálogo, crops sintéticos, wear sintético) y son sistemáticamente más
optimistas que lo que el pipeline logra sobre una foto de teléfono real,
tomada en condiciones no controladas. Compara directamente los números de
[`../RESULTADOS.md`](../RESULTADOS.md) (H1/H4, datos curados) contra el
chequeo end-to-end de 122 fotos reales (`real_photo_eval_report.md`, G4/G4a/G4b).

**Set de fotos reales**: 122 fotos físicas de un mazo Commander real
("Squirreled Away", Bloomburrow), tomadas con teléfono en condiciones
normales (mesa, fondo de tela, luz ambiente) — no renders, no sintéticas.
Ground truth: decklist conocido de 100 cartas + tokens.

---

## Resumen — el gap por stage

| Stage | Métrica curada | Valor curado | Métrica real-foto | Valor real-foto (pre-G4b) | Valor real-foto (post-G4b) | Caída |
|---|---|---|---|---|---|---|
| 1 — Retrieval (Top-1) | Top-1 sobre galería completa | 24–25% | Nombre predicho ∈ decklist | 0.0% | **18.0%** | curado ya bajo; foto real cae aún más |
| 2 — Text validator | ROC-AUC / accuracy en umbral | 0.96–0.99 / ~0.96 | Tasa de confirmación | 15.6% | **22.1%** | grande, pero en cascada de Stage 1 (ver nota) |
| 3 — Price estimator | R² (log-USD) | 0.44 (PyTorch) | MAE / mediana AE (USD) | $2.72 / $0.43 | **$2.18 / $0.26** | métrica distinta, no comparable directo (ver nota) |
| 4 — Condition grader | Accuracy en su propio split | 95.25% (plain) / 90.24% (combinado) | Accuracy en fotos reales | — | **38.7% (plain) / 72.2% (combinado)** | grande, y depende mucho de qué checkpoint |

**Conclusión headline**: el gap más grande y mejor cuantificado es **Stage
4** (95.25% → 38.7% con el checkpoint equivocado, un colapso de 56.6 puntos)
— y la causa no es "los datos reales son difíciles" en abstracto, es que el
checkpoint plano nunca vio wear real durante el entrenamiento (solo
sintético) y no generaliza. El fix (checkpoint combinado real+sintético)
recupera la mayor parte del gap (72.2%, todavía 18 puntos por debajo de su
propio split, pero un colapso mucho menor). **Stage 1** tiene el patrón más
importante para el diagnóstico general: ya está débil en datos curados
(24–25% Top-1 sobre la galería completa, ver H4) — la foto real no
introduce un problema nuevo, expone uno que ya existía (ver G4d del
ROADMAP).

---

## Stage 1 — Detector + Retrieval

**Curado**: 100.0% accuracy binaria MTG/no-MTG (tarea fácil, ver
`../RESULTADOS.md`); pero el número que de verdad importa para el scanner
es retrieval sobre las 58,679 cartas del catálogo — ahí el curado ya es
débil, **24.4–25.3% Top-1**, 37–39% Top-5 (H4).

**Real-foto**: 0.0% → 18.0% (pre/post-G4b). La localización/crop de la
carta (`localizar_carta()`) fallaba en el 70% de las fotos reales antes de
G4b (Otsu por brillo no distingue el borde de la carta de un fondo rojo
saturado — poco contraste de *luminancia* aunque el contraste de color sea
obvio); el fix (Otsu por saturación) llevó la tasa de localización exitosa
de 30% a 100% medido sobre las mismas 122 fotos. Post-fix, Stage 1 pasa de
"no funciona en absoluto" (0%) a "funciona a veces" (18%) — una mejora real
pero no un problema resuelto.

**Cómo se relacionan los dos números**: el 18.0% real-foto **no es una
caída dramática relativa al 24–25% curado** una vez que la carta está bien
recortada — son del mismo orden de magnitud. Esto es evidencia directa a
favor del diagnóstico de G4d (ROADMAP): el techo real no es "curado vs.
foto real", es que el embedding (transfer learning genérico, nunca afinado
para *esta* tarea de discriminación carta-vs-carta) agrupa demasiadas
cartas visualmente parecidas en una banda de similitud angosta — un caso
puntual documentado en G4d tiene la carta correcta en el puesto #54/58,679
por similitud coseno, no fuera del índice ni con un score bajo en
términos absolutos (0.83 vs. 0.86 del top-1 incorrecto). El "gap
curado-vs-real" en Stage 1 es real pero secundario frente a este problema
de discriminación del embedding, que afecta a *ambos* regímenes.

---

## Stage 2 — Text validator (OCR match)

**Curado**: ROC-AUC 0.96–0.99 sobre pares OCR-vs-referencia generados a
partir de descargas de catálogo (foto de referencia limpia, no una foto de
producto físico), ver `../../data-prep/RESULTADOS.md`.

**Real-foto**: tasa de confirmación 15.6% → 22.1% (pre/post-G4b, mismo fix
de localización + la corrección de orientación nueva que trajo G4b —
`orientation_fix.py`, ~32% de las 122 fotos estaban rotadas 90°/180° y
antes se les hacía OCR tal cual).

**Caveat de lectura, ya documentado en `real_photo_eval_report.md`**: esta
tasa de confirmación *no* es una medida aislada de Stage 2 — Stage 2 vota
"sí/no" sobre la carta que **Stage 1** identificó como top-1. Si Stage 1 se
equivocó (82% de las veces, ver arriba), lo *correcto* es que Stage 2
rechace esa comparación — un rechazo ahí no es un fallo de Stage 2, es la
cascada funcionando como debería. Dicho de otra forma: 22.1% de
confirmación con un Stage 1 al 18% de acierto es consistente con un Stage 2
que funciona razonablemente bien *dado el input que recibe* — el número no
es comparable 1:1 contra el ROC-AUC curado (que evalúa a Stage 2 de forma
aislada, con la comparación correcta garantizada por construcción del
dataset).

---

## Stage 3 — Price estimator

**Curado**: R² (log-USD) 0.44 (PyTorch, tuned) — evaluado contra el precio
de catálogo de la carta correcta, con split held-out por `card_id`.

**Real-foto**: MAE $2.72 → $2.18, mediana AE $0.43 → $0.26 (pre/post-G4b).
No hay un R² real-foto reportado (el set de 122 fotos es de un solo mazo,
rango de precio angosto — R² no es una métrica informativa en un sample así
de chico y sesgado); el `real_photo_eval_report.md` reporta MAE/mediana en
su lugar.

**Caveat de lectura**: la "referencia" en el chequeo real-foto es el precio
de catálogo (near-mint) de la carta que **Stage 1** matcheó — no el precio
real de la foto física, y depende de que Stage 1 haya acertado la carta.
Con Stage 1 al 18%, la mayoría de estas comparaciones son "¿el precio
estimado se parece al precio de una carta *distinta* a la fotografiada?" —
que el error siga siendo bajo (mediana $0.26) dice más sobre lo comprimida
que está la distribución de precios de MTG (la mayoría de las cartas valen
centavos, ver H3 en `ml/data-prep/RESULTADOS.md`) que sobre la precisión real
de Stage 3 en esta prueba. No es comparable 1:1 contra el R²=0.44 curado,
que sí garantiza la carta correcta por construcción.

---

## Stage 4 — Condition grader

**Este es el gap más limpio y mejor documentado del proyecto** (ya escrito
en CLAUDE.md, repetido acá para el consolidado H6):

| Checkpoint | Accuracy en su propio split | Accuracy en fotos reales |
|---|---|---|
| `condition_grader.pth` (plano, solo sintético) | **95.25%** | **38.7%** |
| `condition_grader_combined.pth` (real+sintético) | 90.24% | **72.2%** |

El checkpoint plano nunca vio wear real durante entrenamiento — solo
`synthetic_wear.py` (transformaciones sintéticas de desgaste sobre renders
limpios). Generaliza perfecto a más wear sintético (95.25%) y colapsa en
fotos reales (38.7%, casi al nivel de azar entre 5 clases). El fix no es
más tuning — es agregar datos reales al entrenamiento (`12_condition_grader_combined.py`,
dataset Roboflow de fotos reales etiquetadas). El checkpoint combinado paga
un costo chico en su propio split (90.24% vs 95.25%, -5 puntos) a cambio de
+33.5 puntos en fotos reales — un trade-off claramente favorable, y la
razón por la que `predict_condition.py` y el export a Ionic (`09_export_onnx.py`
usa el plano para Stage 1, pero Stage 4's export usa el combinado
específicamente) cargan el combinado, no el plano.

TensorFlow no tiene un checkpoint combinado equivalente (ROADMAP.md, item
C6 lo señala) — no hay un número real-foto de TensorFlow para Stage 4 con
el que comparar este trade-off del lado TF.

---

## Qué dice esto para el reporte del curso

1. **El gap "curado vs. real" no es uniforme entre stages.** Es enorme y
   bien entendido en Stage 4 (mismatch de distribución de entrenamiento,
   fix conocido y aplicado). Es chico/inexistente en Stage 1 una vez que se
   controla por el problema real (discriminación del embedding, no
   curado-vs-real). En Stage 2/3 el número real-foto está *acoplado* al
   acierto de Stage 1 — no se puede leer como una medida aislada de esas
   stages.
2. **La localización/orientación (G4b) fue la intervención de mayor
   impacto por esfuerzo** de todo el pipeline real-foto: pasar de 30% a
   100% de localización exitosa movió los tres stages downstream de una
   vez (Stage 1 0%→18%, Stage 2 15.6%→22.1%, Stage 3 MAE $2.72→$2.18) sin
   tocar ningún modelo.
3. **El próximo mayor cuello de botella ya está identificado y no es un
   problema de datos curados-vs-reales**: es G4d (ROADMAP) — el embedding
   de Stage 1 no discrimina bien entre cartas visualmente parecidas, un
   problema presente incluso en datos curados (24–25% Top-1). Cerrar ese
   gap (fine-tuning contrastivo, o re-rankear con el texto de Stage 2)
   tendría más impacto en el pipeline real que seguir puliendo
   localización/crop.

---

*Última actualización: 2026-08-16. Fuentes: `../RESULTADOS.md` (H1/H4,
datos curados), `../../data-prep/RESULTADOS.md` (Stage 2/3 curado),
`real_photo_eval_report.md` (G4, post-G4b), ROADMAP.md filas G4/G4a/G4b/G4d,
CLAUDE.md (tabla del pipeline, nota del checkpoint combinado de Stage 4). No
se corrió ningún modelo nuevo para este documento — es síntesis de
resultados ya existentes.*
