/**
 * Backfill XP de eventos ONLY_SEPARATION.
 *
 * Bug histórico: ONLY_SEPARATION usava `state.orders.length` como `orders`
 * no cálculo de XP. Para lotes importados de PDF Picking List, `state.orders`
 * é a lista de MATERIAIS — não pedidos. Isso inflava o XP (10 pontos por
 * material a mais).
 *
 * Este script recalcula `xp` para cada evento ONLY_SEPARATION com a fórmula
 * corrigida (orders = 0) e zera `batch.totalOrders` (passa a ser null).
 *
 * Uso:
 *   node backfill-only-separation-xp.mjs              # dry-run (não escreve)
 *   node backfill-only-separation-xp.mjs --apply      # aplica as mudanças
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, query, where, getDocs, doc, getDoc, updateDoc } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAW89CNebm_uGDUACKcfIVn1ETKvZ0p32c",
  authDomain: "stockflow-35240.firebaseapp.com",
  projectId: "stockflow-35240",
  storageBucket: "stockflow-35240.firebasestorage.app",
  messagingSenderId: "775669247759",
  appId: "1:775669247759:web:6517801765f9297bb4d87a"
};

const APPLY = process.argv.includes('--apply');

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

function xpBatch({ orders, items, seconds, config }) {
  const base = config.xpBatchBase;
  const ord  = config.xpPerOrder * orders;
  const itm  = config.xpPerItem  * items;
  const subtotal = base + ord + itm;

  const minutes = seconds / 60;
  const speed   = minutes > 0 ? items / minutes : 0;
  const target  = config.speedTargetItemsPerMin;

  let bonusPct = 0;
  if (target > 0 && speed > 0) {
    if (speed >= target * config.bonusThreshold20) bonusPct = 0.20;
    else if (speed >= target * config.bonusThreshold10) bonusPct = 0.10;
  }

  const bonus = Math.round(subtotal * bonusPct);
  return { subtotal, bonus, total: subtotal + bonus, bonusPct };
}

async function run() {
  console.log(APPLY ? '⚠️  MODO APPLY — vai escrever no Firestore\n' : '🔍 DRY-RUN — nenhuma escrita será feita\n');

  console.log('🔐 Autenticando...');
  await signInWithEmailAndPassword(auth, 'logisticavdpenedo@cpalcina.com', 'prod777');
  console.log('✓ Autenticado\n');

  console.log('⚙️  Lendo config global...');
  const configSnap = await getDoc(doc(db, 'config', 'global'));
  if (!configSnap.exists()) {
    console.error('❌ config/global não existe.');
    process.exit(1);
  }
  const config = configSnap.data();
  console.log(`  base=${config.xpBatchBase} perOrder=${config.xpPerOrder} perItem=${config.xpPerItem} target=${config.speedTargetItemsPerMin}\n`);

  console.log('📥 Buscando eventos ONLY_SEPARATION...');
  const q = query(collection(db, 'events'), where('type', '==', 'ONLY_SEPARATION'));
  const snap = await getDocs(q);
  console.log(`  ${snap.size} eventos encontrados\n`);

  let updated = 0;
  let skipped = 0;
  let totalXpDelta = 0;

  for (const d of snap.docs) {
    const ev = d.data();
    const oldXp = ev.xp || 0;
    const items = ev.batch?.totalItems || 0;
    const seconds = ev.batch?.separationSeconds || 0;

    const result = xpBatch({ orders: 0, items, seconds, config });
    const newXp = result.total;
    const delta = newXp - oldXp;

    if (newXp === oldXp && ev.batch?.totalOrders === null) {
      skipped++;
      continue;
    }

    console.log(`  ${d.id} | lote=${ev.batch?.batchCode || '?'} | stockist=${ev.stockistId} | items=${items} | secs=${seconds}`);
    console.log(`    XP: ${oldXp} → ${newXp} (${delta >= 0 ? '+' : ''}${delta}) | totalOrders: ${ev.batch?.totalOrders ?? 'null'} → null`);

    totalXpDelta += delta;
    updated++;

    if (APPLY) {
      await updateDoc(doc(db, 'events', d.id), {
        xp: newXp,
        'batch.totalOrders': null,
      });
    }
  }

  console.log(`\n📊 Resumo:`);
  console.log(`  Eventos atualizados: ${updated}`);
  console.log(`  Eventos já corretos: ${skipped}`);
  console.log(`  XP total redistribuído: ${totalXpDelta >= 0 ? '+' : ''}${totalXpDelta}`);

  if (!APPLY && updated > 0) {
    console.log(`\n💡 Re-rode com --apply para aplicar as mudanças.`);
  } else if (APPLY) {
    console.log(`\n✓ Mudanças aplicadas.`);
  }

  process.exit(0);
}

run().catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
