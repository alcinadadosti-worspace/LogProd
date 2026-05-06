import { getCurrentUser, getSessionContext } from "../auth.js";
import { navigate } from "../router.js";
import { selectOperator } from "./operator-select.js";
import {
  parseSpreadsheet,
  formatDate,
} from "../services/spreadsheet-parser.js";
import {
  createEvent,
  saveEventLocally,
  getGlobalConfig,
  getUnit,
  findExistingBatch,
} from "../services/firestore.js";
import { xpBatch } from "../services/xp-engine.js";
import { Chronometer } from "../components/chronometer.js";
import {
  playStart,
  playConfirm,
  playComplete,
  playAuraa,
} from "../services/sound-engine.js";

const VD_CITIES = {
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

export async function renderFunctionComplete(container, params) {
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

  // Render topbar
  container.innerHTML = `
    <div class="topbar">
      <button class="btn btn--ghost btn--sm" id="back-btn">← VOLTAR</button>
      <div class="topbar-logo" style="font-size:0.8rem;">FUNÇÃO COMPLETA</div>
      <div></div>
    </div>
    <div class="page screen-enter" id="fc-page"></div>
  `;
  container
    .querySelector("#back-btn")
    .addEventListener("click", () => navigate("/dashboard"));

  const page = container.querySelector("#fc-page");

  // Step state machine
  const state = {
    operator: null,
    orders: [],
    bippingOrders: [],
    batchCode: "",
    importMeta: null,
    sepSeconds: 0,
    bipSeconds: 0,
    boxCodes: {},
    config: null,
    currentChrono: null,
    vd: null,
    city: null,
    unit: null,
  };

  state.config = await getGlobalConfig();
  state.unit = await getUnit(unitId);
  state.operator = await selectOperator(unitId);
  if (!state.operator) {
    navigate("/dashboard");
    return;
  }

  showStep1(page, state, unitId);

  return () => {
    state.currentChrono?.stop();
  };
}

// ─── Step 1: Upload planilha ──────────────────────────────────────────────────
function showStep1(page, state, unitId) {
  page.innerHTML = `
    <h2 style="font-family:var(--font-display);font-size:0.9rem;letter-spacing:0.2em;
                color:var(--accent);margin-bottom:1.5rem;text-shadow:var(--neon);">
      OPERADOR: <span style="color:var(--fg);">${state.operator.name}</span>
    </h2>

    <div class="card cyber-chamfer" style="max-width:600px;">
      <div class="section-title mb-2">PASSO 1 — IMPORTAR PLANILHA OU PDF DO LOTE</div>

      <div class="file-upload-area cyber-chamfer" id="drop-area">
        <input type="file" id="file-input" accept=".xlsx,.xls,.csv,.pdf,application/pdf">
        <div class="file-upload-icon">📂</div>
        <div class="file-upload-text">Arraste ou clique para selecionar planilha ou PDF</div>
        <div class="file-upload-hint">.xlsx · .xls · .csv · .pdf</div>
      </div>

      <div id="file-status" class="text-xs text-muted mt-1"></div>
      <div id="file-err" class="input-error-msg mt-1"></div>

      <div class="mt-2 input-group" id="batch-code-group" style="display:none;">
        <label class="input-label">CÓDIGO DO LOTE (8 DÍGITOS)</label>
        <div class="input-wrapper">
          <span class="input-prefix">&gt;</span>
          <input id="batch-code-input" class="input" type="text" maxlength="8"
                 placeholder="12345678" pattern="\d{8}">
        </div>
        <div class="input-error-msg" id="batch-code-err"></div>
      </div>

      <button id="confirm-btn" class="btn btn--full cyber-chamfer mt-3" disabled>
        CONFIRMAR E CONTINUAR →
      </button>
    </div>
  `;

  const dropArea = page.querySelector("#drop-area");
  const fileInput = page.querySelector("#file-input");
  const fileStatus = page.querySelector("#file-status");
  const fileErr = page.querySelector("#file-err");
  const batchGroup = page.querySelector("#batch-code-group");
  const batchInput = page.querySelector("#batch-code-input");
  const batchErr = page.querySelector("#batch-code-err");
  const confirmBtn = page.querySelector("#confirm-btn");

  let parsedOrders = [];
  let parsedSkipped = 0;

  async function handleFile(file) {
    fileErr.textContent = "";
    fileStatus.textContent = file.name.toLowerCase().endsWith(".pdf")
      ? "Processando PDF..."
      : "Processando planilha...";
    try {
      const result = await parseSpreadsheet(file);
      if (result.sourceType === "pdf" && result.pdfType !== "batch") {
        throw new Error(
          "Este PDF e de pedido avulso. Use a opcao PEDIDO AVULSO.",
        );
      }
      parsedOrders = result.orders;
      parsedSkipped = result.skipped;
      state.importMeta = result.sourceType === "pdf" ? result : null;

      if (result.sourceType === "pdf") {
        // PDF: auto-navega direto para seleção de cidade
        state.orders = parsedOrders;
        state.batchCode = result.batchCode;
        fileStatus.textContent = "Verificando lote...";
        const existing = await findExistingBatch(unitId, result.batchCode).catch(() => null);
        if (existing) {
          fileErr.textContent = existing.type === "BATCH"
            ? `> LOTE ${result.batchCode} JÁ REGISTRADO COMO COMPLETO`
            : existing.type === "ONLY_BIPPING"
            ? `> LOTE ${result.batchCode} JÁ FOI BIPADO`
            : `> LOTE ${result.batchCode} JÁ SEPARADO — USE "APENAS BIPADOR" PARA BIPAR`;
          fileStatus.textContent = "";
          return;
        }
        showCitySelection(page, state, unitId, () =>
          showStep3Sep(page, state, unitId),
        );
        return;
      }
      // Planilha: mostra campo de código do lote
      batchInput.value = "";
      batchInput.readOnly = false;
      fileStatus.innerHTML = `
        ✓ <span class="text-accent">${parsedOrders.length} pedidos</span> carregados.
        ${parsedSkipped > 0 ? `<span class="text-muted">${parsedSkipped} linhas ignoradas.</span>` : ""}
      `;
      batchGroup.style.display = "flex";
      batchGroup.style.flexDirection = "column";
      checkReady();
    } catch (err) {
      fileErr.textContent = "> ERRO: " + err.message;
      fileStatus.textContent = "";
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

  function checkReady() {
    const validBatch = /^\d{8}$/.test(batchInput.value.trim());
    confirmBtn.disabled = parsedOrders.length === 0 || !validBatch;
  }

  batchInput.addEventListener("input", () => {
    batchErr.textContent =
      /^\d{8}$/.test(batchInput.value.trim()) || !batchInput.value
        ? ""
        : "> CÓDIGO DEVE TER 8 DÍGITOS";
    checkReady();
  });

  confirmBtn.addEventListener("click", async () => {
    const bc = batchInput.value.trim();
    if (!/^\d{8}$/.test(bc)) {
      batchErr.textContent = "> CÓDIGO DEVE TER 8 DÍGITOS";
      return;
    }
    confirmBtn.disabled = true;
    confirmBtn.textContent = "VERIFICANDO...";
    const existing = await findExistingBatch(unitId, bc).catch(() => null);
    if (existing) {
      batchErr.textContent = existing.type === "BATCH"
        ? `> LOTE ${bc} JÁ REGISTRADO COMO COMPLETO`
        : existing.type === "ONLY_BIPPING"
        ? `> LOTE ${bc} JÁ FOI BIPADO`
        : `> LOTE ${bc} JÁ SEPARADO — USE "APENAS BIPADOR" PARA BIPAR`;
      confirmBtn.disabled = false;
      confirmBtn.textContent = "CONFIRMAR E CONTINUAR →";
      return;
    }
    state.orders = parsedOrders;
    state.batchCode = bc;
    showCitySelection(page, state, unitId, () =>
      showStep3Sep(page, state, unitId),
    );
  });
}

// ─── City selection ─────────────────────────────────────────────────────────
function showCitySelection(page, state, unitId, onConfirm) {
  // Detecta VD automaticamente pelo nome da unidade
  const unitName = (state.unit?.name || "").toLowerCase();
  const autoVd = unitName.includes("palmeira")
    ? "VD Palmeira"
    : unitName.includes("penedo")
      ? "VD Penedo"
      : null;

  if (autoVd) {
    renderCityStep(autoVd, () => showStep1(page, state, unitId));
  } else {
    renderVdStep();
  }

  function renderVdStep() {
    page.innerHTML = `
      <div class="card cyber-chamfer" style="max-width:520px;text-align:center;">
        <div class="section-title mb-1">DE ONDE É ESSE LOTE?</div>
        <div class="text-muted text-xs mb-4" style="letter-spacing:0.1em;">LOTE <span class="text-accent">${state.batchCode}</span></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          ${Object.keys(VD_CITIES)
            .map(
              (vd) => `
            <button class="btn cyber-chamfer vd-btn" data-vd="${vd}" style="padding:1.5rem 1rem;font-size:0.8rem;letter-spacing:0.1em;">
              📍 ${vd}
            </button>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
    page.querySelectorAll(".vd-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        renderCityStep(btn.dataset.vd, renderVdStep),
      );
    });
  }

  function renderCityStep(vd, onBack) {
    const cities = VD_CITIES[vd];
    page.innerHTML = `
      <div class="card cyber-chamfer" style="max-width:520px;text-align:center;">
        <div class="section-title mb-1">DE ONDE É ESSE LOTE?</div>
        <div class="text-muted text-xs mb-1" style="letter-spacing:0.1em;">LOTE <span class="text-accent">${state.batchCode}</span> · <span class="text-accent">${vd}</span></div>
        <div class="text-muted text-xs mb-3">Selecione a cidade de origem</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:0.6rem;margin-bottom:0.75rem;">
          ${cities
            .map(
              (city) => `
            <button class="btn cyber-chamfer city-btn" data-city="${city}" style="padding:0.75rem 0.5rem;font-size:0.73rem;">
              ${city}
            </button>
          `,
            )
            .join("")}
        </div>
        <button class="btn btn--full cyber-chamfer city-btn mb-2" data-city="Várias cidades" style="background:rgba(124,58,237,0.1);">
          🌐 VÁRIAS CIDADES
        </button>
        <button id="back-vd" class="btn btn--ghost cyber-chamfer-sm" style="font-size:0.7rem;">← VOLTAR</button>
      </div>
    `;
    page.querySelectorAll(".city-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.vd = vd;
        state.city = btn.dataset.city;
        onConfirm();
      });
    });
    page
      .querySelector("#back-vd")
      .addEventListener("click", onBack || renderVdStep);
  }
}

