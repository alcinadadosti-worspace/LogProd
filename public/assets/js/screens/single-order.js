import { getCurrentUser, getSessionContext } from "../auth.js";
import { navigate } from "../router.js";
import { selectOperator } from "./operator-select.js";
import { parseSpreadsheet } from "../services/spreadsheet-parser.js";
import {
  createEvent,
  saveEventLocally,
  getGlobalConfig,
} from "../services/firestore.js";
import { xpBatch } from "../services/xp-engine.js";
import { Chronometer } from "../components/chronometer.js";
import {
  playStart,
  playConfirm,
  playComplete,
  playXP,
} from "../services/sound-engine.js";

export async function renderSingleOrder(container, params) {
  if (!getCurrentUser()) {
    navigate("/login");
    return;
  }
  const ctx = getSessionContext();
  if (!ctx) {
    navigate("/pin");
    return;
  }
  const unitId = params.unit || ctx.unitId;

  container.innerHTML = `
    <div class="topbar">
      <button class="btn btn--ghost btn--sm" id="back-btn">← VOLTAR</button>
      <div class="topbar-logo" style="font-size:0.8rem;">PEDIDO AVULSO</div>
      <div></div>
    </div>
    <div class="page screen-enter" id="so-page"></div>
  `;
  container
    .querySelector("#back-btn")
    .addEventListener("click", () => navigate("/dashboard"));

  const page = container.querySelector("#so-page");
  const state = {
    operator: null,
    order: null,
    sepSeconds: 0,
    bipSeconds: 0,
    boxCode: "",
    config: null,
  };

  state.config = await getGlobalConfig();
  state.operator = await selectOperator(unitId);
  if (!state.operator) {
    navigate("/dashboard");
    return;
  }

  showInput(page, state, unitId);
}

