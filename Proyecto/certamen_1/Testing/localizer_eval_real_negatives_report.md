# I33 — localizer_eval sobre `../data/images_negatives/real_negatives`

Fotos procesadas: 81  |  con error de lectura: 0  |  OK: 81

## tasa de acierto (find-rate)

- **38/81 (46.9%)** fotos con un candidato encontrado.
- Esto mide si `localizar_carta()` devolvió ALGÚN candidato con forma de carta — no si las esquinas son geométricamente correctas (sin ground truth de esquinas para este set, ver docstring del script).
- Aspect ratio de los candidatos encontrados: min 0.536, max 0.896, ideal 0.716.
- Tiempo promedio por foto: 81.0ms.
