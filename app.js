import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signOut,
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, deleteDoc, getDoc, onSnapshot, writeBatch
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

/* ============================================================
   Firebase
   ============================================================ */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// El caché local permite abrir la app sin señal y evita gastar lecturas de más
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

const movimientosRef = collection(db, 'movimientos');
const configRef = doc(db, 'config', 'general');

/* ============================================================
   Constantes
   ============================================================ */
const CATEGORIAS = [
  { id: 'mercado',         label: 'Mercado',         ico: '🛒', color: '#8FB05C' },
  { id: 'restaurantes',    label: 'Restaurantes',    ico: '🍽️', color: '#C0703C' },
  { id: 'bebe',            label: 'Bebé',            ico: '👶', color: '#C2839B' },
  { id: 'salud',           label: 'Salud',           ico: '💊', color: '#A6404A' },
  { id: 'hogar',           label: 'Hogar',           ico: '🏠', color: '#8A7F68' },
  { id: 'servicios',       label: 'Servicios',       ico: '⚡', color: '#CE9F28' },
  { id: 'arriendo',        label: 'Arriendo',        ico: '🔑', color: '#6B4F7A' },
  { id: 'transporte',      label: 'Transporte',      ico: '🚗', color: '#3F8A7D' },
  { id: 'ropa',            label: 'Ropa',            ico: '👕', color: '#5F7EA6' },
  { id: 'viajes',          label: 'Viajes',          ico: '✈️', color: '#7A5C3E' },
  { id: 'entretenimiento', label: 'Entretenimiento', ico: '🎬', color: '#B3568A' },
  { id: 'cuidado',         label: 'Cuidado personal',ico: '✨', color: '#9B8CC4' },
  { id: 'regalos',         label: 'Regalos',         ico: '🎁', color: '#E08A78' },
  { id: 'deudas',          label: 'Deudas y transferencias', ico: '💸', color: '#4C5B6B' },
  { id: 'otros',           label: 'Otros',           ico: '📦', color: '#98988A' },
];
const cat = (id) => CATEGORIAS.find(c => c.id === id) || CATEGORIAS[CATEGORIAS.length - 1];

const fmt = (n) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: 'COP', maximumFractionDigits: 0
}).format(Math.round(n || 0));

const fmtDivisa = (n, moneda) => new Intl.NumberFormat('es-CO', {
  style: 'currency', currency: moneda, maximumFractionDigits: 2
}).format(n || 0);

const fechaCorta = (iso) => new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short' })
  .format(new Date(iso + 'T00:00:00'));

const hoyISO = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

const nuevoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const esc = (s) => String(s === null || s === undefined ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* ---------- modo oscuro ---------- */
// Preferencia por dispositivo, no por cuenta: cada quien puede tener el suyo distinto.
function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'oscuro' ? '#1A2420' : '#22302B');
  try { localStorage.setItem('gastos-tema', t); } catch (e) { /* modo privado del navegador */ }
}
try { aplicarTema(localStorage.getItem('gastos-tema') === 'oscuro' ? 'oscuro' : 'claro'); }
catch (e) { aplicarTema('claro'); }

// Para que buscar "cafe" también encuentre "Café": pasa a minúsculas y quita tildes.
const normalizar = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Propone una categoría mirando qué categoría se usó antes para descripciones parecidas.
// Es solo una propuesta: la persona la puede cambiar tocando otra categoría, sin que esto
// se lo impida ni se lo vuelva a imponer después de que ella elija una a mano.
function sugerirCategoria(texto, excluirId) {
  const q = normalizar(texto).trim();
  if (q.length < 3) return null;

  const candidatos = movimientosVisibles().filter(m =>
    m.tipo === 'gasto' && m.id !== excluirId && normalizar(m.descripcion).trim());
  if (candidatos.length === 0) return null;

  let mejor = null; // { score, frecuencia, categoria }
  const frecuenciaPorTexto = {}; // normalizado -> { catId: conteo }

  for (const m of candidatos) {
    const d = normalizar(m.descripcion).trim();
    let score;
    if (d === q) score = 3;
    else if (d.startsWith(q) || q.startsWith(d)) score = 2;
    else if (d.includes(q) || q.includes(d)) score = 1;
    else continue;

    frecuenciaPorTexto[d] = frecuenciaPorTexto[d] || {};
    frecuenciaPorTexto[d][m.categoria] = (frecuenciaPorTexto[d][m.categoria] || 0) + 1;
    const frecuencia = frecuenciaPorTexto[d][m.categoria];

    if (!mejor || score > mejor.score || (score === mejor.score && frecuencia > mejor.frecuencia)) {
      mejor = { score, frecuencia, categoria: m.categoria };
    }
  }
  return mejor ? mejor.categoria : null;
}

// Las fotos viven en su propia colección, no dentro de "movimientos": así la lista de
// gastos sigue sincronizando liviano y una foto solo se descarga cuando se abre ese gasto.
const recibo = (id) => doc(db, 'recibos', id);

// Un documento de Firestore no puede pasar de 1 MB. Dejamos harto margen debajo de eso.
const MAX_FOTO_CHARS = 700000;

function comprimirImagen(archivo, maxDim = 1400) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(new Error('lectura'));
    lector.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decodificacion'));
      img.onload = () => {
        const escala = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * escala));
        const h = Math.max(1, Math.round(img.height * escala));
        const lienzo = document.createElement('canvas');
        lienzo.width = w; lienzo.height = h;
        const ctx = lienzo.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        let calidad = 0.62;
        let salida = lienzo.toDataURL('image/jpeg', calidad);
        while (salida.length > MAX_FOTO_CHARS && calidad > 0.25) {
          calidad -= 0.1;
          salida = lienzo.toDataURL('image/jpeg', calidad);
        }
        if (salida.length > MAX_FOTO_CHARS) return reject(new Error('muy-pesada'));
        resolve(salida);
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

/* ============================================================
   Estado
   ============================================================ */
const estado = {
  usuario: null,
  nombres: ['Persona 1', 'Persona 2'],
  movimientos: [],
  cargando: true,
  vista: 'resumen',
  filtroCat: 'todos',
  busqueda: '',
  periodo: 'mes',
  compararGranularidad: 'mes',
  visibles: 50,
  aviso: null,
  fotos: {}, // cache en memoria: id de movimiento -> foto ya descargada de Firestore
  pendientesBorrar: new Set(), // ids "eliminados" en la interfaz mientras se puede deshacer
  tasas: {}, // última tasa de cambio usada por moneda, para prellenar la próxima vez
};

let desuscribir = [];
const timersBorrado = {}; // id -> setTimeout, para poder cancelarlo si se deshace

// Lo que realmente se muestra y se cuenta: descarta lo que está en camino a borrarse.
const movimientosVisibles = () => estado.movimientos.filter(m => !estado.pendientesBorrar.has(m.id));

const balance = () => movimientosVisibles().reduce((s, m) => s + (m.delta || 0), 0);

// Borrado con "deshacer": el gasto desaparece de la vista al toque, pero no se toca
// Firestore hasta que pasen unos segundos sin que la persona se arrepienta.
function programarBorrado(m) {
  estado.pendientesBorrar.add(m.id);
  render();
  mostrarDeshacer(m.tipo === 'pago' ? 'Pago' : 'Gasto');
  timersBorrado[m.id] = setTimeout(async () => {
    delete timersBorrado[m.id];
    if (!estado.pendientesBorrar.has(m.id)) return; // ya se deshizo mientras tanto
    estado.pendientesBorrar.delete(m.id);
    await borrarMovimiento(m.id, m.tieneFoto);
  }, 6000);
}
function deshacerBorrado() {
  const id = estado._ultimoBorrado;
  if (!id) return;
  if (timersBorrado[id]) { clearTimeout(timersBorrado[id]); delete timersBorrado[id]; }
  estado.pendientesBorrar.delete(id);
  ocultarDeshacer();
  render();
}
function mostrarDeshacer(etiqueta) {
  ocultarDeshacer();
  estado._ultimoBorrado = [...estado.pendientesBorrar].pop();
  const nodo = document.createElement('div');
  nodo.className = 'deshacer';
  nodo.id = 'deshacer-toast';
  nodo.innerHTML = `<span>${esc(etiqueta)} eliminado</span><button id="deshacer-btn">Deshacer</button>`;
  document.body.appendChild(nodo);
  nodo.querySelector('#deshacer-btn').addEventListener('click', deshacerBorrado);
}
function ocultarDeshacer() {
  const n = document.getElementById('deshacer-toast');
  if (n) n.remove();
}

function avisar(texto, tipo = 'ok', ms = 4000) {
  estado.aviso = { texto, tipo };
  render();
  if (ms) setTimeout(() => { estado.aviso = null; render(); }, ms);
}

/* ============================================================
   Autenticación
   ============================================================ */
getRedirectResult(auth).catch(() => {});

onAuthStateChanged(auth, (usuario) => {
  estado.usuario = usuario;
  desuscribir.forEach(fn => fn());
  desuscribir = [];
  if (usuario) {
    estado.cargando = true;
    render();
    escucharDatos();
  } else {
    estado.movimientos = [];
    estado.cargando = false;
    render();
  }
});

