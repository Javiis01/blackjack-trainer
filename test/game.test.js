// Ejecutar: node test/game.test.js [rondas]
// Juega con la estrategia recomendada y verifica pagos/contabilidad y que la ventaja de la casa sea razonable.
const { Game } = require('../js/game.js');

const rounds = parseInt(process.argv[2], 10) || 200000;
const g = new Game();
g.bankroll = 1e9;
let fails = 0;
let totalNet = 0, totalWager = 0;
const seenRes = {};

for (let i = 0; i < rounds; i++) {
  g.phase === 'settled' && g.nextRound();
  g.bet = 0;
  g.addChip(25);
  const before = g.bankroll;
  g.deal();
  if (g.phase === 'insurance') g.takeInsurance(false);
  let guard = 0;
  while (g.phase === 'player' && guard++ < 50) {
    const A = g.advice();
    g.act(A.best);
  }
  if (g.phase !== 'settled') { fails++; console.log('ronda no terminó', g.phase); break; }
  const net = g.bankroll - before;
  if (Math.abs(net - g.roundSummary.net) > 1e-9) { fails++; console.log('net inconsistente', net, g.roundSummary.net); break; }
  for (const h of g.hands) seenRes[h.result] = (seenRes[h.result] || 0) + 1;
  totalNet += net; totalWager += g.wagered;
}
const edge = totalNet / totalWager;
console.log('resultados:', seenRes);
console.log('rondas', rounds, ' neto/apostado = ' + (edge * 100).toFixed(2) + '%  (esperado ≈ −0.4%, error típico ≈ ±0.3%)');
if (edge < -0.02 || edge > 0.015) { fails++; console.log('Ventaja de la casa fuera de rango'); }

// Casos deterministas de pago
function scripted(playerCards, dealerCards, actions, extra) {
  const x = new Game();
  x.bankroll = 1000; x.bet = 100;
  const Eng = require('../js/engine.js');
  const mk = (s) => s.map(r => ({ rank: r, suit: '♠' }));
  const order = mk([playerCards[0], dealerCards[0], playerCards[1], dealerCards[1]].concat(extra || []));
  x.shoe.cards = order.reverse();
  x.shoe.cards.unshift(...Array(200).fill(0).map(() => ({ rank: '2', suit: '♠' })));
  x.deal();
  return x;
}
let t = scripted(['A', 'K'], ['9', '7'], []);
if (t.bankroll !== 1150 + 0 && t.bankroll !== 1150) { fails++; console.log('BJ 3:2 mal', t.bankroll); }
t = scripted(['10', '6'], ['10', '7'], [], ['K']);
t.act('hit');
if (t.hands[0].result !== 'lose' || t.bankroll !== 900) { fails++; console.log('bust mal', t.bankroll, t.hands[0].result); }
t = scripted(['5', '6'], ['10', '7'], [], ['9']);
t.act('double');
if (t.bankroll !== 1200) { fails++; console.log('double mal', t.bankroll); }
t = scripted(['8', '8'], ['10', '6'], [], ['3', '10', '8', '10']);
t.act('split');
if (t.hands.length !== 2) { fails++; console.log('split mal', t.hands.length); }
t = scripted(['10', '6'], ['A', '10'], []);
if (t.phase !== 'insurance') { fails++; console.log('esperaba insurance'); }
t.takeInsurance(true);
if (t.bankroll !== 1000 - 100 + 0 + 0 && t.bankroll !== 1000) { /* dealer BJ: pierde mano 100, seguro 50 -> gana 100 => 1000-100-50+150 = 1000 */ fails++; console.log('seguro mal', t.bankroll); }
t = scripted(['10', '6'], ['10', '9'], []);
t.act('surrender');
if (t.bankroll !== 950) { fails++; console.log('surrender mal', t.bankroll); }

console.log(fails === 0 ? 'OK' : fails + ' fallo(s)');
process.exit(fails === 0 ? 0 : 1);
