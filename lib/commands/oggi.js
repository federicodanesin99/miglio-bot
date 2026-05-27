// /oggi — tappe di oggi (notify 🔔 + info 📍), ordinate per orario.
const { formatDayStops } = require('../format');

module.exports = {
  desc: 'Programma di oggi',
  handler: async (args, ctx) => {
    const stops = ctx.stopsForDay(ctx.today);
    if (!stops.length) return `📅 Oggi (${ctx.dayLabel(ctx.today)}) niente in programma. Giornata libera 😎`;
    return `📅 *Oggi — ${ctx.dayLabel(ctx.today)}*\n\n${formatDayStops(stops)}`;
  },
};
