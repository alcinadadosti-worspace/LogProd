import { getCurrentUser, getSessionContext } from "../auth.js";
import { navigate } from "../router.js";
import { selectOperator } from "./operator-select.js";
import { parseSpreadsheet } from "../services/spreadsheet-parser.js";
import {
  createEvent,
  saveEventLocally,
  getGlobalConfig,
  getUnit,
  findSeparationOrder,
  getUsedBoxCodes,
} from "../services/firestore.js";

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
    "Olho d'agua",
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
import { xpBatch } from "../services/xp-engine.js";
import { Chronometer } from "../components/chronometer.js";
import {
  playStart,
  playConfirm,
  playComplete,
  playAuraa,
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
    unit: null,
    vd: null,
    city: null,
  };

  state.config = await getGlobalConfig();
  state.unit = await getUnit(unitId);
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
        <p class="text-muted text-xs mb-1" style="letter-spacing:0.1em;">IMPORTAR PLANILHA OU PDF</p>
        <div class="file-upload-area cyber-chamfer" id="drop-area">
          <input type="file" id="file-input" accept=".xlsx,.xls,.csv,.pdf,application/pdf">
          <div class="file-upload-icon">📂</div>
          <div class="file-upload-text">Arraste ou selecione planilha ou PDF</div>
        </div>
        <div id="file-status" class="text-xs text-muted mt-1"></div>
        <div id="file-err" class="input-error-msg"></div>
      </div>

      <div id="order-details" style="display:none;">
        <div class="input-group mb-2">
          <label class="input-label">NÚMERO DO PEDIDO</label>
          <div class="input-wrapper">
            <span class="input-prefix">🔒</span>
            <input id="order-code" class="input" type="text" readonly style="opacity:0.7;cursor:not-allowed;">
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="input-group">
            <label class="input-label">CICLO</label>
            <div class="input-wrapper">
              <span class="input-prefix">🔒</span>
              <input id="order-cycle" class="input" type="text" readonly style="opacity:0.7;cursor:not-allowed;">
            </div>
          </div>
          <div class="input-group">
            <label class="input-label">QUANTIDADE DE ITENS</label>
            <div class="input-wrapper">
              <span class="input-prefix">🔒</span>
              <input id="order-items" class="input" type="text" readonly style="opacity:0.7;cursor:not-allowed;">
            </div>
          </div>
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
  const orderDetails = page.querySelector("#order-details");
  const codeInput = page.querySelector("#order-code");
  const cycleInput = page.querySelector("#order-cycle");
  const itemsInput = page.querySelector("#order-items");
  const confirmBtn = page.querySelector("#confirm-btn");
  let importedOrder = null;

  async function handleFile(file) {
    fileErr.textContent = "";
    orderDetails.style.display = "none";
    confirmBtn.disabled = true;
    importedOrder = null;
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
        importedOrder = {
          code,
          cycle: isSingleOrderPdf
            ? result.cycle ||
              `${result.exportedDate || ""}${result.exportedTime ? " " + result.exportedTime : ""}`.trim()
            : `${result.exportedDate || ""}${result.exportedTime ? " " + result.exportedTime : ""}`.trim(),
          items: itemCount,
          importMeta: result,
        };
        // PDF: verifica duplicata antes de navegar
        fileStatus.textContent = "Verificando pedido...";
        const existing = await findSeparationOrder(unitId, code).catch(() => null);
        if (existing) {
          const so = existing.singleOrder || {};
          fileErr.textContent = so.boxCode
            ? `> PEDIDO ${code} JÁ FOI BIPADO`
            : `> PEDIDO ${code} JÁ REGISTRADO`;
          fileStatus.textContent = "";
          return;
        }
        state.order = {
          code: importedOrder.code,
          cycle: importedOrder.cycle,
          items: importedOrder.items,
          importMeta: importedOrder.importMeta,
        };
        showCitySelection(page, state, unitId, () =>
          showSepChrono(page, state, unitId),
        );
        return;
      }
      // Planilha: mostra dados e botão de confirmar
      const o = orders[0];
      importedOrder = {
        code: o.code,
        cycle: o.cycle || "",
        items: o.items || 0,
        importMeta: null,
      };
      fileStatus.innerHTML = `✓ <span class="text-accent">${o.code}</span> importado.${skipped > 0 ? " " + skipped + " ignorados." : ""}`;
      codeInput.value = importedOrder.code;
      cycleInput.value = importedOrder.cycle;
      itemsInput.value = importedOrder.items;
      orderDetails.style.display = "block";
      confirmBtn.disabled = false;
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

  confirmBtn.addEventListener("click", async () => {
    if (!importedOrder) return;
    confirmBtn.disabled = true;
    confirmBtn.textContent = "VERIFICANDO...";
    const existing = await findSeparationOrder(unitId, importedOrder.code).catch(() => null);
    if (existing) {
      const so = existing.singleOrder || {};
      fileErr.textContent = so.boxCode
        ? `> PEDIDO ${importedOrder.code} JÁ FOI BIPADO`
        : `> PEDIDO ${importedOrder.code} JÁ REGISTRADO`;
      confirmBtn.disabled = false;
      confirmBtn.textContent = "CONFIRMAR → INICIAR";
      return;
    }
    state.order = {
      code: importedOrder.code,
      cycle: importedOrder.cycle,
      items: importedOrder.items,
      importMeta: importedOrder.importMeta,
    };
    showCitySelection(page, state, unitId, () =>
      showSepChrono(page, state, unitId),
    );
  });
}

function showCitySelection(page, state, unitId, onConfirm) {
  const unitName = (state.unit?.name || "").toLowerCase();
  const autoVd = unitName.includes("palmeira")
    ? "VD Palmeira"
    : unitName.includes("penedo")
      ? "VD Penedo"
      : null;

  if (autoVd) {
    renderCityStep(autoVd, () => showInput(page, state, unitId));
  } else {
    renderVdStep();
  }

  function renderVdStep() {
    page.innerHTML = `
      <div class="card cyber-chamfer" style="max-width:520px;text-align:center;">
        <div class="section-title mb-1">DE ONDE É ESSE PEDIDO?</div>
        <div class="text-muted text-xs mb-4" style="letter-spacing:0.1em;">PEDIDO <span class="text-accent">${state.order.code}</span></div>
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
        <div class="section-title mb-1">DE ONDE É ESSE PEDIDO?</div>
        <div class="text-muted text-xs mb-1" style="letter-spacing:0.1em;">PEDIDO <span class="text-accent">${state.order.code}</span> · <span class="text-accent">${vd}</span></div>
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

async function showBipStep(page, state, unitId) {
  page.innerHTML = `<div class="text-center mt-4"><div class="spinner" style="margin:0 auto;"></div></div>`;
  const usedBoxCodes = await getUsedBoxCodes(unitId);

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
    if (usedBoxCodes.has(boxInput.value)) {
      boxErr.textContent = "> CÓDIGO DE CAIXA JÁ REGISTRADO";
      validateBtn.disabled = true;
      return;
    }
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
    if (usedBoxCodes.has(val)) {
      boxErr.textContent = "> CÓDIGO DE CAIXA JÁ REGISTRADO";
      validateBtn.disabled = true;
      return;
    }
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
      playAuraa();
    }
  }, 25);
}
