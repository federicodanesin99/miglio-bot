// lib/mvp.js — votazione "MVP del viaggio": ogni partecipante ha un budget
// giornaliero di punti (default 10) da assegnare AGLI ALTRI (mai a se stesso).
// A fine viaggio il bot espone la classifica (somma dei punti RICEVUTI).
//
// Il budget giornaliero È il meccanismo di equità: niente normalizzazione
// statistica, ogni votante pesa al massimo `dailyBudget` punti/giorno. Chi finisce
// i punti non vota più fino alla mezzanotte (reset all'inizio del giorno dopo, TZ
// trip = process.env.TZ).
//
// Stato PERSISTENTE su votes.json (i record grezzi permettono di ricalcolare budget,
// classifica e mostrare i motivi nel reveal). Separato da state.json (solo ledger
// eventi). Forma: { votes:[{voter,recipient,points,reason,day,ts}], names:{jid:nome} }.
const fs = require('fs');
const path = require('path');
const { dayKey } = require('./time');

const DEFAULT_STORE = path.join(__dirname, '..', 'votes.json');

// jid → etichetta breve di fallback (numero senza dominio WhatsApp).
function shortJid(jid) {
  return String(jid || '').split('@')[0].split(':')[0] || '?';
}

// makeMvp({ dailyBudget, store, names }):
//   dailyBudget — punti/giorno per votante (default 10)
//   store       — percorso del file json (default ./votes.json)
//   names       — mappa { jid: "Nome" } da config (cfg.mvp.names), priorità massima
function makeMvp({ dailyBudget = 10, store = DEFAULT_STORE, names = {} } = {}) {
  const budget = Number(dailyBudget) > 0 ? Number(dailyBudget) : 10;
  let participants = new Set();

  function load() {
    if (!fs.existsSync(store)) return { votes: [], names: {} };
    try {
      const s = JSON.parse(fs.readFileSync(store, 'utf8'));
      return { votes: Array.isArray(s.votes) ? s.votes : [], names: s.names || {} };
    } catch {
      return { votes: [], names: {} };
    }
  }
  let data = load();

  function persist() {
    fs.writeFileSync(store, JSON.stringify({ votes: data.votes, names: data.names }, null, 2));
  }

  // Roster: chi può ricevere/dare punti. Aggiornato dal gruppo in run.
  function setParticipants(jids) {
    participants = new Set((jids || []).filter(Boolean));
  }
  function isParticipant(jid) {
    // Se il roster non è ancora popolato (es. fetch fallito), non bloccare i voti.
    return participants.size === 0 || participants.has(jid);
  }

  // Cache nomi appresa dai messaggi (pushName). Non sovrascrive la config.
  function noteName(jid, pushName) {
    if (!jid || !pushName) return;
    if (data.names[jid] === pushName) return;
    data.names[jid] = pushName;
    persist();
  }
  function displayName(jid) {
    return names[jid] || data.names[jid] || shortJid(jid);
  }

  // Token da inserire in un messaggio per "mostrare" una persona:
  //  - se c'è un soprannome in cfg.mvp.names → testo semplice (niente ping)
  //  - altrimenti → MENZIONE WhatsApp (@numero) + il jid va in `mentions`, così
  //    WhatsApp mostra il nome in rubrica e notifica la persona.
  // Ritorna { text, mention } dove mention è il jid da accumulare (o null).
  function nameToken(jid) {
    if (names[jid]) return { text: `*${names[jid]}*`, mention: null };
    return { text: `@${shortJid(jid)}`, mention: jid };
  }

  // Punti già spesi da `voter` nel giorno `day`.
  function dailySpent(voter, day) {
    return data.votes
      .filter((v) => v.voter === voter && v.day === day)
      .reduce((sum, v) => sum + (v.points || 0), 0);
  }

  // Registra un voto. Ritorna { ok, remaining, error }.
  function castVote({ voter, recipient, points, reason = '', day, ts = 0 }) {
    if (!voter || !recipient) return { ok: false, error: 'Voto non valido.' };
    if (voter === recipient) return { ok: false, error: 'Non puoi votare te stesso 😉' };
    if (!isParticipant(recipient)) return { ok: false, error: 'Il destinatario non è nel gruppo.' };
    const p = Math.floor(Number(points));
    if (!Number.isFinite(p) || p < 1) return { ok: false, error: 'I punti devono essere un numero ≥ 1.' };
    if (p > budget) return { ok: false, error: `Massimo ${budget} punti per voto.` };

    const spent = dailySpent(voter, day);
    const remaining = budget - spent;
    if (p > remaining) {
      return remaining <= 0
        ? { ok: false, error: `Hai già speso tutti i ${budget} punti di oggi. Ricarichi a mezzanotte ⏳` }
        : { ok: false, error: `Ti restano solo *${remaining}* punti oggi (ne hai chiesti ${p}).` };
    }

    data.votes.push({ voter, recipient, points: p, reason: String(reason).trim(), day, ts });
    persist();
    return { ok: true, remaining: remaining - p };
  }

  // Classifica: [{ jid, total, count }] per punti RICEVUTI, desc.
  function leaderboard() {
    const tally = new Map();
    for (const v of data.votes) {
      const cur = tally.get(v.recipient) || { jid: v.recipient, total: 0, count: 0 };
      cur.total += v.points || 0;
      cur.count += 1;
      tally.set(v.recipient, cur);
    }
    return [...tally.values()].sort((a, b) => b.total - a.total || a.jid.localeCompare(b.jid));
  }

  // Motivi salienti per un destinatario (i voti col motivo più "ricco", max n).
  function topReasons(jid, n = 3) {
    return data.votes
      .filter((v) => v.recipient === jid && v.reason)
      .sort((a, b) => b.points - a.points)
      .slice(0, n)
      .map((v) => `   • ${v.points}p — ${v.reason}`);
  }

  const MEDALS = ['🥇', '🥈', '🥉'];

  // Classifica corrente formattata. Ritorna { text, mentions } (le persone senza
  // soprannome in config vengono TAGGATE → WhatsApp mostra nome + notifica).
  function leaderboardText() {
    const board = leaderboard();
    if (!board.length) {
      return { text: '🏆 *Classifica MVP*\n\n_Ancora nessun punto assegnato. Vota con_ */mvp @nome punti motivo*', mentions: [] };
    }
    const mentions = [];
    const lines = board.map((e, i) => {
      const nt = nameToken(e.jid);
      if (nt.mention) mentions.push(nt.mention);
      const tag = MEDALS[i] || `${i + 1}.`;
      return `${tag} ${nt.text} — ${e.total} pt`;
    });
    return { text: `🏆 *Classifica MVP*\n\n${lines.join('\n')}`, mentions };
  }

  // Reveal finale: podio + motivi salienti dei primi. Ritorna { text, mentions }.
  function revealText() {
    const board = leaderboard();
    if (!board.length) {
      return { text: '🏆 *MVP del viaggio*\n\nNessun voto è arrivato… vincono tutti a pari merito! 🤝', mentions: [] };
    }
    const mentions = [];
    const lines = [];
    board.slice(0, 5).forEach((e, i) => {
      const nt = nameToken(e.jid);
      if (nt.mention) mentions.push(nt.mention);
      const tag = MEDALS[i] || `${i + 1}.`;
      lines.push(`${tag} ${nt.text} — *${e.total}* pt (${e.count} voti)`);
      if (i < 3) lines.push(...topReasons(e.jid, 2));
    });
    const win = nameToken(board[0].jid);
    if (win.mention) mentions.push(win.mention);
    return {
      text: `🏆 *MVP DEL VIAGGIO — Classifica finale* 🏆\n\n${lines.join('\n')}\n\n🎉 Vince ${win.text}! Applausi 👏`,
      mentions: [...new Set(mentions)],
    };
  }

  // Riepilogo dettagliato: per ogni destinatario, i voti RICEVUTI con punti,
  // motivo e chi glieli ha dati. Ordinato per punti totali ricevuti (desc).
  // Ritorna { text, mentions } — destinatari e votanti senza soprannome vengono
  // taggati (mentions deduplicate).
  function breakdownText() {
    if (!data.votes.length) {
      return { text: '📋 *Riepilogo voti MVP*\n\n_Ancora nessun voto._', mentions: [] };
    }
    // Raggruppo i voti per destinatario.
    const byRecipient = new Map();
    for (const v of data.votes) {
      if (!byRecipient.has(v.recipient)) byRecipient.set(v.recipient, []);
      byRecipient.get(v.recipient).push(v);
    }
    // Ordino i destinatari per punti totali ricevuti (come la classifica).
    const order = leaderboard();
    const mentions = [];
    const tag = (jid) => {
      const nt = nameToken(jid);
      if (nt.mention) mentions.push(nt.mention);
      return nt.text;
    };
    const blocks = order.map((e) => {
      const votes = (byRecipient.get(e.jid) || []).slice().sort((a, b) => b.points - a.points);
      const head = `${tag(e.jid)} — *${e.total}* pt (${e.count} voti)`;
      const lines = votes.map((v) => {
        const why = v.reason ? ` _${v.reason}_` : '';
        return `   • +${v.points} da ${tag(v.voter)}${why ? ' —' + why : ''}`;
      });
      return [head, ...lines].join('\n');
    });
    return {
      text: `📋 *Riepilogo voti MVP*\n\n${blocks.join('\n\n')}`,
      mentions: [...new Set(mentions)],
    };
  }

  // Stato per un votante: budget residuo oggi + classifica. { text, mentions }.
  function statusText(voter, day) {
    const head = voter
      ? `🎯 Oggi ti restano *${Math.max(0, budget - dailySpent(voter, day))}*/${budget} punti.\n_Vota con_ */mvp @nome punti motivo*\n\n`
      : '';
    const board = leaderboardText();
    return { text: head + board.text, mentions: board.mentions };
  }

  return {
    setParticipants, isParticipant, noteName, displayName, nameToken,
    dailySpent, castVote, leaderboard, leaderboardText, breakdownText, revealText, statusText,
    budget,
  };
}

module.exports = { makeMvp };
