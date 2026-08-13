# Aplicación de Intercambio de Cartas Mágicas (Frontend Ionic)

Esta carpeta (`trading-app-ionic/`) contiene la aplicación móvil/web desarrollada con **Ionic React**, **Vite**, y **Framer Motion**. La aplicación actúa como la interfaz de usuario para el escáner de cartas de Magic The Gathering (MTG), integrando un diseño premium de "Fantasía Oscura/Mágica".

## 🚀 Estado Actual del Proyecto

El frontend ya cuenta con una interfaz sólida, tematizada e interactiva:
- **Diseño Mágico ("Glassmorphism"):** Uso extensivo de efectos de cristal esmerilado, fondos atmosféricos animados (orbes de luz) y componentes personalizados (como pergaminos y botones mágicos).
- **Temas Dinámicos:** Selector de temas integrado que permite a los usuarios alternar al instante entre **Dark Magic Mode** (magia de sangre oscura) y **Light Magic Mode** (brillo celestial cian/blanco).
- **Internacionalización (i18n):** Traducciones configuradas en tres idiomas: Inglés, Español Latino (es-LA) y Francés.
- **Navegación Interactiva (Tabs):**
  - **The Keep (Tab 1):** Un resumen del tesoro financiero del usuario y un registro de operaciones pasadas.
  - **Trade Nexus (Tab 2):** Flujo simulado de compra/venta entre comerciantes y compradores, con generación y escaneo de códigos QR.
  - **The Vault (Tab 3):** Galería o inventario de las cartas escaneadas.
  - **Grimoire (Tab 4):** Menú de ajustes del sistema (idiomas, temas, etc.).

## 🚧 ¿Qué falta por implementar?

- **Conectar con el backend real:** el backend (NestJS + Prisma + PostgreSQL) ya existe en
  [`backend/`](../backend/README.md) — registro de usuario + correo de bienvenida, CRUD de
  cartas con fotos, y transacciones entre usuarios. Falta que esta app deje de usar sus datos
  hardcodeados y hable con esa API (`VITE_API_BASE_URL`).
- **Integración del Modelo de IA:** Conectar el escáner de la aplicación a los modelos desarrollados previamente (PyTorch/TensorFlow) en el repositorio raíz, para identificar la carta, verificar la calidad y predecir su valor económico en tiempo real usando OpenCV.
- **Flujo de Pagos Real:** Conectar el simulacro de QR con el webhook oficial de transacciones de **WebPay / Mercado Pago**. El backend ya deja un slot (`PaymentProvider`) listo para esto — hoy solo tiene un stub que no cobra nada de verdad.
- **Scraping / Geolocalización:** Herramientas para buscar y localizar mediante scraping tiendas físicas cercanas u otros usuarios que tengan las cartas deseadas.
- **Estado Global:** Migrar la información hardcodeada a una tienda centralizada (como Redux, Zustand, o el Context de React).

---

## 🛠️ Instrucciones de Despliegue (Entorno de Desarrollo)

Para iniciar esta aplicación localmente y verla funcionando en tu navegador, asegúrate de tener [Node.js](https://nodejs.org/) instalado y luego sigue estos pasos:

1. **Instalar dependencias del proyecto:**
   Abre una terminal en esta carpeta (`trading-app-ionic/`) y ejecuta:
   ```bash
   npm install
   ```

2. **Levantar el Servidor de Desarrollo:**
   Se recomienda usar el CLI oficial de Ionic para servir la aplicación web en modo de desarrollo (Vite). Ejecuta:
   ```bash
   ionic serve
   ```
   *(Si el comando falla, asegúrate de tener el CLI de Ionic instalado globalmente: `npm install -g @ionic/cli`)*

3. La aplicación se abrirá automáticamente en tu navegador web. También puedes verla presionando F12 en tu navegador y activando el "Device Toolbar" (Modo Móvil) para visualizarla con proporciones de un teléfono.
