// Ejecutar: node test/strategy.test.js
const S = require('../js/strategy.js');

let fails = 0;
function check(name, cond, extra) {
  if (!cond) { fails++; console.log('FALLO:', name, extra || ''); }
}
function near(a, b, tol) { return Math.abs(a - b) <= tol; }

// ---- Sanity checks de probabilidades ----
const bust6 = S.dealerBust(6);
// H17: dealer se pasa ~44% vs 6, ~36% vs 2, ~23% vs 10 (peek)
check('dealer bust vs 6 ~ 44%', near(bust6, 0.44, 0.01), bust6);
check('dealer bust vs 2 ~ 36%', near(S.dealerBust(2), 0.36, 0.015), S.dealerBust(2));
check('dealer bust vs 10 ~ 23%', near(S.dealerBust(10), 0.23, 0.02), S.dealerBust(10));
for (let u = 1; u <= 10; u++) {
  const d = S.dealerDist(u).reduce((s, x) => s + x, 0);
  check('dist dealer suma 1 up=' + u, near(d, 1, 1e-9), d);
}
check('12 hit bust = 31%', near(S.analyze([5, 7], 10).actions.hit.bust, 4 / 13, 1e-9));
check('16 hit bust = 62%', near(S.analyze([6, 10], 10).actions.hit.bust, 8 / 13, 1e-9));
check('15 hit bust = 54%', near(S.analyze([5, 10], 10).actions.hit.bust, 7 / 13, 1e-9));
for (const a of ['stand', 'hit', 'double']) {
  const r = S.analyze([5, 6], 6).actions[a];
  check('w+p+l=1 ' + a, near(r.win + r.push + r.lose, 1, 1e-9), r);
}

// ---- Tabla de estrategia básica H17, DAS, rendición tardía (6-8 mazos) ----
// columnas: 2 3 4 5 6 7 8 9 10 A
const ups = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
const expected = {
  hard: {
    5: 'HHHHHHHHHH', 6: 'HHHHHHHHHH', 7: 'HHHHHHHHHH',
    8: 'HHHHHHHHHH', 9: 'HDDDDHHHHH', 10: 'DDDDDDDDHH', 11: 'DDDDDDDDDD',
    12: 'HHSSSHHHHH', 13: 'SSSSSHHHHH', 14: 'SSSSSHHHHH', 15: 'SSSSSHHHRR',
    16: 'SSSSSHHRRR', 17: 'SSSSSSSSSR'
  },
  soft: {
    2: 'HHHDDHHHHH', 3: 'HHHDDHHHHH', 4: 'HHDDDHHHHH', 5: 'HHDDDHHHHH',
    6: 'HDDDDHHHHH', 7: 'DDDDDSSHHH', 8: 'SSSSDSSSSS', 9: 'SSSSSSSSSS'
  },
  pairs: {
    2: 'PPPPPPHHHH', 3: 'PPPPPPHHHH', 4: 'HHHPPHHHHH', 5: 'DDDDDDDDHH',
    6: 'PPPPPHHHHH', 7: 'PPPPPPHHHH', 8: 'PPPPPPPPPR', 9: 'PPPPPSPPSS', 10: 'SSSSSSSSSS', A: 'PPPPPPPPPP'
  }
};
const mine = S.chart();
function compare(group, key, row) {
  const exp = expected[group][key];
  const got = row.cells.join('');
  if (exp !== got) {
    fails++;
    const diffs = [];
    for (let i = 0; i < 10; i++) if (exp[i] !== got[i]) diffs.push('vs ' + ups[i] + ': esperado ' + exp[i] + ' obtenido ' + got[i]);
    console.log('DIF ' + group + ' ' + row.label + '  ' + diffs.join(' | '));
  }
}
mine.rows.hard.forEach(r => compare('hard', r.label, r));
mine.rows.soft.forEach(r => compare('soft', r.label.slice(2), r));
mine.rows.pairs.forEach(r => compare('pairs', r.label.split(',')[0], r));

if (process.argv.includes('--chart')) {
  console.log('      ' + ups.map(u => (u === 1 ? 'A' : u)).join(' '));
  for (const g of ['hard', 'soft', 'pairs']) {
    mine.rows[g].forEach(r => console.log(r.label.padEnd(6) + r.cells.join(' ')));
  }
}
console.log(fails === 0 ? 'OK: todo coincide' : fails + ' diferencia(s)');
process.exit(fails === 0 ? 0 : 1);
