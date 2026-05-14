import { getCurrentUser, getSessionContext } from "../auth.js";
import { navigate } from "../router.js";
import {
  getEvents,
  getAllEvents,
  getAllUnits,
  getUnit,
  dateRangeForPeriod,
} from "../services/firestore.js";
import { stockistPhoto } from "../services/photos.js";

const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
const INITIAL_LIMIT = 50;

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
        stockistNames = {};

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
        units = unit ? [unit] : [];
      }

      units.forEach((u) =>
        (u.stockists || []).forEach((s) => {
          stockistNames[s.id] = s.name;
        }),
      );

      const data = { events, stockistNames, ts: Date.now() };
      _cache.set(cacheKey, data);
      render(data);
    } catch (err) {
      page.innerHTML = `<div class="card cyber-chamfer text-center" style="padding:2rem;">
        <div class="text-destructive" style="font-family:var(--font-terminal);">Erro ao carregar: ${esc(err.message)}</div>
      </div>`;
    }
  }

  function render({ events, stockistNames }) {
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

    page.innerHTML = `
      <div class="card cyber-chamfer mb-2" style="padding:1rem;">
        <div class="section-title mb-2">🔎 BUSCA</div>
        <input id="rec-search" type="text" class="input"
               placeholder="Digite código de lote, pedido ou caixa..."
               style="width:100%;font-family:var(--font-terminal);"
               autocomplete="off" inputmode="search">
        <div class="text-muted text-xs mt-1" style="font-family:var(--font-terminal);">
          Sem busca: últimos ${INITIAL_LIMIT} de cada categoria. Com busca: filtra todo o período carregado.
        </div>
      </div>

      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">📦 LOTES <span id="rec-lote-count" style="color:var(--muted-fg);font-size:0.7rem;"></span></div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.72rem;font-family:var(--font-terminal);">
            <thead><tr style="border-bottom:2px solid var(--border);color:var(--muted-fg);font-size:0.6rem;letter-spacing:0.12em;">
              <th style="padding:0.5rem 0.4rem;text-align:left;">DATA</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">LOTE</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">TIPO</th>
              <th style="padding:0.5rem 0.4rem;text-align:right;">PEDIDOS</th>
              <th style="padding:0.5rem 0.4rem;text-align:right;">ITENS</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">ESTOQUISTA</th>
            </tr></thead>
            <tbody id="rec-lote-body"></tbody>
          </table>
        </div>
      </div>

      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">📋 PEDIDOS AVULSOS <span id="rec-order-count" style="color:var(--muted-fg);font-size:0.7rem;"></span></div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.72rem;font-family:var(--font-terminal);">
            <thead><tr style="border-bottom:2px solid var(--border);color:var(--muted-fg);font-size:0.6rem;letter-spacing:0.12em;">
              <th style="padding:0.5rem 0.4rem;text-align:left;">DATA</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">PEDIDO</th>
              <th style="padding:0.5rem 0.4rem;text-align:right;">ITENS</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">CAIXA</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">ESTOQUISTA</th>
            </tr></thead>
            <tbody id="rec-order-body"></tbody>
          </table>
        </div>
      </div>

      <div class="card cyber-chamfer mb-3">
        <div class="section-title mb-2">📦 CAIXAS <span id="rec-box-count" style="color:var(--muted-fg);font-size:0.7rem;"></span></div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.72rem;font-family:var(--font-terminal);">
            <thead><tr style="border-bottom:2px solid var(--border);color:var(--muted-fg);font-size:0.6rem;letter-spacing:0.12em;">
              <th style="padding:0.5rem 0.4rem;text-align:left;">DATA</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">CAIXA</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">ORIGEM</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">PEDIDO</th>
              <th style="padding:0.5rem 0.4rem;text-align:left;">ESTOQUISTA</th>
            </tr></thead>
            <tbody id="rec-box-body"></tbody>
          </table>
        </div>
      </div>
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

    function renderTables(filter = "") {
      const f = filter.trim().toLowerCase();
      const filterFn = (rows, getHaystack) =>
        f
          ? rows.filter((r) => String(getHaystack(r)).toLowerCase().includes(f))
          : rows;

      const fLotes = filterFn(batchRows, (r) => r.code + " " + r.name);
      const fOrders = filterFn(
        orderRows,
        (r) => r.code + " " + r.boxCode + " " + r.name,
      );
      const fBoxes = filterFn(
        boxRows,
        (r) => r.code + " " + r.origin + " " + r.orderCode + " " + r.name,
      );

      const limit = f ? Infinity : INITIAL_LIMIT;

      const loteHtml = fLotes
        .slice(0, limit)
        .map((r) =>
          renderRow(
            `<td style="padding:0.4rem;color:var(--muted-fg);font-size:0.65rem;">${fmtDate(r.when)}</td>
             <td style="padding:0.4rem;color:var(--accent);font-weight:700;">${esc(r.code)}</td>
             <td style="padding:0.4rem;font-size:0.65rem;">${esc(r.type)}</td>
             <td style="padding:0.4rem;text-align:right;">${r.orders}</td>
             <td style="padding:0.4rem;text-align:right;">${r.items}</td>
             ${operatorCell(r.name)}`,
          ),
        )
        .join("");

      const orderHtml = fOrders
        .slice(0, limit)
        .map((r) =>
          renderRow(
            `<td style="padding:0.4rem;color:var(--muted-fg);font-size:0.65rem;">${fmtDate(r.when)}</td>
             <td style="padding:0.4rem;color:var(--accent);font-weight:700;">${esc(r.code)}</td>
             <td style="padding:0.4rem;text-align:right;">${r.items}</td>
             <td style="padding:0.4rem;color:var(--accent-3,#0284c7);">${esc(r.boxCode)}</td>
             ${operatorCell(r.name)}`,
          ),
        )
        .join("");

      const boxHtml = fBoxes
        .slice(0, limit)
        .map((r) =>
          renderRow(
            `<td style="padding:0.4rem;color:var(--muted-fg);font-size:0.65rem;">${fmtDate(r.when)}</td>
             <td style="padding:0.4rem;color:var(--accent);font-weight:700;">${esc(r.code)}</td>
             <td style="padding:0.4rem;font-size:0.65rem;">${esc(r.origin)}</td>
             <td style="padding:0.4rem;font-size:0.65rem;color:var(--muted-fg);">${esc(r.orderCode || "—")}</td>
             ${operatorCell(r.name)}`,
          ),
        )
        .join("");

      const empty = (cols, msg) =>
        `<tr><td colspan="${cols}" style="padding:1rem;text-align:center;color:var(--muted-fg);font-size:0.7rem;">${msg}</td></tr>`;

      page.querySelector("#rec-lote-body").innerHTML =
        loteHtml ||
        empty(6, f ? "Nenhum lote encontrado para a busca." : "Nenhum lote no período.");
      page.querySelector("#rec-order-body").innerHTML =
        orderHtml ||
        empty(
          5,
          f ? "Nenhum pedido avulso encontrado para a busca." : "Nenhum pedido avulso no período.",
        );
      page.querySelector("#rec-box-body").innerHTML =
        boxHtml ||
        empty(5, f ? "Nenhuma caixa encontrada para a busca." : "Nenhuma caixa no período.");

      const cnt = (filtered, total) =>
        `(${Math.min(filtered.length, limit)}/${total.length}${f && filtered.length < total.length ? ` · de ${total.length}` : ""})`;
      page.querySelector("#rec-lote-count").textContent = cnt(fLotes, batchRows);
      page.querySelector("#rec-order-count").textContent = cnt(fOrders, orderRows);
      page.querySelector("#rec-box-count").textContent = cnt(fBoxes, boxRows);
    }

    renderTables("");

    const searchInput = page.querySelector("#rec-search");
    searchInput.addEventListener("input", (e) => {
      if (searchDebounce) clearTimeout(searchDebounce);
      const v = e.target.value;
      searchDebounce = setTimeout(() => {
        searchDebounce = null;
        if (page.querySelector("#rec-lote-body")) renderTables(v);
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
