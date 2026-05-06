import { loginWithEmail } from '../auth.js';
import { navigate } from '../router.js';
import { playSenhaIncorreta } from '../services/sound-engine.js';

export async function renderLogin(container) {
  container.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:1rem;">
      <div style="width:100%;max-width:440px;">
        <div class="card card--terminal cyber-chamfer fade-in" style="padding:2rem;">
          <div class="terminal-dots">
            <div class="terminal-dot terminal-dot--red"></div>
            <div class="terminal-dot terminal-dot--yellow"></div>
            <div class="terminal-dot terminal-dot--green"></div>
          </div>

          <h1 class="glitch text-center mb-3" data-text="ACESSO RESTRITO"
              style="font-size:1.2rem;letter-spacing:0.2em;color:var(--accent);margin-bottom:2rem;">
            ACESSO RESTRITO
          </h1>

          <form id="login-form" style="display:flex;flex-direction:column;gap:1.25rem;">
            <div class="input-group">
              <label class="input-label">EMAIL DO OPERADOR</label>
              <div class="input-wrapper">
                <span class="input-prefix">&gt;</span>
                <input
                  id="login-email"
                  class="input"
                  type="email"
                  placeholder="usuario@cpalcina.com"
                  autocomplete="username"
                  required
                />
              </div>
              <div class="input-error-msg" id="email-err"></div>
            </div>

            <div class="input-group">
              <label class="input-label">SENHA</label>
              <div class="input-wrapper">
                <span class="input-prefix">&gt;</span>
                <input
                  id="login-password"
                  class="input"
                  type="password"
                  placeholder="••••••••"
                  autocomplete="current-password"
                  required
                />
              </div>
              <div class="input-error-msg" id="pass-err"></div>
            </div>

            <div class="input-error-msg text-center" id="login-err" style="font-size:0.75rem;min-height:1.2rem;"></div>

            <button type="submit" class="btn btn--lg btn--full cyber-chamfer" id="login-btn">
              <span id="login-btn-text">AUTENTICAR</span>
            </button>
          </form>

          <div class="text-center mt-3 text-xs text-muted cursor">
            LOGISTICA // PROD.OPS · O BOTICÁRIO
          </div>
        </div>
      </div>
    </div>
  `;

  const form     = container.querySelector('#login-form');
  const emailEl  = container.querySelector('#login-email');
  const passEl   = container.querySelector('#login-password');
  const loginErr = container.querySelector('#login-err');
  const loginBtn = container.querySelector('#login-btn');
  const btnText  = container.querySelector('#login-btn-text');

  function setLoading(on) {
    loginBtn.disabled = on;
    btnText.textContent = on ? 'AUTENTICANDO...' : 'AUTENTICAR';
  }

  function showError(msg) {
    loginErr.textContent = msg;
    loginErr.classList.add('rgb-shift');
    setTimeout(() => loginErr.classList.remove('rgb-shift'), 1500);
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailEl.value.trim();
    const pass  = passEl.value;

    if (!email || !pass) {
      showError('> PREENCHA TODOS OS CAMPOS');
      return;
    }

    setLoading(true);
    try {
      await loginWithEmail(email, pass);
      navigate('/pin');
    } catch (err) {
      const map = {
        'auth/user-not-found':  '> USUÁRIO NÃO ENCONTRADO',
        'auth/wrong-password':  '> SENHA INCORRETA',
        'auth/invalid-email':   '> EMAIL INVÁLIDO',
        'auth/too-many-requests': '> MUITAS TENTATIVAS — TENTE MAIS TARDE',
        'auth/invalid-credential': '> CREDENCIAIS INVÁLIDAS',
      };
      showError(map[err.code] || '> FALHA NA AUTENTICAÇÃO');
      playSenhaIncorreta();
    } finally {
      setLoading(false);
    }
  });

  emailEl.focus();
}
