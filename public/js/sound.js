// Küçük ses efektleri (WebAudio) ve Türkçe sesli okuma (Web Speech API)
let ctx;
const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

function tone(freq, start, dur, type = 'sine', gain = 0.16) {
  const a = audio();
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0, a.currentTime + start);
  g.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + start + dur);
  o.connect(g).connect(a.destination);
  o.start(a.currentTime + start); o.stop(a.currentTime + start + dur + 0.05);
}

export const sfx = {
  enabled: true,
  play(name) {
    if (!this.enabled) return;
    try {
      if (audio().state === 'suspended') audio().resume();
      ({
        correct: () => { tone(660, 0, 0.12, 'triangle'); tone(990, 0.09, 0.2, 'triangle'); },
        wrong:   () => { tone(220, 0, 0.18, 'sawtooth', 0.07); tone(180, 0.12, 0.22, 'sawtooth', 0.06); },
        tap:     () => tone(520, 0, 0.07, 'sine', 0.08),
        streak:  () => [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.07, 0.16, 'triangle', 0.12)),
        finish:  () => [523, 659, 784, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.11, 0.22, 'triangle', 0.13)),
      })[name]?.();
    } catch { /* ses desteklenmiyor */ }
  },
};

let trVoice = null;
function pickVoice() {
  const voices = speechSynthesis.getVoices();
  trVoice = voices.find(v => v.lang === 'tr-TR') || voices.find(v => v.lang?.startsWith('tr')) || null;
}
if ('speechSynthesis' in window) {
  pickVoice();
  speechSynthesis.addEventListener?.('voiceschanged', pickVoice);
}

export const voice = {
  enabled: true,
  get available() { return 'speechSynthesis' in window; },
  say(text, { force = false } = {}) {
    if ((!this.enabled && !force) || !this.available) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'tr-TR'; u.rate = 0.95; u.pitch = 1.1;
    if (trVoice) u.voice = trVoice;
    speechSynthesis.speak(u);
  },
  stop() { if (this.available) speechSynthesis.cancel(); },
};
