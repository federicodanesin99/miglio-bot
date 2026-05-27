// lib/morning.js — messaggio "Buongiorno" del mattino: fonde in un solo testo il
// programma del giorno (le tappe) e il brief meteo. Costruito al fire-time (la
// previsione meteo dev'essere fresca), quindi è async.
const { dayLabel } = require('./time');
const { formatDayStops } = require('./format');
const { weatherBriefText } = require('./weather');

function stopsForDay(cfg, day) {
  return (cfg.stops || [])
    .filter((s) => s.day === day)
    .sort((a, b) => a.time.localeCompare(b.time));
}

async function morningText(cfg, day) {
  const head = `☀️ *Buongiorno!* — ${dayLabel(day)}`;

  const stops = stopsForDay(cfg, day);
  const program = stops.length
    ? `📅 *Programma di oggi*\n${formatDayStops(stops)}`
    : '📅 Nessuna tappa fissa oggi: giornata libera 😎';

  const blocks = [head, program];
  if (cfg.weather && cfg.weather.enabled) {
    blocks.push(await weatherBriefText(cfg.weather, day, cfg.trip.timezone));
  }
  return blocks.join('\n\n');
}

module.exports = { morningText };
