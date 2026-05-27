// /domani — tappe di domani (notify 🔔 + info 📍), ordinate per orario.
const { formatDayStops } = require('../format');

module.exports = {
  desc: 'Programma di domani',
  handler: async (args, ctx) => {
    const stops = ctx.stopsForDay(ctx.tomorrow);
    if (!stops.length) return `📅 Domani (${ctx.dayLabel(ctx.tomorrow)}) niente in programma.`;
    return `📅 *Domani — ${ctx.dayLabel(ctx.tomorrow)}*\n\n${formatDayStops(stops)}`;
  },
};
