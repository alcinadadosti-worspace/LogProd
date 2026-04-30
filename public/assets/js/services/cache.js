const _store = new Map();

export function cacheGet(key) {
  const entry = _store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { _store.delete(key); return null; }
  return entry.data;
}

export function cacheSet(key, data, ttlMs) {
  _store.set(key, { data, exp: Date.now() + ttlMs });
}

export function cacheDel(key) {
  _store.delete(key);
}

export function cacheDelPrefix(prefix) {
  for (const k of _store.keys()) {
    if (k.startsWith(prefix)) _store.delete(k);
  }
}

/**
 * Itera entradas vivas cuja chave começa com `prefix` e chama `fn(key, entry)`.
 * Permite mutação direta de `entry.data` para evitar refetch após criação.
 * Entradas expiradas são removidas durante a iteração.
 */
export function cacheUpdateMatching(prefix, fn) {
  const now = Date.now();
  for (const [k, entry] of _store.entries()) {
    if (!k.startsWith(prefix)) continue;
    if (now > entry.exp) { _store.delete(k); continue; }
    fn(k, entry);
  }
}
