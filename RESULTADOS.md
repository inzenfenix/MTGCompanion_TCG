# Resultados consolidados — PyTorch vs. TensorFlow, las 4 stages

Documento de reporting (workstream H de [ROADMAP.md](ROADMAP.md), item H5).
Tabla ganador-por-stage, mismo criterio y las mismas fuentes que
`ExportPanel.tsx`/`scripts.config.ts` (`EXPORT_STAGES`) del desktop-runner
calculan en vivo — acá como documento estático para el informe. Detalle
completo por stage (hiperparámetros, desglose por clase, notas de calidad
de dato) en:

- [`Proyecto/certamen_1/RESULTADOS.md`](Proyecto/certamen_1/RESULTADOS.md) — Stage 1 (detector + retrieval) y Stage 4 (condición)
- [`Proyecto/certamen_2/RESULTADOS.md`](Proyecto/certamen_2/RESULTADOS.md) — Stage 2 (validador de texto) y Stage 3 (precio)
- [`Proyecto/certamen_1/Testing/curated_vs_real_gap.md`](Proyecto/certamen_1/Testing/curated_vs_real_gap.md) — datos curados vs. fotos reales (H6)

Regla de empate del proyecto (la misma que usa `scripts.service.ts` /
`ExportPanel.tsx`): si la diferencia entre PyTorch y TensorFlow en la
métrica principal es **< 0.005**, se considera empate; si no, gana el valor
más alto.

---

## Tabla ganador por stage

| Stage | Métrica principal | PyTorch | TensorFlow | Diferencia | **Ganador** |
|---|---|---|---|---|---|
| 1 — Detector MTG/no-MTG | Accuracy (binaria) | 1.0000 | 1.0000 | 0.0000 | **Empate** |
| 1 — Retrieval (Top-1, referencia) | Top-1 accuracy (58,679 clases) | 0.2528 | 0.2435 | 0.0093 | **PyTorch** (por poco) |
| 2 — Validador de texto (OCR match) | ROC-AUC | 0.9906 | 0.9886 | 0.0020 | **Empate** |
| 3 — Estimador de precio | R² (log-USD) | 0.6585 | 0.6491 | 0.0094 | **PyTorch** |
| 4 — Clasificador de condición | F1 macro | 0.9523 | 0.7546 | 0.1977 | **PyTorch** (con margen grande) |

**Nota sobre la fila de Stage 1:** `ExportPanel.tsx`/`EXPORT_STAGES` solo
compara la accuracy binaria (empate exacto, tarea fácil una vez hay
transfer learning). La fila de retrieval Top-1 no forma parte de esa
comparación en vivo — se agrega acá como referencia porque es la métrica
que de verdad importa para el uso real del scanner (identificar *cuál*
carta, no solo *si* es una carta) y es la que motivó H4/H6. Ver
`Proyecto/certamen_1/RESULTADOS.md` para el desglose completo (Top-5, MRR,
velocidad).

## Resumen — 3 de 5 filas para PyTorch, 2 empates, 0 para TensorFlow en solitario

- **PyTorch gana o empata en las 5 métricas comparadas**, con el margen más
  grande en Stage 4 (condición) y márgenes chicos en Stage 1-retrieval y
  Stage 3. TensorFlow nunca gana en solitario ninguna stage con este
  criterio, pero está cerca en todas salvo Stage 4.
- **Stage 4 es la única stage con una brecha grande** (0.198 en F1 macro) —
  no es un artefacto de tuning: TensorFlow es sistemáticamente más débil en
  las 5 clases de condición, con su peor caso en HP (F1 0.673 vs. 0.966 de
  PyTorch). Ver `Proyecto/certamen_1/RESULTADOS.md` para el desglose
  completo por grado.
- **Stage 1 y 2 son empates técnicos** por la regla del proyecto (diff <
  0.005) — ambos frameworks llegan a arquitecturas Optuna distintas
  (diferente `hidden_units`/`dropout`/optimizer) que convergen a
  prácticamente el mismo poder discriminativo.
- **Ningún resultado curado debería leerse como el desempeño real del
  scanner** — ver `curated_vs_real_gap.md` (H6): Stage 1 retrieval ya es
  débil en datos curados (25%) y Stage 4 colapsa de 95.25% a 38.7% en fotos
  reales con el checkpoint equivocado (72.2% con el correcto). La
  comparación PyTorch-vs-TensorFlow de esta tabla sigue siendo válida (mismo
  gap relativo aplica a ambos frameworks), pero los valores absolutos no
  son una promesa de accuracy en producción.

---

*Última actualización: 2026-08-16. Ningún modelo se re-entrenó para armar
este documento — agregación pura de resultados ya existentes en
`Proyecto/certamen_1/output/` y `Proyecto/certamen_1/output/{pytorch,tensorflow}/optuna_*`
(ROADMAP.md H5, depende de H1–H4, todos ya completos).*
