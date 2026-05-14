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
      load();
    });
  });
  container
    .querySelector("#refresh-btn")
    .addEventListener("click", () => load(true));

  const page = container.querySelector("#rec-page");
  const cacheBadge = container.querySelector("#cache-badge");
  let searchDebounce = null;

  async function load(forceRefresh = false) {
    const cacheKey = `${period}:${isAdmin ? "admin" : ctx.unitId}`;

    if (!forceRefresh) {
      const hit = _cache.get(cacheKey);
      if (hit && Date.now() - hit.ts < CACHE_TTL) {
        const age = Math.floor((Date.now() - hit.ts) / 1000);
        cacheBadge.style.display = "";
        cacheBadge.textContent = `CACHE · ${age}s atrás`;
        render(hit);
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

      const data = { events, stockistNames, taskNames, ts: Date.now() };
      _cache.set(cacheKey, data);
      render(data);
    } catch (err) {
      page.innerHTML = `<div class="card cyber-chamfer text-center" style="padding:2rem;">
        <div class="text-destructive" style="font-family:var(--font-terminal);">Erro ao carregar: ${esc(err.message)}</div>
      </div>`;
    }
  }

  function render({ events, stockistNames, taskNames = {} }) {
    const batchRows = events
      .filter((ev) =>
        ["BATCH", "ONLY_SEPARATION", "ONLY_BIPPING"].includes(ev.type),
      )
      .map((ev) => ({
        when: toDate(ev.createdAt),
        code: ev.batch?.batchCode || "—",
        type: TYPE_LABELS[ev.type] || ev.type,
        orders: ev.batch?.totalOrders ?? ev.batch?.orders?.length ?? 0,
        items: ev.batch?.totalItems || 0,
        name: stockistNames[ev.stockistId] || ev.stockistId || "—",
      }))
      .sort((a, b) => b.when - a.when);

    const orderRows = events
      .filter((ev) => ev.type === "SINGLE_ORDER")
      .map((ev) => ({
        when: toDate(ev.createdAt),
        code: ev.singleOrder?.orderCode || "—",
        items: ev.singleOrder?.items || 0,
        boxCode: ev.singleOrder?.boxCode || "—",
        name: stockistNames[ev.stockistId] || ev.stockistId || "—",
      }))
      .sort((a, b) => b.when - a.when);

    const boxRows = [];
    events.forEach((ev) => {
      const baseWhen = toDate(ev.createdAt);
      const sname = stockistNames[ev.stockistId] || ev.stockistId || "—";
      if (
        ev.batch?.boxCodes &&
        ["BATCH", "ONLY_BIPPING"].includes(ev.type)
      ) {
        Object.entries(ev.batch.boxCodes).forEach(([orderCode, box]) => {
          if (!box) return;
          boxRows.push({
            when: baseWhen,
            code: String(box),
            origin: `LOTE ${ev.batch?.batchCode || "—"}`,
            orderCode,
            name: sname,
          });
        });
      } else if (ev.type === "SINGLE_ORDER" && ev.singleOrder?.boxCode) {
        boxRows.push({
          when: baseWhen,
          code: String(ev.singleOrder.boxCode),
          origin: `PEDIDO ${ev.singleOrder.orderCode || "—"}`,
          orderCode: ev.singleOrder.orderCode || "",
          name: sname,
        });
      }
    });
    boxRows.sort((a, b) => b.when - a.when);

    const taskMap = new Map();
    events.forEach((ev) => {
      if (ev.type !== "TASK") return;
      const when = toDate(ev.createdAt);
      const dayKey = `${when.getFullYear()}-${when.getMonth()}-${when.getDate()}`;
      const taskId = ev.task?.taskId || "—";
      const stockistId = ev.stockistId || "—";
      const key = `${dayKey}|${taskId}|${stockistId}`;
      let row = taskMap.get(key);
      if (!row) {
        row = {
          when,
          taskId,
          taskName: taskNames[taskId] || taskId,
          quantity: 0,
          xp: 0,
          name: stockistNames[stockistId] || stockistId || "—",
        };
        taskMap.set(key, row);
      }
      row.quantity += ev.task?.quantity || 1;
      row.xp += ev.xp || 0;
    });
    const taskRows = [...taskMap.values()].sort(
      (a, b) => b.when - a.when || b.xp - a.xp,
    );

    page.innerHTML = `
      <div class="card cyber-chamfer mb-2" style="padding:1rem;">
        <div class="section-title mb-2">🔎 BUSCA</div>
        <input id="rec-search" type="text" class="input"
               placeholder="Digite código de lote, pedido, caixa, tarefa ou nome..."
               style="width:100%;font-family:var(--font-terminal);"
               autocomplete="off" inputmode="search">
        <div class="text-muted text-xs mt-1" style="font-family:var(--font-terminal);">
          ${PAGE_SIZE} por página. Use ‹ › para navegar. Busca filtra todo o período carregado.
        </div>
      </div>

      ${tableCard("lote", "📦 LOTES", [
        "DATA", "LOTE", "TIPO", "PEDIDOS", "ITENS", "ESTOQUISTA",
      ], [
        "left", "left", "left", "right", "right", "left",
      ])}

      ${tableCard("order", "📋 PEDIDOS AVULSOS", [
        "DATA", "PEDIDO", "ITENS", "CAIXA", "ESTOQUISTA",
      ], [
        "left", "left", "right", "left", "left",
      ])}

      ${tableCard("box", "📦 CAIXAS", [
        "DATA", "CAIXA", "ORIGEM", "PEDIDO", "ESTOQUISTA",
      ], [
        "left", "left", "left", "left", "left",
      ])}

      ${tableCard("task", "🎯 TAREFAS", [
        "DATA", "TAREFA", "QTD", "XP", "ESTOQUISTA",
      ], [
        "left", "left", "right", "right", "left",
      ])}
    `;

    const renderRow = (cells) =>
      `<tr style="border-bottom:1px solid var(--border);">${cells}</tr>`;

    const operatorCell = (name) => {
      const photo = stockistPhoto(name);
      return `<td style="padding:0.4rem;"><div style="display:flex;align-items:center;gap:0.4rem;">
        ${photo ? `<img src="${photo}" style="width:22px;height:22px;border-radius:50%;object-fit:cover;border:1px solid var(--border);flex-shrink:0;" onerror="this.style.display='none'">` : ""}
        <span>${esc(name)}</span>
      </div></td>`;
    };

    const renderers = {
      lote: (r) =>
        `<td style="padding:0.4rem;color:var(--muted-fg);font-size:0.65rem;">${fmtDate(r.when)}</td>
         <td style="padding:0.4rem;color:var(--accent);font-weight:700;">${esc(r.code)}</td>
         <td style="padding:0.4rem;font-size:0.65rem;">${esc(r.type)}</td>
         <td style="padding:0.4rem;text-align:right;">${r.orders}</td>
         <td style="padding:0.4rem;text-align:right;">${r.items}</td>
         ${operatorCell(r.name)}`,
      order: (r) =>
        `<td style="padding:0.4rem;color:var(--muted-fg);font-size:0.65rem;">${fmtDate(r.when)}</td>
         <td style="padding:0.4rem;color:var(--accent);font-weight:700;">${esc(r.code)}</td>
         <td style="padding:0.4rem;text-align:right;">${r.items}</td>
         <td style="padding:0.4rem;color:var(--accent-3,#0284c7);">${esc(r.boxCode)}</td>
         ${operatorCell(r.name)}`,
      box: (r) =>
        `<td style="padding:0.4rem;color:var(--muted-fg);font-size:0.65rem;">${fmtDate(r.when)}</td>
         <td style="padding:0.4rem;color:var(--accent);font-weight:700;">${esc(r.code)}</td>
         <td style="padding:0.4rem;font-size:0.65rem;">${esc(r.origin)}</td>
         <td style="padding:0.4rem;font-size:0.65rem;color:var(--muted-fg);">${esc(r.orderCode || "—")}</td>
         ${operatorCell(r.name)}`,
      task: (r) =>
        `<td style="padding:0.4rem;color:var(--muted-fg);font-size:0.65rem;">${fmtDay(r.when)}</td>
         <td style="padding:0.4rem;color:var(--accent);font-weight:700;">${esc(r.taskName)}</td>
         <td style="padding:0.4rem;text-align:right;">${r.quantity}</td>
         <td style="padding:0.4rem;text-align:right;color:var(--accent-3,#0284c7);">${r.xp}</td>
         ${operatorCell(r.name)}`,
    };

    const haystacks = {
      lote: (r) => r.code + " " + r.type + " " + r.name,
      order: (r) => r.code + " " + r.boxCode + " " + r.name,
      box: (r) => r.code + " " + r.origin + " " + r.orderCode + " " + r.name,
      task: (r) => r.taskName + " " + r.taskId + " " + r.name,
    };

    const labels = {
      lote: { singular: "lote", plural: "lotes", cols: 6 },
      order: { singular: "pedido avulso", plural: "pedidos avulsos", cols: 5 },
      box: { singular: "caixa", plural: "caixas", cols: 5 },
      task: { singular: "tarefa", plural: "tarefas", cols: 5 },
    };

    const datasets = {
      lote: batchRows,
      order: orderRows,
      box: boxRows,
      task: taskRows,
    };

    const pages = { lote: 1, order: 1, box: 1, task: 1 };
    let currentFilter = "";

    function renderTable(key) {
      const all = datasets[key];
      const f = currentFilter;
      const filtered = f
        ? all.filter((r) => haystacks[key](r).toLowerCase().includes(f))
        : all;

      const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (pages[key] > totalPages) pages[key] = totalPages;
      if (pages[key] < 1) pages[key] = 1;

      const start = (pages[key] - 1) * PAGE_SIZE;
      const slice = filtered.slice(start, start + PAGE_SIZE);

      const body = page.querySelector(`#rec-${key}-body`);
      if (slice.length) {
        body.innerHTML = slice.map((r) => renderRow(renderers[key](r))).join("");
      } else {
        body.innerHTML = `<tr><td colspan="${labels[key].cols}" style="padding:1rem;text-align:center;color:var(--muted-fg);font-size:0.7rem;">${
          f
            ? `Nenhum(a) ${labels[key].singular} encontrado(a) para a busca.`
            : `Sem ${labels[key].plural} no período.`
        }</td></tr>`;
      }

      const totalLabel = filtered.length;
      page.querySelector(`#rec-${key}-count`).textContent = totalLabel
        ? `(${start + 1}–${Math.min(start + PAGE_SIZE, totalLabel)} de ${totalLabel})`
        : "(0)";

      const prevBtn = page.querySelector(`#rec-${key}-prev`);
      const nextBtn = page.querySelector(`#rec-${key}-next`);
      const pageInfo = page.querySelector(`#rec-${key}-page`);
      if (prevBtn) prevBtn.disabled = pages[key] <= 1;
      if (nextBtn) nextBtn.disabled = pages[key] >= totalPages;
      if (pageInfo) pageInfo.textContent = `${pages[key]} / ${totalPages}`;
    }

    function renderAll(filter = currentFilter) {
      currentFilter = filter.trim().toLowerCase();
      pages.lote = pages.order = pages.box = pages.task = 1;
      renderTable("lote");
      renderTable("order");
      renderTable("box");
      renderTable("task");
    }

    ["lote", "order", "box", "task"].forEach((key) => {
      page
        .querySelector(`#rec-${key}-prev`)
        .addEventListener("click", () => {
          pages[key]--;
          renderTable(key);
        });
      page
        .querySelector(`#rec-${key}-next`)
        .addEventListener("click", () => {
          pages[key]++;
          renderTable(key);
        });
    });

    renderAll("");

    const searchInput = page.querySelector("#rec-search");
    searchInput.addEventListener("input", (e) => {
      if (searchDebounce) clearTimeout(searchDebounce);
      const v = e.target.value;
      searchDebounce = setTimeout(() => {
        searchDebounce = null;
        if (page.querySelector("#rec-lote-body")) renderAll(v);
      }, 120);
    });
  }

  load();

  return () => {
    if (searchDebounce) {
      clearTimeout(searchDebounce);
      searchDebounce = null;
    }
  };
}

