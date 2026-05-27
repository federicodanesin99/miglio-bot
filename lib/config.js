// lib/config.js — carica e valida schedule.json (schema viaggio multi-day).
// Setta process.env.TZ da trip.timezone: tutta la matematica sulle Date gira lì.
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', 'schedule.json');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`File config non trovato: ${CONFIG_FILE}`);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));

  if (!cfg.trip || !cfg.trip.timezone) throw new Error('trip.timezone mancante');
  if (!Array.isArray(cfg.trip.days) || cfg.trip.days.length === 0) {
    throw new Error('trip.days mancante o vuoto');
  }
  if (!cfg.group || !cfg.group.whatsappId) throw new Error('group.whatsappId mancante');
  if (!Array.isArray(cfg.stops)) throw new Error('stops deve essere un array');

  const ids = new Set();
  for (const s of cfg.stops) {
    if (!s.id) throw new Error(`stop senza id: "${s.title || JSON.stringify(s)}"`);
    if (ids.has(s.id)) throw new Error(`stop id duplicato: ${s.id}`);
    ids.add(s.id);
    if (!DATE_RE.test(s.day || '')) throw new Error(`stop ${s.id}: day non valido (${s.day})`);
    if (!TIME_RE.test(s.time || '')) throw new Error(`stop ${s.id}: time non valido (${s.time})`);
    if (!cfg.trip.days.includes(s.day)) throw new Error(`stop ${s.id}: day ${s.day} non è in trip.days`);
    if (!s.title) throw new Error(`stop ${s.id}: title mancante`);
  }

  const gids = new Set();
  for (const a of cfg.globalAnnouncements || []) {
    if (!a.id) throw new Error('globalAnnouncement senza id');
    if (gids.has(a.id)) throw new Error(`globalAnnouncement id duplicato: ${a.id}`);
    gids.add(a.id);
    if (!ISO_RE.test(a.datetime || '')) throw new Error(`global ${a.id}: datetime ISO non valido (${a.datetime})`);
    if (!a.text) throw new Error(`global ${a.id}: text mancante`);
  }

  if (cfg.weather && cfg.weather.enabled) {
    const w = cfg.weather;
    if (typeof w.lat !== 'number' || typeof w.lon !== 'number') {
      throw new Error('weather.lat e weather.lon devono essere numeri');
    }
    if (w.time && !TIME_RE.test(w.time)) throw new Error(`weather.time non valido (${w.time})`);
    if (w.days !== undefined) {
      if (!Array.isArray(w.days)) throw new Error('weather.days deve essere un array');
      for (const d of w.days) {
        if (!DATE_RE.test(d || '')) throw new Error(`weather.days: data non valida (${d})`);
        if (!cfg.trip.days.includes(d)) throw new Error(`weather.days: ${d} non è in trip.days`);
      }
    }
  }

  // Applica il fuso orario a tutte le successive operazioni sulle Date
  process.env.TZ = cfg.trip.timezone;

  return cfg;
}

function hasPlaceholderGroup(cfg) {
  return /REPLACE_WITH/.test(cfg.group.whatsappId);
}

module.exports = { loadConfig, hasPlaceholderGroup, CONFIG_FILE };
