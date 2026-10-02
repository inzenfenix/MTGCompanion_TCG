# MTGCompanion_TCG

**MTG Companion** — escáner de cartas de *Magic: The Gathering* con inferencia
100% en el dispositivo (4 modelos ONNX: detector, validador de texto/OCR,
estimador de precio, clasificador de condición) más un marketplace para
compra/venta/intercambio de cartas. Nació como el proyecto del curso
**Frameworks de IA** (UDD); cada modelo se entrena dos veces, en PyTorch y en
TensorFlow, para comparar ambos frameworks y publicar el ganador por etapa.

## Estructura del repositorio

```
MTGCompanion_TCG/
├── ml/                     # todo lo relacionado a modelos
│   ├── training/           # scraper/downloaders + entrenamiento/Optuna/export ONNX de los 4 stages
│   │   ├── pytorch/        #   implementación PyTorch
│   │   ├── tensorFlow/     #   implementación TensorFlow/Keras
│   │   └── Testing/        #   evaluación sobre fotos reales, comparación de scanners
│   └── data-prep/          # preparación de datasets (OCR, precio, condición), helpers OpenCV, baselines sklearn
├── apps/
│   ├── mobile/             # app Ionic React + Capacitor — inferencia ONNX en el cliente
│   ├── backend/            # API NestJS + Prisma + PostgreSQL — cuentas, cartas, transacciones, marketplace
│   └── desktop-runner/     # app Electron — GUI para entrenar/exportar modelos y desplegar a AWS
├── infra/terraform/        # infraestructura AWS (Terraform)
├── docs/                   # arquitectura, contexto para agentes (docs/context), seguridad, resultados
├── coursework/             # material original del curso (labs, material de clase, guía del examen) — archivo
├── ROADMAP.md              # backlog por workstream
└── CLAUDE.md               # memoria del proyecto / convenciones
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
  [ml/data-prep/README.md](ml/data-prep/README.md).
- **Examen** — empaquetar todo como la app Ionic de uso comercial en
  [`apps/mobile/`](apps/mobile/README.md). La persistencia
  (cuentas, cartas con fotos, transacciones) ya está conectada a un backend
  NestJS real, ver [`apps/backend/`](apps/backend/README.md). El escaneo de cartas
  tiene su scaffold de cliente listo — cámara en vivo
  (`getUserMedia`+canvas) y `onnxruntime-web` corriendo Stage 1
  (detector MTG/no-MTG) — pero **sin ningún modelo `.onnx` entrenado
  todavía**: falta correr el export de PyTorch/TensorFlow (Certamen 2) y
  conectarlo. Ver [apps/README.md](apps/README.md).
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
- **Ionic React** — frontend de la app final (`apps/mobile/`)
- **NestJS + Prisma + PostgreSQL** — backend de la app final (`apps/backend/`):
  cuentas, cartas, transacciones
- **Scryfall API** — catálogo, imágenes, texto de reglas y precios de cartas MTG
- **pokemontcg.io** — imágenes negativas para el clasificador binario
- Python científico: `numpy`, `scikit-learn`, `matplotlib`, `Pillow`

### Requisitos del sistema

Además de las dependencias de Python (`requirements.txt` por entorno), el
pipeline de Stage 2 (`ml/data-prep/prepare_text_validator_dataset.py`, vía
`text_validator_baseline.py`) necesita el binario **`tesseract`** (OCR)
instalado a nivel de sistema — no es un paquete de pip:

```bash
sudo dnf install tesseract        # Fedora (esta máquina de desarrollo)
sudo apt install tesseract-ocr    # Debian/Ubuntu
```

Sin esto, `prepare_text_validator_dataset.py` falla al arrancar. El resto
del pipeline (Stage 1/3/4) no lo necesita.

Para compilar el **APK Android** de `apps/mobile/` (Capacitor) hace
falta además, a nivel de sistema (nada de esto es un paquete npm):

- **JDK 17–21** (el proyecto usa AGP 8.13.0 / Gradle 8.14.3, que no soportan
  JDKs más nuevos como el 25). Dos formas de conseguirlo, cualquiera sirve:
  - `sudo dnf install java-21-openjdk-devel` (Fedora/Nobara) /
    `sudo apt install openjdk-21-jdk` (Debian/Ubuntu) — necesita sudo. En esta
    máquina de desarrollo `dnf` reporta "Nothing to do" para este paquete
    puntual sin instalarlo (bug de `dnf`/repos no resuelto, no algo del
    proyecto) — si te pasa lo mismo, usa la alternativa siguiente.
  - Sin sudo: descargar un JDK 21 portable (p.ej. [Eclipse Temurin](https://adoptium.net/temurin/releases/?version=21))
    y apuntar `JAVA_HOME` a la carpeta descomprimida.
- **Android SDK** (cmdline-tools + `platform-tools` + `platforms;android-36` +
  `build-tools;36.0.0`, la versión de `compileSdkVersion`/`targetSdkVersion`
  que trae el proyecto). No requiere instalar Android Studio completo ni
  sudo — el [paquete de cmdline-tools de Google](https://developer.android.com/studio#command-tools)
  se puede descomprimir en cualquier carpeta de usuario (p.ej. `~/Android/Sdk`)
  y usar `sdkmanager` desde ahí:
  ```bash
  sdkmanager --sdk_root=~/Android/Sdk --licenses   # aceptar licencias
  sdkmanager --sdk_root=~/Android/Sdk \
    "platform-tools" "platforms;android-36" "build-tools;36.0.0"
  ```

## Compilar el APK Android

Con los requisitos de arriba instalados:

```bash
cd apps/mobile
npm install
npm run build                 # genera dist/
npx cap add android           # solo la primera vez — genera android/
npx cap sync android          # copia dist/ al proyecto nativo tras cada build

