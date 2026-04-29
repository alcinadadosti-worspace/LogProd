# ALCINA // PROD.OPS

Sistema de produtividade para estoquistas — Grupo Alcina Maria (O Boticário, Alagoas).

Unidades: **Vd Penedo** e **Vd Palmeira**.

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) 18+
- [Firebase CLI](https://firebase.google.com/docs/cli): `npm install -g firebase-tools`

---

## Setup do Projeto Firebase

1. Acesse [console.firebase.google.com](https://console.firebase.google.com) e crie um projeto.
2. Ative **Authentication → Sign-in method → Email/Password**.
3. Crie o usuário de login:
   - Email: `logisticavdpenedo@cpalcina.com`
   - Senha: `prod777`
4. Crie o **Firestore Database** em modo produção (região `southamerica-east1`).
5. No Project Settings → General → Your apps → Web app, copie o `firebaseConfig`.
6. Cole os valores em `public/assets/js/firebase-config.js`.

---

## Rodar localmente

```bash
firebase login
firebase use --add   # selecione seu projeto
firebase emulators:start
```

Acesse: `http://localhost:5000`

---

## Deploy

```bash
firebase deploy
```

Ou separado:
```bash
firebase deploy --only hosting
firebase deploy --only firestore
```

---

## Seed inicial (popular dados)

Execute **uma única vez** após o primeiro deploy:

1. Faça login no app com `logisticavdpenedo@cpalcina.com` / `prod777`.
2. Insira o PIN admin `777666`.
3. Abra o DevTools Console (F12).
4. Execute:

```js
const { runSeed } = await import('/assets/js/bootstrap-seed.js');
await runSeed();
```

Isso cria:
- `units/vd_penedo` com os 7 estoquistas.
- `units/vd_palmeira` com os 4 estoquistas.
- `config/global` com os parâmetros de XP.
- `config/tasks/items/*` com as 5 tarefas padrão.

---

## PINs de acesso

| PIN    | Escopo         |
|--------|----------------|
| 787865 | Vd Palmeira    |
| 965400 | Vd Penedo      |
| 777666 | Admin (ambas)  |

---

## Fórmula de XP — Lote/Pedido

```
subtotal = xpBatchBase + (xpPerOrder × pedidos) + (xpPerItem × itens)
velocidade = itens / (segundos / 60)  [itens/min]
bônus = 0% | +10% | +20%  (conforme meta de velocidade)
xp_total = subtotal + round(subtotal × bonusPct)
```

**Exemplo validado:** 20 pedidos, 80 itens, 600s → 410 + 82 = **492 XP** ✓

---

## Débitos Técnicos

> Documentados conforme prometido no escopo.

1. **PIN client-side:** A validação dos PINs de unidade e admin é feita no navegador. Um usuário autenticado mal-intencionado poderia inspecionar o código e contornar a restrição. **Solução:** Implementar Cloud Function que recebe o PIN, valida server-side e emite um Custom Claim Firebase para controle real via regras Firestore.

2. **Regras Firestore abertas a autenticados:** Qualquer usuário autenticado pode escrever em `config` e `units`. **Solução:** Após implementar Custom Claims, restringir `allow write` a `request.auth.token.admin == true`.

3. **Ausência de paginação nos eventos:** A query de eventos carrega até 500/1000 documentos de uma vez. Para volumes maiores, implementar paginação com `startAfter()`.

4. **Sem testes automatizados:** Adicionar testes unitários para `xp-engine.js` e `spreadsheet-parser.js` com Jest ou Vitest.

---

## Estrutura de Arquivos

```
/public
  index.html
  /assets
    /css
      tokens.css         — design tokens (cores, tipografia, sombras)
      base.css           — reset, scanlines, grid de fundo
      components.css     — botões, cards, inputs, modais
      animations.css     — glitch, blink, chromatic aberration
    /js
      main.js            — entry point, router boot
      firebase-config.js — configuração Firebase (EDITAR)
      auth.js            — login, PIN, sessão
      router.js          — hash router
      bootstrap-seed.js  — seed inicial (executar uma vez)
      /screens           — cada tela da SPA
      /services          — firestore.js, xp-engine.js, spreadsheet-parser.js
      /components        — chronometer.js
firebase.json
firestore.rules
firestore.indexes.json
```