function tableCard(key, title, cols, aligns) {
  const ths = cols
    .map(
      (c, i) =>
        `<th style="padding:0.5rem 0.4rem;text-align:${aligns[i]};">${c}</th>`,
    )
    .join("");
  return `
    <div class="card cyber-chamfer mb-2">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
        <div class="section-title" style="margin:0;">${title} <span id="rec-${key}-count" style="color:var(--muted-fg);font-size:0.7rem;font-weight:400;letter-spacing:0.1em;"></span></div>
        <div style="display:flex;align-items:center;gap:0.3rem;">
          <button id="rec-${key}-prev" class="btn btn--ghost btn--sm" style="padding:0.25rem 0.6rem;">‹</button>
          <span id="rec-${key}-page" style="font-family:var(--font-terminal);font-size:0.65rem;color:var(--muted-fg);min-width:3.5rem;text-align:center;">1 / 1</span>
          <button id="rec-${key}-next" class="btn btn--ghost btn--sm" style="padding:0.25rem 0.6rem;">›</button>
        </div>
      </div>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:0.72rem;font-family:var(--font-terminal);">
          <thead><tr style="border-bottom:2px solid var(--border);color:var(--muted-fg);font-size:0.6rem;letter-spacing:0.12em;">
            ${ths}
          </tr></thead>
          <tbody id="rec-${key}-body"></tbody>
        </table>
      </div>
    </div>
  `;
}