async function entrarConGoogle(boton) {
  const proveedor = new GoogleAuthProvider();
  proveedor.setCustomParameters({ prompt: 'select_account' });
  if (boton) { boton.disabled = true; boton.textContent = 'Abriendo...'; }
  try {
    await signInWithPopup(auth, proveedor);
  } catch (e) {
    const necesitaRedirect = [
      'auth/popup-blocked',
      'auth/operation-not-supported-in-this-environment',
      'auth/cancelled-popup-request',
    ].includes(e.code);
    if (necesitaRedirect) {
      try { await signInWithRedirect(auth, proveedor); return; } catch (e2) { /* cae al mensaje */ }
    }
    if (e.code === 'auth/popup-closed-by-user') {
      if (boton) { boton.disabled = false; boton.textContent = 'Entrar con Google'; }
      return;
    }
    if (boton) { boton.disabled = false; boton.textContent = 'Entrar con Google'; }
    avisar(mensajeAuth(e), 'error', 8000);
  }
}

function mensajeAuth(e) {
  if (e.code === 'auth/unauthorized-domain')
    return 'Este dominio no está autorizado en Firebase. Agrégalo en Authentication → Settings → Authorized domains.';
  if (e.code === 'auth/invalid-credential' || e.code === 'auth/wrong-password')
    return 'Correo o contraseña incorrectos.';
  if (e.code === 'auth/user-not-found')
    return 'Ese usuario no existe. Créalo en la consola de Firebase.';
  if (e.code === 'auth/network-request-failed')
    return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
  return 'No se pudo iniciar sesión (' + (e.code || 'error') + ').';
}

/* ============================================================
   Datos en tiempo real
   ============================================================ */
function escucharDatos() {
  desuscribir.push(onSnapshot(movimientosRef, { includeMetadataChanges: true }, (snap) => {
    estado.movimientos = snap.docs.map(d => ({ id: d.id, ...d.data(), _pendiente: d.metadata.hasPendingWrites }));
    estado.cargando = false;
    const idsVivos = new Set(estado.movimientos.map(m => m.id));
    estado.pendientesBorrar.forEach(id => { if (!idsVivos.has(id)) estado.pendientesBorrar.delete(id); });
    // Si en ese momento está escribiendo en el buscador, no reconstruimos toda la
    // pantalla (le quitaría el foco a mitad de la escritura) — solo refrescamos
    // la lista de resultados con los datos nuevos.
    if (document.activeElement && document.activeElement.id === 'g-busqueda') {
      refrescarListaGastos();
    } else {
      render();
    }
  }, (e) => {
    estado.cargando = false;
    avisar(e.code === 'permission-denied'
      ? 'Tu cuenta no tiene permiso. Revisa las reglas de Firestore.'
      : 'No se pudieron cargar los datos.', 'error', 0);
    render();
  }));

  desuscribir.push(onSnapshot(configRef, (d) => {
    const data = d.data();
    if (data && Array.isArray(data.nombres) && data.nombres.length === 2) estado.nombres = data.nombres;
    if (data && data.tasas && typeof data.tasas === 'object') estado.tasas = data.tasas;
    if (data) render();
  }, () => {}));
}

// fotoAccion: 'ninguna' (no tocar la foto), 'nueva' (crear o reemplazar), 'quitar' (borrarla).
// Si mov trae una foto nueva, primero se guarda en la colección "recibos" y solo si eso
// funciona se marca tieneFoto en el movimiento. Así nunca queda un movimiento que diga
// tener foto sin que la foto realmente se haya guardado.
async function guardarMovimiento(mov, fotoAccion = 'ninguna', fotoData = null) {
  if (fotoAccion === 'nueva' && fotoData) {
    try {
      await setDoc(recibo(mov.id), { data: fotoData });
      estado.fotos[mov.id] = fotoData;
    } catch (e) {
      mov = { ...mov, tieneFoto: false };
      avisar('El gasto se guardó, pero la foto no se pudo subir.', 'error');
    }
  } else if (fotoAccion === 'quitar') {
    try { await deleteDoc(recibo(mov.id)); } catch (e) { /* ya no existía */ }
    delete estado.fotos[mov.id];
  }
  try {
    await setDoc(doc(db, 'movimientos', mov.id), mov);
  } catch (e) {
    avisar('No se pudo guardar. Se reintentará cuando vuelva la conexión.', 'error');
  }
}

async function borrarMovimiento(id, tieneFoto) {
  try {
    await deleteDoc(doc(db, 'movimientos', id));
  } catch (e) {
    avisar('No se pudo eliminar.', 'error');
    return;
  }
  delete estado.fotos[id];
  if (tieneFoto) {
    try { await deleteDoc(recibo(id)); } catch (e) { /* ya no existe, no pasa nada */ }
  }
}

// Descarga la foto de un movimiento solo cuando hace falta (al abrir su detalle),
// y la deja en caché para no volver a pedirla si se abre otra vez en esta sesión.
async function obtenerFoto(id) {
  if (estado.fotos[id]) return estado.fotos[id];
  const snap = await getDoc(recibo(id));
  if (!snap.exists()) throw new Error('no-existe');
  const data = snap.data().data;
  estado.fotos[id] = data;
  return data;
}

async function guardarNombres(nombres) {
  try {
    await setDoc(configRef, { nombres }, { merge: true });
    estado.nombres = nombres;
  } catch (e) {
    avisar('No se pudieron guardar los nombres.', 'error');
  }
}

// Firestore fusiona campos de primer nivel, no submapas: mandamos el objeto de tasas
// completo (con la nueva incluida) para no perder las otras monedas guardadas antes.
async function guardarTasa(moneda, tasa) {
  const tasas = { ...estado.tasas, [moneda]: tasa };
  estado.tasas = tasas;
  try {
    await setDoc(configRef, { tasas }, { merge: true });
  } catch (e) { /* no es crítico: solo afecta el prellenado la próxima vez */ }
}

// Firestore acepta máximo 500 operaciones por lote
async function enLotes(items, accion) {
  for (let i = 0; i < items.length; i += 400) {
    const lote = writeBatch(db);
    items.slice(i, i + 400).forEach(item => accion(lote, item));
    await lote.commit();
  }
}

/* ============================================================
   Render principal
   ============================================================ */
const contenedor = document.getElementById('app');

function render() {
  if (!estado.usuario) return contenedor.innerHTML = vistaLogin();
  if (estado.cargando) return contenedor.innerHTML = `
    <div class="pantalla-carga"><div class="spinner"></div><p>Sincronizando...</p></div>`;

  const fecha = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
    .format(new Date());

  contenedor.innerHTML = `
    <div class="app">
      <header class="cabecera">
        <div>
          <p class="eyebrow">${esc(fecha)}</p>
          <h1>Gastos de ${esc(estado.nombres[0])} y ${esc(estado.nombres[1])}</h1>
        </div>
        <button class="btn-icono" data-accion="ajustes" aria-label="Ajustes">⚙️</button>
      </header>
      ${estado.aviso ? `<div class="aviso ${estado.aviso.tipo}">${esc(estado.aviso.texto)}</div>` : ''}
      <main>
        ${estado.vista === 'resumen' ? vistaResumen()
        : estado.vista === 'gastos' ? vistaGastos()
        : vistaEstadisticas()}
      </main>
      <nav class="tabs">
        <button data-tab="resumen" class="${estado.vista === 'resumen' ? 'activo' : ''}">
          <span class="ico">⚖️</span><span>Resumen</span></button>
        <button data-tab="gastos" class="${estado.vista === 'gastos' ? 'activo' : ''}">
          <span class="ico">🧾</span><span>Gastos</span></button>
        <button data-tab="estadisticas" class="${estado.vista === 'estadisticas' ? 'activo' : ''}">
          <span class="ico">📊</span><span>Estadísticas</span></button>
      </nav>
    </div>`;
}

function vistaLogin() {
  return `
  <div class="login">
    <div class="login-card">
      <img src="./icons/icon-192.png" alt="" class="login-icono">
      <h1>Gastos del hogar</h1>
      <p>Entra con la cuenta de Google que autorizaste en Firebase.</p>
      ${estado.aviso ? `<div class="aviso ${estado.aviso.tipo}">${esc(estado.aviso.texto)}</div>` : ''}
      <button class="btn btn-google btn-full" data-accion="google">Entrar con Google</button>
      <div class="login-sep">o</div>
      <button class="btn-link" data-accion="ver-correo">Entrar con correo y contraseña</button>
      <div class="login-correo" id="form-correo">
        <label class="campo">Correo</label>
        <input class="input" type="email" id="correo" autocomplete="username" inputmode="email">
        <label class="campo">Contraseña</label>
        <input class="input" type="password" id="clave" autocomplete="current-password">
        <button class="btn btn-principal btn-full" style="margin-top:.8rem" data-accion="correo">Entrar</button>
      </div>
    </div>
  </div>`;
}

/* ---------- resumen ---------- */
function balanzaSVG() {
  const b = balance();
  const inclinacion = 26 * Math.tanh(b / 500000);
  const izqY = 92 + inclinacion, derY = 92 - inclinacion;
  const inicial = (n) => (n || '?').trim().charAt(0).toUpperCase();
  return `
  <svg viewBox="0 0 300 175" class="balanza" role="img" aria-label="Balanza de gastos">
    <polygon points="132,150 168,150 150,110" fill="var(--ink)" opacity=".85"/>
    <rect x="118" y="150" width="64" height="7" rx="3.5" fill="var(--ink)" opacity=".6"/>
    <line class="pieza" x1="46" y1="${izqY}" x2="254" y2="${derY}" stroke="var(--ink)" stroke-width="7" stroke-linecap="round"/>
    <circle class="pieza" cx="46" cy="${izqY - 19}" r="22" fill="#A8552A"/>
    <text class="pieza" x="46" y="${izqY - 19}" text-anchor="middle" dominant-baseline="central">${esc(inicial(estado.nombres[0]))}</text>
    <circle class="pieza" cx="254" cy="${derY - 19}" r="22" fill="#33587F"/>
    <text class="pieza" x="254" y="${derY - 19}" text-anchor="middle" dominant-baseline="central">${esc(inicial(estado.nombres[1]))}</text>
  </svg>`;
}

