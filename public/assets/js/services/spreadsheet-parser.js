/** Normaliza nome de coluna: minúsculas, sem acentos, sem espaços extras */
function normalizeKey(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

const COLUMN_ALIASES = {
  order: ['pedido', 'pedido com 9 digitos', 'numero do pedido', 'cod pedido', 'order', 'cod. pedido'],
  cycle: ['ciclo', 'cycle', 'ciclo de entrega'],
  approvedAt: ['data de aprovacao', 'aprovacao', 'data aprovacao', 'approval date', 'dt aprovacao', 'dt. aprovacao'],
  items: ['itens', 'quantidade de itens', 'qtd itens', 'items', 'qtd. itens', 'quantidade'],
};

function findColumn(headers, aliases) {
  for (const alias of aliases) {
    const idx = headers.findIndex(h => normalizeKey(h) === alias || normalizeKey(h).startsWith(alias));
    if (idx >= 0) return idx;
  }
  return -1;
}

/** Parse DD/MM/YYYY or DD/MM/YYYY HH:mm:ss */
function parseBRDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/);
  if (!m) return null;
  const [, d, mo, y, h = '00', mi = '00', se = '00'] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}`);
}

/**
 * Parses an XLSX/XLS/CSV file (File object) using SheetJS (window.XLSX).
 * Returns { orders: [...], skipped: number }
 */
export async function parseSpreadsheet(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const wb   = XLSX.read(data, { type: 'array', cellDates: false });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

        if (rows.length < 2) {
          return reject(new Error('Planilha vazia ou sem dados'));
        }

        const headers = rows[0].map(String);
        const colOrder     = findColumn(headers, COLUMN_ALIASES.order);
        const colCycle     = findColumn(headers, COLUMN_ALIASES.cycle);
        const colApproved  = findColumn(headers, COLUMN_ALIASES.approvedAt);
        const colItems     = findColumn(headers, COLUMN_ALIASES.items);

        if (colOrder < 0) {
          return reject(new Error('Coluna "Pedido" não encontrada na planilha'));
        }

        const orders = [];
        let skipped = 0;

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const rawOrder = String(row[colOrder] ?? '').trim().replace(/\s/g, '');

          if (!/^\d{9}$/.test(rawOrder)) {
            if (rawOrder) skipped++;
            continue;
          }

          const rawItems = colItems >= 0 ? parseInt(row[colItems], 10) : 0;
          const itemCount = isNaN(rawItems) || rawItems < 0 ? 0 : rawItems;

          let approvedAt = null;
          if (colApproved >= 0 && row[colApproved]) {
            const raw = String(row[colApproved]).trim();
            approvedAt = parseBRDate(raw);
          }

          orders.push({
            code: rawOrder,
            cycle: colCycle >= 0 ? String(row[colCycle] ?? '').trim() : '',
            approvedAt,
            items: itemCount,
          });
        }

        resolve({ orders, skipped });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
    reader.readAsArrayBuffer(file);
  });
}

/** Formata date para display */
export function formatDate(date) {
  if (!date) return '—';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
