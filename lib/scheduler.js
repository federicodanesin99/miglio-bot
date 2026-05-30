// lib/scheduler.js — schedula via setTimeout tutti gli eventi futuri (anche su più
// giorni: i delay restano sotto il limite ~24.8gg di Node). Idempotenza via state.
const { buildEvents } = require('./events');
const { markSent } = require('./state');
const { log } = require('./logger');
const { fmtDateTime } = require('./time');

// Ritorna { timers, scheduled, skipped, events }. Eventi passati (>30s) o già
// inviati (state) vengono saltati. NB: nessun reset a mezzanotte — viaggio continuo.
function planTrip({ cfg, sender, state, filterDay = null, deps = {} }) {
  const events = buildEvents(cfg, filterDay, deps);
  const now = Date.now();
  const timers = [];
  let scheduled = 0;
  let skipped = 0;

  for (const ev of events) {
    const whenMs = ev.when.getTime();
    if (Number.isNaN(whenMs)) { log.error(`${ev.id}: when invalido, skip`); skipped++; continue; }
    if (whenMs < now - 30 * 1000) { skipped++; continue; }
    if (state.sentSet.has(ev.id)) { skipped++; continue; }

    // Clamp al limite di setTimeout (~24.8gg): oltre, l'int32 va in overflow e
    // il timer scatterebbe subito. Per il viaggio nominale non si attiva.
    const delayMs = Math.max(0, Math.min(whenMs - Date.now(), 2_147_483_647));
    const timer = setTimeout(async () => {
      if (state.sentSet.has(ev.id)) return;
      try {
        // Eventi dinamici (es. meteo) costruiscono il testo ora, non in fase di plan.
        // build() può ritornare una stringa o { text, mentions } (es. reveal MVP).
        const out = ev.build ? await ev.build() : ev.text;
        const text = typeof out === 'string' ? out : out.text;
        const mentions = typeof out === 'string' ? null : out.mentions;
        await sender.sendThrottled(ev.target, text, mentions);
        markSent(state, ev.id);
        log.ok(`[${fmtDateTime(ev.when)}] ${ev.type} → ${String(ev.target).slice(0, 28)}…`);
      } catch (err) {
        const msg = err?.message ?? String(err);
        log.error(`${ev.id}: ${msg}`);
        sender.notifyAdmin(`⚠️ Errore ${ev.id}: ${msg}`).catch(() => {});
      }
    }, delayMs);
    timers.push(timer);
    scheduled++;
  }

  return { timers, scheduled, skipped, events };
}

module.exports = { planTrip };
