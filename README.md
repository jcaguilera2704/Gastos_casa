# Gastos del hogar

App de gastos compartidos para dos personas. Se instala en el iPhone como una app real
(ícono propio, pantalla completa, sin barra de Safari), guarda los datos en Firebase
y sincroniza los dos celulares en tiempo real.

Todo lo que usa cabe en el plan gratuito de Firebase (Spark). No hace falta tarjeta de crédito.

---

## Qué hay en este repositorio y qué no

Este repositorio es **público**, así que contiene únicamente el código de la app:

| Archivo | Para qué sirve |
|---|---|
| `index.html` | El armazón de la app |
| `app.js` | Toda la lógica |
| `styles.css` | Los estilos |
| `firebase-config.js` | **El único archivo que hay que editar** |
| `manifest.webmanifest` | Lo que la convierte en app instalable |
| `sw.js` | Permite abrirla sin señal |
| `icons/` | El ícono en todos los tamaños |
| `.gitignore` | Impide subir datos por accidente |

**Ningún gasto vive aquí.** Los movimientos se guardan solo en Firestore, detrás de
autenticación y reglas de seguridad. Quien clone este repositorio obtiene la app vacía.

Dos archivos se entregan aparte y **no deben subirse nunca**:

- `datos-iniciales.json` — el historial migrado. Se carga desde el celular una sola vez.
- `firestore.rules` — las reglas de seguridad. Solo se pegan en la consola de Firebase.

### ¿Y las claves de `firebase-config.js`?

Son públicas por diseño: viajan en el código de cualquier app web y no son un secreto.
No dan acceso a nada por sí solas. Lo que protege los datos son las reglas del paso 5:
sin un correo autorizado, Firestore rechaza cualquier lectura o escritura.

---

## Paso 1 · Crear el proyecto en Firebase

1. Entra a **https://console.firebase.google.com** → **Crear un proyecto**.
2. Ponle un nombre. Puedes desactivar Google Analytics, no hace falta.

## Paso 2 · Activar el inicio de sesión con Google

1. Menú izquierdo: **Compilación → Authentication → Comenzar**.
2. Pestaña **Sign-in method** → **Google** → activar.
3. Elige un correo de soporte y **Guardar**.

## Paso 3 · Crear la base de datos

1. Menú izquierdo: **Compilación → Firestore Database → Crear base de datos**.
2. Ubicación: `nam5` o `us-central1`.
3. Empieza en **modo de producción**.

## Paso 4 · Copiar las claves

1. **⚙️ Configuración del proyecto** → baja hasta **Tus apps**.
2. Clic en el ícono **`</>`** (Web) → ponle un apodo → **Registrar app**.
3. Copia los valores del bloque `const firebaseConfig = { ... }`.
4. Pégalos en **`firebase-config.js`**, reemplazando los de ejemplo.

## Paso 5 · Poner las reglas de seguridad

1. **Firestore Database → pestaña Reglas**.
2. Borra lo que haya y pega el contenido de `firestore.rules` (el archivo que va aparte).
3. **Cambia los dos correos** por los de Gmail de ustedes.
4. **Publicar**.

Sin este paso, o cualquiera puede leer los gastos, o nadie puede entrar. No lo saltes.

## Paso 6 · Subir a GitHub Pages

1. Crea un repositorio nuevo (público está bien: aquí no hay datos).
2. Sube **todos** los archivos de esta carpeta, respetando `icons/`.
3. **Settings → Pages** → *Source*: **Deploy from a branch**, rama `main`, carpeta `/ (root)` → **Save**.
4. En un par de minutos queda en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`

## Paso 7 · Autorizar el dominio en Firebase

Sin esto el login falla con `auth/unauthorized-domain`.

**Authentication → Settings → Authorized domains → Add domain** → `TU-USUARIO.github.io`

## Paso 8 · Cargar el historial

1. Guarda `datos-iniciales.json` en tu celular o computador (en Archivos, Drive, donde sea).
2. Abre la app, entra con Google.
3. Engranaje → **Importar desde archivo** → selecciona el `.json` → **Cargar**.

El archivo se lee en el navegador y va directo a Firestore. En ningún momento pasa por GitHub.

**Hazlo una sola vez, desde un solo dispositivo.** Repetirlo borra y vuelve a cargar todo.

## Paso 9 · Instalarla en cada iPhone

1. Abre el enlace **en Safari** (en iOS solo Safari puede instalar apps).
2. Botón de **compartir** → **Añadir a pantalla de inicio** → **Añadir**.
3. Ábrela desde el ícono nuevo: debe abrir a pantalla completa, sin barra de Safari.

Cada uno entra con **su propia** cuenta de Google, la que autorizaste en las reglas.

---

## Copias de seguridad

Engranaje → **Copia de seguridad** → *Descargar copia (.json)*. Guárdala fuera del repositorio.
Para restaurarla: **Importar desde archivo** y selecciona esa copia. El botón acepta tanto
el historial migrado como cualquier copia hecha desde la app.

---

## Si algo falla

**El login con Google no abre nada o se queda en blanco.**
Pasa a veces en apps instaladas en iOS, porque la ventana emergente no logra volver a la app.
La app intenta sola el método por redirección. Si aun así falla, usa
**"Entrar con correo y contraseña"**: crea los dos usuarios en **Authentication → Users → Add user**.
Ese método no usa ventanas emergentes y siempre funciona.

**Dice que no tienes permiso.**
Los correos de las reglas no coinciden con las cuentas con las que están entrando (paso 5).

**`auth/unauthorized-domain`.** Falta el paso 7.

**Cambié un archivo y el celular muestra la versión vieja.**
El service worker cachea la app. Sube el número en `sw.js` (`gastos-v1` → `gastos-v2`),
súbelo y recarga.

**Pantalla en blanco.** Revisa que guardaste el paso 4.

---

## Costos

Con dos personas y unos cientos de movimientos están muy por debajo del plan gratuito
(1 GB en Firestore, 50.000 lecturas y 20.000 escrituras diarias). El caché local evita
gastar lecturas nuevas cuando no hubo cambios.

Sin tarjeta vinculada, Firebase no puede cobrar. Si algún día se pasaran de los límites,
el servicio se detiene hasta el día siguiente; con este uso es prácticamente imposible.

---

## Si más adelante quieren fotos de facturas

Se pueden guardar comprimidas dentro de Firestore (límite de 1 MB por documento),
lo que las mantiene en el plan gratuito. La otra opción es Firebase Storage, que desde
febrero de 2026 exige el plan Blaze —y por lo tanto tarjeta— aunque la factura siga en cero.
