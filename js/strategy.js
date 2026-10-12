/* Motor estadístico del asesor.
 * Mazo infinito (estrategia básica), reglas: dealer pide en soft 17 (H17), dealer revisa
 * la carta oculta con 10/As (las manos que jugamos son condicionales a "dealer sin blackjack"),
 * doblar en cualquier 2 cartas, doblar tras split (DAS), ases dividen con 1 carta, rendición tardía.
 * Valores de cartas: 1 = As, 2..9, 10 = 10/J/Q/K.
 * Todos los EV están expresados en "unidades de la apuesta inicial".
 */
(function (root) {
  'use strict';

  const P = [0, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 1 / 13, 4 / 13];

  const NAMES = {
    hit: 'Pedir',
    stand: 'Plantarse',
    double: 'Doblar',
    split: 'Dividir (Split)',
    surrender: 'Rendirse'
  };
  const ORDER = ['split', 'double', 'surrender', 'stand', 'hit']; // desempate

  function totalOf(hard, ace) { return ace && hard + 10 <= 21 ? hard + 10 : hard; }
  function isSoft(hard, ace) { return ace && hard + 10 <= 21; }

  /* ---------- Dealer ---------- */
  const dealerCache = {};
  function dealerDist(up) {
    if (dealerCache[up]) return dealerCache[up];
    const memo = new Map();
    function draw(hard, ace) {
      if (hard > 21) return [0, 0, 0, 0, 0, 1];
      const t = totalOf(hard, ace);
      const soft = isSoft(hard, ace);
      if (t > 17 || (t === 17 && !soft)) {
        const r = [0, 0, 0, 0, 0, 0];
        r[t - 17] = 1;
        return r;
      }
      const key = hard * 2 + (ace ? 1 : 0);
      if (memo.has(key)) return memo.get(key);
      const r = [0, 0, 0, 0, 0, 0];
      for (let c = 1; c <= 10; c++) {
        const d = draw(hard + c, ace || c === 1);
        for (let i = 0; i < 6; i++) r[i] += P[c] * d[i];
      }
      memo.set(key, r);
      return r;
    }
    // carta oculta condicionada a que el dealer NO tenga blackjack (peek)
    let holes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    if (up === 1) holes = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    else if (up === 10) holes = [2, 3, 4, 5, 6, 7, 8, 9, 10];
    const norm = holes.reduce((s, c) => s + P[c], 0);
    const res = [0, 0, 0, 0, 0, 0];
    for (const c of holes) {
      const d = draw(up + c, up === 1 || c === 1);
      for (let i = 0; i < 6; i++) res[i] += (P[c] / norm) * d[i];
    }
    dealerCache[up] = res;
    return res;
  }
  function dealerBust(up) { return dealerDist(up)[5]; }

  /* ---------- Resultado de plantarse con total t ---------- */
  function standOutcome(t, up) {
    const d = dealerDist(up);
    let win = d[5], push = 0, lose = 0;
    for (let i = 0; i < 5; i++) {
      const dt = 17 + i;
      if (t > dt) win += d[i];
      else if (t === dt) push += d[i];
      else lose += d[i];
    }
    return { win, push, lose, ev: win - lose };
  }

  /* ---------- Juego óptimo hit/stand (después de la primera decisión) ---------- */
  const pvMemo = new Map();
  function playValue(up, hard, ace) {
    if (hard > 21) return { win: 0, push: 0, lose: 1, ev: -1, action: 'bust' };
    const key = (up * 40 + hard) * 2 + (ace ? 1 : 0);
    if (pvMemo.has(key)) return pvMemo.get(key);
    const st = standOutcome(totalOf(hard, ace), up);
    let res = Object.assign({ action: 'stand' }, st);
    if (hard < 21) {
      const h = hitOutcome(up, hard, ace);
      if (h.ev > st.ev + 1e-12) res = Object.assign({ action: 'hit' }, h);
    }
    pvMemo.set(key, res);
    return res;
  }

  function hitOutcome(up, hard, ace) {
    let win = 0, push = 0, lose = 0, ev = 0, bust = 0;
    for (let c = 1; c <= 10; c++) {
      const nh = hard + c;
      if (nh > 21) { lose += P[c]; ev -= P[c]; bust += P[c]; continue; }
      const v = playValue(up, nh, ace || c === 1);
      win += P[c] * v.win; push += P[c] * v.push; lose += P[c] * v.lose; ev += P[c] * v.ev;
    }
    return { win, push, lose, ev, bust };
  }

  function doubleOutcome(up, hard, ace) {
    let win = 0, push = 0, lose = 0, ev = 0, bust = 0;
    for (let c = 1; c <= 10; c++) {
      const nh = hard + c;
      if (nh > 21) { lose += P[c]; ev -= P[c]; bust += P[c]; continue; }
      const s = standOutcome(totalOf(nh, ace || c === 1), up);
      win += P[c] * s.win; push += P[c] * s.push; lose += P[c] * s.lose; ev += P[c] * s.ev;
    }
    return { win, push, lose, ev: ev * 2, bust };
  }

  /* Mejor jugada de una mano de 2 cartas dentro de un split (sin volver a dividir): stand/hit/double */
  function bestTwoCard(up, hard, ace) {
    const st = standOutcome(totalOf(hard, ace), up);
    let best = Object.assign({ action: 'stand' }, st);
    if (hard < 21) {
      const h = hitOutcome(up, hard, ace);
      if (h.ev > best.ev + 1e-12) best = Object.assign({ action: 'hit' }, h);
      const d = doubleOutcome(up, hard, ace);
      if (d.ev > best.ev + 1e-12) best = Object.assign({ action: 'double' }, d);
    }
    return best;
  }

  const splitMemo = new Map();
  function splitOutcome(up, c) {
    const key = up * 11 + c;
    if (splitMemo.has(key)) return splitMemo.get(key);
    let win = 0, push = 0, lose = 0, perHand = 0;
    if (c === 1) {
      // Ases: una carta cada uno, sin volver a dividir ni pedir
      for (let d = 1; d <= 10; d++) {
        const s = standOutcome(totalOf(1 + d, true), up);
        win += P[d] * s.win; push += P[d] * s.push; lose += P[d] * s.lose; perHand += P[d] * s.ev;
      }
    } else {
      const plays = [];
      for (let d = 1; d <= 10; d++) plays[d] = bestTwoCard(up, c + d, d === 1 || false);
      let h = 0;
      for (let it = 0; it < 60; it++) {
        let nh = 0;
        for (let d = 1; d <= 10; d++) {
          let v = plays[d].ev;
          if (d === c && 2 * h > v) v = 2 * h; // volver a dividir
          nh += P[d] * v;
        }
        h = nh;
      }
      perHand = h;
      for (let d = 1; d <= 10; d++) {
        win += P[d] * plays[d].win; push += P[d] * plays[d].push; lose += P[d] * plays[d].lose;
      }
    }
    const res = { win, push, lose, ev: 2 * perHand, bust: 0 };
    splitMemo.set(key, res);
    return res;
  }

  /* ---------- API principal ---------- */
  /* cards: array de valores 1..10 de la mano; up: valor (1..10) de la carta visible del dealer.
   * ctx: { canDouble, canSplit, canSurrender, canHit } */
  function analyze(cards, up, ctx) {
    ctx = Object.assign({ canDouble: true, canSplit: true, canSurrender: true, canHit: true }, ctx || {});
    const hard = cards.reduce((s, c) => s + c, 0);
    const ace = cards.indexOf(1) !== -1;
    const total = totalOf(hard, ace);
    const soft = isSoft(hard, ace);
    const isPair = cards.length === 2 && cards[0] === cards[1];
    const actions = {};

    const st = standOutcome(total, up);
    actions.stand = Object.assign({ bust: 0 }, st);
    if (ctx.canHit && hard < 21) {
      const h = hitOutcome(up, hard, ace);
      actions.hit = h;
      if (ctx.canDouble && cards.length === 2) actions.double = doubleOutcome(up, hard, ace);
    }
    if (ctx.canSplit && isPair) actions.split = splitOutcome(up, cards[0]);
    if (ctx.canSurrender && cards.length === 2) {
      actions.surrender = { win: 0, push: 0, lose: 1, ev: -0.5, bust: 0 };
    }

    let best = null;
    for (const a of ORDER) {
      if (!actions[a]) continue;
      if (best === null || actions[a].ev > actions[best].ev + 1e-9) best = a;
    }
    // Con mazos reales (6-8) la tabla estándar de casino dobla A,2 vs 5 (en mazo infinito la diferencia es <0.01)
    if (best === 'hit' && actions.double && cards.length === 2 && soft && total === 13 && up === 5 &&
        actions.hit.ev - actions.double.ev < 0.01) best = 'double';
    const ranking = Object.keys(actions).sort((a, b) => actions[b].ev - actions[a].ev);
    if (ranking[0] !== best) { ranking.splice(ranking.indexOf(best), 1); ranking.unshift(best); }
    return { cards, hard, ace, total, soft, isPair, up, dealerBust: dealerBust(up), actions, best, ranking, ctx };
  }

  /* ---------- Texto de explicación ---------- */
  function pc(x) { return (x * 100).toFixed(1) + '%'; }
  function ev(x) { return (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(3); }
  function upName(u) { return u === 1 ? 'As' : String(u); }
  function handName(A) {
    if (A.isPair) return 'par de ' + (A.cards[0] === 1 ? 'Ases' : A.cards[0] + 's');
    return (A.soft ? 'suave ' : 'duro ') + A.total;
  }

  function explain(A, action) {
    const a = A.actions[action];
    if (!a) return ['Esta acción no está disponible ahora.'];
    const lines = [];
    const up = A.up, t = A.total, weak = up >= 2 && up <= 6;
    const hitBust = A.actions.hit ? A.actions.hit.bust : 0;
    lines.push('<b>' + NAMES[action] + '</b> con ' + handName(A) + ' vs dealer ' + upName(up) +
      '. El dealer se pasa ' + pc(A.dealerBust) + ' de las veces con esa carta' +
      (weak ? ' (carta débil).' : (up >= 7 ? ' (carta fuerte, casi siempre llega a 17+).' : '.')));

    if (action === 'surrender') {
      lines.push('Rendirte te cuesta exactamente la mitad de la apuesta (EV −0.500).');
      const alt = A.ranking.filter(x => x !== 'surrender')[0];
      if (alt) lines.push('Seguir jugando ("' + NAMES[alt] + '") pierde más en promedio: EV ' + ev(A.actions[alt].ev) + '.');
    } else {
      lines.push('Resultado esperado: ganas ' + pc(a.win) + ', empatas ' + pc(a.push) + ', pierdes ' + pc(a.lose) +
        ' (EV ' + ev(a.ev) + ' por unidad apostada).');
      if (action === 'hit') lines.push('Probabilidad de pasarte con la siguiente carta: <b>' + pc(a.bust) + '</b>.');
      if (action === 'double') lines.push('Probabilidad de pasarte con la única carta: ' + pc(a.bust) + '. Arriesgas el doble.');
    }

    // Razón principal según acción y situación
    let why = '';
    switch (action) {
      case 'stand':
        if (t >= 17 && !A.soft) why = 'Con ' + t + ' ya tienes mano hecha: pedir te pasaría ' + pc(hitBust) + ' de las veces y no compensa.';
        else if (A.soft) why = 'Tu ' + t + ' suave ya es sólido; ' + (A.actions.hit ? 'pedir tiene EV ' + ev(A.actions.hit.ev) + ', peor que plantarte.' : 'no puedes pedir más.');
        else if (weak) why = 'El dealer muestra ' + upName(up) + ': se pasa ' + pc(A.dealerBust) + '. Si pides con ' + t + ' te pasas ' + pc(hitBust) + ' tú primero. Deja que sea el dealer quien se pase.';
        else why = 'Plantarte (EV ' + ev(a.ev) + ') pierde menos que pedir' + (A.actions.hit ? ' (EV ' + ev(A.actions.hit.ev) + ')' : '') + '.';
        break;
      case 'hit':
        if (hitBust === 0) why = 'No puedes pasarte con una sola carta (0%): pedir es gratis y sólo puede mejorar tu mano.';
        else if (A.soft) why = 'Mano suave: el As puede contar 1, así que solo te pasas ' + pc(hitBust) + ' y puedes mejorar. Plantarte tendría EV ' + ev(A.actions.stand.ev) + '.';
        else if (!weak) why = 'El dealer con ' + upName(up) + ' casi siempre llega a 17+ (solo se pasa ' + pc(A.dealerBust) + '). Plantarte con ' + t + ' pierde ' + pc(A.actions.stand.lose) + '; aceptas el ' + pc(hitBust) + ' de riesgo porque quedarte quieto pierde más.';
        else why = 'Aunque el dealer es débil, tu mano es demasiado baja para plantarte; pedir tiene mejor EV.';
        break;
      case 'double':
        why = 'Es tu mejor momento para meter más dinero: ' + (A.soft ? 'con el As no puedes arruinarte y' : 'con ' + t + ' la carta que caiga suele dejarte fuerte y') +
          ' el dealer ' + (weak ? '(débil, ' + pc(A.dealerBust) + ' de bust)' : '(' + upName(up) + ')') +
          ' es vulnerable. EV doblando ' + ev(a.ev) + ' vs ' + (A.actions.hit ? 'pedir ' + ev(A.actions.hit.ev) : 'plantarse ' + ev(A.actions.stand.ev)) + '.';
        break;
      case 'split': {
        const c = A.cards[0];
        const alt = A.ranking.filter(x => x !== 'split')[0];
        if (c === 1) why = 'Un par de Ases (soft 12) es una mano pobre, pero cada As por separado parte de 11: mucho mejor jugar dos manos.';
        else if (c === 8) why = 'Dos 8 suman 16, la peor mano. Separarlos da dos manos que arrancan en 8 con mucho más potencial.';
        else if (weak) why = 'Contra un dealer débil (' + upName(up) + ') conviene tener dos manos en juego para aprovechar que se pasa ' + pc(A.dealerBust) + '.';
        else why = 'Dividir mejora tu situación frente al dealer ' + upName(up) + '.';
        if (alt) why += ' EV dividiendo ' + ev(a.ev) + ' vs ' + NAMES[alt].toLowerCase() + ' ' + ev(A.actions[alt].ev) + '.';
        break;
      }
      case 'surrender':
        why = 'Ante un dealer ' + upName(up) + ' tu ' + handName(A) + ' pierde tanto que perder sólo la mitad es lo mejor.';
        break;
    }
    if (why) lines.push(why);

    if (action === A.best) {
      const second = A.ranking[1];
      if (second) lines.push('Ventaja sobre la siguiente mejor (' + NAMES[second] + '): ' + ev(a.ev - A.actions[second].ev) + ' por unidad apostada.');
    } else {
      lines.push('La mejor opción es <b>' + NAMES[A.best] + '</b> (EV ' + ev(A.actions[A.best].ev) + '); esta pierde ' + (A.actions[A.best].ev - a.ev).toFixed(3) + ' por unidad apostada.');
    }
    return lines;
  }

  /* ---------- Seguro (insurance) ---------- */
  function insuranceAdvice(trueCount) {
    // Mazo infinito: paga 2:1, gana con prob 4/13 -> EV = -1/13 por unidad de seguro
    const base = 4 / 13 * 2 - 9 / 13;
    const take = typeof trueCount === 'number' && trueCount >= 3;
    return { take, ev: base, text: take
      ? 'Con true count ≥ +3 quedan suficientes 10 en el zapato: el seguro pasa a tener EV positivo.'
      : 'El seguro tiene EV de −7.7% sobre lo apostado (gana solo ' + pc(4 / 13) + ' vs el 33.3% que necesita). Nunca lo tomes, salvo true count ≥ +3.' };
  }

  /* ---------- Tabla de estrategia generada por el motor ---------- */
  const CODE = { hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'R' };
  function chart() {
    const ups = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
    const rows = { hard: [], soft: [], pairs: [] };
    for (let t = 5; t <= 17; t++) {
      const a = Math.max(2, t - 10);
      const cards = [a, t - a];
      rows.hard.push({ label: String(t), cells: ups.map(u => CODE[analyze(cards, u).best]) });
    }
    for (let k = 2; k <= 9; k++) {
      rows.soft.push({ label: 'A,' + k, cells: ups.map(u => CODE[analyze([1, k], u).best]) });
    }
    for (let k = 2; k <= 10; k++) {
      rows.pairs.push({ label: k + ',' + k, cells: ups.map(u => CODE[analyze([k, k], u).best]) });
    }
    rows.pairs.push({ label: 'A,A', cells: ups.map(u => CODE[analyze([1, 1], u).best]) });
    return { ups, rows };
  }

  const api = { analyze, explain, insuranceAdvice, chart, dealerBust, dealerDist, standOutcome, NAMES, CODE, totalOf, isSoft };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Strategy = api;
})(typeof window !== 'undefined' ? window : globalThis);
