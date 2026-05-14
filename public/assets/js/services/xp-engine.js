export function xpTask({ xpPerUnit, quantity }) {
  return xpPerUnit * quantity;
}

/**
 * Calcula XP para lote (BATCH, ONLY_SEPARATION, ONLY_BIPPING, SINGLE_ORDER).
 * seconds = tempo de separação (+ bipagem se BATCH/SINGLE_ORDER completo).
 */
export function xpBatch({ orders, items, seconds, config }) {
  const base   = config.xpBatchBase;
  const ord    = config.xpPerOrder * orders;
  const itm    = config.xpPerItem  * items;
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
  return { subtotal, bonus, total: subtotal + bonus, speed, bonusPct };
}

/**
 * XP para fluxos que SÓ fazem bipagem (lote bipado por outro estoquista,
 * ou pedido avulso já separado). A velocidade aqui é caixas/min porque
 * a operação é lacrar caixas — não toca nos itens. items/orders ainda
 * entram no XP base, mas o bônus de velocidade compara caixas com
 * config.speedTargetBoxesPerMin (default ~ itemsTarget/5 se ausente).
 */
export function xpBippingOnly({ orders, items, boxes, seconds, config }) {
  const base = config.xpBatchBase;
  const ord  = config.xpPerOrder * orders;
  const itm  = config.xpPerItem  * items;
  const subtotal = base + ord + itm;

  const minutes = seconds / 60;
  const speed   = minutes > 0 ? boxes / minutes : 0;
  const target  = config.speedTargetBoxesPerMin > 0
    ? config.speedTargetBoxesPerMin
    : Math.max(0.5, (config.speedTargetItemsPerMin || 5) / 5);

  let bonusPct = 0;
  if (target > 0 && speed > 0) {
    if (speed >= target * config.bonusThreshold20) bonusPct = 0.20;
    else if (speed >= target * config.bonusThreshold10) bonusPct = 0.10;
  }

  const bonus = Math.round(subtotal * bonusPct);
  return { subtotal, bonus, total: subtotal + bonus, speed, bonusPct, unit: 'caixas/min' };
}

/** Formata velocidade para exibição */
export function formatSpeed(speed, unit = 'itens/min') {
  return speed.toFixed(1) + ' ' + unit;
}

/** Formata bônus para exibição */
export function formatBonus(bonusPct) {
  if (bonusPct === 0) return 'Sem bônus';
  return '+' + (bonusPct * 100).toFixed(0) + '% velocidade';
}
