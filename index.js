// index.js — Miglio d'Oro Bot v2 (Baileys, single file, single account)
//
// Comandi:
//   node index.js setup       — autentica via QR (una sola volta)
//   node index.js groups      — stampa lista gruppi WhatsApp
//   node index.js validate    — valida config/schedule.json
//   node index.js schedule    — anteprima testi che verrebbero inviati
//   node index.js run         — produzione: schedula e invia
//
// Flusso tipico:
//   npm install
//   node index.js setup       (scansiona QR, attendi "Pronto", Ctrl+C)
//   node index.js groups      (copia ID dei gruppi del Miglio d'Oro)
//   nano schedule.json        (riempi gli ID e adminChatId)
//   node index.js validate
//   node index.js schedule    (rileggi i messaggi)
//   node index.js run         (parti, lascialo aperto)

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const AUTH_DIR = path.join(__dirname, 'auth');
const STATE_FILE = path.join(__dirname, 'state.json');
const CONFIG_FILE = path.join(__dirname, 'schedule.json');

// Logger silenzioso per Baileys (i suoi log sono molto verbosi)
const baileysLogger = pino({ level: 'silent' });

// Sleep helper
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Log strutturato semplice
const log = {
  info: (...a) => console.log(new Date().toLocaleTimeString('it-IT'), 'INFO ', ...a),
  warn: (...a) => console.log(new Date().toLocaleTimeString('it-IT'), 'WARN ', ...a),
  error: (...a) => console.log(new Date().toLocaleTimeString('it-IT'), 'ERROR', ...a),
  ok: (...a) => console.log(new Date().toLocaleTimeString('it-IT'), '✓    ', ...a),
};

// ============================================================
// CONFIG LOADING
// ============================================================

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`File config non trovato: ${CONFIG_FILE}`);
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  // Validazione base
  if (!Array.isArray(cfg.stops) || cfg.stops.length === 0) {
    throw new Error('config.stops mancante o vuoto');
  }
  if (!Array.isArray(cfg.groups) || cfg.groups.length === 0) {
    throw new Error('config.groups mancante o vuoto');
  }
  const groupIds = new Set(cfg.groups.map((g) => g.id));
  for (const stop of cfg.stops) {
    for (const gs of stop.groupSchedule || []) {
      if (!groupIds.has(gs.group)) {
        throw new Error(`Stop "${stop.name}": gruppo ${gs.group} inesistente`);
      }
    }
  }
  return cfg;
}

// ============================================================
// TIME HELPERS
// ============================================================