function vistaResumen() {
  const b = balance(), abs = Math.abs(b);
  const deudor = b > 0 ? estado.nombres[1] : estado.nombres[0];
  const acreedor = b > 0 ? estado.nombres[0] : estado.nombres[1];
  const recientes = [...movimientosVisibles()]
    .sort((x, y) => y.date.localeCompare(x.date) || (y.orden - x.orden)).slice(0, 6);

  return `
    <div class="balanza-card">
      ${balanzaSVG()}
      <div class="balanza-nombres"><span>${esc(estado.nombres[0])}</span><span>${esc(estado.nombres[1])}</span></div>
      ${abs < 1
        ? `<p class="balance-cero">✓ Están a paz y salvo</p>`
        : `<p class="balance-texto">${esc(deudor)} le debe a ${esc(acreedor)}</p>
           <p class="balance-monto">${fmt(abs)}</p>`}
    </div>
    <div class="fila-acciones">
      <button class="btn btn-principal" data-accion="nuevo">+ Agregar gasto</button>
      <button class="btn btn-secundario" data-accion="saldar" ${abs < 1 ? 'disabled' : ''}>Saldar cuentas</button>
    </div>
    <h2 class="seccion">Últimos movimientos</h2>
    ${recientes.length ? `<ul class="lista">${recientes.map(fila).join('')}</ul>` : vacio()}`;
}

function vacio() {
  return `<div class="vacio"><p>Aún no hay movimientos.</p>
    <button class="btn-link" data-accion="nuevo">Agrega el primero →</button></div>`;
}

function fila(m) {
  const pendiente = m._pendiente
    ? '<span class="mov-sync" title="Guardado en este celular, esperando conexión para sincronizar">↻</span>' : '';
  if (m.tipo === 'pago') {
    return `<li><button class="mov" data-detalle="${esc(m.id)}">
      <span class="mov-icono" style="background:#3F7A56;color:#fff">⇄</span>
      <span class="mov-info">
        <span class="mov-titulo">Pago: ${esc(estado.nombres[m.from])} → ${esc(estado.nombres[m.to])}</span>
        <span class="mov-sub">${esc(fechaCorta(m.date))}</span>
      </span>
      ${pendiente}
      <span class="mov-monto">${fmt(m.amount)}</span></button></li>`;
  }
  const c = cat(m.categoria);
  const division = m.division === 'solo' ? `Solo ${estado.nombres[m.soloDe]}`
    : m.division === 'porcentaje' ? `${Math.round((m.parteA / m.amount) * 100)}/${Math.round((m.parteB / m.amount) * 100)}`
    : '50/50';
  return `<li><button class="mov" data-detalle="${esc(m.id)}">
    <span class="mov-icono" style="background:${c.color}">${c.ico}</span>
    <span class="mov-info">
      <span class="mov-titulo">${esc(m.descripcion)}</span>
      <span class="mov-sub">${esc(estado.nombres[m.pagoQuien])} · ${esc(fechaCorta(m.date))} · ${esc(division)}</span>
    </span>
    ${m.tieneFoto ? '<span class="mov-clip" title="Tiene foto">📷</span>' : ''}
    ${pendiente}
    <span class="mov-monto">${fmt(m.amount)}</span></button></li>`;
}

/* ---------- gastos ---------- */
function filtrarGastos() {
  let lista = movimientosVisibles().filter(m => m.tipo === 'gasto');
  if (estado.filtroCat !== 'todos') lista = lista.filter(m => m.categoria === estado.filtroCat);
  const q = normalizar(estado.busqueda.trim());
  if (q) lista = lista.filter(m => normalizar(m.descripcion).includes(q));
  lista.sort((x, y) => y.date.localeCompare(x.date) || (y.orden - x.orden));
  return lista;
}

function resultadosGastosHTML() {
  const hayGastos = movimientosVisibles().some(m => m.tipo === 'gasto');
  const lista = filtrarGastos();
  const visibles = lista.slice(0, estado.visibles);
  const total = lista.reduce((s, m) => s + m.amount, 0);

  if (lista.length === 0) {
    if (!hayGastos) return vacio();
    return `<div class="vacio"><p>Ningún gasto coincide con la búsqueda.</p>
      <button class="btn-link" data-accion="limpiar-filtros">Limpiar filtros →</button></div>`;
  }
  return `
    <p class="conteo">${lista.length} gasto${lista.length === 1 ? '' : 's'} · ${fmt(total)}</p>
    <ul class="lista">${visibles.map(fila).join('')}</ul>
    ${estado.visibles < lista.length
      ? `<button class="btn btn-secundario btn-full" style="margin-top:.9rem" data-accion="mas">
           Ver más (${lista.length - estado.visibles} restantes)</button>` : ''}`;
}

// Actualiza solo los resultados (no todo #app), para que el campo de búsqueda
// nunca se destruya y reconstruya mientras el usuario está escribiendo.
function refrescarListaGastos() {
  const zona = document.getElementById('gastos-resultados');
  if (zona) zona.innerHTML = resultadosGastosHTML();
}

