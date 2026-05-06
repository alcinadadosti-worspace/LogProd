/**
 * Sound Engine — Web Audio API, sem arquivos externos.
 * Sons sintéticos com estética cyberpunk (tons eletrônicos, sem melodias genéricas).
 * O contexto só é criado após a primeira interação do usuário (requisito do browser).
 */

let _ctx = null;

function ctx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (_ctx.state === 'suspended') _ctx.resume();
  return _ctx;
}

let muted = localStorage.getItem('sound_muted') === 'true';

export function isMuted() { return muted; }
export function toggleMute() {
  muted = !muted;
  localStorage.setItem('sound_muted', muted);
  return muted;
}

function gain(value, when = 0) {
  const g = ctx().createGain();
  g.gain.setValueAtTime(value, ctx().currentTime + when);
  return g;
}

function osc(type, freq, start, duration, vol = 0.3) {
  if (muted) return;
  const c   = ctx();
  const o   = c.createOscillator();
  const g   = c.createGain();
  o.type    = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0, c.currentTime + start);
  g.gain.linearRampToValueAtTime(vol, c.currentTime + start + 0.01);
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + duration);
  o.connect(g);
  g.connect(c.destination);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + duration + 0.05);
}

// ─── Sons individuais ────────────────────────────────────────────────────────

/** Bip de confirmação (caixa lacrada, input validado) */
export function playConfirm() {
  osc('sine',   880, 0,    0.08, 0.25);
  osc('sine',   1320, 0.07, 0.12, 0.18);
}

/** Som de início de operação */
export function playStart() {
  osc('square', 220, 0,    0.06, 0.12);
  osc('square', 330, 0.05, 0.08, 0.10);
  osc('square', 440, 0.10, 0.10, 0.08);
}

/** XP ganho — arpejo ascendente neon */
export function playXP() {
  const freqs = [523, 659, 784, 1047, 1319];
  freqs.forEach((f, i) => osc('sine', f, i * 0.08, 0.18, 0.22));
  // harmônico de brilho no topo
  osc('triangle', 2093, freqs.length * 0.08, 0.3, 0.10);
}

/** Operação completa (lote finalizado) */
export function playComplete() {
  // acorde + sweep
  osc('sine',   523,  0,    0.4, 0.25);
  osc('sine',   659,  0.05, 0.4, 0.22);
  osc('sine',   784,  0.10, 0.4, 0.20);
  osc('sine',   1047, 0.18, 0.3, 0.15);
  osc('square', 1047, 0.50, 0.15, 0.08);
}

/** Erro / acesso negado */
export function playError() {
  osc('sawtooth', 220, 0,    0.15, 0.30);
  osc('sawtooth', 180, 0.13, 0.15, 0.28);
  osc('sawtooth', 140, 0.26, 0.20, 0.25);
}

/** Novo rank alcançado / posição no telão mudou */
export function playRankUp() {
  osc('sine', 659,  0,    0.12, 0.20);
  osc('sine', 880,  0.10, 0.12, 0.20);
  osc('sine', 1047, 0.20, 0.20, 0.18);
}

/** Tick suave para eventos ao vivo no telão */
export function playTick() {
  osc('sine', 1760, 0, 0.04, 0.08);
}

// ─── Sons de arquivo (/audio/) ───────────────────────────────────────────────

const _audioCache = {};
function _playFile(name) {
  if (muted) return;
  if (!_audioCache[name]) {
    _audioCache[name] = new Audio(`/audio/${name}.mp3`);
    _audioCache[name].preload = 'auto';
  }
  const a = _audioCache[name];
  a.currentTime = 0;
  a.play().catch(() => {});
}

/** PIN ou senha digitados errados */
export function playSenhaIncorreta() { _playFile('SenhaIncorreta'); }

/** Finalização de bipagem */
export function playPosBipagem() { _playFile('PosBipagem'); }

/** Tela de resumo de XP (tarefa ou lote completo) */
export function playAuraa() { _playFile('auraa'); }