# apuntar el proyecto Gradle al SDK (una vez, o exportar ANDROID_HOME/JAVA_HOME cada sesión)
echo "sdk.dir=$HOME/Android/Sdk" > android/local.properties

cd android
JAVA_HOME=<ruta al JDK 21> ./gradlew assembleDebug
```

El APK debug (sin firmar para release, instalable directo en un dispositivo/emulador
con `adb install`) queda en
`android/app/build/outputs/apk/debug/app-debug.apk`. Firma de release
(keystore + `signingConfigs` para `assembleRelease`/Play Store) todavía **no**
está configurada — ver el ítem E3d en [ROADMAP.md](ROADMAP.md).

## Componentes

| Componente | Origen en el curso | Enlace |
|---|---|---|
| Entrenamiento (4 stages, PyTorch + TensorFlow) | Certamen 1 | [ml/training/README.md](ml/training/README.md) |
| Preparación de datasets + baselines | Certamen 2 | [ml/data-prep/README.md](ml/data-prep/README.md) |
| Apps (mobile, backend, desktop-runner) | Examen | [apps/README.md](apps/README.md) |

## Aplicación Frontend (Ionic)

La interfaz comercial del escáner de cartas se está construyendo actualmente con Ionic React. 
- Puedes encontrar su código, estado de avance, y las **instrucciones de despliegue** en su respectiva carpeta.
- ➡️ **[Ir al README de la aplicación Ionic](apps/mobile/README.md)**

## Backend (NestJS + Prisma + PostgreSQL)

La persistencia de la app final (cuentas de usuario, cartas de la colección
con sus fotos, transacciones de compra/venta) vive en un backend NestJS
separado, con Postgres y object storage S3-compatible levantados vía Docker
solo para desarrollo local (el backend en sí no corre en Docker).
- ➡️ **[Ir al README del backend](apps/backend/README.md)** — instrucciones de
  despliegue, arquitectura por capas (domain/application/infrastructure/
  presentation) y qué falta a propósito (login/JWT, 2FA, MercadoPago real).
  `apps/mobile/` ya habla con esta API (registro, cartas + fotos,
  listado de la Bóveda) — ver su propio README para el detalle de qué está
  cableado y qué falta.

## Automatización del pipeline (Electron)

La creación de los modelos (scraping, embeddings, entrenamiento, Optuna) se está
empaquetando en una app Electron aparte para no depender de la terminal.
- ➡️ **[Contrato de integración para la app Electron](docs/architecture/PIPELINE_INTEGRATION.md)**
  — inventario de scripts, venvs, argumentos y convenciones de salida.
