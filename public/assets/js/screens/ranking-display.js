import { waitForAuth, getSessionContext } from '../auth.js';
import { navigate } from '../router.js';
import { getUnit, watchEvents, computeRanking, dateRangeForPeriod } from '../services/firestore.js';
import { playRankUp, playTick, isMuted, toggleMute } from '../services/sound-engine.js';
import { stockistPhoto } from '../services/photos.js';

const SLIDES = [
  { id: 'ranking', label: 'RANKING AO VIVO',   duration: 30000 },
  { id: 'kpis',    label: 'KPIs DO PERÍODO',    duration: 10000 },
  { id: 'mvp',     label: 'DESTAQUES',           duration: 10000 },
  { id: 'hours',   label: 'ATIVIDADE POR HORA',  duration: 10000 },
  { id: 'ops',     label: 'TIPOS DE OPERAÇÃO',   duration: 10000 },
];

export async function renderRankingDisplay(container, params) {
  const user = await waitForAuth();
  if (!user) { navigate('/login'); return; }

  const unitId = params.unit || getSessionContext()?.unitId;
  if (!unitId) { navigate('/pin'); return; }

  let unit;
  try { unit = await getUnit(unitId); } catch {}
  if (!unit) {
    container.innerHTML = '<div class="page text-center mt-4 text-destructive">Unidade não encontrada.</div>';
    return;
  }

  const stockistMap = {};
  (unit.stockists || []).forEach(s => { stockistMap[s.id] = s.name; });

  let period      = params.period || 'month';
  let unsubscribe = null;
  let events      = [];
  let slideIdx    = 0;
  let slideTimer  = null;
  let activeChart = null;
  let prevRanking = [];

  // ── Shell ──────────────────────────────────────────────────────────────────
  container.innerHTML = `
    <style>
      #tela-root {
        min-height: 100vh;
        background: var(--bg);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }
      #tela-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 1rem 2rem;
        border-bottom: 1px solid var(--border);
        background: rgba(255,255,255,0.95);
        flex-shrink: 0;
      }
      .tela-unit-name {
        font-family: var(--font-display);
        font-size: clamp(1rem, 3vw, 1.8rem);
        font-weight: 900;
        color: var(--accent);
        text-shadow: var(--neon-lg);
        letter-spacing: 0.15em;
        text-transform: uppercase;
      }
      #slide-label {
        font-family: var(--font-terminal);
        font-size: 0.65rem;
        color: var(--muted-fg);
        letter-spacing: 0.2em;
        margin-top: 0.2rem;
        transition: opacity 200ms;
      }
      .tela-live-badge {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        font-family: var(--font-terminal);
        font-size: 0.7rem;
        color: var(--accent);
        letter-spacing: 0.2em;
      }
      .tela-live-dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: var(--accent);
        box-shadow: var(--neon);
        animation: blink 1.2s ease-in-out infinite;
      }
      #tela-content {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 1.5rem 2rem;
        overflow: hidden;
      }
      @keyframes slideIn {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      .slide-enter { animation: slideIn 350ms ease forwards; }

      /* ── Ranking slide ── */
      .tela-row {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 0.6rem 1.5rem;
        border-bottom: 1px solid rgba(42,42,58,0.4);
        transition: all 400ms ease;
      }
      .tela-row.rank-1 { background: rgba(255,221,0,0.04); }
      .tela-row.rank-2 { background: rgba(192,192,192,0.03); }
      .tela-row.rank-3 { background: rgba(205,127,50,0.03); }
      .tela-pos {
        font-family: var(--font-display);
        font-weight: 900;
        min-width: 3.5rem;
        text-align: center;
        font-size: clamp(1.2rem, 3.5vw, 2.5rem);
        flex-shrink: 0;
      }
      .tela-pos.gold   { color: #ffdd00; text-shadow: 0 0 15px #ffdd0080; }
      .tela-pos.silver { color: #c0c0c0; text-shadow: 0 0 10px #c0c0c060; }
      .tela-pos.bronze { color: #cd7f32; text-shadow: 0 0 10px #cd7f3260; }
      .tela-pos.rest   { color: var(--muted-fg); }
      .tela-avatar {
        width: clamp(36px, 5vw, 56px);
        height: clamp(36px, 5vw, 56px);
        border-radius: 50%;
        object-fit: cover;
        border: 2px solid var(--border);
        flex-shrink: 0;
      }
      .rank-1 .tela-avatar { border-color: #ffdd00; box-shadow: 0 0 10px #ffdd0060; }
      .rank-2 .tela-avatar { border-color: #c0c0c0; }
      .rank-3 .tela-avatar { border-color: #cd7f32; }
      .tela-avatar-fallback {
        width: clamp(36px, 5vw, 56px);
        height: clamp(36px, 5vw, 56px);
        border-radius: 50%;
        background: var(--muted);
        border: 2px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: var(--font-display);
        font-weight: 900;
        font-size: clamp(0.9rem, 2vw, 1.4rem);
        color: var(--accent);
        flex-shrink: 0;
      }
      .tela-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 0.2rem;
        min-width: 0;
      }
      .tela-name {
        font-family: var(--font-display);
        font-weight: 700;
        font-size: clamp(0.9rem, 2.4vw, 1.7rem);
        letter-spacing: 0.05em;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tela-stats {
        display: flex;
        gap: clamp(0.5rem, 1.5vw, 1.5rem);
        font-family: var(--font-terminal);
        font-size: clamp(0.55rem, 1.1vw, 0.8rem);
        color: var(--muted-fg);
        letter-spacing: 0.1em;
        flex-wrap: wrap;
      }
      .tela-stat { white-space: nowrap; }
      .tela-stat span { color: var(--fg); font-weight: 700; }
      .tela-bar-wrap {
        flex: 1.5;
        height: 6px;
        background: var(--muted);
        overflow: hidden;
        align-self: center;
      }
      .tela-bar { height: 100%; transition: width 1s ease; }
      .rank-1 .tela-bar { background: #ffdd00; box-shadow: 0 0 6px #ffdd0080; }
      .rank-2 .tela-bar { background: #c0c0c0; }
      .rank-3 .tela-bar { background: #cd7f32; }
      .tela-row:not(.rank-1):not(.rank-2):not(.rank-3) .tela-bar { background: var(--accent); }
      .tela-xp {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: clamp(0.9rem, 2.4vw, 1.7rem);
        color: var(--accent);
        text-shadow: var(--neon);
        min-width: 8rem;
        text-align: right;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .rank-1 .tela-xp { color: #ffdd00; text-shadow: 0 0 12px #ffdd0080; }

      /* ── KPI slide ── */
      .kpi-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 1.5rem;
        width: 100%;
        max-width: 960px;
        margin: 0 auto;
      }
      .kpi-card {
        background: var(--surface);
        border: 1px solid var(--border);
        padding: 1.75rem 1rem;
        text-align: center;
        clip-path: polygon(0 0,calc(100% - 12px) 0,100% 12px,100% 100%,12px 100%,0 calc(100% - 12px));
      }
      .kpi-icon  { font-size: clamp(1.4rem, 2.5vw, 2rem); margin-bottom: 0.5rem; }
      .kpi-value {
        font-family: var(--font-display);
        font-size: clamp(1.8rem, 4vw, 3rem);
        font-weight: 900;
        color: var(--accent);
        text-shadow: var(--neon);
        line-height: 1;
      }
      .kpi-label {
        font-family: var(--font-terminal);
        font-size: clamp(0.55rem, 0.9vw, 0.7rem);
        color: var(--muted-fg);
        letter-spacing: 0.2em;
        margin-top: 0.4rem;
      }

      /* ── MVP slide ── */
      .mvp-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 1.5rem;
        width: 100%;
        max-width: 900px;
        margin: 0 auto;
      }
      .mvp-card {
        background: var(--surface);
        border: 1px solid var(--border);
        padding: 1.5rem;
        display: flex;
        align-items: center;
        gap: 1.2rem;
        clip-path: polygon(0 0,calc(100% - 10px) 0,100% 10px,100% 100%,10px 100%,0 calc(100% - 10px));
      }
      .mvp-badge  { font-size: clamp(2rem, 4vw, 3rem); flex-shrink: 0; }
      .mvp-info   { flex: 1; min-width: 0; }
      .mvp-cat {
        font-family: var(--font-terminal);
        font-size: clamp(0.55rem, 0.9vw, 0.7rem);
        color: var(--muted-fg);
        letter-spacing: 0.2em;
      }
      .mvp-name {
        font-family: var(--font-display);
        font-size: clamp(0.9rem, 2vw, 1.4rem);
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--accent);
        text-shadow: var(--neon);
      }
      .mvp-val {
        font-family: var(--font-terminal);
        font-size: clamp(0.7rem, 1.1vw, 0.85rem);
        color: var(--muted-fg);
        margin-top: 0.2rem;
      }

      /* ── Chart slides ── */
      .chart-wrap {
        width: 100%;
        max-width: 1000px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
      }
      .chart-title {
        font-family: var(--font-display);
        font-size: clamp(0.8rem, 1.4vw, 1rem);
        color: var(--accent);
        text-shadow: var(--neon);
        letter-spacing: 0.2em;
        margin-bottom: 1rem;
        text-align: center;
      }
      .chart-canvas-box {
        flex: 1;
        position: relative;
        min-height: 0;
        max-height: 58vh;
      }

      /* ── Empty state ── */
      .tela-empty {
        text-align: center;
        font-family: var(--font-display);
        font-size: clamp(1rem, 2vw, 1.5rem);
        color: var(--muted-fg);
        letter-spacing: 0.2em;
        padding: 4rem;
      }

      /* ── Footer ── */
      #tela-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.6rem 2rem;
        border-top: 1px solid var(--border);
        background: rgba(255,255,255,0.95);
        flex-shrink: 0;
        position: relative;
      }
      #slide-progress {
        position: absolute;
        top: 0; left: 0;
        height: 2px;
        background: var(--accent);
        box-shadow: var(--neon);
        width: 0%;
      }
      .tela-clock {
        font-family: var(--font-display);
        font-size: clamp(0.75rem, 1.5vw, 1rem);
        color: var(--muted-fg);
        letter-spacing: 0.2em;
      }
      .slide-dots {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.4rem;
      }
      .slide-dots-row {
        display: flex;
        gap: 0.45rem;
        align-items: center;
      }
      .slide-dot {
        width: 8px; height: 8px;
        border-radius: 50%;
        background: var(--muted);
        border: none;
        padding: 0;
        cursor: pointer;
        transition: all 250ms;
      }
      .slide-dot.active {
        background: var(--accent);
        box-shadow: var(--neon);
        width: 22px;
        border-radius: 4px;
      }
      .slide-dot-label {
        font-family: var(--font-terminal);
        font-size: 0.55rem;
        color: var(--muted-fg);
        letter-spacing: 0.15em;
      }
    </style>

    <div id="tela-root">
      <div id="tela-header">
        <div>
          <div class="tela-unit-name glitch" data-text="${unit.name}">${unit.name}</div>
          <div id="slide-label" style="font-family:var(--font-terminal);font-size:0.65rem;color:var(--muted-fg);letter-spacing:0.2em;margin-top:0.2rem;">
            RANKING DE PRODUTIVIDADE // O BOTICÁRIO
          </div>
        </div>

        <div class="tela-live-badge">
          <div class="tela-live-dot"></div>
          AO VIVO
        </div>

        <div style="display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
          ${['today','week','month','all'].map(p => `
            <button class="filter-btn period-btn ${p===period?'active':''}" data-period="${p}">
              ${p==='today'?'HOJE':p==='week'?'SEMANA':p==='month'?'MÊS':'SEMPRE'}
            </button>
          `).join('')}
          <button id="mute-btn" class="btn btn--ghost btn--sm">${isMuted() ? '🔇' : '🔊'}</button>
          <button id="fullscreen-btn" class="btn btn--ghost btn--sm" title="Tela cheia">⛶</button>
          <a href="#/dashboard" class="btn btn--ghost btn--sm">✕</a>
        </div>
      </div>

      <div id="tela-content">
        <div class="tela-empty">
          <div class="spinner" style="margin:0 auto 1rem;"></div>
          CARREGANDO...
        </div>
      </div>

      <div id="tela-footer">
        <div id="slide-progress"></div>
        <div style="display:flex;flex-direction:column;gap:0.1rem;">
          <div class="tela-clock" id="tela-clock">--:--:--</div>
          <div class="tela-clock" id="tela-date" style="font-size:clamp(0.55rem,1.1vw,0.75rem);opacity:0.75;">--/--/----</div>
        </div>
        <div class="slide-dots">
          <div class="slide-dots-row">
            ${SLIDES.map((s, i) => `<button class="slide-dot" data-slide="${i}" title="${s.label}"></button>`).join('')}
          </div>
          <div class="slide-dot-label" id="dot-label">${SLIDES[0].label}</div>
        </div>
        <div style="font-family:var(--font-terminal);font-size:0.6rem;color:var(--muted-fg);letter-spacing:0.15em;">
          LOGISTICA // PROD.OPS
        </div>
      </div>
    </div>
  `;

  // ── Clock ──────────────────────────────────────────────────────────────────
  const clockEl = container.querySelector('#tela-clock');
  const dateEl  = container.querySelector('#tela-date');
  function tickClock() {
    const now = new Date();
    clockEl.textContent = now.toLocaleTimeString('pt-BR');
    dateEl.textContent  = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }).toUpperCase();
  }
  tickClock();
  const clockTimer = setInterval(tickClock, 1000);

  // ── Controls ───────────────────────────────────────────────────────────────
  container.querySelector('#fullscreen-btn').addEventListener('click', () => {
    const el = container.querySelector('#tela-root');
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  container.querySelector('#mute-btn').addEventListener('click', e => {
    e.target.textContent = toggleMute() ? '🔇' : '🔊';
  });

  container.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      period = btn.dataset.period;
      slideIdx = 0;
      startWatcher();
    });
  });

  container.querySelectorAll('.slide-dot').forEach(dot => {
    dot.addEventListener('click', () => goToSlide(parseInt(dot.dataset.slide)));
  });

  // ── Helpers ────────────────────────────────────────────────────────────────
  function fmtSecs(s) {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  }

  function destroyChart() {
    if (activeChart) { activeChart.destroy(); activeChart = null; }
  }

  function updateDots() {
    container.querySelectorAll('.slide-dot').forEach((dot, i) => {
      dot.classList.toggle('active', i === slideIdx);
    });
    const label = SLIDES[slideIdx].label;
    const dotLabel = container.querySelector('#dot-label');
    if (dotLabel) dotLabel.textContent = label;
    const slideLabel = container.querySelector('#slide-label');
    if (slideLabel) slideLabel.textContent = label + ' // O BOTICÁRIO';
  }

  function startProgress(duration) {
    const bar = container.querySelector('#slide-progress');
    if (!bar) return;
    bar.style.transition = 'none';
    bar.style.width = '0%';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      bar.style.transition = `width ${duration}ms linear`;
      bar.style.width = '100%';
    }));
  }

  // ── Slide engine ───────────────────────────────────────────────────────────
  function goToSlide(idx) {
    if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; }
    slideIdx = idx;
    renderSlide();
    scheduleNext();
  }

  function scheduleNext() {
    const dur = SLIDES[slideIdx].duration;
    startProgress(dur);
    slideTimer = setTimeout(() => {
      slideIdx = (slideIdx + 1) % SLIDES.length;
      renderSlide();
      scheduleNext();
    }, dur);
  }

  function renderSlide() {
    destroyChart();
    updateDots();
    const content = container.querySelector('#tela-content');
    const id = SLIDES[slideIdx].id;
    if      (id === 'ranking') renderRankingSlide(content);
    else if (id === 'kpis')    renderKpisSlide(content);
    else if (id === 'mvp')     renderMvpSlide(content);
    else if (id === 'hours')   renderHoursSlide(content);
    else if (id === 'ops')     renderOpsSlide(content);
  }

  // ── Slide: Ranking ─────────────────────────────────────────────────────────
  function renderRankingSlide(content) {
    const ranking = computeRanking(events).filter(r => stockistMap[r.stockistId]);

    if (ranking.length === 0) {
      content.innerHTML = `<div class="tela-empty slide-enter">SEM EVENTOS NO PERÍODO</div>`;
      return;
    }

    const prevMap = {};
    prevRanking.forEach((r, i) => { prevMap[r.stockistId] = i; });
    let hasChange = prevRanking.length > 0 && prevRanking.length !== ranking.length;
    if (!hasChange && prevRanking.length > 0) {
      ranking.forEach((r, i) => { if (prevMap[r.stockistId] !== i) hasChange = true; });
    }
    if (hasChange) {
      if (ranking[0]?.stockistId !== prevRanking[0]?.stockistId) playRankUp();
      else playTick();
    }
    prevRanking = ranking;

    const maxXp     = ranking[0]?.xp || 1;
    const posLabels  = { 0: 'gold', 1: 'silver', 2: 'bronze' };
    const rowClasses = { 0: 'rank-1', 1: 'rank-2', 2: 'rank-3' };

    content.innerHTML = `
      <div class="slide-enter" style="display:flex;flex-direction:column;width:100%;">
        ${ranking.slice(0, 10).map((r, i) => {
          const name      = stockistMap[r.stockistId] || r.stockistId;
          const photo     = stockistPhoto(name);
          const pct       = Math.round((r.xp / maxXp) * 100);
          const posLbl    = posLabels[i]  || 'rest';
          const rowCls    = rowClasses[i] || '';
          const nameStyle = i === 0 ? 'color:var(--accent);text-shadow:var(--neon);' : '';
          const avgFmt    = r.avgSecs > 0 ? fmtSecs(r.avgSecs) : '—';
          const avatar    = photo
            ? `<img src="${photo}" alt="${name}" class="tela-avatar"
                    onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
               <div class="tela-avatar-fallback" style="display:none;">${name.charAt(0)}</div>`
            : `<div class="tela-avatar-fallback">${name.charAt(0)}</div>`;
          return `
            <div class="tela-row ${rowCls}">
              <div class="tela-pos ${posLbl}">#${i + 1}</div>
              ${avatar}
              <div class="tela-info">
                <div class="tela-name" style="${nameStyle}">${name}</div>
                <div class="tela-stats">
                  <div class="tela-stat">📦 <span>${r.batches}</span> lotes</div>
                  <div class="tela-stat">🔒 <span>${r.boxes}</span> caixas lacradas</div>
                  <div class="tela-stat">📋 <span>${r.orders}</span> pedidos</div>
                  <div class="tela-stat">🔢 <span>${r.items.toLocaleString('pt-BR')}</span> itens</div>
                  <div class="tela-stat">⏱ <span>${avgFmt}</span> t. médio</div>
                </div>
              </div>
              <div class="tela-bar-wrap cyber-chamfer-sm">
                <div class="tela-bar" style="width:0%" data-pct="${pct}"></div>
              </div>
              <div class="tela-xp">${r.xp.toLocaleString('pt-BR')} XP</div>
            </div>`;
        }).join('')}
      </div>`;

    requestAnimationFrame(() => {
      content.querySelectorAll('.tela-bar').forEach(bar => {
        bar.style.width = bar.dataset.pct + '%';
      });
    });
  }

  // ── Slide: KPIs ────────────────────────────────────────────────────────────
  function computeKpis(evs) {
    let xp = 0, batches = 0, orders = 0, items = 0, boxes = 0;
    const stockists = new Set();
    for (const ev of evs) {
      xp += ev.xp || 0;
      stockists.add(ev.stockistId);
      const b = ev.batch;
      if (b && ['BATCH','ONLY_SEPARATION','ONLY_BIPPING'].includes(ev.type)) {
        batches++;
        orders += b.totalOrders || 0;
        if (ev.type === 'BATCH' || ev.type === 'ONLY_BIPPING') {
          items += b.totalItems || 0;
          boxes += Object.keys(b.boxCodes || {}).length;
        }
      }
      if (ev.type === 'SINGLE_ORDER') {
        const so = ev.singleOrder || {};
        orders++;
        items += so.items || so.totalItems || 1;
        if (so.boxCode) boxes++;
      }
    }
    return { xp, batches, orders, items, boxes, operators: stockists.size };
  }

  function renderKpisSlide(content) {
    const k = computeKpis(events);
    content.innerHTML = `
      <div class="kpi-grid slide-enter">
        <div class="kpi-card">
          <div class="kpi-icon">⚡</div>
          <div class="kpi-value">${k.xp.toLocaleString('pt-BR')}</div>
          <div class="kpi-label">XP TOTAL</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">📦</div>
          <div class="kpi-value">${k.batches.toLocaleString('pt-BR')}</div>
          <div class="kpi-label">LOTES</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">📋</div>
          <div class="kpi-value">${k.orders.toLocaleString('pt-BR')}</div>
          <div class="kpi-label">PEDIDOS</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">🔢</div>
          <div class="kpi-value">${k.items.toLocaleString('pt-BR')}</div>
          <div class="kpi-label">ITENS BIPADOS</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">🔒</div>
          <div class="kpi-value">${k.boxes.toLocaleString('pt-BR')}</div>
          <div class="kpi-label">CAIXAS LACRADAS</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon">👥</div>
          <div class="kpi-value">${k.operators}</div>
          <div class="kpi-label">OPERADORES ATIVOS</div>
        </div>
      </div>`;
  }

  // ── Slide: Destaques MVP ───────────────────────────────────────────────────
  function renderMvpSlide(content) {
    const ranking = computeRanking(events).filter(r => stockistMap[r.stockistId]);
    if (!ranking.length) {
      content.innerHTML = `<div class="tela-empty slide-enter">SEM DADOS NO PERÍODO</div>`;
      return;
    }

    const byXp      = ranking[0];
    const byBatches = [...ranking].sort((a, b) => b.batches - a.batches)[0];
    const byItems   = [...ranking].sort((a, b) => b.items   - a.items)[0];
    const bySpeed   = ranking.filter(r => r.batches > 0 && r.avgSecs > 0)
                             .sort((a, b) => a.avgSecs - b.avgSecs)[0];

    function card(badge, cat, r, val) {
      const name = r ? (stockistMap[r.stockistId] || r.stockistId) : null;
      return `
        <div class="mvp-card">
          <div class="mvp-badge">${badge}</div>
          <div class="mvp-info">
            <div class="mvp-cat">${cat}</div>
            <div class="mvp-name" ${!name ? 'style="color:var(--muted-fg)"' : ''}>${name || '—'}</div>
            ${name ? `<div class="mvp-val">${val}</div>` : ''}
          </div>
        </div>`;
    }

    content.innerHTML = `
      <div class="mvp-grid slide-enter">
        ${card('🏆', 'MAIOR XP',    byXp,      byXp     ? byXp.xp.toLocaleString('pt-BR') + ' XP'     : '')}
        ${card('🚀', 'MAIS VELOZ',  bySpeed,   bySpeed  ? fmtSecs(bySpeed.avgSecs) + ' / lote'         : '')}
        ${card('📦', 'MAIS LOTES',  byBatches, byBatches ? byBatches.batches + ' lotes'                 : '')}
        ${card('🔢', 'MAIS ITENS',  byItems,   byItems  ? byItems.items.toLocaleString('pt-BR') + ' itens' : '')}
      </div>`;
  }

  // ── Slide: Atividade por hora ──────────────────────────────────────────────
  function renderHoursSlide(content) {
    const counts = new Array(24).fill(0);
    for (const ev of events) {
      const ts = ev.createdAt;
      if (!ts) continue;
      const d = ts.toDate ? ts.toDate() : new Date(ts);
      counts[d.getHours()]++;
    }
    const peak = counts.indexOf(Math.max(...counts));

    content.innerHTML = `
      <div class="chart-wrap slide-enter">
        <div class="chart-title">ATIVIDADE POR HORA DO DIA</div>
        <div class="chart-canvas-box"><canvas id="ch-hours"></canvas></div>
      </div>`;

    if (!window.Chart) return;
    activeChart = new window.Chart(
      content.querySelector('#ch-hours').getContext('2d'), {
        type: 'bar',
        data: {
          labels: counts.map((_, i) => `${String(i).padStart(2,'0')}h`),
          datasets: [{
            data: counts,
            backgroundColor: counts.map((_, i) => i === peak ? '#00ff9d' : 'rgba(0,255,157,0.2)'),
            borderColor:     counts.map((_, i) => i === peak ? '#00ff9d' : 'rgba(0,255,157,0.35)'),
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.y} eventos` } } },
          scales: {
            x: { ticks: { color: '#888', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.05)' } },
            y: { ticks: { color: '#888', font: { size: 11 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
          },
        },
      }
    );
  }

  // ── Slide: Distribuição de operações ──────────────────────────────────────
  function renderOpsSlide(content) {
    const defs = [
      { label: 'Lote Completo',  type: 'BATCH',          color: '#00ff9d' },
      { label: 'Só Separação',   type: 'ONLY_SEPARATION', color: '#7c3aed' },
      { label: 'Só Bipagem',     type: 'ONLY_BIPPING',    color: '#0ea5e9' },
      { label: 'Pedido Avulso',  type: 'SINGLE_ORDER',    color: '#f59e0b' },
      { label: 'Tarefa',         type: 'TASK',            color: '#ec4899' },
    ];
    const counts = defs.map(d => events.filter(ev => ev.type === d.type).length);

    content.innerHTML = `
      <div class="chart-wrap slide-enter">
        <div class="chart-title">DISTRIBUIÇÃO DE OPERAÇÕES</div>
        <div class="chart-canvas-box"><canvas id="ch-ops"></canvas></div>
      </div>`;

    if (!window.Chart) return;
    activeChart = new window.Chart(
      content.querySelector('#ch-ops').getContext('2d'), {
        type: 'bar',
        data: {
          labels: defs.map(d => d.label),
          datasets: [{
            data: counts,
            backgroundColor: defs.map(d => d.color + '44'),
            borderColor:     defs.map(d => d.color),
            borderWidth: 2,
          }],
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => ` ${c.parsed.x} eventos` } } },
          scales: {
            x: { ticks: { color: '#888', font: { size: 12 }, stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.05)' }, beginAtZero: true },
            y: { ticks: { color: '#ccc', font: { size: 13 } }, grid: { display: false } },
          },
        },
      }
    );
  }

  // ── Data watcher ───────────────────────────────────────────────────────────
  function onEvents(newEvents) {
    events = newEvents;
    renderSlide();
    if (!slideTimer) scheduleNext();
  }

  function startWatcher() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    if (slideTimer)  { clearTimeout(slideTimer); slideTimer = null; }
    const { startDate } = dateRangeForPeriod(period);
    unsubscribe = watchEvents({ unitId, startDate }, onEvents);
  }

  startWatcher();

  return () => {
    clearInterval(clockTimer);
    if (slideTimer) clearTimeout(slideTimer);
    if (unsubscribe) unsubscribe();
    destroyChart();
  };
}
