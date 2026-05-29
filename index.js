// index.js — Amsterdam Bot (Baileys, single account, un solo gruppo).
//
// Adattamento multi-day del Miglio-bot: promemoria SELETTIVI (solo stop con
// notify:true) su 5 giorni, niente cascata/departure/giochi. Vedi CLAUDE.md.
//
// Comandi:
//   node index.js setup                  — autentica via QR (una volta)
//   node index.js groups [nomi…]         — lista gruppi WhatsApp + JID
//   node index.js validate               — valida schedule.json + conteggi
//   node index.js schedule               — dry-run: stampa cosa verrebbe inviato
//   node index.js next                   — prossime 10 cose schedulate
//   node index.js run                    — produzione: connette + schedula
//   node index.js test-command "/oggi"   — esegue un comando in locale (no WA)
//   node index.js test-send <jid> <msg>  — invia un messaggio arbitrario
//   node index.js test-day <YYYY-MM-DD> [jid] — manda ORA tutti i msg del giorno
//   node index.js test-all [jid]              — manda ORA tutti i msg del viaggio
//   node index.js test-stop <stop_id> [jid]   — manda ORA il reminder di una stop
//
// ENV: EVENT_DATE=YYYY-MM-DD filtra schedule/next/test-command al giorno.
//      TEST_JID=<jid> sovrascrive il gruppo per run/test-day/test-stop.
const fs = require('fs');
const cron = require('node-cron');

const { log, initFileLog, closeLog } = require('./lib/logger');
const { loadConfig, hasPlaceholderGroup } = require('./lib/config');
const { buildEvents, reminderText, effectiveGroupId } = require('./lib/events');
const { loadState } = require('./lib/state');
const { createSession, makeSender, makeInboundRouter, AUTH_DIR } = require('./lib/whatsapp');
const { planTrip } = require('./lib/scheduler');
const { makeCtx } = require('./lib/context');
const { makeRollCall } = require('./lib/rollcall');
const { makeMvp } = require('./lib/mvp');
const { dispatch } = require('./lib/commands/_registry');
const { fmtDateTime, resolveFilterDate, parseDayTime, sleep, dayLabel } = require('./lib/time');

// ============================================================
// SETUP / GROUPS
// ============================================================

async function cmdSetup() {
  if (fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).length > 0) {
    log.warn(`Cartella ${AUTH_DIR} non vuota. Per riscansionare, cancellala prima.`);
    log.info('Provo lo stesso a connettermi con la sessione esistente…');
  }
  const session = await createSession({ printQr: true });
  log.ok('Setup completato. Sessione salvata in ' + AUTH_DIR);
  log.info('Attendo 15s per sync iniziale (chat, gruppi, contatti)…');
  await sleep(15000);
  log.ok('Sessione pronta. Ora puoi eseguire: node index.js groups');
  await session.end();
  process.exit(0);
}

async function cmdGroups() {
  const searchTerms = process.argv.slice(3).map((s) => s.toLowerCase().trim()).filter(Boolean);
  const session = await createSession({ printQr: false });
  const sock = session.sock;
  log.info('Recupero lista gruppi…');
  const groups = await sock.groupFetchAllParticipating();
  let entries = Object.entries(groups);

  if (searchTerms.length > 0) {
    entries = entries.filter(([, meta]) => searchTerms.includes((meta.subject || '').toLowerCase().trim()));
  }

  console.log('\n' + '═'.repeat(70));
  console.log(searchTerms.length ? `Match esatti per: ${searchTerms.map((s) => `"${s}"`).join(', ')} → ${entries.length}` : `Gruppi WhatsApp totali: ${entries.length}`);
  console.log('═'.repeat(70));

  entries
    .sort(([, a], [, b]) => (a.subject || '').localeCompare(b.subject || ''))
    .forEach(([jid, meta], i) => {
      console.log(`\n[${i + 1}] ${meta.subject}`);
      console.log(`    ID:           ${jid}`);
      console.log(`    Partecipanti: ${meta.participants?.length || '?'}`);
    });

  if (searchTerms.length > 0) {
    const found = new Set(entries.map(([, meta]) => (meta.subject || '').toLowerCase().trim()));
    const notFound = searchTerms.filter((t) => !found.has(t));
    if (notFound.length) console.log(`\n⚠️  Nessun gruppo con nome esatto: ${notFound.map((s) => `"${s}"`).join(', ')}`);
  }

  if (entries.length > 0) {
    console.log('\n' + '═'.repeat(70));
    console.log('Copia il JID nel campo "group.whatsappId" di schedule.json.');
    console.log('Formato atteso: 120363xxxxxxxxxxxxxx@g.us');
    console.log('═'.repeat(70));
  }

  const me = sock.user?.id;
  if (me) console.log(`\nIl tuo numero (per adminChatId): ${me.split(':')[0]}@s.whatsapp.net\n`);

  await sleep(2000);
  await session.end();
  process.exit(0);
}