function vistaGastos() {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
      <h2 class="seccion" style="margin:0;font-size:1.25rem">Gastos</h2>
      <button class="btn-icono acento" data-accion="nuevo" aria-label="Agregar gasto">+</button>
    </div>
    <div class="buscador">
      <span class="buscador-ico">🔎</span>
      <input class="input" id="g-busqueda" type="search" inputmode="search"
        placeholder="Buscar por nombre..." value="${esc(estado.busqueda)}"
        autocomplete="off" autocorrect="off" autocapitalize="none">
      <button class="buscador-limpiar" id="g-limpiar" data-accion="limpiar-busqueda"
        aria-label="Borrar búsqueda" ${estado.busqueda ? '' : 'hidden'}>✕</button>
    </div>
    <div class="chips">
      <button class="chip ${estado.filtroCat === 'todos' ? 'activo' : ''}" data-cat="todos">Todos</button>
      ${CATEGORIAS.map(c => `<button class="chip ${estado.filtroCat === c.id ? 'activo' : ''}" data-cat="${c.id}">${c.ico} ${esc(c.label)}</button>`).join('')}
    </div>
    <div id="gastos-resultados">${resultadosGastosHTML()}</div>`;
}

/* ---------- estadísticas ---------- */
function anilloSVG(datos, total) {
  const cx = 110, cy = 110, R = 85, r = 55;
  if (datos.length === 1) {
    return `<svg viewBox="0 0 220 220" class="grafico" style="max-height:220px">
      <circle cx="${cx}" cy="${cy}" r="${(R + r) / 2}" fill="none" stroke="${datos[0].color}" stroke-width="${R - r}"/></svg>`;
  }
  let a0 = -Math.PI / 2;
  const partes = datos.map(d => {
    const ang = (d.value / total) * Math.PI * 2;
    const a1 = a0 + ang;
    const grande = ang > Math.PI ? 1 : 0;
    const p = `M ${cx + R * Math.cos(a0)} ${cy + R * Math.sin(a0)}
               A ${R} ${R} 0 ${grande} 1 ${cx + R * Math.cos(a1)} ${cy + R * Math.sin(a1)}
               L ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}
               A ${r} ${r} 0 ${grande} 0 ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} Z`;
    a0 = a1;
    return `<path d="${p}" fill="${d.color}" stroke="var(--card)" stroke-width="2"/>`;
  }).join('');
  return `<svg viewBox="0 0 220 220" class="grafico" style="max-height:220px">${partes}</svg>`;
}

function barrasSVG(meses) {
  if (!meses.length) return '';
  const max = Math.max(...meses.map(m => m.total)) || 1;
  const ancho = 300, alto = 120, hueco = 6;
  const w = (ancho - hueco * (meses.length - 1)) / meses.length;
  const barras = meses.map((m, i) => {
    const h = Math.max(2, (m.total / max) * alto);
    return `<rect x="${(w + hueco) * i}" y="${alto - h}" width="${w}" height="${h}" rx="3" fill="#CE9F28"/>`;
  }).join('');
  return `
    <svg viewBox="0 0 ${ancho} ${alto}" class="grafico" style="max-height:120px" preserveAspectRatio="none">${barras}</svg>
    <div class="barras-labels">${meses.map(m => `<span>${esc(m.etiqueta)}</span>`).join('')}</div>`;
}

function vistaEstadisticas() {
  const gastos = movimientosVisibles().filter(m => m.tipo === 'gasto');

  if (estado.periodo === 'comparar') return vistaComparar(gastos);

  const ahora = new Date().toISOString();
  const delPeriodo = estado.periodo === 'mes' ? gastos.filter(m => m.date.startsWith(ahora.slice(0, 7)))
    : estado.periodo === 'anio' ? gastos.filter(m => m.date.startsWith(ahora.slice(0, 4)))
    : gastos;

  const mapa = {};
  delPeriodo.forEach(m => { mapa[m.categoria] = (mapa[m.categoria] || 0) + m.amount; });
  const porCat = CATEGORIAS.map(c => ({ name: c.label, value: mapa[c.id] || 0, color: c.color }))
    .filter(d => d.value > 0).sort((a, b) => b.value - a.value);
  const total = porCat.reduce((s, d) => s + d.value, 0);

  const porMes = {};
  gastos.forEach(m => { const k = m.date.slice(0, 7); porMes[k] = (porMes[k] || 0) + m.amount; });
  const claves = Object.keys(porMes).sort().slice(estado.periodo === 'todo' ? -12 : -6);
  const meses = claves.map(k => {
    const et = new Intl.DateTimeFormat('es-CO', { month: 'short' })
      .format(new Date(k + '-01T00:00:00')).replace('.', '');
    return { etiqueta: estado.periodo === 'todo' ? et.charAt(0).toUpperCase() : et, total: porMes[k] };
  });
  const promedio = meses.length ? Math.round(meses.reduce((s, m) => s + m.total, 0) / meses.length) : 0;
  const etiqueta = estado.periodo === 'mes' ? 'este mes' : estado.periodo === 'anio' ? 'este año' : 'histórico';

  return `
    <div class="periodo">
      <button class="${estado.periodo === 'mes' ? 'activo' : ''}" data-periodo="mes">Mes</button>
      <button class="${estado.periodo === 'anio' ? 'activo' : ''}" data-periodo="anio">Año</button>
      <button class="${estado.periodo === 'todo' ? 'activo' : ''}" data-periodo="todo">Todo</button>
      <button class="${estado.periodo === 'comparar' ? 'activo' : ''}" data-periodo="comparar">Comparar</button>
    </div>
    <div class="card">
      <p class="card-label">Total ${etiqueta}</p>
      <p class="card-total">${fmt(total)}</p>
      ${porCat.length ? `<p class="card-nota">Mayor gasto: ${esc(porCat[0].name)}
        (${Math.round((porCat[0].value / total) * 100)}%) · ${delPeriodo.length} registros</p>` : ''}
    </div>
    ${porCat.length ? `<div class="card">
      ${anilloSVG(porCat, total)}
      <ul class="leyenda">${porCat.map(d => `<li><span class="punto" style="background:${d.color}"></span>
        ${esc(d.name)} <b>${Math.round((d.value / total) * 100)}%</b></li>`).join('')}</ul>
    </div>` : `<p class="pista" style="text-align:center">No hay gastos en este período.</p>`}
    ${meses.length ? `<div class="card">
      <p class="card-label">Tendencia mensual</p>
      <p class="card-nota" style="margin-bottom:.6rem">Promedio: ${fmt(promedio)} por mes</p>
      ${barrasSVG(meses)}
    </div>` : ''}`;
}

function vistaComparar(gastos) {
  const g = estado.compararGranularidad; // 'mes' | 'anio'
  const hoy = new Date();
  let claveActual, claveAnterior, etiquetaActual, etiquetaAnterior;
  if (g === 'mes') {
    claveActual = hoy.toISOString().slice(0, 7);
    const anterior = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
    claveAnterior = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}`;
    const fmtMes = (d) => { const t = new Intl.DateTimeFormat('es-CO', { month: 'long', year: 'numeric' }).format(d); return t.charAt(0).toUpperCase() + t.slice(1); };
    etiquetaActual = fmtMes(hoy);
    etiquetaAnterior = fmtMes(anterior);
  } else {
    claveActual = String(hoy.getFullYear());
    claveAnterior = String(hoy.getFullYear() - 1);
    etiquetaActual = claveActual;
    etiquetaAnterior = claveAnterior;
  }

  const gActual = gastos.filter(m => m.date.startsWith(claveActual));
  const gAnterior = gastos.filter(m => m.date.startsWith(claveAnterior));
  const totalActual = gActual.reduce((s, m) => s + m.amount, 0);
  const totalAnterior = gAnterior.reduce((s, m) => s + m.amount, 0);
  const deltaTotalPct = totalAnterior > 0 ? Math.round(((totalActual - totalAnterior) / totalAnterior) * 100) : null;

  const catsActual = {}; gActual.forEach(m => { catsActual[m.categoria] = (catsActual[m.categoria] || 0) + m.amount; });
  const catsAnterior = {}; gAnterior.forEach(m => { catsAnterior[m.categoria] = (catsAnterior[m.categoria] || 0) + m.amount; });
  const todas = new Set([...Object.keys(catsActual), ...Object.keys(catsAnterior)]);
  const filas = [...todas].map(id => {
    const a = catsActual[id] || 0, b = catsAnterior[id] || 0;
    return { c: cat(id), actual: a, anterior: b, delta: a - b };
  }).sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const flecha = (delta) => delta === 0 ? '' : delta > 0
    ? `<span class="delta delta-sube">▲ ${fmt(Math.abs(delta))}</span>`
    : `<span class="delta delta-baja">▼ ${fmt(Math.abs(delta))}</span>`;

  return `
    <div class="periodo">
      <button class="activo" data-periodo="comparar">Comparar</button>
      <button data-periodo="mes">Mes</button>
      <button data-periodo="anio">Año</button>
      <button data-periodo="todo">Todo</button>
    </div>
    <div class="periodo" style="margin-top:-.4rem">
      <button class="${g === 'mes' ? 'activo' : ''}" data-granularidad="mes">Por mes</button>
      <button class="${g === 'anio' ? 'activo' : ''}" data-granularidad="anio">Por año</button>
    </div>
    <div class="card">
      <p class="card-label">${esc(etiquetaActual)} vs. ${esc(etiquetaAnterior)}</p>
      <p class="card-total">${fmt(totalActual)}</p>
      <p class="card-nota">
        ${etiquetaAnterior}: ${fmt(totalAnterior)}
        ${deltaTotalPct === null ? '' : deltaTotalPct === 0 ? ' · sin cambio'
          : deltaTotalPct > 0 ? ` · <span class="delta-sube">▲ ${deltaTotalPct}%</span>`
          : ` · <span class="delta-baja">▼ ${Math.abs(deltaTotalPct)}%</span>`}
      </p>
    </div>
    ${filas.length === 0 ? `<p class="pista" style="text-align:center">No hay gastos en ninguno de los dos períodos.</p>` : `
    <div class="card">
      <p class="card-label" style="margin-bottom:.7rem">Por categoría</p>
      <ul class="comparar-lista">
        ${filas.map(f => `<li class="comparar-fila">
          <span class="comparar-cat">${f.c.ico} ${esc(f.c.label)}</span>
          <span class="comparar-montos">
            <b>${fmt(f.actual)}</b>
            <span class="comparar-anterior">antes ${fmt(f.anterior)}</span>
          </span>
          ${flecha(f.delta)}
        </li>`).join('')}
      </ul>
    </div>`}`;
}

/* ============================================================
   Paneles
   ============================================================ */
function abrirPanel(html, preparar) {
  cerrarPanel();
  const nodo = document.createElement('div');
  nodo.className = 'overlay';
  nodo.id = 'panel';
  nodo.innerHTML = html;
  nodo.addEventListener('click', (e) => { if (e.target === nodo) cerrarPanel(); });
  document.body.appendChild(nodo);
  if (preparar) preparar(nodo);
}
function cerrarPanel() {
  const p = document.getElementById('panel');
  if (p) p.remove();
}
const cabezaPanel = (titulo) => `
  <div class="panel-head"><h2>${esc(titulo)}</h2>
    <button class="btn-icono" data-cerrar aria-label="Cerrar">✕</button></div>`;

