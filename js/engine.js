/* Cartas, zapato (6 mazos) y conteo Hi-Lo. */
(function (root) {
  'use strict';

  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
  const SUITS = ['♠', '♥', '♦', '♣'];

  function cardValue(card) {
    if (card.rank === 'A') return 1;
    if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') return 10;
    return parseInt(card.rank, 10);
  }
  // Hi-Lo: 2-6 = +1, 7-9 = 0, 10/J/Q/K/A = -1
  function hiLo(card) {
    const v = cardValue(card);
    if (v >= 2 && v <= 6) return 1;
    if (v >= 7 && v <= 9) return 0;
    return -1;
  }
  function isRed(card) { return card.suit === '♥' || card.suit === '♦'; }

  class Shoe {
    constructor(decks, penetration) {
      this.decks = decks || 6;
      this.penetration = penetration || 0.75;
      this.shuffle();
    }
    shuffle() {
      const cards = [];
      for (let d = 0; d < this.decks; d++)
        for (const s of SUITS) for (const r of RANKS) cards.push({ rank: r, suit: s });
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
      }
      this.cards = cards;
      this.total = cards.length;
      this.runningCount = 0;
    }
    draw() { return this.cards.pop(); }
    get remaining() { return this.cards.length; }
    needsShuffle() { return this.cards.length < this.total * (1 - this.penetration); }
    // Se llama cuando una carta se hace visible en la mesa
    see(card) { this.runningCount += hiLo(card); }
    // hidden: cartas del zapato ya repartidas pero aún no vistas (carta oculta del dealer)
    decksRemaining(hidden) { return Math.max(0.5, (this.cards.length + (hidden || 0)) / 52); }
    trueCount(hidden) { return this.runningCount / this.decksRemaining(hidden); }
  }

  const api = { RANKS, SUITS, cardValue, hiLo, isRed, Shoe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Engine = api;
})(typeof window !== 'undefined' ? window : globalThis);
