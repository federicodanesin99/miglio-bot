// /dove <query> — match parziale (case-insensitive) su title o location.name.
module.exports = {
  desc: 'Cerca un luogo: /dove <nome>',
  handler: async (args, ctx) => {
    const q = (args || '').trim().toLowerCase();
    if (!q) return 'Uso: /dove <nome>  (es. /dove barra)';
    const matches = (ctx.cfg.stops || []).filter(
      (s) => s.title.toLowerCase().includes(q) || (s.location?.name || '').toLowerCase().includes(q),
    );
    if (!matches.length) return `🔍 Nessun risultato per "${args.trim()}".`;
    if (matches.length === 1) {
      const s = matches[0];
      const maps = s.location?.maps ? `\n${s.location.maps}` : '';
      return `📍 *${s.title}*\n${ctx.dayLabel(s.day)} · ${s.time}${maps}`;
    }
    const lines = matches.map((s) => {
      const maps = s.location?.maps ? `\n   ${s.location.maps}` : '';
      return `• *${s.title}* (${ctx.dayLabel(s.day)} ${s.time})${maps}`;
    });
    return `🔍 ${matches.length} risultati per "${args.trim()}":\n\n${lines.join('\n')}`;
  },
};