// ─── Step 3: Cronômetro separação ────────────────────────────────────────────
function showStep3Sep(page, state, unitId) {
  const chrono = new Chronometer((sec) => {
    const el = page.querySelector("#chrono-sep");
    if (el) el.textContent = Chronometer.format(sec);
  });
  state.currentChrono = chrono;

  page.innerHTML = `
    <div style="max-width:500px;margin:0 auto;text-align:center;">
      <div class="section-title mb-2">SEPARAÇÃO EM ANDAMENTO</div>
      <div class="text-muted text-xs mb-3 cursor" style="letter-spacing:0.2em;">
        LOTE ${state.batchCode} · ${state.orders.length} ${state.importMeta?.sourceType === "pdf" ? "MATERIAIS" : "PEDIDOS"} · ${state.orders.reduce((s, o) => s + o.items, 0)} ITENS
      </div>

      <div class="card cyber-chamfer" style="padding:3rem 2rem;">
        <div class="chrono-label mb-1">TEMPO DE SEPARAÇÃO</div>
        <div class="chrono-display" id="chrono-sep">00:00:00</div>
        <div class="text-muted text-xs mt-2" style="letter-spacing:0.15em;">
          OPERADOR: ${state.operator.name}
        </div>
      </div>

      <button id="finish-sep" class="btn btn--full cyber-chamfer mt-3" style="font-size:0.9rem;padding:1rem;">
        ■ FINALIZAR SEPARAÇÃO
      </button>
    </div>
  `;

  chrono.start();
  playStart();
  const startedAt = new Date();

  page.querySelector("#finish-sep").addEventListener("click", () => {
    chrono.stop();
    state.sepSeconds = chrono.getSeconds();
    state.separationStart = startedAt;
    state.separationEnd = new Date();
    showStep4AskBip(page, state, unitId);
  });

  return () => chrono.stop();
}