function hhmmToMin(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function resolveEventDate() {
  if (process.env.EVENT_DATE) {
    const m = process.env.EVENT_DATE.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) throw new Error(`EVENT_DATE non valida: ${process.env.EVENT_DATE}`);
    return new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
  }
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function minToDate(eventDate, totalMin) {
  const dayOffset = Math.floor(totalMin / (24 * 60));
  const within = totalMin % (24 * 60);
  const d = new Date(eventDate.getTime());
  d.setDate(d.getDate() + dayOffset);
  d.setHours(Math.floor(within / 60), within % 60, 0, 0);
  return d;
}

function fmtTime(d) {
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ============================================================
// MESSAGE TEMPLATES
// ============================================================

function tplArrival({ groupName, stopName, departureTime, note, isFinish }) {
  if (isFinish) {
    return (
      `🏁 ${groupName}, BENVENUTI AL TRAGUARDO: *${stopName}*!\n` +
      `Avete completato il Miglio d'Oro 🥇\n` +
      (note ? `\n${note}\n` : '') +
      `\nBrindate, raccontatevi la giornata e godetevi la gloria 🍻`
    );
  }
  return (
    `📍 ${groupName}, benvenuti a *${stopName}*!\n` +
    `Ripartenza prevista alle *${departureTime}*.` +
    (note ? `\n\n${note}` : '')
  );
}

function tplPrenotify({ groupName, nextStop, leadMinutes, note }) {
  if (leadMinutes === 5) {
    return (
      `⏳ ${groupName}, *5 minuti* alla partenza per *${nextStop}*.\n` +
      `Finite il bicchiere, niente fretta ma stiamo per muoverci.` +
      (note ? `\n\n${note}` : '')
    );
  }
  if (leadMinutes === 2) {
    return (
      `⚡ ${groupName}, *2 minuti*! Pronti per *${nextStop}*.\n` +
      `Pagate al banco, prendete giacche e si va.`
    );
  }
  return `⏳ ${groupName}, tra ${leadMinutes} min si parte per *${nextStop}*.`;
}

function tplDeparture({ groupName, nextStop, arrivalTime, restMinutes }) {
  return (
    `🚀 ${groupName}, si parte ORA per *${nextStop}*!\n` +
    `Arrivo previsto: *${arrivalTime}*\n` +
    `Sosta prevista: *${restMinutes} min*\n` +
    `Compatti, no dispersi 🚶‍♂️🚶‍♀️`
  );
}

// ============================================================
// BUILD EVENT LIST
// ============================================================

function buildEvents(cfg, eventDate) {
  const events = [];
  const leadTimes = cfg.event?.leadTimes || [5, 2];

  // Annunci globali
  for (const ann of cfg.globalAnnouncements || []) {
    events.push({
      id: `global:${ann.time}`,
      type: 'global',
      when: minToDate(eventDate, hhmmToMin(ann.time)),
      target: 'broadcast',
      text: ann.text,
    });
  }

  const stopsByNumber = new Map(cfg.stops.map((s) => [s.number, s]));

  for (const stop of cfg.stops) {
    const nextStop = stopsByNumber.get(stop.number + 1);
    for (const gs of stop.groupSchedule) {
      const group = cfg.groups.find((g) => g.id === gs.group);
      const arrivalMin = hhmmToMin(gs.arrival);
      const departureMin = hhmmToMin(gs.departure);

      // Arrival (skip per la tappa di partenza, c'è l'annuncio globale)
      if (!stop.isStart) {
        events.push({
          id: `arr:s${stop.number}:g${gs.group}`,
          type: 'arrival',
          when: minToDate(eventDate, arrivalMin),
          target: group.whatsappId,
          text: tplArrival({
            groupName: group.name,
            stopName: stop.name,
            departureTime: gs.departure,
            note: stop.note,
            isFinish: !!stop.isFinish,
          }),
        });
      }

      // Pre-notify + departure (solo se c'è una tappa successiva)
      if (nextStop) {
        for (const lead of leadTimes) {
          events.push({
            id: `pre:s${stop.number}:g${gs.group}:l${lead}`,
            type: 'prenotify',
            when: minToDate(eventDate, departureMin - lead),
            target: group.whatsappId,
            text: tplPrenotify({
              groupName: group.name,
              nextStop: nextStop.name,
              leadMinutes: lead,
              note: lead === 5 ? nextStop.note : null,
            }),
          });
        }

        const nextGs = nextStop.groupSchedule.find((x) => x.group === gs.group);
        const restMin = nextGs
          ? hhmmToMin(nextGs.departure) - hhmmToMin(nextGs.arrival)
          : 20;

        events.push({
          id: `dep:s${stop.number}:g${gs.group}`,
          type: 'departure',
          when: minToDate(eventDate, departureMin),
          target: group.whatsappId,
          text: tplDeparture({
            groupName: group.name,
            nextStop: nextStop.name,
            arrivalTime: nextGs ? nextGs.arrival : '',
            restMinutes: restMin,
          }),
        });
      }
    }
  }

  events.sort((a, b) => a.when.getTime() - b.when.getTime());
  return events;
}

// ============================================================
// STATE (idempotency: ricorda eventi già inviati)
// ============================================================

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { sent: [] };
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    return { sent: Array.isArray(s.sent) ? s.sent : [] };
  } catch {
    return { sent: [] };
  }
}

function markSent(state, id) {
  if (!state.sent.includes(id)) {
    state.sent.push(id);
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  }
}

