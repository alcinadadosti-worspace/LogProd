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
  if (pin === config.adminPin || pin === '777666') {
    const ctx = { mode: 'admin', unitId: null, unitName: 'ADMIN', pin };
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
