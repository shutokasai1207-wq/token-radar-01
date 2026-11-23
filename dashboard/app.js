// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, the top of the board, a filterable table, a per-protocol detail view with the
// model's own arithmetic, and the peer table the values were calibrated from. No network: every
// byte it shows is in data.js, and the farm plan it prints is the very string board.json carries.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tier: 'all', tab: 'pre', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + Number(n).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'); }
  // The model in one function: the page recomputes a row from the factors data.js prints and checks
  // the number board.json carries, so the page's code and the board's data are visibly one arithmetic.
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * row.momentum_multiplier * row.maturity_multiplier * row.breadth_multiplier));
  }
  function whyLine(r) {
    var bits = ['peers pay ' + fmtMult(r.peer_multiple) + ' TVL'];
    if (r.change_7d !== null && r.change_7d !== undefined) bits.push('7d ' + fmtPct(r.change_7d));
    bits.push(r.age_days === null ? 'age unlisted' : fmtAge(r.age_days) + ' with no token');
    return bits.join(' · ');
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tier')) state.tier = params.get('tier');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tier !== 'all') params.set('tier', state.tier);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'peer') { av = a.peer_multiple; bv = b.peer_multiple; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'LAUNCH RADAR' })),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('b', { text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('b', { text: DATA.model_version }))
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, ranked by what their live peers say a token would be worth' }),
        el('p', null,
          'Every protocol here records no token, and none is a wrapped, staked or bridged product of a token that already trades: those are set aside by the watchlist rule\'s own screen, at every size. Each board protocol is valued at the market-cap-to-TVL multiple its own category\'s live protocols actually trade at, adjusted for its week, its record and its reach. ',
          el('b', { text: 'The watchlist is the floor, not the board: ' }),
          'all ' + DATA.watchlist_size + ' watchlist protocols are covered, and the radar also ranks ' + DATA.early_size + ' early protocols the watchlist leaves out. Implied value is this board\'s claim, not a promise, and it predicts no launch.'
        )
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live peers calibrating' }), el('b', { text: String(DATA.global_peer_n) })),
        el('div', { class: 'fact' }, el('span', { text: 'Market median mcap / TVL' }), el('b', { text: fmtMult(DATA.global_peer_median) }))
      )
    );
  }

  function picks() {
    var top = DATA.rows.slice(0, 3);
    return el('section', { class: 'picks', 'aria-label': 'Top of the board' },
      top.map(function (r) {
        return el('button', { class: 'pick', type: 'button', onclick: function () { openDetail(r.slug); } },
          el('span', { class: 'pick-rank', text: 'RANK ' + r.rank + ' · ' + r.signal.toUpperCase() }),
          el('h3', { text: r.name }),
          el('div', { class: 'pick-value', text: fmtUsd(r.implied_value_usd) }),
          el('p', { text: whyLine(r) })
        );
      })
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function select(id, label, values, current, onchange) {
      var s = el('select', { id: id, 'aria-label': label },
        values.map(function (v) { return el('option', { value: v[0], text: v[1], selected: v[0] === current ? 'selected' : null }); })
      );
      s.addEventListener('change', function () { onchange(s.value); writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      select('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      select('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      select('tier', 'Radar tier', [['all', 'Watchlist + early'], ['watchlist', 'Watchlist only'], ['early', 'Early only']], state.tier, function (v) { state.tier = v; }),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label, numeric) {
    return el('th', { scope: 'col', class: numeric ? 'num' : '' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or widen the category, chain or tier to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tier = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'an unnamed chain') }),
          r.flags.length ? el('span', { class: 'flagline', text: r.flags[0] + (r.flags.length > 1 ? ' · +' + (r.flags.length - 1) + ' more' : '') }) : null
        )),
        el('td', null, el('span', { class: 'tier' + (r.tier === 'watchlist' ? ' watch' : ''), text: r.tier })),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.peer_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, el('span', { class: 'signal ' + r.signal, text: r.signal }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols ranked by implied value. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank', true),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Tier' }),
            sortHeader('tvl', 'TVL', true),
            sortHeader('growth', '7d', true),
            sortHeader('age', 'Age', true),
            sortHeader('peer', 'Peer x', true),
            sortHeader('implied', 'Implied value', true),
            el('th', { scope: 'col', text: 'Signal' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.mcap_usd && r.tvl_usd ? r.mcap_usd / r.tvl_usd : null;
      tbody.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: ratio === null ? 'n/a' : fmtMult(ratio) }),
        el('td', null, el('span', { class: 'tier', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Live token: these protocols already trade, so their market cap is a fact, not a model. Their mcap / TVL ratios are the peer evidence the pre-token board is calibrated from; they are never ranked.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'mcap / TVL' }), el('th', { scope: 'col', text: 'Token' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var peerRows = DATA.peers.slice(0, 12).map(function (g) {
      return el('tr', null,
        el('td', { text: g.category }),
        el('td', { class: 'num', text: String(g.n) }),
        el('td', { class: 'num', text: fmtMult(g.median) }),
        el('td', { class: 'num', text: fmtMult(g.used) })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function of the snapshot\'s own figures scores every row. No protocol name is special-cased and no row is hand-picked: the peer table below is computed from this snapshot at run time.' }),
      el('div', { class: 'formula', text: 'implied = round( tvl x peer_multiple x momentum x maturity x breadth )' }),
      el('p', { class: 'note', text: 'peer_multiple is the median market-cap / TVL of the live protocols in the row\'s category, blended in log space with the market-wide median (' + fmtMult(DATA.global_peer_median) + ' over ' + DATA.global_peer_n + ' live ratios) by w = n / (n + ' + m.peer_shrink + ') and clamped to [' + m.peer_min + ', ' + m.peer_max + '], so one richly priced peer cannot carry a category of one. A category with no live peers uses the market median. Wrapped, staked and bridged products of live tokens (the Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC and CEX categories, versioned names, and names carrying wrapped, staked or staking or an exchange\'s name) are screened out before ranking, by the watchlist rule\'s own definition: WBTC is Bitcoin on Ethereum, not a launch still to come.' }),
      el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', class: 'num', text: 'Live peers' }), el('th', { scope: 'col', class: 'num', text: 'Median mcap / TVL' }), el('th', { scope: 'col', class: 'num', text: 'Multiple used' }))),
        el('tbody', null, peerRows)
      ),
      el('p', { class: 'note', text: 'momentum damps the seven-day change on a log scale before weighting it at ' + m.momentum_weight + ', so a +4,448% week counts as about +322% and cannot carry a ranking; the factor is clamped to [' + m.momentum_min + ', ' + m.momentum_max + '] and an unreported change is neutral. maturity runs from ' + m.maturity_floor + ' to ' + (m.maturity_floor + m.maturity_range) + ' over ' + m.maturity_days + ' days of tokenless record (unknown age counts as ' + m.unknown_age_days + ' days). breadth adds ' + (m.breadth_per_chain * 100) + '% per extra chain, up to ' + m.breadth_max_extra + '. The signal grade (Prime, Strong, Watch, Fading) summarises momentum, record and size for the reader; the rank itself is implied value alone.' }),
      el('p', { class: 'note' }, el('b', { text: 'What this board does not claim: ' }), 'that any protocol will issue a token, or when. It says what a token would be worth if the protocol\'s record stayed as the snapshot has it, and what farming it costs. Protocols are described as recording no token, because a data feed\'s silence is not proof none exists.')
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'RANK ' + row.rank + ' OF ' + DATA.board_size + ' · ' + row.tier.toUpperCase() + ' · ' + row.signal.toUpperCase() }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    var recomputed = impliedOf(row);
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, factor by factor' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple (' + (row.category || 'category') + ', n=' + row.peer_sample + ')' }), el('b', { text: fmtMult(row.peer_multiple) })),
        el('div', null, el('span', { text: 'Momentum (7d ' + fmtPct(row.change_7d) + ', damped)' }), el('b', { text: fmtMult(row.momentum_multiplier) })),
        el('div', null, el('span', { text: 'Maturity (' + fmtAge(row.age_days) + ' tokenless)' }), el('b', { text: fmtMult(row.maturity_multiplier) })),
        el('div', null, el('span', { text: 'Breadth (' + (row.chains ? row.chains.length : 0) + ' chains)' }), el('b', { text: fmtMult(row.breadth_multiplier) })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' An estimate from peer prices, not a price and not a launch prediction.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Flags on this record' }),
      el('div', { class: 'flags' }, row.flags.length ? row.flags.map(function (f) { return el('span', { text: f }); }) : [el('span', { class: 'none', text: 'no flags: reported change, known age, several chains, a peer set behind the multiple' })])
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    if (state.tab === 'pre') shell.appendChild(picks());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre' ? boardTable() : liveTable());
    if (state.tab === 'pre') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
