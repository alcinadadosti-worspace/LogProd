const express = require("express");
const admin = require("firebase-admin");
const { WebClient } = require("@slack/web-api");
const cron = require("node-cron");

// --- Config from environment ---
const PORT = process.env.PORT || 3000;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const STOCKIST_SLACK_MAP = JSON.parse(process.env.STOCKIST_SLACK_MAP || "{}");
const TEST_SLACK_ID = process.env.TEST_SLACK_ID || "";
const API_SECRET = process.env.API_SECRET || "";
const TIMEZONE_OFFSET = parseInt(process.env.TIMEZONE_OFFSET || "-3", 10);

// --- Init Firebase Admin ---
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  private_key: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
};
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// --- Init Slack ---
const slack = new WebClient(SLACK_BOT_TOKEN);

// --- Helpers ---

function dayRange(daysAgo = 0) {
  const now = new Date();
  const utcHour = now.getUTCHours();
  const localHour = utcHour + TIMEZONE_OFFSET;

  const start = new Date(now);
  start.setUTCHours(-TIMEZONE_OFFSET, 0, 0, 0);
  if (localHour < 0) start.setUTCDate(start.getUTCDate() - 1);
  start.setUTCDate(start.getUTCDate() - daysAgo);

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);

  return { start, end };
}

function formatDuration(totalSecs) {
  if (!totalSecs || totalSecs <= 0) return "0min";
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  if (h > 0) return `${h}h${m > 0 ? m.toString().padStart(2, "0") + "min" : ""}`;
  return `${m}min`;
}

function formatDate(d) {
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const year = d.getUTCFullYear();
  return `${day}/${month}/${year}`;
}

// --- Core: aggregate events per stockist ---

function aggregateEvents(events) {
  const map = {};
  for (const ev of events) {
    if (!map[ev.stockistId]) {
      map[ev.stockistId] = {
        stockistId: ev.stockistId,
        xp: 0,
        events: 0,
        items: 0,
        orders: 0,
        batches: 0,
        boxes: 0,
        totalSecs: 0,
        tasks: [],
        batchTypes: { BATCH: 0, ONLY_SEPARATION: 0, ONLY_BIPPING: 0 },
        singleOrders: 0,
      };
    }
    const s = map[ev.stockistId];
    s.xp += ev.xp || 0;
    s.events++;

    const b = ev.batch;
    if (b && ["BATCH", "ONLY_SEPARATION", "ONLY_BIPPING"].includes(ev.type)) {
      s.batches++;
      s.batchTypes[ev.type]++;
      s.orders += b.totalOrders || 0;
      s.totalSecs += (b.separationSeconds || 0) + (b.bippingSeconds || 0);
      if (ev.type === "BATCH" || ev.type === "ONLY_BIPPING") {
        s.items += b.totalItems || 0;
        s.boxes += Object.keys(b.boxCodes || {}).length;
      }
      if (ev.type === "ONLY_SEPARATION") {
        s.items += b.totalItems || 0;
      }
    }
    if (ev.type === "SINGLE_ORDER") {
      const so = ev.singleOrder || ev.batch || {};
      s.singleOrders++;
      s.orders++;
      s.items += so.items || so.totalItems || 1;
      s.totalSecs += (so.separationSeconds || 0) + (so.bippingSeconds || 0);
      if (so.boxCode) s.boxes++;
    }
    if (ev.type === "TASK") {
      const t = ev.task || {};
      s.tasks.push(`${t.taskName || t.taskId} (x${t.quantity || 1})`);
    }
  }
  return map;
}

function aggregatePauses(pauseEvents) {
  const map = {};
  for (const p of pauseEvents) {
    if (!map[p.stockistId]) {
      map[p.stockistId] = { count: 0, totalSecs: 0, reasons: [] };
    }
    const s = map[p.stockistId];
    s.count++;
    s.totalSecs += p.durationSeconds || 0;
    if (p.reason && !s.reasons.includes(p.reason)) s.reasons.push(p.reason);
  }
  return map;
}

// --- Build Slack message blocks ---

