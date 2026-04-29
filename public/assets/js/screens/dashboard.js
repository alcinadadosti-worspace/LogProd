import { getSessionContext, logout, getCurrentUser } from '../auth.js';
import { navigate } from '../router.js';
import { getUnit, getAllUnits, getTasks, getEvents, computeRanking, dateRangeForPeriod, flushPendingEvents, getPendingEvents } from '../services/firestore.js';

export async function renderDashboard(container) {
  const user = getCurrentUser();
  if (!user) { navigate('/login'); return; }

  const ctx = getSessionContext();
  if (!ctx) { navigate('/pin'); return; }

  // Flush pending events
  const pending = getPendingEvents();
  const syncBanner = document.getElementById('sync-banner');
  if (pending.length > 0) {
    syncBanner?.classList.add('visible');
    flushPendingEvents().then(rem => {
      if (rem === 0) syncBanner?.classList.remove('visible');
    });
  } else {
    syncBanner?.classList.remove('visible');
  }

  const isAdmin = ctx.mode === 'admin';
  let units = [];
  let tasks = [];

  try {
    tasks = await getTasks();
    if (isAdmin) {
      units = await getAllUnits();
    } else {
      const unit = await getUnit(ctx.unitId);
      if (unit) units = [unit];
    }
  } catch (err) {
    console.error(err);
  }

  const activeUnit = isAdmin ? (units[0] || null) : (units[0] || null);

  container.innerHTML = `
    <div id="topbar-slot"></div>
    <div class="page screen-enter" id="dashboard-page">
      ${isAdmin ? renderUnitTabs(units) : ''}
      <div id="unit-content"></div>
    </div>
  `;

  // Topbar
  renderTopbar(container.querySelector('#topbar-slot'), ctx);

  // Unit tabs for admin
  if (isAdmin && units.length > 0) {
    const tabBtns = container.querySelectorAll('.unit-tab-btn');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const uid = btn.dataset.unit;
        loadUnitContent(container.querySelector('#unit-content'), uid, tasks, isAdmin);
      });
    });
    loadUnitContent(container.querySelector('#unit-content'), units[0]?.id, tasks, isAdmin);
  } else if (activeUnit) {
    loadUnitContent(container.querySelector('#unit-content'), activeUnit.id, tasks, isAdmin);
  }
}

function renderTopbar(slot, ctx) {
  const adminAvatar = ctx.mode === 'admin'
    ? `<img src="/perfis/Alberto.jpg" alt="Alberto"
            style="width:38px;height:38px;border-radius:50%;object-fit:cover;
                   border:2px solid var(--accent);box-shadow:var(--neon);flex-shrink:0;"
            onerror="this.style.display='none';">`
    : '';
  slot.innerHTML = `
    <div class="topbar">
      <div style="display:flex;align-items:center;gap:0.75rem;">
        ${adminAvatar}
        <div>
          <div class="topbar-logo">LOGISTICA // PROD.OPS</div>
          ${ctx.mode === 'admin' ? `<div style="font-family:var(--font-terminal);font-size:0.6rem;color:var(--muted-fg);letter-spacing:0.15em;">ALBERTO · ADMINISTRADOR</div>` : ''}
        </div>
      </div>
      <div class="topbar-unit">${ctx.unitName}</div>
      <div class="topbar-actions">
        ${ctx.mode === 'admin' ? `<a href="#/admin" class="btn btn--sm btn--secondary cyber-chamfer-sm">CONFIG</a>` : ''}
        <button id="disconnect-btn" class="btn btn--sm btn--danger cyber-chamfer-sm">DISCONNECT</button>
      </div>
    </div>
  `;
  slot.querySelector('#disconnect-btn').addEventListener('click', async () => {
    await logout();
    navigate('/login');
  });
}

function renderUnitTabs(units) {
  return `
    <div class="tabs" style="margin-bottom:1.5rem;">
      ${units.map((u, i) => `
        <button class="tab-btn unit-tab-btn ${i===0?'active':''}" data-unit="${u.id}">
          ${u.name}
        </button>
      `).join('')}
    </div>
  `;
}

