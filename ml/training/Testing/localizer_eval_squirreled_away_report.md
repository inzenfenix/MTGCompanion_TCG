# I33 — localizer_eval sobre `../data/real_photos`

Fotos procesadas: 122  |  con error de lectura: 0  |  OK: 122

## tasa de acierto (find-rate)

- **122/122 (100.0%)** fotos con un candidato encontrado.
- Esto mide si `localizar_carta()` devolvió ALGÚN candidato con forma de carta — no si las esquinas son geométricamente correctas (sin ground truth de esquinas para este set, ver docstring del script).
- Aspect ratio de los candidatos encontrados: min 0.662, max 0.763, ideal 0.716.
- Tiempo promedio por foto: 254.3ms.
