// lib/logger.js — logging su console + file giornaliero (logs/bot-YYYY-MM-DD.log)
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

let logStream = null;

function initFileLog() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const logFilePath = path.join(LOG_DIR, `bot-${date}.log`);
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

function closeLog() {
  if (logStream) { logStream.end(); logStream = null; }
}

const log = {
  info: (...a) => { console.log(new Date().toLocaleTimeString('it-IT'), 'INFO ', ...a); writeFileLog('INFO ', a); },
  warn: (...a) => { console.log(new Date().toLocaleTimeString('it-IT'), 'WARN ', ...a); writeFileLog('WARN ', a); },
  error: (...a) => { console.error(new Date().toLocaleTimeString('it-IT'), 'ERROR', ...a); writeFileLog('ERROR', a); },
  ok: (...a) => { console.log(new Date().toLocaleTimeString('it-IT'), '✓    ', ...a); writeFileLog('OK   ', a); },
};

module.exports = { initFileLog, closeLog, log, LOG_DIR };
