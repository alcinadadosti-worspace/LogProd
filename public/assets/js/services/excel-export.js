// Exporta os registros dos estoquistas para .xlsx — UMA ABA POR COLABORADOR.
// Usa o SheetJS (XLSX) já carregado globalmente no index.html (mesmo padrão de
// services/spreadsheet-parser.js).

function fmtDateTime(d) {
  if (!d || Number.isNaN(d.getTime?.()) || d.getTime() <= 0) return "";
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const HEADERS = ["Tipo", "Data/Hora", "Código", "Descrição", "Itens", "Caixa", "XP"];

// Monta as linhas (array de arrays) da aba de um colaborador.
function rowsForStockist(rec, periodLabel) {
  const rows = [
    ["Colaborador", rec.name],
    ["Período", periodLabel || "—"],
    ["XP total", rec.xp || 0],
    [],
    HEADERS,
  ];
  rec.lotes.forEach((l) =>
    rows.push(["Lote", fmtDateTime(l.when), l.code, `${l.type} · ${l.orders} pedido(s)`, l.items || 0, "", l.xp || 0]),
  );
  rec.pedidos.forEach((p) =>
    rows.push(["Pedido", fmtDateTime(p.when), p.code, "Pedido avulso", p.items || 0, p.boxCode || "", p.xp || 0]),
  );
  rec.caixas.forEach((c) =>
    rows.push(["Caixa", fmtDateTime(c.when), c.code, c.origin || "", "", "", ""]),
  );
  rec.tarefas.forEach((t) =>
    rows.push(["Tarefa", fmtDateTime(t.when), t.taskName, "Tarefa", t.quantity || 0, "", t.xp || 0]),
  );
  return rows;
}

// Nome de aba válido no Excel: máx. 31 chars, sem \ / ? * [ ] :, e único.
function sanitizeSheetName(name, used) {
  let base = String(name || "Colaborador").replace(/[\\/?*[\]:]/g, " ").trim().slice(0, 31) || "Colaborador";
  let candidate = base;
  let n = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${n++})`;
    candidate = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

/**
 * Gera e baixa um .xlsx com uma aba por colaborador.
 * @param records  lista de registros por estoquista (saída de buildPerStockist, ordenada).
 * @param opts.filename     nome do arquivo (.xlsx).
 * @param opts.periodLabel  rótulo do período (vai no cabeçalho de cada aba).
 */
export function exportStockistsToExcel(records, { filename = "registros.xlsx", periodLabel = "" } = {}) {
  if (typeof XLSX === "undefined") {
    throw new Error("Biblioteca de planilhas não carregada. Recarregue a página.");
  }
  if (!records || records.length === 0) {
    throw new Error("Nenhum registro no período para exportar.");
  }

  const wb = XLSX.utils.book_new();
  const used = new Set();
  records.forEach((rec) => {
    const ws = XLSX.utils.aoa_to_sheet(rowsForStockist(rec, periodLabel));
    ws["!cols"] = [{ wch: 9 }, { wch: 18 }, { wch: 16 }, { wch: 26 }, { wch: 8 }, { wch: 14 }, { wch: 7 }];
    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(rec.name, used));
  });

  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
