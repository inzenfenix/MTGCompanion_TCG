# MTG Card Scanner — Examen final (plan)

> 🚧 Planeación — todavía no implementado. Este documento es la base para
> arrancar la app final; se termina de aterrizar una vez estén los dos modelos
> nuevos de [Certamen 2](../certamen_2/README.md).

## Restricciones conocidas (indicadas por el profesor)

- La aplicación final debe estar construida en **Ionic**.
- Debe usar **OpenCV.js** y **TensorFlow.js** — es decir, la inferencia corre
  del lado del cliente (navegador / app), no como un script de Python.
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
┌─────────────────────────── Ionic + Angular (Capacitor) ───────────────────────────┐
│                                                                                      │
│  Cámara (Capacitor Camera) ─▶ OpenCV.js (recorte/perspectiva de la carta) ─▶        │
│  TensorFlow.js (embedding de la carta) ─▶ búsqueda de similitud ─▶ carta candidata  │
│                                                                                      │
└──────────────────────────────────────────────────────────────────────────────────────┘
                          │                                    │
                          ▼                                    ▼
              validador de texto (Certamen 2)        estimador de precio (Certamen 2)
```

### Por qué TensorFlow (no PyTorch) para el modelo que corre en el cliente

Ambos pipelines de Certamen 1 son válidos, pero para el examen conviene elegir
**uno solo** como el que efectivamente corre en la app. TensorFlow tiene una
ruta de conversión directa y soportada a TensorFlow.js
(`tensorflowjs_converter` sobre el modelo Keras/MobileNetV2 ya entrenado);
PyTorch necesitaría pasar primero por ONNX y de ahí a onnxruntime-web, un salto
extra sin beneficio claro acá. Esto no descarta el trabajo de PyTorch — sigue
siendo la comparación central de Certamen 1 — solo define cuál de los dos se
"productiviza" en la app final.

### Piezas por resolver

- **Preprocesamiento (OpenCV.js)**: detectar el rectángulo de la carta dentro
  del frame de la cámara, corregir perspectiva, normalizar tamaño/iluminación
  antes de pasarla al modelo — el equivalente en el navegador a lo que hoy hace
  `PIL`/`torchvision.transforms` en Python.
- **Búsqueda de similitud en el cliente**: el índice de embeddings (~29 k
  cartas) hay que decidir si se sirve completo al cliente (viable si el
  tamaño en memoria es razonable — es una matriz `Float32Array` chica por
  carta) o si conviene un backend liviano solo para el nearest-neighbor
  (ej. una Cloud Function) si no entra cómodo en el dispositivo.
- **Validador de texto y estimador de precio (Certamen 2)**: livianos por
  diseño (bag-of-words / regresión tabular) — candidatos naturales a también
  correr client-side vía TensorFlow.js, o como un microservicio simple si el
  OCR es más práctico en un backend.
- **Hosting de la app**: PWA (más simple para la presentación del examen) vs.
  build nativo con Capacitor para Android/iOS (más "comercial" pero con más
  fricción de setup) — a decidir según tiempo disponible.

## Qué falta para arrancar

- [ ] Tener los dos modelos de Certamen 2 entrenados y evaluados.
- [ ] Exportar el modelo de embeddings TensorFlow a formato `tfjs`.
- [ ] Prototipo Ionic mínimo: cámara → OpenCV.js → TensorFlow.js → resultado
      en pantalla (sin backend), siguiendo el
      [tutorial de Ionic](https://ionicframework.com/docs/angular/your-first-app),
      el [tutorial de OpenCV.js](https://forum.opencv.org/t/opencv-js-tutorials-in-spanish-tutoriales-opencv-js-en-espanol/10220)
      y el [tutorial de TensorFlow.js](https://www.tensorflow.org/js/tutorials?hl=es-419).
- [ ] Definir si la búsqueda de similitud vive en el cliente o en un backend
      liviano.
- [ ] Preparar la narrativa comercial para la presentación (a quién le vende,
      qué problema le resuelve, por qué pagaría por la versión premium) — cada
      integrante tiene que poder defenderla en la interrogación oral.
