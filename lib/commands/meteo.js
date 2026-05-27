// /meteo — previsioni di oggi e domani ad Amsterdam (open-meteo, on-demand).
const { weatherRangeText } = require('../weather');

module.exports = {
  desc: 'Meteo di oggi e domani',
  handler: async (args, ctx) => {
    const wx = ctx.cfg.weather;
    if (!wx || wx.enabled === false) return '🌤️ Meteo non configurato per questo viaggio.';
    return weatherRangeText(wx, ctx.today, ctx.tomorrow, ctx.cfg.trip.timezone);
  },
};
