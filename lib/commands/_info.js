// lib/commands/_info.js — factory per i comandi "info" statici (/bici, /spese,
// /valigia, /casa, /mezzi, /sos). Il testo vive in schedule.json → `info.<key>`,
// così si aggiorna senza toccare il codice.
module.exports = (key, desc) => ({
  desc,
  handler: async (args, ctx) => ctx.cfg.info?.[key] || `ℹ️ Info "${key}" non ancora disponibile.`,
});
