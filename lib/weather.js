// lib/weather.js — brief meteo via open-meteo.com (forecast API, niente API key).
//
// Espone due testi pronti per WhatsApp:
//   - weatherBriefText(wx, day, tz)            → un giorno (brief mattutino schedulato)
//   - weatherRangeText(wx, start, end, tz)     → un intervallo (comando /meteo)
// Entrambi NON lanciano: in caso di errore di rete ritornano un fallback con link,
// così lo scheduler segna comunque l'evento come inviato (niente retry a vuoto).
const { dayLabel } = require('./time');

// Codici meteo WMO → [descrizione IT, emoji]. Vedi open-meteo.com/en/docs (weather_code).
const WMO = {
  0: ['Sereno', '☀️'],
  1: ['Prevalentemente sereno', '🌤️'],
  2: ['Parzialmente nuvoloso', '⛅'],
  3: ['Coperto', '☁️'],
  45: ['Nebbia', '🌫️'], 48: ['Nebbia con brina', '🌫️'],
  51: ['Pioviggine leggera', '🌦️'], 53: ['Pioviggine', '🌦️'], 55: ['Pioviggine intensa', '🌧️'],
  56: ['Pioviggine gelata', '🌧️'], 57: ['Pioviggine gelata intensa', '🌧️'],
  61: ['Pioggia debole', '🌦️'], 63: ['Pioggia', '🌧️'], 65: ['Pioggia forte', '🌧️'],
  66: ['Pioggia gelata', '🌧️'], 67: ['Pioggia gelata forte', '🌧️'],
  71: ['Neve debole', '🌨️'], 73: ['Neve', '🌨️'], 75: ['Neve forte', '❄️'], 77: ['Granuli di neve', '🌨️'],
  80: ['Rovesci deboli', '🌦️'], 81: ['Rovesci', '🌧️'], 82: ['Rovesci violenti', '⛈️'],
  85: ['Rovesci di neve', '🌨️'], 86: ['Rovesci di neve forti', '❄️'],
  95: ['Temporale', '⛈️'], 96: ['Temporale con grandine', '⛈️'], 99: ['Temporale con grandine forte', '⛈️'],
};

function describe(code) {
  const e = WMO[code];
  return e ? { label: e[0], emoji: e[1] } : { label: 'Condizioni variabili', emoji: '🌡️' };
}

const round = (n) => (n == null ? null : Math.round(n));

// Interroga open-meteo per l'intervallo [startDate, endDate] (inclusi, "YYYY-MM-DD").
// Ritorna un array di oggetti per giorno. Lancia su errore di rete/HTTP.
async function fetchDaily({ lat, lon, timezone, startDate, endDate }) {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', lat);
  url.searchParams.set('longitude', lon);
  url.searchParams.set('daily', [
    'weather_code', 'temperature_2m_max', 'temperature_2m_min',
    'precipitation_probability_max', 'precipitation_sum', 'wind_speed_10m_max',
  ].join(','));
  url.searchParams.set('timezone', timezone);
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  let res;
  try {
    res = await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`);
  const d = (await res.json()).daily;
  if (!d || !Array.isArray(d.time)) throw new Error('risposta open-meteo senza "daily"');
  return d.time.map((day, i) => ({
    day,
    code: d.weather_code[i],
    tMax: d.temperature_2m_max[i],
    tMin: d.temperature_2m_min[i],
    pop: d.precipitation_probability_max[i],
    precip: d.precipitation_sum[i],
    wind: d.wind_speed_10m_max[i],
  }));
}

// Due righe di sintesi per un giorno (condizione + temperatura/pioggia/vento).
function formatDayLine(o) {
  const { label, emoji } = describe(o.code);
  const temp = `🌡️ ${round(o.tMin)}–${round(o.tMax)}°C`;
  const rain = o.pop != null ? `· 🌧️ ${o.pop}%${o.precip ? ` (${o.precip} mm)` : ''}` : '';
  const wind = o.wind != null ? `· 💨 ${round(o.wind)} km/h` : '';
  return `${emoji} *${dayLabel(o.day)}* — ${label}\n${[temp, rain, wind].filter(Boolean).join(' ')}`;
}

// Consiglio pratico in base ai dati del giorno (per la banda con 15 persone in bici).
function advice(o) {
  if (o.pop >= 60 || o.precip >= 3) return '☔ Mettete in valigia k-way/ombrello, oggi piove.';
  if (o.wind >= 35) return '💨 Vento sostenuto: occhio in bici lungo i canali.';
  if (o.tMax >= 24) return '😎 Bella giornata, occhiali da sole e borraccia.';
  if (o.tMax <= 12) return '🧥 Fresco: vestitevi a strati.';
  return '👍 Giornata tranquilla, godetevela.';
}

function fallback(place, err) {
  return `🌤️ *Meteo ${place}*\n\nNon sono riuscito a recuperare le previsioni (${err.message}).\n`
    + `Controlla qui: https://www.google.com/search?q=meteo+${encodeURIComponent(place)}`;
}

// Testo per un intervallo di giorni (consiglio basato sul primo giorno).
async function weatherRangeText(wx, startDate, endDate, timezone) {
  const place = wx.place || 'Amsterdam';
  try {
    const days = await fetchDaily({
      lat: wx.lat, lon: wx.lon, timezone: wx.timezone || timezone, startDate, endDate,
    });
    if (!days.length) throw new Error('nessun dato per il periodo richiesto');
    const body = days.map(formatDayLine).join('\n\n');
    return `🌤️ *Meteo ${place}*\n\n${body}\n\n${advice(days[0])}\n\n_Fonte: open-meteo.com_`;
  } catch (err) {
    return fallback(place, err);
  }
}

// Brief mattutino di un singolo giorno.
const weatherBriefText = (wx, day, timezone) => weatherRangeText(wx, day, day, timezone);

module.exports = { fetchDaily, describe, formatDayLine, advice, weatherRangeText, weatherBriefText };