/* ---------- nuevo gasto / editar gasto (mismo formulario) ---------- */
function panelFormularioGasto(existente = null) {
  const esExtranjero = existente && existente.monedaOriginal && existente.monedaOriginal !== 'COP';
  const inicial = existente ? {
    descripcion: existente.descripcion,
    monto: esExtranjero ? String(existente.montoOriginal) : String(existente.amount),
    moneda: existente.monedaOriginal || 'COP',
    tasa: existente.tasaUsada || null,
    categoria: existente.categoria,
    fecha: existente.date,
    pagoQuien: existente.pagoQuien,
    division: existente.division,
    pctA: existente.division === 'porcentaje' ? Math.round((existente.parteA / existente.amount) * 100) : 50,
    soloDe: existente.division === 'solo' ? existente.soloDe : 0,
  } : {
    descripcion: '', monto: '', moneda: 'COP', tasa: null, categoria: CATEGORIAS[0].id, fecha: hoyISO(),
    pagoQuien: 0, division: 'igual', pctA: 50, soloDe: 0,
  };

  abrirPanel(`
    <div class="panel">
      ${cabezaPanel(existente ? 'Editar gasto' : 'Nuevo gasto')}
      <div class="panel-body">
        <label class="campo">Descripción</label>
        <input class="input" id="g-desc" placeholder="Ej. Mercado de la semana" value="${esc(inicial.descripcion)}">
        <p class="sugerencia" id="g-sugerencia" hidden></p>
        <label class="campo">Monto</label>
        <div class="chips" id="g-moneda">
          <button class="chip ${inicial.moneda === 'COP' ? 'activo' : ''}" data-moneda="COP">🇨🇴 COP</button>
          <button class="chip ${inicial.moneda === 'USD' ? 'activo' : ''}" data-moneda="USD">🇺🇸 USD</button>
          <button class="chip ${inicial.moneda === 'EUR' ? 'activo' : ''}" data-moneda="EUR">🇪🇺 EUR</button>
        </div>
        <input class="input mono" id="g-monto" inputmode="decimal" placeholder="0" value="${esc(inicial.monto)}">
        <div id="g-tasa-zona"></div>
        <p class="preview" id="g-preview"></p>
        <label class="campo">Categoría</label>
        <div class="chips" id="g-cats">
          ${CATEGORIAS.map(c => `<button class="chip ${c.id === inicial.categoria ? 'activo' : ''}" data-c="${c.id}">${c.ico} ${esc(c.label)}</button>`).join('')}
        </div>
        <label class="campo">Fecha</label>
        <input class="input" type="date" id="g-fecha" value="${inicial.fecha}" max="${hoyISO()}">
        <label class="campo">Pagado por</label>
        <div class="toggles" id="g-pago">
          ${estado.nombres.map((n, i) => `<button class="toggle ${i === inicial.pagoQuien ? 'activo' : ''}" data-p="${i}">${esc(n)}</button>`).join('')}
        </div>
        <label class="campo">Cómo dividir</label>
        <div class="toggles" id="g-division">
          <button class="toggle chico ${inicial.division === 'igual' ? 'activo' : ''}" data-d="igual">50 / 50</button>
          <button class="toggle chico ${inicial.division === 'porcentaje' ? 'activo' : ''}" data-d="porcentaje">Otro %</button>
          <button class="toggle chico ${inicial.division === 'solo' ? 'activo' : ''}" data-d="solo">Solo uno</button>
        </div>
        <div id="g-extra"></div>

        <label class="campo">Foto de la factura (opcional)</label>
        <div id="g-foto"></div>

        <p class="error" id="g-error" hidden></p>
        <div id="g-duplicado"></div>
      </div>
      <div class="panel-foot">
        <button class="btn btn-principal btn-full" id="g-guardar">${existente ? 'Guardar cambios' : 'Guardar gasto'}</button>
      </div>
    </div>`, (nodo) => {

    const sel = { ...inicial, foto: null, fotoEstado: 'ninguna', categoriaManual: !!existente, duplicadoConfirmado: false };
    const $ = (s) => nodo.querySelector(s);

    /* --- foto: agregar, o si estamos editando, cargar/quitar/reemplazar la existente --- */
    const zonaFoto = $('#g-foto');
    const pintarFotoVacia = () => {
      sel.fotoEstado = 'ninguna';
      zonaFoto.innerHTML = `
        <label class="foto-picker" id="g-foto-boton">
          📷 Tomar o elegir foto
          <input type="file" accept="image/*" id="g-foto-input" hidden>
        </label>
        <p class="foto-hint">Se reduce antes de guardarse, así que puede verse menos nítida que el original.</p>`;
      zonaFoto.querySelector('#g-foto-input').addEventListener('change', manejarFoto);
    };
    const pintarFotoCargando = (texto) => {
      sel.fotoEstado = 'cargando';
      zonaFoto.innerHTML = `<div class="foto-trabajando"><span class="spinner-sm"></span> ${esc(texto)}</div>`;
    };
    const pintarFotoLista = () => {
      zonaFoto.innerHTML = `
        <div class="foto-preview">
          <img src="${sel.foto}" alt="Factura adjunta">
          <button type="button" class="foto-quitar" id="g-foto-quitar" aria-label="Quitar foto">✕</button>
        </div>`;
      zonaFoto.querySelector('#g-foto-quitar').addEventListener('click', () => {
        sel.foto = null;
        pintarFotoVacia();
        sel.fotoEstado = 'quitada'; // pintarFotoVacia() lo deja en "ninguna"; lo corregimos después
      });
    };
    const pintarFotoNoDisponible = () => {
      sel.fotoEstado = 'no-disponible';
      zonaFoto.innerHTML = `
        <p class="foto-hint">La foto guardada ya no está disponible.</p>
        <label class="foto-picker" id="g-foto-boton">📷 Reemplazar con otra foto
          <input type="file" accept="image/*" id="g-foto-input" hidden></label>`;
      zonaFoto.querySelector('#g-foto-input').addEventListener('change', manejarFoto);
    };
    async function manejarFoto(e) {
      const archivo = e.target.files && e.target.files[0];
      if (!archivo) return;
      pintarFotoCargando('Preparando la foto...');
      try {
        sel.foto = await comprimirImagen(archivo);
        sel.fotoEstado = 'nueva';
        pintarFotoLista();
      } catch (err) {
        pintarFotoVacia();
        const err2 = $('#g-error');
        err2.textContent = err.message === 'muy-pesada'
          ? 'La imagen es demasiado pesada. Prueba con otra foto.'
          : 'No se pudo leer la imagen. Prueba con otro archivo.';
        err2.hidden = false;
      }
    }

    if (existente && existente.tieneFoto) {
      pintarFotoCargando('Cargando la foto guardada...');
      obtenerFoto(existente.id).then((data) => {
        if (!nodo.isConnected) return;
        sel.foto = data;
        sel.fotoEstado = 'existente';
        pintarFotoLista();
      }).catch(() => { if (nodo.isConnected) pintarFotoNoDisponible(); });
    } else {
      pintarFotoVacia();
    }

    /* --- sugerencia de categoría mientras se escribe la descripción --- */
    $('#g-desc').addEventListener('input', (e) => {
      const sugerencia = $('#g-sugerencia');
      if (sel.categoriaManual) { sugerencia.hidden = true; return; }
      const catId = sugerirCategoria(e.target.value, existente ? existente.id : null);
      if (!catId || catId === sel.categoria) { sugerencia.hidden = true; return; }
      sel.categoria = catId;
      nodo.querySelectorAll('#g-cats .chip').forEach(x => x.classList.toggle('activo', x.dataset.c === catId));
      sugerencia.textContent = `Categoría sugerida según gastos parecidos: ${cat(catId).label}`;
      sugerencia.hidden = false;
    });

    /* --- moneda y monto: COP directo, o divisa extranjera con tasa manual --- */
    const pintarTasaZona = () => {
      const zona = $('#g-tasa-zona');
      if (sel.moneda === 'COP') { zona.innerHTML = ''; return; }
      const tasaPrefill = sel.tasa || (estado.tasas && estado.tasas[sel.moneda]) || '';
      zona.innerHTML = `
        <label class="campo">Tasa de cambio (1 ${sel.moneda} = ? COP)</label>
        <input class="input mono" id="g-tasa" inputmode="decimal" placeholder="Ej. 4100" value="${esc(String(tasaPrefill))}">`;
      zona.querySelector('#g-tasa').addEventListener('input', () => actualizarPreview());
    };
    const filtrarEntradaMonto = (valor) => {
      if (sel.moneda === 'COP') return valor.replace(/[^\d]/g, '');
      let limpio = valor.replace(/[^\d.]/g, '');
      const partes = limpio.split('.');
      if (partes.length > 2) limpio = partes[0] + '.' + partes.slice(1).join('');
      return limpio;
    };
    const actualizarPreview = () => {
      const montoIng = parseFloat($('#g-monto').value) || 0;
      if (sel.moneda === 'COP') {
        $('#g-preview').textContent = montoIng ? fmt(montoIng) : '';
        return;
      }
      const tasaEl = $('#g-tasa');
      const tasaIng = tasaEl ? (parseFloat(tasaEl.value) || 0) : 0;
      $('#g-preview').textContent = (montoIng && tasaIng)
        ? `≈ ${fmt(montoIng * tasaIng)} COP (tasa ${tasaIng.toLocaleString('es-CO')})`
        : montoIng ? 'Falta la tasa de cambio para convertir a pesos.' : '';
    };
    pintarTasaZona();
    actualizarPreview();

    $('#g-moneda').addEventListener('click', (e) => {
      const b = e.target.closest('[data-moneda]'); if (!b) return;
      if (b.dataset.moneda === sel.moneda) return;
      sel.moneda = b.dataset.moneda;
      $('#g-monto').value = '';
      nodo.querySelectorAll('#g-moneda .chip').forEach(x => x.classList.toggle('activo', x === b));
      pintarTasaZona();
      actualizarPreview();
    });
    $('#g-monto').addEventListener('input', (e) => {
      e.target.value = filtrarEntradaMonto(e.target.value);
      actualizarPreview();
    });

    $('#g-cats').addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]'); if (!b) return;
      sel.categoria = b.dataset.c;
      sel.categoriaManual = true;
      $('#g-sugerencia').hidden = true;
      nodo.querySelectorAll('#g-cats .chip').forEach(x => x.classList.toggle('activo', x === b));
    });
    $('#g-pago').addEventListener('click', (e) => {
      const b = e.target.closest('[data-p]'); if (!b) return;
      sel.pagoQuien = Number(b.dataset.p);
      nodo.querySelectorAll('#g-pago .toggle').forEach(x => x.classList.toggle('activo', x === b));
    });
    $('#g-division').addEventListener('click', (e) => {
      const b = e.target.closest('[data-d]'); if (!b) return;
      sel.division = b.dataset.d;
      nodo.querySelectorAll('#g-division .toggle').forEach(x => x.classList.toggle('activo', x === b));
      pintarExtra();
    });

    function pintarExtra() {
      const extra = $('#g-extra');
      if (sel.division === 'porcentaje') {
        extra.innerHTML = `
          <div class="porcentajes">
            <span>${esc(estado.nombres[0])}: <b id="p-a">${sel.pctA}</b>%</span>
            <span>${esc(estado.nombres[1])}: <b id="p-b">${100 - sel.pctA}</b>%</span>
          </div>
          <input type="range" min="0" max="100" value="${sel.pctA}" class="slider" id="g-rango">`;
        extra.querySelector('#g-rango').addEventListener('input', (e) => {
          sel.pctA = Number(e.target.value);
          extra.querySelector('#p-a').textContent = sel.pctA;
          extra.querySelector('#p-b').textContent = 100 - sel.pctA;
        });
      } else if (sel.division === 'solo') {
        extra.innerHTML = `<div class="toggles" style="margin-top:.6rem" id="g-solo">
          ${estado.nombres.map((n, i) => `<button class="toggle ${i === sel.soloDe ? 'activo' : ''}" data-s="${i}">${esc(n)}</button>`).join('')}
        </div>`;
        extra.querySelector('#g-solo').addEventListener('click', (e) => {
          const b = e.target.closest('[data-s]'); if (!b) return;
          sel.soloDe = Number(b.dataset.s);
          extra.querySelectorAll('.toggle').forEach(x => x.classList.toggle('activo', x === b));
        });
      } else {
        extra.innerHTML = '';
      }
    }
    pintarExtra(); // por si se abre editando un gasto que ya tenía % o "solo uno"

    async function guardar() {
      const err = $('#g-error');
      const descripcion = $('#g-desc').value.trim();
      const montoIngresado = parseFloat($('#g-monto').value) || 0;
      const moneda = sel.moneda || 'COP';
      const tasaEl = $('#g-tasa');
      const tasa = moneda === 'COP' ? null : (tasaEl ? parseFloat(tasaEl.value) || 0 : 0);
      const fecha = $('#g-fecha').value || hoyISO();
      const mostrar = (t) => { err.textContent = t; err.hidden = false; };
      if (!descripcion) return mostrar('Escribe una descripción.');
      if (montoIngresado <= 0) return mostrar('Ingresa un monto válido.');
      if (moneda !== 'COP' && (!tasa || tasa <= 0)) return mostrar('Ingresa la tasa de cambio.');
      if (sel.fotoEstado === 'cargando') return mostrar('Espera a que termine de prepararse la foto.');

      const monto = moneda === 'COP' ? Math.round(montoIngresado) : Math.round(montoIngresado * tasa);
      if (monto <= 0) return mostrar('Ingresa un monto válido.');

      if (!existente && !sel.duplicadoConfirmado) {
        const CINCO_MIN = 5 * 60 * 1000;
        const parecido = movimientosVisibles().find(m => m.tipo === 'gasto' && m.amount === monto &&
          m.date === fecha && normalizar(m.descripcion) === normalizar(descripcion) &&
          (Date.now() - (m.orden || 0)) < CINCO_MIN);
        if (parecido) {
          $('#g-duplicado').innerHTML = `
            <p class="error">Ya agregaste "${esc(parecido.descripcion)}" por ${fmt(parecido.amount)} hace un momento.
              ¿Seguro que quieres agregarlo otra vez?</p>
            <div class="fila-acciones">
              <button class="btn btn-secundario" id="g-dup-no">Revisar</button>
              <button class="btn btn-principal" id="g-dup-si">Agregar de todas formas</button>
            </div>`;
          $('#g-duplicado').querySelector('#g-dup-no').addEventListener('click', () => { $('#g-duplicado').innerHTML = ''; });
          $('#g-duplicado').querySelector('#g-dup-si').addEventListener('click', () => {
            sel.duplicadoConfirmado = true;
            $('#g-duplicado').innerHTML = '';
            guardar();
          });
          return;
        }
      }

      let parteA, parteB;
      if (sel.division === 'igual') { parteA = Math.round(monto / 2); parteB = monto - parteA; }
      else if (sel.division === 'porcentaje') { parteA = Math.round(monto * sel.pctA / 100); parteB = monto - parteA; }
      else { parteA = sel.soloDe === 0 ? monto : 0; parteB = monto - parteA; }

      const tieneFotoFinal = sel.fotoEstado === 'nueva' || sel.fotoEstado === 'existente' || sel.fotoEstado === 'no-disponible';
      const fotoAccion = sel.fotoEstado === 'nueva' ? 'nueva' : sel.fotoEstado === 'quitada' ? 'quitar' : 'ninguna';

      const mov = {
        id: existente ? existente.id : nuevoId(), tipo: 'gasto', date: fecha,
        descripcion, amount: monto, categoria: sel.categoria, pagoQuien: sel.pagoQuien,
        division: sel.division, soloDe: sel.division === 'solo' ? sel.soloDe : null,
        parteA, parteB, delta: sel.pagoQuien === 0 ? parteB : -parteA,
        orden: existente ? existente.orden : Date.now(), tieneFoto: tieneFotoFinal,
        monedaOriginal: moneda, montoOriginal: moneda === 'COP' ? null : montoIngresado,
        tasaUsada: moneda === 'COP' ? null : tasa,
      };
      if (moneda !== 'COP') guardarTasa(moneda, tasa);
      $('#g-guardar').disabled = true;
      cerrarPanel();
      await guardarMovimiento(mov, fotoAccion, sel.foto);
    }
    $('#g-guardar').addEventListener('click', guardar);
  });
}

