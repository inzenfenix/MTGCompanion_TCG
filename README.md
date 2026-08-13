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
    ├── certamen_2/  # entrega 2 — pipeline de 3 etapas (WIP, ver README propio)
    └── examen/      # entrega final — plan (WIP)

trading-app-ionic/   # frontend Ionic React de la app final (scaffold construido, sin conectar a los modelos todavía)
backend/             # API NestJS + Prisma + PostgreSQL — cuentas, cartas, transacciones (ver README propio)
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

- **Certamen 2** — pipeline de tres etapas encadenadas (detector MTG/no-MTG →
  validador de texto/OCR → estimador de precio por regresión), cada una
  entrenada en ambos frameworks (6 modelos en total) y con Optuna para
  hiperparámetros — la entrega de Optuna sobre el detector ya está hecha. Ver
  [Proyecto/certamen_2/README.md](Proyecto/certamen_2/README.md).
- **Examen** — empaquetar todo como la app Ionic de uso comercial en
  [`trading-app-ionic/`](trading-app-ionic/README.md) (scaffold ya construido),
  conectada vía OpenCV.js + ONNX (`onnxruntime-web`) corriendo del lado del
  cliente — el modelo ganador de cada etapa, sin importar el framework. La
  persistencia (cuentas, cartas, transacciones) corre en un backend NestJS
  aparte, ver [`backend/`](backend/README.md). Ver
  [Proyecto/examen/README.md](Proyecto/examen/README.md).
- **Automatización del entrenamiento** — un integrante del equipo está
  construyendo una app Electron que envuelve los scripts Python (scraper,
  downloader, embedders, clasificadores, Optuna) para correr todo el pipeline
  sin terminal.

### Stack

- **PyTorch** — `torch`, `torchvision` (EfficientNet_b0)
- **TensorFlow** — `tensorflow`/Keras (MobileNetV2 hoy, migrando a MobileNetV3
  en Certamen 2)
- **Optuna** — tuning de hiperparámetros de los modelos de ambos frameworks
- **OpenCV** — recorte/perspectiva/normalización de la carta antes de cada modelo
- **ONNX** / `onnxruntime-web` — formato de exportación común para correr el
  modelo ganador de cada etapa (PyTorch o TensorFlow) del lado del cliente
- **Ionic React** — frontend de la app final (`trading-app-ionic/`)
- **NestJS + Prisma + PostgreSQL** — backend de la app final (`backend/`):
  cuentas, cartas, transacciones
- **Scryfall API** — catálogo, imágenes, texto de reglas y precios de cartas MTG
- **pokemontcg.io** — imágenes negativas para el clasificador binario
- Python científico: `numpy`, `scikit-learn`, `matplotlib`, `Pillow`

## Entregas

| Entrega | Estado | Enlace |
|---|---|---|
| Certamen 1 | ✅ | [Proyecto/certamen_1/README.md](Proyecto/certamen_1/README.md) |
| Certamen 2 | 🚧 plan | [Proyecto/certamen_2/README.md](Proyecto/certamen_2/README.md) |
| Examen | 🚧 plan | [Proyecto/examen/README.md](Proyecto/examen/README.md) |

## Aplicación Frontend (Ionic)

La interfaz comercial del escáner de cartas se está construyendo actualmente con Ionic React. 
- Puedes encontrar su código, estado de avance, y las **instrucciones de despliegue** en su respectiva carpeta.
- ➡️ **[Ir al README de la aplicación Ionic](trading-app-ionic/README.md)**

## Backend (NestJS + Prisma + PostgreSQL)

La persistencia de la app final (cuentas de usuario, cartas de la colección
con sus fotos, transacciones de compra/venta) vive en un backend NestJS
separado, con Postgres y object storage S3-compatible levantados vía Docker
solo para desarrollo local (el backend en sí no corre en Docker).
- ➡️ **[Ir al README del backend](backend/README.md)** — instrucciones de
  despliegue, arquitectura por capas (domain/application/infrastructure/
  presentation) y qué falta a propósito (login/JWT, 2FA, MercadoPago real).

## Automatización del pipeline (Electron)

La creación de los modelos (scraping, embeddings, entrenamiento, Optuna) se está
empaquetando en una app Electron aparte para no depender de la terminal.
- ➡️ **[Contrato de integración para la app Electron](PIPELINE_INTEGRATION.md)**
  — inventario de scripts, venvs, argumentos y convenciones de salida.
