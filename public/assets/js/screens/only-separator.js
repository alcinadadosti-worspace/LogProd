import { getCurrentUser, getSessionContext } from '../auth.js';
import { navigate } from '../router.js';
import { selectOperator } from './operator-select.js';
import { parseSpreadsheet, formatDate } from '../services/spreadsheet-parser.js';
import { createEvent, saveEventLocally, getGlobalConfig } from '../services/firestore.js';
import { xpBatch } from '../services/xp-engine.js';
import { Chronometer } from '../components/chronometer.js';
import { playStart, playComplete, playXP } from '../services/sound-engine.js';

export async function renderOnlySeparator(container, params) {
  if (!getCurrentUser()) { navigate('/login'); return; }
  const ctx = getSessionContext();
  if (!ctx) { navigate('/pin'); return; }

  const unitId = params.unit || ctx.unitId;

  container.innerHTML = `
    <div class="topbar">
      <button class="btn btn--ghost btn--sm" id="back-btn">← VOLTAR</button>
      <div class="topbar-logo" style="font-size:0.8rem;">APENAS SEPARADOR</div>
      <div></div>
    </div>
    <div class="page screen-enter" id="sep-page"></div>
  `;
  container.querySelector('#back-btn').addEventListener('click', () => navigate('/dashboard'));

  const page = container.querySelector('#sep-page');
  const state = { operator: null, orders: [], batchCode: '', sepSeconds: 0, config: null };

  state.config   = await getGlobalConfig();
  state.operator = await selectOperator(unitId);
  if (!state.operator) { navigate('/dashboard'); return; }

  showUpload(page, state, unitId);
}

