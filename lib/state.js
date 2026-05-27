// lib/state.js — ledger degli eventi già inviati (idempotenza, safe-to-restart).
// Cancella state.json per rimandare tutto; tienilo per riprendere dove eri.
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', 'state.json');

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return { sent: [], sentSet: new Set() };
  try {
    const s = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const sent = Array.isArray(s.sent) ? s.sent : [];
    return { sent, sentSet: new Set(sent) };
  } catch {
    return { sent: [], sentSet: new Set() };
  }
}

function markSent(state, id) {
  if (!state.sentSet.has(id)) {
    state.sentSet.add(id);
    state.sent.push(id);
    fs.writeFileSync(STATE_FILE, JSON.stringify({ sent: state.sent }, null, 2));
  }
}

function clearState() {
  try { fs.unlinkSync(STATE_FILE); } catch {}
}

module.exports = { loadState, markSent, clearState, STATE_FILE };
