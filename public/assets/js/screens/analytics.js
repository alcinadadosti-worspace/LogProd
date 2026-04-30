import { getCurrentUser, getSessionContext } from '../auth.js';
import { navigate } from '../router.js';
import { getEvents, getAllEvents, getAllUnits, getUnit, dateRangeForPeriod, computeRanking } from '../services/firestore.js';
import { stockistPhoto } from '../services/photos.js';

// Cache de 5 min para analytics — evita centenas de leituras desnecessárias
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function toDate(ts) {
  if (!ts) return new Date(0);
  if (typeof ts.toDate === 'function') return ts.toDate();
  return new Date(ts);
}

function fmtTime(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2,'0')}m`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

function fmtN(n) { return (n || 0).toLocaleString('pt-BR'); }

// ─── Chart color palette ─────────────────────────────────────────────────────
const C = {
  green:  '#059669', purple: '#7c3aed', blue: '#0284c7',
  amber:  '#d97706', red:    '#dc2626', gray:  '#6d28d9',
  gold: '#ffdd00', silver: '#c0c0c0', bronze: '#cd7f32',
  gridLine: 'rgba(109,40,217,0.08)', tickColor: '#6d28d9',
};

const typeLabels = {
  BATCH: 'Função Completa', ONLY_SEPARATION: 'Só Separação',
  ONLY_BIPPING: 'Só Bipador', SINGLE_ORDER: 'Pedido Avulso', TASK: 'Tarefas',
};

export async function renderAnalytics(container, params) {
  if (!getCurrentUser()) { navigate('/login'); return; }
  const ctx = getSessionContext();
  if (!ctx) { navigate('/pin'); return; }

  const isAdmin = ctx.mode === 'admin';
  let period = params.period || 'month';

  container.innerHTML = `
    <div class="topbar">
      <button class="btn btn--ghost btn--sm" id="back-btn">← VOLTAR</button>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <div class="topbar-logo" style="font-size:0.85rem;">📊 ANALYTICS</div>
        <div id="cache-badge" style="display:none;font-family:var(--font-terminal);font-size:0.6rem;
             color:var(--muted-fg);letter-spacing:0.1em;background:var(--muted);padding:0.15rem 0.4rem;"></div>
      </div>
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
        ${['today','week','month','all'].map(p => `
          <button class="filter-btn period-btn ${p===period?'active':''}" data-period="${p}">
            ${p==='today'?'HOJE':p==='week'?'SEMANA':p==='month'?'MÊS':'SEMPRE'}
          </button>`).join('')}
        <button id="refresh-btn" class="btn btn--ghost btn--sm" title="Forçar atualização">↺</button>
      </div>
    </div>
    <div class="page screen-enter" id="an-page">
      <div class="text-center mt-4">
        <div class="spinner" style="margin:0 auto;"></div>
        <div class="text-muted mt-2" style="font-family:var(--font-terminal);letter-spacing:0.2em;font-size:0.75rem;">PROCESSANDO DADOS...</div>
      </div>
    </div>
  `;

  container.querySelector('#back-btn').addEventListener('click', () => navigate('/dashboard'));
  container.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      period = btn.dataset.period;
      load();
    });
  });
  container.querySelector('#refresh-btn').addEventListener('click', () => load(true));

  const page = container.querySelector('#an-page');
  const cacheBadge = container.querySelector('#cache-badge');

  async function load(forceRefresh = false) {
    const cacheKey = `${period}:${isAdmin ? 'admin' : ctx.unitId}`;

    if (!forceRefresh) {
      const hit = _cache.get(cacheKey);
      if (hit && Date.now() - hit.ts < CACHE_TTL) {
        const age = Math.floor((Date.now() - hit.ts) / 1000);
        cacheBadge.style.display = '';
        cacheBadge.textContent   = `CACHE · ${age}s atrás`;
        render(hit.events, hit.units, hit.stockistNames);
        return;
      }
    }

    cacheBadge.style.display = 'none';
    page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div><div class="text-muted mt-2" style="font-family:var(--font-terminal);letter-spacing:0.2em;font-size:0.75rem;">PROCESSANDO DADOS...</div></div>`;

    try {
      const { startDate } = dateRangeForPeriod(period);
      let events = [], units = [], stockistNames = {};

      if (isAdmin) {
        [events, units] = await Promise.all([
          getAllEvents({ startDate, maxDocs: 1000 }),
          getAllUnits(),
        ]);
      } else {
        const [unit, evs] = await Promise.all([
          getUnit(ctx.unitId),
          getEvents({ unitId: ctx.unitId, startDate, maxDocs: 500 }),
        ]);
        events = evs;
        units  = unit ? [unit] : [];
      }

      units.forEach(u => (u.stockists || []).forEach(s => { stockistNames[s.id] = s.name; }));
      _cache.set(cacheKey, { events, units, stockistNames, ts: Date.now() });
      cacheBadge.style.display = 'none';
      render(events, units, stockistNames);
    } catch (err) {
      page.innerHTML = `<div class="text-center mt-4 text-destructive">Erro: ${err.message}</div>`;
    }
  }

  function render(events, units, stockistNames) {
    // Destroy previous charts so canvas can be reused
    Object.values(Chart.instances || {}).forEach(c => c.destroy());

    // ── KPIs ──────────────────────────────────────────────────────────
    const totalXP      = events.reduce((s, e) => s + (e.xp || 0), 0);
    const batchEvts    = events.filter(e => ['BATCH','ONLY_SEPARATION','ONLY_BIPPING'].includes(e.type));
    const totalBatches = batchEvts.length;
    const totalOrders  = events.reduce((s, e) => {
      if (e.batch?.totalOrders) return s + e.batch.totalOrders;
      return e.type === 'SINGLE_ORDER' ? s + 1 : s;
    }, 0);
    const totalItems = events.reduce((s, e) => {
      if ((e.type === 'BATCH' || e.type === 'ONLY_BIPPING') && e.batch?.totalItems) return s + e.batch.totalItems;
      if (e.type === 'SINGLE_ORDER') return s + (e.singleOrder?.items || e.batch?.totalItems || 1);
      return s;
    }, 0);
    const totalTaskQty   = events.filter(e => e.type === 'TASK').reduce((s, e) => s + (e.task?.quantity || 0), 0);
    const activeStockists= new Set(events.map(e => e.stockistId)).size;
    const totalSecs      = batchEvts.reduce((s, e) => s + (e.batch?.separationSeconds || 0) + (e.batch?.bippingSeconds || 0), 0);
    const avgSpeed       = totalSecs > 0 && totalItems > 0 ? (totalItems / (totalSecs / 60)).toFixed(1) : null;
    const avgBatchTime   = totalBatches > 0 ? Math.round(totalSecs / totalBatches) : 0;
    const bonusEvents    = events.filter(e => e.xpBonus > 0 || (e.xp && e.xp > (e.xpBase || 0))).length;
    const bonusPct       = events.length > 0 ? Math.round((bonusEvents / events.length) * 100) : 0;

    // ── Ranking ───────────────────────────────────────────────────────
    const ranking = computeRanking(events);

    // ── XP by day (sort chronologically) ─────────────────────────────
    const byDayMap = {};
    events.forEach(e => {
      const d   = toDate(e.createdAt);
      const key = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
      byDayMap[key] = (byDayMap[key] || 0) + (e.xp || 0);
    });
    const dayKeys  = Object.keys(byDayMap).sort((a,b) => {
      const [da,ma] = a.split('/').map(Number);
      const [db,mb] = b.split('/').map(Number);
      return ma !== mb ? ma-mb : da-db;
    });
    const dayVals = dayKeys.map(k => byDayMap[k]);

    // ── XP accumulated per day (running total) ────────────────────────
    const dayAcc = dayVals.reduce((acc, v, i) => { acc.push((acc[i-1]||0)+v); return acc; }, []);

    // ── Activity by hour ──────────────────────────────────────────────
    const byHour = Array(24).fill(0);
    events.forEach(e => { byHour[toDate(e.createdAt).getHours()]++; });
    const peakHour = byHour.indexOf(Math.max(...byHour));

    // ── By type ───────────────────────────────────────────────────────
    const byType = {};
    events.forEach(e => { byType[e.type] = (byType[e.type] || 0) + 1; });

    // ── Speed distribution (itens/min per batch event) ────────────────
    const speeds = batchEvts
      .filter(e => e.batch?.totalItems > 0 && ((e.batch?.separationSeconds||0)+(e.batch?.bippingSeconds||0)) > 0)
      .map(e => {
        const secs = (e.batch.separationSeconds||0) + (e.batch.bippingSeconds||0);
        return +(e.batch.totalItems / (secs / 60)).toFixed(1);
      });
    const speedBuckets = ['0-3','3-5','5-7','7-10','10+'];
    const speedCounts  = [0,0,0,0,0];
    speeds.forEach(s => {
      if (s < 3) speedCounts[0]++;
      else if (s < 5) speedCounts[1]++;
      else if (s < 7) speedCounts[2]++;
      else if (s < 10) speedCounts[3]++;
      else speedCounts[4]++;
    });

    // ── Per-unit (admin) ──────────────────────────────────────────────
    const unitStats = isAdmin && units.length > 1
      ? units.map(u => {
          const ue = events.filter(ev => ev.unitId === u.id);
          return {
            name:     u.name,
            xp:       ue.reduce((s,ev) => s+(ev.xp||0), 0),
            batches:  ue.filter(ev => ['BATCH','ONLY_SEPARATION','ONLY_BIPPING'].includes(ev.type)).length,
            items:    ue.reduce((s,ev) => {
              if ((ev.type==='BATCH'||ev.type==='ONLY_BIPPING') && ev.batch?.totalItems) return s+ev.batch.totalItems;
              if (ev.type==='SINGLE_ORDER') return s+(ev.singleOrder?.items || ev.batch?.totalItems || 0);
              return s;
            }, 0),
            orders:   ue.reduce((s,ev) => s+(ev.batch?.totalOrders||(ev.type==='SINGLE_ORDER'?1:0)),0),
            stockists:new Set(ue.map(ev=>ev.stockistId)).size,
            events:   ue.length,
          };
        })
      : null;

    // ── Top performers ────────────────────────────────────────────────
    const fastest    = [...ranking].filter(r => r.totalSecs>0&&r.items>0)
      .sort((a,b) => (b.items/(b.totalSecs/60))-(a.items/(a.totalSecs/60)))[0];
    const mostBatches= [...ranking].sort((a,b)=>b.batches-a.batches)[0];
    const mostItems  = [...ranking].sort((a,b)=>b.items-a.items)[0];
    const mostOrders = [...ranking].sort((a,b)=>b.orders-a.orders)[0];

    // ── Render ────────────────────────────────────────────────────────
    page.innerHTML = `
      <!-- KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0.6rem;margin-bottom:1.5rem;">
        ${kpi('⚡ XP TOTAL',         fmtN(totalXP),                              C.green)}
        ${kpi('📦 LOTES',            fmtN(totalBatches),                         C.purple)}
        ${kpi('📋 PEDIDOS',          fmtN(totalOrders),                          C.blue)}
        ${kpi('🔢 ITENS BIPADOS',    fmtN(totalItems),                           C.green)}
        ${kpi('👥 OPERADORES',       fmtN(activeStockists),                      C.purple)}
        ${kpi('✅ TAREFAS',          fmtN(totalTaskQty) + ' un.',                C.blue)}
        ${kpi('🚀 VEL. MÉDIA',       avgSpeed ? avgSpeed + ' it/min' : '—',      C.green)}
        ${kpi('⏱ TEMPO MÉDIO/LOTE', fmtTime(avgBatchTime),                      C.purple)}
      </div>

      <!-- Charts row 1: XP por estoquista + Timeline -->
      <div class="grid-2 mb-2">
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">XP POR ESTOQUISTA</div>
          <canvas id="ch-stockist"></canvas>
        </div>
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">EVOLUÇÃO DO XP ACUMULADO</div>
          <canvas id="ch-timeline"></canvas>
        </div>
      </div>

      <!-- Charts row 2: Tipos + Horas -->
      <div class="grid-2 mb-2">
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">DISTRIBUIÇÃO DE OPERAÇÕES</div>
          <div style="max-width:280px;margin:0 auto;"><canvas id="ch-types"></canvas></div>
        </div>
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">
            ATIVIDADE POR HORA
            ${byHour[peakHour] > 0 ? `<span style="color:var(--accent);font-size:0.65rem;"> · PICO: ${String(peakHour).padStart(2,'0')}h</span>` : ''}
          </div>
          <canvas id="ch-hours"></canvas>
        </div>
      </div>

      <!-- Charts row 3: Velocidade + XP diário bar -->
      <div class="grid-2 mb-2">
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">DISTRIBUIÇÃO DE VELOCIDADE (it/min)</div>
          <canvas id="ch-speed"></canvas>
        </div>
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">XP DIÁRIO</div>
          <canvas id="ch-daily"></canvas>
        </div>
      </div>

      ${unitStats ? `
      <!-- Unit comparison -->
      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">COMPARATIVO DE UNIDADES</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem;margin-bottom:1rem;">
          ${unitStats.map((u, i) => `
            <div style="border:1px solid var(--border);padding:1rem;position:relative;">
              <div style="font-family:var(--font-display);font-size:0.8rem;color:${i===0?C.green:C.blue};letter-spacing:0.2em;margin-bottom:0.75rem;text-shadow:${i===0?'var(--neon)':'var(--neon-3)'};">${u.name}</div>
              ${row('⚡ XP', fmtN(u.xp))}
              ${row('📦 Lotes', fmtN(u.batches))}
              ${row('📋 Pedidos', fmtN(u.orders))}
              ${row('🔢 Itens Bipados', fmtN(u.items))}
              ${row('👥 Operadores', u.stockists)}
            </div>`).join('')}
        </div>
        <canvas id="ch-units" height="80"></canvas>
      </div>
      ` : ''}

      <!-- Top performers -->
      ${ranking.length >= 2 ? `
      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">🏅 DESTAQUES DO PERÍODO</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.75rem;">
          ${badge('🏆 MAIOR XP',       stockistNames, ranking[0].stockistId,   fmtN(ranking[0].xp)+' XP')}
          ${fastest    ? badge('🚀 MAIS VELOZ',    stockistNames, fastest.stockistId,   (fastest.items/(fastest.totalSecs/60)).toFixed(1)+' it/min') : ''}
          ${mostBatches? badge('📦 MAIS LOTES',    stockistNames, mostBatches.stockistId, fmtN(mostBatches.batches)+' lotes') : ''}
          ${mostItems  ? badge('🔢 MAIS ITENS',    stockistNames, mostItems.stockistId,   fmtN(mostItems.items)+' itens') : ''}
          ${mostOrders ? badge('📋 MAIS PEDIDOS',  stockistNames, mostOrders.stockistId,  fmtN(mostOrders.orders)+' pedidos') : ''}
        </div>
      </div>
      ` : ''}

      <!-- Detailed table -->
      <div class="card cyber-chamfer mb-3">
        <div class="section-title mb-2">DESEMPENHO DETALHADO</div>
        ${ranking.length === 0
          ? '<div class="text-muted text-sm text-center" style="padding:2rem;">Sem dados no período selecionado.</div>'
          : `<div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:0.72rem;font-family:var(--font-terminal);">
                <thead>
                  <tr style="border-bottom:2px solid var(--border);color:var(--muted-fg);font-size:0.6rem;letter-spacing:0.12em;text-align:right;">
                    <th style="padding:0.5rem 0.4rem;text-align:left;">#</th>
                    <th style="padding:0.5rem 0.4rem;text-align:left;">ESTOQUISTA</th>
                    <th style="padding:0.5rem 0.4rem;">XP</th>
                    <th style="padding:0.5rem 0.4rem;">LOTES</th>
                    <th style="padding:0.5rem 0.4rem;">PEDIDOS</th>
                    <th style="padding:0.5rem 0.4rem;">ITENS BIP.</th>
                    <th style="padding:0.5rem 0.4rem;">VEL. MÉD.</th>
                    <th style="padding:0.5rem 0.4rem;">T. MÉD./LOTE</th>
                    <th style="padding:0.5rem 0.4rem;">TAREFAS</th>
                    ${isAdmin ? '<th style="padding:0.5rem 0.4rem;">UNIDADE</th>' : ''}
                  </tr>
                </thead>
                <tbody>
                  ${ranking.map((r, i) => {
                    const name  = stockistNames[r.stockistId] || r.stockistId;
                    const photo = stockistPhoto(name);
                    const speed = r.totalSecs > 0 && r.items > 0
                      ? (r.items / (r.totalSecs / 60)).toFixed(1) + ' it/m'
                      : '—';
                    const tqty  = events.filter(e => e.stockistId === r.stockistId && e.type === 'TASK')
                      .reduce((s, e) => s + (e.task?.quantity || 0), 0);
                    const unitName = isAdmin
                      ? (units.find(u => u.stockists?.some(s => s.id === r.stockistId))?.name || '—')
                      : '';
                    const medal = ['🥇','🥈','🥉'][i] || `${i+1}º`;
                    const hi = i === 0 ? 'background:rgba(255,221,0,0.05);' : '';
                    return `<tr style="border-bottom:1px solid var(--border);${hi}">
                      <td style="padding:0.45rem 0.4rem;font-family:var(--font-display);font-weight:900;">${medal}</td>
                      <td style="padding:0.45rem 0.4rem;">
                        <div style="display:flex;align-items:center;gap:0.4rem;">
                          ${photo ? `<img src="${photo}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;border:1px solid var(--border);flex-shrink:0;" onerror="this.style.display='none'">` : ''}
                          <span style="${i===0?'color:var(--accent);font-weight:700;':''}">${name}</span>
                        </div>
                      </td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;font-family:var(--font-display);font-weight:800;color:${i===0?'#b45309':'var(--accent)'};">${fmtN(r.xp)}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${r.batches}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${fmtN(r.orders)}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${fmtN(r.items)}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;color:var(--accent-3);">${speed}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${fmtTime(r.avgSecs)}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${tqty || '—'}</td>
                      ${isAdmin ? `<td style="padding:0.45rem 0.4rem;text-align:right;color:var(--muted-fg);font-size:0.65rem;">${unitName}</td>` : ''}
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>`
        }
      </div>
    `;

    // ── Build charts ──────────────────────────────────────────────────
    const opts = (extra={}) => ({
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { color: C.gridLine }, ticks: { color: C.tickColor, font: { size: 10 } } },
        y: { grid: { color: C.gridLine }, ticks: { color: C.tickColor, font: { size: 10 } } },
      },
      ...extra,
    });

    // XP por estoquista (horizontal bar)
    new Chart(document.getElementById('ch-stockist'), {
      type: 'bar',
      data: {
        labels: ranking.slice(0,10).map(r => (stockistNames[r.stockistId]||r.stockistId).split(' ')[0]),
        datasets: [{ data: ranking.slice(0,10).map(r=>r.xp),
          backgroundColor: ranking.slice(0,10).map((_,i)=>i===0?C.gold:i===1?C.silver:i===2?C.bronze:C.green),
          borderRadius: 3 }],
      },
      options: { ...opts(), indexAxis: 'y' },
    });

    // XP acumulado linha
    new Chart(document.getElementById('ch-timeline'), {
      type: 'line',
      data: {
        labels: dayKeys,
        datasets: [
          { label: 'Diário', data: dayVals, borderColor: C.purple, backgroundColor:'rgba(124,58,237,0.06)', tension:0.4, fill:true, pointRadius:2, borderWidth:1.5, yAxisID:'y' },
          { label: 'Acumulado', data: dayAcc, borderColor: C.green, backgroundColor:'rgba(5,150,105,0.06)', tension:0.4, fill:true, pointRadius:2, borderWidth:2, yAxisID:'y2' },
        ],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: true, position:'bottom', labels:{ color:C.tickColor, font:{size:10}, boxWidth:10 } } },
        scales: {
          x:  { grid:{color:C.gridLine}, ticks:{color:C.tickColor, font:{size:9}, maxRotation:45} },
          y:  { grid:{color:C.gridLine}, ticks:{color:C.tickColor, font:{size:9}}, position:'left' },
          y2: { grid:{display:false},    ticks:{color:C.green, font:{size:9}},     position:'right' },
        },
      },
    });

    // Tipos donut
    const typeKeys = Object.keys(byType);
    new Chart(document.getElementById('ch-types'), {
      type: 'doughnut',
      data: {
        labels: typeKeys.map(k => typeLabels[k]||k),
        datasets: [{ data: typeKeys.map(k=>byType[k]),
          backgroundColor: [C.green,C.purple,C.blue,C.amber,C.red].slice(0,typeKeys.length),
          borderWidth: 0 }],
      },
      options: { responsive:true, plugins:{ legend:{ position:'bottom', labels:{ color:C.tickColor, font:{size:10}, padding:8 } } } },
    });

    // Atividade por hora
    const maxH = Math.max(...byHour);
    new Chart(document.getElementById('ch-hours'), {
      type: 'bar',
      data: {
        labels: Array.from({length:24},(_,i)=>String(i).padStart(2,'0')+'h'),
        datasets: [{ data: byHour,
          backgroundColor: byHour.map(v => v===maxH && maxH>0 ? C.green : 'rgba(5,150,105,0.25)'),
          borderRadius: 2 }],
      },
      options: { ...opts(), plugins:{ legend:{display:false} } },
    });

    // Distribuição de velocidade
    new Chart(document.getElementById('ch-speed'), {
      type: 'bar',
      data: {
        labels: speedBuckets.map(b => b+' it/m'),
        datasets: [{ data: speedCounts,
          backgroundColor: [C.red,C.amber,C.green,C.blue,C.purple],
          borderRadius: 4 }],
      },
      options: { ...opts(), plugins:{ legend:{display:false} } },
    });

    // XP diário bar
    new Chart(document.getElementById('ch-daily'), {
      type: 'bar',
      data: {
        labels: dayKeys,
        datasets: [{ data: dayVals,
          backgroundColor: dayVals.map(v => v===Math.max(...dayVals) ? C.gold : 'rgba(5,150,105,0.35)'),
          borderRadius: 3 }],
      },
      options: { ...opts(), scales:{
        x:{ grid:{display:false}, ticks:{color:C.tickColor,font:{size:9},maxRotation:45} },
        y:{ grid:{color:C.gridLine}, ticks:{color:C.tickColor,font:{size:9}} },
      }},
    });

    // Comparativo de unidades (admin)
    if (unitStats && document.getElementById('ch-units')) {
      new Chart(document.getElementById('ch-units'), {
        type: 'bar',
        data: {
          labels: ['XP (÷10)','Lotes','Pedidos','Itens (÷10)'],
          datasets: unitStats.map((u, i) => ({
            label: u.name,
            data: [Math.round(u.xp/10), u.batches, u.orders, Math.round(u.items/10)],
            backgroundColor: i===0 ? C.green : C.blue,
            borderRadius: 3,
          })),
        },
        options: {
          responsive:true,
          plugins:{ legend:{ display:true, position:'bottom', labels:{color:C.tickColor,font:{size:10},boxWidth:10} } },
          scales:{
            x:{ grid:{display:false}, ticks:{color:C.tickColor,font:{size:10}} },
            y:{ grid:{color:C.gridLine}, ticks:{color:C.tickColor,font:{size:10}} },
          },
        },
      });
    }
  }

  load();
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function kpi(label, value, color) {
  return `<div class="card cyber-chamfer" style="text-align:center;padding:0.85rem 0.6rem;">
    <div style="font-family:var(--font-terminal);font-size:0.55rem;color:var(--muted-fg);letter-spacing:0.12em;margin-bottom:0.35rem;">${label}</div>
    <div style="font-family:var(--font-display);font-weight:900;font-size:clamp(1rem,2vw,1.5rem);color:${color};text-shadow:0 0 12px ${color}40;">${value}</div>
  </div>`;
}

function row(label, value) {
  return `<div style="display:flex;justify-content:space-between;padding:0.2rem 0;border-bottom:1px solid var(--border);font-size:0.7rem;font-family:var(--font-terminal);">
    <span style="color:var(--muted-fg);">${label}</span>
    <span style="color:var(--fg);font-weight:700;">${value}</span>
  </div>`;
}

function badge(titulo, stockistNames, sid, valor) {
  const name  = stockistNames[sid] || sid;
  const photo = stockistPhoto(name);
  return `<div style="border:1px solid var(--border);padding:0.75rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:0.35rem;">
    <div style="font-family:var(--font-terminal);font-size:0.58rem;color:var(--muted-fg);letter-spacing:0.12em;">${titulo}</div>
    ${photo ? `<img src="${photo}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--accent);" onerror="this.style.display='none'">` : ''}
    <div style="font-family:var(--font-display);font-weight:700;font-size:0.8rem;color:var(--fg);">${name.split(' ')[0]}</div>
    <div style="font-family:var(--font-display);font-size:0.75rem;color:var(--accent);text-shadow:var(--neon);">${valor}</div>
  </div>`;
}
