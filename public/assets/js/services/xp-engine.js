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

/** Formata velocidade para exibição */
export function formatSpeed(speed) {
  return speed.toFixed(1) + ' itens/min';
}

/** Formata bônus para exibição */
export function formatBonus(bonusPct) {
  if (bonusPct === 0) return 'Sem bônus';
  return '+' + (bonusPct * 100).toFixed(0) + '% velocidade';
}
