/**
 * Seed script Node.js — roda direto no terminal, sem precisar do app no ar.
 * Uso: node seed-node.mjs
 * Requer: npm install firebase (na pasta do projeto)
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, doc, setDoc, collection } from 'firebase/firestore';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';

const firebaseConfig = {
  apiKey: "AIzaSyAW89CNebm_uGDUACKcfIVn1ETKvZ0p32c",
  authDomain: "stockflow-35240.firebaseapp.com",
  projectId: "stockflow-35240",
  storageBucket: "stockflow-35240.firebasestorage.app",
  messagingSenderId: "775669247759",
  appId: "1:775669247759:web:6517801765f9297bb4d87a"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

const UNITS = {
  vd_palmeira: {
    name: 'Vd Palmeira',
    pin: '787865',
    stockists: [
      { id: 'pedro_lucas',   name: 'Pedro Lucas',   active: true },
      { id: 'joao_victor',   name: 'João Victor',   active: true },
      { id: 'roberia_gilo',  name: 'Robéria Gilo',  active: true },
    ],
  },
  vd_penedo: {
    name: 'Vd Penedo',
    pin: '965400',
    stockists: [
      { id: 'danrley',        name: 'Danrley',        active: true },
      { id: 'felipe_guedes',  name: 'Felipe Guedes',  active: true },
      { id: 'paulo_cesar',    name: 'Paulo Cesar',    active: true },
      { id: 'yuri_castro',    name: 'Yuri Castro',    active: true },
      { id: 'luciano_torres', name: 'Luciano Torres', active: true },
      { id: 'claudio',        name: 'Claudio',        active: true },
      { id: 'thalys_gomes',   name: 'Thalys Gomes',  active: true },
    ],
  },
};

const CONFIG_GLOBAL = {
  adminPin:                '777666',
  xpBatchBase:             50,
  xpPerOrder:              10,
  xpPerItem:               2,
  speedTargetItemsPerMin:  5,
  bonusThreshold10:        1.0,
  bonusThreshold20:        1.2,
};

const TASKS = [
  { id: 'limpeza',                name: 'Limpeza',                xpPerUnit: 20, active: true },
  { id: 'recebimento_mercadoria', name: 'Recebimento de mercadoria', xpPerUnit: 20, active: true },
  { id: 'enderecamento_itens',    name: 'Endereçamento de itens',   xpPerUnit: 20, active: true },
  { id: 'reposicao_er',           name: 'Reposição do ER',          xpPerUnit: 20, active: true },
  { id: 'guardar_mercadoria',     name: 'Guardar mercadoria',        xpPerUnit: 20, active: true },
];

async function run() {
  console.log('🔐 Autenticando...');
  await signInWithEmailAndPassword(auth, 'logisticavdpenedo@cpalcina.com', 'prod777');
  console.log('✓ Autenticado\n');

  console.log('📦 Criando unidades e estoquistas...');
  for (const [unitId, data] of Object.entries(UNITS)) {
    await setDoc(doc(db, 'units', unitId), data);
    console.log(`  ✓ ${data.name} — ${data.stockists.length} estoquistas`);
  }

  console.log('\n⚙️  Salvando config global...');
  await setDoc(doc(db, 'config', 'global'), CONFIG_GLOBAL);
  console.log('  ✓ config/global');

  console.log('\n📋 Criando tarefas...');
  for (const task of TASKS) {
    const { id, ...data } = task;
    await setDoc(doc(db, 'config', 'tasks', 'items', id), data);
    console.log(`  ✓ ${task.name}`);
  }

  console.log('\n✅ Seed completo! Firestore populado com sucesso.');
  process.exit(0);
}

run().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
