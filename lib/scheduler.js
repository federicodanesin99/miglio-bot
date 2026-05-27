// lib/scheduler.js — schedula via setTimeout tutti gli eventi futuri (anche su più
// giorni: i delay restano sotto il limite ~24.8gg di Node). Idempotenza via state.
const { buildEvents } = require('./events');
const { markSent } = require('./state');
const { log } = require('./logger');
const { fmtDateTime } = require('./time');

// Ritorna { timers, scheduled, skipped, events }. Eventi passati (>30s) o già
// inviati (state) vengono saltati. NB: nessun reset a mezzanotte — viaggio continuo.
function planTrip({ cfg, sender, state, filterDay = null }) {
  const events = buildEvents(cfg, filterDay);
  const now = Date.now();
  const timers = [];
  let scheduled = 0;
  let skipped = 0;

  for (const ev of events) {
    if (ev.when.getTime() < now - 30 * 1000) { skipped++; continue; }
    if (state.sentSet.has(ev.id)) { skipped++; continue; }

    const delayMs = ev.when.getTime() - Date.now();
    const timer = setTimeout(async () => {
      if (state.sentSet.has(ev.id)) return;
      try {
        await sender.sendThrottled(ev.target, ev.text);
        markSent(state, ev.id);
        log.ok(`[${fmtDateTime(ev.when)}] ${ev.type} → ${String(ev.target).slice(0, 28)}…`);
      } catch (err) {
        log.error(`${ev.id}: ${err.message}`);
        sender.notifyAdmin(`⚠️ Errore ${ev.id}: ${err.message}`).catch(() => {});
      }
    }, delayMs);
    timers.push(timer);
    scheduled++;
  }

  return { timers, scheduled, skipped, events };
}

module.exports = { planTrip };
