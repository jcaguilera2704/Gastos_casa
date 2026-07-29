// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAplDbDn4DdEZ_8_iE7ZJ32DjCApJNWoMg",
  authDomain: "gastos-casa-44fa4.firebaseapp.com",
  projectId: "gastos-casa-44fa4",
  storageBucket: "gastos-casa-44fa4.firebasestorage.app",
  messagingSenderId: "595765425801",
  appId: "1:595765425801:web:61dfe1ade1fa8d0c22b858",
  measurementId: "G-K2GH1D9Q9G"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);