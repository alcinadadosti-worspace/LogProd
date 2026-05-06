import { getCurrentUser, getSessionContext } from "../auth.js";
import { navigate } from "../router.js";
import { selectOperator } from "./operator-select.js";
import { parseSpreadsheet } from "../services/spreadsheet-parser.js";
import {
  createEvent,
  saveEventLocally,
  getGlobalConfig,
  findSeparationBatch,
  findSeparationOrder,
} from "../services/firestore.js";
import { xpBatch } from "../services/xp-engine.js";
import { Chronometer } from "../components/chronometer.js";
import {
  playStart,
  playConfirm,
  playComplete,
  playAuraa,
} from "../services/sound-engine.js";

export async function renderOnlyBipper(container, params) {
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
      <div class="topbar-logo" style="font-size:0.8rem;">APENAS BIPADOR</div>
      <div></div>
    </div>
    <div class="page screen-enter" id="bip-page"></div>
  `;
  container
    .querySelector("#back-btn")
    .addEventListener("click", () => navigate("/dashboard"));

  const page = container.querySelector("#bip-page");
  const state = {
    operator: null,
    orders: [],
    bippingOrders: [],
    batchCode: "",
    singleOrder: null,
    bipSeconds: 0,
    boxCode: "",
    boxCodes: {},
    config: null,
    importMeta: null,
  };

  state.config = await getGlobalConfig();
  state.operator = await selectOperator(unitId);
  if (!state.operator) {
    navigate("/dashboard");
    return;
  }

  showBatchSearch(page, state, unitId);
}

function showBatchSearch(page, state, unitId) {
  page.innerHTML = `
    <div class="card cyber-chamfer" style="max-width:600px;">
      <div class="section-title mb-2">LOCALIZAR LOTE OU PEDIDO</div>
      <div class="text-muted text-xs mb-2" style="letter-spacing:0.1em;">
        OPERADOR: <span class="text-accent">${state.operator.name}</span>
      </div>

      <div class="input-group mb-2">
        <label class="input-label">CÓDIGO DO LOTE (8 DÍGITOS)</label>
        <div class="input-wrapper">
          <span class="input-prefix">&gt;</span>
          <input id="batch-input" class="input" type="text" maxlength="8" placeholder="12345678">
        </div>
        <div class="input-error-msg" id="batch-err"></div>
      </div>

      <button id="search-btn" class="btn btn--full cyber-chamfer mb-3" disabled>
        🔍 BUSCAR LOTE NO SISTEMA
      </button>

      <div style="text-align:center;color:var(--muted-fg);font-size:0.7rem;margin:1rem 0;letter-spacing:0.2em;">--- OU ---</div>

      <div class="input-group mb-2">
        <label class="input-label">CODIGO DO PEDIDO (9 DIGITOS)</label>
        <div class="input-wrapper">
          <span class="input-prefix">&gt;</span>
          <input id="order-input" class="input" type="text" maxlength="9" placeholder="123456789" inputmode="numeric">
        </div>
        <div class="input-error-msg" id="order-err"></div>
      </div>

      <button id="order-start" class="btn btn--full cyber-chamfer mb-2" disabled>
        🔍 BUSCAR PEDIDO NO SISTEMA
      </button>

      <div id="order-search-result" style="display:none;margin-bottom:0.75rem;">
        <div id="order-found-info" class="text-sm mb-2"></div>
        <button id="use-order-found" class="btn btn--full cyber-chamfer" style="display:none;">
          ✓ USAR ESTE PEDIDO → BIPAR
        </button>
      </div>

      <div id="search-result" style="display:none;">
        <div id="found-info" class="text-accent text-sm mb-2"></div>
        <button id="use-found" class="btn btn--full cyber-chamfer mb-2" style="display:none;">
          USAR ESTE LOTE → INFORMAR PEDIDOS
        </button>
      </div>

      <details style="margin-top:1rem;">
        <summary class="text-muted text-xs" style="cursor:pointer;letter-spacing:0.15em;">
          LOTE NÃO ENCONTRADO? IMPORTAR PLANILHA OU PDF MANUALMENTE
        </summary>
        <div style="margin-top:1rem;">
          <div class="file-upload-area cyber-chamfer mt-1" id="drop-area">
            <input type="file" id="file-input" accept=".xlsx,.xls,.csv,.pdf,application/pdf">
            <div class="file-upload-icon">📂</div>
            <div class="file-upload-text">Arraste ou clique para selecionar planilha ou PDF</div>
          </div>
          <div id="file-status" class="text-xs text-muted mt-1"></div>
          <div id="file-err" class="input-error-msg mt-1"></div>
          <button id="manual-start" class="btn btn--secondary btn--full cyber-chamfer mt-2" disabled>
            USAR ARQUIVO → INFORMAR PEDIDOS
          </button>
        </div>
      </details>
    </div>
  `;

  const batchInput = page.querySelector("#batch-input");
  const batchErr = page.querySelector("#batch-err");
  const searchBtn = page.querySelector("#search-btn");
  const orderInput = page.querySelector("#order-input");
  const orderErr = page.querySelector("#order-err");
  const orderStart = page.querySelector("#order-start");
  const orderSearchRes = page.querySelector("#order-search-result");
  const orderFoundInfo = page.querySelector("#order-found-info");
  const useOrderFound = page.querySelector("#use-order-found");
  const searchRes = page.querySelector("#search-result");
  const foundInfo = page.querySelector("#found-info");
  const useFound = page.querySelector("#use-found");
  const fileInput = page.querySelector("#file-input");
  const dropArea = page.querySelector("#drop-area");
  const fileStatus = page.querySelector("#file-status");
  const fileErr = page.querySelector("#file-err");
  const manualStart = page.querySelector("#manual-start");

  let manualOrders = [];

  batchInput.addEventListener("input", () => {
    const v = batchInput.value.replace(/\D/g, "");
    batchInput.value = v;
    if (v) {
      orderInput.value = "";
      orderErr.textContent = "";
      orderStart.disabled = true;
    }
    batchErr.textContent =
      v && !/^\d{8}$/.test(v) ? "> DEVE TER 8 DÍGITOS" : "";
    searchBtn.disabled = !/^\d{8}$/.test(v);
    searchRes.style.display = "none";
    useFound.style.display = "none";
    checkManual();
  });

  orderInput.addEventListener("input", () => {
    const v = orderInput.value.replace(/\D/g, "");
    orderInput.value = v;
    if (v) {
      batchInput.value = "";
      batchInput.readOnly = false;
      batchErr.textContent = "";
      searchBtn.disabled = true;
      searchRes.style.display = "none";
      useFound.style.display = "none";
      manualStart.disabled = true;
      // limpa resultado anterior de pedido
      orderSearchRes.style.display = "none";
      orderFoundInfo.textContent = "";
      useOrderFound.style.display = "none";
    }
    orderErr.textContent =
      v && !/^\d{9}$/.test(v) ? "> DEVE TER 9 DIGITOS" : "";
    orderStart.disabled = !/^\d{9}$/.test(v);
  });

  orderInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !orderStart.disabled) orderStart.click();
  });

  orderStart.addEventListener("click", async () => {
    const orderCode = orderInput.value.trim();
    if (!/^\d{9}$/.test(orderCode)) return;

    orderStart.disabled = true;
    orderStart.textContent = "BUSCANDO...";
    orderSearchRes.style.display = "block";
    orderFoundInfo.textContent = "";
    useOrderFound.style.display = "none";

    try {
      const ev = await findSeparationOrder(unitId, orderCode);
      if (ev) {
        const so = ev.singleOrder || {};
        if (so.boxCode) {
          orderFoundInfo.innerHTML = `<span class="text-destructive">✗ Pedido ${orderCode} já foi bipado.</span>`;
        } else {
          orderFoundInfo.innerHTML = `✓ Pedido <span class="text-accent">${orderCode}</span> encontrado
            &mdash; ${so.items || 1} ${so.items === 1 ? "item" : "itens"}${so.cycle ? " · Ciclo " + so.cycle : ""}`;
          state.batchCode = "";
          state.orders = [];
          state.bippingOrders = [];
          state.importMeta = null;
          state.singleOrder = {
            code: orderCode,
            cycle: so.cycle || "",
            items: so.items || 1,
          };
          useOrderFound.style.display = "block";
        }
      } else {
        orderFoundInfo.innerHTML = `<span class="text-destructive">✗ Pedido ${orderCode} não encontrado como separação registrada.</span>`;
      }
    } catch (err) {
      console.error("[findSeparationOrder]", err);
      orderFoundInfo.innerHTML = `<span class="text-destructive">> Erro na busca. Verifique a conexão.</span>`;
    }

    orderStart.disabled = false;
    orderStart.textContent = "🔍 BUSCAR PEDIDO NO SISTEMA";
  });

  useOrderFound.addEventListener("click", () => {
    showSingleOrderBipping(page, state, unitId);
  });

  searchBtn.addEventListener("click", async () => {
    const bc = batchInput.value.trim();
    searchBtn.disabled = true;
    searchBtn.textContent = "BUSCANDO...";
    searchRes.style.display = "block";
    foundInfo.textContent = "";
    useFound.style.display = "none";

    try {
      const ev = await findSeparationBatch(unitId, bc);
      if (ev) {
        const orders = ev.batch?.orders || [];
        const importMeta = ev.batch?.importMeta || null;
        foundInfo.innerHTML = `
          ✓ Lote <span class="text-accent">${bc}</span> encontrado —
          ${orders.length} ${importMeta?.sourceType === "pdf" ? "materiais" : "pedidos"}, ${ev.batch?.totalItems} itens
        `;
        state.batchCode = bc;
        state.orders = orders.map((o) => ({
          code: o.code,
          cycle: o.cycle,
          items: o.items,
          approvedAt: o.approvedAt ? new Date(o.approvedAt) : null,
          sourceType: o.sourceType || "spreadsheet",
          material: o.material || null,
          sku: o.sku || o.material || null,
          description: o.description || null,
          address: o.address || null,
          addressed: typeof o.addressed === "boolean" ? o.addressed : null,
        }));
        state.importMeta = importMeta;
        useFound.style.display = "block";
      } else {
        foundInfo.innerHTML = `<span class="text-destructive">✗ Lote ${bc} não encontrado como separação salva.</span>`;
      }
    } catch (err) {
      console.error("[findSeparationBatch]", err);
      const isIndexError =
        err?.message?.includes("index") || err?.code === "failed-precondition";
      foundInfo.innerHTML = isIndexError
        ? `<span class="text-destructive">⚠ Índice do banco não configurado. Contate o suporte.</span>`
        : `<span class="text-destructive">> Erro na busca. Verifique a conexão e tente novamente.</span>`;
    }

    searchBtn.disabled = false;
    searchBtn.textContent = "🔍 BUSCAR LOTE NO SISTEMA";
  });

  useFound.addEventListener("click", () => {
    showBatchOrderCount(page, state, unitId, () =>
      showBatchSearch(page, state, unitId),
    );
  });

  async function handleFile(file) {
    try {
      const result = await parseSpreadsheet(file);
      if (result.sourceType === "pdf" && result.pdfType !== "batch") {
        throw new Error(
          "Este PDF e de pedido avulso. Use a opcao PEDIDO AVULSO.",
        );
      }
      orderInput.value = "";
      orderErr.textContent = "";
      orderStart.disabled = true;
      const { orders, skipped } = result;
      manualOrders = orders;
      state.importMeta = result.sourceType === "pdf" ? result : null;
      if (result.sourceType === "pdf") {
        batchInput.value = result.batchCode;
        batchInput.readOnly = true;
        batchErr.textContent = "";
        fileStatus.innerHTML = `✓ PDF: lote <span class="text-accent">${result.batchCode}</span>, <span class="text-accent">${orders.length} materiais</span>, ${result.totalItems} itens. ${result.unaddressedItems > 0 ? result.unaddressedItems + " sem endereco." : ""}`;
      } else {
        batchInput.value = "";
        batchInput.readOnly = false;
        fileStatus.innerHTML = `✓ <span class="text-accent">${orders.length} pedidos</span>.${skipped ? " " + skipped + " ignorados." : ""}`;
      }
      checkManual();
    } catch (err) {
      fileErr.textContent = "> ERRO: " + err.message;
    }
  }

  function checkManual() {
    const bc = batchInput.value.trim();
    manualStart.disabled = manualOrders.length === 0 || !/^\d{8}$/.test(bc);
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

  manualStart.addEventListener("click", () => {
    state.batchCode = batchInput.value.trim();
    state.orders = manualOrders;
    showBatchOrderCount(page, state, unitId, () =>
      showBatchSearch(page, state, unitId),
    );
  });
}

function buildBippingOrders(count) {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      code: `PEDIDO-${number}`,
      cycle: "",
      approvedAt: null,
      items: 0,
      sourceType: "batch-bipping-order",
    };
  });
}

function getBippingOrders(state) {
  return state.bippingOrders?.length ? state.bippingOrders : state.orders;
}

function showBatchOrderCount(page, state, unitId, onBack) {
  page.innerHTML = `
    <div class="card cyber-chamfer" style="max-width:520px;">
      <div class="section-title mb-2">QUANTIDADE DE PEDIDOS DO LOTE</div>
      <div class="text-muted text-xs mb-3" style="letter-spacing:0.1em;">
        LOTE <span class="text-accent">${state.batchCode}</span> · ${state.orders.reduce((s, o) => s + (o.items || 0), 0)} ITENS
      </div>

      <div class="input-group">
        <label class="input-label">QUANTOS PEDIDOS SERÃO LACRADOS?</label>
        <div class="input-wrapper">
          <span class="input-prefix">&gt;</span>
          <input id="pdf-order-count" class="input" type="number" min="1" max="999" placeholder="5" inputmode="numeric" autofocus>
        </div>
        <div class="input-error-msg" id="pdf-order-count-err"></div>
      </div>

      <div style="display:flex;gap:0.75rem;margin-top:1.5rem;">
        <button id="back-step" class="btn btn--ghost cyber-chamfer-sm">← VOLTAR</button>
        <button id="continue-bip" class="btn btn--full cyber-chamfer" disabled>CONTINUAR → BIPAGEM</button>
      </div>
    </div>
  `;

  const input = page.querySelector("#pdf-order-count");
  const err = page.querySelector("#pdf-order-count-err");
  const continueBtn = page.querySelector("#continue-bip");

  function checkReady() {
    const count = parseInt(input.value, 10);
    const valid = Number.isInteger(count) && count >= 1 && count <= 999;
    err.textContent =
      input.value && !valid ? "> INFORME UMA QUANTIDADE ENTRE 1 E 999" : "";
    continueBtn.disabled = !valid;
  }

  input.addEventListener("input", checkReady);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !continueBtn.disabled) continueBtn.click();
  });
  page.querySelector("#back-step").addEventListener("click", onBack);
  continueBtn.addEventListener("click", () => {
    const count = parseInt(input.value, 10);
    if (!Number.isInteger(count) || count < 1 || count > 999) return;
    state.bippingOrders = buildBippingOrders(count);
    showBippingChrono(page, state, unitId);
  });
}

function showBippingChrono(page, state, unitId) {
  const bippingOrders = getBippingOrders(state);
  const isPdfBipping = state.importMeta?.sourceType === "pdf";
  const showBatchColumn = isPdfBipping || state.bippingOrders?.length > 0;
  const lockedMap = {};
  const chrono = new Chronometer((sec) => {
    const el = page.querySelector("#chrono-bip");
    if (el) el.textContent = Chronometer.format(sec);
  });

  page.innerHTML = `
    <div style="max-width:700px;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
        <div>
          <div class="section-title">BIPAGEM / LACRAÇÃO</div>
          <div class="text-muted text-xs cursor" style="letter-spacing:0.15em;">LOTE ${state.batchCode}</div>
        </div>
        <div style="text-align:right;">
          <div class="chrono-label">TEMPO DE BIPAGEM</div>
          <div class="chrono-display" id="chrono-bip" style="font-size:2rem;">00:00:00</div>
        </div>
      </div>

      <div class="card cyber-chamfer" style="padding:0;margin-bottom:1rem;">
        <div style="padding:0.5rem 1rem;border-bottom:1px solid var(--border);display:flex;
                    justify-content:space-between;font-size:0.65rem;font-family:var(--font-terminal);
                    color:var(--muted-fg);letter-spacing:0.15em;">
          <span>PEDIDO</span><span>${showBatchColumn ? "LOTE" : "CICLO"}</span><span>${showBatchColumn ? "CAIXA" : "ITENS"}</span>
          <span>CÓD. CAIXA (10 DIG.)</span><span>STATUS</span>
        </div>
        <div id="bip-list">
          ${bippingOrders
            .map(
              (o) => `
            <div class="order-item" id="row-${o.code}">
              <span class="order-code">${o.code}</span>
              <span class="order-cycle">${showBatchColumn ? state.batchCode : o.cycle}</span>
              <span class="order-items">${showBatchColumn ? "-" : o.items}</span>
              <input type="text" class="order-box-input" maxlength="10"
                     placeholder="0000000000" data-order="${o.code}" inputmode="numeric">
              <span class="order-status pending" id="status-${o.code}">PENDENTE</span>
            </div>`,
            )
            .join("")}
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;">
        <div class="text-sm">Lacrados: <span id="lock-count" class="text-accent">0</span>/${bippingOrders.length}</div>
        <div class="progress-bar-wrap" style="flex:1;"><div class="progress-bar" id="lock-progress" style="width:0%"></div></div>
      </div>

      <button id="finish-bip" class="btn btn--full cyber-chamfer" disabled style="padding:1rem;">
        ■ FINALIZAR LOTE
      </button>
    </div>
  `;

  const bipStart = new Date();
  let isFinishing = false;
  chrono.start();
  playStart();

  async function finishBipping() {
    if (isFinishing || Object.keys(lockedMap).length < bippingOrders.length)
      return;
    isFinishing = true;
    const finishBtn = page.querySelector("#finish-bip");
    if (finishBtn) finishBtn.disabled = true;
    chrono.stop();
    state.bipSeconds = chrono.getSeconds();
    state.bipStart = bipStart;
    state.bipEnd = new Date();
    state.boxCodes = { ...lockedMap };
    await save(page, state, unitId);
  }

  function updateProgress() {
    const count = Object.keys(lockedMap).length;
    page.querySelector("#lock-count").textContent = count;
    page.querySelector("#lock-progress").style.width =
      Math.round((count / bippingOrders.length) * 100) + "%";
    page.querySelector("#finish-bip").disabled = count < bippingOrders.length;
  }

  page.querySelector("#bip-list").addEventListener("input", (e) => {
    const inp = e.target;
    if (!inp.classList.contains("order-box-input")) return;
    const code = inp.dataset.order;
    inp.value = inp.value.replace(/\D/g, "");
    const val = inp.value;
    const statusEl = page.querySelector(`#status-${code}`);
    if (/^\d{10}$/.test(val)) {
      const dup = Object.entries(lockedMap).find(([k, v]) => v === val && k !== code);
      if (dup) {
        if (lockedMap[code]) { delete lockedMap[code]; inp.classList.remove("validated"); }
        statusEl.textContent = "✗ JÁ USADA";
        statusEl.className = "order-status";
        statusEl.style.color = "var(--destructive)";
        updateProgress();
        return;
      }
      statusEl.style.color = "";
      lockedMap[code] = val;
      inp.classList.add("validated");
      playConfirm();
      statusEl.textContent = "✓ LACRADO";
      statusEl.className = "order-status locked";
      const next = [...page.querySelectorAll(".order-box-input:not(.validated)")];
      if (next[0]) next[0].focus();
    } else {
      if (lockedMap[code]) delete lockedMap[code];
      inp.classList.remove("validated");
      statusEl.textContent = "PENDENTE";
      statusEl.className = "order-status pending";
      statusEl.style.color = "";
    }
    updateProgress();
    finishBipping();
  });

  page.querySelector("#finish-bip").addEventListener("click", finishBipping);

  return () => chrono.stop();
}

