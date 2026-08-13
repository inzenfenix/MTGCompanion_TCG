# MTG Card Scanner — Examen final (plan)

> 🚧 Planeación — el frontend ya tiene un scaffold real en
> [`trading-app-ionic/`](../../trading-app-ionic/README.md) (Ionic React,
> temas, i18n, tabs), pero sin conectar todavía a ningún modelo. Este
> documento se termina de aterrizar una vez estén los 6 modelos del
> [pipeline de Certamen 2](../certamen_2/README.md) y su exportación a ONNX.

## Restricciones conocidas (indicadas por el profesor)

- La aplicación final debe estar construida en **Ionic**.
- Debe usar **OpenCV.js** y correr inferencia **del lado del cliente**
  (navegador / app), no como un script de Python. El profesor mencionó
  TensorFlow.js como ruta; el equipo optó por **ONNX + `onnxruntime-web`**
  en su lugar (ver sección siguiente) porque cubre ambos frameworks del
  proyecto (PyTorch y TensorFlow), no solo uno.
- La aplicación debe tener **uso comercial** real, no ser solo una demo técnica.
- Presentación con interrogación oral individual — la nota de aprobación
  depende de aprobar esa interrogación (o sea: cada integrante tiene que poder
  explicar el sistema completo, no solo "su" parte).

## Propuesta comercial: "MTG Companion"

Una app para coleccionistas y vendedores de Magic: escanean una carta con la
cámara del celular y la app la identifica al instante, muestra su precio
estimado de mercado, y lleva el inventario de su colección (valor total,
cartas que faltan para completar un mazo, etc.).

Esto responde directamente al pedido de uso comercial del profesor: es la
misma tecnología de Certamen 1 + Certamen 2 (identificación + precio), pero
empaquetada como una herramienta que un vendedor de cartas usaría en la
práctica — no solo un ejercicio de clasificación.

Modelo de negocio de referencia (freemium):
- **Gratis**: escanear e identificar una carta.
- **Pago**: historial de precio, valorización total de la colección, alertas
  de precio, exportar el inventario.

## Arquitectura base

```
┌─────────────────────────── Ionic React (Capacitor) ────────────────────────────────┐
│                                                                                      │
│  Cámara (Capacitor Camera) ─▶ OpenCV.js (recorte/perspectiva de la carta) ─▶        │
│  onnxruntime-web (Stage 1/2/3, el ganador de cada etapa — ver Certamen 2 §2) ─▶     │
│  carta identificada + texto validado + precio estimado                             │
│                                                                                      │
└───────────────────────────────────┬──────────────────────────────────────────────┘
                                     │ cuenta / cartas guardadas / transacciones
                                     ▼
                    ┌──────────────────────────────────┐
                    │  Backend NestJS (backend/)        │
                    │  Prisma + PostgreSQL + S3 storage │
                    └──────────────────────────────────┘
```

Detalle completo del pipeline de 3 etapas (detector → validador de texto →
estimador de precio, cada una en PyTorch y TensorFlow) en
[Proyecto/certamen_2/README.md](../certamen_2/README.md#1-arquitectura-del-pipeline-completo).
Este documento cubre solo la parte específica de la app final.

**La inferencia (Stage 1/2/3) sigue siendo 100% del lado del cliente** — el
backend no participa del escaneo/identificación, solo persiste lo que el
usuario ya decidió guardar: su cuenta, las cartas de su colección (con foto)
y las transacciones de compra/venta con otros usuarios. Detalle en
[`backend/README.md`](../../backend/README.md).

### Por qué ONNX (no TensorFlow.js) para lo que corre en el cliente

Certamen 2 duplica cada etapa en PyTorch y TensorFlow y elige el ganador por
métrica (no necesariamente el mismo framework en las tres etapas). Atarse a
TensorFlow.js habría obligado a descartar el resultado si PyTorch ganaba
alguna etapa. Con **ONNX** como formato de exportación común (`torch.onnx.export`
para PyTorch, `tf2onnx` para TensorFlow) y **`onnxruntime-web`** como runtime en
el cliente, la app corre el modelo que efectivamente ganó cada etapa sin
importar en qué framework se entrenó.

### Piezas por resolver

- **Preprocesamiento (OpenCV.js)**: detectar el rectángulo de la carta dentro
  del frame de la cámara, corregir perspectiva, normalizar tamaño/iluminación
  antes de pasarla al modelo — el equivalente en el navegador a lo que hoy hace
  `PIL`/`torchvision.transforms` en Python, y el mismo recorte que usa
  Stage 2 (región de texto) en Certamen 2.
- **Búsqueda de similitud en el cliente**: el índice de embeddings (~29 k
  cartas) hay que decidir si se sirve completo al cliente (viable si el
  tamaño en memoria es razonable — es una matriz `Float32Array` chica por
  carta) o si conviene un backend liviano solo para el nearest-neighbor
  (ej. una Cloud Function) si no entra cómodo en el dispositivo.
- **Validador de texto y estimador de precio (Certamen 2, Stage 2/3)**:
  exportados a ONNX igual que Stage 1 — mismo runtime `onnxruntime-web` en el
  cliente, sin necesitar un backend para servirlos.
- **Hosting de la app**: PWA (más simple para la presentación del examen) vs.
  build nativo con Capacitor para Android/iOS (más "comercial" pero con más
  fricción de setup) — a decidir según tiempo disponible.

## Qué falta para arrancar

- [ ] Tener los 6 modelos de Certamen 2 entrenados, evaluados y con ganador
      elegido por etapa (`output/best_model.json`).
- [ ] Exportar los modelos ganadores a ONNX (`torch.onnx.export` / `tf2onnx`).
- [ ] Conectar `trading-app-ionic/` (ya tiene UI/tabs/temas construidos) a
      `onnxruntime-web`: cámara → OpenCV.js → ONNX → resultado en pantalla,
      siguiendo el
      [tutorial de Ionic](https://ionicframework.com/docs/angular/your-first-app),
      el [tutorial de OpenCV.js](https://forum.opencv.org/t/opencv-js-tutorials-in-spanish-tutoriales-opencv-js-en-espanol/10220)
      y la [documentación de onnxruntime-web](https://onnxruntime.ai/docs/tutorials/web/).
- [ ] Definir si la búsqueda de similitud vive en el cliente o en un backend
      liviano.
- [x] Backend de cuentas/cartas/transacciones (`backend/`, NestJS + Prisma +
      PostgreSQL) — registro de usuario, correo de bienvenida, CRUD de cartas
      con fotos, transacciones con slot para MercadoPago. Falta que
      `trading-app-ionic/` deje de usar sus datos hardcodeados y hable con
      esta API.
- [ ] Preparar la narrativa comercial para la presentación (a quién le vende,
      qué problema le resuelve, por qué pagaría por la versión premium) — cada
      integrante tiene que poder defenderla en la interrogación oral.
