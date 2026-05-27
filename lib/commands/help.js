// /help — elenco comandi disponibili.
module.exports = {
  desc: 'Mostra i comandi disponibili',
  handler: async () => {
    // require lazy per evitare la dipendenza circolare con _registry
    const { registry } = require('./_registry');
    const lines = Object.entries(registry).map(([name, e]) => `/${name} — ${e.desc}`);
    return `🤖 *Comandi disponibili*\n\n${lines.join('\n')}`;
  },
};
