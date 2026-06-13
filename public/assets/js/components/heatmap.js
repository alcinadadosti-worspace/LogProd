// Mapa de calor de atividade por dia (estilo GitHub), em calendário mensal.
// Recebe um objeto { "YYYY-MM-DD": quantidade } e devolve HTML puro — o tooltip
// é o atributo `title` nativo, então não precisa de wiring (funciona em telas
// que re-renderizam).

const WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"]; // Seg..Dom (semana começa na segunda)
const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

// 5 níveis de intensidade (0 = sem atividade) no verde neon do tema.
const SCALE = [
  "background:var(--muted);border:1px solid var(--border);",
  "background:rgba(0,255,136,0.22);border:1px solid rgba(0,255,136,0.30);",
  "background:rgba(0,255,136,0.45);border:1px solid rgba(0,255,136,0.55);",
  "background:rgba(0,255,136,0.70);border:1px solid rgba(0,255,136,0.80);",
  "background:rgba(0,255,136,0.95);border:1px solid #00ff88;box-shadow:0 0 6px rgba(0,255,136,0.6);",
];

const pad = (n) => String(n).padStart(2, "0");
const parseKey = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};

function levelOf(count, max) {
  if (count <= 0) return 0;
  if (max <= 1) return 2;
  const r = count / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

function monthGridHTML(year, month, counts, max) {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7; // coluna do dia 1 (segunda = 0)
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let cells = WEEKDAYS.map(
    (w) =>
      `<div style="width:14px;text-align:center;font-family:var(--font-terminal);font-size:0.5rem;color:var(--muted-fg);">${w}</div>`,
  ).join("");
  for (let i = 0; i < lead; i++) cells += `<div style="width:14px;height:14px;"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const c = counts[`${year}-${pad(month + 1)}-${pad(d)}`] || 0;
    const lvl = levelOf(c, max);
    const plural = c === 1 ? "" : "s";
    cells += `<div title="${pad(d)}/${pad(month + 1)}/${year} — ${c} evento${plural}" style="width:14px;height:14px;border-radius:2px;${SCALE[lvl]}"></div>`;
  }

  return `
    <div>
      <div style="font-family:var(--font-terminal);font-size:0.58rem;letter-spacing:0.12em;color:var(--muted-fg);margin-bottom:0.35rem;">${MONTHS[month]} / ${year}</div>
      <div style="display:grid;grid-template-columns:repeat(7,14px);gap:3px;">${cells}</div>
    </div>`;
}

/**
 * Gera o HTML do mapa de calor. Retorna "" se não houver nenhum dia com atividade.
 * @param countsByDay  { "YYYY-MM-DD": quantidade }
 */
export function activityHeatmapHTML(countsByDay) {
  const counts = countsByDay || {};
  const activeKeys = Object.keys(counts).filter((k) => counts[k] > 0);
  if (activeKeys.length === 0) return "";

  const sorted = activeKeys.slice().sort();
  const start = parseKey(sorted[0]);
  const end = parseKey(sorted[sorted.length - 1]);

  // Lista de meses entre o primeiro e o último dia com atividade.
  const months = [];
  let y = start.getFullYear();
  let m = start.getMonth();
  let guard = 0;
  while ((y < end.getFullYear() || (y === end.getFullYear() && m <= end.getMonth())) && guard < 24) {
    months.push([y, m]);
    if (++m > 11) { m = 0; y++; }
    guard++;
  }
  const truncated = months.length > 12;
  const display = truncated ? months.slice(-12) : months;

  const max = Math.max(...activeKeys.map((k) => counts[k]), 1);
  const grids = display.map(([yy, mm]) => monthGridHTML(yy, mm, counts, max)).join("");

  const legend = `
    <div style="display:flex;align-items:center;gap:0.3rem;font-family:var(--font-terminal);font-size:0.55rem;letter-spacing:0.1em;color:var(--muted-fg);margin-top:0.6rem;">
      menos
      ${[0, 1, 2, 3, 4].map((l) => `<div style="width:12px;height:12px;border-radius:2px;${SCALE[l]}"></div>`).join("")}
      mais
    </div>`;

  return `
    <div style="display:flex;flex-wrap:wrap;gap:1.2rem;align-items:flex-start;">${grids}</div>
    ${legend}
    ${truncated ? `<div style="font-family:var(--font-terminal);font-size:0.55rem;color:var(--muted-fg);margin-top:0.4rem;">Mostrando os últimos 12 meses.</div>` : ""}`;
}