function showSingleOrderBipping(page, state, unitId) {
  const chrono = new Chronometer((sec) => {
    const el = page.querySelector("#chrono-bip");
    if (el) el.textContent = Chronometer.format(sec);
  });

  page.innerHTML = `
    <div style="max-width:500px;margin:0 auto;text-align:center;">
      <div class="section-title mb-2">BIPAGEM / LACRACAO</div>
      <div class="text-muted text-xs mb-3 cursor">PEDIDO ${state.singleOrder.code}</div>

      <div class="card cyber-chamfer" style="padding:2rem;">
        <div class="chrono-label mb-1">TEMPO DE BIPAGEM</div>
        <div class="chrono-display" id="chrono-bip" style="font-size:2.5rem;">00:00:00</div>
      </div>

      <div class="card cyber-chamfer mt-2" style="text-align:left;">
        <div class="input-group">
          <label class="input-label">CODIGO DA CAIXA (10 DIGITOS)</label>
          <div class="input-wrapper">
            <span class="input-prefix">&gt;</span>
            <input id="box-code" class="input" type="text" maxlength="12" placeholder="0000000000" inputmode="numeric" autofocus>
          </div>
          <div class="input-error-msg" id="box-err"></div>
        </div>
        <button id="validate-box" class="btn btn--full cyber-chamfer mt-2" disabled>
          VALIDAR CAIXA
        </button>
      </div>
    </div>
  `;

  const boxInput = page.querySelector("#box-code");
  const boxErr = page.querySelector("#box-err");
  const validateBtn = page.querySelector("#validate-box");
  const bipStart = new Date();
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
    state.bipStart = bipStart;
    state.bipEnd = new Date();
    state.boxCode = boxInput.value.trim();
    await saveSingleOrderBipping(page, state, unitId);
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
      val && !/^\d{10}$/.test(val) ? "> DEVE TER 10 DIGITOS" : "";
    validateBtn.disabled = !/^\d{10}$/.test(val);
    if (/^\d{10}$/.test(val)) finishBipping();
  });

  boxInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !validateBtn.disabled) finishBipping();
  });
  validateBtn.addEventListener("click", finishBipping);

  return () => chrono.stop();
}

