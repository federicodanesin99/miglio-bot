// /oggi — tappe di oggi (notify 🔔 + info 📍), ordinate per orario.
module.exports = {
  desc: 'Programma di oggi',
  handler: async (args, ctx) => {
    const stops = ctx.stopsForDay(ctx.today);
    if (!stops.length) return `📅 Oggi (${ctx.dayLabel(ctx.today)}) niente in programma. Giornata libera 😎`;
    const lines = stops.map((s) => {
      const flag = s.notify ? '🔔' : '📍';
      const maps = s.location?.maps ? `\n   ${s.location.maps}` : '';
      return `${flag} *${s.time}* · ${s.title}${maps}`;
    });
    return `📅 *Oggi — ${ctx.dayLabel(ctx.today)}*\n\n${lines.join('\n')}`;
  },
};
