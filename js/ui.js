/* Interfaz: render, eventos, tooltips y persistencia. */
(function () {
  'use strict';

  const { Game, MIN_BET } = window.GameModule;
  const S = window.Strategy;
  const E = window.Engine;

  const KEY = 'bj-trainer-v1';
  const $ = (id) => document.getElementById(id);

  let prefs = { practice: false, countMode: 'off' }; // countMode: off | learn | quiz
  let revealed = false; // modo práctica: consejo mostrado para la decisión actual
  let quiz = null;      // modo practicar conteo: { round, guess, ok } de la última respuesta
  let wentBroke = false; // la burla solo sale al quebrar jugando, no al abrir con una banca vacía guardada
  let tips = [];        // contenido HTML de los tooltips del render actual
  let game;

  /* ---------- Persistencia ---------- */
  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { /* sin storage */ }
    if (saved && saved.prefs) prefs = Object.assign(prefs, saved.prefs);
    if (prefs.showCount && !saved.prefs.countMode) prefs.countMode = 'learn'; // versión anterior: casilla "Mostrar"
    delete prefs.showCount;
    game = new Game(saved && saved.game);
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify({ game: game.serialize(), prefs })); } catch (e) { /* ignorar */ }
  }

  /* ---------- Formato ---------- */
  function money(n) {
    const s = Math.abs(n).toFixed(2).replace(/\.00$/, '');
    return (n < 0 ? '−$' : '$') + s;
  }
  function pc(x) { return (x * 100).toFixed(1) + '%'; }
  function pcShort(x) { return (x * 100).toFixed(0) + '%'; }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  const KEYS = { hit: 'H', stand: 'S', double: 'D', split: 'P', surrender: 'R' };

  /* ---------- Render: cartas y mesa ---------- */
  function hiLoTxt(v) { return v > 0 ? '+1' : v < 0 ? '−1' : '0'; }
  function hiLoCls(v) { return v > 0 ? 'plus' : v < 0 ? 'minus' : 'zero'; }
  function signed(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n); }

  function cardHTML(c) {
    // modo Aprender: cada carta visible muestra cuánto suma al conteo
    const v = E.hiLo(c);
    const tag = prefs.countMode === 'learn' ? '<i class="hl ' + hiLoCls(v) + '">' + hiLoTxt(v) + '</i>' : '';
    return '<div class="card ' + (E.isRed(c) ? 'red' : '') + '"><span>' + c.rank + '</span><span class="suit">' + c.suit + '</span>' + tag + '</div>';
  }
  function backHTML() { return '<div class="card back"></div>'; }

  function totalLabel(cards) {
    const t = Game.total(cards);
    if (t.bust) return t.hard + ' (se pasa)';
    if (t.soft) return (t.total - 10) + '/' + t.total;
    return String(t.total);
  }

  function renderTable() {
    const d = game.dealer;
    let html = '';
    d.cards.forEach((c, i) => { html += (i === 1 && d.hidden) ? backHTML() : cardHTML(c); });
    $('dealerCards').innerHTML = html;
    $('dealerTotal').textContent = d.cards.length === 0 ? '' :
      d.hidden ? (game.upValue === 1 ? 'A' : game.upValue) : totalLabel(d.cards);

    const labels = { win: 'Gana', lose: 'Pierde', push: 'Empate', blackjack: 'Blackjack 3:2', surrender: 'Rendida' };
    $('hands').innerHTML = game.hands.map((h, i) => {
      const active = game.phase === 'player' && i === game.active;
      let meta = '<span class="total">' + totalLabel(h.cards) + '</span><span>Apuesta ' + money(h.bet) + (h.doubled ? ' (doblada)' : '') + '</span>';
      if (h.result) meta += '<span class="badge ' + h.result + '">' + labels[h.result] + (h.payout - h.bet !== 0 || h.result === 'push' ? ' ' + (h.payout - h.bet >= 0 ? '+' : '') + money(h.payout - h.bet) : ' ' + money(-h.bet)) + '</span>';
      return '<div class="hand' + (active ? ' active' : '') + '"><div class="cards">' + h.cards.map(cardHTML).join('') + '</div><div class="meta">' + meta + '</div></div>';
    }).join('');

    $('status').textContent = statusText();
  }

  function statusText() {
    const g = game;
    if (g.phase === 'betting') {
      if (g.bankroll < MIN_BET) return 'Sin fondos. Usa el botón de abajo para reiniciar la banca.';
      return 'Haz tu apuesta por mano (mínimo ' + money(MIN_BET) + ')' + (g.spots > 1 ? ' — se juegan ' + g.spots + ' manos a la vez' : '') + ' y reparte.';
    }
    const shuf = g.shuffled ? ' (zapato barajado)' : '';
    if (g.phase === 'insurance') return 'El dealer muestra un As. ¿Quieres seguro?' + shuf;
    if (g.phase === 'player' && g.current.aces && g.current.cards.length === 1) return 'Mano ' + (g.active + 1) + ' de ' + g.hands.length + ' (As dividido): doblar o recibir tu única carta' + shuf;
    if (g.phase === 'player') return (g.hands.length > 1 ? 'Juegas la mano ' + (g.active + 1) + ' de ' + g.hands.length : 'Tu turno') + shuf;
    if (g.phase === 'settled') {
      const r = g.roundSummary;
      let t = r.net > 0 ? 'Ganas ' + money(r.net) : r.net < 0 ? 'Pierdes ' + money(-r.net) : 'Empate (sin ganancia)';
      if (r.dealerBJ) t = 'El dealer tiene blackjack. ' + t;
      else if (r.dealerBust) t = 'El dealer se pasa (' + r.dealerTotal + '). ' + t;
      if (r.insuranceWin) t += ' (el seguro pagó ' + money(r.insuranceWin - g.insuranceBet) + ')';
      return t;
    }
    return '';
  }

  /* ---------- Render: banca, zapato ---------- */
  function renderTop() {
    $('bankroll').textContent = money(game.bankroll);
    $('betAmount').textContent = money(game.phase === 'betting' ? game.bet : game.hands.reduce((s, h) => s + h.bet, 0));
    const rem = game.shoe.remaining;
    const pen = Math.round((1 - rem / game.shoe.total) * 100);
    $('shoeInfo').textContent = rem + ' cartas (' + pen + '% usado)';
  }

  /* ---------- Render: controles ---------- */
  function btn(action, label, key, enabled, extra) {
    return '<button data-action="' + action + '"' + (enabled ? '' : ' disabled') + (extra || '') + '>' + label +
      (key ? '<span class="key">[' + key + ']</span>' : '') + '</button>';
  }

  function renderControls() {
    const g = game;
    let html = '';
    if (g.phase === 'betting' && g.bankroll < MIN_BET) {
      html += '<button class="primary" data-action="rebuy">Sin fondos: reiniciar banca a ' + money(window.GameModule.START_BANK) + '</button>';
      html += '<button data-action="reset-all">Reiniciar todo (banca + estadísticas)</button>';
    } else if (g.phase === 'betting') {
      [5, 25, 100, 500].forEach((v) => {
        html += '<button class="chip" data-action="chip" data-v="' + v + '"' + ((g.bet + v) * g.spots > g.bankroll ? ' disabled' : '') + '>' + v + '</button>';
      });
      html += '<button data-action="spots-1"' + (g.spots === 1 ? ' class="rec"' : '') + '>1 mano</button>';
      html += '<button data-action="spots-2"' + (g.spots === 2 ? ' class="rec"' : '') + (g.bankroll < MIN_BET * 2 ? ' disabled' : '') + '>2 manos</button>';
      html += btn('clear', 'Borrar', '', g.bet > 0);
      html += btn('rebet', 'Repetir apuesta', '', g.lastBet >= MIN_BET && g.lastBet * g.spots <= g.bankroll);
      html += '<button class="primary" data-action="deal"' + (g.bet >= MIN_BET ? '' : ' disabled') + '>Repartir<span class="key">[Enter]</span></button>';
    } else if (g.phase === 'insurance') {
      const adv = g.insuranceDecision();
      html += '<button data-action="ins-yes"' + (g.bankroll >= g.insuranceCost ? '' : ' disabled') + (adv.take && showAdvice() ? ' class="rec"' : '') + '>Tomar seguro (' + money(g.insuranceCost) + ')<span class="key">[Y]</span></button>';
      html += '<button data-action="ins-no"' + (!adv.take && showAdvice() ? ' class="rec"' : '') + '>No, gracias<span class="key">[N]</span></button>';
    } else if (g.phase === 'player') {
      const A = g.advice();
      const ok = (a) => !!A.actions[a];
      const rec = (a) => (showAdvice() && A.best === a) ? ' class="rec"' : '';
      html += btn('hit', 'Pedir', 'H', ok('hit'), rec('hit'));
      html += btn('stand', A.aceSplit ? 'Recibir carta' : 'Plantarse', 'S', ok('stand'), rec('stand'));
      html += btn('double', 'Doblar', 'D', ok('double'), rec('double'));
      html += btn('split', 'Dividir', 'P', ok('split'), rec('split'));
      html += btn('surrender', 'Rendirse', 'R', ok('surrender'), rec('surrender'));
    } else if (g.phase === 'settled') {
      html += '<button class="primary" data-action="next">Nueva ronda<span class="key">[Enter]</span></button>';
    }
    $('controls').innerHTML = html;
  }

  function showAdvice() { return !prefs.practice || revealed; }

  /* ---------- Render: asesor ---------- */
  function evClass(x) { return x >= 0 ? 'pos' : 'neg'; }
  function evTxt(x) { return (x >= 0 ? '+' : '−') + Math.abs(x * 100).toFixed(1) + '%'; }
  function bustClass(x) { return x >= 0.5 ? 'hi' : x >= 0.25 ? 'mid' : 'lo'; }

  function infoBtn(html) {
    tips.push(html);
    return '<button class="info-btn" data-tip="' + (tips.length - 1) + '" aria-label="Por qué">i</button>';
  }

  function renderAdvisor() {
    tips = [];
    const el = $('advisor');
    const g = game;
    if (g.phase === 'betting') { el.innerHTML = '<p class="muted">Reparte una mano para ver el análisis de cada jugada.</p>'; return; }
    if (g.phase === 'settled') {
      el.innerHTML = '<p class="muted">Ronda terminada. Revisa el resultado y pasa a la siguiente.</p>';
      return;
    }
    if (g.phase === 'dealer') { el.innerHTML = ''; return; }

    if (!showAdvice()) {
      el.innerHTML = '<p>Elige tu jugada primero. Luego te diré si fue la óptima.</p><button data-action="reveal">Ver consejo</button>';
      return;
    }

    if (g.phase === 'insurance') {
      const adv = g.insuranceDecision();
      el.innerHTML = '<div class="adv-head">Dealer muestra <b>As</b>. Seguro: EV <span class="ev neg">' + evTxt(adv.ev) + '</span> ' +
        infoBtn('<p>' + esc(adv.text) + '</p><p>El seguro es una apuesta aparte (pagada 2:1) a que la carta oculta vale 10. Hay 4 de 13 cartas así, pero para ser neutral necesitarías 1 de 3.</p>') +
        '</div><p><b>' + (adv.take ? 'Recomendado: tomar seguro.' : 'Recomendado: NO tomar seguro.') + '</b></p>';
      return;
    }

    const A = g.advice();
    const bet = g.current.bet;
    const rows = A.ranking.map((a) => {
      const r = A.actions[a];
      const isBest = a === A.best;
      const bust = (a === 'hit' || a === 'double') ? '<span class="bust ' + bustClass(r.bust) + '">' + pc(r.bust) + '</span>' : '<span class="muted">—</span>';
      const bar = a === 'surrender' ? '<div class="bar"><i class="l" style="width:50%"></i></div><div class="pcts">pierdes 50% fijo</div>' :
        '<div class="bar"><i class="w" style="width:' + (r.win * 100) + '%"></i><i class="p" style="width:' + (r.push * 100) + '%"></i><i class="l" style="width:' + (r.lose * 100) + '%"></i></div>' +
        '<div class="pcts">G ' + pcShort(r.win) + ' · E ' + pcShort(r.push) + ' · P ' + pcShort(r.lose) + (a === 'split' ? ' (aprox.)' : '') + '</div>';
      const tip = S.explain(A, a).map((l) => '<p>' + l + '</p>').join('');
      return '<tr class="' + (isBest ? 'best' : '') + '"><td class="name">' + S.NAMES[a] + (isBest ? '<span class="star">★ RECOMENDADA</span>' : '') + '</td>' +
        '<td>' + bar + '</td><td>' + bust + '</td>' +
        '<td class="ev ' + evClass(r.ev) + '">' + evTxt(r.ev) + '<small>' + (r.ev >= 0 ? '+' : '−') + money(Math.abs(r.ev * bet)) + '</small></td>' +
        '<td>' + infoBtn(tip) + '</td></tr>';
    }).join('');

    const handName = (A.isPair ? 'Par de ' + (A.cards[0] === 1 ? 'Ases' : A.cards[0] + 's') + ' (' + A.total + ')' : (A.soft ? 'Suave ' : 'Duro ') + A.total);
    el.innerHTML = '<div class="adv-head">Tu mano: <b>' + handName + '</b> vs Dealer <b>' + (A.up === 1 ? 'As' : A.up) +
      '</b> · el dealer se pasa <b>' + pc(A.dealerBust) + '</b></div>' +
      (A.actions[A.best].ev < 0 ? '<div class="note" style="margin:0 0 8px">Ninguna jugada gana en promedio con esta mano: la recomendada es la que <b>menos pierde</b>.</div>' : '') +
      '<table class="adv"><thead><tr><th>Jugada</th><th>G(ana) / E(mpata) / P(ierde)</th><th>% pasarte</th><th>Ganancia/pérdida promedio</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ---------- Render: feedback ---------- */
  function renderFeedback() {
    const f = game.feedback;
    if (!f) { $('feedback').innerHTML = ''; return; }
    if (f.correct) {
      $('feedback').innerHTML = '<div class="fb ok">✔ Jugada óptima: ' + esc(f.chosen) + '.</div>';
    } else {
      $('feedback').innerHTML = '<div class="fb bad">✖ ' + esc(f.text) + '</div>';
    }
  }

  /* ---------- Render: conteo ---------- */
  // Qué vale cada carta: siempre visible para que se sepa qué se está contando
  function countLegend() {
    const grp = (cls, val, ranks, why) => '<div class="lg ' + cls + '"><b>' + val + '</b><span class="ranks">' + ranks + '</span><small>' + why + '</small></div>';
    return '<div class="count-legend">' +
      grp('plus', '+1', '2 3 4 5 6', 'cartas bajas') +
      grp('zero', '0', '7 8 9', 'neutras') +
      grp('minus', '−1', '10 J Q K A', 'cartas altas') + '</div>';
  }

  function countHowTo(open) {
    return '<details class="howto"' + (open ? ' open' : '') + '><summary>¿Cómo funciona y por qué sirve?</summary><ol>' +
      '<li><b>Suma cada carta que ves</b> con los valores de arriba (las tuyas, las del dealer y la oculta cuando se voltea). Ese total acumulado es el <b>running count</b>; vuelve a 0 cuando se baraja el zapato.</li>' +
      '<li><b>Divide entre los mazos que faltan</b> para obtener el <b>true count</b>. Un +6 con 6 mazos por delante es poco; con 1 mazo es muchísimo.</li>' +
      '<li><b>Por qué funciona:</b> si salieron muchas cartas bajas (conteo positivo), en el zapato quedan más 10 y Ases. Eso te da más blackjacks (pagan 3:2) y hace que el dealer, que está obligado a pedir hasta 17, se pase más.</li>' +
      '<li><b>Cómo usarlo:</b> conteo bajo o negativo → apuesta el mínimo. True count +2 o más → sube la apuesta. True count +3 o más → el seguro pasa a convenir.</li>' +
      '</ol></details>';
  }

  // Desglose de la ronda: "empezaste en +2 → +1 −1 0 → ahora +2"
  function countFeed() {
    const g = game;
    const chips = g.seen.map((c) => {
      const v = E.hiLo(c);
      return '<span class="fc ' + hiLoCls(v) + '">' + c.rank + '<i>' + hiLoTxt(v) + '</i></span>';
    }).join('');
    const delta = g.runningCount - g.startCount;
    let html = '<div class="feed"><div class="feed-head">Esta ronda</div>';
    if (!g.seen.length) {
      html += '<p class="muted">Aún no salen cartas. El conteo arranca en <b>' + signed(g.startCount) + '</b>' +
        (g.startCount === 0 ? ' (zapato recién barajado o equilibrado).' : ' (lo que traes de rondas anteriores).') + '</p>';
    } else {
      html += '<div class="feed-row"><span class="fc start">inicio<i>' + signed(g.startCount) + '</i></span>' + chips +
        '<span class="fc now">ahora<i>' + signed(g.runningCount) + '</i></span></div>' +
        '<p class="note">Esta ronda sumó <b>' + signed(delta) + '</b>: ' + signed(g.startCount) + ' ' + (delta < 0 ? '−' : '+') + ' ' + Math.abs(delta) + ' = <b>' + signed(g.runningCount) + '</b>.' +
        (g.dealer.hidden ? ' La carta oculta del dealer se cuenta cuando se voltea.' : '') + '</p>';
    }
    if (g.shuffled) html += '<p class="note">Se barajó el zapato al repartir: el conteo empezó de nuevo en 0.</p>';
    return html + '</div>';
  }

  // Números + cómo se calculan + qué significan + cuánto apostar
  function countNumbers() {
    const g = game;
    const hidden = g.dealer.hidden ? 1 : 0;
    const decks = g.shoe.decksRemaining(hidden);
    const cardsLeft = g.shoe.remaining + hidden;
    const tc = g.trueCount;
    const adv = g.countAdvice();
    const sug = g.suggestedBet();
    const pos = Math.max(0, Math.min(100, (tc + 5) / 10 * 100));
    let html = '<div class="count-grid">' +
      '<div><b>' + signed(g.runningCount) + '</b><span>Running count</span><small>suma de cartas vistas</small></div>' +
      '<div><b>' + decks.toFixed(1) + '</b><span>Mazos restantes</span><small>' + cardsLeft + ' cartas ÷ 52</small></div>' +
      '<div class="tc ' + adv.level + '"><b>' + (tc > 0 ? '+' : tc < 0 ? '−' : '') + Math.abs(tc).toFixed(1) + '</b><span>True count</span><small>' + signed(g.runningCount) + ' ÷ ' + decks.toFixed(1) + '</small></div></div>' +
      '<div class="meter" aria-hidden="true"><i style="left:' + pos + '%"></i></div>' +
      '<div class="meter-lbl"><span>−5 casa</span><span>0</span><span>+5 tú</span></div>' +
      '<div class="verdict ' + adv.level + '"><b>' + adv.label + '</b> · tu ventaja estimada ' + (adv.edge >= 0 ? '+' : '−') + Math.abs(adv.edge * 100).toFixed(1) + '%' +
      '<p>' + adv.text + '</p>' +
      '<div class="sug">';
    if (g.bankroll < MIN_BET * g.spots && g.phase === 'betting') return html + 'Sin fondos para apostar.</div></div>';
    const unit = window.GameModule.BET_UNIT;
    html += 'Apuesta sugerida' + (g.phase === 'betting' ? '' : ' para la próxima ronda') + ': <b>' + money(sug.amount) + '</b> por mano' +
      ' <span class="muted">(' + sug.units + (sug.units === 1 ? ' unidad' : ' unidades') + ' de ' + money(unit) +
      (sug.amount !== sug.units * unit ? ', ajustada a tu banca' : '') + ')</span>';
    if (g.phase === 'betting') {
      html += ' <button class="small" data-action="use-suggested"' + (g.bet === sug.amount ? ' disabled' : '') + '>Usar</button>';
    }
    return html + '</div></div>';
  }

  function renderCount() {
    const el = $('countPanel');
    const g = game;
    if (prefs.countMode === 'off') {
      el.innerHTML = '<p>Contar cartas te dice cuándo el zapato te favorece para apostar más.</p>' + countLegend() +
        '<p class="note"><b>Aprender</b>: cada carta de la mesa muestra su valor y aquí ves el conteo paso a paso. ' +
        '<b>Practicar</b>: tú llevas la cuenta y al final de cada ronda te pregunto el resultado.</p>';
      return;
    }

    if (prefs.countMode === 'learn') {
      el.innerHTML = countLegend() + countFeed() + countNumbers() + countHowTo(g.stats.rounds === 0);
      return;
    }

    // Practicar: nada visible hasta que respondas al final de la ronda
    let html = countLegend();
    const answered = quiz && quiz.round === g.stats.rounds;
    if (g.phase === 'settled' && !answered) {
      html += '<form class="quiz" data-form="count-quiz"><label for="countGuess">Ronda terminada. <b>¿Cuál es el running count ahora?</b></label>' +
        '<div class="quiz-row"><input id="countGuess" type="number" step="1" inputmode="numeric" required autocomplete="off" placeholder="ej. 3 o -2">' +
        '<button type="submit" class="primary">Comprobar</button></div>' +
        '<p class="note">Suma todas las cartas que se vieron desde que se barajó (incluida la oculta del dealer).</p></form>';
    } else if (g.phase === 'settled' && answered) {
      html += '<div class="fb ' + (quiz.ok ? 'ok' : 'bad') + '">' + (quiz.ok ? '✔ ¡Exacto! ' : '✖ Dijiste ' + signed(quiz.guess) + '. ') +
        'El running count es <b>' + signed(g.runningCount) + '</b>.</div>' + countFeed() + countNumbers();
    } else if (g.phase === 'betting') {
      html += '<p>Usa tu conteo para decidir la apuesta: <b>true count = running ÷ mazos restantes</b>.</p>' +
        '<p class="muted">Quedan ~' + g.shoe.decksRemaining(0).toFixed(1) + ' mazos en el zapato (' + g.shoe.remaining + ' cartas).</p>' +
        (g.stats.rounds === 0 ? countHowTo(true) : '');
    } else {
      html += '<p>Cuenta mentalmente cada carta que aparece en la mesa. Al terminar la ronda te pregunto el running count.</p>' +
        (g.shuffled ? '<p class="note">Zapato recién barajado: empieza desde 0.</p>' : '');
    }
    el.innerHTML = html;
  }

  /* ---------- Render: estadísticas ---------- */
  function renderStats() {
    const st = game.stats;
    const acc = st.decisions ? (st.correct / st.decisions * 100).toFixed(1) + '%' : '—';
    const rows = [
      ['Rondas', st.rounds],
      ['Manos G / E / P', st.wins + ' / ' + st.pushes + ' / ' + st.losses],
      ['Blackjacks', st.blackjacks],
      ['Neto', '<span class="ev ' + evClass(st.net) + '">' + money(st.net) + '</span>'],
      ['Decisiones', st.decisions],
      ['Precisión', '<b>' + acc + '</b>'],
      ['Errores', st.decisions - st.correct],
      ['Costo de errores', money(-st.moneyLost) + ' (EV)'],
      ['Pico de banca', money(st.peak)]
    ];
    if (st.countChecks) rows.push(['Conteo acertado', st.countCorrect + ' / ' + st.countChecks]);
    let html = '<div class="stat-grid">' + rows.map((r) => '<div><span>' + r[0] + '</span><span>' + r[1] + '</span></div>').join('') + '</div>';
    if (st.errors.length) {
      html += '<p class="note" style="margin-top:10px">Últimos errores:</p><ul class="errors">' + st.errors.slice(0, 8).map((e) => '<li>' + esc(e.text) + '</li>').join('') + '</ul>';
    }
    $('stats').innerHTML = html;
  }

  /* ---------- Tabla de estrategia ---------- */
  function renderChart() {
    const c = S.chart();
    const head = '<tr><th></th>' + c.ups.map((u) => '<th>' + (u === 1 ? 'A' : u) + '</th>').join('') + '</tr>';
    const table = (title, rows) => '<table class="chart"><caption>' + title + '</caption>' + head +
      rows.map((r) => '<tr><td class="lbl">' + r.label + '</td>' + r.cells.map((x) => '<td class="c-' + x + '">' + x + '</td>').join('') + '</tr>').join('') + '</table>';
    $('chart').innerHTML = '<div class="chart-wrap">' + table('Manos duras', c.rows.hard) + table('Manos suaves', c.rows.soft) + table('Pares', c.rows.pairs) + '</div>' +
      '<div class="legend"><span class="H">H = Pedir</span><span class="S">S = Plantarse</span><span class="D">D = Doblar (si no se puede: pedir/plantarse)</span><span class="P">P = Dividir</span><span class="R">R = Rendirse (si no se puede: según EV, normalmente pedir)</span></div>' +
      '<p class="note">Columnas = carta visible del dealer. Se genera con el mismo motor que el asesor (H17, DAS, rendición tardía).</p>';
  }

  /* ---------- Render general ---------- */
  function render() {
    game.countAssist = prefs.countMode !== 'off';
    $('optPractice').checked = prefs.practice;
    document.querySelectorAll('#countMode button').forEach((b) => {
      b.classList.toggle('on', b.dataset.action === 'count-' + prefs.countMode);
    });
    if (game.bankroll >= MIN_BET) wentBroke = false;
    $('broke').hidden = !(wentBroke && game.phase === 'betting');
    renderTop();
    renderTable();
    renderControls();
    renderAdvisor();
    renderFeedback();
    renderCount();
    renderStats();
    const guess = $('countGuess');
    if (guess) guess.focus({ preventScroll: true }); // escribir y Enter para comprobar
    save();
  }

  /* ---------- Acciones ---------- */
  function doAction(a) {
    const g = game;
    switch (a) {
      case 'hit': case 'stand': case 'double': case 'split': case 'surrender':
        if (g.act(a)) revealed = false;
        break;
      case 'ins-yes': g.takeInsurance(true); revealed = false; break;
      case 'ins-no': g.takeInsurance(false); revealed = false; break;
      case 'deal': g.deal(); revealed = false; break;
      case 'next': g.nextRound(); g.rebet(); wentBroke = g.bankroll < MIN_BET; break;
      case 'rebuy': g.rebuy(); break;
      case 'spots-1': g.setSpots(1); break;
      case 'spots-2': g.setSpots(2); break;
      case 'clear': g.clearBet(); break;
      case 'rebet': g.rebet(); break;
      case 'reveal': revealed = true; break;
      case 'count-off': prefs.countMode = 'off'; break;
      case 'count-learn': prefs.countMode = 'learn'; break;
      case 'count-quiz': prefs.countMode = 'quiz'; break;
      case 'use-suggested': g.setBet(g.suggestedBet().amount); break;
      case 'reset-all':
        if (confirm('¿Reiniciar banca y estadísticas?')) { g.resetAll(); revealed = false; quiz = null; }
        break;
    }
    hideTip();
    render();
  }

  document.addEventListener('click', (e) => {
    const tipBtn = e.target.closest('.info-btn');
    if (tipBtn) { toggleTip(tipBtn); return; }
    const b = e.target.closest('[data-action]');
    if (!b || b.disabled) { hideTip(); return; }
    if (b.dataset.action === 'chip') { game.addChip(parseInt(b.dataset.v, 10)); hideTip(); render(); return; }
    doAction(b.dataset.action);
  });

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
    const k = e.key.toLowerCase();
    const g = game;
    if (k === 'enter') {
      e.preventDefault();
      if (g.phase === 'betting') { if (g.bet === 0) g.rebet(); if (g.bet >= MIN_BET) doAction('deal'); else render(); }
      else if (g.phase === 'settled') doAction('next');
      return;
    }
    if (g.phase === 'insurance') { if (k === 'y') doAction('ins-yes'); else if (k === 'n') doAction('ins-no'); return; }
    if (g.phase === 'player') {
      const map = { h: 'hit', s: 'stand', d: 'double', p: 'split', r: 'surrender' };
      if (map[k] && g.allowed().indexOf(map[k]) !== -1) doAction(map[k]);
    }
  });

  document.addEventListener('submit', (e) => {
    if (e.target.dataset.form !== 'count-quiz') return;
    e.preventDefault();
    const guess = parseInt($('countGuess').value, 10);
    if (isNaN(guess) || game.phase !== 'settled') return;
    quiz = { round: game.stats.rounds, guess, ok: game.checkCount(guess) };
    render();
  });

  $('optPractice').addEventListener('change', (e) => { prefs.practice = e.target.checked; revealed = false; render(); });

  /* ---------- Tooltips ---------- */
  const tipEl = $('tooltip');
  let tipOwner = null;
  let tipPinned = false; // fijado con clic (útil en pantallas táctiles)
  function toggleTip(btnEl) {
    if (tipOwner === btnEl && tipPinned) { hideTip(); return; }
    showTip(btnEl);
    tipPinned = true;
  }
  function showTip(btnEl) {
    tipEl.innerHTML = tips[parseInt(btnEl.dataset.tip, 10)] || '';
    tipEl.hidden = false;
    tipOwner = btnEl;
    const r = btnEl.getBoundingClientRect();
    const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    let left = Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8);
    let top = r.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 8);
    tipEl.style.left = left + 'px';
    tipEl.style.top = top + 'px';
  }
  function hideTip() { tipEl.hidden = true; tipOwner = null; tipPinned = false; }
  document.addEventListener('mouseover', (e) => { const b = e.target.closest('.info-btn'); if (b && b !== tipOwner && !tipPinned) showTip(b); });
  document.addEventListener('mouseout', (e) => {
    const b = e.target.closest('.info-btn');
    if (b && tipOwner === b && !tipPinned && !(e.relatedTarget && b.contains(e.relatedTarget))) hideTip();
  });
  window.addEventListener('scroll', hideTip, true);

  /* ---------- Inicio ---------- */
  load();
  renderChart();
  if (game.phase === 'betting') game.rebet();
  render();
})();