// ============================================================
// VALIDATE / SCHEDULE / NEXT
// ============================================================

function cmdValidate() {
  try {
    const cfg = loadConfig();
    const events = buildEvents(cfg);
    log.ok('Config valida.');
    console.log(`   Giorni:           ${cfg.trip.days.length}`);
    console.log(`   Tappe:            ${cfg.stops.length} (con promemoria: ${cfg.stops.filter((s) => s.notify).length})`);
    console.log(`   Annunci globali:  ${(cfg.globalAnnouncements || []).length}`);
    console.log(`   Eventi totali:    ${events.length}`);
    const counts = events.reduce((a, e) => ((a[e.type] = (a[e.type] || 0) + 1), a), {});
    for (const [t, c] of Object.entries(counts)) console.log(`     ${t}: ${c}`);
    if (hasPlaceholderGroup(cfg)) {
      log.warn('group.whatsappId è un placeholder — popola con "node index.js groups" prima di run.');
    }
  } catch (err) {
    log.error('Config NON valida:', err.message);
    process.exit(1);
  }
}

function cmdSchedule() {
  const cfg = loadConfig();
  const filterDay = resolveFilterDate();
  const events = buildEvents(cfg, filterDay);

  console.log(`\nSchedule "${cfg.trip.name}"`);
  if (filterDay) console.log(`Giorno filtrato: ${dayLabel(filterDay)} (${filterDay})`);
  console.log(`Eventi: ${events.length}\n` + '═'.repeat(80));
  for (const ev of events) {
    console.log(`\n[${fmtDateTime(ev.when)}] ${ev.type.toUpperCase().padEnd(8)} → ${ev.target}`);
    console.log(`ID: ${ev.id}`);
    console.log('─'.repeat(80));
    console.log(ev.text);
    console.log('─'.repeat(80));
  }
  if (!events.length) console.log('(nessun evento' + (filterDay ? ` per ${filterDay}` : '') + ')');
}

function cmdNext() {
  const cfg = loadConfig();
  const now = Date.now();
  const events = buildEvents(cfg).filter((e) => e.when.getTime() >= now - 30 * 1000).slice(0, 10);
  console.log(`\nProssime ${events.length} cose schedulate:\n` + '═'.repeat(70));
  for (const ev of events) {
    const first = ev.text.split('\n')[0];
    console.log(`[${fmtDateTime(ev.when)}] ${ev.type.padEnd(8)} ${ev.id}`);
    console.log(`   ${first}`);
  }
  if (!events.length) console.log('(niente in programma da ora in poi)');
}

// ============================================================
// COMANDI DI TEST
// ============================================================

async function cmdTestCommand() {
  const cfg = loadConfig();
  const text = process.argv[3];
  if (!text) { log.error('Uso: node index.js test-command "/oggi"'); process.exit(1); }
  const filterDay = resolveFilterDate();
  const nowOverride = filterDay ? parseDayTime(filterDay, '00:00') : null;
  const reply = await dispatch(text, makeCtx(cfg, nowOverride));
  const out = typeof reply === 'string' ? reply : (reply?.text || '');
  console.log('\n' + '─'.repeat(60));
  console.log(out);
  console.log('─'.repeat(60));
}

async function cmdTestSend() {
  const cfg = loadConfig();
  const jid = process.argv[3];
  const msg = process.argv.slice(4).join(' ');
  if (!jid || !msg) { log.error('Uso: node index.js test-send <jid> <messaggio>'); process.exit(1); }
  const session = await createSession({ printQr: false });
  const sender = makeSender(session, cfg);
  await sender.sendThrottled(jid, msg);
  log.ok(`Inviato a ${jid}`);
  await session.end();
  process.exit(0);
}

