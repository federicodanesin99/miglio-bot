// /riepilogo — per ogni partecipante elenca i voti MVP ricevuti (punti, motivo
// e chi glieli ha dati). Dettaglio completo, a differenza di /classifica.
module.exports = {
  desc: '📋 Riepilogo voti MVP ricevuti (punti, motivo, da chi)',
  handler: async (args, ctx) => {
    if (!ctx.mvp) return '📋 *Riepilogo voti MVP*\n\n_Disponibile durante il viaggio._';
    return ctx.mvp.breakdownText();
  },
};
