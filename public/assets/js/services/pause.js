/**
 * Pause records — supports multiple parallel pauses per stockist.
 * Storage: one localStorage key per pause, identified by a generated id.
 * Key format: `pause:<pauseId>` where pauseId is "<ts>-<rand>".
 * Each record carries its own .id so resuming knows which one to load.
 *
 * TTL: pauses older than PAUSE_TTL_MS are silently dropped when listed
 * (operators sometimes forget to resume; we don't want stale ghosts).
 */
const KEY_PREFIX = "pause:";
const PAUSE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const listeners = new Set();

function generatePauseId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function keyForId(pauseId) {
  return `${KEY_PREFIX}${pauseId}`;
}

function notify() {
  listeners.forEach((cb) => {
    try { cb(); } catch {}
  });
}

export function onPauseChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Saves a new pause. Always creates a new entry — never overwrites an
 * existing pause, even for the same stockist. Returns the generated id.
 */
export function savePause(record) {
  if (!record?.stockistId) throw new Error("savePause: stockistId is required");
  const id = record.id || generatePauseId();
  const payload = {
    ...record,
    id,
    pausedAt: record.pausedAt || Date.now(),
  };
  localStorage.setItem(keyForId(id), JSON.stringify(payload));
  notify();
  return id;
}

/** Returns a specific pause by its id, or null. */
export function getPause(pauseId) {
  if (!pauseId) return null;
  try {
    const raw = localStorage.getItem(keyForId(pauseId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Removes a specific pause by id. */
export function clearPause(pauseId) {
  if (!pauseId) return;
  localStorage.removeItem(keyForId(pauseId));
  notify();
}

/** Lists all live (not-TTL-expired) pauses for the unit. */
export function listPausesForUnit(unitId) {
  const out = [];
  const expired = [];
  const orphaned = [];
  const now = Date.now();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      const rec = raw ? JSON.parse(raw) : null;
      if (!rec) continue;
      // Legacy entries from the 1-pause-per-stockist version have no .id
      // and can't be resumed by the new banner — purge them.
      if (!rec.id) {
        orphaned.push(key);
        continue;
      }
      if (rec.unitId !== unitId) continue;
      if (rec.pausedAt && now - rec.pausedAt > PAUSE_TTL_MS) {
        expired.push(key);
        continue;
      }
      out.push(rec);
    } catch {}
  }
  for (const k of expired) {
    try { localStorage.removeItem(k); } catch {}
  }
  for (const k of orphaned) {
    try { localStorage.removeItem(k); } catch {}
  }
  return out.sort((a, b) => (a.pausedAt || 0) - (b.pausedAt || 0));
}

/** Lists all live pauses for one stockist. */
export function listPausesByStockist(stockistId) {
  if (!stockistId) return [];
  const out = [];
  const now = Date.now();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      const rec = raw ? JSON.parse(raw) : null;
      if (!rec || rec.stockistId !== stockistId) continue;
      if (rec.pausedAt && now - rec.pausedAt > PAUSE_TTL_MS) continue;
      out.push(rec);
    } catch {}
  }
  return out.sort((a, b) => (a.pausedAt || 0) - (b.pausedAt || 0));
}

export function formatPauseAge(record) {
  if (!record?.pausedAt) return "";
  const mins = Math.floor((Date.now() - record.pausedAt) / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `há ${mins}m`;
  const h = Math.floor(mins / 60);
  return `há ${h}h${String(mins % 60).padStart(2, "0")}`;
}

window.addEventListener("storage", (e) => {
  if (e.key && e.key.startsWith(KEY_PREFIX)) notify();
});
