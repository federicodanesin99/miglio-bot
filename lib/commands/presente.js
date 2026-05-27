// /presente — appello di gruppo via reazioni.
//   /presente          apre un appello (o mostra lo stato se già aperto)
//   /presente stop     chiude l'appello e dà il riepilogo
// Richiede il bot in esecuzione (node index.js run): ctx.rollcall è iniettato lì.
const APPELLO = '🙋 *Appello!* Reagite con 👍 a *questo* messaggio quando ci siete.\n\n'
  + '_Scrivete /presente per il conteggio, /presente stop per chiudere._';

module.exports = {
  desc: 'Appello: chi c’è? (reagite 👍)',
  handler: async (args, ctx) => {
    const rc = ctx.rollcall;
    if (!rc) return 'ℹ️ L’appello funziona solo col bot in esecuzione (node index.js run).';

    const a = (args || '').trim().toLowerCase();
    if (['stop', 'fine', 'chiudi'].includes(a)) return rc.close();
    if (rc.isActive()) return rc.statusText();

    // Nuovo appello: il router invia il testo e poi registra la key del messaggio.
    return { text: APPELLO, after: (sent) => rc.start(sent?.key) };
  },
};
