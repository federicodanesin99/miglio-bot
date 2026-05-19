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
const LOG_DIR = path.join(__dirname, 'logs');

// Logger silenzioso per Baileys (i suoi log sono molto verbosi)
const baileysLogger = pino({ level: 'silent' });

// Sleep helper
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// File log (attivato solo da cmdRun via initFileLog)
let logStream = null;
let logFilePath = null;

function initFileLog() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  logFilePath = path.join(LOG_DIR, `bot-${date}.log`);
  logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  logStream.write(`\n===== ${new Date().toISOString()} bot start (pid ${process.pid}) =====\n`);
  return logFilePath;
}

function writeFileLog(level, args) {
  if (!logStream) return;
  const parts = args.map((a) => {
    if (a instanceof Error) return a.stack || a.message;
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  });
  logStream.write(`${new Date().toISOString()} ${level} ${parts.join(' ')}\n`);
}

// Log strutturato semplice (stdout + file se inizializzato)
const log = {
  info: (...a) => { console.log(new Date().toLocaleTimeString('it-IT'), 'INFO ', ...a); writeFileLog('INFO ', a); },
  warn: (...a) => { console.log(new Date().toLocaleTimeString('it-IT'), 'WARN ', ...a); writeFileLog('WARN ', a); },
  error: (...a) => { console.error(new Date().toLocaleTimeString('it-IT'), 'ERROR', ...a); writeFileLog('ERROR', a); },
  ok: (...a) => { console.log(new Date().toLocaleTimeString('it-IT'), '✓    ', ...a); writeFileLog('OK   ', a); },
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

  // Applica il fuso orario dichiarato in config a tutte le successive operazioni sulle Date
  if (cfg.event?.timezone) {
    process.env.TZ = cfg.event.timezone;
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

function tplArrival({ groupName, stopName, departureTime, isFinish }) {
  if (isFinish) {
    return (
      `🏁 ${groupName}, BENVENUTI AL TRAGUARDO: *${stopName}*!\n` +
      `Avete completato il Miglio d'Oro 🥇\n` +
      `\nBrindate, raccontatevi la giornata e godetevi la gloria 🍻`
    );
  }
  return (
    `📍 ${groupName}, benvenuti a *${stopName}*!\n` +
    `Ripartenza prevista alle *${departureTime}*.`
  );
}

function tplPrenotify({ groupName, nextStop, leadMinutes, note, groupNote }) {
  if (leadMinutes === 5) {
    const extras = [note, groupNote].filter(Boolean).join('\n\n');
    return (
      `⏳ ${groupName}, *5 minuti* alla partenza per *${nextStop}*.\n` +
      `Finite il bicchiere, niente fretta ma stiamo per muoverci.` +
      (extras ? `\n\n${extras}` : '')
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
            isFinish: !!stop.isFinish,
          }),
        });
      }

      // Game event (arrival + 10min) — solo per tappe intermedie
      if (!stop.isStart && !stop.isFinish) {
        const gameKey = cfg.gameAssignment?.[String(stop.number)];
        const gameDef = gameKey && cfg.games?.[gameKey];
        if (gameDef && gameDef.text) {
          const isMention = gameKey === 're_regina';
          events.push({
            id: `game:s${stop.number}:g${gs.group}`,
            type: 'game',
            when: minToDate(eventDate, arrivalMin + 10),
            target: group.whatsappId,
            gameKey,
            isMention,
            text: `🎮 *GIOCO DELLA TAPPA*\n\n${gameDef.text}`,
          });
        }
      }

      // Pre-notify + departure (solo se c'è una tappa successiva)
      if (nextStop) {
        const nextGsForGroup = nextStop.groupSchedule.find((x) => x.group === gs.group);
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
              groupNote: lead === 5 ? (nextGsForGroup && nextGsForGroup.groupNote) : null,
            }),
          });
        }

        const restMin = nextGsForGroup
          ? hhmmToMin(nextGsForGroup.departure) - hhmmToMin(nextGsForGroup.arrival)
          : 20;

        events.push({
          id: `dep:s${stop.number}:g${gs.group}`,
          type: 'departure',
          when: minToDate(eventDate, departureMin),
          target: group.whatsappId,
          text: tplDeparture({
            groupName: group.name,
            nextStop: nextStop.name,
            arrivalTime: nextGsForGroup ? nextGsForGroup.arrival : '',
            restMinutes: restMin,
          }),
        });
      }
    }
  }

  // AfterMiglio broadcasts
  if (cfg.afterMiglio?.enabled) {
    for (const m of cfg.afterMiglio.messages || []) {
      events.push({
        id: `after:${m.time}`,
        type: 'after',
        when: minToDate(eventDate, hhmmToMin(m.time)),
        target: 'broadcast',
        text: m.text,
      });
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

// createSession crea un "session holder" il cui campo .sock viene SOSTITUITO
// dopo ogni riconnessione. I chiamanti (sendThrottled, heartbeat, ecc.)
// devono leggere session.sock al momento dell'uso, NON salvarne una copia.
async function createSession({ printQr = false, onReady = null, onReconnect = null } = {}) {
  const session = {
    sock: null,
    closed: false,
    reconnectAttempt: 0,
    end: async () => {
      session.closed = true;
      if (session.sock) {
        try { session.sock.ev.removeAllListeners(); } catch {}
        try { await session.sock.end(); } catch {}
      }
    },
  };

  const { state: authState, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  async function openSocket(isReconnect) {
    if (session.closed) throw new Error('Session closed');

    // Dismetti il socket precedente, se presente
    if (session.sock) {
      const prev = session.sock;
      session.sock = null;
      try { prev.ev.removeAllListeners(); } catch {}
      try { await prev.end(); } catch {}
      log.info('🔌 Socket precedente chiuso e dereferenziato');
    }

    if (isReconnect) {
      session.reconnectAttempt++;
      log.info(`🔄 Riconnessione #${session.reconnectAttempt} a WhatsApp (Baileys v${version.join('.')})…`);
    } else {
      log.info(`Connetto a WhatsApp (Baileys v${version.join('.')})…`);
    }

    const sock = makeWASocket({
      version,
      auth: authState,
      logger: baileysLogger,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
    });
    session.sock = sock;

    return new Promise((resolve, reject) => {
      let settled = false;
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
            if (!settled) { settled = true; reject(new Error('No valid session - run setup')); }
          }
        }

        if (connection === 'open') {
          if (isReconnect) {
            log.ok(`🟢 Riconnesso a WhatsApp (tentativo #${session.reconnectAttempt})`);
            session.reconnectAttempt = 0;
            if (onReconnect) {
              try { await onReconnect(sock); }
              catch (e) { log.error('onReconnect ha sollevato:', e.message); }
            }
          } else {
            log.ok('Connesso a WhatsApp');
            if (onReady) {
              try { await onReady(sock); }
              catch (e) { log.error('onReady ha sollevato:', e.message); }
            }
          }
          if (!settled) { settled = true; resolve(sock); }
        }

        if (connection === 'close') {
          const reason = lastDisconnect?.error?.output?.statusCode;
          const reasonName = Object.keys(DisconnectReason).find(
            (k) => DisconnectReason[k] === reason
          );
          const reasonLabel = reasonName || reason || 'unknown';
          log.warn(`⚠️  Disconnesso (${reasonLabel}): ${lastDisconnect?.error?.message || ''}`);

          if (session.closed) return;

          if (reason === DisconnectReason.loggedOut) {
            log.error('Logout dal telefono. Cancella ./auth e rifai setup.');
            session.closed = true;
            if (!settled) { settled = true; reject(new Error('Logged out')); }
            else process.exit(1);
            return;
          }

          // Riconnessione automatica per tutti gli altri casi.
          // Backoff: 2s per restartRequired (primo restart post-pairing/update),
          // altrimenti exponential capped (5s, 10s, 20s, 40s, max 60s).
          let delayMs;
          if (reason === DisconnectReason.restartRequired) {
            delayMs = 2000;
          } else {
            const attempt = Math.min(session.reconnectAttempt, 5);
            delayMs = Math.min(60000, 5000 * Math.pow(2, attempt));
          }
          log.info(`🔄 Riconnessione automatica tra ${(delayMs / 1000).toFixed(0)}s (motivo: ${reasonLabel})…`);

          setTimeout(() => {
            if (session.closed) return;
            openSocket(true)
              .then((newSock) => {
                if (!settled) { settled = true; resolve(newSock); }
              })
              .catch((e) => {
                log.error(`Riconnessione fallita: ${e.message}`);
                if (!settled) { settled = true; reject(e); }
                // se eravamo già up, openSocket schedulerà un altro retry via il prossimo 'close'
              });
          }, delayMs);
        }
      });
    });
  }

  await openSocket(false);
  return session;
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

  const session = await createSession({ printQr: true });
  log.ok('Setup completato. Sessione salvata in ' + AUTH_DIR);

  // Dopo restartRequired e riconnessione, lascia tempo per il sync iniziale
  // (lista chat, gruppi, ecc.). Baileys lo fa in background.
  log.info('Attendo 15s per sync iniziale (chat, gruppi, contatti)…');
  await sleep(15000);

  log.ok('Sessione pronta. Ora puoi eseguire: node index.js groups');
  await session.end();
  process.exit(0);
}

