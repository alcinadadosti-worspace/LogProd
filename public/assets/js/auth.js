import { auth } from './firebase-config.js';
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js';
import { getGlobalConfig, getUnit } from './services/firestore.js';

const SESSION_KEY = 'alcina_unit_ctx';

export const UNIT_PINS = {
  '787865': 'vd_palmeira',
  '965400': 'vd_penedo',
};

// Perfis de admin: PIN -> identidade exibida no topo. Todos têm os MESMOS
// poderes (mode: 'admin'). O PIN do Alberto também é aceito via config.adminPin
// (Firestore) por compatibilidade.
export const ADMIN_PROFILES = {
  '777666': { name: 'Alberto',  photo: '/perfis/Alberto.jpg' },
  '776600': { name: 'Ludmylla', photo: '/perfis/Ludmylla.png' },
};

export async function loginWithEmail(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

export async function validatePin(pin) {
  if (UNIT_PINS[pin]) {
    const unitId = UNIT_PINS[pin];
    const unit = await getUnit(unitId);
    const ctx = { mode: 'unit', unitId, unitName: unit?.name ?? unitId, pin };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(ctx));
    return ctx;
  }

  const config = await getGlobalConfig();
  const adminProfile =
    ADMIN_PROFILES[pin] ||
    (pin === config.adminPin
      ? { name: 'Alberto', photo: '/perfis/Alberto.jpg' }
      : null);
  if (adminProfile) {
    const ctx = {
      mode: 'admin',
      unitId: null,
      unitName: 'ADMIN',
      adminName: adminProfile.name,
      adminPhoto: adminProfile.photo,
      pin,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(ctx));
    return ctx;
  }

  return null;
}

export function getSessionContext() {
  try {
    return JSON.parse(sessionStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function clearSession() {
  sessionStorage.removeItem(SESSION_KEY);
}

export async function logout() {
  clearSession();
  await signOut(auth);
}

export function onAuthChange(cb) {
  return onAuthStateChanged(auth, cb);
}

export function getCurrentUser() {
  return auth.currentUser;
}

export async function waitForAuth() {
  await auth.authStateReady();
  return auth.currentUser;
}