// ============================================================
// BAILEYS CONNECTION
// ============================================================

async function connect({ printQr = false, onReady = null } = {}) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();
  log.info(`Connetto a WhatsApp (Baileys v${version.join('.')})…`);

  const sock = makeWASocket({
    version,
    auth: state,
    logger: baileysLogger,
    printQRInTerminal: false, // gestiamo noi il QR
    markOnlineOnConnect: false, // più discreti
  });

  return new Promise((resolve, reject) => {
    let resolved = false;
    let qrShown = false;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        if (printQr) {
          if (!qrShown) {
            log.info('🔵 Scansiona il QR (WhatsApp → Impostazioni → Dispositivi collegati):');
            qrShown = true;
          }
          qrcodeTerminal.generate(qr, { small: true });
        } else {
          log.error('Sessione non valida: serve riscansionare QR.');
          log.error('Esegui: node index.js setup');
          if (!resolved) {
            resolved = true;
            reject(new Error('No valid session - run setup'));
          }
        }
      }

      if (connection === 'open') {
        log.ok('Connesso a WhatsApp');
        if (onReady) await onReady(sock);
        if (!resolved) {
          resolved = true;
          resolve(sock);
        }
      }

      if (connection === 'close') {
        const reason = lastDisconnect?.error?.output?.statusCode;
        const reasonName = Object.keys(DisconnectReason).find(
          (k) => DisconnectReason[k] === reason
        );
        log.warn(`Disconnesso (${reasonName || reason}): ${lastDisconnect?.error?.message || ''}`);

        if (reason === DisconnectReason.loggedOut) {
          log.error('Logout dal telefono. Cancella ./auth e rifai setup.');
          if (!resolved) {
            resolved = true;
            reject(new Error('Logged out'));
          } else {
            process.exit(1);
          }
        } else if (resolved) {
          // Riconnessione automatica se eravamo già up
          log.info('Tento riconnessione tra 5s…');
          setTimeout(() => {
            connect({ printQr: false, onReady }).catch((e) => {
              log.error('Riconnessione fallita:', e.message);
              process.exit(1);
            });
          }, 5000);
        } else {
          // Disconnessione prima di essere pronto
          if (!resolved) {
            resolved = true;
            reject(lastDisconnect?.error || new Error('Connection closed'));
          }
        }
      }
    });
  });
}

// ============================================================
// COMMANDS
// ============================================================

async function cmdSetup() {
  if (fs.existsSync(AUTH_DIR) && fs.readdirSync(AUTH_DIR).length > 0) {
    log.warn(`Cartella ${AUTH_DIR} non vuota. Se vuoi riscansionare, cancellala prima:`);
    log.warn(`  rm -rf ${AUTH_DIR}`);
    log.info('Provo lo stesso a connettermi con la sessione esistente…');
  }

  const sock = await connect({ printQr: true });
  log.ok('Setup completato. Sessione salvata in ' + AUTH_DIR);
  log.info('Ora puoi eseguire: node index.js groups');
  log.info('Premi Ctrl+C per uscire.');

  // Lascia aperto qualche secondo per assicurare salvataggio creds
  await sleep(3000);
  await sock.end();
  process.exit(0);
}