/* ---------- saldar ---------- */
function panelSaldar() {
  const b = balance(), abs = Math.abs(b);
  const deudor = b > 0 ? 1 : 0, acreedor = b > 0 ? 0 : 1;
  abrirPanel(`
    <div class="panel">
      ${cabezaPanel('Saldar cuentas')}
      <div class="panel-body">
        <p style="font-size:.95rem;margin:.25rem 0 .5rem">
          ${esc(estado.nombres[deudor])} le debe a ${esc(estado.nombres[acreedor])} <b>${fmt(abs)}</b></p>
        <label class="campo">Monto a saldar</label>
        <input class="input mono" id="s-monto" inputmode="numeric" value="${Math.round(abs)}">
        <p class="preview" id="s-preview">${fmt(abs)}</p>
        <div class="rapidos">
          <button data-m="${Math.round(abs / 2)}">Mitad</button>
          <button data-m="${Math.round(abs)}">Todo</button>
        </div>
        <p class="error" id="s-error" hidden></p>
      </div>
      <div class="panel-foot">
        <button class="btn btn-principal btn-full" id="s-guardar">Confirmar pago</button>
      </div>
    </div>`, (nodo) => {
    const campo = nodo.querySelector('#s-monto');
    const refrescar = () => {
      nodo.querySelector('#s-preview').textContent = campo.value ? fmt(parseInt(campo.value, 10)) : '';
    };
    campo.addEventListener('input', () => { campo.value = campo.value.replace(/[^\d]/g, ''); refrescar(); });
    nodo.querySelector('.rapidos').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-m]'); if (!btn) return;
      campo.value = btn.dataset.m; refrescar();
    });
    nodo.querySelector('#s-guardar').addEventListener('click', async () => {
      const monto = parseInt(campo.value, 10) || 0;
      if (monto <= 0) {
        const err = nodo.querySelector('#s-error');
        err.textContent = 'Ingresa un monto válido.'; err.hidden = false; return;
      }
      const mov = {
        id: nuevoId(), tipo: 'pago', date: hoyISO(), amount: monto,
        from: deudor, to: acreedor, delta: b > 0 ? -monto : monto, orden: Date.now(),
      };
      cerrarPanel();
      await guardarMovimiento(mov);
    });
  });
}

/* ---------- detalle ---------- */
function panelDetalle(id) {
  const m = estado.movimientos.find(x => x.id === id);
  if (!m) return;
  const cuerpo = m.tipo === 'pago' ? `
      <p class="detalle-titulo">Pago entre ustedes</p>
      <p class="detalle-monto">${fmt(m.amount)}</p>
      <ul class="detalle-lista">
        <li><span>De</span><b>${esc(estado.nombres[m.from])}</b></li>
        <li><span>Para</span><b>${esc(estado.nombres[m.to])}</b></li>
        <li><span>Fecha</span><b>${esc(fechaCorta(m.date))}</b></li>
      </ul>` : `
      <p class="detalle-titulo">${esc(m.descripcion)}</p>
      <p class="detalle-monto">${fmt(m.amount)}</p>
      <ul class="detalle-lista">
        ${m.monedaOriginal && m.monedaOriginal !== 'COP' ? `<li><span>Monto original</span>
          <b>${fmtDivisa(m.montoOriginal, m.monedaOriginal)} · tasa ${fmt(m.tasaUsada)}</b></li>` : ''}
        <li><span>Categoría</span><b>${esc(cat(m.categoria).label)}</b></li>
        <li><span>Pagado por</span><b>${esc(estado.nombres[m.pagoQuien])}</b></li>
        <li><span>Fecha</span><b>${esc(fechaCorta(m.date))}</b></li>
        <li><span>${esc(estado.nombres[0])} debe</span><b>${fmt(m.parteA)}</b></li>
        <li><span>${esc(estado.nombres[1])} debe</span><b>${fmt(m.parteB)}</b></li>
      </ul>`;

  abrirPanel(`
    <div class="panel">
      ${cabezaPanel(m.tipo === 'pago' ? 'Detalle del pago' : 'Detalle del gasto')}
      <div class="panel-body">
        ${cuerpo}
        <div id="d-foto"></div>
        ${m.tipo === 'gasto' ? `<button class="btn btn-secundario btn-full" id="d-editar" style="margin-bottom:.6rem">Editar</button>` : ''}
        <button class="btn btn-peligro-linea btn-full" id="d-borrar">Eliminar</button>
      </div>
    </div>`, (nodo) => {

    if (m.tieneFoto) cargarFotoDetalle(nodo, id);

    if (m.tipo === 'gasto') {
      nodo.querySelector('#d-editar').addEventListener('click', () => {
        cerrarPanel();
        panelFormularioGasto(m);
      });
    }

    nodo.querySelector('#d-borrar').addEventListener('click', () => {
      cerrarPanel();
      programarBorrado(m);
    });
  });
}

