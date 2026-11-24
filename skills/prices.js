// Kaivra plugin: live prices.
// Crypto prices from CoinGecko (https://www.coingecko.com, free public API, no key).
// Currency rates from ExchangeRate-API's open access (https://www.exchangerate-api.com, "Rates By Exchange Rate API").
const COINS = { bitcoin: 'bitcoin', btc: 'bitcoin', ethereum: 'ethereum', eth: 'ethereum' };
const rupees = (n) => Math.round(n).toLocaleString('en-IN');

kaivra.on([/\b(bitcoin|btc|ethereum|eth)\b.*\b(price|rate|worth|value)\b|\b(price|rate|value) of (bitcoin|btc|ethereum|eth)\b/i], async (text) => {
  const id = COINS[(text.toLowerCase().match(/bitcoin|btc|ethereum|eth/) || ['bitcoin'])[0]];
  const data = JSON.parse(await kaivra.fetch('https://api.coingecko.com/api/v3/simple/price?ids=' + id + '&vs_currencies=inr,usd'));
  const p = data[id];
  if (!p) return 'I could not get the ' + id + ' price right now.';
  return id.charAt(0).toUpperCase() + id.slice(1) + ' is at ' + rupees(p.inr) + ' rupees, or ' + Math.round(p.usd).toLocaleString('en-US') + ' US dollars.';
});

const CURRENCIES = { dollar: 'USD', usd: 'USD', euro: 'EUR', eur: 'EUR', pound: 'GBP', gbp: 'GBP', yen: 'JPY', dirham: 'AED', riyal: 'SAR' };
kaivra.on([/\b(dollars?|usd|euros?|eur|pounds?|gbp|yen|dirhams?|riyals?)\b.*\b(rate|price|in rupees|to rupees|to inr)\b|\b(rate|price) of (?:the |one )?(dollar|euro|pound|yen|dirham|riyal)\b/i], async (text) => {
  const word = (text.toLowerCase().match(/dollar|usd|euro|eur|pound|gbp|yen|dirham|riyal/) || ['dollar'])[0];
  const code = CURRENCIES[word] || 'USD';
  const data = JSON.parse(await kaivra.fetch('https://open.er-api.com/v6/latest/' + code));
  const inr = data.rates && data.rates.INR;
  if (!inr) return 'I could not get the rate right now.';
  const name = { USD: 'US dollar', EUR: 'euro', GBP: 'British pound', JPY: 'Japanese yen', AED: 'UAE dirham', SAR: 'Saudi riyal' }[code];
  return 'One ' + name + ' is ' + inr.toFixed(2) + ' rupees today.';
});
