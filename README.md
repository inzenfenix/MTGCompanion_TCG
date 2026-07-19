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
    ├── certamen_2/  # entrega 2 — plan (WIP)
    └── examen/      # entrega final — plan (WIP)
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

- **Certamen 2** — flujo de dos modelos nuevos: un validador de texto/OCR que
  confirma la carta identificada (basado en `Material/detector_palabras.py`) y
  un estimador de precio de mercado por regresión. Ver
  [Proyecto/certamen_2/README.md](Proyecto/certamen_2/README.md).
- **Examen** — empaquetar todo como una app Ionic de uso comercial (OpenCV.js +
  TensorFlow.js corriendo del lado del cliente). Ver
  [Proyecto/examen/README.md](Proyecto/examen/README.md).

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
| Certamen 2 | 🚧 plan | [Proyecto/certamen_2/README.md](Proyecto/certamen_2/README.md) |
| Examen | 🚧 plan | [Proyecto/examen/README.md](Proyecto/examen/README.md) |