async function cargarFotoDetalle(nodo, id) {
  const zona = nodo.querySelector('#d-foto');
  zona.innerHTML = `<div class="foto-trabajando"><span class="spinner-sm"></span> Cargando la factura...</div>`;
  try {
    const data = await obtenerFoto(id);
    if (!nodo.isConnected) return; // el panel ya se cerró mientras descargaba
    zona.innerHTML = `
      <div class="detalle-foto">
        <button type="button" id="d-foto-ver"><img src="${data}" alt="Factura del gasto"></button>
        <p>Toca la imagen para verla completa</p>
      </div>`;
    zona.querySelector('#d-foto-ver').addEventListener('click', () => abrirVisor(data));
  } catch (e) {
    if (nodo.isConnected) zona.innerHTML = `<p class="foto-hint">La foto de esta factura ya no está disponible.</p>`;
  }
}

function abrirVisor(data) {
  const nodo = document.createElement('div');
  nodo.className = 'visor';
  nodo.innerHTML = `<button class="visor-cerrar" aria-label="Cerrar">✕</button><img src="${data}" alt="Factura del gasto">`;
  nodo.addEventListener('click', () => nodo.remove());
  document.body.appendChild(nodo);
}

/* ---------- ajustes ---------- */
function panelAjustes() {
  abrirPanel(`
    <div class="panel">
      ${cabezaPanel('Ajustes')}
      <div class="panel-body">
        <label class="campo">Primer nombre</label>
        <input class="input" id="a-uno" value="${esc(estado.nombres[0])}">
        <label class="campo">Segundo nombre</label>
        <input class="input" id="a-dos" value="${esc(estado.nombres[1])}">
        <button class="btn btn-secundario btn-full" style="margin-top:.9rem" id="a-nombres">Guardar nombres</button>

        <label class="campo">Apariencia</label>
        <div class="toggles" id="a-tema">
          <button class="toggle ${document.documentElement.dataset.tema !== 'oscuro' ? 'activo' : ''}" data-tema="claro">☀️ Claro</button>
          <button class="toggle ${document.documentElement.dataset.tema === 'oscuro' ? 'activo' : ''}" data-tema="oscuro">🌙 Oscuro</button>
        </div>

        <p class="pista">${estado.movimientos.length} movimientos sincronizados
          · ${estado.movimientos.filter(m => m.tieneFoto).length} con foto.
          Sesión: ${esc(estado.usuario.email || '')}</p>

        <button class="btn btn-secundario btn-full" style="margin-top:.7rem" id="a-copia">Copia de seguridad</button>
        <button class="btn btn-secundario btn-full" style="margin-top:.6rem" id="a-unificar">Unificar nombres parecidos</button>

        <div class="zona">
          <p class="campo" style="margin-top:0">Datos</p>
          <p class="pista" style="margin-top:0">Carga el historial migrado o restaura una copia.
            El archivo se lee desde este dispositivo: nunca viaja a GitHub.</p>
          <input type="file" accept=".json,application/json" id="a-archivo" hidden>
          <button class="btn btn-secundario btn-full" style="margin-top:.6rem" id="a-importar">Importar desde archivo</button>
          <div id="a-import"></div>
        </div>

        <div class="zona">
          <button class="btn btn-secundario btn-full" id="a-salir">Cerrar sesión</button>
        </div>
      </div>
    </div>`, (nodo) => {
    nodo.querySelector('#a-nombres').addEventListener('click', async () => {
      const uno = nodo.querySelector('#a-uno').value.trim();
      const dos = nodo.querySelector('#a-dos').value.trim();
      if (!uno || !dos) return;
      cerrarPanel();
      await guardarNombres([uno, dos]);
      avisar('Nombres guardados.');
    });
    nodo.querySelector('#a-copia').addEventListener('click', panelCopia);
    nodo.querySelector('#a-unificar').addEventListener('click', panelUnificarNombres);
    nodo.querySelector('#a-tema').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tema]'); if (!b) return;
      aplicarTema(b.dataset.tema);
      nodo.querySelectorAll('#a-tema .toggle').forEach(x => x.classList.toggle('activo', x === b));
    });
    nodo.querySelector('#a-salir').addEventListener('click', async () => {
      cerrarPanel(); await signOut(auth);
    });

    prepararImportacion(nodo);
  });
}

/* ---------- unificar nombres parecidos ---------- */
// Solo los grupos revisados a mano: mismo concepto, distinta escritura. Los casos donde
// el parecido en el texto engañaba (p. ej. "Platos Theo" vs "Zapatos Theo", "Columbia" la
// marca vs "Colombia" el país) se dejaron fuera a propósito.
const RENOMBRES = [
  { canonico: 'Prestamo', variantes: ['Prestamos'] },
  { canonico: 'Mac Pollo', variantes: ['Mac pollo', 'Macpollo'] },
  { canonico: 'Burguer Hill', variantes: ['Burguer hill', 'BurguerHill', 'Burguerhill', 'Buguer Hill'] },
  { canonico: 'Peaje', variantes: ['Peajes'] },
  { canonico: 'Vacuna Theo', variantes: ['Vacunas theo'] },
  { canonico: 'Parqueadero aeropuerto', variantes: ['Parqueadero aerop'] },
  { canonico: 'Piso pélvico', variantes: ['Piso pelvico', 'Piso Pelvico'] },
  { canonico: 'Hamburguesa', variantes: ['Hamburguesas'] },
  { canonico: 'Cita Theo', variantes: ['Cita theo'] },
  { canonico: 'Suzette', variantes: ['Suzzete'] },
  { canonico: 'Pepe Ganga', variantes: ['Pepe ganga'] },
  { canonico: 'Administración', variantes: ['Administracion'] },
  { canonico: 'Jardín Theo', variantes: ['Jardin Theo', 'Jardin theo'] },
  { canonico: 'Cerveza', variantes: ['Cerveza 2'] },
  { canonico: 'Açaí', variantes: ['Acai'] },
  { canonico: 'La Burguer', variantes: ['La burguer'] },
  { canonico: 'Offcorss', variantes: ['Off corss', 'Offcors'] },
  { canonico: 'Papa Crunch', variantes: ['Papa crunh'] },
  { canonico: 'Dollarcity', variantes: ['Dollar city'] },
  { canonico: 'Lobo Cantina', variantes: ['Lobo cantina'] },
  { canonico: 'Almuerzo', variantes: ['Almuerzos'] },
  { canonico: 'Comida Burguer Hill', variantes: ['Comida burguer'] },
];

function panelUnificarNombres() {
  const cambios = RENOMBRES
    .map(r => ({ ...r, afectados: movimientosVisibles().filter(m => m.tipo === 'gasto' && r.variantes.includes(m.descripcion)) }))
    .filter(r => r.afectados.length > 0);
  const total = cambios.reduce((s, c) => s + c.afectados.length, 0);

  abrirPanel(`
    <div class="panel">
      ${cabezaPanel('Unificar nombres parecidos')}
      <div class="panel-body">
        ${cambios.length === 0 ? `
          <p class="pista" style="margin-top:0">No hay nada pendiente por unificar en este momento.</p>
        ` : `
          <p class="pista" style="margin-top:0">Esto solo cambia el texto de la descripción — el monto, la
            categoría, quién pagó y la división quedan exactamente igual. Se puede volver a abrir esta
            pantalla más adelante si aparecen nuevas variantes.</p>
          <ul class="detalle-lista" style="margin-top:.9rem">
            ${cambios.map(c => `<li><span>${esc(c.variantes.join(', '))} → <b>${esc(c.canonico)}</b></span>
              <b>${c.afectados.length}</b></li>`).join('')}
          </ul>
          <p class="pista">${total} gasto${total === 1 ? '' : 's'} en total.</p>
          <div id="u-zona"></div>
        `}
      </div>
    </div>`, (nodo) => {
    if (cambios.length === 0) return;
    const zona = nodo.querySelector('#u-zona');
    zona.innerHTML = `<button class="btn btn-principal btn-full" id="u-aplicar">Unificar ${total} gasto${total === 1 ? '' : 's'}</button>`;
    zona.querySelector('#u-aplicar').addEventListener('click', async () => {
      zona.innerHTML = `<div class="foto-trabajando"><span class="spinner-sm"></span> Aplicando...</div>`;
      const pares = [];
      cambios.forEach(c => c.afectados.forEach(m => pares.push({ id: m.id, descripcion: c.canonico })));
      try {
        await enLotes(pares, (lote, p) => lote.set(doc(db, 'movimientos', p.id), { descripcion: p.descripcion }, { merge: true }));
        cerrarPanel();
        avisar(`Listo: se unificaron ${pares.length} gastos.`);
      } catch (e) {
        zona.innerHTML = `<p class="error">No se pudo completar. Revisa tu conexión e intenta de nuevo.</p>
          <button class="btn btn-principal btn-full" id="u-aplicar">Unificar ${total} gasto${total === 1 ? '' : 's'}</button>`;
      }
    });
  });
}

