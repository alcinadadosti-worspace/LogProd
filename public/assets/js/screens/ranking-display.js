import { getCurrentUser, getSessionContext } from '../auth.js';
import { navigate } from '../router.js';
import { getUnit, getAllUnits, watchEvents, computeRanking, dateRangeForPeriod } from '../services/firestore.js';
import { playRankUp, playTick, isMuted, toggleMute } from '../services/sound-engine.js';

export async function renderRankingDisplay(container, params) {
  if (!getCurrentUser()) { navigate('/login'); return; }
  const ctx = getSessionContext();
  if (!ctx) { navigate('/pin'); return; }

  const isAdmin = ctx.mode === 'admin';
  const unitId  = params.unit || ctx.unitId;

  let unit;
  try {
    unit = await getUnit(unitId);
  } catch {}
  if (!unit) { container.innerHTML = '<div class="page text-center mt-4 text-destructive">Unidade não encontrada.</div>'; return; }

  const stockistMap = {};
  (unit.stockists || []).forEach(s => { stockistMap[s.id] = s.name; });

  let period    = params.period || 'month';
  let unsubscribe = null;
  let prevRanking = [];

  // Render shell
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
      #tela-ranking {
        flex: 1;
        display: flex;
        flex-direction: column;
        justify-content: center;
        padding: 2rem;
        gap: 0;
        overflow: hidden;
      }
      .tela-row {
        display: flex;
        align-items: center;
        gap: 1.5rem;
        padding: 0.6rem 1.5rem;
        border-bottom: 1px solid rgba(42,42,58,0.4);
        transition: all 400ms ease;
        animation: fadeIn 500ms ease forwards;
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
      .tela-name {
        flex: 1;
        font-family: var(--font-display);
        font-weight: 700;
        font-size: clamp(1rem, 2.8vw, 2rem);
        letter-spacing: 0.05em;
        text-transform: uppercase;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .tela-bar-wrap {
        flex: 2;
        height: 8px;
        background: var(--muted);
        overflow: hidden;
      }
      .tela-bar {
        height: 100%;
        transition: width 1s ease;
      }
      .rank-1 .tela-bar { background: #ffdd00; box-shadow: 0 0 6px #ffdd0080; }
      .rank-2 .tela-bar { background: #c0c0c0; }
      .rank-3 .tela-bar { background: #cd7f32; }
      .tela-row:not(.rank-1):not(.rank-2):not(.rank-3) .tela-bar { background: var(--accent); }
      .tela-xp {
        font-family: var(--font-display);
        font-weight: 800;
        font-size: clamp(1rem, 2.8vw, 2rem);
        color: var(--accent);
        text-shadow: var(--neon);
        min-width: 10rem;
        text-align: right;
        white-space: nowrap;
        flex-shrink: 0;
      }
      .rank-1 .tela-xp { color: #ffdd00; text-shadow: 0 0 12px #ffdd0080; }
      #tela-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.6rem 2rem;
        border-top: 1px solid var(--border);
        background: rgba(255,255,255,0.95);
        flex-shrink: 0;
      }
      .tela-clock {
        font-family: var(--font-display);
        font-size: clamp(0.75rem, 1.5vw, 1rem);
        color: var(--muted-fg);
        letter-spacing: 0.2em;
      }
      .tela-empty {
        text-align: center;
        font-family: var(--font-display);
        font-size: clamp(1rem, 2vw, 1.5rem);
        color: var(--muted-fg);
        letter-spacing: 0.2em;
        padding: 4rem;
      }
      .tela-events-count {
        font-family: var(--font-terminal);
        font-size: 0.65rem;
        color: var(--muted-fg);
        letter-spacing: 0.15em;
      }
    </style>

    <div id="tela-root">
      <div id="tela-header">
        <div>
          <div class="tela-unit-name glitch" data-text="${unit.name}">${unit.name}</div>
          <div style="font-family:var(--font-terminal);font-size:0.65rem;color:var(--muted-fg);letter-spacing:0.2em;margin-top:0.2rem;">
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
          <button id="mute-btn" class="btn btn--ghost btn--sm" title="Mutar sons">
            ${isMuted() ? '🔇' : '🔊'}
          </button>
          <button id="fullscreen-btn" class="btn btn--ghost btn--sm" title="Tela cheia">⛶</button>
          <a href="#/dashboard" class="btn btn--ghost btn--sm">✕</a>
        </div>
      </div>

      <div id="tela-ranking">
        <div class="tela-empty">
          <div class="spinner" style="margin:0 auto 1rem;"></div>
          CARREGANDO...
        </div>
      </div>

      <div id="tela-footer">
        <div class="tela-clock" id="tela-clock">--:--:--</div>
        <div class="tela-events-count" id="tela-events-count"></div>
        <div style="font-family:var(--font-terminal);font-size:0.6rem;color:var(--muted-fg);letter-spacing:0.15em;">
          ALCINA // PROD.OPS
        </div>
      </div>
    </div>
  `;

  // Clock
  const clockEl = container.querySelector('#tela-clock');
  const clockTimer = setInterval(() => {
    clockEl.textContent = new Date().toLocaleTimeString('pt-BR');
  }, 1000);
  clockEl.textContent = new Date().toLocaleTimeString('pt-BR');

  // Fullscreen
  container.querySelector('#fullscreen-btn').addEventListener('click', () => {
    const el = container.querySelector('#tela-root');
    if (!document.fullscreenElement) el.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // Mute
  container.querySelector('#mute-btn').addEventListener('click', (e) => {
    const m = toggleMute();
    e.target.textContent = m ? '🔇' : '🔊';
  });

  // Period buttons
  container.querySelectorAll('.period-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      period = btn.dataset.period;
      startWatcher();
    });
  });

  function renderRanking(events) {
    const rankingEl    = container.querySelector('#tela-ranking');
    const eventsCount  = container.querySelector('#tela-events-count');
    const ranking      = computeRanking(events);

    eventsCount.textContent = `${events.length} EVENTOS · ${ranking.length} ESTOQUISTAS`;

    if (ranking.length === 0) {
      rankingEl.innerHTML = `<div class="tela-empty">SEM EVENTOS NO PERÍODO</div>`;
      return;
    }

    // Detect rank changes for sounds
    const prevMap = {};
    prevRanking.forEach((r, i) => { prevMap[r.stockistId] = i; });
    let hasChange = prevRanking.length > 0 && prevRanking.length !== ranking.length;

    if (!hasChange && prevRanking.length > 0) {
      ranking.forEach((r, i) => {
        const prev = prevMap[r.stockistId];
        if (prev === undefined || prev !== i) hasChange = true;
      });
    }

    if (hasChange) {
      if (ranking[0]?.stockistId !== prevRanking[0]?.stockistId) playRankUp();
      else playTick();
    }

    prevRanking = ranking;

    const maxXp = ranking[0]?.xp || 1;
    const posLabels = { 0: 'gold', 1: 'silver', 2: 'bronze' };
    const rowClasses = { 0: 'rank-1', 1: 'rank-2', 2: 'rank-3' };

    rankingEl.innerHTML = ranking.slice(0, 10).map((r, i) => {
      const name   = stockistMap[r.stockistId] || r.stockistId;
      const pct    = Math.round((r.xp / maxXp) * 100);
      const posLbl = posLabels[i] || 'rest';
      const rowCls = rowClasses[i] || '';
      return `
        <div class="tela-row ${rowCls}">
          <div class="tela-pos ${posLbl}">#${i + 1}</div>
          <div class="tela-name" style="${i === 0 ? 'color:var(--accent);text-shadow:var(--neon);' : ''}">${name}</div>
          <div class="tela-bar-wrap cyber-chamfer-sm">
            <div class="tela-bar" style="width:0%" data-pct="${pct}"></div>
          </div>
          <div class="tela-xp">${r.xp.toLocaleString('pt-BR')} XP</div>
        </div>
      `;
    }).join('');

    // Animate bars after render
    requestAnimationFrame(() => {
      rankingEl.querySelectorAll('.tela-bar').forEach(bar => {
        bar.style.width = bar.dataset.pct + '%';
      });
    });
  }

  function startWatcher() {
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    const { startDate } = dateRangeForPeriod(period);
    unsubscribe = watchEvents({ unitId, startDate }, renderRanking);
  }

  startWatcher();

  // Cleanup on route change
  return () => {
    clearInterval(clockTimer);
    if (unsubscribe) unsubscribe();
  };
}