// ─── Step 4: Perguntar bipar ─────────────────────────────────────────────────
function showStep4AskBip(page, state, unitId) {
  const formattedTime = Chronometer.format(state.sepSeconds);

  page.innerHTML = `
    <div style="max-width:480px;margin:0 auto;text-align:center;">
      <div class="card cyber-chamfer mb-3">
        <div class="section-title">SEPARAÇÃO CONCLUÍDA</div>
        <div class="mt-2" style="font-family:var(--font-display);font-size:2rem;color:var(--accent);text-shadow:var(--neon);">
          ${formattedTime}
        </div>
        <div class="text-muted text-xs">TEMPO DE SEPARAÇÃO</div>
      </div>

      <h3 style="font-family:var(--font-display);font-size:0.9rem;letter-spacing:0.2em;margin-bottom:1.5rem;">
        BIPAR ESTE LOTE AGORA?
      </h3>

      <div style="display:flex;gap:1rem;">
        <button id="bip-yes" class="btn btn--full cyber-chamfer">SIM — BIPAR AGORA</button>
        <button id="bip-no" class="btn btn--secondary btn--full cyber-chamfer">NÃO — SALVAR SEPARAÇÃO</button>
      </div>
    </div>
  `;

  page.querySelector("#bip-yes").addEventListener("click", () => {
    if (state.importMeta?.sourceType === "pdf") {
      showPdfOrderCount(page, state, unitId);
    } else {
      state.bippingOrders = [];
      showStep5Bip(page, state, unitId);
    }
  });
  page
    .querySelector("#bip-no")
    .addEventListener("click", () => saveOnlySeparation(page, state, unitId));
}

