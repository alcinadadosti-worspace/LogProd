import { db } from '../firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, addDoc,
  collection, query, where, orderBy, limit,
  getDocs, onSnapshot, Timestamp, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

// ===== CONFIG =====

export async function getGlobalConfig() {
  const snap = await getDoc(doc(db, 'config', 'global'));
  return snap.exists() ? snap.data() : getDefaultConfig();
}

export async function setGlobalConfig(data) {
  await setDoc(doc(db, 'config', 'global'), data, { merge: true });
}

function getDefaultConfig() {
  return {
    adminPin: '777666',
    xpBatchBase: 50,
    xpPerOrder: 10,
    xpPerItem: 2,
    speedTargetItemsPerMin: 5,
    bonusThreshold10: 1.0,
    bonusThreshold20: 1.2,
  };
}

// ===== TASKS =====

export async function getTasks() {
  const snap = await getDocs(collection(db, 'config', 'tasks', 'items'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function setTask(taskId, data) {
  await setDoc(doc(db, 'config', 'tasks', 'items', taskId), data, { merge: true });
}

// ===== UNITS =====

export async function getUnit(unitId) {
  const snap = await getDoc(doc(db, 'units', unitId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getAllUnits() {
  const snap = await getDocs(collection(db, 'units'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function updateUnitStockists(unitId, stockists) {
  await updateDoc(doc(db, 'units', unitId), { stockists });
}

export async function setUnit(unitId, data) {
  await setDoc(doc(db, 'units', unitId), data, { merge: true });
}

// ===== EVENTS =====

export async function createEvent(eventData) {
  const payload = {
    ...eventData,
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'events'), payload);
  return ref.id;
}

/** Returns events for a unit in a date range */
export async function getEvents({ unitId, stockistId, startDate, endDate, maxDocs = 200 }) {
  let q = query(
    collection(db, 'events'),
    where('unitId', '==', unitId),
    orderBy('createdAt', 'desc'),
    limit(maxDocs)
  );

  const snap = await getDocs(q);
  let events = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (stockistId) events = events.filter(e => e.stockistId === stockistId);

  if (startDate) {
    events = events.filter(e => {
      const ts = e.createdAt?.toDate?.() ?? new Date(e.createdAt);
      return ts >= startDate;
    });
  }
  if (endDate) {
    events = events.filter(e => {
      const ts = e.createdAt?.toDate?.() ?? new Date(e.createdAt);
      return ts <= endDate;
    });
  }

  return events;
}

/** All events for admin (both units) */
export async function getAllEvents({ startDate, endDate, maxDocs = 500 } = {}) {
  const q = query(collection(db, 'events'), orderBy('createdAt', 'desc'), limit(maxDocs));
  const snap = await getDocs(q);
  let events = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (startDate) {
    events = events.filter(e => {
      const ts = e.createdAt?.toDate?.() ?? new Date(e.createdAt);
      return ts >= startDate;
    });
  }
  if (endDate) {
    events = events.filter(e => {
      const ts = e.createdAt?.toDate?.() ?? new Date(e.createdAt);
      return ts <= endDate;
    });
  }

  return events;
}

/** Find ONLY_SEPARATION event by batchCode + unitId */
export async function findSeparationBatch(unitId, batchCode) {
  const q = query(
    collection(db, 'events'),
    where('unitId', '==', unitId),
    where('type', '==', 'ONLY_SEPARATION'),
    orderBy('createdAt', 'desc'),
    limit(20)
  );
  const snap = await getDocs(q);
  const match = snap.docs.find(d => d.data().batch?.batchCode === batchCode);
  return match ? { id: match.id, ...match.data() } : null;
}

/** Aggregate XP per stockist for ranking */
export function computeRanking(events) {
  const map = {};
  for (const ev of events) {
    if (!map[ev.stockistId]) map[ev.stockistId] = { stockistId: ev.stockistId, xp: 0, events: 0 };
    map[ev.stockistId].xp += ev.xp || 0;
    map[ev.stockistId].events++;
  }
  return Object.values(map).sort((a, b) => b.xp - a.xp);
}

/** Date range helpers */
export function dateRangeForPeriod(period) {
  const now = new Date();
  const start = new Date(now);
  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0);
      return { startDate: start };
    case 'week':
      start.setDate(now.getDate() - 7);
      return { startDate: start };
    case 'month':
      start.setDate(1);
      start.setHours(0, 0, 0, 0);
      return { startDate: start };
    case 'all':
    default:
      return {};
  }
}

/** Local event queue for offline fallback */
export function saveEventLocally(eventData) {
  const queue = JSON.parse(localStorage.getItem('pending_events') || '[]');
  queue.push({ ...eventData, _savedAt: Date.now() });
  localStorage.setItem('pending_events', JSON.stringify(queue));
}

export function getPendingEvents() {
  return JSON.parse(localStorage.getItem('pending_events') || '[]');
}

export async function flushPendingEvents() {
  const queue = getPendingEvents();
  if (queue.length === 0) return;

  const remaining = [];
  for (const ev of queue) {
    try {
      const { _savedAt, ...data } = ev;
      await createEvent(data);
    } catch {
      remaining.push(ev);
    }
  }
  localStorage.setItem('pending_events', JSON.stringify(remaining));
  return remaining.length;
}

/**
 * Listener em tempo real para o telão de ranking.
 * Retorna a função de unsubscribe — chame-a ao sair da tela.
 * Cobra apenas 1 read por novo documento adicionado (delta, não releitura total).
 */
export function watchEvents({ unitId, startDate }, callback) {
  const q = query(
    collection(db, 'events'),
    where('unitId', '==', unitId),
    orderBy('createdAt', 'desc'),
    limit(500)
  );

  return onSnapshot(q, (snap) => {
    let events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (startDate) {
      events = events.filter(e => {
        const ts = e.createdAt?.toDate?.() ?? new Date(e.createdAt);
        return ts >= startDate;
      });
    }
    callback(events);
  });
}