async function cmdGroups() {
  // Argomenti: lista di nomi esatti da cercare (case-insensitive)
  // Es: node index.js groups s1 s2 s3
  // Se nessun argomento, mostra tutti i gruppi.
  const searchTerms = process.argv.slice(3).map((s) => s.toLowerCase().trim()).filter(Boolean);

  const session = await createSession({ printQr: false });
  const sock = session.sock;
  log.info('Recupero lista gruppi…');
  const groups = await sock.groupFetchAllParticipating();
  let entries = Object.entries(groups);

  // Match esatto del nome (case-insensitive) contro uno qualsiasi dei termini
  if (searchTerms.length > 0) {
    entries = entries.filter(([, meta]) => {
      const name = (meta.subject || '').toLowerCase().trim();
      return searchTerms.includes(name);
    });
  }

  console.log('\n' + '═'.repeat(70));
  if (searchTerms.length > 0) {
    console.log(`Cerco match esatti per: ${searchTerms.map((s) => `"${s}"`).join(', ')}`);
    console.log(`Trovati: ${entries.length}`);
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

  // Segnala i termini cercati che non hanno match
  if (searchTerms.length > 0) {
    const foundNames = new Set(entries.map(([, meta]) => (meta.subject || '').toLowerCase().trim()));
    const notFound = searchTerms.filter((t) => !foundNames.has(t));
    if (notFound.length > 0) {
      console.log('\n' + '─'.repeat(70));
      console.log(`⚠️  Nessun gruppo trovato con nome esatto: ${notFound.map((s) => `"${s}"`).join(', ')}`);
      console.log('   (la ricerca è case-insensitive ma deve essere il nome esatto)');
    }
  }

  if (entries.length > 0) {
    console.log('\n' + '═'.repeat(70));
    console.log('Copia gli ID nei campi "whatsappId" di schedule.json (sezione "groups").');
    console.log('Formato atteso: 120363xxxxxxxxxxxxxx@g.us');
    console.log('═'.repeat(70));
  }

  const me = sock.user?.id;
  if (me) {
    const cleaned = me.split(':')[0] + '@s.whatsapp.net';
    console.log(`\nIl tuo numero (per adminChatId): ${cleaned}\n`);
  }

  await sleep(2000);
  await session.end();
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
  // Inizializza file di log (solo in produzione)
  const logFile = initFileLog();
  log.info(`📝 File di log: ${logFile}`);

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

  const session = await createSession({
    printQr: false,
    onReconnect: async (newSock) => {
      log.info(`🔁 Socket sostituito: gli invii pendenti useranno la nuova connessione (user: ${newSock.user?.id || '?'})`);
      if (cfg.adminChatId && !/REPLACE_WITH/.test(cfg.adminChatId)) {
        try {
          await newSock.sendMessage(cfg.adminChatId, { text: '🔁 Bot riconnesso a WhatsApp.' });
        } catch (e) {
          log.warn('Notifica admin (riconnessione) fallita:', e.message);
        }
      }
    },
  });

  // Notifica admin di avvio
  if (cfg.adminChatId && !/REPLACE_WITH/.test(cfg.adminChatId)) {
    try {
      await session.sock.sendMessage(cfg.adminChatId, {
        text: `🤖 Bot Miglio d'Oro attivo.\nEventi schedulati: ${events.length}\nGruppi: ${cfg.groups.length}\nLog: ${logFile}`,
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

  // IMPORTANTE: leggiamo session.sock al momento dell'invio.
  // Se è in corso una riconnessione, attendiamo brevemente che torni disponibile.
  async function waitForSocket(timeoutMs = 60000) {
    const start = Date.now();
    while (!session.sock && !session.closed) {
      if (Date.now() - start > timeoutMs) throw new Error('Timeout attesa socket');
      await sleep(500);
    }
    if (session.closed) throw new Error('Sessione chiusa');
    return session.sock;
  }

  async function sendThrottled(jid, text, mentions = null) {
    const since = Date.now() - lastSendAt;
    if (since < MIN_GAP_MS) await sleep(MIN_GAP_MS - since);
    const jitter = Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS));
    if (jitter) await sleep(jitter);
    const sock = await waitForSocket();
    const payload = mentions && mentions.length ? { text, mentions } : { text };
    await sock.sendMessage(jid, payload);
    lastSendAt = Date.now();
  }

  async function resolveReReginaMessage(jid, rawText) {
    const sock = await waitForSocket();
    const meta = await sock.groupMetadata(jid);
    const myId = sock.user?.id?.replace(/:\d+/, '');
    const participants = (meta.participants || [])
      .map((p) => p.id)
      .filter((id) => id && id !== myId);
    if (participants.length === 0) {
      return { text: rawText.replace('{MENTION}', '@qualcuno'), mentions: [] };
    }
    const picked = participants[Math.floor(Math.random() * participants.length)];
    const handle = `@${picked.split('@')[0]}`;
    return { text: rawText.replace('{MENTION}', handle), mentions: [picked] };
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

    const delayMs = ev.when.getTime() - Date.now();
    setTimeout(async () => {
      if (state.sent.includes(ev.id)) return;
      try {
        if (ev.target === 'broadcast') {
          for (const g of cfg.groups) {
            await sendThrottled(g.whatsappId, ev.text);
          }
        } else if (ev.type === 'game' && ev.isMention) {
          const { text, mentions } = await resolveReReginaMessage(ev.target, ev.text);
          await sendThrottled(ev.target, text, mentions);
        } else {
          await sendThrottled(ev.target, ev.text);
        }
        markSent(state, ev.id);
        log.ok(`[${fmtTime(ev.when)}] ${ev.type} → ${ev.target.substring(0, 25)}…`);
      } catch (err) {
        log.error(`${ev.id}: ${err.message}`);
        if (cfg.adminChatId && !/REPLACE_WITH/.test(cfg.adminChatId) && session.sock) {
          session.sock.sendMessage(cfg.adminChatId, { text: `⚠️ Errore ${ev.id}: ${err.message}` }).catch(() => {});
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
    const sockState = session.sock ? 'connesso' : 'in riconnessione';
    log.info(`💓 alive — eventi rimanenti: ${remaining} — socket: ${sockState}`);
  });

  process.on('SIGINT', async () => {
    log.info('SIGINT, chiudo…');
    await session.end();
    if (logStream) logStream.end();
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
