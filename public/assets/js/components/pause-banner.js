import { listPausesForUnit, formatPauseAge, onPauseChange } from "../services/pause.js";
import { getSessionContext } from "../auth.js";
import { navigate } from "../router.js";

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtElapsed(secs) {
  if (!Number.isFinite(secs) || secs < 0) return "00:00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

let _bound = false;

export function renderPauseBanner() {
  const el = document.getElementById("pause-banner");
  if (!el) return;

  // Hide banner on ranking display (TV) — keeps it visually clean
  const hash = (window.location.hash || "").slice(1) || "/";
  if (hash.startsWith("/tela")) {
    el.classList.remove("visible");
    el.innerHTML = "";
    return;
  }

  const ctx = getSessionContext();
  if (!ctx) {
    el.classList.remove("visible");
    el.innerHTML = "";
    return;
  }

  const pauses = listPausesForUnit(ctx.unitId);
  if (pauses.length === 0) {
    el.classList.remove("visible");
    el.innerHTML = "";
    return;
  }

  el.innerHTML = pauses
    .map((p) => {
      const elapsed = fmtElapsed(p.elapsedSeconds || 0);
      const age = formatPauseAge(p);
      return `
        <span class="pause-banner-item">
          ⏸ <strong>${esc(p.label || "TRABALHO")}</strong>
          <span style="opacity:0.75;">${esc(p.stockistName || "")}${age ? " · " + age : ""} · ${elapsed}</span>
          <button class="pause-banner-btn" data-resume-route="${esc(p.route || "/dashboard")}" data-resume-stockist="${esc(p.stockistId)}">
            RETOMAR
          </button>
        </span>`;
    })
    .join("");
  el.classList.add("visible");

  el.querySelectorAll(".pause-banner-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const route = btn.getAttribute("data-resume-route") || "/dashboard";
      const sid = btn.getAttribute("data-resume-stockist") || "";
      const join = route.includes("?") ? "&" : "?";
      navigate(`${route}${join}resume=${encodeURIComponent(sid)}`);
    });
  });
}

export function initPauseBanner() {
  if (_bound) return;
  _bound = true;
  onPauseChange(renderPauseBanner);
  window.addEventListener("hashchange", renderPauseBanner);
  renderPauseBanner();
}
