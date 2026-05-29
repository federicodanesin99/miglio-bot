// /mvp — assegna punti MVP a un partecipante, o (senza argomenti) mostra il tuo
// budget residuo + classifica. Sintassi: /mvp @nome <punti> [motivo].
// Il destinatario arriva dalle menzioni WhatsApp (ctx.mentions), non dal testo.
const USAGE =
  'ℹ️ *Come si vota:*\n*/mvp @nome punti motivo*\n' +
  'Es: /mvp @Marco 3 ci ha salvato col traghetto\n\n' +
  '_Punti obbligatori, motivo consigliato. Hai un budget giornaliero da distribuire (non a te stesso)._';

module.exports = {
  desc: '🏆 Assegna punti MVP: /mvp @nome punti motivo',
  handler: async (args, ctx) => {
    const mvp = ctx.mvp;
    // Path di test/offline senza store: degrada senza crashare.
    if (!mvp) return USAGE;

    const text = String(args || '').trim();
    if (!text) return mvp.statusText(ctx.voter, ctx.today);

    const recipient = (ctx.mentions || [])[0];
    if (!recipient) return `❌ Devi *menzionare* la persona da votare.\n\n${USAGE}`;

    // Tolgo i token-menzione (@...) e cerco il primo intero = punti; il resto = motivo.
    const tokens = text.split(/\s+/).filter((t) => !t.startsWith('@'));
    const idx = tokens.findIndex((t) => /^\+?\d+$/.test(t));
    if (idx === -1) return `❌ Manca il *punteggio*.\n\n${USAGE}`;
    const points = parseInt(tokens[idx], 10);
    const reason = tokens.slice(0, idx).concat(tokens.slice(idx + 1)).join(' ').trim();

    const res = mvp.castVote({ voter: ctx.voter, recipient, points, reason, day: ctx.today, ts: ctx.ts });
    if (!res.ok) return `❌ ${res.error}`;
    const nt = mvp.nameToken(recipient); // tagga il votato (o soprannome se in config)
    const why = reason ? ` — _${reason}_` : '';
    return {
      text: `✅ +${points} a ${nt.text}${why}\n🎯 Ti restano *${res.remaining}* punti oggi.`,
      mentions: nt.mention ? [nt.mention] : [],
    };
  },
};
