// lib/rollcall.js — appello "ci siamo tutti?" basato sulle reazioni.
//
// Stato EFFIMERO in memoria (niente persistenza: un appello vale per il momento).
// Flusso: /presente apre un appello → il bot manda un messaggio → la gente reagisce
// con 👍 a QUEL messaggio → record() aggrega i JID di chi ha reagito → /presente
// mostra il conteggio, /presente stop lo chiude.
//
// Il match "la reazione è sul messaggio dell'appello?" lo fa il router (ha la key),
// poi chiama record(). Qui teniamo solo l'insieme di chi è presente.

// Emoji considerate "presente". Una reazione diversa (es. 👎) NON conta.
const PRESENT_EMOJI = new Set(['👍', '✅', '🙋', '🙋‍♂️', '🙋‍♀️', '🙌', '👌', '🆗', '🤙', '💪']);

// getGroupSize: async () => number|null — quante persone attese (per "N/M").
function makeRollCall({ getGroupSize = null } = {}) {
  let active = null; // { msgId, present:Set<jid>, expected:number|null, startedAt }

  return {
    isActive: () => !!active,

    // Apre un appello legato al messaggio appena inviato (msgKey = sent.key).
    async start(msgKey) {
      let expected = null;
      try { expected = getGroupSize ? await getGroupSize() : null; }
      catch { expected = null; }
      active = { msgId: msgKey?.id || null, present: new Set(), expected, startedAt: Date.now() };
      return active;
    },

    // La reazione riguarda il messaggio dell'appello in corso?
    matchesKey(reactedKey) {
      return !!(active && reactedKey && reactedKey.id && reactedKey.id === active.msgId);
    },

    // Registra una reazione. emoji vuota = reazione rimossa → toglie il JID.
    // Ritorna true se lo stato è cambiato.
    record(reactorJid, emoji) {
      if (!active || !reactorJid) return false;
      if (!emoji) return active.present.delete(reactorJid);
      if (!PRESENT_EMOJI.has(emoji)) return false;
      if (active.present.has(reactorJid)) return false;
      active.present.add(reactorJid);
      return true;
    },

    // Testo di stato (appello in corso).
    statusText() {
      if (!active) return 'ℹ️ Nessun appello in corso. Scrivi */presente* per aprirne uno.';
      const n = active.present.size;
      const exp = active.expected;
      const miss = exp != null ? ` · mancano *${Math.max(0, exp - n)}*` : '';
      const tot = exp != null ? `/${exp}` : '';
      return `🙋 *Appello in corso*\n✅ Presenti: *${n}*${tot}${miss}\n\n_Reagite con 👍 al messaggio dell'appello. /presente per aggiornare, /presente stop per chiudere._`;
    },

    // Chiude l'appello e ritorna il riepilogo finale.
    close() {
      if (!active) return 'ℹ️ Nessun appello da chiudere.';
      const n = active.present.size;
      const exp = active.expected;
      const tot = exp != null ? `/${exp}` : '';
      const tail = exp != null && n < exp ? `\n⚠️ Mancano ancora *${exp - n}* persone.` : '\n🎉 Ci siamo tutti!';
      active = null;
      return `🏁 *Appello chiuso*\n✅ Confermati: *${n}*${tot}${exp != null ? tail : ''}`;
    },
  };
}

module.exports = { makeRollCall, PRESENT_EMOJI };