function showInput(page, state, unitId) {
  page.innerHTML = `
    <div class="card cyber-chamfer" style="max-width:560px;">
      <div class="section-title mb-2">DADOS DO PEDIDO AVULSO</div>
      <div class="text-muted text-xs mb-3">OPERADOR: <span class="text-accent">${state.operator.name}</span></div>

      <div style="margin-bottom:1rem;">
        <p class="text-muted text-xs mb-1" style="letter-spacing:0.1em;">OPÇÃO 1 — IMPORTAR PLANILHA OU PDF</p>
        <div class="file-upload-area cyber-chamfer" id="drop-area">
          <input type="file" id="file-input" accept=".xlsx,.xls,.csv,.pdf,application/pdf">
          <div class="file-upload-icon">📂</div>
          <div class="file-upload-text">Arraste ou selecione planilha ou PDF</div>
        </div>
        <div id="file-status" class="text-xs text-muted mt-1"></div>
        <div id="file-err" class="input-error-msg"></div>
      </div>

      <div style="text-align:center;color:var(--muted-fg);font-size:0.7rem;margin:1rem 0;letter-spacing:0.2em;">— OU —</div>

      <p class="text-muted text-xs mb-2" style="letter-spacing:0.1em;">OPÇÃO 2 — INSERIR MANUALMENTE</p>

      <div class="input-group mb-2">
        <label class="input-label">NÚMERO DO PEDIDO (9 DÍGITOS)</label>
        <div class="input-wrapper">
          <span class="input-prefix">&gt;</span>
          <input id="order-code" class="input" type="text" maxlength="9" placeholder="123456789" inputmode="numeric">
        </div>
        <div class="input-error-msg" id="code-err"></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
        <div class="input-group">
          <label class="input-label">CICLO</label>
          <div class="input-wrapper">
            <span class="input-prefix">&gt;</span>
            <input id="order-cycle" class="input" type="text" placeholder="02/2026">
          </div>
        </div>
        <div class="input-group">
          <label class="input-label">QUANTIDADE DE ITENS</label>
          <div class="input-wrapper">
            <span class="input-prefix">&gt;</span>
            <input id="order-items" class="input" type="number" min="1" placeholder="1" inputmode="numeric">
          </div>
          <div class="input-error-msg" id="items-err"></div>
        </div>
      </div>

      <button id="confirm-btn" class="btn btn--full cyber-chamfer mt-3" disabled>
        CONFIRMAR → INICIAR
      </button>
    </div>
  `;

  const fileInput = page.querySelector("#file-input");
  const dropArea = page.querySelector("#drop-area");
  const fileStatus = page.querySelector("#file-status");
  const fileErr = page.querySelector("#file-err");
  const codeInput = page.querySelector("#order-code");
  const codeErr = page.querySelector("#code-err");
  const cycleInput = page.querySelector("#order-cycle");
  const itemsInput = page.querySelector("#order-items");
  const itemsErr = page.querySelector("#items-err");
  const confirmBtn = page.querySelector("#confirm-btn");
  let importedPdfOrder = null;

  function checkReady() {
    const c = codeInput.value.trim();
    const i = parseInt(itemsInput.value, 10);
    const validImportedPdf = importedPdfOrder && c === importedPdfOrder.code;
    confirmBtn.disabled =
      (!/^\d{9}$/.test(c) && !validImportedPdf) || isNaN(i) || i < 1;
  }

  async function handleFile(file) {
    fileErr.textContent = "";
    try {
      const result = await parseSpreadsheet(file);
      const { orders, skipped } = result;
      if (orders.length === 0) {
        fileErr.textContent = "> Nenhum pedido válido encontrado.";
        return;
      }
      if (result.sourceType === "pdf") {
        const itemCount =
          result.totalItems ||
          orders.reduce((sum, order) => sum + (order.items || 0), 0);
        const isSingleOrderPdf = result.pdfType === "single-order";
        const code = isSingleOrderPdf ? result.orderCode : result.batchCode;
        importedPdfOrder = {
          code,
          cycle: isSingleOrderPdf
            ? result.cycle ||
              `${result.exportedDate || ""}${result.exportedTime ? " " + result.exportedTime : ""}`.trim()
            : `${result.exportedDate || ""}${result.exportedTime ? " " + result.exportedTime : ""}`.trim(),
          items: itemCount,
          importMeta: result,
        };
        codeInput.value = importedPdfOrder.code;
        cycleInput.value = importedPdfOrder.cycle;
        itemsInput.value = importedPdfOrder.items;
        fileStatus.innerHTML = isSingleOrderPdf
          ? `✓ PDF: pedido <span class="text-accent">${result.orderCode}</span> importado, ${itemCount} itens.`
          : `✓ PDF: lote <span class="text-accent">${result.batchCode}</span> importado como avulso, ${itemCount} itens.`;
      } else {
        importedPdfOrder = null;
        const o = orders[0];
        codeInput.value = o.code;
        cycleInput.value = o.cycle || "";
        itemsInput.value = o.items || "";
        fileStatus.innerHTML = `✓ <span class="text-accent">${o.code}</span> importado.${skipped > 0 ? " " + skipped + " ignorados." : ""}`;
      }
      checkReady();
    } catch (err) {
      fileErr.textContent = "> ERRO: " + err.message;
    }
  }

  fileInput.addEventListener("change", (e) => {
    if (e.target.files[0]) handleFile(e.target.files[0]);
  });
  dropArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropArea.classList.add("drag-over");
  });
  dropArea.addEventListener("dragleave", () =>
    dropArea.classList.remove("drag-over"),
  );
  dropArea.addEventListener("drop", (e) => {
    e.preventDefault();
    dropArea.classList.remove("drag-over");
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  });

  codeInput.addEventListener("input", () => {
    importedPdfOrder = null;
    codeInput.value = codeInput.value.replace(/\D/g, "");
    codeErr.textContent =
      codeInput.value && !/^\d{9}$/.test(codeInput.value)
        ? "> DEVE TER 9 DÍGITOS"
        : "";
    checkReady();
  });
  itemsInput.addEventListener("input", () => {
    const v = parseInt(itemsInput.value, 10);
    itemsErr.textContent =
      itemsInput.value && (isNaN(v) || v < 1) ? "> MÍNIMO 1 ITEM" : "";
    checkReady();
  });

  confirmBtn.addEventListener("click", () => {
    state.order = {
      code: codeInput.value.trim(),
      cycle: cycleInput.value.trim(),
      items: parseInt(itemsInput.value, 10),
      importMeta: importedPdfOrder?.importMeta || null,
    };
    showSepChrono(page, state, unitId);
  });
}

function showSepChrono(page, state, unitId) {
  const chrono = new Chronometer((sec) => {
    const el = page.querySelector("#chrono-sep");
    if (el) el.textContent = Chronometer.format(sec);
  });

  page.innerHTML = `
    <div style="max-width:500px;margin:0 auto;text-align:center;">
      <div class="section-title mb-2">SEPARAÇÃO</div>
      <div class="text-muted text-xs mb-3 cursor" style="letter-spacing:0.15em;">
        PEDIDO ${state.order.code} · ${state.order.items} ITENS · ${state.order.cycle}
      </div>
      <div class="card cyber-chamfer" style="padding:3rem 2rem;">
        <div class="chrono-label mb-1">TEMPO DE SEPARAÇÃO</div>
        <div class="chrono-display" id="chrono-sep">00:00:00</div>
        <div class="text-muted text-xs mt-2">OPERADOR: ${state.operator.name}</div>
      </div>
      <button id="finish-sep" class="btn btn--full cyber-chamfer mt-3" style="padding:1rem;">
        ■ FINALIZAR SEPARAÇÃO
      </button>
    </div>
  `;
  chrono.start();
  playStart();

  page.querySelector("#finish-sep").addEventListener("click", () => {
    chrono.stop();
    state.sepSeconds = chrono.getSeconds();
    showAskBip(page, state, unitId);
  });

  return () => chrono.stop();
}

