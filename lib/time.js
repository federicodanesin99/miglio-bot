// lib/time.js — helper su date/orari. Tutte le Date sono costruite in ora locale,
// che corrisponde a trip.timezone perché loadConfig setta process.env.TZ.
const pad = (n) => String(n).padStart(2, '0');

// "HH:MM" → minuti dalla mezzanotte
function hhmmToMin(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

// ("YYYY-MM-DD", "HH:MM") → Date assoluta (ora locale = trip.timezone)
function parseDayTime(day, time) {
  const [y, mo, d] = day.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}

// "YYYY-MM-DDTHH:MM[:SS]" → Date assoluta (ora locale, niente offset UTC)
function parseISO(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) throw new Error(`datetime non valido: ${s}`);
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0), 0);
}

// Date → "YYYY-MM-DD" (ora locale)
function dayKey(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtTime(d) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function fmtDateTime(d) {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${fmtTime(d)}`;
}

// EVENT_DATE (filtro per giorno in schedule/next/test-command). Null se non settata.
function resolveFilterDate() {
  const e = process.env.EVENT_DATE;
  if (!e) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e)) throw new Error(`EVENT_DATE non valida: ${e}`);
  return e;
}

const WEEKDAYS = ['Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];

// "YYYY-MM-DD" → "Domenica 31/05"
function dayLabel(day) {
  const [y, mo, d] = day.split('-').map(Number);
  const dt = new Date(y, mo - 1, d);
  return `${WEEKDAYS[dt.getDay()]} ${pad(d)}/${pad(mo)}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  hhmmToMin, parseDayTime, parseISO, dayKey, fmtTime, fmtDateTime,
  resolveFilterDate, dayLabel, sleep,
};
