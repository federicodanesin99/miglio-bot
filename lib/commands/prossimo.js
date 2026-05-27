// /prossimo — la prima tappa con orario ≥ adesso (anche oltre oggi).
module.exports = {
  desc: 'La prossima tappa in programma',
  handler: async (args, ctx) => {
    const upcoming = (ctx.cfg.stops || [])
      .map((s) => ({ s, when: ctx.stopDateTime(s) }))
      .filter((x) => x.when.getTime() >= ctx.now.getTime())
      .sort((a, b) => a.when.getTime() - b.when.getTime());
    if (!upcoming.length) return '🏁 Non ci sono altre tappe in programma. Viaggio finito!';
    const { s } = upcoming[0];
    const flag = s.notify ? '🔔' : '📍';
    const maps = s.location?.maps ? `\n${s.location.maps}` : '';
    return `${flag} *Prossima tappa*\n${ctx.dayLabel(s.day)} · *${s.time}*\n${s.title}${maps}`;
  },
};
