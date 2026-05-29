// lib/events.js — espande schedule.json in una lista di eventi ordinata per orario.
//
// A differenza del Miglio (pub-crawl sequenziale), qui NON si generano arrival /
// departure / giochi. buildEvents produce solo:
//   - un `reminder` per ogni stop con notify:true (a leadTime minuti prima)
//   - un `global` per ogni globalAnnouncements
// Gli id sono deterministici (`pre:<stop.id>`, `global:<ann.id>`) → idempotenza.
const { parseDayTime, parseISO, dayKey, dayLabel } = require('./time');
const { morningText } = require('./morning');

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

// Messaggio di presentazione del bot: si presenta e ELENCA i comandi. Lista
// generata dal registry al momento dell'invio → sempre allineata (anche /mvp).
// require lazy del registry per evitare cicli di import a load-time.
function introText() {
  const { registry } = require('./commands/_registry');
  const lines = Object.entries(registry).map(([name, e]) => `• /${name} — ${e.desc}`);
  return [
    '🤖 *Ciao a tutti! Sono il bot di Amsterdam 2026* 🇳🇱',
    '',
    'Da adesso vi accompagno per tutto il viaggio: vi sveglio, ogni mattina vi mando *programma + meteo*, vi ricordo le tappe poco prima e tengo la *classifica MVP* del viaggio.',
    '',
    '📋 *Cosa potete chiedermi* (scrivete il comando nel gruppo):',
    lines.join('\n'),
    '',
    'Buon viaggio, ci si vede ad Amsterdam! ✈️',
  ].join('\n');
}

// filterDay ("YYYY-MM-DD") opzionale: limita agli eventi che PARTONO quel giorno.
// deps: dipendenze runtime per gli eventi dinamici (es. `deps.mvp` per il reveal
// della classifica). Assente nei dry-run offline → l'evento usa un testo anteprima.
function buildEvents(cfg, filterDay = null, deps = {}) {
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

  // Messaggio "Buongiorno" del mattino: un evento per giorno, che fonde programma
  // del giorno + brief meteo. Il testo NON è statico — viene calcolato al momento
  // dell'invio via `build()` (la previsione meteo dev'essere fresca). `text` è solo
  // un'anteprima per i dry-run offline (schedule/next). Orario/giorni dalla sezione
  // `weather` (anche quando il meteo è disabilitato, il buongiorno col programma resta).
  const wx = cfg.weather;
  if (wx) {
    const days = Array.isArray(wx.days) && wx.days.length ? wx.days : cfg.trip.days;
    const time = wx.time || '08:00';
    for (const day of days) {
      events.push({
        id: `morning:${day}`,
        type: 'morning',
        when: parseDayTime(day, time),
        target,
        text: `☀️ Buongiorno — ${dayLabel(day)}: programma del giorno + meteo (generato live).`,
        build: () => morningText(cfg, day),
      });
    }
  }

  // Presentazione del bot + lista comandi (un solo evento, es. la mattina di partenza).
  if (cfg.intro?.datetime) {
    events.push({
      id: 'intro',
      type: 'global',
      when: parseISO(cfg.intro.datetime),
      target,
      text: '🤖 Presentazione del bot + lista comandi (generata live).',
      build: async () => introText(),
    });
  }

  // Reveal della classifica MVP a fine viaggio: un solo evento, testo calcolato
  // live via build() (deps.mvp). Offline (schedule/next) → anteprima statica.
  if (cfg.mvp?.reveal) {
    events.push({
      id: 'mvp:reveal',
      type: 'mvp',
      when: parseISO(cfg.mvp.reveal),
      target,
      text: '🏆 Classifica MVP del viaggio (generata live a fine viaggio).',
      build: async () => (deps.mvp ? deps.mvp.revealText() : '🏆 Classifica MVP'),
    });
  }

  events.sort((a, b) => a.when.getTime() - b.when.getTime());
  return filterDay ? events.filter((e) => dayKey(e.when) === filterDay) : events;
}

module.exports = { buildEvents, reminderText, effectiveGroupId, leadFor };
