import { getCurrentUser, getSessionContext } from "../auth.js";
import { navigate } from "../router.js";
import {
  getEvents,
  getAllEvents,
  getAllUnits,
  getUnit,
  dateRangeForPeriod,
  computeRanking,
} from "../services/firestore.js";
import { stockistPhoto } from "../services/photos.js";

// Cache de 5 min para analytics — evita centenas de leituras desnecessárias
const _cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;
let _leafletMap = null;
let _geoJsonCache = null;

// Cidades por VD e suas coordenadas em Alagoas
const VD_CITIES_MAP = {
  "VD Palmeira": [
    "Palmeira dos Índios",
    "Minador",
    "Cacimbinhas",
    "Igaci",
    "Quebrangulo",
    "Major Isidoro",
    "Estrela de Alagoas",
  ],
  "VD Penedo": [
    "Junqueiro",
    "São Brás",
    "Olho d'água",
    "Porto Real do Colégio",
    "Igreja Nova",
    "São Sebastião",
    "Penedo",
    "Teotônio Vilela",
    "Coruripe",
    "Feliz Deserto",
    "Piaçabuçu",
  ],
};

const CITY_COORDS = {
  "Palmeira dos Índios": [-9.408, -36.624],
  Minador: [-9.267, -36.914],
  Cacimbinhas: [-9.407, -36.99],
  Igaci: [-9.529, -36.637],
  Quebrangulo: [-9.321, -36.474],
  "Major Isidoro": [-9.526, -36.961],
  "Estrela de Alagoas": [-9.341, -36.659],
  Junqueiro: [-9.933, -36.487],
  "São Brás": [-10.149, -36.773],
  "Olho d'água": [-9.543, -37.143],
  "Porto Real do Colégio": [-10.188, -36.835],
  "Igreja Nova": [-10.128, -36.659],
  "São Sebastião": [-9.898, -36.892],
  Penedo: [-10.289, -36.585],
  "Teotônio Vilela": [-9.917, -36.357],
  Coruripe: [-10.125, -36.177],
  "Feliz Deserto": [-10.218, -36.321],
  Piaçabuçu: [-10.406, -36.432],
};

function toDate(ts) {
  if (!ts) return new Date(0);
  if (typeof ts.toDate === "function") return ts.toDate();
  return new Date(ts);
}

