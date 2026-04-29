import { db } from '../firebase-config.js';
import {
  doc, getDoc, setDoc, updateDoc, addDoc,
  collection, query, where, orderBy, limit,
  getDocs, onSnapshot, Timestamp, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';
import { cacheGet, cacheSet, cacheDel, cacheDelPrefix } from './cache.js';

const TTL = {
  config: 30 * 60 * 1000,  // 30 min — config quase nunca muda
  unit:   10 * 60 * 1000,  // 10 min — lista de estoquistas raramente muda
  tasks:  10 * 60 * 1000,  // 10 min — tarefas raramente mudam
  events:  2 * 60 * 1000,  //  2 min — eventos mudam com frequência
};

// ===== CONFIG =====

export async function getGlobalConfig() {
  const cached = cacheGet('config:global');
  if (cached) return cached;
  const snap = await getDoc(doc(db, 'config', 'global'));
  const data = snap.exists() ? snap.data() : getDefaultConfig();
  cacheSet('config:global', data, TTL.config);
  return data;
}

export async function setGlobalConfig(data) {
  await setDoc(doc(db, 'config', 'global'), data, { merge: true });
  cacheDel('config:global');
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
  const cached = cacheGet('tasks');
  if (cached) return cached;
  const snap = await getDocs(collection(db, 'config', 'tasks', 'items'));
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheSet('tasks', data, TTL.tasks);
  return data;
}

export async function setTask(taskId, data) {
  await setDoc(doc(db, 'config', 'tasks', 'items', taskId), data, { merge: true });
  cacheDel('tasks');
}

// ===== UNITS =====

export async function getUnit(unitId) {
  const key = `unit:${unitId}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const snap = await getDoc(doc(db, 'units', unitId));
  const data = snap.exists() ? { id: snap.id, ...snap.data() } : null;
  if (data) cacheSet(key, data, TTL.unit);
  return data;
}

export async function getAllUnits() {
  const cached = cacheGet('units:all');
  if (cached) return cached;
  const snap = await getDocs(collection(db, 'units'));
  const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheSet('units:all', data, TTL.unit);
  return data;
}

export async function updateUnitStockists(unitId, stockists) {
  await updateDoc(doc(db, 'units', unitId), { stockists });
  cacheDel(`unit:${unitId}`);
  cacheDel('units:all');
}

export async function setUnit(unitId, data) {
  await setDoc(doc(db, 'units', unitId), data, { merge: true });
  cacheDel(`unit:${unitId}`);
  cacheDel('units:all');
}

// ===== EVENTS =====

export async function createEvent(eventData) {
  const payload = { ...eventData, createdAt: serverTimestamp() };
  const ref = await addDoc(collection(db, 'events'), payload);
  // Invalida caches de eventos para que o próximo ranking/analytics leia dados frescos
  cacheDelPrefix('events:');
  return ref.id;
}

/**
 * Busca eventos de uma unidade no período.
 * O filtro de data é aplicado NO SERVIDOR para evitar ler documentos desnecessários.
 * Cache de 2 min — suficiente para evitar releituras em navegação rápida.
 */
export async function getEvents({ unitId, stockistId, startDate, endDate, maxDocs = 200 }) {
  const cacheKey = `events:${unitId}:${startDate?.getTime() ?? 0}:${endDate?.getTime() ?? 0}`;
  const cached = cacheGet(cacheKey);
  if (cached) return stockistId ? cached.filter(e => e.stockistId === stockistId) : cached;

  const constraints = [
    where('unitId', '==', unitId),
    orderBy('createdAt', 'desc'),
  ];
  if (startDate) constraints.push(where('createdAt', '>=', Timestamp.fromDate(startDate)));
  if (endDate)   constraints.push(where('createdAt', '<=', Timestamp.fromDate(endDate)));
  constraints.push(limit(maxDocs));

  const snap = await getDocs(query(collection(db, 'events'), ...constraints));
  const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheSet(cacheKey, events, TTL.events);

  return stockistId ? events.filter(e => e.stockistId === stockistId) : events;
}

/**
 * Todos os eventos (admin) com filtro de data no servidor.
 */
export async function getAllEvents({ startDate, endDate, maxDocs = 500 } = {}) {
  const cacheKey = `events:all:${startDate?.getTime() ?? 0}:${endDate?.getTime() ?? 0}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const constraints = [orderBy('createdAt', 'desc')];
  if (startDate) constraints.push(where('createdAt', '>=', Timestamp.fromDate(startDate)));
  if (endDate)   constraints.push(where('createdAt', '<=', Timestamp.fromDate(endDate)));
  constraints.push(limit(maxDocs));

  const snap = await getDocs(query(collection(db, 'events'), ...constraints));
  const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  cacheSet(cacheKey, events, TTL.events);
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

/** Aggregate XP + stats per stockist for ranking */
export function computeRanking(events) {
  const map = {};
  for (const ev of events) {
    if (!map[ev.stockistId]) {
      map[ev.stockistId] = {
        stockistId: ev.stockistId,
        xp: 0, events: 0,
        items: 0, orders: 0, batches: 0, totalSecs: 0,
      };
    }
    const s = map[ev.stockistId];
    s.xp += ev.xp || 0;
    s.events++;

    const b = ev.batch;
    if (b && ['BATCH', 'ONLY_SEPARATION', 'ONLY_BIPPER'].includes(ev.type)) {
      s.batches++;
      s.orders    += b.totalOrders || 0;
      s.totalSecs += (b.separationSeconds || 0) + (b.bippingSeconds || 0);
      if (ev.type === 'BATCH' || ev.type === 'ONLY_BIPPER') s.items += b.totalItems || 0;
    }
    if (ev.type === 'SINGLE_ORDER') {
      s.orders++;
      s.items     += ev.batch?.totalItems || 1;
      s.totalSecs += (ev.batch?.separationSeconds || 0) + (ev.batch?.bippingSeconds || 0);
    }
  }
  return Object.values(map)
    .map(s => ({ ...s, avgSecs: s.batches > 0 ? Math.round(s.totalSecs / s.batches) : 0 }))
    .sort((a, b) => b.xp - a.xp);
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
  if (queue.length === 0) return 0;
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
 * Listener em tempo real para o telão.
 * Filtro de data aplicado NO SERVIDOR — só lê documentos do período pedido.
 * Cada novo evento dispara 1 leitura incremental (delta), não releitura total.
 */
export function watchEvents({ unitId, startDate }, callback) {
  const constraints = [
    where('unitId', '==', unitId),
    orderBy('createdAt', 'desc'),
  ];
  if (startDate) constraints.push(where('createdAt', '>=', Timestamp.fromDate(startDate)));
  constraints.push(limit(300));

  const q = query(collection(db, 'events'), ...constraints);
  return onSnapshot(q, (snap) => {
    const events = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(events);
  });
}