async function cmdTestDay() {
  const cfg = loadConfig();
  const day = process.argv[3];
  const jid = process.argv[4] || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || '')) { log.error('Uso: node index.js test-day <YYYY-MM-DD> [<jid>]'); process.exit(1); }
  // mvp store reale così un eventuale reveal nel giorno usa la classifica vera (con tag).
  const mvp = makeMvp({ dailyBudget: cfg.mvp?.dailyBudget, names: cfg.mvp?.names || {} });
  const events = buildEvents(cfg, day, { mvp });
  if (!events.length) { log.warn(`Nessun evento per ${day}`); process.exit(0); }
  const session = await createSession({ printQr: false });
  const sender = makeSender(session, cfg);
  const target = jid || effectiveGroupId(cfg);
  log.info(`Invio ${events.length} messaggi di ${day} a ${target}…`);
  for (const ev of events) {
    const out = ev.build ? await ev.build() : ev.text;
    const text = typeof out === 'string' ? out : out.text;
    const mentions = typeof out === 'string' ? null : out.mentions;
    await sender.sendThrottled(target, text, mentions);
    log.ok(`${ev.id} → inviato`);
  }
  log.ok('test-day completato');
  await session.end();
  process.exit(0);
}

// test-all: manda ORA, in sequenza, TUTTI i messaggi del viaggio (tutti i giorni:
// intro, global, buongiorno, reminder, reveal MVP). Invia al gruppo configurato
// (o TEST_JID), oppure al jid passato. Per provare l'intero flusso in un colpo.
async function cmdTestAll() {
  const cfg = loadConfig();
  const jid = process.argv[3] || null;
  const mvp = makeMvp({ dailyBudget: cfg.mvp?.dailyBudget, names: cfg.mvp?.names || {} });
  const events = buildEvents(cfg, null, { mvp }); // niente filterDay = tutto il viaggio
  if (!events.length) { log.warn('Nessun evento da inviare.'); process.exit(0); }
  const target = jid || effectiveGroupId(cfg);
  log.warn(`⚠️  Sto per inviare TUTTI i ${events.length} messaggi del viaggio a ${target}.`);
  const session = await createSession({ printQr: false });
  const sender = makeSender(session, cfg);
  log.info(`Invio ${events.length} messaggi…`);
  for (const ev of events) {
    const out = ev.build ? await ev.build() : ev.text;
    const text = typeof out === 'string' ? out : out.text;
    const mentions = typeof out === 'string' ? null : out.mentions;
    await sender.sendThrottled(target, text, mentions);
    log.ok(`${ev.id} → inviato`);
  }
  log.ok('test-all completato');
  await session.end();
  process.exit(0);
}

async function cmdTestStop() {
  const cfg = loadConfig();
  const stopId = process.argv[3];
  const jid = process.argv[4] || null;
  const stop = (cfg.stops || []).find((s) => s.id === stopId);
  if (!stop) {
    log.error(`Stop "${stopId}" non trovato. Id disponibili: ${(cfg.stops || []).map((s) => s.id).join(', ')}`);
    process.exit(1);
  }
  const session = await createSession({ printQr: false });
  const sender = makeSender(session, cfg);
  const target = jid || effectiveGroupId(cfg);
  await sender.sendThrottled(target, reminderText(cfg, stop));
  log.ok(`Reminder di "${stopId}" → inviato a ${target}`);
  await session.end();
  process.exit(0);
}

// ============================================================
// RUN (produzione)
// ============================================================