function fmtTime(secs) {
  if (!secs) return "—";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function fmtN(n) {
  return (n || 0).toLocaleString("pt-BR");
}

function avg(values) {
  const valid = values.filter((v) => Number.isFinite(v));
  return valid.length ? valid.reduce((s, v) => s + v, 0) / valid.length : 0;
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function formatHours(hours) {
  if (!Number.isFinite(hours) || hours <= 0) return "0h";
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function getImportMeta(ev) {
  return ev.batch?.importMeta || ev.singleOrder?.importMeta || null;
}

function parseBRDateTime(dateText, timeText = "") {
  if (!dateText) return null;
  const m = String(dateText).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const tm = String(timeText || "").match(/^(\d{2}):(\d{2})/);
  return new Date(
    Number(m[3]),
    Number(m[2]) - 1,
    Number(m[1]),
    tm ? Number(tm[1]) : 0,
    tm ? Number(tm[2]) : 0,
  );
}

function pdfReferenceDate(meta) {
  if (!meta) return null;
  const exportedAt = meta.exportedAt?.toDate
    ? meta.exportedAt.toDate()
    : meta.exportedAt
      ? new Date(meta.exportedAt)
      : null;
  if (exportedAt && !Number.isNaN(exportedAt.getTime())) return exportedAt;
  return parseBRDateTime(
    meta.orderDate || meta.exportedDate,
    meta.exportedTime,
  );
}

// ─── Chart color palette ─────────────────────────────────────────────────────
const C = {
  green: "#059669",
  purple: "#7c3aed",
  blue: "#0284c7",
  amber: "#d97706",
  red: "#dc2626",
  gray: "#6d28d9",
  gold: "#ffdd00",
  silver: "#c0c0c0",
  bronze: "#cd7f32",
  gridLine: "rgba(109,40,217,0.08)",
  tickColor: "#6d28d9",
};

const typeLabels = {
  BATCH: "Função Completa",
  ONLY_SEPARATION: "Só Separação",
  ONLY_BIPPING: "Só Bipador",
  SINGLE_ORDER: "Pedido Avulso",
  TASK: "Tarefas",
};

export async function renderAnalytics(container, params) {
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
        <div class="topbar-logo" style="font-size:0.85rem;">📊 ANALYTICS</div>
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
    <div class="page screen-enter" id="an-page">
      <div class="text-center mt-4">
        <div class="spinner" style="margin:0 auto;"></div>
        <div class="text-muted mt-2" style="font-family:var(--font-terminal);letter-spacing:0.2em;font-size:0.75rem;">PROCESSANDO DADOS...</div>
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

  const page = container.querySelector("#an-page");
  const cacheBadge = container.querySelector("#cache-badge");

  async function load(forceRefresh = false) {
    const cacheKey = `${period}:${isAdmin ? "admin" : ctx.unitId}`;

    if (!forceRefresh) {
      const hit = _cache.get(cacheKey);
      if (hit && Date.now() - hit.ts < CACHE_TTL) {
        const age = Math.floor((Date.now() - hit.ts) / 1000);
        cacheBadge.style.display = "";
        cacheBadge.textContent = `CACHE · ${age}s atrás`;
        render(hit.events, hit.units, hit.stockistNames);
        return;
      }
    }

    cacheBadge.style.display = "none";
    page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div><div class="text-muted mt-2" style="font-family:var(--font-terminal);letter-spacing:0.2em;font-size:0.75rem;">PROCESSANDO DADOS...</div></div>`;

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
      _cache.set(cacheKey, { events, units, stockistNames, ts: Date.now() });
      cacheBadge.style.display = "none";
      render(events, units, stockistNames);
    } catch (err) {
      page.innerHTML = `<div class="text-center mt-4 text-destructive">Erro: ${err.message}</div>`;
    }
  }

  function render(events, units, stockistNames) {
    // Destroy previous charts so canvas can be reused
    Object.values(Chart.instances || {}).forEach((c) => c.destroy());

    // ── KPIs ──────────────────────────────────────────────────────────
    const totalXP = events.reduce((s, e) => s + (e.xp || 0), 0);
    const batchEvts = events.filter((e) =>
      ["BATCH", "ONLY_SEPARATION", "ONLY_BIPPING"].includes(e.type),
    );
    const totalBatches = batchEvts.length;
    const totalOrders = events.reduce((s, e) => {
      if (e.batch?.totalOrders) return s + e.batch.totalOrders;
      return e.type === "SINGLE_ORDER" ? s + 1 : s;
    }, 0);
    const totalItems = events.reduce((s, e) => {
      if (
        (e.type === "BATCH" || e.type === "ONLY_BIPPING") &&
        e.batch?.totalItems
      )
        return s + e.batch.totalItems;
      if (e.type === "SINGLE_ORDER")
        return s + (e.singleOrder?.items || e.batch?.totalItems || 1);
      return s;
    }, 0);
    const totalTaskQty = events
      .filter((e) => e.type === "TASK")
      .reduce((s, e) => s + (e.task?.quantity || 0), 0);
    const activeStockists = new Set(events.map((e) => e.stockistId)).size;
    const totalSecs = batchEvts.reduce(
      (s, e) =>
        s + (e.batch?.separationSeconds || 0) + (e.batch?.bippingSeconds || 0),
      0,
    );
    const avgSpeed =
      totalSecs > 0 && totalItems > 0
        ? (totalItems / (totalSecs / 60)).toFixed(1)
        : null;
    const avgBatchTime =
      totalBatches > 0 ? Math.round(totalSecs / totalBatches) : 0;
    const bonusEvents = events.filter(
      (e) => e.xpBonus > 0 || (e.xp && e.xp > (e.xpBase || 0)),
    ).length;
    const bonusPct =
      events.length > 0 ? Math.round((bonusEvents / events.length) * 100) : 0;

    // ── Ranking ───────────────────────────────────────────────────────
    const ranking = computeRanking(events);

    // ── XP by day (sort chronologically) ─────────────────────────────
    const byDayMap = {};
    events.forEach((e) => {
      const d = toDate(e.createdAt);
      const key = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
      byDayMap[key] = (byDayMap[key] || 0) + (e.xp || 0);
    });
    const dayKeys = Object.keys(byDayMap).sort((a, b) => {
      const [da, ma] = a.split("/").map(Number);
      const [db, mb] = b.split("/").map(Number);
      return ma !== mb ? ma - mb : da - db;
    });
    const dayVals = dayKeys.map((k) => byDayMap[k]);

    // ── XP accumulated per day (running total) ────────────────────────
    const dayAcc = dayVals.reduce((acc, v, i) => {
      acc.push((acc[i - 1] || 0) + v);
      return acc;
    }, []);

    // ── Activity by hour ──────────────────────────────────────────────
    const byHour = Array(24).fill(0);
    events.forEach((e) => {
      byHour[toDate(e.createdAt).getHours()]++;
    });
    const peakHour = byHour.indexOf(Math.max(...byHour));

    // ── By type ───────────────────────────────────────────────────────
    const byType = {};
    events.forEach((e) => {
      byType[e.type] = (byType[e.type] || 0) + 1;
    });

    // ── Speed distribution (itens/min per batch event) ────────────────
    const speeds = batchEvts
      .filter(
        (e) =>
          e.batch?.totalItems > 0 &&
          (e.batch?.separationSeconds || 0) + (e.batch?.bippingSeconds || 0) >
            0,
      )
      .map((e) => {
        const secs =
          (e.batch.separationSeconds || 0) + (e.batch.bippingSeconds || 0);
        return +(e.batch.totalItems / (secs / 60)).toFixed(1);
      });
    const speedBuckets = ["0-3", "3-5", "5-7", "7-10", "10+"];
    const speedCounts = [0, 0, 0, 0, 0];
    speeds.forEach((s) => {
      if (s < 3) speedCounts[0]++;
      else if (s < 5) speedCounts[1]++;
      else if (s < 7) speedCounts[2]++;
      else if (s < 10) speedCounts[3]++;
      else speedCounts[4]++;
    });

    // ── Per-unit (admin) ──────────────────────────────────────────────
    const unitStats =
      isAdmin && units.length > 1
        ? units.map((u) => {
            const ue = events.filter((ev) => ev.unitId === u.id);
            return {
              name: u.name,
              xp: ue.reduce((s, ev) => s + (ev.xp || 0), 0),
              batches: ue.filter((ev) =>
                ["BATCH", "ONLY_SEPARATION", "ONLY_BIPPING"].includes(ev.type),
              ).length,
              items: ue.reduce((s, ev) => {
                if (
                  (ev.type === "BATCH" || ev.type === "ONLY_BIPPING") &&
                  ev.batch?.totalItems
                )
                  return s + ev.batch.totalItems;
                if (ev.type === "SINGLE_ORDER")
                  return (
                    s + (ev.singleOrder?.items || ev.batch?.totalItems || 0)
                  );
                return s;
              }, 0),
              orders: ue.reduce(
                (s, ev) =>
                  s +
                  (ev.batch?.totalOrders ||
                    (ev.type === "SINGLE_ORDER" ? 1 : 0)),
                0,
              ),
              stockists: new Set(ue.map((ev) => ev.stockistId)).size,
              events: ue.length,
            };
          })
        : null;

    // ── Top performers ────────────────────────────────────────────────
    const fastest = [...ranking]
      .filter((r) => r.totalSecs > 0 && r.items > 0)
      .sort(
        (a, b) => b.items / (b.totalSecs / 60) - a.items / (a.totalSecs / 60),
      )[0];
    const mostBatches = [...ranking].sort((a, b) => b.batches - a.batches)[0];
    const mostItems = [...ranking].sort((a, b) => b.items - a.items)[0];
    const mostOrders = [...ranking].sort((a, b) => b.orders - a.orders)[0];

    const pdfEvents = events.filter(
      (ev) => getImportMeta(ev)?.sourceType === "pdf",
    );
    const pdfBatchEvents = pdfEvents.filter((ev) => ev.batch);
    const pdfMaterialRows = pdfBatchEvents.flatMap((ev) =>
      (ev.batch?.orders || []).map((o) => ({
        ...o,
        batchCode: ev.batch?.batchCode,
      })),
    );
    const unaddressedRows = pdfMaterialRows.filter(
      (o) => o.addressed === false || !o.address,
    );
    const totalPdfItems = pdfEvents.reduce((s, ev) => {
      const meta = getImportMeta(ev);
      if (ev.batch?.totalItems) return s + ev.batch.totalItems;
      if (ev.singleOrder?.items) return s + ev.singleOrder.items;
      return s + (meta?.totalItems || meta?.declaredItems || 0);
    }, 0);
    const unaddressedItems = pdfEvents.reduce(
      (s, ev) => s + (getImportMeta(ev)?.unaddressedItems || 0),
      0,
    );
    const unaddressedBySku = {};
    unaddressedRows.forEach((o) => {
      const key = o.sku || o.material || "SEM SKU";
      if (!unaddressedBySku[key])
        unaddressedBySku[key] = {
          sku: key,
          description: o.description || "",
          qty: 0,
          rows: 0,
        };
      unaddressedBySku[key].qty += o.items || 0;
      unaddressedBySku[key].rows++;
    });
    const topUnaddressedSkus = Object.values(unaddressedBySku)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);
    const unaddressedByBatch = pdfBatchEvents
      .map((ev) => {
        const rows = ev.batch?.orders || [];
        const meta = getImportMeta(ev);
        const qty =
          meta?.unaddressedItems ||
          rows
            .filter((o) => o.addressed === false || !o.address)
            .reduce((s, o) => s + (o.items || 0), 0);
        const total = ev.batch?.totalItems || meta?.totalItems || 0;
        return {
          code: ev.batch?.batchCode || meta?.batchCode || "---",
          qty,
          total,
          pct: pct(qty, total),
        };
      })
      .filter((b) => b.qty > 0)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 5);

    const productivityTypes = [
      {
        label: "Lote PDF",
        events: events.filter(
          (ev) => ev.batch && getImportMeta(ev)?.sourceType === "pdf",
        ),
      },
      {
        label: "Lote manual",
        events: events.filter(
          (ev) => ev.batch && getImportMeta(ev)?.sourceType !== "pdf",
        ),
      },
      {
        label: "Pedido PDF",
        events: events.filter(
          (ev) =>
            ev.type === "SINGLE_ORDER" &&
            getImportMeta(ev)?.sourceType === "pdf",
        ),
      },
      {
        label: "Pedido manual",
        events: events.filter(
          (ev) =>
            ev.type === "SINGLE_ORDER" &&
            getImportMeta(ev)?.sourceType !== "pdf",
        ),
      },
    ].map((group) => {
      const stats = group.events.reduce(
        (acc, ev) => {
          const seconds = ev.batch
            ? (ev.batch.separationSeconds || 0) + (ev.batch.bippingSeconds || 0)
            : (ev.singleOrder?.separationSeconds || 0) +
              (ev.singleOrder?.bippingSeconds || 0);
          const items = ev.batch?.totalItems || ev.singleOrder?.items || 0;
          const orders =
            ev.batch?.totalOrders || (ev.type === "SINGLE_ORDER" ? 1 : 0);
          const boxes = ev.batch?.boxCodes
            ? Object.keys(ev.batch.boxCodes).length
            : ev.singleOrder?.boxCode
              ? 1
              : 0;
          acc.events++;
          acc.seconds += seconds;
          acc.items += items;
          acc.orders += orders;
          acc.boxes += boxes;
          return acc;
        },
        {
          label: group.label,
          events: 0,
          seconds: 0,
          items: 0,
          orders: 0,
          boxes: 0,
        },
      );
      stats.itemsPerMin =
        stats.seconds > 0 ? stats.items / (stats.seconds / 60) : 0;
      stats.ordersPerMin =
        stats.seconds > 0 ? stats.orders / (stats.seconds / 60) : 0;
      stats.boxesPerMin =
        stats.seconds > 0 ? stats.boxes / (stats.seconds / 60) : 0;
      return stats;
    });

    const agingRows = pdfEvents
      .map((ev) => {
        const meta = getImportMeta(ev);
        const ref = pdfReferenceDate(meta);
        const created = toDate(ev.createdAt);
        if (
          !ref ||
          Number.isNaN(ref.getTime()) ||
          !created ||
          Number.isNaN(created.getTime())
        )
          return null;
        return {
          ref:
            ev.batch?.batchCode ||
            ev.singleOrder?.orderCode ||
            meta?.batchCode ||
            meta?.orderCode ||
            "---",
          type: ev.singleOrder ? "Pedido" : "Lote",
          hours: Math.max(0, (created - ref) / 36e5),
          items:
            ev.batch?.totalItems ||
            ev.singleOrder?.items ||
            meta?.totalItems ||
            0,
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.hours - a.hours);
    const avgAgingHours = avg(agingRows.map((r) => r.hours));
    const delayedOver24h = agingRows.filter((r) => r.hours >= 24).length;

    // ── Per-unit PDF quality & aging (admin only) ─────────────────────
    const unitPdfQuality =
      isAdmin && units.length > 1
        ? units
            .map((u) => {
              const uEvs = pdfEvents.filter((ev) => ev.unitId === u.id);
              const uTotal = uEvs.reduce((s, ev) => {
                const meta = getImportMeta(ev);
                if (ev.batch?.totalItems) return s + ev.batch.totalItems;
                if (ev.singleOrder?.items) return s + ev.singleOrder.items;
                return s + (meta?.totalItems || meta?.declaredItems || 0);
              }, 0);
              const uUnaddr = uEvs.reduce(
                (s, ev) => s + (getImportMeta(ev)?.unaddressedItems || 0),
                0,
              );
              return {
                name: u.name,
                total: uTotal,
                unaddr: uUnaddr,
                pct: pct(uUnaddr, uTotal),
              };
            })
            .filter((u) => u.total > 0)
            .sort((a, b) => parseFloat(b.pct) - parseFloat(a.pct))
        : null;

    const unitAgingStats =
      isAdmin && units.length > 1
        ? units
            .map((u) => {
              const uRows = pdfEvents
                .filter((ev) => ev.unitId === u.id)
                .map((ev) => {
                  const meta = getImportMeta(ev);
                  const ref = pdfReferenceDate(meta);
                  const created = toDate(ev.createdAt);
                  if (
                    !ref ||
                    Number.isNaN(ref.getTime()) ||
                    !created ||
                    Number.isNaN(created.getTime())
                  )
                    return null;
                  return { hours: Math.max(0, (created - ref) / 36e5) };
                })
                .filter(Boolean);
              return {
                name: u.name,
                count: uRows.length,
                avgH: avg(uRows.map((r) => r.hours)),
                over24h: uRows.filter((r) => r.hours >= 24).length,
              };
            })
            .filter((u) => u.count > 0)
            .sort((a, b) => b.avgH - a.avgH)
        : null;

    // ── City order map ──────────────────────────────────────────
    const cityOrderMap = {};
    Object.values(VD_CITIES_MAP)
      .flat()
      .forEach((c) => {
        cityOrderMap[c] = 0;
      });
    events.forEach((ev) => {
      const city = ev.batch?.city;
      const vd = ev.batch?.vd;
      const orders = ev.batch?.totalOrders || 0;
      if (!city || !orders) return;
      if (city !== "Várias cidades") {
        if (cityOrderMap[city] !== undefined) cityOrderMap[city] += orders;
      } else if (vd && VD_CITIES_MAP[vd]) {
        const share = orders / VD_CITIES_MAP[vd].length;
        VD_CITIES_MAP[vd].forEach((c) => {
          cityOrderMap[c] = (cityOrderMap[c] || 0) + share;
        });
      }
    });
    const hasCityData = Object.values(cityOrderMap).some((v) => v > 0);

    // ── Render ────────────────────────────────────────────────────────
    page.innerHTML = `
      <!-- KPI Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:0.6rem;margin-bottom:1.5rem;">
        ${kpi("⚡ XP TOTAL", fmtN(totalXP), C.green)}
        ${kpi("📦 LOTES", fmtN(totalBatches), C.purple)}
        ${kpi("📋 PEDIDOS", fmtN(totalOrders), C.blue)}
        ${kpi("🔢 ITENS BIPADOS", fmtN(totalItems), C.green)}
        ${kpi("👥 OPERADORES", fmtN(activeStockists), C.purple)}
        ${kpi("✅ TAREFAS", fmtN(totalTaskQty) + " un.", C.blue)}
        ${kpi("🚀 VEL. MÉDIA", avgSpeed ? avgSpeed + " it/min" : "—", C.green)}
        ${kpi("⏱ TEMPO MÉDIO/LOTE", fmtTime(avgBatchTime), C.purple)}
      </div>

      <!-- Mapa de calor de cidades -->
      <div class="card cyber-chamfer mb-2">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;margin-bottom:0.5rem;">
          <div class="section-title">🗺 MAPA DE CALOR — CIDADES ATENDIDAS</div>
          <div style="display:flex;gap:1rem;font-size:0.62rem;font-family:var(--font-terminal);color:var(--muted-fg);">
            <span style="color:#6d28d9;">● Sem pedidos</span>
            <span style="color:#059669;">● Poucos</span>
            <span style="color:#f59e0b;">● Médio</span>
            <span style="color:#dc2626;">● Alto</span>
          </div>
        </div>
        <div class="text-muted text-xs mb-2">Clique em um círculo para ver a cidade e a quantidade de pedidos separados</div>
        <div id="city-heatmap" style="height:420px;border-radius:4px;overflow:hidden;"></div>
        ${!hasCityData ? '<div class="text-muted text-xs mt-2 text-center">Nenhum lote com cidade registrada no período. A seleção de cidade é feita no momento da separação.</div>' : ""}
      </div>

      <div class="grid-2 mb-2">
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">QUALIDADE DE ENDERECAMENTO PDF</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin-bottom:0.75rem;">
            ${miniMetric("ITENS PDF", fmtN(totalPdfItems))}
            ${miniMetric("SEM ENDERECO", fmtN(unaddressedItems))}
            ${miniMetric("% SEM END.", pct(unaddressedItems, totalPdfItems) + "%")}
          </div>
          <div class="section-title mb-1" style="font-size:0.6rem;">TOP MATERIAIS SEM ENDERECO</div>
          ${
            topUnaddressedSkus.length
              ? topUnaddressedSkus
                  .map((x) =>
                    row(
                      `${x.sku}${x.description ? " - " + x.description.slice(0, 32) : ""}`,
                      `${fmtN(x.qty)} it.`,
                    ),
                  )
                  .join("")
              : '<div class="text-muted text-xs">Sem materiais sem endereco nos PDFs do periodo.</div>'
          }
          <div class="section-title mb-1 mt-2" style="font-size:0.6rem;">LOTES COM MAIOR FALHA</div>
          ${
            unaddressedByBatch.length
              ? unaddressedByBatch
                  .map((x) =>
                    row(
                      `Lote ${x.code}`,
                      `${fmtN(x.qty)}/${fmtN(x.total)} (${x.pct}%)`,
                    ),
                  )
                  .join("")
              : '<div class="text-muted text-xs">Nenhum lote PDF com falha de endereco.</div>'
          }
          ${
            unitPdfQuality && unitPdfQuality.length > 0
              ? `
          <div class="section-title mb-1 mt-2" style="font-size:0.6rem;color:var(--accent);">COMPARATIVO ENTRE UNIDADES</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.65rem;font-family:var(--font-terminal);">
              <thead>
                <tr style="border-bottom:1px solid var(--border);color:var(--muted-fg);text-align:right;">
                  <th style="text-align:left;padding:0.3rem 0.4rem;">UNIDADE</th>
                  <th style="padding:0.3rem 0.4rem;">ITENS PDF</th>
                  <th style="padding:0.3rem 0.4rem;">SEM END.</th>
                  <th style="padding:0.3rem 0.4rem;">% FALHA</th>
                </tr>
              </thead>
              <tbody>
                ${unitPdfQuality
                  .map(
                    (u) => `
                  <tr style="border-bottom:1px solid var(--border);text-align:right;">
                    <td style="text-align:left;padding:0.3rem 0.4rem;color:var(--fg);">${u.name}</td>
                    <td style="padding:0.3rem 0.4rem;">${fmtN(u.total)}</td>
                    <td style="padding:0.3rem 0.4rem;">${fmtN(u.unaddr)}</td>
                    <td style="padding:0.3rem 0.4rem;color:${parseFloat(u.pct) > 10 ? "var(--destructive)" : parseFloat(u.pct) > 0 ? "var(--amber,#f59e0b)" : "var(--accent)"};"><strong>${u.pct}%</strong></td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`
              : ""
          }
        </div>

        <div class="card cyber-chamfer">
          <div class="section-title mb-2">PRODUTIVIDADE POR TIPO</div>
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.68rem;font-family:var(--font-terminal);">
              <thead>
                <tr style="border-bottom:1px solid var(--border);color:var(--muted-fg);text-align:right;">
                  <th style="text-align:left;padding:0.4rem;">TIPO</th>
                  <th style="padding:0.4rem;">EVENTOS</th>
                  <th style="padding:0.4rem;">IT/MIN</th>
                  <th style="padding:0.4rem;">PED/MIN</th>
                  <th style="padding:0.4rem;">CAIX/MIN</th>
                </tr>
              </thead>
              <tbody>
                ${productivityTypes
                  .map(
                    (x) => `
                  <tr style="border-bottom:1px solid var(--border);text-align:right;">
                    <td style="text-align:left;padding:0.4rem;color:var(--fg);">${x.label}</td>
                    <td style="padding:0.4rem;">${fmtN(x.events)}</td>
                    <td style="padding:0.4rem;color:var(--accent);">${x.itemsPerMin.toFixed(1)}</td>
                    <td style="padding:0.4rem;">${x.ordersPerMin.toFixed(2)}</td>
                    <td style="padding:0.4rem;">${x.boxesPerMin.toFixed(2)}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      ${
        isAdmin
          ? `
      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">AGING PDF - ATRASO DE PROCESSAMENTO</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:0.5rem;margin-bottom:0.75rem;">
          ${miniMetric("PDFS MEDIDOS", fmtN(agingRows.length))}
          ${miniMetric("MEDIA ATE PROCESSAR", formatHours(avgAgingHours))}
          ${miniMetric("ACIMA DE 24H", fmtN(delayedOver24h))}
        </div>
        ${
          agingRows.length
            ? agingRows
                .slice(0, 8)
                .map((x) =>
                  row(
                    `${x.type} ${x.ref}`,
                    `${formatHours(x.hours)} - ${fmtN(x.items)} it.`,
                  ),
                )
                .join("")
            : '<div class="text-muted text-xs">Sem PDFs com data de referencia no periodo.</div>'
        }
        ${
          unitAgingStats && unitAgingStats.length > 0
            ? `
        <div class="section-title mb-1 mt-2" style="font-size:0.6rem;color:var(--accent);">COMPARATIVO ENTRE UNIDADES</div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.65rem;font-family:var(--font-terminal);">
            <thead>
              <tr style="border-bottom:1px solid var(--border);color:var(--muted-fg);text-align:right;">
                <th style="text-align:left;padding:0.3rem 0.4rem;">UNIDADE</th>
                <th style="padding:0.3rem 0.4rem;">PDFs</th>
                <th style="padding:0.3rem 0.4rem;">MÉDIA</th>
                <th style="padding:0.3rem 0.4rem;">ACIMA 24H</th>
              </tr>
            </thead>
            <tbody>
              ${unitAgingStats
                .map(
                  (u) => `
                <tr style="border-bottom:1px solid var(--border);text-align:right;">
                  <td style="text-align:left;padding:0.3rem 0.4rem;color:var(--fg);">${u.name}</td>
                  <td style="padding:0.3rem 0.4rem;">${fmtN(u.count)}</td>
                  <td style="padding:0.3rem 0.4rem;color:${u.avgH >= 24 ? "var(--destructive)" : u.avgH >= 12 ? "var(--amber,#f59e0b)" : "var(--accent)"};"><strong>${formatHours(u.avgH)}</strong></td>
                  <td style="padding:0.3rem 0.4rem;color:${u.over24h > 0 ? "var(--destructive)" : "var(--accent)"};"><strong>${fmtN(u.over24h)}</strong></td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>`
            : ""
        }
      </div>
      `
          : ""
      }

      <!-- Charts row 1: XP por estoquista + Timeline -->
      <div class="grid-2 mb-2">
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">XP POR ESTOQUISTA${isAdmin && units.length > 1 ? ' <span style="font-size:0.6rem;color:var(--muted-fg);font-family:var(--font-terminal);">— GERAL</span>' : ""}</div>
          <canvas id="ch-stockist"></canvas>
        </div>
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">EVOLUÇÃO DO XP ACUMULADO</div>
          <canvas id="ch-timeline"></canvas>
        </div>
      </div>

      ${
        isAdmin && units.length > 1
          ? `
      <!-- XP por estoquista por unidade (admin) -->
      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">XP POR ESTOQUISTA — POR UNIDADE</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem;">
          ${units
            .map(
              (u, idx) => `
            <div>
              <div style="font-family:var(--font-terminal);font-size:0.65rem;color:${idx === 0 ? "var(--accent)" : "var(--accent-3,#0284c7)"};letter-spacing:0.2em;margin-bottom:0.5rem;padding-bottom:0.4rem;border-bottom:1px solid var(--border);">${u.name}</div>
              <canvas id="ch-stockist-unit-${idx}"></canvas>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
      `
          : ""
      }

      <!-- Charts row 2: Tipos + Horas -->
      <div class="grid-2 mb-2">
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">DISTRIBUIÇÃO DE OPERAÇÕES${isAdmin && units.length > 1 ? ' <span style="font-size:0.6rem;color:var(--muted-fg);font-family:var(--font-terminal);">— GERAL</span>' : ""}</div>
          <div style="max-width:280px;margin:0 auto;"><canvas id="ch-types"></canvas></div>
        </div>
        <div class="card cyber-chamfer">
          <div class="section-title mb-2">
            ATIVIDADE POR HORA${isAdmin && units.length > 1 ? ' <span style="font-size:0.6rem;color:var(--muted-fg);font-family:var(--font-terminal);">— GERAL</span>' : ""}
            ${byHour[peakHour] > 0 ? `<span style="color:var(--accent);font-size:0.65rem;"> · PICO: ${String(peakHour).padStart(2, "0")}h</span>` : ""}
          </div>
          <canvas id="ch-hours"></canvas>
        </div>
      </div>

      ${
        isAdmin && units.length > 1
          ? `
      <!-- Atividade por hora por unidade (admin) -->
      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">ATIVIDADE POR HORA — POR UNIDADE</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1.5rem;">
          ${units
            .map(
              (u, idx) => `
            <div>
              <div style="font-family:var(--font-terminal);font-size:0.65rem;color:${idx === 0 ? "var(--accent)" : "var(--accent-3,#0284c7)"};letter-spacing:0.2em;margin-bottom:0.5rem;padding-bottom:0.4rem;border-bottom:1px solid var(--border);">${u.name}</div>
              <canvas id="ch-hours-unit-${idx}"></canvas>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
      `
          : ""
      }

      ${
        isAdmin && units.length > 1
          ? `
      <!-- Distribuição de operações por unidade (admin) -->
      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">DISTRIBUIÇÃO DE OPERAÇÕES — POR UNIDADE</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1.5rem;">
          ${units
            .map(
              (u, idx) => `
            <div>
              <div style="font-family:var(--font-terminal);font-size:0.65rem;color:${idx === 0 ? "var(--accent)" : "var(--accent-3,#0284c7)"};letter-spacing:0.2em;margin-bottom:0.5rem;padding-bottom:0.4rem;border-bottom:1px solid var(--border);">${u.name}</div>
              <div style="max-width:220px;margin:0 auto;"><canvas id="ch-types-unit-${idx}"></canvas></div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
      `
          : ""
      }

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

      ${
        unitStats
          ? `
      <!-- Unit comparison -->
      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">COMPARATIVO DE UNIDADES</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:1rem;margin-bottom:1rem;">
          ${unitStats
            .map(
              (u, i) => `
            <div style="border:1px solid var(--border);padding:1rem;position:relative;">
              <div style="font-family:var(--font-display);font-size:0.8rem;color:${i === 0 ? C.green : C.blue};letter-spacing:0.2em;margin-bottom:0.75rem;text-shadow:${i === 0 ? "var(--neon)" : "var(--neon-3)"};">${u.name}</div>
              ${row("⚡ XP", fmtN(u.xp))}
              ${row("📦 Lotes", fmtN(u.batches))}
              ${row("📋 Pedidos", fmtN(u.orders))}
              ${row("🔢 Itens Bipados", fmtN(u.items))}
              ${row("👥 Operadores", u.stockists)}
            </div>`,
            )
            .join("")}
        </div>
        <canvas id="ch-units" height="80"></canvas>
      </div>
      `
          : ""
      }

      <!-- Top performers -->
      ${
        ranking.length >= 2
          ? `
      <div class="card cyber-chamfer mb-2">
        <div class="section-title mb-2">🏅 DESTAQUES DO PERÍODO</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.75rem;">
          ${badge("🏆 MAIOR XP", stockistNames, ranking[0].stockistId, fmtN(ranking[0].xp) + " XP")}
          ${fastest ? badge("🚀 MAIS VELOZ", stockistNames, fastest.stockistId, (fastest.items / (fastest.totalSecs / 60)).toFixed(1) + " it/min") : ""}
          ${mostBatches ? badge("📦 MAIS LOTES", stockistNames, mostBatches.stockistId, fmtN(mostBatches.batches) + " lotes") : ""}
          ${mostItems ? badge("🔢 MAIS ITENS", stockistNames, mostItems.stockistId, fmtN(mostItems.items) + " itens") : ""}
          ${mostOrders ? badge("📋 MAIS PEDIDOS", stockistNames, mostOrders.stockistId, fmtN(mostOrders.orders) + " pedidos") : ""}
        </div>
      </div>
      `
          : ""
      }

      <!-- Detailed table -->
      <div class="card cyber-chamfer mb-3">
        <div class="section-title mb-2">DESEMPENHO DETALHADO</div>
        ${
          ranking.length === 0
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
                    ${isAdmin ? '<th style="padding:0.5rem 0.4rem;">UNIDADE</th>' : ""}
                  </tr>
                </thead>
                <tbody>
                  ${ranking
                    .map((r, i) => {
                      const name = stockistNames[r.stockistId] || r.stockistId;
                      const photo = stockistPhoto(name);
                      const speed =
                        r.totalSecs > 0 && r.items > 0
                          ? (r.items / (r.totalSecs / 60)).toFixed(1) + " it/m"
                          : "—";
                      const tqty = events
                        .filter(
                          (e) =>
                            e.stockistId === r.stockistId && e.type === "TASK",
                        )
                        .reduce((s, e) => s + (e.task?.quantity || 0), 0);
                      const unitName = isAdmin
                        ? units.find((u) =>
                            u.stockists?.some((s) => s.id === r.stockistId),
                          )?.name || "—"
                        : "";
                      const medal = ["🥇", "🥈", "🥉"][i] || `${i + 1}º`;
                      const hi =
                        i === 0 ? "background:rgba(255,221,0,0.05);" : "";
                      return `<tr style="border-bottom:1px solid var(--border);${hi}">
                      <td style="padding:0.45rem 0.4rem;font-family:var(--font-display);font-weight:900;">${medal}</td>
                      <td style="padding:0.45rem 0.4rem;">
                        <div style="display:flex;align-items:center;gap:0.4rem;">
                          ${photo ? `<img src="${photo}" style="width:26px;height:26px;border-radius:50%;object-fit:cover;border:1px solid var(--border);flex-shrink:0;" onerror="this.style.display='none'">` : ""}
                          <span style="${i === 0 ? "color:var(--accent);font-weight:700;" : ""}">${name}</span>
                        </div>
                      </td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;font-family:var(--font-display);font-weight:800;color:${i === 0 ? "#b45309" : "var(--accent)"};">${fmtN(r.xp)}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${r.batches}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${fmtN(r.orders)}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${fmtN(r.items)}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;color:var(--accent-3);">${speed}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${fmtTime(r.avgSecs)}</td>
                      <td style="padding:0.45rem 0.4rem;text-align:right;">${tqty || "—"}</td>
                      ${isAdmin ? `<td style="padding:0.45rem 0.4rem;text-align:right;color:var(--muted-fg);font-size:0.65rem;">${unitName}</td>` : ""}
                    </tr>`;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>`
        }
      </div>
    `;

    // ── City heat map (Leaflet choropleth) ──────────────────────────────────────
    if (_leafletMap) {
      _leafletMap.remove();
      _leafletMap = null;
    }
    const mapEl = document.getElementById("city-heatmap");
    if (mapEl && typeof L !== "undefined") {
      _leafletMap = L.map(mapEl, {
        zoomControl: true,
        attributionControl: false,
        scrollWheelZoom: true,
      }).setView([-9.6, -36.7], 8);

      L.tileLayer(
        "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png",
        {
          subdomains: "abcd",
          maxZoom: 19,
        },
      ).addTo(_leafletMap);
      L.control.attribution({ prefix: "© CartoDB · IBGE" }).addTo(_leafletMap);

      const maxVal = Math.max(
        ...Object.values(cityOrderMap).filter((v) => v > 0),
        1,
      );

      // Nomes alternativos para correspondência com o GeoJSON do IBGE
      const NAME_ALIASES = {
        minador: "minador do negrao",
        "olho dagua": "olho dagua das flores",
        "olho d agua": "olho dagua das flores",
      };

      function normName(s) {
        return (s || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[''`´]/g, "")
          .replace(/[^a-z0-9 ]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      }

      // Monta lookup: nome normalizado → { original, count, vd }
      const cityLookup = {};
      Object.entries(cityOrderMap).forEach(([city, count]) => {
        const n = normName(city);
        const vd =
          Object.entries(VD_CITIES_MAP).find(([, cs]) =>
            cs.includes(city),
          )?.[0] || "";
        const entry = { original: city, count, vd };
        cityLookup[n] = entry;
        if (NAME_ALIASES[n]) cityLookup[NAME_ALIASES[n]] = entry;
      });

      function getHeatColor(intensity) {
        if (intensity <= 0) return "#6d28d9";
        if (intensity <= 0.25) return "#1d4ed8";
        if (intensity <= 0.5) return "#059669";
        if (intensity <= 0.75) return "#f59e0b";
        return "#dc2626";
      }

      // Adiciona GeoJSON assim que carregar (assíncrono para não bloquear a UI)
      (async () => {
        try {
          if (!_geoJsonCache) {
            // Busca em paralelo: polígonos dos municípios + nomes pelo IBGE
            const [geoRes, nomesRes] = await Promise.all([
              fetch(
                "https://servicodados.ibge.gov.br/api/v3/malhas/estados/27?resolucao=5&intrarregiao=municipio&formato=application/vnd.geo%2Bjson",
              ),
              fetch(
                "https://servicodados.ibge.gov.br/api/v1/localidades/estados/27/municipios",
              ),
            ]);
            const [geoData, municipios] = await Promise.all([
              geoRes.json(),
              nomesRes.json(),
            ]);

            // Enriquece cada feature com o nome do município
            const codeToName = {};
            municipios.forEach((m) => {
              codeToName[String(m.id)] = m.nome;
            });
            geoData.features.forEach((f) => {
              const code = String(f.properties?.codarea || "");
              if (codeToName[code]) f.properties.NM_MUN = codeToName[code];
            });

            _geoJsonCache = geoData;
          }

          if (!_leafletMap) return; // mapa já foi destruído enquanto carregava

          const geoLayer = L.geoJSON(_geoJsonCache, {
            style: (feature) => {
              const nm = normName(
                feature.properties?.NM_MUN || feature.properties?.name || "",
              );
              const found = cityLookup[nm];
              if (!found)
                return {
                  fillColor: "#111827",
                  fillOpacity: 0.55,
                  color: "rgba(255,255,255,0.06)",
                  weight: 0.5,
                };
              const intensity = found.count > 0 ? found.count / maxVal : 0;
              return {
                fillColor: getHeatColor(intensity),
                fillOpacity: intensity > 0 ? 0.55 + intensity * 0.35 : 0.35,
                color: "rgba(255,255,255,0.35)",
                weight: 1.2,
              };
            },
            onEachFeature: (feature, layer) => {
              const nm = normName(
                feature.properties?.NM_MUN || feature.properties?.name || "",
              );
              const found = cityLookup[nm];
              if (!found) return;

              const count = Math.round(found.count);
              const vdLabel = found.vd
                ? `<span style="opacity:0.6;font-size:10px;">${found.vd}</span>`
                : "";

              layer.bindTooltip(
                `<div style="font-family:monospace;padding:2px 4px;">
                  <strong style="font-size:12px;">${found.original}</strong><br>
                  ${
                    count > 0
                      ? `<span style="color:#${count / maxVal > 0.5 ? "dc2626" : count / maxVal > 0.25 ? "f59e0b" : "059669"};">${count} pedido${count !== 1 ? "s" : ""}</span>`
                      : '<span style="opacity:0.5;">Sem pedidos</span>'
                  }
                  ${vdLabel ? "<br>" + vdLabel : ""}
                </div>`,
                { sticky: true, direction: "top", offset: [0, -4] },
              );

              const baseStyle = (() => {
                const intensity = found.count > 0 ? found.count / maxVal : 0;
                return {
                  fillColor: getHeatColor(intensity),
                  fillOpacity: intensity > 0 ? 0.55 + intensity * 0.35 : 0.35,
                  color: "rgba(255,255,255,0.35)",
                  weight: 1.2,
                };
              })();

              layer.on("mouseover", () => {
                layer.setStyle({
                  ...baseStyle,
                  weight: 2.5,
                  fillOpacity: Math.min(0.95, baseStyle.fillOpacity + 0.2),
                });
                layer.bringToFront();
              });
              layer.on("mouseout", () => layer.setStyle(baseStyle));
              layer.on("click", () => {
                _leafletMap.fitBounds(layer.getBounds(), {
                  padding: [40, 40],
                  maxZoom: 11,
                });
              });
            },
          }).addTo(_leafletMap);

          // Auto-zoom para o bounding box das cidades atendidas
          const serviceCities = Object.values(cityOrderMap);
          if (serviceCities.some((v) => v > 0)) {
            const bounds = geoLayer.getBounds();
            if (bounds.isValid())
              _leafletMap.fitBounds(bounds, { padding: [20, 20] });
          }
        } catch (err) {
          console.error("[Mapa] Erro ao carregar GeoJSON do IBGE:", err);
          // Fallback: marcadores circulares se o GeoJSON falhar
          Object.entries(cityOrderMap).forEach(([city, orders]) => {
            const coords = CITY_COORDS[city];
            if (!coords) return;
            const intensity = orders > 0 ? orders / maxVal : 0;
            L.circleMarker(coords, {
              radius: intensity > 0 ? Math.round(8 + intensity * 20) : 5,
              fillColor: getHeatColor(intensity),
              color: "rgba(255,255,255,0.4)",
              weight: 1.5,
              fillOpacity: intensity > 0 ? 0.7 : 0.2,
            })
              .addTo(_leafletMap)
              .bindTooltip(
                `<strong>${city}</strong><br>${Math.round(orders)} pedidos`,
                { sticky: true },
              );
          });
        }
      })();
    }

    // ── Build charts ──────────────────────────────────────────────────────────
    const opts = (extra = {}) => ({
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: {
          grid: { color: C.gridLine },
          ticks: { color: C.tickColor, font: { size: 10 } },
        },
        y: {
          grid: { color: C.gridLine },
          ticks: { color: C.tickColor, font: { size: 10 } },
        },
      },
      ...extra,
    });

    // XP por estoquista (horizontal bar)
    new Chart(document.getElementById("ch-stockist"), {
      type: "bar",
      data: {
        labels: ranking
          .slice(0, 10)
          .map(
            (r) => (stockistNames[r.stockistId] || r.stockistId).split(" ")[0],
          ),
        datasets: [
          {
            data: ranking.slice(0, 10).map((r) => r.xp),
            backgroundColor: ranking
              .slice(0, 10)
              .map((_, i) =>
                i === 0
                  ? C.gold
                  : i === 1
                    ? C.silver
                    : i === 2
                      ? C.bronze
                      : C.green,
              ),
            borderRadius: 3,
          },
        ],
      },
      options: { ...opts(), indexAxis: "y" },
    });

    // XP por estoquista por unidade (admin)
    if (isAdmin && units.length > 1) {
      units.forEach((u, idx) => {
        const el = document.getElementById(`ch-stockist-unit-${idx}`);
        if (!el) return;
        const unitStockistIds = new Set((u.stockists || []).map((s) => s.id));
        const unitRanking = ranking
          .filter((r) => unitStockistIds.has(r.stockistId))
          .slice(0, 10);
        if (unitRanking.length === 0) {
          el.closest("div").insertAdjacentHTML(
            "beforeend",
            '<div class="text-muted text-xs mt-1">Sem dados no período.</div>',
          );
          return;
        }
        const colors = [C.gold, C.silver, C.bronze];
        new Chart(el, {
          type: "bar",
          data: {
            labels: unitRanking.map(
              (r) =>
                (stockistNames[r.stockistId] || r.stockistId).split(" ")[0],
            ),
            datasets: [
              {
                data: unitRanking.map((r) => r.xp),
                backgroundColor: unitRanking.map(
                  (_, i) => colors[i] || (idx === 0 ? C.green : C.blue),
                ),
                borderRadius: 3,
              },
            ],
          },
          options: { ...opts(), indexAxis: "y" },
        });
      });
    }

    // XP acumulado linha
    new Chart(document.getElementById("ch-timeline"), {
      type: "line",
      data: {
        labels: dayKeys,
        datasets: [
          {
            label: "Diário",
            data: dayVals,
            borderColor: C.purple,
            backgroundColor: "rgba(124,58,237,0.06)",
            tension: 0.4,
            fill: true,
            pointRadius: 2,
            borderWidth: 1.5,
            yAxisID: "y",
          },
          {
            label: "Acumulado",
            data: dayAcc,
            borderColor: C.green,
            backgroundColor: "rgba(5,150,105,0.06)",
            tension: 0.4,
            fill: true,
            pointRadius: 2,
            borderWidth: 2,
            yAxisID: "y2",
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true,
            position: "bottom",
            labels: { color: C.tickColor, font: { size: 10 }, boxWidth: 10 },
          },
        },
        scales: {
          x: {
            grid: { color: C.gridLine },
            ticks: { color: C.tickColor, font: { size: 9 }, maxRotation: 45 },
          },
          y: {
            grid: { color: C.gridLine },
            ticks: { color: C.tickColor, font: { size: 9 } },
            position: "left",
          },
          y2: {
            grid: { display: false },
            ticks: { color: C.green, font: { size: 9 } },
            position: "right",
          },
        },
      },
    });

    // Tipos donut
    const typeKeys = Object.keys(byType);
    new Chart(document.getElementById("ch-types"), {
      type: "doughnut",
      data: {
        labels: typeKeys.map((k) => typeLabels[k] || k),
        datasets: [
          {
            data: typeKeys.map((k) => byType[k]),
            backgroundColor: [C.green, C.purple, C.blue, C.amber, C.red].slice(
              0,
              typeKeys.length,
            ),
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: C.tickColor, font: { size: 10 }, padding: 8 },
          },
        },
      },
    });

    // Distribuição de operações por unidade (admin)
    if (isAdmin && units.length > 1) {
      units.forEach((u, idx) => {
        const el = document.getElementById(`ch-types-unit-${idx}`);
        if (!el) return;
        const uEvents = events.filter((ev) => ev.unitId === u.id);
        const uByType = {};
        uEvents.forEach((e) => {
          uByType[e.type] = (uByType[e.type] || 0) + 1;
        });
        const uTypeKeys = Object.keys(uByType);
        if (uTypeKeys.length === 0) {
          el.closest("div").insertAdjacentHTML(
            "beforeend",
            '<div class="text-muted text-xs mt-1">Sem dados no período.</div>',
          );
          return;
        }
        new Chart(el, {
          type: "doughnut",
          data: {
            labels: uTypeKeys.map((k) => typeLabels[k] || k),
            datasets: [
              {
                data: uTypeKeys.map((k) => uByType[k]),
                backgroundColor: [
                  C.green,
                  C.purple,
                  C.blue,
                  C.amber,
                  C.red,
                ].slice(0, uTypeKeys.length),
                borderWidth: 0,
              },
            ],
          },
          options: {
            responsive: true,
            plugins: {
              legend: {
                position: "bottom",
                labels: { color: C.tickColor, font: { size: 10 }, padding: 8 },
              },
            },
          },
        });
      });
    }

    // Atividade por hora
    const maxH = Math.max(...byHour);
    new Chart(document.getElementById("ch-hours"), {
      type: "bar",
      data: {
        labels: Array.from(
          { length: 24 },
          (_, i) => String(i).padStart(2, "0") + "h",
        ),
        datasets: [
          {
            data: byHour,
            backgroundColor: byHour.map((v) =>
              v === maxH && maxH > 0 ? C.green : "rgba(5,150,105,0.25)",
            ),
            borderRadius: 2,
          },
        ],
      },
      options: { ...opts(), plugins: { legend: { display: false } } },
    });

    // Atividade por hora por unidade (admin)
    if (isAdmin && units.length > 1) {
      units.forEach((u, idx) => {
        const el = document.getElementById(`ch-hours-unit-${idx}`);
        if (!el) return;
        const uByHour = Array(24).fill(0);
        events
          .filter((ev) => ev.unitId === u.id)
          .forEach((e) => {
            uByHour[toDate(e.createdAt).getHours()]++;
          });
        const uMax = Math.max(...uByHour);
        const uPeak = uByHour.indexOf(uMax);
        if (uMax === 0) {
          el.closest("div").insertAdjacentHTML(
            "beforeend",
            '<div class="text-muted text-xs mt-1">Sem dados no período.</div>',
          );
          return;
        }
        // adiciona pico no titulo
        const titleEl = el.closest("div").querySelector("div[style]");
        if (titleEl)
          titleEl.innerHTML += ` <span style="color:var(--accent);font-size:0.6rem;"> · PICO: ${String(uPeak).padStart(2, "0")}h</span>`;
        new Chart(el, {
          type: "bar",
          data: {
            labels: Array.from(
              { length: 24 },
              (_, i) => String(i).padStart(2, "0") + "h",
            ),
            datasets: [
              {
                data: uByHour,
                backgroundColor: uByHour.map((v) =>
                  v === uMax && uMax > 0 ? C.green : "rgba(5,150,105,0.25)",
                ),
                borderRadius: 2,
              },
            ],
          },
          options: { ...opts(), plugins: { legend: { display: false } } },
        });
      });
    }

    // Distribuição de velocidade
    new Chart(document.getElementById("ch-speed"), {
      type: "bar",
      data: {
        labels: speedBuckets.map((b) => b + " it/m"),
        datasets: [
          {
            data: speedCounts,
            backgroundColor: [C.red, C.amber, C.green, C.blue, C.purple],
            borderRadius: 4,
          },
        ],
      },
      options: { ...opts(), plugins: { legend: { display: false } } },
    });

    // XP diário bar
    new Chart(document.getElementById("ch-daily"), {
      type: "bar",
      data: {
        labels: dayKeys,
        datasets: [
          {
            data: dayVals,
            backgroundColor: dayVals.map((v) =>
              v === Math.max(...dayVals) ? C.gold : "rgba(5,150,105,0.35)",
            ),
            borderRadius: 3,
          },
        ],
      },
      options: {
        ...opts(),
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: C.tickColor, font: { size: 9 }, maxRotation: 45 },
          },
          y: {
            grid: { color: C.gridLine },
            ticks: { color: C.tickColor, font: { size: 9 } },
          },
        },
      },
    });

    // Comparativo de unidades (admin)
    if (unitStats && document.getElementById("ch-units")) {
      new Chart(document.getElementById("ch-units"), {
        type: "bar",
        data: {
          labels: ["XP (÷10)", "Lotes", "Pedidos", "Itens (÷10)"],
          datasets: unitStats.map((u, i) => ({
            label: u.name,
            data: [
              Math.round(u.xp / 10),
              u.batches,
              u.orders,
              Math.round(u.items / 10),
            ],
            backgroundColor: i === 0 ? C.green : C.blue,
            borderRadius: 3,
          })),
        },
        options: {
          responsive: true,
          plugins: {
            legend: {
              display: true,
              position: "bottom",
              labels: { color: C.tickColor, font: { size: 10 }, boxWidth: 10 },
            },
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: C.tickColor, font: { size: 10 } },
            },
            y: {
              grid: { color: C.gridLine },
              ticks: { color: C.tickColor, font: { size: 10 } },
            },
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

function miniMetric(label, value) {
  return `<div style="border:1px solid var(--border);padding:0.55rem;text-align:center;">
    <div style="font-family:var(--font-terminal);font-size:0.52rem;color:var(--muted-fg);letter-spacing:0.1em;margin-bottom:0.25rem;">${label}</div>
    <div style="font-family:var(--font-display);font-size:1rem;color:var(--accent);text-shadow:var(--neon);">${value}</div>
  </div>`;
}

function badge(titulo, stockistNames, sid, valor) {
  const name = stockistNames[sid] || sid;
  const photo = stockistPhoto(name);
  return `<div style="border:1px solid var(--border);padding:0.75rem;text-align:center;display:flex;flex-direction:column;align-items:center;gap:0.35rem;">
    <div style="font-family:var(--font-terminal);font-size:0.58rem;color:var(--muted-fg);letter-spacing:0.12em;">${titulo}</div>
    ${photo ? `<img src="${photo}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:2px solid var(--accent);" onerror="this.style.display='none'">` : ""}
    <div style="font-family:var(--font-display);font-weight:700;font-size:0.8rem;color:var(--fg);">${name.split(" ")[0]}</div>
    <div style="font-family:var(--font-display);font-size:0.75rem;color:var(--accent);text-shadow:var(--neon);">${valor}</div>
  </div>`;
}
