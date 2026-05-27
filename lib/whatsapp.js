// lib/whatsapp.js — connessione Baileys + invio throttlato + router messaggi inbound.
const path = require('path');
const qrcodeTerminal = require('qrcode-terminal');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const { log } = require('./logger');
const { sleep } = require('./time');
const { dispatch } = require('./commands/_registry');
const { effectiveGroupId } = require('./events');

const AUTH_DIR = path.join(__dirname, '..', 'auth');

// Logger silenzioso per Baileys (i suoi log sono molto verbosi)
const baileysLogger = pino({ level: 'silent' });

// ============================================================
// CONNESSIONE
// ============================================================
// session.sock viene SOSTITUITO dopo ogni riconnessione. I chiamanti devono
// leggerlo al momento dell'uso, non salvarne una copia.
// onMessages (se passato) viene riagganciato a OGNI socket → sopravvive ai reconnect.
async function createSession({ printQr = false, onReady = null, onReconnect = null, onMessages = null } = {}) {
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
    if (onMessages) sock.ev.on('messages.upsert', onMessages);

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
          const reasonName = Object.keys(DisconnectReason).find((k) => DisconnectReason[k] === reason);
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

          // Backoff: 2s per restartRequired, altrimenti exponential capped (max 60s).
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
              .then((newSock) => { if (!settled) { settled = true; resolve(newSock); } })
              .catch((e) => {
                log.error(`Riconnessione fallita: ${e.message}`);
                if (!settled) { settled = true; reject(e); }
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
// INVIO THROTTLATO + NOTIFICA ADMIN
// ============================================================
function makeSender(session, cfg) {
  let lastSendAt = 0;
  const MIN_GAP_MS = cfg.throttle?.minDelayMs || 2000;
  const MAX_GAP_MS = cfg.throttle?.maxDelayMs || 5000;
  const adminEnabled = cfg.adminChatId && !/REPLACE_WITH/.test(cfg.adminChatId);

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

  async function notifyAdmin(text, sock) {
    if (!adminEnabled) return;
    const s = sock || session.sock;
    if (!s) return;
    try { await s.sendMessage(cfg.adminChatId, { text }); }
    catch (e) { log.warn('Notifica admin fallita:', e.message); }
  }

  return { sendThrottled, notifyAdmin, waitForSocket };
}

// ============================================================
// ROUTER MESSAGGI INBOUND
// ============================================================
function extractText(message) {
  return (
    message.conversation ||
    message.extendedTextMessage?.text ||
    message.imageMessage?.caption ||
    message.videoMessage?.caption ||
    ''
  );
}

// Risponde SOLO a messaggi dal gruppo configurato o in DM dall'admin.
// Tutto il resto è ignorato in silenzio (no leak che esista un bot).
function makeInboundRouter({ cfg, sender, ctxFactory }) {
  const allowedChats = new Set([cfg.group.whatsappId, effectiveGroupId(cfg)]);
  return async (upsert) => {
    if (upsert.type !== 'notify') return;
    for (const msg of upsert.messages || []) {
      try {
        if (!msg.message || msg.key.fromMe) continue;
        const chatId = msg.key.remoteJid;
        if (!chatId) continue;
        const isGroup = chatId.endsWith('@g.us');
        const allowed = allowedChats.has(chatId) || (!isGroup && chatId === cfg.adminChatId);
        if (!allowed) continue;
        const text = extractText(msg.message).trim();
        if (!text.startsWith('/')) continue;
        const reply = await dispatch(text, ctxFactory());
        if (reply) await sender.sendThrottled(chatId, reply);
      } catch (e) {
        log.error('inbound:', e.message);
      }
    }
  };
}

module.exports = { createSession, makeSender, makeInboundRouter, AUTH_DIR };