function buildMessage(stockistName, stats, pauseInfo, unitName, dateStr) {
  const speed =
    stats.totalSecs > 0
      ? ((stats.items / (stats.totalSecs / 60)) || 0).toFixed(1)
      : "0.0";

  const lines = [
    `*${stockistName}* - resumo do dia *${dateStr}*`,
    `_${unitName}_`,
    "",
    `:package: *Lotes:* ${stats.batches}`,
  ];

  if (stats.batchTypes.BATCH > 0)
    lines.push(`    Completos (separacao + bipagem): ${stats.batchTypes.BATCH}`);
  if (stats.batchTypes.ONLY_SEPARATION > 0)
    lines.push(`    So separacao: ${stats.batchTypes.ONLY_SEPARATION}`);
  if (stats.batchTypes.ONLY_BIPPING > 0)
    lines.push(`    So bipagem: ${stats.batchTypes.ONLY_BIPPING}`);
  if (stats.singleOrders > 0)
    lines.push(`:memo: *Pedidos avulsos:* ${stats.singleOrders}`);

  lines.push(`:clipboard: *Pedidos:* ${stats.orders}`);
  lines.push(`:mag: *Itens:* ${stats.items}`);
  lines.push(`:inbox_tray: *Caixas:* ${stats.boxes}`);
  lines.push(`:zap: *Velocidade:* ${speed} itens/min`);
  lines.push(`:star: *XP:* ${stats.xp}`);
  lines.push(`:clock3: *Tempo ativo:* ${formatDuration(stats.totalSecs)}`);

  if (pauseInfo) {
    lines.push(
      `:coffee: *Pausas:* ${pauseInfo.count} (${formatDuration(pauseInfo.totalSecs)})`
    );
    if (pauseInfo.reasons.length > 0)
      lines.push(`    Motivos: ${pauseInfo.reasons.join(", ")}`);
  } else {
    lines.push(`:coffee: *Pausas:* nenhuma`);
  }

  if (stats.tasks.length > 0) {
    lines.push(`:hammer_and_wrench: *Tarefas:* ${stats.tasks.join(", ")}`);
  }

  return lines.join("\n");
}

function buildNoActivityMessage(stockistName, dateStr) {
  return `:zzz: *${stockistName}* - sem atividade registrada em *${dateStr}*.`;
}

// --- Main summary logic ---

async function sendDailySummary(daysAgo = 0) {
  const { start, end } = dayRange(daysAgo);
  const dateStr = formatDate(start);

  const eventsSnap = await db
    .collection("events")
    .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(start))
    .where("createdAt", "<", admin.firestore.Timestamp.fromDate(end))
    .orderBy("createdAt", "desc")
    .limit(1000)
    .get();

  const events = eventsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const pauseSnap = await db
    .collection("pause_events")
    .where("createdAt", ">=", admin.firestore.Timestamp.fromDate(start))
    .where("createdAt", "<", admin.firestore.Timestamp.fromDate(end))
    .limit(500)
    .get();
  const pauseEvents = pauseSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const unitsSnap = await db.collection("units").get();
  const units = {};
  const stockistNames = {};
  for (const doc of unitsSnap.docs) {
    const data = doc.data();
    units[doc.id] = data.name || doc.id;
    for (const s of data.stockists || []) {
      stockistNames[s.id] = { name: s.name, unitId: doc.id, unitName: data.name };
    }
  }

  const statsMap = aggregateEvents(events);
  const pauseMap = aggregatePauses(pauseEvents);

  const results = [];

  for (const [stockistId, slackId] of Object.entries(STOCKIST_SLACK_MAP)) {
    const targetSlackId = TEST_SLACK_ID || slackId;
    const info = stockistNames[stockistId] || {
      name: stockistId,
      unitName: "—",
    };
    const stats = statsMap[stockistId];
    const pauseInfo = pauseMap[stockistId];

    let text;
    if (!stats || stats.events === 0) {
      text = buildNoActivityMessage(info.name, dateStr);
    } else {
      text = buildMessage(info.name, stats, pauseInfo, info.unitName, dateStr);
    }

    try {
      await slack.chat.postMessage({ channel: targetSlackId, text, mrkdwn: true });
      results.push({ stockistId, slackId: targetSlackId, status: "ok" });
    } catch (err) {
      console.error(`Falha ao enviar DM para ${stockistId}:`, err.message);
      results.push({ stockistId, slackId: targetSlackId, status: "error", error: err.message });
    }
  }

  return { date: dateStr, sent: results.length, results };
}

// --- Express server ---

const app = express();

app.get("/", (_req, res) => {
  res.json({ status: "ok", service: "stockflow-slack-bot" });
});

app.get("/send-summary", async (req, res) => {
  if (API_SECRET && req.query.secret !== API_SECRET) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const daysAgo = parseInt(req.query.daysAgo || "0", 10);
    const result = await sendDailySummary(daysAgo);
    console.log(`Resumo enviado: ${result.sent} mensagens em ${result.date}`);
    res.json(result);
  } catch (err) {
    console.error("Erro ao enviar resumo:", err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// --- Cron: 8:30 Alagoas (UTC-3) = 11:30 UTC, resumo do dia anterior ---
cron.schedule("30 11 * * *", async () => {
  console.log("Cron disparado: enviando resumo do dia anterior...");
  try {
    const result = await sendDailySummary(1);
    console.log(`Cron OK: ${result.sent} mensagens em ${result.date}`);
  } catch (err) {
    console.error("Cron ERRO:", err);
  }
});

app.listen(PORT, () => {
  console.log(`StockFlow Slack Bot rodando na porta ${PORT}`);
  console.log("Cron agendado: resumo diario as 08:30 (America/Maceio)");
});
