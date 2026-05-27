// lib/commands/_registry.js — mappa nome → comando, + dispatch di una stringa "/cmd args".
const oggi = require('./oggi');
const domani = require('./domani');
const prossimo = require('./prossimo');
const dove = require('./dove');
const meteo = require('./meteo');
const help = require('./help');

const registry = { oggi, domani, prossimo, dove, meteo, help };

// Esegue una stringa tipo "/dove barra" → ritorna il testo di risposta.
// Comando sconosciuto → /help.
async function dispatch(text, ctx) {
  const clean = String(text || '').trim().replace(/^\//, '');
  const [name, ...rest] = clean.split(/\s+/);
  const entry = registry[(name || '').toLowerCase()] || registry.help;
  return entry.handler(rest.join(' '), ctx);
}

module.exports = { registry, dispatch };
