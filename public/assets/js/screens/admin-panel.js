import { getCurrentUser, getSessionContext, logout } from '../auth.js';
import { navigate } from '../router.js';
import {
  getGlobalConfig, setGlobalConfig,
  getTasks, setTask,
  getAllUnits, updateUnitStockists, setUnit,
  getAllEvents, computeRanking, dateRangeForPeriod,
  getPauseEvents,
} from '../services/firestore.js';
import { stockistPhoto } from '../services/photos.js';

export async function renderAdminPanel(container) {
  if (!getCurrentUser()) { navigate('/login'); return; }
  const ctx = getSessionContext();
  if (!ctx || ctx.mode !== 'admin') { navigate('/dashboard'); return; }

  container.innerHTML = `
    <div class="topbar">
      <button class="btn btn--ghost btn--sm" id="back-btn">← DASHBOARD</button>
      <div class="topbar-logo" style="font-size:0.8rem;">PAINEL ADMIN</div>
      <button id="disconnect-btn" class="btn btn--sm btn--danger cyber-chamfer-sm">DISCONNECT</button>
    </div>
    <div class="page screen-enter">
      <div class="tabs" id="admin-tabs">
        <button class="tab-btn active" data-tab="params">PARÂMETROS</button>
        <button class="tab-btn" data-tab="tasks">TAREFAS</button>
        <button class="tab-btn" data-tab="stockists">ESTOQUISTAS</button>
        <button class="tab-btn" data-tab="compare">COMPARATIVO</button>
        <button class="tab-btn" data-tab="events">EVENTOS</button>
        <button class="tab-btn" data-tab="pauses">PAUSAS</button>
      </div>
      <div id="tab-content"></div>
    </div>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => navigate('/dashboard'));
  container.querySelector('#disconnect-btn').addEventListener('click', async () => { await logout(); navigate('/login'); });

  const tabs      = container.querySelectorAll('.tab-btn');
  const tabContent = container.querySelector('#tab-content');

  const renderers = {
    params:    () => renderParams(tabContent),
    tasks:     () => renderTasks(tabContent),
    stockists: () => renderStockists(tabContent),
    compare:   () => renderCompare(tabContent),
    events:    () => renderEvents(tabContent),
    pauses:    () => renderPauses(tabContent),
  };

  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderers[btn.dataset.tab]?.();
    });
  });

  renderers.params();
}

// ─── Tab: Parâmetros ──────────────────────────────────────────────────────────
async function renderParams(el) {
  el.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;
  const config = await getGlobalConfig();

  const fields = [
    { key: 'xpBatchBase',            label: 'XP Base por lote',             type: 'number' },
    { key: 'xpPerOrder',             label: 'XP por pedido',                type: 'number' },
    { key: 'xpPerItem',              label: 'XP por item',                  type: 'number' },
    { key: 'speedTargetItemsPerMin', label: 'Meta velocidade — separação/completa (itens/min)', type: 'number', step: '0.1' },
    { key: 'speedTargetBoxesPerMin', label: 'Meta velocidade — só bipagem (caixas/min)',       type: 'number', step: '0.1' },
    { key: 'bonusThreshold10',       label: 'Limiar bônus 10% (ex: 1.0)',   type: 'number', step: '0.1' },
    { key: 'bonusThreshold20',       label: 'Limiar bônus 20% (ex: 1.2)',   type: 'number', step: '0.1' },
  ];

  el.innerHTML = `
    <div class="card cyber-chamfer" style="max-width:600px;">
      <div class="section-title mb-3">PARÂMETROS GLOBAIS DE XP</div>
      <form id="params-form">
        ${fields.map(f => `
          <div class="input-group mb-2">
            <label class="input-label">${f.label}</label>
            <div class="input-wrapper">
              <span class="input-prefix">&gt;</span>
              <input class="input" type="${f.type}" name="${f.key}"
                     value="${config[f.key] ?? ''}" step="${f.step || '1'}" min="0" required>
            </div>
          </div>
        `).join('')}
        <div id="params-msg" class="input-error-msg mt-1" style="min-height:1rem;"></div>
        <button type="submit" class="btn btn--full cyber-chamfer mt-2">SALVAR PARÂMETROS</button>
      </form>
    </div>
  `;

  el.querySelector('#params-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const msg  = el.querySelector('#params-msg');
    const data = {};
    fields.forEach(f => { data[f.key] = parseFloat(form[f.key].value); });
    try {
      await setGlobalConfig(data);
      msg.style.color = 'var(--accent)';
      msg.textContent = '✓ PARÂMETROS SALVOS';
    } catch {
      msg.style.color = 'var(--destructive)';
      msg.textContent = '> ERRO AO SALVAR';
    }
    setTimeout(() => { msg.textContent = ''; }, 3000);
  });
}

// ─── Tab: Tarefas ─────────────────────────────────────────────────────────────
async function renderTasks(el) {
  el.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;
  let tasks = await getTasks();

  function draw() {
    el.innerHTML = `
      <div class="card cyber-chamfer" style="max-width:700px;">
        <div class="section-title mb-2">GERENCIAR TAREFAS</div>
        <div id="task-list">
          ${tasks.map(t => `
            <div class="card cyber-chamfer-sm mb-1" style="padding:1rem;" id="task-row-${t.id}">
              <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
                <div class="input-wrapper" style="flex:2;">
                  <span class="input-prefix">&gt;</span>
                  <input class="input task-name" data-id="${t.id}" value="${t.name}"
                         style="min-width:140px;">
                </div>
                <div class="input-wrapper" style="flex:1;min-width:100px;">
                  <span class="input-prefix">&gt;</span>
                  <input class="input task-xp" data-id="${t.id}" type="number"
                         value="${t.xpPerUnit}" min="1">
                </div>
                <label style="display:flex;align-items:center;gap:0.35rem;font-size:0.7rem;
                              font-family:var(--font-terminal);color:var(--muted-fg);white-space:nowrap;">
                  <input type="checkbox" class="task-active" data-id="${t.id}" ${t.active !== false ? 'checked' : ''}>
                  ATIVO
                </label>
                <button class="btn btn--sm cyber-chamfer-sm task-save" data-id="${t.id}">SALVAR</button>
              </div>
              <div class="input-error-msg task-msg" data-id="${t.id}" style="min-height:1rem;"></div>
            </div>
          `).join('')}
        </div>

        <div class="section-title mt-3 mb-2">NOVA TAREFA</div>
        <form id="new-task-form" style="display:flex;gap:0.75rem;flex-wrap:wrap;align-items:flex-end;">
          <div class="input-group" style="flex:2;">
            <label class="input-label">NOME</label>
            <div class="input-wrapper"><span class="input-prefix">&gt;</span>
              <input id="new-name" class="input" type="text" placeholder="Nome da tarefa" required>
            </div>
          </div>
          <div class="input-group" style="flex:1;min-width:100px;">
            <label class="input-label">XP/UN.</label>
            <div class="input-wrapper"><span class="input-prefix">&gt;</span>
              <input id="new-xp" class="input" type="number" value="20" min="1" required>
            </div>
          </div>
          <button type="submit" class="btn cyber-chamfer-sm">+ ADICIONAR</button>
        </form>
        <div class="input-error-msg" id="new-msg" style="min-height:1rem;"></div>
      </div>
    `;

    el.querySelectorAll('.task-save').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id  = btn.dataset.id;
        const row = el.querySelector(`#task-row-${id}`);
        const name   = row.querySelector('.task-name').value.trim();
        const xp     = parseInt(row.querySelector('.task-xp').value, 10);
        const active = row.querySelector('.task-active').checked;
        const msg    = row.querySelector('.task-msg');
        if (!name || isNaN(xp) || xp < 1) { msg.textContent = '> Dados inválidos'; return; }
        try {
          await setTask(id, { name, xpPerUnit: xp, active });
          msg.style.color = 'var(--accent)';
          msg.textContent = '✓ SALVO';
          const idx = tasks.findIndex(t => t.id === id);
          if (idx >= 0) tasks[idx] = { ...tasks[idx], name, xpPerUnit: xp, active };
        } catch { msg.style.color = 'var(--destructive)'; msg.textContent = '> ERRO'; }
        setTimeout(() => { msg.textContent = ''; }, 2500);
      });
    });

    el.querySelector('#new-task-form').addEventListener('submit', async e => {
      e.preventDefault();
      const name = el.querySelector('#new-name').value.trim();
      const xp   = parseInt(el.querySelector('#new-xp').value, 10);
      const msg  = el.querySelector('#new-msg');
      if (!name || isNaN(xp)) return;
      const id = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      try {
        await setTask(id, { name, xpPerUnit: xp, active: true });
        tasks.push({ id, name, xpPerUnit: xp, active: true });
        msg.style.color = 'var(--accent)';
        msg.textContent = '✓ TAREFA ADICIONADA';
        draw();
      } catch { msg.style.color = 'var(--destructive)'; msg.textContent = '> ERRO AO CRIAR'; }
    });
  }

  draw();
}

