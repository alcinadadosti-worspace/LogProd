const KEY_PREFIX = "pause:";
const listeners = new Set();

function keyFor(stockistId) {
  return `${KEY_PREFIX}${stockistId}`;
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

export function savePause(record) {
  if (!record?.stockistId) throw new Error("savePause: stockistId is required");
  const payload = { ...record, pausedAt: record.pausedAt || Date.now() };
  localStorage.setItem(keyFor(record.stockistId), JSON.stringify(payload));
  notify();
}

export function getPauseFor(stockistId) {
  if (!stockistId) return null;
  try {
    const raw = localStorage.getItem(keyFor(stockistId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearPause(stockistId) {
  if (!stockistId) return;
  localStorage.removeItem(keyFor(stockistId));
  notify();
}

export function listPausesForUnit(unitId) {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith(KEY_PREFIX)) continue;
    try {
      const raw = localStorage.getItem(key);
      const rec = raw ? JSON.parse(raw) : null;
      if (rec && rec.unitId === unitId) out.push(rec);
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
