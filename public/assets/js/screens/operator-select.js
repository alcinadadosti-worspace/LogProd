import { getUnit } from '../services/firestore.js';

/**
 * Renders an operator selection modal over the current page.
 * Returns a Promise<stockistId | null>.
 */
export function selectOperator(unitId) {
  return new Promise(async (resolve) => {
    let unit;
    try { unit = await getUnit(unitId); } catch {}

    const stockists = (unit?.stockists || []).filter(s => s.active !== false);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal cyber-chamfer fade-in">
        <div class="modal-header">
          <div class="modal-title">QUEM ESTÁ OPERANDO?</div>
          <button class="modal-close" id="op-close">✕</button>
        </div>
        <div class="modal-body">
          <p class="text-muted text-xs mb-2" style="letter-spacing:0.15em;">
            SELECIONE O ESTOQUISTA RESPONSÁVEL POR ESTA OPERAÇÃO
          </p>
          <div class="operator-grid" id="op-grid">
            ${stockists.length === 0
              ? '<div class="text-muted text-sm">Nenhum estoquista ativo nesta unidade.</div>'
              : stockists.map(s => `
                  <button class="operator-btn cyber-chamfer-sm" data-id="${s.id}" data-name="${s.name}">
                    ${s.name}
                  </button>
                `).join('')
            }
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.querySelector('#op-close').addEventListener('click', () => {
      overlay.remove();
      resolve(null);
    });

    overlay.querySelector('#op-grid')?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-id]');
      if (!btn) return;
      overlay.remove();
      resolve({ id: btn.dataset.id, name: btn.dataset.name });
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); resolve(null); }
    });
  });
}
