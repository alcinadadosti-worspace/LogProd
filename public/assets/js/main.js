import { onAuthChange, getSessionContext } from './auth.js';
import { initRouter, registerRoute, navigate } from './router.js';
import { flushPendingEvents, getPendingEvents } from './services/firestore.js';

// Lazy screen imports
const screens = {
  login:             () => import('./screens/login.js').then(m => m.renderLogin),
  pin:               () => import('./screens/unit-pin.js').then(m => m.renderUnitPin),
  dashboard:         () => import('./screens/dashboard.js').then(m => m.renderDashboard),
  'function-complete': () => import('./screens/function-complete.js').then(m => m.renderFunctionComplete),
  'only-separator':  () => import('./screens/only-separator.js').then(m => m.renderOnlySeparator),
  'only-bipper':     () => import('./screens/only-bipper.js').then(m => m.renderOnlyBipper),
  'single-order':    () => import('./screens/single-order.js').then(m => m.renderSingleOrder),
  task:              () => import('./screens/task.js').then(m => m.renderTask),
  admin:             () => import('./screens/admin-panel.js').then(m => m.renderAdminPanel),
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

// Animate loading bar
const loadingBar = document.getElementById('loading-bar');
if (loadingBar) {
  setTimeout(() => { loadingBar.style.width = '70%'; }, 100);
}

// Register all routes
Object.entries(screens).forEach(([path, loader]) => {
  registerRoute('/' + path, async (container, params) => {
    const render = await loader();
    return render(container, params);
  });
});

// Default route
registerRoute('/', (container) => {
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
    // Check pending sync
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
