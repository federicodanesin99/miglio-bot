// lib/events.js — espande schedule.json in una lista di eventi ordinata per orario.
//
// A differenza del Miglio (pub-crawl sequenziale), qui NON si generano arrival /
// departure / giochi. buildEvents produce solo:
//   - un `reminder` per ogni stop con notify:true (a leadTime minuti prima)
//   - un `global` per ogni globalAnnouncements
// Gli id sono deterministici (`pre:<stop.id>`, `global:<ann.id>`) → idempotenza.
const { parseDayTime, parseISO, dayKey } = require('./time');

// JID a cui inviare. TEST_JID, se settata, sovrascrive il gruppo reale.
function effectiveGroupId(cfg) {
  return process.env.TEST_JID || cfg.group.whatsappId;
}

function leadFor(cfg, stop) {
  if (typeof stop.leadTime === 'number') return stop.leadTime;
  if (typeof cfg.defaults?.leadTime === 'number') return cfg.defaults.leadTime;
  return 20;
}

function fillTokens(tpl, stop, lead) {
  const loc = stop.location || {};
  return tpl
    .replace(/{maps}/g, loc.maps || '')
    .replace(/{name}/g, loc.name || stop.title)
    .replace(/{title}/g, stop.title)
    .replace(/{time}/g, stop.time)
    .replace(/{lead}/g, String(lead))
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

// Testo del promemoria di una stop: template custom (tplArrival) o default generato.
function reminderText(cfg, stop) {
  const lead = leadFor(cfg, stop);
  if (stop.tplArrival) return fillTokens(stop.tplArrival, stop, lead);
  const loc = stop.location || {};
  const lines = [`🔔 Tra ${lead} min · *${stop.title}* (${stop.time})`];
  if (loc.name) lines.push(`📍 ${loc.name}`);
  if (loc.maps) lines.push(loc.maps);
  return lines.join('\n');
}

// filterDay ("YYYY-MM-DD") opzionale: limita agli eventi che PARTONO quel giorno.
function buildEvents(cfg, filterDay = null) {
  const events = [];
  const target = effectiveGroupId(cfg);

  for (const stop of cfg.stops || []) {
    if (!stop.notify) continue;
    const eventAt = parseDayTime(stop.day, stop.time);
    const lead = leadFor(cfg, stop);
    const when = new Date(eventAt.getTime() - lead * 60000);
    events.push({
      id: `pre:${stop.id}`,
      type: 'reminder',
      when,
      target,
      text: reminderText(cfg, stop),
      stopId: stop.id,
      eventAt,
    });
  }

  for (const ann of cfg.globalAnnouncements || []) {
    events.push({
      id: `global:${ann.id}`,
      type: 'global',
      when: parseISO(ann.datetime),
      target,
      text: ann.text,
    });
  }

  events.sort((a, b) => a.when.getTime() - b.when.getTime());
  return filterDay ? events.filter((e) => dayKey(e.when) === filterDay) : events;
}

module.exports = { buildEvents, reminderText, effectiveGroupId, leadFor };
