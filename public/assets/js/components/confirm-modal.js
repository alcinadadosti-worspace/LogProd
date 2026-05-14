/**
 * Confirmation modal styled with the app's cyberpunk theme.
 * Returns a Promise<boolean> — true if confirmed, false if cancelled.
 */
export function confirmModal({
  title = "CONFIRMAR",
  message = "",
  confirmText = "CONFIRMAR",
  cancelText = "CANCELAR",
  accent = "amber",
} = {}) {
  const accentColors = {
    amber: { bg: "#d97706", hover: "#b45309", border: "#d97706" },
    green: { bg: "#059669", hover: "#047857", border: "#059669" },
    red: { bg: "#dc2626", hover: "#b91c1c", border: "#dc2626" },
  };
  const c = accentColors[accent] || accentColors.amber;

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal cyber-chamfer fade-in" style="max-width:440px;border-color:${c.border};">
        <div class="modal-header" style="border-bottom-color:${c.border};">
          <div class="modal-title" style="color:${c.bg};">⏸ ${escapeHtml(title)}</div>
        </div>
        <div class="modal-body">
          <p style="font-family:var(--font-terminal);font-size:0.78rem;line-height:1.5;margin:0 0 1.25rem;color:var(--fg);letter-spacing:0.02em;">${escapeHtml(message)}</p>
          <div style="display:flex;gap:0.6rem;justify-content:flex-end;flex-wrap:wrap;">
            <button id="cm-cancel" class="btn btn--ghost cyber-chamfer-sm" style="font-family:var(--font-display);font-size:0.65rem;letter-spacing:0.2em;padding:0.55rem 1.1rem;">${escapeHtml(cancelText)}</button>
            <button id="cm-confirm" class="cyber-chamfer-sm" style="font-family:var(--font-display);font-size:0.65rem;letter-spacing:0.2em;padding:0.55rem 1.1rem;background:${c.bg};color:#fff;border:0;cursor:pointer;transition:background 150ms;">${escapeHtml(confirmText)}</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const confirmBtn = overlay.querySelector("#cm-confirm");
    const cancelBtn = overlay.querySelector("#cm-cancel");

    confirmBtn.addEventListener("mouseenter", () => {
      confirmBtn.style.background = c.hover;
    });
    confirmBtn.addEventListener("mouseleave", () => {
      confirmBtn.style.background = c.bg;
    });

    let resolved = false;
    function finish(result) {
      if (resolved) return;
      resolved = true;
      document.removeEventListener("keydown", keyHandler);
      overlay.remove();
      resolve(result);
    }

    function keyHandler(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      }
    }

    confirmBtn.addEventListener("click", () => finish(true));
    cancelBtn.addEventListener("click", () => finish(false));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(false);
    });
    document.addEventListener("keydown", keyHandler);

    setTimeout(() => confirmBtn.focus(), 50);
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
