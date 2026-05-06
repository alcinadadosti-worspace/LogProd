import { getCurrentUser, getSessionContext } from '../auth.js';
import { navigate } from '../router.js';
import { selectOperator } from './operator-select.js';
import { createEvent, saveEventLocally, getEvents } from '../services/firestore.js';
import { xpTask } from '../services/xp-engine.js';
import { playConfirm, playAuraa } from '../services/sound-engine.js';

export async function renderTask(container, params) {
  if (!getCurrentUser()) { navigate('/login'); return; }
  const ctx = getSessionContext();
  if (!ctx) { navigate('/pin'); return; }

  const unitId    = params.unit     || ctx.unitId;
  const taskId    = params.taskId   || '';
  const taskName  = decodeURIComponent(params.taskName || 'Tarefa');
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

  showConfirmStep(page, { operator, unitId, taskId, taskName, xpPerUnit });
}

async function showConfirmStep(page, state) {
  page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);

  let alreadyDone = false;
  try {
    const todayEvents = await getEvents({
      unitId: state.unitId,
      stockistId: state.operator.id,
      startDate: todayMidnight,
    });
    alreadyDone = todayEvents.some(
      ev => ev.type === 'TASK' && ev.task?.taskId === state.taskId
    );
  } catch {
    // Offline — permite registrar sem checar
  }

  if (alreadyDone) {
    page.innerHTML = `
      <div style="max-width:480px;margin:0 auto;text-align:center;">
        <div class="card card--terminal cyber-chamfer fade-in" style="padding:2rem;">
          <div style="font-size:2rem;margin-bottom:1rem;">⚠</div>
          <h2 style="font-family:var(--font-display);font-size:1rem;letter-spacing:0.2em;
                     color:var(--destructive);margin-bottom:0.5rem;">
            TAREFA JÁ REGISTRADA HOJE
          </h2>
          <div class="text-muted text-xs mb-3" style="letter-spacing:0.15em;">
            <span class="text-accent">${state.operator.name.toUpperCase()}</span>
            já registrou esta tarefa hoje.
          </div>
          <button class="btn btn--full cyber-chamfer mt-2" onclick="location.hash='/dashboard'">
            VOLTAR AO DASHBOARD
          </button>
        </div>
      </div>`;
    return;
  }

  const xpTotal = xpTask({ xpPerUnit: state.xpPerUnit, quantity: 1 });

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
        </div>

        <div style="text-align:center;margin:1.5rem 0;">
          <div class="text-muted text-xs mb-1" style="letter-spacing:0.15em;">
            VOCÊ CONFIRMA ESSA TAREFA?
          </div>
          <div style="font-family:var(--font-display);font-size:2rem;
                      color:var(--accent-2);text-shadow:var(--neon-2);">
            + ${xpTotal.toLocaleString('pt-BR')} XP
          </div>
        </div>

        <div style="display:flex;gap:0.75rem;">
          <button id="cancel-btn" class="btn btn--ghost btn--full cyber-chamfer">NÃO</button>
          <button id="confirm-btn" class="btn btn--full cyber-chamfer btn--lg">✓ SIM, CONFIRMAR</button>
        </div>
      </div>
    </div>
  `;

  page.querySelector('#cancel-btn').addEventListener('click', () => navigate('/dashboard'));

  const confirmBtn = page.querySelector('#confirm-btn');
  confirmBtn.addEventListener('click', async () => {
    confirmBtn.disabled    = true;
    confirmBtn.textContent = 'SALVANDO...';
    playConfirm();

    const eventData = {
      unitId:     state.unitId,
      stockistId: state.operator.id,
      type:       'TASK',
      xp:         xpTotal,
      task:       { taskId: state.taskId, quantity: 1 },
    };

    try { await createEvent(eventData); }
    catch {
      try {
        saveEventLocally(eventData);
        document.getElementById('sync-banner')?.classList.add('visible');
      } catch {
        page.innerHTML = `
          <div class="text-center mt-4">
            <div style="font-size:1.4rem;color:var(--destructive);">⚠ ERRO AO SALVAR</div>
            <div class="text-muted mt-2">Sem conexão e armazenamento local cheio.<br>Registre a tarefa manualmente.</div>
            <button class="btn btn--ghost cyber-chamfer mt-3" onclick="location.hash='/dashboard'">VOLTAR AO DASHBOARD</button>
          </div>`;
        return;
      }
    }

    showSummary(page, state, xpTotal);
  });
}

function showSummary(page, state, xpTotal) {
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
        <div class="stat-row"><span class="stat-label">XP</span><span class="stat-value text-accent">${xpTotal.toLocaleString('pt-BR')}</span></div>
      </div>
      <button class="btn btn--full cyber-chamfer mt-3" onclick="location.hash='/dashboard'">
        VOLTAR AO DASHBOARD
      </button>
    </div>
  `;
  const xpEl = page.querySelector('#xp-count');
  let cur = 0;
  const step = Math.ceil(xpTotal / 60);
  const t = setInterval(() => {
    cur = Math.min(cur + step, xpTotal);
    xpEl.textContent = cur.toLocaleString('pt-BR');
    if (cur >= xpTotal) { clearInterval(t); playAuraa(); }
  }, 25);
}