async function saveSingleOrderBipping(page, state, unitId) {
  page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;

  const items = state.singleOrder.items || 1;
  const xpResult = xpBatch({
    orders: 1,
    items,
    seconds: state.bipSeconds,
    config: state.config,
  });

  const eventData = {
    unitId,
    stockistId: state.operator.id,
    type: "SINGLE_ORDER",
    xp: xpResult.total,
    singleOrder: {
      orderCode: state.singleOrder.code,
      cycle: state.singleOrder.cycle || "",
      items,
      importMeta: null,
      separationSeconds: null,
      bippingSeconds: state.bipSeconds,
      boxCode: state.boxCode,
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
          <div style="font-size:1.4rem;color:var(--destructive);">ERRO AO SALVAR</div>
          <div class="text-muted mt-2">Sem conexao e armazenamento local cheio.<br>Registre o pedido manualmente.</div>
          <button class="btn btn--ghost cyber-chamfer mt-3" onclick="location.hash='/dashboard'">VOLTAR AO DASHBOARD</button>
        </div>`;
      return;
    }
  }

  const xpEl = (() => {
    page.innerHTML = `
      <div style="max-width:500px;margin:0 auto;">
        <div class="xp-summary cyber-chamfer-lg fade-in">
          <div class="xp-label">XP GANHO - BIPAGEM PEDIDO</div>
          <span class="xp-value" id="xp-count">0</span>
          ${xpResult.bonusPct > 0 ? `<div class="xp-bonus-tag">+${(xpResult.bonusPct * 100).toFixed(0)}% BONUS</div>` : ""}
        </div>
        <div class="card cyber-chamfer mt-2">
          <div class="stat-row"><span class="stat-label">PEDIDO</span><span class="stat-value text-accent">${state.singleOrder.code}</span></div>
          <div class="stat-row"><span class="stat-label">CAIXA</span><span class="stat-value">${state.boxCode}</span></div>
          <div class="stat-row"><span class="stat-label">TEMPO BIPAGEM</span><span class="stat-value">${Chronometer.format(state.bipSeconds)}</span></div>
          <div class="stat-row"><span class="stat-label">VELOCIDADE</span><span class="stat-value">${xpResult.speed.toFixed(1)} itens/min</span></div>
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
      playAuraa();
    }
  }, 25);
}

