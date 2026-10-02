# G4 — Chequeo end-to-end sobre fotos reales (Squirreled Away, Bloomburrow)

Fotos procesadas: 122  |  con error: 0  |  OK: 122

## Stage 1 — Identificación (¿el nombre predicho está en el decklist?)

- Top-1 en decklist:  22/122 (18.0%)
- Top-5 en decklist:  35/122 (28.7%)
- Top-10 en decklist: 40/122 (32.8%)
- **Caveat**: esto es membership contra el decklist de 100 cartas (+ tokens conocidos), no un ground truth foto-por-foto — una predicción puede estar en el decklist "por casualidad" si el modelo confunde una carta del mazo por otra del mismo mazo. No hay etiqueta exacta por foto (ver squirreled_away_decklist.json).
- **Top-5/Top-10 (ROADMAP.md G4d)**: mide si el candidato correcto ya aparece más abajo en el ranking de similitud coseno aunque no gane el top-1 — el caso "Insatiable Frugivore" documentado en G4d (rank real #54/58,679, top-1 equivocado por un margen chico) es exactamente lo que esto debería capturar. Si Top-5/Top-10 suben bastante más que Top-1, la retrieval no está "rota", solo necesita más candidatos para confirmar (una UX de "elegí entre estos 5" en vez de confiar ciegamente en el top-1) — si casi no suben, el problema es más profundo (embedding no discriminativo, G4d).

## Stage 2 — Validación de texto (modelo real, TextMatcher)

- Tasa de confirmación: 27/122 (22.1%)
- Una confirmación baja acá no es necesariamente un fallo de Stage 2 — Stage 2 confirma/rechaza contra la carta que **Stage 1** identificó; si Stage 1 se equivocó, lo correcto es que Stage 2 rechace (ver docstring de full_pipeline_demo.py).

## Stage 4 — Distribución de condición (sin ground truth — descriptivo)

- NM: 19
- LP: 10
- MP: 88
- HP: 5
- DMG: 0

## Stage 3 — Precio estimado vs. referencia de catálogo (Scryfall NM)

- MAE (USD): 2.17  (n=114)
- Mediana AE (USD): 0.18
- La referencia es el precio de catálogo (near-mint) de la carta que Stage 1 matcheó, no el precio real de la foto física — anclaje aproximado, no un ground truth de precio por fotografía.

