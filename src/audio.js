// All sound is synthesized with the Web Audio API — no audio files.
// Instruments: temple bell, shakuhachi-style flute, hyōshigi woodblocks, gong,
// koto pluck. Ambience per biome: wind / river / surf / birds.
// Poem recitation uses the browser's local speechSynthesis (koto fallback).

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.ambienceBus = null;
    this.ambience = null; // { nodes: [], kind }
    this.voice = undefined; // resolved lazily
  }

  get ready() {
    return !!this.ctx;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
    this.ambienceBus = this.ctx.createGain();
    this.ambienceBus.gain.value = 0;
    this.ambienceBus.connect(this.master);
    // warm the speech voice list (loads async in Chrome)
    if ('speechSynthesis' in window) window.speechSynthesis.getVoices();
  }

  now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ----- helpers -------------------------------------------------------

  _noiseBuffer(seconds = 2) {
    if (this._noise && this._noise.duration >= seconds) return this._noise;
    const len = Math.ceil(seconds * this.ctx.sampleRate);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  _noiseSource(loop = true) {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(2);
    src.loop = loop;
    return src;
  }

  _env(t0, attack, peak, decay, sustain = 0.0001) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0001), t0 + attack);
    g.gain.exponentialRampToValueAtTime(Math.max(sustain, 0.0001), t0 + attack + decay);
    return g;
  }

  // ----- instruments ---------------------------------------------------

  // Deep temple bell (bonshō): inharmonic partials, very long decay.
  bell(when = 0, base = 96, loudness = 0.5) {
    if (!this.ctx) return;
    const t0 = this.now() + when;
    const partials = [
      { r: 1.0, g: 1.0, d: 9.0 },
      { r: 2.0, g: 0.6, d: 7.0 },
      { r: 2.76, g: 0.42, d: 5.5 },
      { r: 4.07, g: 0.22, d: 4.0 },
      { r: 5.43, g: 0.12, d: 2.6 },
      { r: 6.79, g: 0.07, d: 1.6 },
    ];
    const out = this.ctx.createGain();
    out.gain.value = loudness;
    out.connect(this.master);
    for (const p of partials) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * p.r;
      // a breath of detune drift makes it feel cast in bronze
      o.detune.setValueAtTime(8, t0);
      o.detune.linearRampToValueAtTime(0, t0 + 2.5);
      const env = this._env(t0, 0.008, 0.32 * p.g, p.d);
      o.connect(env).connect(out);
      o.start(t0);
      o.stop(t0 + p.d + 1);
    }
    // strike transient
    const n = this._noiseSource(false);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = base * 4;
    bp.Q.value = 1.2;
    const env = this._env(t0, 0.002, 0.3, 0.12);
    n.connect(bp).connect(env).connect(out);
    n.start(t0);
    n.stop(t0 + 0.3);
  }

  // Shakuhachi-ish flute: quick fluttering grace notes, then a soothing held tone.
  flute(when = 0) {
    if (!this.ctx) return;
    const t0 = this.now() + when;
    const out = this.ctx.createGain();
    out.gain.value = 0.34;
    out.connect(this.master);

    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    const tone = this.ctx.createGain();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2600;
    o.connect(tone).connect(lp).connect(out);

    // vibrato that deepens as the note settles
    const vib = this.ctx.createOscillator();
    vib.frequency.setValueAtTime(5.4, t0);
    const vibGain = this.ctx.createGain();
    vibGain.gain.setValueAtTime(0, t0);
    vibGain.gain.linearRampToValueAtTime(7, t0 + 1.4);
    vib.connect(vibGain).connect(o.detune);

    // breath noise following the same envelope
    const breath = this._noiseSource(false);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    const breathGain = this.ctx.createGain();
    breathGain.gain.value = 0.045;
    breath.connect(bp).connect(breathGain).connect(out);

    // the flit: E5 F5 B5 A5 — then soothe down onto D5
    const seq = [
      [659.3, 0.0],
      [698.5, 0.1],
      [987.8, 0.2],
      [880.0, 0.32],
    ];
    o.frequency.setValueAtTime(seq[0][0], t0);
    bp.frequency.setValueAtTime(seq[0][0], t0);
    for (const [f, dt] of seq.slice(1)) {
      o.frequency.exponentialRampToValueAtTime(f, t0 + dt + 0.06);
      bp.frequency.exponentialRampToValueAtTime(f, t0 + dt + 0.06);
    }
    o.frequency.exponentialRampToValueAtTime(587.3, t0 + 0.74);
    bp.frequency.exponentialRampToValueAtTime(587.3, t0 + 0.74);

    tone.gain.setValueAtTime(0.0001, t0);
    tone.gain.exponentialRampToValueAtTime(0.5, t0 + 0.05);
    tone.gain.setValueAtTime(0.5, t0 + 0.74);
    tone.gain.exponentialRampToValueAtTime(0.34, t0 + 1.1);
    tone.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.2);

    o.start(t0);
    o.stop(t0 + 3.4);
    vib.start(t0);
    vib.stop(t0 + 3.4);
    breath.start(t0);
    breath.stop(t0 + 3.2);
  }

  // Hyōshigi woodblock claps.
  woodblocks(count = 2, when = 0) {
    if (!this.ctx) return;
    const t0 = this.now() + when;
    for (let i = 0; i < count; i++) {
      const t = t0 + i * 0.42;
      const pitch = i % 2 === 0 ? 1750 : 2050;
      // resonant tick
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(pitch, t);
      o.frequency.exponentialRampToValueAtTime(pitch * 0.82, t + 0.05);
      const env = this._env(t, 0.001, 0.5, 0.075);
      o.connect(env).connect(this.master);
      o.start(t);
      o.stop(t + 0.12);
      // wooden snap
      const n = this._noiseSource(false);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = pitch * 1.6;
      bp.Q.value = 7;
      const nEnv = this._env(t, 0.001, 0.55, 0.03);
      n.connect(bp).connect(nEnv).connect(this.master);
      n.start(t);
      n.stop(t + 0.08);
    }
  }

  // Large gong: strike, slow bloom, long radiant tail.
  gong(when = 0) {
    if (!this.ctx) return;
    const t0 = this.now() + when;
    const out = this.ctx.createGain();
    out.gain.value = 0.6;
    out.connect(this.master);
    const base = 82;
    const partials = [
      { r: 1.0, g: 1.0, bloom: 0.4, d: 13 },
      { r: 1.52, g: 0.55, bloom: 1.2, d: 11 },
      { r: 2.32, g: 0.38, bloom: 1.8, d: 9 },
      { r: 2.9, g: 0.26, bloom: 2.4, d: 8 },
      { r: 3.61, g: 0.18, bloom: 2.9, d: 6.5 },
      { r: 4.52, g: 0.12, bloom: 3.4, d: 5 },
      { r: 5.81, g: 0.07, bloom: 3.8, d: 4 },
    ];
    for (const p of partials) {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = base * p.r;
      const wob = this.ctx.createOscillator();
      wob.frequency.value = 0.7 + p.r * 0.35;
      const wobGain = this.ctx.createGain();
      wobGain.gain.value = 4 + p.r * 2;
      wob.connect(wobGain).connect(o.detune);
      const g = this.ctx.createGain();
      // strike level, then bloom up, then the long fade
      const peak = 0.2 * p.g;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(peak * 0.5, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01 + Math.max(p.bloom, 0.05));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + p.d);
      o.connect(g).connect(out);
      o.start(t0);
      o.stop(t0 + p.d + 1);
      wob.start(t0);
      wob.stop(t0 + p.d + 1);
    }
    // shimmer wash
    const n = this._noiseSource(false);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(500, t0);
    bp.frequency.exponentialRampToValueAtTime(1400, t0 + 3);
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.035, t0 + 2.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 9);
    n.connect(bp).connect(g).connect(out);
    n.start(t0);
    n.stop(t0 + 9);
  }

  // Single koto-like pluck. degree indexes a pentatonic scale.
  koto(degree = 0, when = 0, loudness = 0.3) {
    if (!this.ctx) return;
    const t0 = this.now() + when;
    const scale = [293.7, 329.6, 392.0, 440.0, 523.3, 587.3]; // D E G A C D
    const f = scale[((degree % scale.length) + scale.length) % scale.length];
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 1.012, t0);
    o.frequency.exponentialRampToValueAtTime(f, t0 + 0.06);
    const o2 = this.ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = f * 2;
    const g2 = this.ctx.createGain();
    g2.gain.value = 0.25;
    const env = this._env(t0, 0.004, loudness, 1.5);
    o.connect(env);
    o2.connect(g2).connect(env);
    env.connect(this.master);
    o.start(t0);
    o.stop(t0 + 1.8);
    o2.start(t0);
    o2.stop(t0 + 1.8);
  }

  // ----- ambience -------------------------------------------------------

  startAmbience(kind = 'valley') {
    if (!this.ctx) return;
    this.stopAmbience(0.8);
    const nodes = [];
    const stops = [];
    const bus = this.ambienceBus;
    const t0 = this.now();
    bus.gain.cancelScheduledValues(t0);
    bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), t0);
    bus.gain.linearRampToValueAtTime(0.62, t0 + 3);

    const addNoiseLayer = ({ type, freq, q, gain, lfoRate, lfoDepth, pan = 0 }) => {
      const src = this._noiseSource(true);
      const f = this.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = this.ctx.createGain();
      g.gain.value = gain;
      const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      if (p) p.pan.value = pan;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = lfoRate;
      lfo.start();
      const lg = this.ctx.createGain();
      lg.gain.value = lfoDepth;
      lfo.connect(lg).connect(g.gain);
      src.connect(f).connect(g);
      (p ? g.connect(p) && p : g).connect(bus);
      src.start();
      nodes.push(src, f, g, lfo, lg, p);
      stops.push(src, lfo);
      return { src, f, g };
    };

    // wind — present everywhere, stereo pair breathing out of phase
    addNoiseLayer({ type: 'lowpass', freq: 320, q: 0.6, gain: 0.16, lfoRate: 0.07, lfoDepth: 0.09, pan: -0.5 });
    addNoiseLayer({ type: 'lowpass', freq: 420, q: 0.6, gain: 0.13, lfoRate: 0.11, lfoDepth: 0.08, pan: 0.5 });

    if (kind === 'valley') {
      // river babble: a few narrow bands burbling independently
      addNoiseLayer({ type: 'bandpass', freq: 650, q: 1.6, gain: 0.05, lfoRate: 3.1, lfoDepth: 0.02, pan: -0.2 });
      addNoiseLayer({ type: 'bandpass', freq: 1150, q: 2.2, gain: 0.035, lfoRate: 4.7, lfoDepth: 0.018, pan: 0.15 });
      addNoiseLayer({ type: 'bandpass', freq: 1900, q: 2.6, gain: 0.02, lfoRate: 6.3, lfoDepth: 0.012, pan: 0.3 });
    } else if (kind === 'coast') {
      // surf: deep swells rolling in and out
      addNoiseLayer({ type: 'lowpass', freq: 480, q: 0.7, gain: 0.2, lfoRate: 0.085, lfoDepth: 0.16, pan: -0.25 });
      addNoiseLayer({ type: 'highpass', freq: 1400, q: 0.7, gain: 0.045, lfoRate: 0.085, lfoDepth: 0.035, pan: 0.2 });
    } else if (kind === 'sakura') {
      // gentle stream + leaf-hush
      addNoiseLayer({ type: 'bandpass', freq: 900, q: 1.8, gain: 0.03, lfoRate: 3.7, lfoDepth: 0.015, pan: 0.1 });
      addNoiseLayer({ type: 'highpass', freq: 2400, q: 0.5, gain: 0.022, lfoRate: 0.19, lfoDepth: 0.014, pan: -0.3 });
    }

    // occasional birdsong
    const birdTimer = setInterval(() => {
      if (!this.ctx || this.ambience?.kind !== kind) return;
      if (Math.random() < (kind === 'coast' ? 0.4 : 0.62)) {
        kind === 'coast' ? this._gull() : this._songbird();
      }
    }, 7000);

    this.ambience = { nodes, stops, kind, birdTimer };
  }

  stopAmbience(fadeS = 1.5) {
    if (!this.ctx || !this.ambience) return;
    const { stops, birdTimer } = this.ambience;
    clearInterval(birdTimer);
    const t0 = this.now();
    this.ambienceBus.gain.cancelScheduledValues(t0);
    this.ambienceBus.gain.setValueAtTime(Math.max(this.ambienceBus.gain.value, 0.0001), t0);
    this.ambienceBus.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(fadeS, 0.05));
    for (const s of stops) {
      try {
        s.stop(t0 + fadeS + 0.1);
      } catch {
        /* already stopped */
      }
    }
    this.ambience = null;
  }

  duck(level = 0.25, seconds = 0.8) {
    if (!this.ctx) return;
    const t0 = this.now();
    this.ambienceBus.gain.cancelScheduledValues(t0);
    this.ambienceBus.gain.setValueAtTime(Math.max(this.ambienceBus.gain.value, 0.0001), t0);
    this.ambienceBus.gain.exponentialRampToValueAtTime(Math.max(level, 0.0001), t0 + seconds);
  }

  _songbird() {
    const t0 = this.now() + Math.random() * 2;
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) pan.pan.value = Math.random() * 1.6 - 0.8;
    const dest = pan || this.master;
    if (pan) pan.connect(this.master);
    const chirp = (t, f0, f1, dur) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      const g = this._env(t, 0.012, 0.05, dur);
      o.connect(g).connect(dest);
      o.start(t);
      o.stop(t + dur + 0.05);
    };
    chirp(t0, 2700 + Math.random() * 500, 2100, 0.13);
    chirp(t0 + 0.22, 3100 + Math.random() * 400, 2500, 0.18);
    if (Math.random() < 0.5) chirp(t0 + 0.48, 2500, 2900, 0.1);
  }

  _gull() {
    const t0 = this.now() + Math.random() * 2;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(1150, t0);
    o.frequency.exponentialRampToValueAtTime(720, t0 + 0.5);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    const g = this._env(t0, 0.05, 0.018, 0.5);
    o.connect(lp).connect(g).connect(this.master);
    o.start(t0);
    o.stop(t0 + 0.7);
  }

  // ----- recitation -----------------------------------------------------

  async _pickVoice() {
    if (this.voice !== undefined) return this.voice;
    if (!('speechSynthesis' in window)) {
      this.voice = null;
      return null;
    }
    let voices = speechSynthesis.getVoices();
    if (voices.length === 0) {
      voices = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(speechSynthesis.getVoices()), 1600);
        speechSynthesis.addEventListener(
          'voiceschanged',
          () => {
            clearTimeout(timer);
            resolve(speechSynthesis.getVoices());
          },
          { once: true }
        );
      });
    }
    const en = voices.filter((v) => /^en[-_]/i.test(v.lang));
    this.voice =
      en.find((v) => /natural/i.test(v.name)) ||
      en.find((v) => /aria|libby|guy|sonia/i.test(v.name)) ||
      en.find((v) => /zira|david|mark|hazel/i.test(v.name)) ||
      en[0] ||
      voices[0] ||
      null;
    return this.voice;
  }

  // Recites the three lines slowly. Calls onLine(i) as each line begins.
  // Resolves when the reading (or the koto fallback) has finished.
  async recite(lines, { onLine } = {}) {
    const voice = await this._pickVoice();
    if (!voice) return this._reciteFallback(lines, { onLine });

    return new Promise((resolve) => {
      let i = 0;
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          clearTimeout(watchdog);
          resolve();
        }
      };
      // if speech stalls silently (it happens), don't hang the finale
      const watchdog = setTimeout(finish, lines.length * 9000);
      const speakNext = () => {
        if (i >= lines.length) return finish();
        const idx = i++;
        onLine?.(idx);
        const u = new SpeechSynthesisUtterance(lines[idx]);
        u.voice = voice;
        u.lang = voice.lang;
        u.rate = 0.78;
        u.pitch = 0.92;
        u.volume = 1;
        u.onend = () => setTimeout(speakNext, 1050);
        u.onerror = () => {
          // fall back to chimes for the remaining lines
          this.koto(idx + 1, 0, 0.25);
          setTimeout(speakNext, 2600);
        };
        speechSynthesis.speak(u);
      };
      try {
        speechSynthesis.cancel(); // clear any stuck queue
      } catch {
        /* ignore */
      }
      speakNext();
    });
  }

  _reciteFallback(lines, { onLine } = {}) {
    return new Promise((resolve) => {
      lines.forEach((_, i) => {
        setTimeout(() => {
          onLine?.(i);
          this.koto(i * 2, 0, 0.28);
          this.koto(i * 2 + 3, 0.4, 0.2);
        }, i * 3400);
      });
      setTimeout(resolve, lines.length * 3400 + 1200);
    });
  }
}
