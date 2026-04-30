/** Normaliza nome de coluna: minusculas, sem acentos, sem espacos extras */
function normalizeKey(str) {
  return String(str ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
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

/** Parse DD/MM/YYYY, DD/MM/YYYY HH:mm or DD/MM/YYYY HH:mm:ss */
function parseBRDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, d, mo, y, h = '00', mi = '00', se = '00'] = m;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${se}`);
}

function isPdfFile(file) {
  return file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
}

async function loadPdfJs() {
  if (window.pdfjsLib) return window.pdfjsLib;

  try {
    const pdfjs = await import('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs');
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
    }
    return pdfjs;
  } catch {
    throw new Error('Nao foi possivel carregar o leitor de PDF. Verifique a conexao e tente novamente.');
  }
}

function normalizeSearch(str) {
  return String(str ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function groupTextItemsIntoLines(items) {
  const words = items
    .filter(item => String(item.str || '').trim())
    .map(item => ({
      text: String(item.str).trim(),
      x: item.transform?.[4] ?? 0,
      y: item.transform?.[5] ?? 0,
    }))
    .sort((a, b) => Math.abs(b.y - a.y) > 2 ? b.y - a.y : a.x - b.x);

  const grouped = [];
  for (const word of words) {
    const line = grouped.find(l => Math.abs(l.y - word.y) <= 2);
    if (line) {
      line.words.push(word);
      line.y = (line.y + word.y) / 2;
    } else {
      grouped.push({ y: word.y, words: [word] });
    }
  }

  return grouped
    .sort((a, b) => b.y - a.y)
    .map(line => line.words
      .sort((a, b) => a.x - b.x)
      .map(word => word.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim())
    .filter(Boolean);
}

function parsePdfHeader(lines) {
  let batchCode = '';
  let orderCode = '';
  let separationBatchCode = '';
  let exportedDate = '';
  let exportedTime = '';
  let orderDate = '';
  let cycle = '';
  let declaredItems = null;
  let pdfType = 'batch';

  for (const line of lines) {
    const normalized = normalizeSearch(line);
    const batchMatch = normalized.match(/(?:numero|n.mero|nmero) do lote:\s*(\d+)/);
    const orderMatch = normalized.match(/(?:numero|n.mero|nmero) do pedido:\s*(\d+)/);
    const separationBatchMatch = normalized.match(/(?:numero|n.mero|nmero) do lote de separa.*?:\s*(\d+)/);
    const dateMatch = normalized.match(/data:\s*(\d{2}\/\d{2}\/\d{4})/);
    const timeMatch = normalized.match(/hora:\s*(\d{2}:\d{2})/);
    const orderDateMatch = normalized.match(/data do pedido:\s*(\d{2}\/\d{2}\/\d{4})/);
    const cycleMatch = normalized.match(/ciclo:\s*([^\s]+)\b/);
    const declaredItemsMatch = normalized.match(/quantidade de itens:\s*(\d+)/);

    if (batchMatch) batchCode = batchMatch[1];
    if (orderMatch) {
      orderCode = orderMatch[1];
      pdfType = 'single-order';
    }
    if (separationBatchMatch) separationBatchCode = separationBatchMatch[1];
    if (dateMatch) exportedDate = dateMatch[1];
    if (timeMatch) exportedTime = timeMatch[1];
    if (orderDateMatch) orderDate = orderDateMatch[1];
    if (cycleMatch) cycle = cycleMatch[1];
    if (declaredItemsMatch) declaredItems = parseInt(declaredItemsMatch[1], 10);
  }

  const exportedAt = parseBRDate(`${exportedDate}${exportedTime ? ` ${exportedTime}` : ''}`);
  return { pdfType, batchCode, orderCode, separationBatchCode, exportedDate, exportedTime, exportedAt, orderDate, cycle, declaredItems };
}

function parsePickingListLines(lines) {
  const header = parsePdfHeader(lines);
  const items = [];
  const sectionTotals = { addressed: null, unaddressed: null };
  let section = null;
  let skipped = 0;

  for (const line of lines) {
    const normalized = normalizeSearch(line);
    if (!normalized) continue;
    if (normalized.startsWith('sugestao')) {
      section = null;
      continue;
    }

    if (
      normalized.startsWith('materiais nao enderecados') ||
      /^materiais n.?o enderecados/.test(normalized) ||
      (normalized.startsWith('materiais n') && normalized.includes('endere'))
    ) {
      section = 'unaddressed';
      continue;
    }
    if (normalized === 'materiais') {
      section = 'addressed';
      continue;
    }
    if (!section || normalized.startsWith('estacao / rack / coluna / linha')) {
      continue;
    }

    const totalMatch = normalized.match(/^total\s+(\d+)/);
    if (totalMatch) {
      sectionTotals[section] = parseInt(totalMatch[1], 10);
      section = null;
      continue;
    }

    let match;
    if (section === 'addressed') {
      match = line.match(/^(.+?)\s+(\d+)\s+(\d{4,})\s+(.+)$/);
      if (match) {
        items.push({
          address: match[1].trim(),
          quantity: parseInt(match[2], 10),
          material: match[3].trim(),
          description: match[4].trim(),
          addressed: true,
        });
        continue;
      }
    } else {
      match = line.match(/^(\d+)\s+(\d{4,})\s+(.+)$/);
      if (match) {
        items.push({
          address: '',
          quantity: parseInt(match[1], 10),
          material: match[2].trim(),
          description: match[3].trim(),
          addressed: false,
        });
        continue;
      }
    }

    if (section && items.length > 0) {
      items[items.length - 1].description = `${items[items.length - 1].description} ${line.trim()}`.trim();
      continue;
    }

    skipped++;
  }

  if (header.pdfType === 'batch' && !header.batchCode) {
    throw new Error('Numero do lote nao encontrado no PDF');
  }
  if (header.pdfType === 'single-order' && !header.orderCode) {
    throw new Error('Numero do pedido nao encontrado no PDF');
  }
  if (items.length === 0) {
    throw new Error('Nenhum material encontrado no PDF');
  }

  const summedItems = items.reduce((sum, item) => sum + item.quantity, 0);
  const sectionTotalSum = Object.values(sectionTotals)
    .filter(v => Number.isFinite(v))
    .reduce((sum, value) => sum + value, 0);
  const totalItems = header.declaredItems || sectionTotalSum || summedItems;
  const unaddressedItems = items
    .filter(item => !item.addressed)
    .reduce((sum, item) => sum + item.quantity, 0);

  const orders = items.map(item => ({
    code: item.material,
    cycle: item.address || 'SEM ENDERECO',
    approvedAt: header.exportedAt,
    items: item.quantity,
    sourceType: 'pdf',
    material: item.material,
    sku: item.material,
    description: item.description,
    address: item.address,
    addressed: item.addressed,
  }));

  return {
    orders,
    skipped,
    sourceType: 'pdf',
    pdfType: header.pdfType,
    batchCode: header.batchCode,
    orderCode: header.orderCode,
    separationBatchCode: header.separationBatchCode,
    exportedDate: header.exportedDate,
    exportedTime: header.exportedTime,
    exportedAt: header.exportedAt,
    orderDate: header.orderDate,
    cycle: header.cycle,
    declaredItems: header.declaredItems,
    items,
    totalItems,
    unaddressedItems,
    unaddressedRows: items.filter(item => !item.addressed).length,
    sectionTotals,
  };
}

async function parsePickingListPdf(file) {
  const pdfjs = await loadPdfJs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const lines = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const text = await page.getTextContent();
    lines.push(...groupTextItemsIntoLines(text.items));
  }

  return parsePickingListLines(lines);
}

/**
 * Parses an XLSX/XLS/CSV/PDF file (File object).
 * Returns { orders: [...], skipped: number } and PDF metadata when available.
 */
export async function parseSpreadsheet(file) {
  if (isPdfFile(file)) {
    return parsePickingListPdf(file);
  }

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
          return reject(new Error('Coluna "Pedido" nao encontrada na planilha'));
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
            sourceType: 'spreadsheet',
          });
        }

        resolve({ orders, skipped, sourceType: 'spreadsheet' });
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
  if (!date) return '-';
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