// ─── Save ONLY_SEPARATION ────────────────────────────────────────────────────
function buildPdfBippingOrders(count) {
  return Array.from({ length: count }, (_, index) => {
    const number = String(index + 1).padStart(2, "0");
    return {
      code: `PEDIDO-${number}`,
      cycle: "",
      approvedAt: null,
      items: 0,
      sourceType: "pdf-bipping-order",
    };
  });
}

function getBippingOrders(state) {
  return state.bippingOrders?.length ? state.bippingOrders : state.orders;
}

function serializeOrder(o) {
  return {
    code: o.code,
    cycle: o.cycle,
    approvedAt: o.approvedAt ? o.approvedAt.toISOString() : null,
    items: o.items,
    sourceType: o.sourceType || "spreadsheet",
    material: o.material || null,
    sku: o.sku || o.material || null,
    description: o.description || null,
    address: o.address || null,
    addressed: typeof o.addressed === "boolean" ? o.addressed : null,
  };
}

function showPdfOrderCount(page, state, unitId) {
  page.innerHTML = `
    <div class="card cyber-chamfer" style="max-width:520px;">
      <div class="section-title mb-2">QUANTIDADE DE PEDIDOS DO LOTE</div>
      <div class="text-muted text-xs mb-3" style="letter-spacing:0.1em;">
        LOTE <span class="text-accent">${state.batchCode}</span> · ${state.orders.reduce((s, o) => s + o.items, 0)} ITENS SEPARADOS
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
  page
    .querySelector("#back-step")
    .addEventListener("click", () => showStep4AskBip(page, state, unitId));
  continueBtn.addEventListener("click", () => {
    const count = parseInt(input.value, 10);
    if (!Number.isInteger(count) || count < 1 || count > 999) return;
    state.bippingOrders = buildPdfBippingOrders(count);
    showStep5Bip(page, state, unitId);
  });
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

async function saveOnlySeparation(page, state, unitId) {
  page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div><div class="text-accent mt-2">Salvando...</div></div>`;

  const totalItems = state.orders.reduce((s, o) => s + o.items, 0);
  const xpResult = xpBatch({
    orders: state.orders.length,
    items: totalItems,
    seconds: state.sepSeconds,
    config: state.config,
  });

  const eventData = {
    unitId,
    stockistId: state.operator.id,
    type: "ONLY_SEPARATION",
    xp: xpResult.total,
    batch: {
      batchCode: state.batchCode,
      orders: state.orders.map(serializeOrder),
      importMeta: serializeImportMeta(state.importMeta),
      totalOrders: state.orders.length,
      totalItems,
      separationSeconds: state.sepSeconds,
      separationStartedAt: state.separationStart?.toISOString() ?? null,
      separationFinishedAt: state.separationEnd?.toISOString() ?? null,
      bippingStartedAt: null,
      bippingFinishedAt: null,
      bippingSeconds: null,
      boxCodes: {},
      vd: state.vd || null,
      city: state.city || null,
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

  showSummary(page, state, xpResult, "ONLY_SEPARATION");
}

// ─── Step 5: Bipagem ──────────────────────────────────────────────────────────
function showStep5Bip(page, state, unitId) {
  const bippingOrders = getBippingOrders(state);
  const isPdfBipping = state.importMeta?.sourceType === "pdf";
  const chrono = new Chronometer((sec) => {
    const el = page.querySelector("#chrono-bip");
    if (el) el.textContent = Chronometer.format(sec);
  });
  state.currentChrono = chrono;

  const lockedMap = {};

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
        <div style="padding:0.5rem 1rem;border-bottom:1px solid var(--border);
                    display:flex;justify-content:space-between;font-size:0.65rem;
                    font-family:var(--font-terminal);color:var(--muted-fg);letter-spacing:0.15em;">
          <span>PEDIDO</span>
          <span>${isPdfBipping ? "LOTE" : "CICLO"}</span>
          <span>${isPdfBipping ? "CAIXA" : "ITENS"}</span>
          <span>CÓD. CAIXA (10 DIG.)</span>
          <span>STATUS</span>
        </div>
        <div id="bip-list">
          ${bippingOrders
            .map(
              (o) => `
            <div class="order-item" id="row-${o.code}" data-code="${o.code}">
              <span class="order-code">${o.code}</span>
              <span class="order-cycle">${isPdfBipping ? state.batchCode : o.cycle}</span>
              <span class="order-items">${isPdfBipping ? "-" : o.items}</span>
              <input type="text" class="order-box-input" maxlength="12"
                     placeholder="0000000000" data-order="${o.code}" inputmode="numeric">
              <span class="order-status pending" id="status-${o.code}">PENDENTE</span>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>

      <div style="display:flex;align-items:center;gap:1rem;margin-bottom:1rem;">
        <div class="text-sm">Lacrados: <span id="lock-count" class="text-accent">0</span>/${bippingOrders.length}</div>
        <div class="progress-bar-wrap" style="flex:1;"><div class="progress-bar" id="lock-progress" style="width:0%"></div></div>
      </div>

      <button id="finish-bip" class="btn btn--full cyber-chamfer" disabled style="font-size:0.9rem;padding:1rem;">
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
    await saveBatch(page, state, unitId);
  }

  function updateProgress() {
    const count = Object.keys(lockedMap).length;
    const pct = Math.round((count / bippingOrders.length) * 100);
    page.querySelector("#lock-count").textContent = count;
    page.querySelector("#lock-progress").style.width = pct + "%";
    page.querySelector("#finish-bip").disabled = count < bippingOrders.length;
  }

  page.querySelector("#bip-list").addEventListener("input", (e) => {
    const inp = e.target;
    if (!inp.classList.contains("order-box-input")) return;
    const code = inp.dataset.order;
    // remove não-dígitos, zeros à esquerda e limita a 10 dígitos
    let val = inp.value.replace(/\D/g, "");
    val = val.replace(/^0+/, "") || "";
    if (val.length > 10) val = val.slice(0, 10);
    inp.value = val;

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
      page
        .querySelector(`#row-${code}`)
        ?.style.setProperty("border-left", "3px solid var(--accent)");
      const inputs = [
        ...page.querySelectorAll(".order-box-input:not(.validated)"),
      ];
      if (inputs[0]) inputs[0].focus();
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

// ─── Save BATCH ──────────────────────────────────────────────────────────────
async function saveBatch(page, state, unitId) {
  page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div><div class="text-accent mt-2">Salvando...</div></div>`;

  const totalItems = state.orders.reduce((s, o) => s + o.items, 0);
  const totalSecs = state.sepSeconds + (state.bipSeconds || 0);
  const bippingOrders = getBippingOrders(state);
  const orderCount =
    state.importMeta?.sourceType === "pdf"
      ? bippingOrders.length
      : state.orders.length;
  const xpResult = xpBatch({
    orders: orderCount,
    items: totalItems,
    seconds: totalSecs,
    config: state.config,
  });

  const eventData = {
    unitId,
    stockistId: state.operator.id,
    type: "BATCH",
    xp: xpResult.total,
    batch: {
      batchCode: state.batchCode,
      orders: state.orders.map(serializeOrder),
      bippingOrders: state.bippingOrders.map(serializeOrder),
      importMeta: serializeImportMeta(state.importMeta),
      totalOrders: orderCount,
      totalMaterials: state.orders.length,
      totalItems,
      separationSeconds: state.sepSeconds,
      separationStartedAt: state.separationStart?.toISOString() ?? null,
      separationFinishedAt: state.separationEnd?.toISOString() ?? null,
      bippingStartedAt: state.bipStart?.toISOString() ?? null,
      bippingFinishedAt: state.bipEnd?.toISOString() ?? null,
      bippingSeconds: state.bipSeconds,
      boxCodes: state.boxCodes,
      vd: state.vd || null,
      city: state.city || null,
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

  showSummary(page, state, xpResult, "BATCH");
}

// ─── Summary ──────────────────────────────────────────────────────────────────
function showSummary(page, state, xpResult, type) {
  const totalItems = state.orders.reduce((s, o) => s + o.items, 0);
  const countLabel =
    state.importMeta?.sourceType === "pdf" ? "MATERIAIS" : "PEDIDOS";
  const bippingOrders = getBippingOrders(state);

  page.innerHTML = `
    <div style="max-width:500px;margin:0 auto;">
      <div class="xp-summary cyber-chamfer-lg fade-in">
        <div class="xp-label">XP GANHO</div>
        <span class="xp-value" id="xp-count">0</span>
        ${
          xpResult.bonusPct > 0
            ? `<div class="xp-bonus-tag">+${(xpResult.bonusPct * 100).toFixed(0)}% BÔNUS VELOCIDADE</div>`
            : ""
        }
      </div>

      <div class="card cyber-chamfer mt-2">
        <div class="section-title mb-2">RESUMO DA OPERAÇÃO</div>
        <div class="stat-row"><span class="stat-label">TIPO</span><span class="stat-value">${type === "BATCH" ? "Função Completa" : "Apenas Separação"}</span></div>
        <div class="stat-row"><span class="stat-label">LOTE</span><span class="stat-value text-accent">${state.batchCode}</span></div>
        <div class="stat-row"><span class="stat-label">${countLabel}</span><span class="stat-value">${state.orders.length}</span></div>
        ${state.importMeta?.sourceType === "pdf" && state.bipSeconds ? `<div class="stat-row"><span class="stat-label">PEDIDOS BIPADOS</span><span class="stat-value">${bippingOrders.length}</span></div>` : ""}
        <div class="stat-row"><span class="stat-label">ITENS</span><span class="stat-value">${totalItems}</span></div>
        <div class="stat-row"><span class="stat-label">SEPARAÇÃO</span><span class="stat-value">${Chronometer.format(state.sepSeconds)}</span></div>
        ${state.bipSeconds ? `<div class="stat-row"><span class="stat-label">BIPAGEM</span><span class="stat-value">${Chronometer.format(state.bipSeconds)}</span></div>` : ""}
        <div class="stat-row"><span class="stat-label">VELOCIDADE</span><span class="stat-value">${xpResult.speed.toFixed(1)} itens/min</span></div>
        <div class="stat-row"><span class="stat-label">BASE XP</span><span class="stat-value">${xpResult.subtotal}</span></div>
        <div class="stat-row"><span class="stat-label">BÔNUS</span><span class="stat-value text-accent">+${xpResult.bonus}</span></div>
      </div>

      <button class="btn btn--full cyber-chamfer mt-3" onclick="location.hash='/dashboard'">
        VOLTAR AO DASHBOARD
      </button>
    </div>
  `;

  // Count-up animation
  playComplete();
  const xpEl = page.querySelector("#xp-count");
  let current = 0;
  const target = xpResult.total;
  const step = Math.ceil(target / 60);
  const timer = setInterval(() => {
    current = Math.min(current + step, target);
    xpEl.textContent = current.toLocaleString("pt-BR");
    if (current >= target) {
      clearInterval(timer);
      playAuraa();
    }
  }, 25);
}