function showAskBip(page, state, unitId) {
  page.innerHTML = `
    <div style="max-width:480px;margin:0 auto;text-align:center;">
      <div class="card cyber-chamfer mb-3">
        <div class="section-title">SEPARAÇÃO CONCLUÍDA</div>
        <div class="mt-2" style="font-family:var(--font-display);font-size:2rem;color:var(--accent);text-shadow:var(--neon);">
          ${Chronometer.format(state.sepSeconds)}
        </div>
        <div class="text-muted text-xs">TEMPO DE SEPARAÇÃO</div>
      </div>
      <h3 style="font-family:var(--font-display);font-size:0.9rem;letter-spacing:0.2em;margin-bottom:1.5rem;">
        BIPAR ESTE PEDIDO AGORA?
      </h3>
      <div style="display:flex;gap:1rem;">
        <button id="bip-yes" class="btn btn--full cyber-chamfer">SIM — BIPAR AGORA</button>
        <button id="bip-no" class="btn btn--secondary btn--full cyber-chamfer">NÃO — SALVAR APENAS SEPARAÇÃO</button>
      </div>
    </div>
  `;
  page
    .querySelector("#bip-yes")
    .addEventListener("click", () => showBipStep(page, state, unitId));
  page
    .querySelector("#bip-no")
    .addEventListener("click", () =>
      saveSingleOrder(page, state, unitId, false),
    );
}

function showBipStep(page, state, unitId) {
  const chrono = new Chronometer((sec) => {
    const el = page.querySelector("#chrono-bip");
    if (el) el.textContent = Chronometer.format(sec);
  });

  page.innerHTML = `
    <div style="max-width:500px;margin:0 auto;text-align:center;">
      <div class="section-title mb-2">BIPAGEM / LACRAÇÃO</div>
      <div class="text-muted text-xs mb-3 cursor">PEDIDO ${state.order.code}</div>

      <div class="card cyber-chamfer" style="padding:2rem;">
        <div class="chrono-label mb-1">TEMPO DE BIPAGEM</div>
        <div class="chrono-display" id="chrono-bip" style="font-size:2.5rem;">00:00:00</div>
      </div>

      <div class="card cyber-chamfer mt-2" style="text-align:left;">
        <div class="input-group">
          <label class="input-label">CÓDIGO DA CAIXA (10 DÍGITOS)</label>
          <div class="input-wrapper">
            <span class="input-prefix">&gt;</span>
            <input id="box-code" class="input" type="text" maxlength="12" placeholder="0000000000" inputmode="numeric" autofocus>
          </div>
          <div class="input-error-msg" id="box-err"></div>
        </div>
        <button id="validate-box" class="btn btn--full cyber-chamfer mt-2" disabled>
          ✓ VALIDAR CAIXA
        </button>
      </div>
    </div>
  `;

  const boxInput = page.querySelector("#box-code");
  const boxErr = page.querySelector("#box-err");
  const validateBtn = page.querySelector("#validate-box");
  let isFinishing = false;

  chrono.start();
  playStart();

  async function finishBipping() {
    if (isFinishing || !/^\d{10}$/.test(boxInput.value)) return;
    isFinishing = true;
    validateBtn.disabled = true;
    boxInput.disabled = true;
    chrono.stop();
    playConfirm();
    state.bipSeconds = chrono.getSeconds();
    state.boxCode = boxInput.value.trim();
    await saveSingleOrder(page, state, unitId, true);
  }

  boxInput.addEventListener("input", () => {
    // remove tudo que não for dígito
    let val = boxInput.value.replace(/\D/g, "");
    // remove zeros à esquerda (vindo de leitura de código de barras como 001529677866)
    val = val.replace(/^0+/, "") || "";
    // limita a 10 dígitos
    if (val.length > 10) val = val.slice(0, 10);
    boxInput.value = val;
    boxErr.textContent =
      val && !/^\d{10}$/.test(val) ? "> DEVE TER 10 DÍGITOS" : "";
    validateBtn.disabled = !/^\d{10}$/.test(val);
    if (/^\d{10}$/.test(val)) finishBipping();
  });

  boxInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !validateBtn.disabled) finishBipping();
  });

  validateBtn.addEventListener("click", finishBipping);

  return () => chrono.stop();
}

