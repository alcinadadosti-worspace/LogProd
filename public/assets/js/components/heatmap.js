// Mapa de calor de atividade por dia (estilo GitHub), em calendário mensal.
// Dois modos:
//   - activityHeatmapHTML(countsByDay): intensidade (verde) — 1 pessoa / total.
//   - activityHeatmapByPersonHTML(dayPersonCounts, people): cada dia recebe a
//     COR da pessoa que mais produziu nele, com legenda cor → nome.
// Tooltip é o atributo `title` nativo, então não precisa de wiring.

const WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"]; // Seg..Dom (semana começa na segunda)
const MONTHS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

// Escala de intensidade (0 = sem atividade) no verde neon do tema.
const SCALE = [
  "background:var(--muted);border:1px solid var(--border);",
  "background:rgba(0,255,136,0.22);border:1px solid rgba(0,255,136,0.30);",
  "background:rgba(0,255,136,0.45);border:1px solid rgba(0,255,136,0.55);",
  "background:rgba(0,255,136,0.70);border:1px solid rgba(0,255,136,0.80);",
  "background:rgba(0,255,136,0.95);border:1px solid #00ff88;box-shadow:0 0 6px rgba(0,255,136,0.6);",
];

// Paleta de cores distintas para identificar pessoas.
export const PERSON_COLORS = [
  "#00e08a", "#3b82f6", "#f59e0b", "#a855f7", "#ec4899", "#06b6d4",
  "#ef4444", "#eab308", "#14b8a6", "#6366f1", "#84cc16", "#fb7185",
];

const EMPTY_STYLE = "background:var(--muted);border:1px solid var(--border);";

