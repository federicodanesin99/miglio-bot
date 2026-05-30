// lib/hype.js — selezione dei messaggi "hype" (gasanti) dal pool.
// Pesca una frase a caso evitando di ripetere le ultime usate. Lo stato
// anti-ripetizione vive in memoria per la durata del processo (un picker per run);
// a un riavvio riparte pulito — accettabile, serve solo a ridurre i doppioni
// ravvicinati. Math.random è ok nel processo bot (non nei workflow).
function makeHypePicker(pool) {
  const list = Array.isArray(pool) ? pool.filter((s) => typeof s === 'string' && s.trim()) : [];
  const recent = [];
  return function pick() {
    if (!list.length) return '📣 Forza ragazzi, si va! 🇳🇱';
    const fresh = list.filter((s) => !recent.includes(s));
    const arr = fresh.length ? fresh : list;
    const msg = arr[Math.floor(Math.random() * arr.length)];
    recent.push(msg);
    while (recent.length > Math.min(5, list.length - 1)) recent.shift();
    return msg;
  };
}

module.exports = { makeHypePicker };