function serializeImportMeta(meta) {
  if (meta?.sourceType !== "pdf") return null;
  return {
    sourceType: "pdf",
    pdfType: meta.pdfType || "batch",
    batchCode: meta.batchCode,
    orderCode: meta.orderCode || null,
    separationBatchCode: meta.separationBatchCode || null,
    exportedDate: meta.exportedDate,
    exportedTime: meta.exportedTime,
    exportedAt: meta.exportedAt?.toISOString
      ? meta.exportedAt.toISOString()
      : meta.exportedAt || null,
    orderDate: meta.orderDate || null,
    cycle: meta.cycle || null,
    declaredItems: meta.declaredItems || null,
    totalItems: meta.totalItems,
    unaddressedItems: meta.unaddressedItems,
    unaddressedRows: meta.unaddressedRows,
    sectionTotals: meta.sectionTotals,
  };
}

async function saveSingleOrder(page, state, unitId, withBipping) {
  page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;

  const totalSecs = state.sepSeconds + (withBipping ? state.bipSeconds : 0);
  const xpResult = xpBatch({
    orders: 1,
    items: state.order.items,
    seconds: totalSecs,
    config: state.config,
  });

  const eventData = {
    unitId,
    stockistId: state.operator.id,
    type: "SINGLE_ORDER",
    xp: xpResult.total,
    singleOrder: {
      orderCode: state.order.code,
      cycle: state.order.cycle,
      items: state.order.items,
      importMeta: serializeImportMeta(state.order.importMeta),
      separationSeconds: state.sepSeconds,
      bippingSeconds: withBipping ? state.bipSeconds : null,
      boxCode: withBipping ? state.boxCode : null,
    },
  };

  try {
    await createEvent(eventData);
  } catch {
    try {
      saveEventLocally(eventData);
      document.getElementById("sync-banner")?.classList.add("visible");
    } catch {
      page.innerHTML = `
        <div class="text-center mt-4">
          <div style="font-size:1.4rem;color:var(--destructive);">⚠ ERRO AO SALVAR</div>
          <div class="text-muted mt-2">Sem conexão e armazenamento local cheio.<br>Registre o pedido manualmente.</div>
          <button class="btn btn--ghost cyber-chamfer mt-3" onclick="location.hash='/dashboard'">VOLTAR AO DASHBOARD</button>
        </div>`;
      return;
    }
  }

  const xpEl = (() => {
    page.innerHTML = `
      <div style="max-width:500px;margin:0 auto;">
        <div class="xp-summary cyber-chamfer-lg fade-in">
          <div class="xp-label">XP GANHO — PEDIDO AVULSO</div>
          <span class="xp-value" id="xp-count">0</span>
          ${xpResult.bonusPct > 0 ? `<div class="xp-bonus-tag">+${(xpResult.bonusPct * 100).toFixed(0)}% BÔNUS</div>` : ""}
        </div>
        <div class="card cyber-chamfer mt-2">
          <div class="stat-row"><span class="stat-label">PEDIDO</span><span class="stat-value text-accent">${state.order.code}</span></div>
          <div class="stat-row"><span class="stat-label">ITENS</span><span class="stat-value">${state.order.items}</span></div>
          <div class="stat-row"><span class="stat-label">SEPARAÇÃO</span><span class="stat-value">${Chronometer.format(state.sepSeconds)}</span></div>
          ${withBipping ? `<div class="stat-row"><span class="stat-label">BIPAGEM</span><span class="stat-value">${Chronometer.format(state.bipSeconds)}</span></div>` : ""}
          <div class="stat-row"><span class="stat-label">VELOCIDADE</span><span class="stat-value">${xpResult.speed.toFixed(1)} itens/min</span></div>
          <div class="stat-row"><span class="stat-label">BÔNUS</span><span class="stat-value text-accent">+${xpResult.bonus} XP</span></div>
        </div>
        <button class="btn btn--full cyber-chamfer mt-3" onclick="location.hash='/dashboard'">VOLTAR AO DASHBOARD</button>
      </div>`;
    return page.querySelector("#xp-count");
  })();

  playComplete();
  let cur = 0;
  const target = xpResult.total;
  const step = Math.ceil(target / 60);
  const t = setInterval(() => {
    cur = Math.min(cur + step, target);
    xpEl.textContent = cur.toLocaleString("pt-BR");
    if (cur >= target) {
      clearInterval(t);
      playXP();
    }
  }, 25);
}