const pad = (n) => String(n).padStart(2, "0");
const parseKey = (k) => {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function levelOf(count, max) {
  if (count <= 0) return 0;
  if (max <= 1) return 2;
  const r = count / max;
  if (r <= 0.25) return 1;
  if (r <= 0.5) return 2;
  if (r <= 0.75) return 3;
  return 4;
}

// Atribui uma cor estável a cada pessoa (ordenada por id), para o mapa por pessoa.
export function assignPersonColors(stockists) {
  return (stockists || [])
    .slice()
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((s, i) => ({ id: s.id, name: s.name, color: PERSON_COLORS[i % PERSON_COLORS.length] }));
}

// Grade de um mês. cellFn(day, month, year, key) -> { style, title }.
function monthGridHTML(year, month, cellFn) {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7; // coluna do dia 1 (segunda = 0)
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  let cells = WEEKDAYS.map(
    (w) =>
      `<div style="width:14px;text-align:center;font-family:var(--font-terminal);font-size:0.5rem;color:var(--muted-fg);">${w}</div>`,
  ).join("");
  for (let i = 0; i < lead; i++) cells += `<div style="width:14px;height:14px;"></div>`;
  for (let d = 1; d <= daysInMonth; d++) {
    const { style, title } = cellFn(d, month, year, `${year}-${pad(month + 1)}-${pad(d)}`);
    cells += `<div title="${title}" style="width:14px;height:14px;border-radius:2px;${style}"></div>`;
  }

  return `
    <div>
      <div style="font-family:var(--font-terminal);font-size:0.58rem;letter-spacing:0.12em;color:var(--muted-fg);margin-bottom:0.35rem;">${MONTHS[month]} / ${year}</div>
      <div style="display:grid;grid-template-columns:repeat(7,14px);gap:3px;">${cells}</div>
    </div>`;
}

// Monta o calendário (1+ meses) entre start e end, com a legenda fornecida.
function renderCalendar(start, end, cellFn, legendHTML) {
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
  const grids = display.map(([yy, mm]) => monthGridHTML(yy, mm, cellFn)).join("");

  return `
    <div style="display:flex;flex-wrap:wrap;gap:1.2rem;align-items:flex-start;">${grids}</div>
    ${legendHTML || ""}
    ${truncated ? `<div style="font-family:var(--font-terminal);font-size:0.55rem;color:var(--muted-fg);margin-top:0.4rem;">Mostrando os últimos 12 meses.</div>` : ""}`;
}

/**
 * Mapa por INTENSIDADE (verde). Retorna "" se não houver atividade.
 * @param countsByDay  { "YYYY-MM-DD": quantidade }
 */
export function activityHeatmapHTML(countsByDay) {
  const counts = countsByDay || {};
  const activeKeys = Object.keys(counts).filter((k) => counts[k] > 0);
  if (activeKeys.length === 0) return "";

  const sorted = activeKeys.slice().sort();
  const max = Math.max(...activeKeys.map((k) => counts[k]), 1);

  const cellFn = (d, month, year, key) => {
    const c = counts[key] || 0;
    return {
      style: SCALE[levelOf(c, max)],
      title: `${pad(d)}/${pad(month + 1)}/${year} — ${c} evento${c === 1 ? "" : "s"}`,
    };
  };

  const legend = `
    <div style="display:flex;align-items:center;gap:0.3rem;font-family:var(--font-terminal);font-size:0.55rem;letter-spacing:0.1em;color:var(--muted-fg);margin-top:0.6rem;">
      menos
      ${[0, 1, 2, 3, 4].map((l) => `<div style="width:12px;height:12px;border-radius:2px;${SCALE[l]}"></div>`).join("")}
      mais
    </div>`;

  return renderCalendar(parseKey(sorted[0]), parseKey(sorted[sorted.length - 1]), cellFn, legend);
}

/**
 * Mapa por PESSOA: cada dia recebe a cor de quem mais produziu nele.
 * @param dayPersonCounts  { "YYYY-MM-DD": { stockistId: quantidade } }
 * @param people           [{ id, name, color }] (use assignPersonColors)
 */
export function activityHeatmapByPersonHTML(dayPersonCounts, people) {
  const colorById = {};
  const nameById = {};
  (people || []).forEach((p) => { colorById[p.id] = p.color; nameById[p.id] = p.name; });

  // Por dia: lista de { id, count } ordenada (dominante primeiro).
  const dayInfo = {};
  const totals = {};
  for (const [key, perPerson] of Object.entries(dayPersonCounts || {})) {
    const parts = Object.entries(perPerson)
      .filter(([, c]) => c > 0)
      .map(([id, count]) => ({ id, count }));
    if (!parts.length) continue;
    parts.sort((a, b) => b.count - a.count);
    dayInfo[key] = parts;
    parts.forEach((p) => { totals[p.id] = (totals[p.id] || 0) + p.count; });
  }
  const activeKeys = Object.keys(dayInfo);
  if (activeKeys.length === 0) return "";

  const cellFn = (d, month, year, key) => {
    const dateStr = `${pad(d)}/${pad(month + 1)}/${year}`;
    const parts = dayInfo[key];
    if (!parts) return { style: EMPTY_STYLE, title: `${dateStr} — sem atividade` };
    const color = colorById[parts[0].id] || "#888";
    const list = parts.map((p) => `${esc(nameById[p.id] || p.id)} (${p.count})`).join(", ");
    return { style: `background:${color};border:1px solid ${color};`, title: `${dateStr} — ${list}` };
  };

  // Legenda: só quem aparece, ordenado por atividade total (mais ativo primeiro).
  const legendPeople = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
  const legend = `
    <div style="display:flex;flex-wrap:wrap;gap:0.5rem 0.9rem;margin-top:0.7rem;">
      ${legendPeople
        .map(
          (id) => `
        <span style="display:flex;align-items:center;gap:0.35rem;font-family:var(--font-terminal);font-size:0.62rem;color:var(--fg);">
          <span style="width:12px;height:12px;border-radius:2px;background:${colorById[id] || "#888"};"></span>
          ${esc(nameById[id] || id)}
        </span>`,
        )
        .join("")}
    </div>`;

  const sortedKeys = activeKeys.slice().sort();
  return renderCalendar(parseKey(sortedKeys[0]), parseKey(sortedKeys[sortedKeys.length - 1]), cellFn, legend);
}
