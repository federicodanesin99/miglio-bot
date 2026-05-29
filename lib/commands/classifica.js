// /classifica — mostra la classifica MVP corrente (punti ricevuti).
module.exports = {
  desc: '🏆 Classifica MVP corrente',
  handler: async (args, ctx) => {
    if (!ctx.mvp) return '🏆 *Classifica MVP*\n\n_Disponibile durante il viaggio._';
    return ctx.mvp.leaderboardText();
  },
};