async function cmdGroups() {
  // Argomento opzionale: stringa di ricerca per filtrare i gruppi per nome
  const filter = (process.argv[3] || '').toLowerCase().trim();

  const sock = await connect({ printQr: false });
  log.info('Recupero lista gruppi…');
  const groups = await sock.groupFetchAllParticipating();
  let entries = Object.entries(groups);

  // Filtra per nome se è stato passato un argomento
  if (filter) {
    entries = entries.filter(([, meta]) =>
      (meta.subject || '').toLowerCase().includes(filter)
    );
  }

  console.log('\n' + '═'.repeat(70));
  if (filter) {
    console.log(`Gruppi che contengono "${filter}": ${entries.length}`);
  } else {
    console.log(`Gruppi WhatsApp totali: ${entries.length}`);
  }
  console.log('═'.repeat(70));

  entries
    .sort(([, a], [, b]) => (a.subject || '').localeCompare(b.subject || ''))
    .forEach(([jid, meta], i) => {
      console.log(`\n[${i + 1}] ${meta.subject}`);
      console.log(`    ID:            ${jid}`);
      console.log(`    Partecipanti: ${meta.participants?.length || '?'}`);
    });

  if (entries.length > 0) {
    console.log('\n' + '═'.repeat(70));
    console.log('Copia gli ID dei gruppi del Miglio d\'Oro in schedule.json (sezione "groups").');
    console.log('Formato: 120363xxxxxxxxxxxxxx@g.us');
    console.log('═'.repeat(70));
  } else if (filter) {
    console.log('\nNessun gruppo trovato con quel filtro. Riprova con altre parole chiave.');
  }

  const me = sock.user?.id;
  if (me) {
    const cleaned = me.split(':')[0] + '@s.whatsapp.net';
    console.log(`\nIl tuo numero (per adminChatId): ${cleaned}\n`);
  }

  await sleep(2000);
  await sock.end();
  process.exit(0);
}

function cmdValidate() {
  try {
    const cfg = loadConfig();
    const eventDate = resolveEventDate();
    const events = buildEvents(cfg, eventDate);
    log.ok('Config valida.');
    console.log(`   Tappe: ${cfg.stops.length}`);
    console.log(`   Gruppi: ${cfg.groups.length}`);
    console.log(`   Eventi totali: ${events.length}`);
    const counts = events.reduce((acc, e) => ((acc[e.type] = (acc[e.type] || 0) + 1), acc), {});
    for (const [t, c] of Object.entries(counts)) console.log(`     ${t}: ${c}`);

    // Check placeholder
    const placeholders = cfg.groups.filter((g) => /REPLACE_WITH/.test(g.whatsappId)).map((g) => g.name);
    if (placeholders.length) {
      log.warn(`Attenzione: gruppi con placeholder ID: ${placeholders.join(', ')}`);
      log.warn('Esegui "node index.js groups" e popola schedule.json prima di run.');
    }
  } catch (err) {
    log.error('Config NON valida:', err.message);
    process.exit(1);
  }
}

function cmdSchedule() {
  const cfg = loadConfig();
  const eventDate = resolveEventDate();
  const events = buildEvents(cfg, eventDate);

  console.log(`\nSchedule per "${cfg.event?.name || 'evento'}"`);
  console.log(`Data: ${eventDate.toDateString()}`);
  console.log(`Eventi totali: ${events.length}\n`);
  console.log('═'.repeat(80));

  for (const ev of events) {
    const targetLabel = ev.target === 'broadcast' ? 'TUTTI I GRUPPI' : ev.target;
    console.log(`\n[${fmtTime(ev.when)}] ${ev.type.toUpperCase().padEnd(10)} → ${targetLabel}`);
    console.log(`ID: ${ev.id}`);
    console.log('─'.repeat(80));
    console.log(ev.text);
    console.log('─'.repeat(80));
  }
}