// ─── Tab: Estoquistas ─────────────────────────────────────────────────────────
async function renderStockists(el) {
  el.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;
  const units = await getAllUnits();

  function draw() {
    el.innerHTML = units.map(unit => `
      <div class="card cyber-chamfer mb-2" style="max-width:700px;">
        <div class="section-title mb-2">${unit.name}</div>
        <div id="stockists-${unit.id}">
          ${(unit.stockists || []).map(s => `
            <div style="display:flex;align-items:center;gap:0.75rem;padding:0.4rem 0;
                        border-bottom:1px solid var(--border);">
              <span style="flex:1;font-size:0.85rem;">${s.name}</span>
              <label style="display:flex;align-items:center;gap:0.25rem;font-size:0.65rem;
                            font-family:var(--font-terminal);color:var(--muted-fg);">
                <input type="checkbox" class="s-active" data-unit="${unit.id}" data-id="${s.id}"
                       ${s.active !== false ? 'checked' : ''}> ATIVO
              </label>
              <button class="btn btn--sm btn--danger cyber-chamfer-sm s-remove"
                      data-unit="${unit.id}" data-id="${s.id}">REMOVER</button>
            </div>
          `).join('') || '<div class="text-muted text-xs">Nenhum estoquista.</div>'}
        </div>

        <form class="add-stockist-form" data-unit="${unit.id}"
              style="display:flex;gap:0.5rem;margin-top:1rem;flex-wrap:wrap;">
          <div class="input-wrapper" style="flex:1;">
            <span class="input-prefix">&gt;</span>
            <input class="input new-stockist-name" type="text" placeholder="Nome completo" required>
          </div>
          <button type="submit" class="btn btn--sm cyber-chamfer-sm">+ ADICIONAR</button>
        </form>
        <div class="input-error-msg s-msg-${unit.id}" style="min-height:1rem;"></div>
      </div>
    `).join('');

    el.querySelectorAll('.s-active').forEach(cb => {
      cb.addEventListener('change', async () => {
        const unitId = cb.dataset.unit;
        const sid    = cb.dataset.id;
        const unit   = units.find(u => u.id === unitId);
        if (!unit) return;
        const stockists = (unit.stockists || []).map(s =>
          s.id === sid ? { ...s, active: cb.checked } : s
        );
        await updateUnitStockists(unitId, stockists);
        unit.stockists = stockists;
      });
    });

    el.querySelectorAll('.s-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Remover este estoquista? Seus eventos históricos serão mantidos.`)) return;
        const unitId = btn.dataset.unit;
        const sid    = btn.dataset.id;
        const unit   = units.find(u => u.id === unitId);
        if (!unit) return;
        unit.stockists = (unit.stockists || []).filter(s => s.id !== sid);
        await updateUnitStockists(unitId, unit.stockists);
        draw();
      });
    });

    el.querySelectorAll('.add-stockist-form').forEach(form => {
      form.addEventListener('submit', async e => {
        e.preventDefault();
        const unitId = form.dataset.unit;
        const name   = form.querySelector('.new-stockist-name').value.trim();
        const msg    = el.querySelector(`.s-msg-${unitId}`);
        if (!name) return;
        const unit = units.find(u => u.id === unitId);
        if (!unit) return;
        const id = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        if ((unit.stockists || []).some(s => s.id === id)) {
          msg.textContent = '> Nome já existe'; return;
        }
        unit.stockists = [...(unit.stockists || []), { id, name, active: true }];
        await updateUnitStockists(unitId, unit.stockists);
        msg.style.color = 'var(--accent)'; msg.textContent = '✓ ADICIONADO';
        draw();
      });
    });
  }

  draw();
}

