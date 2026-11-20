/** Tiny synthesised sound: soft chimes and the sound of waves. No audio files needed. */

const PENTA = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private waves: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture (a click or a key press). */
  start() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.7;
    // A gentle echo makes the chimes feel open-air.
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.28;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    delay.connect(fb).connect(delay);
    delay.connect(this.master);
    this.master.connect(ctx.destination);
    this.echo = delay;

    // Waves: filtered noise with a slow swell.
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = last * 0.985 + (Math.random() * 2 - 1) * 0.015;
      d[i] = last * 6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 700;
    this.waves = ctx.createGain();
    this.waves.gain.value = 0.12;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.07;
    lfo.connect(lfoGain).connect(this.waves.gain);
    src.connect(lp).connect(this.waves).connect(this.master);
    src.start();
    lfo.start();
  }

  private echo: DelayNode | null = null;

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.05);
  }

  private tone(freq: number, at: number, dur: number, vol: number, type: OscillatorType = "sine") {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(vol, at + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g);
    g.connect(this.master);
    if (this.echo) g.connect(this.echo);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  /** Chime that climbs the scale with every lantern. */
  collect(index: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const semi = PENTA[Math.min(index, PENTA.length - 1)];
    const f = 523.25 * Math.pow(2, semi / 12);
    this.tone(f, t, 1.2, 0.22);
    this.tone(f * 2, t, 0.6, 0.05, "triangle");
    this.tone(f * 1.5, t + 0.08, 0.9, 0.08);
  }

  jump() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(330, t, 0.12, 0.05, "triangle");
  }

  win() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(392 * Math.pow(2, s / 12), t + i * 0.12, 1.6, 0.16));
  }

  lose() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [12, 7, 4, 0].forEach((s, i) => this.tone(330 * Math.pow(2, s / 12), t + i * 0.22, 1.4, 0.12));
  }

  tick() {
    if (!this.ctx) return;
    this.tone(880, this.ctx.currentTime, 0.08, 0.04, "square");
  }
}