/* ---------- importar / restaurar desde archivo ---------- */
function prepararImportacion(nodo) {
  const input = nodo.querySelector('#a-archivo');
  const zona = nodo.querySelector('#a-import');
  nodo.querySelector('#a-importar').addEventListener('click', () => input.click());

  input.addEventListener('change', async () => {
    const archivo = input.files && input.files[0];
    input.value = '';
    if (!archivo) return;
    zona.innerHTML = `<p class="pista">Leyendo ${esc(archivo.name)}...</p>`;

    let datos;
    try {
      datos = JSON.parse(await archivo.text());
    } catch (e) {
      zona.innerHTML = '<p class="error">Ese archivo no es un JSON válido.</p>';
      return;
    }

    const movs = Array.isArray(datos) ? datos : (datos && datos.movimientos);
    const valido = Array.isArray(movs) && movs.length > 0 && movs.every(m =>
      m && typeof m.id === 'string' && typeof m.date === 'string' && typeof m.delta === 'number');
    if (!valido) {
      zona.innerHTML = '<p class="error">El archivo no tiene el formato esperado.</p>';
      return;
    }

    zona.innerHTML = `<p class="error">Se cargarán ${movs.length} movimientos y se borrarán
        los ${estado.movimientos.length} que hay ahora. Esto afecta a los dos.</p>
      <div class="fila-acciones">
        <button class="btn btn-secundario" id="i-no">Cancelar</button>
        <button class="btn btn-principal" id="i-si">Cargar</button>
      </div>`;
    zona.querySelector('#i-no').addEventListener('click', () => { zona.innerHTML = ''; });
    zona.querySelector('#i-si').addEventListener('click', () =>
      aplicarImportacion(zona, movs, datos && datos.nombres));
  });
}

async function aplicarImportacion(zona, movs, nombres) {
  zona.innerHTML = `<div class="pista" style="display:flex;align-items:center;gap:.5rem">
    <span class="spinner-sm"></span> Cargando ${movs.length} movimientos...</div>`;
  try {
    await enLotes(estado.movimientos, (lote, m) => lote.delete(doc(db, 'movimientos', m.id)));
    await enLotes(movs, (lote, m) => lote.set(doc(db, 'movimientos', m.id), m));
    if (Array.isArray(nombres) && nombres.length === 2) await guardarNombres(nombres);
    cerrarPanel();
    estado.vista = 'resumen';
    avisar(`Listo: ${movs.length} movimientos cargados.`);
  } catch (e) {
    zona.innerHTML = `<p class="error">No se pudo completar la carga.
      Revisa tu conexión y los permisos de Firestore, luego intenta de nuevo.</p>`;
  }
}

/* ---------- copia de seguridad ---------- */
function descargar(nombre, texto, mime) {
  try {
    const url = URL.createObjectURL(new Blob([texto], { type: mime }));
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 800);
  } catch (e) { /* el botón de copiar sirve como alternativa */ }
}

function panelCopia() {
  const copia = JSON.stringify({
    app: 'gastos-hogar', version: 2, exportado: new Date().toISOString(),
    nombres: estado.nombres, movimientos: estado.movimientos,
  });
  const comillas = (v) => `"${String(v === null || v === undefined ? '' : v).replace(/"/g, '""')}"`;
  const cabecera = ['Fecha', 'Tipo', 'Descripción', 'Categoría', 'Monto', 'Pagó',
    `Parte ${estado.nombres[0]}`, `Parte ${estado.nombres[1]}`, 'División', 'Moneda original', 'Monto original', 'Tasa'];
  const filas = [...estado.movimientos]
    .sort((a, b) => a.date.localeCompare(b.date) || (a.orden - b.orden))
    .map(m => m.tipo === 'pago'
      ? [m.date, 'Pago', `${estado.nombres[m.from]} le pagó a ${estado.nombres[m.to]}`, '', m.amount, estado.nombres[m.from], '', '', '', '', '', '']
      : [m.date, 'Gasto', m.descripcion, cat(m.categoria).label, m.amount, estado.nombres[m.pagoQuien],
         m.parteA, m.parteB, m.division === 'igual' ? '50/50' : m.division === 'solo' ? `Solo ${estado.nombres[m.soloDe]}` : 'Personalizada',
         m.monedaOriginal && m.monedaOriginal !== 'COP' ? m.monedaOriginal : '',
         m.montoOriginal || '', m.tasaUsada || '']);
  const csv = '\uFEFF' + [cabecera, ...filas].map(f => f.map(comillas).join(';')).join('\r\n');
  const sello = hoyISO();

  abrirPanel(`
    <div class="panel">
      ${cabezaPanel('Copia de seguridad')}
      <div class="panel-body">
        <p class="pista" style="margin-top:0">${estado.movimientos.length} movimientos.
          Firestore ya guarda todo en la nube; esto es por si quieres una copia propia.
          Las fotos de facturas no van incluidas, solo los datos del gasto.</p>
        <button class="btn btn-principal btn-full" style="margin-top:.7rem" id="c-json">Descargar copia (.json)</button>
        <button class="btn btn-secundario btn-full" style="margin-top:.6rem" id="c-csv">Descargar tabla (.csv)</button>
        <p class="pista">El CSV abre en Excel o Google Sheets.</p>
        <button class="btn btn-secundario btn-full" style="margin-top:.6rem" id="c-copiar">Copiar copia al portapapeles</button>
        <p class="ok" id="c-aviso" hidden></p>
        <textarea class="input" id="c-texto" readonly hidden>${esc(copia)}</textarea>
      </div>
    </div>`, (nodo) => {
    const aviso = nodo.querySelector('#c-aviso');
    const decir = (t) => { aviso.textContent = t; aviso.hidden = false; };
    nodo.querySelector('#c-json').addEventListener('click', () => {
      descargar(`gastos-hogar-${sello}.json`, copia, 'application/json');
      decir('Si no ves el archivo, usa "Copiar copia" y guárdalo en una nota.');
    });
    nodo.querySelector('#c-csv').addEventListener('click', () => {
      descargar(`gastos-hogar-${sello}.csv`, csv, 'text/csv;charset=utf-8');
      decir('Si no ves el archivo, tu navegador bloqueó la descarga.');
    });
    nodo.querySelector('#c-copiar').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copia);
        decir('Copia en el portapapeles.');
      } catch (e) {
        const t = nodo.querySelector('#c-texto');
        t.hidden = false; t.focus(); t.select();
        decir('No pude usar el portapapeles. Selecciona el texto y cópialo a mano.');
      }
    });
  });
}

/* ============================================================
   Eventos globales
   ============================================================ */
document.addEventListener('click', (e) => {
  const cerrar = e.target.closest('[data-cerrar]');
  if (cerrar) return cerrarPanel();

  const accion = e.target.closest('[data-accion]');
  if (accion) {
    const a = accion.dataset.accion;
    if (a === 'google') return entrarConGoogle(accion);
    if (a === 'ver-correo') {
      const f = document.getElementById('form-correo');
      if (f) f.classList.add('abierto');
      return;
    }
    if (a === 'correo') {
      const correo = document.getElementById('correo').value.trim();
      const clave = document.getElementById('clave').value;
      return signInWithEmailAndPassword(auth, correo, clave)
        .catch(err => avisar(mensajeAuth(err), 'error', 8000));
    }
    if (a === 'nuevo') return panelFormularioGasto();
    if (a === 'saldar') return panelSaldar();
    if (a === 'ajustes') return panelAjustes();
    if (a === 'mas') { estado.visibles += 50; return refrescarListaGastos(); }
    if (a === 'limpiar-busqueda') { estado.busqueda = ''; estado.visibles = 50; return render(); }
    if (a === 'limpiar-filtros') { estado.busqueda = ''; estado.filtroCat = 'todos'; estado.visibles = 50; return render(); }
  }

  const detalle = e.target.closest('[data-detalle]');
  if (detalle) return panelDetalle(detalle.dataset.detalle);

  const tab = e.target.closest('[data-tab]');
  if (tab) { estado.vista = tab.dataset.tab; estado.visibles = 50; return render(); }

  const filtro = e.target.closest('[data-cat]');
  if (filtro && !document.getElementById('panel')) {
    estado.filtroCat = filtro.dataset.cat; estado.visibles = 50; return render();
  }

  const periodo = e.target.closest('[data-periodo]');
  if (periodo) { estado.periodo = periodo.dataset.periodo; return render(); }

  const granularidad = e.target.closest('[data-granularidad]');
  if (granularidad) { estado.compararGranularidad = granularidad.dataset.granularidad; return render(); }
});

window.addEventListener('online', () => avisar('Conexión recuperada. Sincronizando...', 'sync', 3000));
window.addEventListener('offline', () => avisar('Sin conexión. Los cambios se guardan y se envían después.', 'sync', 0));

// Búsqueda en vivo: actualiza solo la lista de resultados, nunca todo #app,
// para que el campo de texto no pierda el foco ni el cursor mientras se escribe.
document.addEventListener('input', (e) => {
  if (e.target.id !== 'g-busqueda') return;
  estado.busqueda = e.target.value;
  estado.visibles = 50;
  const limpiar = document.getElementById('g-limpiar');
  if (limpiar) limpiar.hidden = !estado.busqueda;
  refrescarListaGastos();
});

render();
