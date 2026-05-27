// lib/format.js — formattazione condivisa delle tappe di un giorno (usata da /oggi,
// /domani e dal messaggio mattutino "Buongiorno").
//
// 🔔 = tappa con promemoria (notify:true), 📍 = info. Le tappe vanno già ordinate.
function formatDayStops(stops) {
  return stops
    .map((s) => {
      const flag = s.notify ? '🔔' : '📍';
      const maps = s.location?.maps ? `\n   ${s.location.maps}` : '';
      return `${flag} *${s.time}* · ${s.title}${maps}`;
    })
    .join('\n');
}

module.exports = { formatDayStops };