function serializeOrder(o) {
  return {
    code: o.code,
    cycle: o.cycle || "",
    approvedAt: o.approvedAt?.toISOString?.() ?? null,
    items: o.items,
    sourceType: o.sourceType || "spreadsheet",
    material: o.material || null,
    sku: o.sku || o.material || null,
    description: o.description || null,
    address: o.address || null,
    addressed: typeof o.addressed === "boolean" ? o.addressed : null,
  };
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

async function save(page, state, unitId) {
  page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;

  const totalItems = state.orders.reduce((s, o) => s + (o.items || 0), 0);
  const bippingOrders = getBippingOrders(state);
  const orderCount = state.bippingOrders?.length
    ? bippingOrders.length
    : state.orders.length;
  const xpResult = xpBatch({
    orders: orderCount,
    items: totalItems,
    seconds: state.bipSeconds,
    config: state.config,
  });
  const countLabel = state.bippingOrders?.length
    ? "PEDIDOS BIPADOS"
    : "PEDIDOS";

  const eventData = {
    unitId,
    stockistId: state.operator.id,
    type: "ONLY_BIPPING",
    xp: xpResult.total,
    batch: {
      batchCode: state.batchCode,
      orders: state.orders.map(serializeOrder),
      bippingOrders: state.bippingOrders.map(serializeOrder),
      importMeta: serializeImportMeta(state.importMeta),
      totalOrders: orderCount,
      totalItems,
      totalMaterials: state.orders.length,
      separationSeconds: null,
      separationStartedAt: null,
      separationFinishedAt: null,
      bippingStartedAt: state.bipStart.toISOString(),
      bippingFinishedAt: state.bipEnd.toISOString(),
      bippingSeconds: state.bipSeconds,
      boxCodes: state.boxCodes,
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
          <div class="text-muted mt-2" style="max-width:360px;margin:1rem auto;">
            Sem conexão e armazenamento local cheio.<br>Anote os dados do lote <strong>${state.batchCode}</strong> e registre manualmente.
          </div>
          <button class="btn btn--ghost cyber-chamfer mt-3" onclick="location.hash='/dashboard'">VOLTAR AO DASHBOARD</button>
        </div>`;
      return;
    }
  }

  const xpEl = (() => {
    page.innerHTML = `
      <div style="max-width:500px;margin:0 auto;">
        <div class="xp-summary cyber-chamfer-lg fade-in">
          <div class="xp-label">XP GANHO — BIPAGEM</div>
          <span class="xp-value" id="xp-count">0</span>
          ${xpResult.bonusPct > 0 ? `<div class="xp-bonus-tag">+${(xpResult.bonusPct * 100).toFixed(0)}% BÔNUS</div>` : ""}
        </div>
        <div class="card cyber-chamfer mt-2">
          <div class="stat-row"><span class="stat-label">LOTE</span><span class="stat-value text-accent">${state.batchCode}</span></div>
          <div class="stat-row"><span class="stat-label">${countLabel}</span><span class="stat-value">${orderCount}</span></div>
          ${state.importMeta?.sourceType === "pdf" ? `<div class="stat-row"><span class="stat-label">MATERIAIS</span><span class="stat-value">${state.orders.length}</span></div>` : ""}
          <div class="stat-row"><span class="stat-label">ITENS</span><span class="stat-value">${totalItems}</span></div>
          <div class="stat-row"><span class="stat-label">TEMPO BIPAGEM</span><span class="stat-value">${Chronometer.format(state.bipSeconds)}</span></div>
          <div class="stat-row"><span class="stat-label">VELOCIDADE</span><span class="stat-value">${xpResult.speed.toFixed(1)} itens/min</span></div>
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
      playAuraa();
    }
  }, 25);
}