function showUpload(page, state, unitId) {
  page.innerHTML = `
    <div class="card cyber-chamfer" style="max-width:600px;">
      <div class="section-title mb-2">IMPORTAR PLANILHA DO LOTE</div>
      <div class="text-muted text-xs mb-2" style="letter-spacing:0.1em;">
        OPERADOR: <span class="text-accent">${state.operator.name}</span>
      </div>

      <div class="file-upload-area cyber-chamfer" id="drop-area">
        <input type="file" id="file-input" accept=".xlsx,.xls,.csv">
        <div class="file-upload-icon">📂</div>
        <div class="file-upload-text">Arraste ou clique para selecionar a planilha</div>
        <div class="file-upload-hint">.xlsx · .xls · .csv</div>
      </div>
      <div id="file-status" class="text-xs text-muted mt-1"></div>
      <div id="file-err" class="input-error-msg mt-1"></div>

      <div class="mt-2 input-group" id="batch-group" style="display:none;">
        <label class="input-label">CÓDIGO DO LOTE (8 DÍGITOS)</label>
        <div class="input-wrapper">
          <span class="input-prefix">&gt;</span>
          <input id="batch-input" class="input" type="text" maxlength="8" placeholder="12345678">
        </div>
        <div class="input-error-msg" id="batch-err"></div>
      </div>

      <button id="confirm-btn" class="btn btn--full cyber-chamfer mt-3" disabled>
        CONFIRMAR E INICIAR →
      </button>
    </div>
  `;

  const fileInput  = page.querySelector('#file-input');
  const dropArea   = page.querySelector('#drop-area');
  const fileStatus = page.querySelector('#file-status');
  const fileErr    = page.querySelector('#file-err');
  const batchGroup = page.querySelector('#batch-group');
  const batchInput = page.querySelector('#batch-input');
  const batchErr   = page.querySelector('#batch-err');
  const confirmBtn = page.querySelector('#confirm-btn');
  let parsedOrders = [];

  async function handleFile(file) {
    fileErr.textContent = '';
    fileStatus.textContent = 'Processando...';
    try {
      const { orders, skipped } = await parseSpreadsheet(file);
      parsedOrders = orders;
      fileStatus.innerHTML = `✓ <span class="text-accent">${orders.length} pedidos</span>. ${skipped > 0 ? skipped + ' ignorados.' : ''}`;
      batchGroup.style.display = 'flex';
      batchGroup.style.flexDirection = 'column';
      checkReady();
    } catch (err) {
      fileErr.textContent = '> ERRO: ' + err.message;
    }
  }

  fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
  dropArea.addEventListener('dragover', e => { e.preventDefault(); dropArea.classList.add('drag-over'); });
  dropArea.addEventListener('dragleave', () => dropArea.classList.remove('drag-over'));
  dropArea.addEventListener('drop', e => {
    e.preventDefault(); dropArea.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  function checkReady() {
    confirmBtn.disabled = parsedOrders.length === 0 || !/^\d{8}$/.test(batchInput.value.trim());
  }

  batchInput.addEventListener('input', () => {
    batchErr.textContent = /^\d{8}$/.test(batchInput.value.trim()) || !batchInput.value ? ''
      : '> DEVE TER 8 DÍGITOS';
    checkReady();
  });

  confirmBtn.addEventListener('click', () => {
    if (!/^\d{8}$/.test(batchInput.value.trim())) return;
    state.orders    = parsedOrders;
    state.batchCode = batchInput.value.trim();
    showConfirmation(page, state, unitId);
  });
}

function showConfirmation(page, state, unitId) {
  const totalItems = state.orders.reduce((s, o) => s + o.items, 0);
  page.innerHTML = `
    <div class="card cyber-chamfer" style="max-width:680px;">
      <div class="section-title mb-2">CONFIRMAR LOTE</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
        <div class="stat-row"><span class="stat-label">LOTE</span><span class="stat-value text-accent">${state.batchCode}</span></div>
        <div class="stat-row"><span class="stat-label">PEDIDOS</span><span class="stat-value text-accent">${state.orders.length}</span></div>
        <div class="stat-row"><span class="stat-label">ITENS</span><span class="stat-value text-accent">${totalItems}</span></div>
        <div class="stat-row"><span class="stat-label">OPERADOR</span><span class="stat-value">${state.operator.name}</span></div>
      </div>
      <div class="order-list mb-3">
        ${state.orders.map(o => `
          <div class="order-item">
            <span class="order-code">${o.code}</span>
            <span class="order-cycle">${o.cycle}</span>
            <span class="text-muted text-xs">${o.approvedAt ? formatDate(o.approvedAt) : '—'}</span>
            <span class="order-items">${o.items} itens</span>
          </div>`).join('')}
      </div>
      <div style="display:flex;gap:0.75rem;">
        <button id="back-btn" class="btn btn--ghost cyber-chamfer-sm">← VOLTAR</button>
        <button id="start-btn" class="btn btn--full cyber-chamfer">⚡ INICIAR SEPARAÇÃO</button>
      </div>
    </div>
  `;
  page.querySelector('#back-btn').addEventListener('click', () => showUpload(page, state, unitId));
  page.querySelector('#start-btn').addEventListener('click', () => showChrono(page, state, unitId));
}

function showChrono(page, state, unitId) {
  const chrono = new Chronometer(sec => {
    const el = page.querySelector('#chrono');
    if (el) el.textContent = Chronometer.format(sec);
  });

  page.innerHTML = `
    <div style="max-width:500px;margin:0 auto;text-align:center;">
      <div class="section-title mb-2">SEPARAÇÃO EM ANDAMENTO</div>
      <div class="text-muted text-xs mb-3 cursor" style="letter-spacing:0.2em;">
        LOTE ${state.batchCode} · ${state.orders.length} PEDIDOS · ${state.orders.reduce((s,o)=>s+o.items,0)} ITENS
      </div>
      <div class="card cyber-chamfer" style="padding:3rem 2rem;">
        <div class="chrono-label mb-1">TEMPO DE SEPARAÇÃO</div>
        <div class="chrono-display" id="chrono">00:00:00</div>
        <div class="text-muted text-xs mt-2">OPERADOR: ${state.operator.name}</div>
      </div>
      <button id="finish-btn" class="btn btn--full cyber-chamfer mt-3" style="padding:1rem;">
        ■ FINALIZAR SEPARAÇÃO
      </button>
    </div>
  `;

  chrono.start();
  playStart();
  const startedAt = new Date();

  page.querySelector('#finish-btn').addEventListener('click', async () => {
    chrono.stop();
    state.sepSeconds = chrono.getSeconds();
    await save(page, state, unitId, startedAt, new Date());
  });

  return () => chrono.stop();
}

async function save(page, state, unitId, startedAt, finishedAt) {
  page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;

  const totalItems = state.orders.reduce((s, o) => s + o.items, 0);
  const xpResult   = xpBatch({ orders: state.orders.length, items: totalItems, seconds: state.sepSeconds, config: state.config });

  const eventData = {
    unitId, stockistId: state.operator.id,
    type: 'ONLY_SEPARATION', xp: xpResult.total,
    batch: {
      batchCode: state.batchCode,
      orders: state.orders.map(o => ({ code: o.code, cycle: o.cycle, approvedAt: o.approvedAt?.toISOString() ?? null, items: o.items })),
      totalOrders: state.orders.length, totalItems,
      separationSeconds: state.sepSeconds,
      separationStartedAt: startedAt.toISOString(),
      separationFinishedAt: finishedAt.toISOString(),
      bippingStartedAt: null, bippingFinishedAt: null, bippingSeconds: null, boxCodes: {},
    },
  };

  try { await createEvent(eventData); }
  catch { saveEventLocally(eventData); document.getElementById('sync-banner')?.classList.add('visible'); }

  showSummary(page, state, xpResult);
}

function showSummary(page, state, xpResult) {
  const totalItems = state.orders.reduce((s, o) => s + o.items, 0);
  page.innerHTML = `
    <div style="max-width:500px;margin:0 auto;">
      <div class="xp-summary cyber-chamfer-lg fade-in">
        <div class="xp-label">XP GANHO — SEPARAÇÃO</div>
        <span class="xp-value" id="xp-count">0</span>
        ${xpResult.bonusPct > 0 ? `<div class="xp-bonus-tag">+${(xpResult.bonusPct*100).toFixed(0)}% BÔNUS</div>` : ''}
      </div>
      <div class="card cyber-chamfer mt-2">
        <div class="section-title mb-2">RESUMO</div>
        <div class="stat-row"><span class="stat-label">LOTE</span><span class="stat-value text-accent">${state.batchCode}</span></div>
        <div class="stat-row"><span class="stat-label">PEDIDOS</span><span class="stat-value">${state.orders.length}</span></div>
        <div class="stat-row"><span class="stat-label">ITENS</span><span class="stat-value">${totalItems}</span></div>
        <div class="stat-row"><span class="stat-label">TEMPO</span><span class="stat-value">${Chronometer.format(state.sepSeconds)}</span></div>
        <div class="stat-row"><span class="stat-label">VELOCIDADE</span><span class="stat-value">${xpResult.speed.toFixed(1)} itens/min</span></div>
        <div class="stat-row"><span class="stat-label">BÔNUS</span><span class="stat-value text-accent">+${xpResult.bonus} XP</span></div>
      </div>
      <button class="btn btn--full cyber-chamfer mt-3" onclick="location.hash='/dashboard'">VOLTAR AO DASHBOARD</button>
    </div>
  `;
  playComplete();
  const xpEl = page.querySelector('#xp-count');
  let cur = 0; const target = xpResult.total; const step = Math.ceil(target / 60);
  const t = setInterval(() => { cur = Math.min(cur + step, target); xpEl.textContent = cur.toLocaleString('pt-BR'); if (cur >= target) { clearInterval(t); playXP(); } }, 25);
}
