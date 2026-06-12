// HTML overlay: title, theme card, floating dot labels, the running poem,
// the final recitation card, fades, toasts, and the Kurosawa-mode grain.

export class UI {
  constructor() {
    this.app = document.getElementById('app');
    this.title = document.getElementById('title-screen');
    this.themeCard = document.getElementById('theme-card');
    this.poemCard = document.getElementById('poem-card');
    this.dotLabels = document.getElementById('dot-labels');
    this.tracker = document.getElementById('poem-tracker');
    this.syllableHint = document.getElementById('syllable-hint');
    this.toastEl = document.getElementById('toast');
    this.hintBar = document.getElementById('hint-bar');
    this.fader = document.getElementById('fader');
    this.grain = document.getElementById('grain');
    this._labels = [];
    this._toastTimer = null;
    this._grainReady = false;
    this._fade = null;
  }

  // ----- fades (game-loop driven so they keep working in hidden tabs) -----

  fadeTo(opacity, ms) {
    const from = parseFloat(this.fader.style.opacity || getComputedStyle(this.fader).opacity);
    if (this._fade) this._fade.resolve();
    return new Promise((resolve) => {
      this._fade = { from, to: opacity, dur: Math.max(ms, 1) / 1000, t: 0, resolve };
    });
  }

  update(dt) {
    const f = this._fade;
    if (!f) return;
    f.t += dt;
    const k = Math.min(f.t / f.dur, 1);
    const e = k * k * (3 - 2 * k);
    this.fader.style.opacity = (f.from + (f.to - f.from) * e).toFixed(4);
    if (k >= 1) {
      this._fade = null;
      f.resolve();
    }
  }

  // ----- title -----

  hideTitle() {
    this.title.classList.add('hidden');
  }

  // ----- theme card -----

  showThemeCard(theme) {
    this.themeCard.innerHTML = `
      <div class="card-eyebrow">compose a haiku on</div>
      <div class="card-rule"></div>
      <div class="card-theme">${esc(theme)}</div>
      <div class="card-rule"></div>
      <div class="card-theme-jp">俳句を詠む</div>`;
    this.themeCard.classList.remove('hidden');
  }

  hideThemeCard() {
    this.themeCard.classList.add('hidden');
  }

  // ----- dot labels -----

  setDotLines(lines, syllables) {
    this.dotLabels.innerHTML = '';
    this._labels = lines.map((text) => {
      const el = document.createElement('div');
      el.className = 'dot-label';
      el.innerHTML = `${esc(text)}<span class="syll">${'·'.repeat(syllables)}</span>`;
      this.dotLabels.appendChild(el);
      return el;
    });
  }

  updateDotLabel(i, { x, y, opacity, visible }) {
    const el = this._labels[i];
    if (!el) return;
    el.style.left = `${x.toFixed(1)}px`;
    el.style.top = `${y.toFixed(1)}px`;
    el.style.opacity = visible ? opacity.toFixed(3) : '0';
  }

  clearDotLines() {
    this.dotLabels.innerHTML = '';
    this._labels = [];
  }

  // ----- running poem tracker -----

  setTracker(theme, lines) {
    if (!theme) {
      this.tracker.innerHTML = '';
      return;
    }
    this.tracker.innerHTML =
      `<div class="tracker-theme">${esc(theme)}</div>` +
      lines.map((l) => `<div class="tracker-line lit">${esc(l)}</div>`).join('');
  }

  // ----- syllable hint -----

  showSyllableHint(stageIdx) {
    const words = ['five', 'seven', 'five'];
    this.syllableHint.innerHTML = words
      .map((w, i) => (i === stageIdx ? `<span class="now">${w}</span>` : `<span>${w}</span>`))
      .join('<span> — </span>');
    this.syllableHint.classList.remove('hidden');
  }

  hideSyllableHint() {
    this.syllableHint.classList.add('hidden');
  }

  // ----- final poem -----

  showPoemCard(theme, lines) {
    this.poemCard.innerHTML =
      `<div class="card-eyebrow">${esc(theme)}</div><div class="card-rule"></div>` +
      lines.map((l, i) => `<div class="poem-line" data-i="${i}">${esc(l)}</div>`).join('') +
      `<div class="card-rule"></div><div class="poem-end-prompt"></div>`;
    this.poemCard.classList.remove('hidden');
  }

  revealPoemLine(i) {
    this.poemCard.querySelector(`.poem-line[data-i="${i}"]`)?.classList.add('lit');
  }

  showEndPrompt(text) {
    const el = this.poemCard.querySelector('.poem-end-prompt');
    if (el) {
      el.textContent = text;
      el.classList.add('lit');
    }
  }

  hidePoemCard() {
    this.poemCard.classList.add('hidden');
  }

  // ----- toast + hints -----

  toast(msg, ms = 3500) {
    this.toastEl.textContent = msg;
    this.toastEl.classList.remove('hidden');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => this.toastEl.classList.add('hidden'), ms);
  }

  showHint(html, ms = 0) {
    this.hintBar.innerHTML = html;
    this.hintBar.classList.remove('hidden');
    clearTimeout(this._hintTimer);
    if (ms > 0) this._hintTimer = setTimeout(() => this.hintBar.classList.add('hidden'), ms);
  }

  hideHint() {
    this.hintBar.classList.add('hidden');
  }

  // ----- Kurosawa mode -----

  setMono(on) {
    if (on && !this._grainReady) {
      const c = document.createElement('canvas');
      c.width = c.height = 160;
      const g = c.getContext('2d');
      const img = g.createImageData(160, 160);
      for (let i = 0; i < img.data.length; i += 4) {
        const v = 110 + Math.random() * 145;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
      this.grain.style.backgroundImage = `url(${c.toDataURL()})`;
      this._grainReady = true;
    }
    this.app.classList.toggle('mono', on);
    this.grain.classList.toggle('hidden', !on);
  }
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}
