import { validatePin, getCurrentUser } from '../auth.js';
import { navigate } from '../router.js';
import { playError } from '../services/sound-engine.js';

export async function renderUnitPin(container) {
  if (!getCurrentUser()) { navigate('/login'); return; }

  let pinValue = '';

  container.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem;">
      <div style="width:100%;max-width:400px;">
        <div class="card card--terminal cyber-chamfer fade-in" style="padding:2rem;">
          <div class="terminal-dots">
            <div class="terminal-dot terminal-dot--red"></div>
            <div class="terminal-dot terminal-dot--yellow"></div>
            <div class="terminal-dot terminal-dot--green"></div>
          </div>

          <h2 style="font-family:var(--font-display);font-size:0.85rem;letter-spacing:0.25em;
                     color:var(--accent-3);text-align:center;margin-bottom:0.5rem;text-shadow:var(--neon-3);">
            VERIFICAÇÃO DE UNIDADE
          </h2>
          <p class="text-muted text-xs text-center mb-3" style="letter-spacing:0.15em;">
            INSIRA O PIN DE 6 DÍGITOS DA UNIDADE
          </p>

          <div class="pin-display" id="pin-display">
            ${Array(6).fill('<div class="pin-dot cyber-chamfer-sm"></div>').join('')}
          </div>

          <!-- Numpad -->
          <div id="numpad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin-top:1.5rem;">
            ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => `
              <button class="btn cyber-chamfer-sm ${k==='' ? 'btn--ghost' : ''}"
                      data-key="${k}"
                      ${k === '' ? 'disabled style="visibility:hidden"' : ''}>
                ${k}
              </button>
            `).join('')}
          </div>

          <div id="pin-err" class="input-error-msg text-center mt-2" style="font-size:0.8rem;min-height:1.5rem;letter-spacing:0.2em;"></div>

          <button id="pin-submit" class="btn btn--full cyber-chamfer mt-3" disabled>
            CONFIRMAR PIN
          </button>
        </div>
      </div>
    </div>
  `;

  const dots    = container.querySelectorAll('.pin-dot');
  const errEl   = container.querySelector('#pin-err');
  const submitBtn = container.querySelector('#pin-submit');
  const numpad  = container.querySelector('#numpad');

  function updateDisplay() {
    dots.forEach((d, i) => d.classList.toggle('filled', i < pinValue.length));
    submitBtn.disabled = pinValue.length < 6;
    errEl.textContent = '';
  }

  function handleKey(k) {
    if (k === '⌫') {
      pinValue = pinValue.slice(0, -1);
    } else if (/^\d$/.test(k) && pinValue.length < 6) {
      pinValue += k;
    }
    updateDisplay();
  }

  numpad.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-key]');
    if (!btn) return;
    const k = btn.dataset.key;
    if (k !== '') handleKey(k);
  });

  document.addEventListener('keydown', onKeyDown);
  function onKeyDown(e) {
    if (/^\d$/.test(e.key)) handleKey(e.key);
    if (e.key === 'Backspace') handleKey('⌫');
    if (e.key === 'Enter' && pinValue.length === 6) doSubmit();
  }

  async function doSubmit() {
    if (pinValue.length < 6) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'VERIFICANDO...';

    try {
      const ctx = await validatePin(pinValue);
      if (!ctx) {
        errEl.textContent = '⚠ ACESSO NEGADO';
        playError();
        errEl.classList.add('rgb-shift');
        setTimeout(() => errEl.classList.remove('rgb-shift'), 1500);
        pinValue = '';
        updateDisplay();
        submitBtn.textContent = 'CONFIRMAR PIN';
        submitBtn.disabled = false;
        return;
      }
      navigate('/dashboard');
    } catch (err) {
      errEl.textContent = '> ERRO DE VERIFICAÇÃO';
      submitBtn.textContent = 'CONFIRMAR PIN';
      submitBtn.disabled = false;
    }
  }

  submitBtn.addEventListener('click', doSubmit);

  return () => document.removeEventListener('keydown', onKeyDown);
}
