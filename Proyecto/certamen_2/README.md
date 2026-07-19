# MTG Card Scanner — Certamen 2 (plan)

> 🚧 Planeación — todavía no implementado. Este documento es la base para arrancar
> la entrega 2: qué problema resolvemos, qué modelos nuevos hacen falta y qué
> datos necesitan.

## Consigna

> "Para la siguiente entrega deben agregar dos modelos que funcionen en un flujo
> de trabajo para resolver un problema." — feedback del profesor sobre Certamen 1.

Certamen 1 ya identifica una carta a partir de una foto (detector MTG/no-MTG +
retrieval por similitud visual). Certamen 2 extiende ese resultado con **dos
modelos nuevos, encadenados**, para resolver un problema de punta a punta:

> Dada una foto de una carta, identificarla con confianza y estimar su precio
> de mercado.

## Flujo de modelos propuesto

```
foto ─▶ [Certamen 1: detector MTG/no-MTG + retrieval visual] ─▶ carta candidata + similitud
                                                                        │
                                                                        ▼
                                        [Modelo nuevo 1: validador de texto/OCR]
                                        lee el nombre/texto de reglas de la carta y
                                        confirma o descarta la carta candidata
                                                                        │
                                                                        ▼
                                        [Modelo nuevo 2: estimador de precio (regresión)]
                                        predice el precio de mercado a partir de la
                                        metadata de la carta ya confirmada
                                                                        │
                                                                        ▼
                                        carta identificada + precio estimado (USD)
```

### Modelo nuevo 1 — Validador de texto (clasificación)

Motivación: la similitud visual sola puede confundir cartas con la misma
ilustración pero distinta edición/versión (reprints), o fallar con fotos de
mala calidad. El texto impreso en la carta (nombre, tipo, texto de reglas) es
una señal independiente de la visual.

Pipeline:
1. OCR sobre la región de texto de la carta (`pytesseract` / `easyocr` —
   herramienta, no modelo propio).
2. Modelo propio: clasificador de palabras entrenado por nosotros —
   arquitectura Bag-of-Words → Red Feedforward, basada en
   [`Material/detector_palabras.py`](../../Material/detector_palabras.py) —
   que compara el texto leído contra el de la carta candidata y da un score de
   confirmación (¿es texto consistente con esa carta o no?).

Dataset: `oracle_text` y `name` ya están en `data/cards.json` (vía Scryfall) —
no hace falta scrapear nada nuevo para el texto de referencia. Los negativos
pueden salir de texto de otras cartas o de las imágenes Pokémon ya descargadas
(`data/images_negatives/`).

### Modelo nuevo 2 — Estimador de precio (regresión)

Motivación: da valor comercial concreto a la identificación (ver plan del
examen) — no solo "qué carta es", sino "cuánto vale hoy".

Entrada: metadata de la carta ya confirmada (rareza, set, `cmc`, colores,
`type_line`, antigüedad/`released_at`, `set_type`).
Salida: precio estimado en USD (regresión).

Dataset: Scryfall expone un campo `prices` (`usd`, `usd_foil`, `eur`, `tix`) en
el mismo bulk data que ya usa `01_scraper.py` — solo falta agregarlo a la lista
`CAMPOS`. No hace falta series históricas de precio, un snapshot actual alcanza
para un regresor de referencia (random forest / gradient boosting a modo de
baseline, con la opción de un MLP simple después).

## Qué falta para arrancar

- [ ] Agregar `prices` a `CAMPOS` en `01_scraper.py` y re-scrapear (o hacer un
      pase incremental sobre `data/cards.json` existente).
- [ ] Script de entrenamiento del validador de texto (nombre tentativo:
      `08_text_validator.py`).
- [ ] Script de entrenamiento del estimador de precio (nombre tentativo:
      `09_price_estimator.py`).
- [ ] Extender `scanner.py` (o `Testing/compare_scanners.py`) para exponer el
      flujo completo: foto → carta + confianza → validación de texto → precio.
- [ ] Métricas a reportar: accuracy del validador de texto; MAE / RMSE / R² del
      estimador de precio sobre un hold-out.

## Por qué este enfoque

Se descartaron dos alternativas más simples (ver discusión en el chat del
proyecto):
- **Detector de daño/condición de la carta** — encaja con un ángulo comercial
  de tasación, pero requiere un dataset etiquetado a mano desde cero (mint /
  played / damaged) que no tenemos.
- **Solo estimador de precio** (sin el validador de texto) — es un flujo de un
  solo modelo nuevo, no dos, y no ataca el problema real de identificación
  ambigua que puede tener el sistema de Certamen 1.

Combinar validador de texto + estimador de precio da dos modelos genuinamente
encadenados (la salida de uno es prerequisito del otro) resolviendo un problema
concreto, y deja el terreno preparado para el ángulo comercial del examen.
