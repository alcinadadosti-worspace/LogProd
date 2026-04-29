// Imports estáticos — evita falha de "Failed to fetch dynamically imported module"
// em ambientes de hosting estático que fazem rewrite de SPA.
import { renderLogin }          from './screens/login.js';
import { renderUnitPin }        from './screens/unit-pin.js';
import { renderDashboard }      from './screens/dashboard.js';
import { renderFunctionComplete } from './screens/function-complete.js';
import { renderOnlySeparator }  from './screens/only-separator.js';
import { renderOnlyBipper }     from './screens/only-bipper.js';
import { renderSingleOrder }    from './screens/single-order.js';
import { renderTask }           from './screens/task.js';
import { renderAdminPanel }     from './screens/admin-panel.js';
import { renderRankingDisplay } from './screens/ranking-display.js';

import { onAuthChange, getSessionContext } from './auth.js';
import { initRouter, registerRoute, navigate } from './router.js';
import { flushPendingEvents, getPendingEvents } from './services/firestore.js';

// Mapa de rotas
const screens = {
  login:               renderLogin,
  pin:                 renderUnitPin,
  dashboard:           renderDashboard,
  'function-complete': renderFunctionComplete,
  'only-separator':    renderOnlySeparator,
  'only-bipper':       renderOnlyBipper,
  'single-order':      renderSingleOrder,
  task:                renderTask,
  admin:               renderAdminPanel,
  tela:                renderRankingDisplay,
};

function showLoading(on) {
  const ls = document.getElementById('loading-screen');
  const ap = document.getElementById('app');
  const ld = document.getElementById('landing');
  if (on) {
    ls.style.display = 'flex';
    ap.style.display = 'none';
    ld.classList.remove('visible');
  } else {
    ls.style.display = 'none';
  }
}

function showApp() {
  document.getElementById('app').style.display = 'block';
  document.getElementById('landing').classList.remove('visible');
}

function showLanding() {
  document.getElementById('landing').classList.add('visible');
  document.getElementById('app').style.display = 'none';
}

// Animar barra de loading
const loadingBar = document.getElementById('loading-bar');
if (loadingBar) setTimeout(() => { loadingBar.style.width = '70%'; }, 100);

// Registrar todas as rotas
Object.entries(screens).forEach(([path, render]) => {
  registerRoute('/' + path, (container, params) => render(container, params));
});

// Rota padrão
registerRoute('/', () => {
  const ctx = getSessionContext();
  if (ctx) navigate('/dashboard');
  else navigate('/login');
});

// 404
registerRoute('/404', (container) => {
  container.innerHTML = '<div class="page text-center mt-4"><h2 class="text-accent">404</h2><p class="text-muted">Rota não encontrada.</p><button class="btn mt-2" onclick="location.hash=\'/dashboard\'">DASHBOARD</button></div>';
});

// Boot
onAuthChange(async (user) => {
  if (loadingBar) loadingBar.style.width = '100%';
  await new Promise(r => setTimeout(r, 400));
  showLoading(false);

  if (user) {
    showApp();
    const ctx = getSessionContext();
    if (!ctx) {
      navigate('/pin');
    } else {
      const hash = window.location.hash.slice(1);
      if (!hash || hash === '/') navigate('/dashboard');
    }
    // Flush eventos pendentes
    const pending = getPendingEvents();
    if (pending.length > 0) {
      document.getElementById('sync-banner')?.classList.add('visible');
      const rem = await flushPendingEvents();
      if (rem === 0) document.getElementById('sync-banner')?.classList.remove('visible');
    }
  } else {
    showLanding();
    if (window.location.hash && window.location.hash !== '#/' && !window.location.hash.includes('login')) {
      navigate('/login');
    }
  }

  initRouter();
});

// Landing enter button
document.getElementById('landing-enter-btn')?.addEventListener('click', () => {
  showApp();
  navigate('/login');
});
