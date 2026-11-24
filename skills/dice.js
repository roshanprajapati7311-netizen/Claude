// Kaivra plugin: flips a coin or rolls dice.
kaivra.on(['flip a coin', 'toss a coin', 'coin toss', 'heads or tails'], () =>
  Math.random() < 0.5 ? 'Heads.' : 'Tails.');

kaivra.on([/\broll (?:a |the |two |2 )?(?:dice|die)(?: (\d+) times)?/i], (text, m) => {
  const n = Math.max(1, Math.min(10, Number(m && m[1]) || (/\b(two|2) dice\b/i.test(text) ? 2 : 1)));
  const rolls = Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 6));
  return n === 1 ? 'You rolled a ' + rolls[0] + '.' : 'You rolled ' + rolls.join(', ') + '.';
});
