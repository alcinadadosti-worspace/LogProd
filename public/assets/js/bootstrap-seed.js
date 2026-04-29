/**
 * Bootstrap Seed Script — Execute UMA VEZ pelo admin.
 * Popula units/vd_penedo, units/vd_palmeira e config/* no Firestore.
 *
 * Como usar:
 * 1. Abra o app em modo ADMIN (PIN 777666).
 * 2. Abra o DevTools Console (F12).
 * 3. Cole ou importe este script e chame: await runSeed()
 * 4. Verifique o Firestore Console para confirmar os dados.
 */

import { db } from './firebase-config.js';
import { doc, setDoc, collection } from 'https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js';

const SEED_STOCKISTS = {
  vd_palmeira: [
    { id: 'hugo_castro',  name: 'Hugo Castro',  active: true },
    { id: 'pedro_lucas',  name: 'Pedro Lucas',  active: true },
    { id: 'joao_victor',  name: 'João Victor',  active: true },
    { id: 'roberia_gilo', name: 'Robéria Gilo', active: true },
  ],
  vd_penedo: [
    { id: 'danrley',       name: 'Danrley',       active: true },
    { id: 'felipe_guedes', name: 'Felipe Guedes', active: true },
    { id: 'paulo_cesar',   name: 'Paulo Cesar',   active: true },
    { id: 'yuri_castro',   name: 'Yuri Castro',   active: true },
    { id: 'luciano_torres',name: 'Luciano Torres',active: true },
    { id: 'claudio',       name: 'Claudio',       active: true },
    { id: 'thalys_gomes',  name: 'Thalys Gomes',  active: true },
  ],
};

const SEED_UNITS = {
  vd_palmeira: { name: 'Vd Palmeira', pin: '787865' },
  vd_penedo:   { name: 'Vd Penedo',   pin: '965400' },
};

const SEED_CONFIG_GLOBAL = {
  adminPin:                '777666',
  xpBatchBase:             50,
  xpPerOrder:              10,
  xpPerItem:               2,
  speedTargetItemsPerMin:  5,
  bonusThreshold10:        1.0,
  bonusThreshold20:        1.2,
};

const SEED_TASKS = [
  { id: 'limpeza',               name: 'Limpeza',               xpPerUnit: 20, active: true },
  { id: 'recebimento_mercadoria',name: 'Recebimento de mercadoria', xpPerUnit: 20, active: true },
  { id: 'enderecamento_itens',   name: 'Endereçamento de itens',   xpPerUnit: 20, active: true },
  { id: 'reposicao_er',          name: 'Reposição do ER',          xpPerUnit: 20, active: true },
  { id: 'guardar_mercadoria',    name: 'Guardar mercadoria',        xpPerUnit: 20, active: true },
];

export async function runSeed() {
  console.log('[SEED] Iniciando bootstrap...');

  // Units
  for (const [unitId, data] of Object.entries(SEED_UNITS)) {
    await setDoc(doc(db, 'units', unitId), {
      ...data,
      stockists: SEED_STOCKISTS[unitId],
    });
    console.log('[SEED] Unit:', unitId);
  }

  // Global config
  await setDoc(doc(db, 'config', 'global'), SEED_CONFIG_GLOBAL);
  console.log('[SEED] Config global salva.');

  // Tasks
  for (const task of SEED_TASKS) {
    const { id, ...data } = task;
    await setDoc(doc(db, 'config', 'tasks', 'items', id), data);
    console.log('[SEED] Tarefa:', id);
  }

  console.log('[SEED] ✅ Bootstrap completo! Verifique o Firestore Console.');
}

// Auto-run if script is loaded directly (não em módulo)
if (typeof window !== 'undefined') {
  window.runSeed = runSeed;
  console.log('[SEED] Função disponível: execute window.runSeed() no console.');
}
