/* Lógica de la ronda: apuestas, acciones, pagos y feedback del asesor. Sin DOM. */
(function (root) {
  'use strict';

  const E = typeof require !== 'undefined' && typeof module !== 'undefined' ? require('./engine.js') : root.Engine;
  const S = typeof require !== 'undefined' && typeof module !== 'undefined' ? require('./strategy.js') : root.Strategy;

  const MIN_BET = 5;
  const MAX_BET = 5000;
  const START_BANK = 1000;
  const EPS = 0.01; // diferencias de EV menores a esto no cuentan como error
  const MAX_HANDS = 4;

  function newStats() {
    return {
      rounds: 0, wins: 0, losses: 0, pushes: 0, blackjacks: 0, net: 0, wagered: 0,
      decisions: 0, correct: 0, evLost: 0, moneyLost: 0, errors: [], peak: START_BANK
    };
  }

  class Game {
    constructor(saved) {
      this.shoe = new E.Shoe(6, 0.75);
      this.bankroll = START_BANK;
      this.stats = newStats();
      this.lastBet = 0;
      this.countAssist = false; // si true, el seguro se evalúa con el true count
      if (saved) this.load(saved);
      this.resetRound();
    }

    resetRound() {
      this.phase = 'betting';
      this.bet = 0;
      this.hands = [];
      this.active = 0;
      this.dealer = { cards: [], hidden: false };
      this.insuranceBet = 0;
      this.wagered = 0;
      this.feedback = null;
      this.roundSummary = null;
      this.shuffled = false;
    }

    serialize() {
      return { bankroll: this.bankroll, stats: this.stats, lastBet: this.lastBet };
    }
    load(s) {
      if (typeof s.bankroll === 'number') this.bankroll = s.bankroll;
      if (s.stats) this.stats = Object.assign(newStats(), s.stats);
      if (typeof s.lastBet === 'number') this.lastBet = s.lastBet;
    }
    rebuy() { // nueva banca sin borrar estadísticas
      if (this.phase !== 'betting' || this.bankroll >= MIN_BET) return false;
      this.bankroll = START_BANK;
      this.bet = 0;
      return true;
    }
    resetAll() {
      this.bankroll = START_BANK;
      this.stats = newStats();
      this.lastBet = 0;
      this.shoe.shuffle();
      this.resetRound();
    }

    /* ---------- Apuestas ---------- */
    addChip(v) {
      if (this.phase !== 'betting') return false;
      if (this.bet + v > this.bankroll || this.bet + v > MAX_BET) return false;
      this.bet += v;
      return true;
    }
    clearBet() { if (this.phase === 'betting') this.bet = 0; }
    rebet() {
      if (this.phase !== 'betting') return false;
      if (this.lastBet >= MIN_BET && this.lastBet <= this.bankroll) { this.bet = this.lastBet; return true; }
      return false;
    }

    /* ---------- Helpers ---------- */
    static values(hand) { return hand.cards.map(E.cardValue); }
    static total(cards) {
      const v = cards.map(E.cardValue);
      const hard = v.reduce((s, x) => s + x, 0);
      const ace = v.indexOf(1) !== -1;
      return { total: S.totalOf(hard, ace), soft: S.isSoft(hard, ace), hard, bust: hard > 21 };
    }
    get upValue() { return E.cardValue(this.dealer.cards[0]); }
    get current() { return this.hands[this.active]; }
    get runningCount() { return this.shoe.runningCount; }
    get trueCount() { return this.shoe.trueCount(this.dealer.hidden ? 1 : 0); }

    drawVisible() {
      const c = this.shoe.draw();
      this.shoe.see(c);
      return c;
    }

    /* ---------- Reparto ---------- */
    deal() {
      if (this.phase !== 'betting') return false;
      if (this.bet < MIN_BET || this.bet > this.bankroll) return false;
      const bet = this.bet;
      this.resetRound();
      this.bet = bet;
      if (this.shoe.needsShuffle()) { this.shoe.shuffle(); this.shuffled = true; }
      this.bankroll -= bet;
      this.lastBet = bet;
      this.wagered = bet;
      const hand = { cards: [], bet, doubled: false, fromSplit: false, aces: false, done: false, surrendered: false, result: null, payout: 0 };
      this.hands = [hand];
      hand.cards.push(this.drawVisible());
      const up = this.shoe.draw(); this.shoe.see(up);
      this.dealer.cards.push(up);
      hand.cards.push(this.drawVisible());
      this.dealer.cards.push(this.shoe.draw()); // carta oculta (aún no se cuenta)
      this.dealer.hidden = true;
      hand.natural = Game.total(hand.cards).total === 21;
      if (this.upValue === 1) this.phase = 'insurance';
      else this.resolveInitial();
      return true;
    }

    insuranceDecision() { // evaluación del seguro para mostrar en el asesor
      return S.insuranceAdvice(this.countAssist ? this.trueCount : 0);
    }

    takeInsurance(take) {
      if (this.phase !== 'insurance') return false;
      const adv = this.insuranceDecision();
      const cost = this.hands[0].bet / 2;
      if (take && this.bankroll < cost) return false;
      this.recordDecision(take === adv.take, take ? 'Tomar seguro' : 'Rechazar seguro',
        adv.take ? 'Tomar seguro' : 'Rechazar seguro', take === adv.take ? 0 : Math.abs(adv.ev), adv.text, this.hands[0].bet);
      if (take) { this.insuranceBet = cost; this.bankroll -= cost; this.wagered += cost; }
      this.resolveInitial();
      return true;
    }

    resolveInitial() {
      const hand = this.hands[0];
      const up = this.upValue;
      const dealerBJ = (up === 1 || up === 10) && Game.total(this.dealer.cards).total === 21;
      if (dealerBJ || hand.natural) {
        this.revealHole();
        return this.settle();
      }
      this.phase = 'player';
      this.active = 0;
    }

    revealHole() {
      if (this.dealer.hidden) { this.dealer.hidden = false; this.shoe.see(this.dealer.cards[1]); }
    }

    /* ---------- Asesor ---------- */
    ctxFor(hand) {
      const v = hand.cards.map(E.cardValue);
      return {
        canHit: !hand.aces,
        canDouble: hand.cards.length === 2 && !hand.aces && this.bankroll >= hand.bet,
        canSplit: hand.cards.length === 2 && v[0] === v[1] && this.hands.length < MAX_HANDS && this.bankroll >= hand.bet && !hand.aces,
        canSurrender: this.hands.length === 1 && !hand.fromSplit && hand.cards.length === 2
      };
    }
    advice() {
      if (this.phase !== 'player') return null;
      const h = this.current;
      return S.analyze(Game.values(h), this.upValue, this.ctxFor(h));
    }
    allowed() {
      const A = this.advice();
      return A ? Object.keys(A.actions) : [];
    }

    recordDecision(correct, chosenName, bestName, evLoss, text, bet) {
      const st = this.stats;
      st.decisions++;
      if (correct) st.correct++;
      const loss = correct ? 0 : evLoss;
      st.evLost += loss;
      st.moneyLost += loss * bet;
      this.feedback = { correct, chosen: chosenName, best: bestName, evLoss: loss, text };
      if (!correct) {
        st.errors.unshift({ chosen: chosenName, best: bestName, evLoss: loss, text });
        if (st.errors.length > 30) st.errors.pop();
      }
    }

    act(action) {
      if (this.phase !== 'player') return false;
      const hand = this.current;
      const A = this.advice();
      if (!A.actions[action]) return false;
      const loss = A.actions[A.best].ev - A.actions[action].ev;
      const correct = action === A.best || loss <= EPS;
      const handTxt = (A.isPair ? 'Par de ' : (A.soft ? 'Suave ' : 'Duro ')) + (A.isPair ? A.cards[0] : A.total) + ' vs ' + (A.up === 1 ? 'As' : A.up);
      this.recordDecision(correct, S.NAMES[action], S.NAMES[A.best], loss,
        handTxt + ': elegiste ' + S.NAMES[action] + ', lo óptimo era ' + S.NAMES[A.best] + ' (cuesta ' + loss.toFixed(3) + ' por unidad).', hand.bet);

      switch (action) {
        case 'hit': {
          hand.cards.push(this.drawVisible());
          const t = Game.total(hand.cards);
          if (t.bust || t.total === 21) hand.done = true;
          break;
        }
        case 'stand':
          hand.done = true;
          break;
        case 'double': {
          this.bankroll -= hand.bet; this.wagered += hand.bet; hand.bet *= 2; hand.doubled = true;
          hand.cards.push(this.drawVisible());
          hand.done = true;
          break;
        }
        case 'surrender':
          hand.surrendered = true; hand.done = true;
          break;
        case 'split': {
          this.bankroll -= hand.bet; this.wagered += hand.bet;
          const second = { cards: [hand.cards.pop()], bet: hand.bet, doubled: false, fromSplit: true, aces: false, done: false, surrendered: false, result: null, payout: 0 };
          hand.fromSplit = true;
          const aces = E.cardValue(hand.cards[0]) === 1;
          if (aces) { hand.aces = true; second.aces = true; }
          this.hands.splice(this.active + 1, 0, second);
          hand.cards.push(this.drawVisible());
          if (aces) {
            second.cards.push(this.drawVisible());
            hand.done = true; second.done = true;
          } else if (Game.total(hand.cards).total === 21) hand.done = true;
          break;
        }
      }
      this.advance();
      return true;
    }

    advance() {
      while (this.phase === 'player') {
        const h = this.current;
        if (h.cards.length === 1) { // mano recién dividida que aún no recibió su 2ª carta
          h.cards.push(this.drawVisible());
          if (Game.total(h.cards).total === 21) h.done = true;
        }
        if (!h.done) return;
        if (this.active < this.hands.length - 1) this.active++;
        else { this.dealerTurn(); return; }
      }
    }

    dealerTurn() {
      this.phase = 'dealer';
      this.revealHole();
      const live = this.hands.some(h => !h.surrendered && !Game.total(h.cards).bust);
      if (live) {
        for (;;) {
          const t = Game.total(this.dealer.cards);
          if (t.total > 17 || (t.total === 17 && !t.soft)) break; // H17: pide en soft 17
          this.dealer.cards.push(this.drawVisible());
        }
      }
      this.settle();
    }

    /* ---------- Pagos ---------- */
    settle() {
      const dt = Game.total(this.dealer.cards);
      const dealerBJ = this.dealer.cards.length === 2 && dt.total === 21;
      let payout = 0, wins = 0, losses = 0, pushes = 0, bjs = 0;
      for (const h of this.hands) {
        const pt = Game.total(h.cards);
        let p = 0, res;
        if (h.surrendered) { p = h.bet / 2; res = 'surrender'; }
        else if (pt.bust) { res = 'lose'; }
        else if (h.natural && !h.fromSplit) {
          if (dealerBJ) { p = h.bet; res = 'push'; } else { p = h.bet * 2.5; res = 'blackjack'; }
        }
        else if (dealerBJ) { res = 'lose'; }
        else if (dt.bust) { p = h.bet * 2; res = 'win'; }
        else if (pt.total > dt.total) { p = h.bet * 2; res = 'win'; }
        else if (pt.total === dt.total) { p = h.bet; res = 'push'; }
        else { res = 'lose'; }
        h.result = res; h.payout = p; payout += p;
        if (res === 'win' || res === 'blackjack') wins++;
        else if (res === 'push') pushes++;
        else losses++;
        if (res === 'blackjack') bjs++;
      }
      let insuranceWin = 0;
      if (this.insuranceBet > 0 && dealerBJ) insuranceWin = this.insuranceBet * 3;
      payout += insuranceWin;
      this.bankroll += payout;
      const net = payout - this.wagered;
      const st = this.stats;
      st.rounds++; st.wins += wins; st.losses += losses; st.pushes += pushes; st.blackjacks += bjs;
      st.net += net; st.wagered += this.wagered;
      if (this.bankroll > st.peak) st.peak = this.bankroll;
      this.roundSummary = { net, dealerBJ, insuranceWin, dealerTotal: dt.total, dealerBust: dt.bust };
      this.phase = 'settled';
    }

    nextRound() {
      if (this.phase !== 'settled') return false;
      const last = this.lastBet;
      this.resetRound();
      this.lastBet = last;
      return true;
    }
  }

  const api = { Game, MIN_BET, MAX_BET, START_BANK, EPS, MAX_HANDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GameModule = api;
})(typeof window !== 'undefined' ? window : globalThis);
