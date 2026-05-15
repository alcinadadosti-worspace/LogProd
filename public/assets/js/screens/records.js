import { getCurrentUser, getSessionContext } from "../auth.js";
import { navigate } from "../router.js";
import {
  getEvents,
  getAllEvents,
  getAllUnits,
  getUnit,
  getTasks,
  dateRangeForPeriod,
} from "../services/firestore.js";
import { stockistPhoto } from "../services/photos.js";

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const PAGE_SIZE = 10;

const TYPE_LABELS = {
  BATCH: "Função Completa",
  ONLY_SEPARATION: "Só Separação",
  ONLY_BIPPING: "Só Bipador",
};

function toDate(ts) {
  if (!ts) return new Date(0);
  if (typeof ts.toDate === "function") return ts.toDate();
  return new Date(ts);
}

function fmtDate(d) {
  if (!d || Number.isNaN(d.getTime?.()) || d.getTime() <= 0) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  const hh = String(d.getHours()).padStart(2, "0");
  const mn = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yy} ${hh}:${mn}`;
}

function fmtDay(d) {
  if (!d || Number.isNaN(d.getTime?.()) || d.getTime() <= 0) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}

function fmtN(n) {
  return (n || 0).toLocaleString("pt-BR");
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function renderRecords(container, params) {
  if (!getCurrentUser()) {
    navigate("/login");
    return;
  }
  const ctx = getSessionContext();
  if (!ctx) {
    navigate("/pin");
    return;
  }

  const isAdmin = ctx.mode === "admin";
  let period = params.period || "month";
  let selectedStockistId = null;
  let activeTab = "lotes";
  let pageByTab = { lotes: 1, pedidos: 1, caixas: 1, tarefas: 1 };
  let searchValue = "";
  let searchDebounce = null;
  let currentData = null;

  container.innerHTML = `
    <div class="topbar">
      <button class="btn btn--ghost btn--sm" id="back-btn">← VOLTAR</button>
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <div class="topbar-logo" style="font-size:0.85rem;">📋 REGISTROS</div>
        <div id="cache-badge" style="display:none;font-family:var(--font-terminal);font-size:0.6rem;
             color:var(--muted-fg);letter-spacing:0.1em;background:var(--muted);padding:0.15rem 0.4rem;"></div>
      </div>
      <div style="display:flex;gap:0.4rem;flex-wrap:wrap;align-items:center;">
        ${["today", "week", "month", "all"]
          .map(
            (p) => `
          <button class="filter-btn period-btn ${p === period ? "active" : ""}" data-period="${p}">
            ${p === "today" ? "HOJE" : p === "week" ? "SEMANA" : p === "month" ? "MÊS" : "SEMPRE"}
          </button>`,
          )
          .join("")}
        <button id="refresh-btn" class="btn btn--ghost btn--sm" title="Forçar atualização">↺</button>
      </div>
    </div>
    <div class="page screen-enter" id="rec-page">
      <div class="text-center mt-4">
        <div class="spinner" style="margin:0 auto;"></div>
        <div class="text-muted mt-2" style="font-family:var(--font-terminal);letter-spacing:0.2em;font-size:0.75rem;">CARREGANDO REGISTROS...</div>
      </div>
    </div>
  `;

  container
    .querySelector("#back-btn")
    .addEventListener("click", () => navigate("/dashboard"));
  container.querySelectorAll(".period-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      container
        .querySelectorAll(".period-btn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      period = btn.dataset.period;
      selectedStockistId = null;
      load();
    });
  });
  container
    .querySelector("#refresh-btn")
    .addEventListener("click", () => load(true));

  const page = container.querySelector("#rec-page");
  const cacheBadge = container.querySelector("#cache-badge");

  async function load(forceRefresh = false) {
    const cacheKey = `${period}:${isAdmin ? "admin" : ctx.unitId}`;

    if (!forceRefresh) {
      const hit = _cache.get(cacheKey);
      if (hit && Date.now() - hit.ts < CACHE_TTL) {
        const age = Math.floor((Date.now() - hit.ts) / 1000);
        cacheBadge.style.display = "";
        cacheBadge.textContent = `CACHE · ${age}s atrás`;
        currentData = hit;
        renderCurrentView();
        return;
      }
    }

    cacheBadge.style.display = "none";
    page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div><div class="text-muted mt-2" style="font-family:var(--font-terminal);letter-spacing:0.2em;font-size:0.75rem;">CARREGANDO REGISTROS...</div></div>`;

    try {
      const { startDate } = dateRangeForPeriod(period);
      let events = [],
        units = [],
        stockistNames = {},
        tasks = [];

      if (isAdmin) {
        [events, units, tasks] = await Promise.all([
          getAllEvents({ startDate, maxDocs: 1000 }),
          getAllUnits(),
          getTasks().catch(() => []),
        ]);
      } else {
        const [unit, evs, tks] = await Promise.all([
          getUnit(ctx.unitId),
          getEvents({ unitId: ctx.unitId, startDate, maxDocs: 500 }),
          getTasks().catch(() => []),
        ]);
        events = evs;
        units = unit ? [unit] : [];
        tasks = tks;
      }

      units.forEach((u) =>
        (u.stockists || []).forEach((s) => {
          stockistNames[s.id] = s.name;
        }),
      );

      const taskNames = {};
      tasks.forEach((t) => {
        taskNames[t.id] = t.name || t.label || t.id;
      });

      const data = {
        events,
        stockistNames,
        taskNames,
        units,
        ts: Date.now(),
      };
      _cache.set(cacheKey, data);
      currentData = data;
      renderCurrentView();
    } catch (err) {
      page.innerHTML = `<div class="card cyber-chamfer text-center" style="padding:2rem;">
        <div class="text-destructive" style="font-family:var(--font-terminal);">Erro ao carregar: ${esc(err.message)}</div>
      </div>`;
    }
  }

  function buildPerStockist(data) {
    const { events, stockistNames, taskNames } = data;
    const map = {};

    function ensure(id) {
      if (!id) return null;
      if (!map[id]) {
        map[id] = {
          stockistId: id,
          name: stockistNames[id] || id,
          lotes: [],
          pedidos: [],
          caixas: [],
          tarefas: [],
          xp: 0,
        };
      }
      return map[id];
    }

    // Aggregate tasks: day + taskId + stockist
    const taskMap = new Map();

    events.forEach((ev) => {
      const sid = ev.stockistId;
      const rec = ensure(sid);
      if (!rec) return;
      rec.xp += ev.xp || 0;

      const when = toDate(ev.createdAt);

      if (["BATCH", "ONLY_SEPARATION", "ONLY_BIPPING"].includes(ev.type)) {
        rec.lotes.push({
          when,
          code: ev.batch?.batchCode || "—",
          type: TYPE_LABELS[ev.type] || ev.type,
          orders: ev.batch?.totalOrders ?? 0,
          items: ev.batch?.totalItems || 0,
          xp: ev.xp || 0,
        });
        if (
          ev.batch?.boxCodes &&
          ["BATCH", "ONLY_BIPPING"].includes(ev.type)
        ) {
          Object.entries(ev.batch.boxCodes).forEach(([orderCode, box]) => {
            if (!box) return;
            rec.caixas.push({
              when,
              code: String(box),
              origin: `LOTE ${ev.batch?.batchCode || "—"}`,
              orderCode,
            });
          });
        }
      } else if (ev.type === "SINGLE_ORDER") {
        rec.pedidos.push({
          when,
          code: ev.singleOrder?.orderCode || "—",
          items: ev.singleOrder?.items || 0,
          boxCode: ev.singleOrder?.boxCode || null,
          xp: ev.xp || 0,
        });
        if (ev.singleOrder?.boxCode) {
          rec.caixas.push({
            when,
            code: String(ev.singleOrder.boxCode),
            origin: `PEDIDO ${ev.singleOrder.orderCode || "—"}`,
            orderCode: ev.singleOrder.orderCode || "",
          });
        }
      } else if (ev.type === "TASK") {
        const dayKey = `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
        const taskId = ev.task?.taskId || "—";
        const key = `${sid}|${dayKey}|${taskId}`;
        let trow = taskMap.get(key);
        if (!trow) {
          trow = {
            when,
            taskId,
            taskName: taskNames[taskId] || taskId,
            quantity: 0,
            xp: 0,
            stockistId: sid,
          };
          taskMap.set(key, trow);
        }
        trow.quantity += ev.task?.quantity || 1;
        trow.xp += ev.xp || 0;
      }
    });

    // Distribute aggregated tasks to records
    for (const trow of taskMap.values()) {
      const rec = map[trow.stockistId];
      if (rec) rec.tarefas.push(trow);
    }

    // Sort each list desc by date
    Object.values(map).forEach((rec) => {
      rec.lotes.sort((a, b) => b.when - a.when);
      rec.pedidos.sort((a, b) => b.when - a.when);
      rec.caixas.sort((a, b) => b.when - a.when);
      rec.tarefas.sort((a, b) => b.when - a.when || b.xp - a.xp);
    });

    return map;
  }

  function renderCurrentView() {
    if (!currentData) return;
    if (selectedStockistId) {
      renderDetail(currentData, selectedStockistId);
    } else {
      renderGrid(currentData);
    }
  }

  function renderGrid(data) {
    const byStockist = buildPerStockist(data);
    const records = Object.values(byStockist).sort((a, b) => b.xp - a.xp);

    page.innerHTML = `
      <div class="card cyber-chamfer mb-2" style="padding:1rem;">
        <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;justify-content:space-between;">
          <div class="section-title" style="margin:0;">🔎 BUSCAR OPERADOR / CÓDIGO</div>
          <div class="text-muted text-xs" style="font-family:var(--font-terminal);">${records.length} operador(es) · ${data.events.length} evento(s) no período</div>
        </div>
        <input id="rec-search" type="text" class="input mt-2"
               placeholder="Nome do estoquista, código de lote, pedido ou caixa..."
               style="width:100%;font-family:var(--font-terminal);"
               autocomplete="off" inputmode="search"
               value="${esc(searchValue)}">
      </div>

      <div id="rec-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem;"></div>
    `;

    const searchInput = page.querySelector("#rec-search");
    searchInput.addEventListener("input", (e) => {
      if (searchDebounce) clearTimeout(searchDebounce);
      const v = e.target.value;
      searchDebounce = setTimeout(() => {
        searchDebounce = null;
        searchValue = v;
        renderGridContent(records);
      }, 120);
    });

    renderGridContent(records);
  }

  function renderGridContent(records) {
    const grid = page.querySelector("#rec-grid");
    if (!grid) return;

    const f = searchValue.trim().toLowerCase();
    const filtered = !f
      ? records
      : records.filter((r) => {
          if (r.name.toLowerCase().includes(f)) return true;
          if (r.lotes.some((x) => x.code.toLowerCase().includes(f))) return true;
          if (r.pedidos.some((x) => x.code.toLowerCase().includes(f) || (x.boxCode && x.boxCode.toLowerCase().includes(f)))) return true;
          if (r.caixas.some((x) => x.code.toLowerCase().includes(f) || x.origin.toLowerCase().includes(f))) return true;
          if (r.tarefas.some((x) => x.taskName.toLowerCase().includes(f))) return true;
          return false;
        });

    if (filtered.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1;padding:2rem;text-align:center;color:var(--muted-fg);font-family:var(--font-terminal);font-size:0.8rem;">
        ${f ? `Nada encontrado para "${esc(searchValue)}".` : "Sem registros no período."}
      </div>`;
      return;
    }

    grid.innerHTML = filtered
      .map((r, idx) => {
        const photo = stockistPhoto(r.name);
        const totalEvents = r.lotes.length + r.pedidos.length + r.tarefas.length;
        const medal = idx === 0 && !f ? "🏆" : idx === 1 && !f ? "🥈" : idx === 2 && !f ? "🥉" : "";
        return `
        <div class="card cyber-chamfer stockist-card ${idx === 0 && !f ? "is-top" : ""}" data-id="${esc(r.stockistId)}"
             style="cursor:pointer;padding:1.2rem;display:flex;flex-direction:column;gap:0.85rem;
                    transition:transform 150ms, box-shadow 150ms, border-color 150ms;
                    border:1px solid ${idx === 0 && !f ? "var(--accent)" : "var(--border)"};">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            ${photo
              ? `<img src="${photo}" alt="${esc(r.name)}"
                       style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:1px solid var(--border);flex-shrink:0;"
                       onerror="this.style.display='none';this.nextElementSibling.style.display='flex';">
                 <div style="display:none;width:56px;height:56px;border-radius:50%;background:var(--muted);
                             color:var(--accent);align-items:center;justify-content:center;font-family:var(--font-display);
                             font-size:1.4rem;flex-shrink:0;">${esc(r.name.charAt(0))}</div>`
              : `<div style="width:56px;height:56px;border-radius:50%;background:var(--muted);
                             color:var(--accent);display:flex;align-items:center;justify-content:center;
                             font-family:var(--font-display);font-size:1.4rem;flex-shrink:0;">${esc(r.name.charAt(0))}</div>`
            }
            <div style="flex:1;min-width:0;">
              <div style="font-family:var(--font-display);font-size:0.8rem;letter-spacing:0.15em;
                          color:var(--fg);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                ${medal ? medal + " " : ""}${esc(r.name)}
              </div>
              <div style="font-family:var(--font-terminal);font-size:0.6rem;color:var(--muted-fg);letter-spacing:0.1em;margin-top:0.15rem;">
                ${totalEvents} evento(s)
              </div>
            </div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;">
            ${statBadge("📦", r.lotes.length, "LOTES", "var(--accent)")}
            ${statBadge("📋", r.pedidos.length, "PEDIDOS", "var(--accent-3,#0284c7)")}
            ${statBadge("▣", r.caixas.length, "CAIXAS", "#7c3aed")}
            ${statBadge("🎯", r.tarefas.length, "TAREFAS", "#ec4899")}
          </div>

          <div style="display:flex;align-items:center;justify-content:space-between;
                      padding-top:0.5rem;border-top:1px solid var(--border);">
            <div style="font-family:var(--font-terminal);font-size:0.55rem;color:var(--muted-fg);letter-spacing:0.15em;">XP TOTAL</div>
            <div style="font-family:var(--font-display);font-weight:800;color:var(--accent);font-size:1rem;text-shadow:var(--neon);">
              ${fmtN(r.xp)}
            </div>
          </div>
        </div>`;
      })
      .join("");

    grid.querySelectorAll(".stockist-card").forEach((card) => {
      card.addEventListener("mouseenter", () => {
        card.style.transform = "translateY(-2px)";
        card.style.boxShadow = "var(--neon-lg)";
        card.style.borderColor = "var(--accent)";
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "";
        card.style.boxShadow = "";
        card.style.borderColor = card.classList.contains("is-top")
          ? "var(--accent)"
          : "var(--border)";
      });
      card.addEventListener("click", () => {
        selectedStockistId = card.dataset.id;
        activeTab = "lotes";
        pageByTab = { lotes: 1, pedidos: 1, caixas: 1, tarefas: 1 };
        renderCurrentView();
      });
    });
  }

  function statBadge(icon, count, label, color) {
    return `
      <div style="background:var(--muted);padding:0.4rem 0.5rem;display:flex;align-items:center;gap:0.4rem;">
        <span style="font-size:0.95rem;color:${color};">${icon}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-display);font-weight:800;font-size:1rem;color:${color};line-height:1;">
            ${fmtN(count)}
          </div>
          <div style="font-family:var(--font-terminal);font-size:0.5rem;letter-spacing:0.15em;color:var(--muted-fg);margin-top:0.15rem;">
            ${label}
          </div>
        </div>
      </div>`;
  }

  function renderDetail(data, stockistId) {
    const byStockist = buildPerStockist(data);
    const rec = byStockist[stockistId];
    if (!rec) {
      selectedStockistId = null;
      renderCurrentView();
      return;
    }
    const photo = stockistPhoto(rec.name);

    page.innerHTML = `
      <div class="card cyber-chamfer mb-2" style="padding:1.2rem;">
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
          <button id="back-grid" class="btn btn--ghost btn--sm" style="font-size:0.7rem;">← TODOS</button>
          ${photo
            ? `<img src="${photo}" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:2px solid var(--accent);box-shadow:var(--neon);" onerror="this.style.display='none'">`
            : `<div style="width:64px;height:64px;border-radius:50%;background:var(--muted);color:var(--accent);display:flex;align-items:center;justify-content:center;font-family:var(--font-display);font-size:1.6rem;">${esc(rec.name.charAt(0))}</div>`
          }
          <div style="flex:1;min-width:0;">
            <div style="font-family:var(--font-display);font-size:1rem;letter-spacing:0.15em;color:var(--fg);">${esc(rec.name)}</div>
            <div style="font-family:var(--font-terminal);font-size:0.6rem;color:var(--muted-fg);letter-spacing:0.15em;margin-top:0.2rem;">
              ${fmtN(rec.xp)} XP · ${rec.lotes.length + rec.pedidos.length + rec.tarefas.length} evento(s) no período
            </div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:0.5rem;margin-top:1rem;">
          ${tabButton("lotes", "📦", "LOTES", rec.lotes.length, "var(--accent)")}
          ${tabButton("pedidos", "📋", "PEDIDOS", rec.pedidos.length, "var(--accent-3,#0284c7)")}
          ${tabButton("caixas", "▣", "CAIXAS", rec.caixas.length, "#7c3aed")}
          ${tabButton("tarefas", "🎯", "TAREFAS", rec.tarefas.length, "#ec4899")}
        </div>
      </div>

      <div id="detail-content"></div>
    `;

    page
      .querySelector("#back-grid")
      .addEventListener("click", () => {
        selectedStockistId = null;
        renderCurrentView();
      });

    page.querySelectorAll(".tab-btn-rec").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeTab = btn.dataset.tab;
        renderDetailContent(rec);
      });
    });

    renderDetailContent(rec);
  }

  function tabButton(key, icon, label, count, color) {
    const active = activeTab === key;
    return `
      <button class="tab-btn-rec cyber-chamfer-sm" data-tab="${key}"
              style="padding:0.6rem 0.5rem;border:1px solid ${active ? color : "var(--border)"};
                     background:${active ? color + "22" : "transparent"};cursor:pointer;
                     display:flex;flex-direction:column;align-items:center;gap:0.2rem;
                     transition:all 150ms;font-family:var(--font-terminal);">
        <div style="font-size:1.1rem;color:${color};">${icon}</div>
        <div style="font-family:var(--font-display);font-size:0.7rem;font-weight:800;color:${color};">${fmtN(count)}</div>
        <div style="font-size:0.55rem;letter-spacing:0.2em;color:var(--muted-fg);">${label}</div>
      </button>`;
  }

  function renderDetailContent(rec) {
    const wrap = page.querySelector("#detail-content");
    if (!wrap) return;

    // Update tab buttons active state
    page.querySelectorAll(".tab-btn-rec").forEach((btn) => {
      const isActive = btn.dataset.tab === activeTab;
      const colors = { lotes: "var(--accent)", pedidos: "var(--accent-3,#0284c7)", caixas: "#7c3aed", tarefas: "#ec4899" };
      const color = colors[btn.dataset.tab];
      btn.style.border = `1px solid ${isActive ? color : "var(--border)"}`;
      btn.style.background = isActive ? color + "22" : "transparent";
    });

    const items =
      activeTab === "lotes" ? rec.lotes :
      activeTab === "pedidos" ? rec.pedidos :
      activeTab === "caixas" ? rec.caixas :
      rec.tarefas;

    if (items.length === 0) {
      wrap.innerHTML = `<div class="card cyber-chamfer" style="padding:2rem;text-align:center;color:var(--muted-fg);font-family:var(--font-terminal);font-size:0.8rem;">
        Nenhum(a) ${activeTab} no período.
      </div>`;
      return;
    }

    const pageNum = pageByTab[activeTab] || 1;
    const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
    const start = (pageNum - 1) * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);

    const renderer =
      activeTab === "lotes" ? renderLoteCard :
      activeTab === "pedidos" ? renderPedidoCard :
      activeTab === "caixas" ? renderCaixaCard :
      renderTarefaCard;

    wrap.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:0.6rem;">
        ${slice.map(renderer).join("")}
      </div>
      ${totalPages > 1 ? `
        <div style="display:flex;align-items:center;justify-content:center;gap:0.5rem;margin-top:1rem;">
          <button id="pg-prev" class="btn btn--ghost btn--sm" ${pageNum <= 1 ? "disabled" : ""} style="padding:0.3rem 0.7rem;">‹ ANTERIOR</button>
          <span style="font-family:var(--font-terminal);font-size:0.7rem;color:var(--muted-fg);min-width:6rem;text-align:center;letter-spacing:0.1em;">
            ${start + 1}–${Math.min(start + PAGE_SIZE, items.length)} de ${items.length}
          </span>
          <button id="pg-next" class="btn btn--ghost btn--sm" ${pageNum >= totalPages ? "disabled" : ""} style="padding:0.3rem 0.7rem;">PRÓXIMA ›</button>
        </div>
      ` : ""}
    `;

    const prev = wrap.querySelector("#pg-prev");
    const next = wrap.querySelector("#pg-next");
    if (prev) prev.addEventListener("click", () => {
      if (pageByTab[activeTab] > 1) {
        pageByTab[activeTab]--;
        renderDetailContent(rec);
      }
    });
    if (next) next.addEventListener("click", () => {
      const totalP = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
      if (pageByTab[activeTab] < totalP) {
        pageByTab[activeTab]++;
        renderDetailContent(rec);
      }
    });
  }

  function renderLoteCard(r) {
    return `
      <div class="card cyber-chamfer" style="padding:0.85rem 1rem;display:flex;align-items:center;gap:1rem;border-left:3px solid var(--accent);">
        <div style="font-size:1.4rem;flex-shrink:0;">📦</div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-display);font-size:0.9rem;color:var(--accent);font-weight:800;letter-spacing:0.05em;">${esc(r.code)}</div>
          <div style="font-family:var(--font-terminal);font-size:0.65rem;color:var(--muted-fg);letter-spacing:0.1em;margin-top:0.15rem;">
            ${esc(r.type)} · ${fmtDate(r.when)}
          </div>
        </div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;justify-content:flex-end;">
          ${chip(r.orders + " pedidos", "var(--fg)")}
          ${chip(r.items + " itens", "var(--accent)")}
          ${chip(fmtN(r.xp) + " XP", "var(--accent-3,#0284c7)")}
        </div>
      </div>`;
  }

  function renderPedidoCard(r) {
    return `
      <div class="card cyber-chamfer" style="padding:0.85rem 1rem;display:flex;align-items:center;gap:1rem;border-left:3px solid var(--accent-3,#0284c7);">
        <div style="font-size:1.4rem;flex-shrink:0;">📋</div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-display);font-size:0.9rem;color:var(--accent-3,#0284c7);font-weight:800;letter-spacing:0.05em;">${esc(r.code)}</div>
          <div style="font-family:var(--font-terminal);font-size:0.65rem;color:var(--muted-fg);letter-spacing:0.1em;margin-top:0.15rem;">
            ${fmtDate(r.when)}${r.boxCode ? ` · Caixa <span style="color:var(--accent);">${esc(r.boxCode)}</span>` : ""}
          </div>
        </div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;justify-content:flex-end;">
          ${chip(r.items + " itens", "var(--accent)")}
          ${chip(fmtN(r.xp) + " XP", "var(--accent-3,#0284c7)")}
        </div>
      </div>`;
  }

  function renderCaixaCard(r) {
    return `
      <div class="card cyber-chamfer" style="padding:0.85rem 1rem;display:flex;align-items:center;gap:1rem;border-left:3px solid #7c3aed;">
        <div style="font-size:1.4rem;flex-shrink:0;color:#7c3aed;">▣</div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-display);font-size:0.9rem;color:#7c3aed;font-weight:800;letter-spacing:0.05em;">${esc(r.code)}</div>
          <div style="font-family:var(--font-terminal);font-size:0.65rem;color:var(--muted-fg);letter-spacing:0.1em;margin-top:0.15rem;">
            ${esc(r.origin)} · ${fmtDate(r.when)}
          </div>
        </div>
        ${r.orderCode ? chip("Pedido " + r.orderCode, "var(--fg)") : ""}
      </div>`;
  }

  function renderTarefaCard(r) {
    return `
      <div class="card cyber-chamfer" style="padding:0.85rem 1rem;display:flex;align-items:center;gap:1rem;border-left:3px solid #ec4899;">
        <div style="font-size:1.4rem;flex-shrink:0;">🎯</div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:var(--font-display);font-size:0.9rem;color:#ec4899;font-weight:800;letter-spacing:0.05em;">${esc(r.taskName)}</div>
          <div style="font-family:var(--font-terminal);font-size:0.65rem;color:var(--muted-fg);letter-spacing:0.1em;margin-top:0.15rem;">
            ${fmtDay(r.when)}
          </div>
        </div>
        <div style="display:flex;gap:0.75rem;flex-wrap:wrap;justify-content:flex-end;">
          ${chip(r.quantity + "x", "var(--fg)")}
          ${chip(fmtN(r.xp) + " XP", "var(--accent-3,#0284c7)")}
        </div>
      </div>`;
  }

  function chip(text, color) {
    return `<span style="font-family:var(--font-terminal);font-size:0.65rem;letter-spacing:0.1em;
                         padding:0.2rem 0.5rem;border:1px solid ${color};color:${color};white-space:nowrap;">
      ${esc(text)}
    </span>`;
  }

  load();

  return () => {
    if (searchDebounce) {
      clearTimeout(searchDebounce);
      searchDebounce = null;
    }
  };
}