// ─── Tab: Comparativo ────────────────────────────────────────────────────────
async function renderCompare(el) {
  el.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;

  const [units, events] = await Promise.all([getAllUnits(), getAllEvents({ maxDocs: 1000 })]);

  const byUnit = {};
  units.forEach(u => { byUnit[u.id] = { unit: u, events: [] }; });
  events.forEach(ev => { if (byUnit[ev.unitId]) byUnit[ev.unitId].events.push(ev); });

  el.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
      ${units.map(u => {
        const data    = byUnit[u.id];
        const ranking = computeRanking(data.events);
        const totalXp = data.events.reduce((s, e) => s + (e.xp || 0), 0);
        const stockistMap = {};
        (u.stockists || []).forEach(s => { stockistMap[s.id] = s.name; });

        return `
          <div class="card cyber-chamfer">
            <div class="section-title mb-2">${u.name}</div>
            <div class="stat-row mb-1">
              <span class="stat-label">XP TOTAL</span>
              <span class="stat-value text-accent" style="font-family:var(--font-display);font-size:1.2rem;">
                ${totalXp.toLocaleString('pt-BR')}
              </span>
            </div>
            <div class="stat-row mb-2">
              <span class="stat-label">EVENTOS</span>
              <span class="stat-value">${data.events.length}</span>
            </div>
            <div class="section-title mb-1" style="font-size:0.6rem;">TOP 5</div>
            ${ranking.slice(0, 5).map((r, i) => `
              <div class="rank-row" style="padding:0.5rem 0;">
                <div class="rank-pos ${i===0?'gold':i===1?'silver':i===2?'bronze':''}">#${i+1}</div>
                <div class="rank-name" style="font-size:0.75rem;">${stockistMap[r.stockistId] || r.stockistId}</div>
                <div class="rank-xp" style="font-size:0.75rem;">${r.xp.toLocaleString('pt-BR')} XP</div>
              </div>
            `).join('') || '<div class="text-muted text-xs">Sem dados.</div>'}
          </div>
        `;
      }).join('')}
    </div>

    <div class="card cyber-chamfer mt-2">
      <div class="section-title mb-2">XP POR UNIDADE (COMPARATIVO)</div>
      <canvas id="compare-chart" height="120"></canvas>
    </div>
  `;

  // Chart.js comparison
  if (typeof Chart !== 'undefined') {
    const canvas = el.querySelector('#compare-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: units.map(u => u.name),
        datasets: [{
          label: 'XP Total',
          data: units.map(u => byUnit[u.id].events.reduce((s, e) => s + (e.xp || 0), 0)),
          backgroundColor: ['rgba(0,255,136,0.4)', 'rgba(0,212,255,0.4)'],
          borderColor:     ['#00ff88', '#00d4ff'],
          borderWidth: 2,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { labels: { color: '#e0e0e0', font: { family: 'Share Tech Mono' } } } },
        scales: {
          x: { ticks: { color: '#6b7280' }, grid: { color: '#2a2a3a' } },
          y: { ticks: { color: '#6b7280' }, grid: { color: '#2a2a3a' } },
        },
      },
    });
  }
}

// ─── Tab: Eventos ─────────────────────────────────────────────────────────────
async function renderEvents(el) {
  el.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;

  const [units, events] = await Promise.all([getAllUnits(), getAllEvents({ maxDocs: 500 })]);
  const unitMap = {};
  units.forEach(u => {
    unitMap[u.id] = u.name;
    (u.stockists || []).forEach(s => { unitMap[u.id + '_' + s.id] = s.name; });
  });

  function stockistName(unitId, stockistId) {
    return unitMap[unitId + '_' + stockistId] || stockistId;
  }

  let filtered = [...events];

  function formatTs(ts) {
    if (!ts) return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function draw(data) {
    const table = data.map(ev => `
      <tr>
        <td>${formatTs(ev.createdAt)}</td>
        <td>${unitMap[ev.unitId] || ev.unitId}</td>
        <td>${stockistName(ev.unitId, ev.stockistId)}</td>
        <td><span class="badge badge--accent">${ev.type}</span></td>
        <td class="text-accent" style="font-family:var(--font-display);">${ev.xp || 0}</td>
        <td class="text-muted text-xs">${ev.batch?.batchCode || ev.task?.taskId || ev.singleOrder?.orderCode || '—'}</td>
      </tr>
    `).join('');

    el.querySelector('#events-table tbody').innerHTML = table || '<tr><td colspan="6" class="text-center text-muted">Sem eventos.</td></tr>';
  }

  el.innerHTML = `
    <div class="card cyber-chamfer" style="max-width:100%;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem;">
        <div class="section-title" style="margin:0;">HISTÓRICO DE EVENTOS</div>
        <div style="display:flex;gap:0.5rem;flex-wrap:wrap;align-items:center;">
          <select id="filter-unit" class="input input--no-prefix" style="width:160px;padding-left:0.75rem;">
            <option value="">Todas as unidades</option>
            ${units.map(u => `<option value="${u.id}">${u.name}</option>`).join('')}
          </select>
          <select id="filter-type" class="input input--no-prefix" style="width:160px;padding-left:0.75rem;">
            <option value="">Todos os tipos</option>
            <option value="BATCH">BATCH</option>
            <option value="ONLY_SEPARATION">SEPARAÇÃO</option>
            <option value="ONLY_BIPPING">BIPAGEM</option>
            <option value="SINGLE_ORDER">PEDIDO AVULSO</option>
            <option value="TASK">TAREFA</option>
          </select>
          <button id="export-csv" class="btn btn--sm btn--secondary cyber-chamfer-sm">EXPORTAR CSV</button>
        </div>
      </div>

      <div style="overflow-x:auto;">
        <table class="data-table" id="events-table">
          <thead>
            <tr>
              <th>DATA/HORA</th><th>UNIDADE</th><th>ESTOQUISTA</th>
              <th>TIPO</th><th>XP</th><th>REFERÊNCIA</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
      <div class="text-muted text-xs mt-1" id="event-count">${events.length} eventos</div>
    </div>
  `;

  draw(filtered);

  function applyFilters() {
    const unit = el.querySelector('#filter-unit').value;
    const type = el.querySelector('#filter-type').value;
    filtered = events.filter(ev =>
      (!unit || ev.unitId === unit) && (!type || ev.type === type)
    );
    draw(filtered);
    el.querySelector('#event-count').textContent = filtered.length + ' eventos';
  }

  el.querySelector('#filter-unit').addEventListener('change', applyFilters);
  el.querySelector('#filter-type').addEventListener('change', applyFilters);

  el.querySelector('#export-csv').addEventListener('click', () => {
    const rows = [['Data', 'Unidade', 'Estoquista', 'Tipo', 'XP', 'Referência']];
    filtered.forEach(ev => {
      rows.push([
        formatTs(ev.createdAt),
        unitMap[ev.unitId] || ev.unitId,
        stockistName(ev.unitId, ev.stockistId),
        ev.type,
        ev.xp || 0,
        ev.batch?.batchCode || ev.task?.taskId || ev.singleOrder?.orderCode || '',
      ]);
    });
    const csv  = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'eventos.csv'; a.click();
    URL.revokeObjectURL(url);
  });
}

// ─── Tab: Pausas ──────────────────────────────────────────────────────────────
async function renderPauses(el) {
  el.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;

  let period = 'month';

  function fmtDuration(secs) {
    if (!secs || secs < 0) return '—';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
    if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
    return `${s}s`;
  }

  function fmtDate(d) {
    if (!d || !(d instanceof Date) || Number.isNaN(d.getTime()) || d.getTime() <= 0) return '—';
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    const hh = String(d.getHours()).padStart(2, '0');
    const mn = String(d.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yy} ${hh}:${mn}`;
  }

  function toDateLocal(ts) {
    if (!ts) return null;
    if (typeof ts.toDate === 'function') return ts.toDate();
    if (ts instanceof Date) return ts;
    return new Date(ts);
  }

  async function load() {
    el.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;
    const { startDate } = dateRangeForPeriod(period);
    let pauses;
    try {
      pauses = await getPauseEvents({ startDate, maxDocs: 1000 });
    } catch (err) {
      el.innerHTML = `<div class="card cyber-chamfer text-center" style="padding:2rem;"><div class="text-destructive">Erro ao carregar: ${String(err.message || err)}</div></div>`;
      return;
    }
    render(pauses);
  }

  function render(pauses) {
    // Aggregate per stockist
    const byStockist = {};
    for (const p of pauses) {
      const sid = p.stockistId;
      if (!sid) continue;
      if (!byStockist[sid]) {
        byStockist[sid] = {
          stockistId: sid,
          name: p.stockistName || sid,
          totalSeconds: 0,
          count: 0,
          longest: 0,
          longestLabel: '',
          pauses: [],
        };
      }
      const rec = byStockist[sid];
      const dur = p.durationSeconds || 0;
      rec.totalSeconds += dur;
      rec.count++;
      if (dur > rec.longest) {
        rec.longest = dur;
        rec.longestLabel = p.label || '—';
      }
      rec.pauses.push({
        when: toDateLocal(p.pausedAt) || toDateLocal(p.createdAt),
        resumedAt: toDateLocal(p.resumedAt),
        durationSeconds: dur,
        label: p.label || '—',
        kind: p.kind || '',
        phase: p.phase || '',
      });
    }
    const records = Object.values(byStockist).sort((a, b) => b.totalSeconds - a.totalSeconds);

    el.innerHTML = `
      <div class="card cyber-chamfer mb-2" style="padding:1rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;">
          <div class="section-title" style="margin:0;">⏸ TEMPO DE PAUSA ACUMULADO</div>
          <div style="display:flex;gap:0.4rem;flex-wrap:wrap;">
            ${['today', 'week', 'month', 'all']
              .map(
                (p) => `
              <button class="filter-btn period-btn ${p === period ? 'active' : ''}" data-period="${p}">
                ${p === 'today' ? 'HOJE' : p === 'week' ? 'SEMANA' : p === 'month' ? 'MÊS' : 'SEMPRE'}
              </button>`,
              )
              .join('')}
          </div>
        </div>
        <div class="text-muted text-xs mt-2" style="font-family:var(--font-terminal);letter-spacing:0.08em;line-height:1.4;">
          Pausas concluídas (pausadas e retomadas) no período. O tempo NÃO conta como trabalho — é tempo decorrido entre clicar PAUSAR e RETOMAR. ${pauses.length} ciclo(s) registrado(s).
        </div>
      </div>

      ${records.length === 0
        ? `<div class="card cyber-chamfer text-center" style="padding:2rem;color:var(--muted-fg);font-family:var(--font-terminal);font-size:0.8rem;">Sem pausas registradas no período.</div>`
        : `
        <div class="card cyber-chamfer" style="padding:0;">
          <table style="width:100%;border-collapse:collapse;font-family:var(--font-terminal);font-size:0.72rem;">
            <thead>
              <tr style="border-bottom:2px solid var(--border);color:var(--muted-fg);font-size:0.6rem;letter-spacing:0.12em;">
                <th style="padding:0.6rem;text-align:left;">ESTOQUISTA</th>
                <th style="padding:0.6rem;text-align:right;">Nº PAUSAS</th>
                <th style="padding:0.6rem;text-align:right;">TEMPO TOTAL</th>
                <th style="padding:0.6rem;text-align:right;">MÉDIA</th>
                <th style="padding:0.6rem;text-align:left;">MAIOR PAUSA</th>
                <th style="padding:0.6rem;text-align:center;">DETALHES</th>
              </tr>
            </thead>
            <tbody>
              ${records.map((r, idx) => {
                const photo = stockistPhoto(r.name);
                const avg = r.count > 0 ? Math.round(r.totalSeconds / r.count) : 0;
                const isTop = idx === 0;
                return `
                <tr style="border-bottom:1px solid var(--border);${isTop ? 'background:rgba(217,119,6,0.06);' : ''}">
                  <td style="padding:0.5rem 0.6rem;">
                    <div style="display:flex;align-items:center;gap:0.4rem;">
                      ${photo
                        ? `<img src="${photo}" style="width:24px;height:24px;border-radius:50%;object-fit:cover;border:1px solid var(--border);" onerror="this.style.display='none'">`
                        : ''
                      }
                      <span style="${isTop ? 'color:#b45309;font-weight:700;' : ''}">${r.name}</span>
                    </div>
                  </td>
                  <td style="padding:0.5rem 0.6rem;text-align:right;">${r.count}</td>
                  <td style="padding:0.5rem 0.6rem;text-align:right;font-weight:700;color:${isTop ? '#b45309' : 'var(--fg)'};">${fmtDuration(r.totalSeconds)}</td>
                  <td style="padding:0.5rem 0.6rem;text-align:right;color:var(--muted-fg);">${fmtDuration(avg)}</td>
                  <td style="padding:0.5rem 0.6rem;font-size:0.65rem;">
                    <span style="color:var(--fg);">${fmtDuration(r.longest)}</span>
                    <span style="color:var(--muted-fg);">· ${r.longestLabel}</span>
                  </td>
                  <td style="padding:0.5rem 0.6rem;text-align:center;">
                    <button class="btn btn--ghost btn--sm pause-detail-btn" data-id="${r.stockistId}" style="padding:0.25rem 0.6rem;font-size:0.6rem;">VER ▾</button>
                  </td>
                </tr>
                <tr id="pause-detail-${r.stockistId}" style="display:none;">
                  <td colspan="6" style="padding:0;background:var(--muted);">
                    <div style="padding:0.5rem 1rem;">
                      <table style="width:100%;font-size:0.65rem;font-family:var(--font-terminal);">
                        <thead>
                          <tr style="color:var(--muted-fg);font-size:0.55rem;letter-spacing:0.1em;">
                            <th style="padding:0.3rem;text-align:left;">QUANDO PAUSOU</th>
                            <th style="padding:0.3rem;text-align:left;">TRABALHO</th>
                            <th style="padding:0.3rem;text-align:left;">FASE</th>
                            <th style="padding:0.3rem;text-align:right;">DURAÇÃO</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${r.pauses
                            .sort((a, b) => (b.when?.getTime() || 0) - (a.when?.getTime() || 0))
                            .slice(0, 30)
                            .map(p => `
                              <tr style="border-top:1px solid var(--border);">
                                <td style="padding:0.3rem;color:var(--muted-fg);">${fmtDate(p.when)}</td>
                                <td style="padding:0.3rem;color:var(--accent);">${p.label}</td>
                                <td style="padding:0.3rem;color:var(--muted-fg);">${p.phase === 'separation' ? 'separação' : p.phase === 'bipping' ? 'bipagem' : p.phase || '—'}</td>
                                <td style="padding:0.3rem;text-align:right;color:var(--fg);">${fmtDuration(p.durationSeconds)}</td>
                              </tr>
                            `).join('')}
                          ${r.pauses.length > 30 ? `<tr><td colspan="4" style="padding:0.4rem;text-align:center;color:var(--muted-fg);font-size:0.6rem;">+ ${r.pauses.length - 30} pausas mais antigas omitidas</td></tr>` : ''}
                        </tbody>
                      </table>
                    </div>
                  </td>
                </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
        `}
    `;

    el.querySelectorAll('.period-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        period = btn.dataset.period;
        load();
      });
    });

    el.querySelectorAll('.pause-detail-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const row = el.querySelector(`#pause-detail-${btn.dataset.id}`);
        if (!row) return;
        const showing = row.style.display !== 'none';
        row.style.display = showing ? 'none' : 'table-row';
        btn.textContent = showing ? 'VER ▾' : 'OCULTAR ▴';
      });
    });
  }

  await load();
}
