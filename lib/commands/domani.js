// /domani — tappe di domani (notify 🔔 + info 📍), ordinate per orario.
module.exports = {
  desc: 'Programma di domani',
  handler: async (args, ctx) => {
    const stops = ctx.stopsForDay(ctx.tomorrow);
    if (!stops.length) return `📅 Domani (${ctx.dayLabel(ctx.tomorrow)}) niente in programma.`;
    const lines = stops.map((s) => {
      const flag = s.notify ? '🔔' : '📍';
      const maps = s.location?.maps ? `\n   ${s.location.maps}` : '';
      return `${flag} *${s.time}* · ${s.title}${maps}`;
    });
    return `📅 *Domani — ${ctx.dayLabel(ctx.tomorrow)}*\n\n${lines.join('\n')}`;
  },
};