async function loadUnitContent(el, unitId, tasks, isAdmin) {
  if (!unitId) return;

  const unit = await getUnit(unitId);
  if (!unit) return;

  el.innerHTML = `
    <div class="mb-3">
      <div class="section-title">SEPARAÇÃO / BIPAGEM — <span>${unit.name}</span></div>
      <div class="grid-4" id="sep-grid">
        ${renderActionCard('function-complete', '⚡', 'FUNÇÃO COMPLETA', 'Separa + Bipa + Lacra. Lote completo do início ao fim.')}
        ${renderActionCard('only-separator', '📦', 'APENAS SEPARADOR', 'Importa lote e realiza a separação dos itens.')}
        ${renderActionCard('only-bipper', '📡', 'APENAS BIPADOR', 'Bipa e lacra lotes já separados.')}
        ${renderActionCard('single-order', '📋', 'PEDIDO AVULSO', 'Processa um único pedido completo.')}
      </div>
    </div>

    <div class="mb-3">
      <div class="section-title">TAREFAS OPERACIONAIS</div>
      <div class="grid-3" id="task-grid">
        ${tasks.filter(t => t.active !== false).map(t => `
          <div class="card card--task hoverable cyber-chamfer-sm"
               data-task="${t.id}" data-taskname="${t.name}" data-xp="${t.xpPerUnit}">
            <div style="flex:1">
              <div style="font-family:var(--font-terminal);font-size:0.8rem;letter-spacing:0.1em;text-transform:uppercase;">
                ${t.name}
              </div>
            </div>
            <div class="task-xp">${t.xpPerUnit} XP/un</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.25rem;">
        <div class="section-title" style="margin:0;">RANKING — <span id="rank-unit-label">${unit.name}</span></div>
        <a href="#/tela?unit=${unitId}" target="_blank"
           class="btn btn--sm btn--secondary cyber-chamfer-sm"
           title="Abrir telão em nova aba">
          ⛶ TELÃO
        </a>
      </div>
      <div class="filter-bar" id="rank-filters">
        ${['today','week','month','all'].map((p, i) => `
          <button class="filter-btn ${i===2?'active':''}" data-period="${p}">
            ${p === 'today' ? 'HOJE' : p === 'week' ? 'SEMANA' : p === 'month' ? 'MÊS' : 'SEMPRE'}
          </button>
        `).join('')}
      </div>
      <div class="card cyber-chamfer" id="ranking-card" style="padding:0;">
        <div class="text-center text-muted text-sm" style="padding:2rem;">
          <div class="spinner" style="margin:0 auto 1rem;"></div>
          Carregando ranking...
        </div>
      </div>
    </div>
  `;

  // Action card clicks
  el.querySelectorAll('[data-action]').forEach(card => {
    card.addEventListener('click', () => {
      const action = card.dataset.action;
      navigate(`/${action}?unit=${unitId}`);
    });
  });

  // Task clicks
  el.querySelectorAll('[data-task]').forEach(card => {
    card.addEventListener('click', () => {
      const taskId   = card.dataset.task;
      const taskName = card.dataset.taskname;
      const xp       = card.dataset.xp;
      navigate(`/task?unit=${unitId}&taskId=${taskId}&taskName=${encodeURIComponent(taskName)}&xp=${xp}`);
    });
  });

  // Ranking filters
  let currentPeriod = 'month';
  el.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      el.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentPeriod = btn.dataset.period;
      loadRanking(el, unit, currentPeriod);
    });
  });

  loadRanking(el, unit, currentPeriod);
}

async function loadRanking(el, unit, period) {
  const rankCard = el.querySelector('#ranking-card');
  if (!rankCard) return;

  try {
    const { startDate, endDate } = dateRangeForPeriod(period);
    const events = await getEvents({ unitId: unit.id, startDate, endDate, maxDocs: 500 });
    const ranking = computeRanking(events);

    const stockistMap = {};
    (unit.stockists || []).forEach(s => { stockistMap[s.id] = s.name; });

    if (ranking.length === 0) {
      rankCard.innerHTML = '<div class="text-center text-muted text-sm" style="padding:2rem;">Nenhum evento registrado neste período.</div>';
      return;
    }

    const maxXp = ranking[0]?.xp || 1;
    rankCard.innerHTML = ranking.slice(0, 10).map((r, i) => {
      const pos = i + 1;
      const posClass = pos === 1 ? 'gold' : pos === 2 ? 'silver' : pos === 3 ? 'bronze' : '';
      const rowClass = pos <= 3 ? `rank-${pos}` : '';
      const name = stockistMap[r.stockistId] || r.stockistId;
      const pct = Math.round((r.xp / maxXp) * 100);
      return `
        <div class="rank-row ${rowClass}" style="padding:1rem;">
          <div class="rank-pos ${posClass}">#${pos}</div>
          <div class="rank-name">${name}</div>
          <div style="flex:1;padding:0 1rem;">
            <div class="rank-bar-wrap"><div class="rank-bar" style="width:${pct}%"></div></div>
          </div>
          <div class="rank-xp">${r.xp.toLocaleString('pt-BR')} XP</div>
          <div class="text-xs text-muted" style="min-width:60px;text-align:right;">${r.events} eventos</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    rankCard.innerHTML = '<div class="text-center text-muted text-sm" style="padding:2rem;">Erro ao carregar ranking.</div>';
  }
}

function renderActionCard(action, icon, title, desc) {
  return `
    <div class="card card--action cyber-chamfer hoverable" data-action="${action}">
      <span class="card-icon">${icon}</span>
      <div class="card-title">${title}</div>
      <div class="card-desc">${desc}</div>
    </div>
  `;
}
