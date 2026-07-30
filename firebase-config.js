// ============================================================
//  Configuración de tu proyecto de Firebase (ya con tus claves reales)
// ============================================================
export const firebaseConfig = {
  apiKey: "AIzaSyAplDbDn4DdEZ_8_iE7ZJ32DjCApJNWoMg",
  authDomain: "gastos-casa-44fa4.firebaseapp.com",
  projectId: "gastos-casa-44fa4",
  storageBucket: "gastos-casa-44fa4.firebasestorage.app",
  messagingSenderId: "595765425801",
  appId: "1:595765425801:web:61dfe1ade1fa8d0c22b858"
};

// Estas claves son públicas por diseño: no son secretas y no protegen nada por sí solas.
// Quien protege los datos son las reglas de Firestore (archivo firestore.rules).
//
// Nota: no incluimos measurementId ni Google Analytics a propósito. Esta app no los usa,
// y agregarlos requeriría otro import que no está preparado en app.js. Si algún día
// quieres estadísticas de uso con Analytics, dímelo y lo agregamos correctamente.
