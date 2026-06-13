// Filtro de período compartilhado: HOJE / SEMANA / MÊS / SEMPRE / PERSONALIZADO.
// Usado em dashboard, registros, analytics e painel admin.
//
// Fluxo:
//   - renderiza os botões com periodButtons(period) e a barra de datas com customRangeBar(...)
//   - liga tudo com attachPeriodControls(scope, onChange)
//   - onChange(period, custom) é chamado quando a seleção muda; `custom` = {start,end}
//     (strings "YYYY-MM-DD") apenas quando period === 'custom'.

const ORDER = ["today", "week", "month", "all", "custom"];
const LABELS = {
  today: "HOJE",
  week: "SEMANA",
  month: "MÊS",
  all: "SEMPRE",
  custom: "PERSONALIZADO",
};

/** Botões de período (HTML). `period` marca qual fica ativo. */
export function periodButtons(period) {
  return ORDER.map(
    (p) =>
      `<button class="filter-btn period-btn ${p === period ? "active" : ""}" data-period="${p}">${LABELS[p]}</button>`,
  ).join("");
}

/**
 * Barra de datas do filtro PERSONALIZADO (DE / ATÉ / APLICAR).
 * @param custom  {start,end} valores iniciais dos campos.
 * @param visible se a barra começa visível (use period === 'custom').
 * @param margin  margem CSS da barra (alinhe ao padding do container que a recebe).
 */
export function customRangeBar(custom = {}, visible = false, margin = "0 1.5rem 1rem") {
  const inputStyle =
    "font-family:var(--font-terminal);font-size:0.7rem;padding:0.25rem 0.4rem;background:var(--background);color:var(--fg);border:1px solid var(--border);";
  const labelStyle =
    "display:flex;align-items:center;gap:0.4rem;font-family:var(--font-terminal);font-size:0.6rem;letter-spacing:0.12em;color:var(--muted-fg);";
  return `
    <div data-custom-range style="display:${visible ? "flex" : "none"};align-items:center;gap:0.75rem;flex-wrap:wrap;
         margin:${margin};padding:0.6rem 0.9rem;background:var(--muted);border:1px solid var(--border);">
      <span style="font-family:var(--font-terminal);font-size:0.6rem;letter-spacing:0.15em;color:var(--accent);">PERÍODO PERSONALIZADO</span>
      <label style="${labelStyle}">DE<input type="date" data-custom-start value="${custom.start || ""}" style="${inputStyle}"></label>
      <label style="${labelStyle}">ATÉ<input type="date" data-custom-end value="${custom.end || ""}" style="${inputStyle}"></label>
      <button class="filter-btn" data-custom-apply style="border-color:var(--accent);color:var(--accent);">APLICAR</button>
    </div>`;
}

/** Lê e normaliza as datas (garante DE <= ATÉ). Retorna {start,end} (strings "YYYY-MM-DD"). */
function readRange(scope) {
  let start = scope.querySelector("[data-custom-start]")?.value || "";
  let end = scope.querySelector("[data-custom-end]")?.value || "";
  if (start && end && start > end) [start, end] = [end, start];
  return { start, end };
}

/**
 * Liga os botões de período + a barra personalizada dentro de `scope`.
 *  - HOJE/SEMANA/MÊS/SEMPRE: esconde a barra e dispara onChange imediatamente.
 *  - PERSONALIZADO: mostra a barra; só dispara onChange quando há DE e ATÉ.
 *  - APLICAR: revalida e dispara onChange.
 */
export function attachPeriodControls(scope, onChange) {
  const rangeBar = scope.querySelector("[data-custom-range]");
  const btns = scope.querySelectorAll(".period-btn");

  function setActive(period) {
    btns.forEach((b) =>
      b.classList.toggle("active", b.dataset.period === period),
    );
  }

  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const period = btn.dataset.period;
      setActive(period);
      if (period === "custom") {
        if (rangeBar) rangeBar.style.display = "flex";
        const { start, end } = readRange(scope);
        if (start && end) onChange("custom", { start, end });
        return;
      }
      if (rangeBar) rangeBar.style.display = "none";
      onChange(period, null);
    });
  });

  const applyBtn = scope.querySelector("[data-custom-apply]");
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      const { start, end } = readRange(scope);
      if (!start || !end) return;
      setActive("custom");
      if (rangeBar) rangeBar.style.display = "flex";
      onChange("custom", { start, end });
    });
  }
}