async function cmdRun() {
  const logFile = initFileLog();
  log.info(`📝 File di log: ${logFile}`);

  const cfg = loadConfig();
  if (hasPlaceholderGroup(cfg)) {
    log.error('group.whatsappId è un placeholder. Esegui "node index.js groups" e popola schedule.json.');
    process.exit(1);
  }
  if (process.env.TEST_JID) log.warn(`TEST_JID attivo → invio a ${process.env.TEST_JID}`);

  const filterDay = resolveFilterDate();
  const state = loadState();

  let sender = null;
  let router = null;
  const rollcall = makeRollCall({
    // Attesi all'appello = partecipanti del gruppo meno il bot.
    getGroupSize: async () => {
      const jid = effectiveGroupId(cfg);
      if (!jid.endsWith('@g.us')) return null;
      const sock = await sender.waitForSocket();
      const meta = await sock.groupMetadata(jid);
      return Math.max(0, (meta.participants?.length || 1) - 1);
    },
  });
  const mvp = makeMvp({
    dailyBudget: cfg.mvp?.dailyBudget,
    names: cfg.mvp?.names || {},
  });
  const ctxFactory = (meta = {}) => ({ ...makeCtx(cfg), rollcall, mvp, ...meta });

  log.info(`Viaggio: ${cfg.trip.name}`);
  log.info(`Gruppo: ${cfg.group.name} (${effectiveGroupId(cfg)})`);
  log.info(`Eventi già inviati (state): ${state.sent.length}`);

  const session = await createSession({
    printQr: false,
    // wrapper stabile: delega al router una volta costruito; riagganciato a ogni reconnect
    onMessages: (u) => (router ? router(u) : undefined),
    onReconnect: async (newSock) => {
      log.info('🔁 Socket sostituito: invii pendenti sulla nuova connessione.');
      if (sender) await sender.notifyAdmin('🔁 Bot riconnesso a WhatsApp.', newSock);
    },
  });

  sender = makeSender(session, cfg);
  router = makeInboundRouter({ cfg, sender, ctxFactory, rollcall });

  // Roster MVP: chi può ricevere/dare punti = partecipanti del gruppo.
  // Fetch iniziale + refresh periodico (gruppo stabile, ma gli ingressi capitano).
  const refreshRoster = async () => {
    try {
      const jid = effectiveGroupId(cfg);
      if (!jid.endsWith('@g.us')) return;
      const sock = await sender.waitForSocket();
      const meta = await sock.groupMetadata(jid);
      const jids = (meta.participants || []).map((p) => p.id).filter(Boolean);
      mvp.setParticipants(jids);
      log.info(`👥 Roster MVP aggiornato: ${jids.length} partecipanti.`);
    } catch (e) {
      log.warn(`Roster MVP non aggiornato: ${e.message}`);
    }
  };
  await refreshRoster();
  cron.schedule('0 */6 * * *', refreshRoster); // ogni 6 ore

  const { scheduled, skipped, events } = planTrip({ cfg, sender, state, filterDay, deps: { mvp } });
  log.ok(`📅 Schedulati ${scheduled} eventi (skip: ${skipped})${filterDay ? ` — giorno ${filterDay}` : ''}`);

  await sender.notifyAdmin(
    `🤖 Amsterdam Bot attivo.\nEventi schedulati: ${scheduled}\nGruppo: ${cfg.group.name}\nLog: ${logFile}`,
    session.sock,
  );

  log.info('Bot attivo. Tieni questa finestra aperta. Ctrl+C per fermare.');

  // Heartbeat ogni 10 min
  cron.schedule('*/10 * * * *', () => {
    const remaining = events.length - state.sent.length - skipped;
    const sockState = session.sock ? 'connesso' : 'in riconnessione';
    log.info(`💓 alive — eventi rimanenti: ${remaining} — socket: ${sockState}`);
  });
  // future: replan periodico per recuperare drift dopo lunghe disconnessioni

  const shutdown = async (signal) => {
    log.info(`${signal}, chiudo…`);
    await session.end();
    closeLog();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

// ============================================================
// MAIN
// ============================================================

const cmds = {
  setup: cmdSetup,
  groups: cmdGroups,
  validate: cmdValidate,
  schedule: cmdSchedule,
  next: cmdNext,
  run: cmdRun,
  'test-command': cmdTestCommand,
  'test-send': cmdTestSend,
  'test-day': cmdTestDay,
  'test-all': cmdTestAll,
  'test-stop': cmdTestStop,
};

const cmd = process.argv[2];
if (!cmd || !cmds[cmd]) {
  console.log(`
Uso: node index.js <comando>

Comandi:
  setup                      Autentica via QR (una sola volta)
  groups [nomi…]             Lista gruppi WhatsApp con JID
  validate                   Verifica schedule.json + conteggi eventi
  schedule                   Dry-run: stampa cosa verrebbe inviato (EVENT_DATE filtra)
  next                       Prossime 10 cose schedulate
  run                        Avvia il bot in produzione (lasciare aperto)
  test-command "/oggi"       Esegue un comando in locale, senza WhatsApp
  test-send <jid> <msg>      Invia un messaggio arbitrario a un JID
  test-day <data> [jid]      Manda ORA tutti i messaggi di quel giorno
  test-all [jid]             Manda ORA tutti i messaggi del viaggio in un colpo
  test-stop <stop_id> [jid]  Manda ORA il reminder di una singola tappa

ENV:
  EVENT_DATE=YYYY-MM-DD   filtra schedule/next/test-command al giorno
  TEST_JID=<jid>          sovrascrive il gruppo per run/test-day/test-stop
`);
  process.exit(cmd ? 1 : 0);
}

Promise.resolve(cmds[cmd]()).catch((err) => {
  log.error('Fatale:', err.message);
  process.exit(1);
});
