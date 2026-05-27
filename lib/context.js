// lib/context.js — costruisce il `ctx` passato agli handler dei comandi inbound.
// nowOverride permette di testare i comandi "come se" fosse un altro momento
// (usato da test-command con EVENT_DATE).
const { parseDayTime, dayKey, dayLabel } = require('./time');

function makeCtx(cfg, nowOverride = null) {
  const now = nowOverride || new Date();
  const today = dayKey(now);
  const tmp = new Date(now.getTime());
  tmp.setDate(tmp.getDate() + 1);
  const tomorrow = dayKey(tmp);

  function stopsForDay(day) {
    return (cfg.stops || [])
      .filter((s) => s.day === day)
      .sort((a, b) => a.time.localeCompare(b.time));
  }
  function stopDateTime(s) {
    return parseDayTime(s.day, s.time);
  }

  return { cfg, now, today, tomorrow, stopsForDay, stopDateTime, dayLabel };
}

module.exports = { makeCtx };
