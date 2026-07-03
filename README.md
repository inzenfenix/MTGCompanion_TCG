# Framework IA — UDD

Repositorio del curso **Frameworks de IA** (UDD): laboratorios, material de clase
y el proyecto del curso, evaluado en tres entregas (Certamen 1, Certamen 2, Examen).

## Estructura del repositorio

```
framework-ia-UDD/
├── Labs/          # laboratorios de curso (notebooks PyTorch / TensorFlow)
├── Material/      # material y scripts de referencia entregados en clase
└── Proyecto/      # proyecto del curso
    ├── certamen_1/  # entrega 1 — ver README propio
    ├── certamen_2/  # entrega 2 — WIP
    └── examen/      # entrega final — WIP
```

## El proyecto

**MTG Card Scanner**: reconocimiento de cartas de *Magic: The Gathering* a partir
de una foto. La idea central es comparar dos frameworks de deep learning
(PyTorch y TensorFlow) resolviendo el mismo problema sobre el mismo dataset, para
entender en la práctica sus diferencias de diseño, rendimiento y ergonomía.

### Casos de uso actuales (Certamen 1)

- **Identificación de cartas**: dada una foto, extraer un embedding visual
  (EfficientNet_b0 en PyTorch, MobileNetV2 en TensorFlow) y recuperar por
  similitud coseno la carta más parecida dentro del catálogo de Scryfall.
- **Detector MTG / no-MTG**: clasificador binario que filtra si una imagen
  corresponde a una carta de Magic antes de intentar identificarla (entrenado
  con cartas de Pokémon como ejemplos negativos).
- **Comparación entre frameworks**: herramientas para correr ambos scanners
  sobre las mismas imágenes y ver lado a lado cómo reacciona cada modelo.

### Próximos pasos

- **Detector de palabras / texto en la carta**: usar el texto impreso (nombre,
  tipo, texto de reglas) como señal adicional o alternativa a la similitud
  visual pura — hay una base de esto en `Material/detector_palabras.py`.
- Otras ideas en evaluación a medida que avanza el curso (Certamen 2 / Examen).

### Stack

- **PyTorch** — `torch`, `torchvision` (EfficientNet_b0)
- **TensorFlow** — `tensorflow`/Keras (MobileNetV2)
- **Scryfall API** — catálogo e imágenes de cartas MTG
- **pokemontcg.io** — imágenes negativas para el clasificador binario
- Python científico: `numpy`, `scikit-learn`, `matplotlib`, `Pillow`

## Entregas

| Entrega | Estado | Enlace |
|---|---|---|
| Certamen 1 | ✅ | [Proyecto/certamen_1/README.md](Proyecto/certamen_1/README.md) |
| Certamen 2 | 🚧 WIP | — |
| Examen | 🚧 WIP | — |
