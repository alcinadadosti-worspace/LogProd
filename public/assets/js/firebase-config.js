import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const firebaseConfig = {
  apiKey: "AIzaSyAW89CNebm_uGDUACKcfIVn1ETKvZ0p32c",
  authDomain: "stockflow-35240.firebaseapp.com",
  projectId: "stockflow-35240",
  storageBucket: "stockflow-35240.firebasestorage.app",
  messagingSenderId: "775669247759",
  appId: "1:775669247759:web:6517801765f9297bb4d87a"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export { app };
