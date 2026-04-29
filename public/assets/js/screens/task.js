import { getCurrentUser, getSessionContext } from '../auth.js';
import { navigate } from '../router.js';
import { selectOperator } from './operator-select.js';
import { createEvent, saveEventLocally } from '../services/firestore.js';
import { xpTask } from '../services/xp-engine.js';
import { playConfirm, playXP } from '../services/sound-engine.js';

export async function renderTask(container, params) {
  if (!getCurrentUser()) { navigate('/login'); return; }
  const ctx = getSessionContext();
  if (!ctx) { navigate('/pin'); return; }

  const unitId   = params.unit     || ctx.unitId;
  const taskId   = params.taskId   || '';
  const taskName = decodeURIComponent(params.taskName || 'Tarefa');
  const xpPerUnit = parseInt(params.xp, 10) || 20;

  container.innerHTML = `
    <div class="topbar">
      <button class="btn btn--ghost btn--sm" id="back-btn">← VOLTAR</button>
      <div class="topbar-logo" style="font-size:0.8rem;">${taskName.toUpperCase()}</div>
      <div></div>
    </div>
    <div class="page screen-enter" id="task-page"></div>
  `;
  container.querySelector('#back-btn').addEventListener('click', () => navigate('/dashboard'));

  const page = container.querySelector('#task-page');
  const operator = await selectOperator(unitId);
  if (!operator) { navigate('/dashboard'); return; }

  showQuantityStep(page, { operator, unitId, taskId, taskName, xpPerUnit });
}

function showQuantityStep(page, state) {
  page.innerHTML = `
    <div style="max-width:480px;margin:0 auto;text-align:center;">
      <div class="card card--terminal cyber-chamfer fade-in" style="padding:2rem;text-align:left;">
        <div class="terminal-dots">
          <div class="terminal-dot terminal-dot--red"></div>
          <div class="terminal-dot terminal-dot--yellow"></div>
          <div class="terminal-dot terminal-dot--green"></div>
        </div>

        <h2 style="font-family:var(--font-display);font-size:1rem;letter-spacing:0.2em;
                   color:var(--accent);text-shadow:var(--neon);margin-bottom:0.5rem;">
          ${state.taskName.toUpperCase()}
        </h2>
        <div class="text-muted text-xs mb-3" style="letter-spacing:0.15em;">
          OPERADOR: <span class="text-accent">${state.operator.name}</span>
          &nbsp;·&nbsp; <span class="text-accent">${state.xpPerUnit} XP/unidade</span>
        </div>

        <div class="input-group mb-3">
          <label class="input-label">QUANTAS VEZES VOCÊ FEZ ESSA TAREFA HOJE?</label>
          <div class="input-wrapper">
            <span class="input-prefix">&gt;</span>
            <input id="qty-input" class="input" type="number" min="1" value="1"
                   placeholder="1" inputmode="numeric" autofocus>
          </div>
          <div class="input-error-msg" id="qty-err"></div>
        </div>

        <div id="xp-preview" class="text-center mb-3"
             style="font-family:var(--font-display);font-size:1.5rem;color:var(--accent-2);text-shadow:var(--neon-2);">
          ${state.xpPerUnit} XP
        </div>

        <button id="confirm-btn" class="btn btn--full cyber-chamfer btn--lg">
          ✓ REGISTRAR TAREFA
        </button>
      </div>
    </div>
  `;

  const qtyInput   = page.querySelector('#qty-input');
  const qtyErr     = page.querySelector('#qty-err');
  const xpPreview  = page.querySelector('#xp-preview');
  const confirmBtn = page.querySelector('#confirm-btn');

  function update() {
    const q = parseInt(qtyInput.value, 10);
    if (isNaN(q) || q < 1) {
      qtyErr.textContent     = '> MÍNIMO 1';
      confirmBtn.disabled    = true;
      xpPreview.textContent  = '—';
    } else {
      qtyErr.textContent     = '';
      confirmBtn.disabled    = false;
      const total            = xpTask({ xpPerUnit: state.xpPerUnit, quantity: q });
      xpPreview.textContent  = total.toLocaleString('pt-BR') + ' XP';
    }
  }

  qtyInput.addEventListener('input', update);

  confirmBtn.addEventListener('click', async () => {
    const quantity = parseInt(qtyInput.value, 10);
    if (isNaN(quantity) || quantity < 1) return;

    confirmBtn.disabled    = true;
    confirmBtn.textContent = 'SALVANDO...';
    playConfirm();

    const xpTotal = xpTask({ xpPerUnit: state.xpPerUnit, quantity });
    const eventData = {
      unitId:     state.unitId,
      stockistId: state.operator.id,
      type:       'TASK',
      xp:         xpTotal,
      task:       { taskId: state.taskId, quantity },
    };

    try { await createEvent(eventData); }
    catch { saveEventLocally(eventData); document.getElementById('sync-banner')?.classList.add('visible'); }

    showSummary(page, state, xpTotal, quantity);
  });
}

function showSummary(page, state, xpTotal, quantity) {
  page.innerHTML = `
    <div style="max-width:480px;margin:0 auto;">
      <div class="xp-summary cyber-chamfer-lg fade-in">
        <div class="xp-label">XP GANHO — TAREFA</div>
        <span class="xp-value" id="xp-count">0</span>
      </div>
      <div class="card cyber-chamfer mt-2">
        <div class="section-title mb-2">RESUMO</div>
        <div class="stat-row"><span class="stat-label">TAREFA</span><span class="stat-value">${state.taskName}</span></div>
        <div class="stat-row"><span class="stat-label">OPERADOR</span><span class="stat-value">${state.operator.name}</span></div>
        <div class="stat-row"><span class="stat-label">QUANTIDADE</span><span class="stat-value text-accent">${quantity}</span></div>
        <div class="stat-row"><span class="stat-label">XP/UNIDADE</span><span class="stat-value">${state.xpPerUnit}</span></div>
        <div class="stat-row"><span class="stat-label">XP TOTAL</span><span class="stat-value text-accent">${xpTotal.toLocaleString('pt-BR')}</span></div>
      </div>
      <button class="btn btn--full cyber-chamfer mt-3" onclick="location.hash='/dashboard'">
        VOLTAR AO DASHBOARD
      </button>
    </div>
  `;
  const xpEl = page.querySelector('#xp-count');
  let cur = 0; const step = Math.ceil(xpTotal / 60);
  const t = setInterval(() => { cur = Math.min(cur + step, xpTotal); xpEl.textContent = cur.toLocaleString('pt-BR'); if (cur >= xpTotal) { clearInterval(t); playXP(); } }, 25);
}