async function cmdRun() {
  const cfg = loadConfig();
  const eventDate = resolveEventDate();
  const events = buildEvents(cfg, eventDate);
  const state = loadState();

  // Check placeholder
  const placeholders = cfg.groups.filter((g) => /REPLACE_WITH/.test(g.whatsappId)).map((g) => g.name);
  if (placeholders.length) {
    log.error(`Gruppi con placeholder ID: ${placeholders.join(', ')}`);
    log.error('Esegui "node index.js groups" e popola schedule.json');
    process.exit(1);
  }

  log.info(`Evento: ${cfg.event?.name || '?'}`);
  log.info(`Data: ${eventDate.toDateString()}`);
  log.info(`Eventi totali: ${events.length}`);
  log.info(`Eventi già inviati (state): ${state.sent.length}`);

  const sock = await connect({ printQr: false });

  // Notifica admin di avvio
  if (cfg.adminChatId && !/REPLACE_WITH/.test(cfg.adminChatId)) {
    try {
      await sock.sendMessage(cfg.adminChatId, {
        text: `🤖 Bot Miglio d'Oro attivo.\nEventi schedulati: ${events.length}\nGruppi: ${cfg.groups.length}`,
      });
    } catch (e) {
      log.warn('Notifica admin fallita:', e.message);
    }
  }

  // Schedula ogni evento
  const now = new Date();
  let scheduled = 0;
  let skipped = 0;

  // Throttle: tieni traccia ultimo invio per inserire delay anti-rate-limit
  let lastSendAt = 0;
  const MIN_GAP_MS = (cfg.throttle?.minDelayMs) || 2000;
  const MAX_GAP_MS = (cfg.throttle?.maxDelayMs) || 5000;

  async function sendThrottled(jid, text) {
    const since = Date.now() - lastSendAt;
    if (since < MIN_GAP_MS) await sleep(MIN_GAP_MS - since);
    const jitter = Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS));
    if (jitter) await sleep(jitter);
    await sock.sendMessage(jid, { text });
    lastSendAt = Date.now();
  }

  for (const ev of events) {
    if (ev.when.getTime() < now.getTime() - 30 * 1000) {
      skipped++;
      continue;
    }
    if (state.sent.includes(ev.id)) {
      skipped++;
      continue;
    }

    const cronTime = ev.when;
    // node-cron non accetta Date direttamente, usiamo setTimeout calcolato
    const delayMs = cronTime.getTime() - Date.now();
    setTimeout(async () => {
      if (state.sent.includes(ev.id)) return;
      try {
        if (ev.target === 'broadcast') {
          for (const g of cfg.groups) {
            await sendThrottled(g.whatsappId, ev.text);
          }
        } else {
          await sendThrottled(ev.target, ev.text);
        }
        markSent(state, ev.id);
        log.ok(`[${fmtTime(ev.when)}] ${ev.type} → ${ev.target.substring(0, 25)}…`);
      } catch (err) {
        log.error(`${ev.id}: ${err.message}`);
        if (cfg.adminChatId && !/REPLACE_WITH/.test(cfg.adminChatId)) {
          sock.sendMessage(cfg.adminChatId, { text: `⚠️ Errore ${ev.id}: ${err.message}` }).catch(() => {});
        }
      }
    }, delayMs);
    scheduled++;
  }

  log.ok(`Schedulati ${scheduled} eventi (skip: ${skipped})`);
  log.info('Bot attivo. Tieni questa finestra aperta. Ctrl+C per fermare.');

  // Heartbeat ogni 10 min: log + check connessione
  cron.schedule('*/10 * * * *', () => {
    const remaining = events.length - state.sent.length - skipped;
    log.info(`💓 alive — eventi rimanenti: ${remaining}`);
  });

  process.on('SIGINT', async () => {
    log.info('SIGINT, chiudo…');
    try { await sock.end(); } catch {}
    process.exit(0);
  });
}

// ============================================================
// MAIN
// ============================================================

const cmd = process.argv[2];
const cmds = {
  setup: cmdSetup,
  groups: cmdGroups,
  validate: cmdValidate,
  schedule: cmdSchedule,
  run: cmdRun,
};

if (!cmd || !cmds[cmd]) {
  console.log(`
Uso: node index.js <comando>

Comandi:
  setup       Autentica via QR (una sola volta)
  groups      Stampa lista gruppi WhatsApp con ID
  validate    Verifica schedule.json
  schedule    Stampa tutti i messaggi che verranno inviati
  run         Avvia il bot in produzione

Sequenza tipica:
  npm install
  node index.js setup       # scansiona QR
  node index.js groups      # copia ID gruppi
  nano schedule.json        # riempi ID
  node index.js validate
  node index.js schedule    # rileggi i messaggi
  node index.js run         # produzione (lasciare aperto)
`);
  process.exit(cmd ? 1 : 0);
}

Promise.resolve(cmds[cmd]()).catch((err) => {
  log.error('Fatale:', err.message);
  process.exit(1);
});
