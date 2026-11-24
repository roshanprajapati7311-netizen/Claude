# Kaivra's skills (plugins)

Kaivra downloads every plugin listed in `index.json` when you say **"update your skills"**. No new app is needed.

A plugin is a small JavaScript file. It tells Kaivra which words to listen for and what to do:

```js
// say "flip a coin"
kaivra.on(['flip a coin', 'heads or tails'], () => Math.random() < 0.5 ? 'Heads.' : 'Tails.');

// a pattern, and a web request (https only)
kaivra.on([/bitcoin price/i], async () => {
  const data = JSON.parse(await kaivra.fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=inr'));
  return 'Bitcoin is at ' + data.bitcoin.inr + ' rupees.';
});
```

Whatever the function returns is spoken. What a plugin can use:

| | |
|---|---|
| `kaivra.on(words or patterns, fn)` | run `fn(text, match)` when you say them |
| `kaivra.say(text)` / `kaivra.ask(question)` | speak / let the thinking brain answer |
| `kaivra.fetch(url)` | read a web page or API (https) |
| `kaivra.get(key)` / `kaivra.set(key, value)` | the plugin's own storage on the phone |
| `kaivra.open(app)`, `call(who)`, `text(who, message)` | apps, calls, messages |
| `kaivra.torch(on)`, `volume(up)`, `phone(action)`, `web(url)`, `vibrate(ms)`, `battery()` | phone actions (`phone`: home, back, lock, screenshot, notifications, quicksettings, recents) |

Skills you teach by voice ("learn a new skill: when I say good night, turn off the torch and say sleep well") are kept
on your phone, not here. Say **"show me your memory"** to see every skill, and **"remove the ... skill"** to delete one.
