const routes = {};
let currentCleanup = null;

export function registerRoute(path, handler) {
  routes[path] = handler;
}

export function navigate(path) {
  window.location.hash = path;
}

export function getHash() {
  return window.location.hash.slice(1) || '/';
}

async function handleRoute() {
  const hash = getHash();
  const [path, ...queryParts] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(queryParts.join('?')));

  if (currentCleanup) {
    try { currentCleanup(); } catch {}
    currentCleanup = null;
  }

  const app = document.getElementById('app');
  if (!app) return;

  const handler = routes[path] || routes['/404'] || (() => {
    app.innerHTML = '<div class="page text-center mt-4 text-accent">404 — Rota não encontrada</div>';
  });

  const cleanup = await handler(app, params);
  if (typeof cleanup === 'function') currentCleanup = cleanup;
}

export function initRouter() {
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}

export function destroyRouter() {
  window.removeEventListener('hashchange', handleRoute);
}
