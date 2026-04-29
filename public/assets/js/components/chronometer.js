/**
 * High-precision chronometer using performance.now().
 * Survives tab switches (does not freeze — always diffs timestamps).
 */
export class Chronometer {
  constructor(onTick) {
    this._onTick = onTick;
    this._startTime = null;
    this._elapsed = 0;
    this._interval = null;
    this._running = false;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._startTime = performance.now() - this._elapsed;
    this._interval = setInterval(() => {
      this._elapsed = performance.now() - this._startTime;
      this._onTick?.(this.getSeconds());
    }, 500);
  }

  stop() {
    if (!this._running) return;
    this._running = false;
    clearInterval(this._interval);
    this._elapsed = performance.now() - this._startTime;
  }

  reset() {
    this.stop();
    this._elapsed = 0;
    this._startTime = null;
    this._onTick?.(0);
  }

  getSeconds() {
    return Math.floor(this._elapsed / 1000);
  }

  isRunning() {
    return this._running;
  }

  static format(totalSeconds) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
  }
}
