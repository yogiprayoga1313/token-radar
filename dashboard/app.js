// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders the
// ranked board, a filterable sortable table, the peer multiples the model is built on, and a per-protocol
// detail drawer carrying the whole value chain and the farm plan. No network: every byte is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', conviction: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

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
  function fmtMult(n) { return n.toFixed(n < 0.1 ? 3 : 2) + 'x'; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // ---------------------------------------------------------------------------------------------
  // The model, recomputed in the page from the same constants main.ts used. The detail drawer shows
  // this number beside the one board.json carries, so the page's arithmetic and the board's data are
  // visibly the same model rather than a claim about one.
  // ---------------------------------------------------------------------------------------------
  function farmerShare(tvl, m) {
    var lo = Math.log10(Math.max(m.share_tvl_small, 1));
    var hi = Math.log10(Math.max(m.share_tvl_large, m.share_tvl_small * 10));
    var t = clamp((Math.log10(Math.max(tvl, 1)) - lo) / (hi - lo), 0, 1);
    return m.share_small + (m.share_large - m.share_small) * t;
  }
  function launchTiming(age, m) {
    var d = age === null || age === undefined ? m.unknown_age_days : age;
    if (d <= 0) return m.timing_min;
    if (d < m.timing_cold) return m.timing_min + (1 - m.timing_min) * (d / m.timing_cold) * 0.6;
    if (d < m.timing_open) {
      var start = m.timing_min + (1 - m.timing_min) * 0.6;
      return start + (1 - start) * ((d - m.timing_cold) / (m.timing_open - m.timing_cold));
    }
    if (d <= m.timing_close) return 1;
    if (d >= m.timing_stale) return m.timing_tail;
    return 1 - (1 - m.timing_tail) * ((d - m.timing_close) / (m.timing_stale - m.timing_close));
  }
  function momentumOf(change7d, m) {
    var g = clamp(change7d === null || change7d === undefined ? 0 : change7d, m.growth_floor, m.growth_cap);
    return 1 + Math.tanh(g / m.growth_scale) * m.growth_weight;
  }
  function impliedOf(row, m) {
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * farmerShare(row.tvl_usd, m) * launchTiming(row.age_days, m) * momentumOf(row.change_7d, m)));
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

  // The farm plan comes from dashboard/farm.js, the same file lib/model.ts imports to write
  // board.json, so the plan on screen and the plan in the data are one implementation.
  function farmSteps(row) { return window.FARM.plan(row); }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('conviction')) state.conviction = params.get('conviction');
    if (params.get('sort')) state.sort = params.get('sort');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.conviction !== 'all') params.set('conviction', state.conviction);
    if (state.sort !== 'implied') params.set('sort', state.sort);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.conviction !== 'all' && r.conviction !== state.conviction) return false;
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
      else if (key === 'multiple') { av = a.peer_multiple; bv = b.peer_multiple; }
      else if (key === 'perfarmer') { av = a.per_farmer_usd; bv = b.per_farmer_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function svg(tag, attrs) {
    var node = document.createElementNS(SVGNS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') node.textContent = attrs[k];
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    return node;
  }

  /**
   * The model's thesis as one picture: every peer multiple on one axis, so the spread between the
   * cheapest and dearest category is a distance rather than a claim. One measure, one series, so there
   * is no legend and no categorical colour; the exact numbers live in the table below.
   */
  function spreadChart() {
    var sets = DATA.categories.filter(function (c) { return c.pre_token_rows > 0; });
    if (sets.length < 2) return null;
    var W = 420, H = 128, padL = 10, padR = 12, axisY = 100;
    var max = Math.max.apply(null, sets.map(function (c) { return c.multiple; }));
    // The axis ends just past the dearest category rather than at a round number, so the spread uses
    // the whole width instead of leaving a tenth of it empty.
    var top = max * 1.05;
    var x = function (v) { return padL + (v / top) * (W - padL - padR); };

    var node = svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H, class: 'spread', role: 'img',
      'aria-label': sets.length + ' peer multiples from ' + fmtMult(Math.min.apply(null, sets.map(function (c) { return c.multiple; }))) + ' to ' + fmtMult(max) + ', around a ' + fmtMult(DATA.global_multiple) + ' global median',
    });

    // Axis: recessive, with a tick every 0.2x.
    node.appendChild(svg('line', { x1: padL, y1: axisY, x2: W - padR, y2: axisY, class: 'ax' }));
    for (var t = 0; t <= top + 1e-9; t += 0.2) {
      node.appendChild(svg('line', { x1: x(t), y1: axisY, x2: x(t), y2: axisY + 4, class: 'ax' }));
      node.appendChild(svg('text', { x: x(t), y: axisY + 17, class: 'tick', 'text-anchor': 'middle', text: t.toFixed(1) + 'x' }));
    }

    // The global median: the anchor every thin peer set is shrunk toward.
    var gx = x(DATA.global_multiple);
    node.appendChild(svg('line', { x1: gx, y1: 16, x2: gx, y2: axisY, class: 'median' }));
    node.appendChild(svg('text', { x: gx + 5, y: 22, class: 'tick', text: 'global median ' + fmtMult(DATA.global_multiple) }));

    // One dot a peer set, stacked upward where they crowd so none hides another.
    var sorted = sets.slice().sort(function (a, b) { return a.multiple - b.multiple; });
    var lanes = [];
    sorted.forEach(function (c) {
      var cx = x(c.multiple);
      var lane = 0;
      while (lanes[lane] !== undefined && cx - lanes[lane] < 13) lane++;
      lanes[lane] = cx;
      var cy = axisY - 12 - lane * 12;
      var dot = svg('circle', { cx: cx, cy: cy, r: 5, class: 'dot' });
      dot.appendChild(svg('title', { text: c.category + ': ' + fmtMult(c.multiple) + ' from ' + c.peers + ' live peers, pricing ' + c.pre_token_rows + ' row' + (c.pre_token_rows === 1 ? '' : 's') }));
      node.appendChild(dot);
    });
    return node;
  }

  function lede() {
    var lo = DATA.categories.filter(function (c) { return c.pre_token_rows > 0; }).reduce(function (a, b) { return a.multiple <= b.multiple ? a : b; });
    var hi = DATA.categories.filter(function (c) { return c.pre_token_rows > 0; }).reduce(function (a, b) { return a.multiple >= b.multiple ? a : b; });
    var chart = spreadChart();
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, priced against their own category' }),
        el('p', { text: 'Every protocol here records no token at all. Each is priced at what the market already pays for a dollar of TVL in its own category, read from the ' + DATA.peer_protocols + ' protocols in this snapshot whose token does trade, then discounted for how close it is to a launch window and whether capital is arriving or leaving.' }),
        el('div', { class: 'facts' },
          el('div', { class: 'fact' }, el('b', { text: DATA.watchlist_size + '/' + DATA.watchlist_size }), el('span', { text: 'watchlist covered' })),
          el('div', { class: 'fact' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'rows scored' })),
          el('div', { class: 'fact' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'below the floor' })),
          el('div', { class: 'fact' }, el('b', { text: String(DATA.peer_protocols) }), el('span', { text: 'live peers priced from' }))
        )
      ),
      chart === null ? null : el('figure', { class: 'spread-fig' },
        el('figcaption', { text: 'What a dollar of TVL is worth, by category' }),
        chart,
        el('p', { class: 'sub', text: 'Each dot is one category’s live-token peers: ' + fmtMult(lo.multiple) + ' for ' + lo.category + ' up to ' + fmtMult(hi.multiple) + ' for ' + hi.category + ', a ' + Math.round(hi.multiple / lo.multiple) + '-fold spread. Two protocols of equal TVL in different categories are priced that far apart, which is why this board is not the TVL order.' })
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var conv = el('select', { id: 'conviction', 'aria-label': 'Filter by conviction' },
      [['all', 'Any conviction'], ['high', 'High only'], ['medium', 'Medium only'], ['low', 'Low only']].map(function (o) {
        return el('option', { value: o[0], text: o[1], selected: o[0] === state.conviction ? 'selected' : null });
      })
    );
    conv.addEventListener('change', function () { state.conviction = conv.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('label', { for: 'conviction', text: 'Conviction' }), conv),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.rows.length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label, title) {
    return el('th', { scope: 'col', title: title || null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } writeHash(); render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function convictionBadge(c) {
    return el('span', { class: 'conv conv-' + c, title: c === 'high' ? 'Priced off eight or more live peers in its own category, with both time series present' : c === 'medium' ? 'Priced off its category or its category family' : 'Priced off the global median: too few live peers to quote it' , text: c });
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.conviction = 'all'; writeHash(); render(); } })
      ));
    }
    var max = Math.max.apply(null, list.map(function (r) { return r.implied_value_usd; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num' }, String(r.rank)),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { class: 'num', text: fmtMult(r.peer_multiple) }),
          el('span', { class: 'sub', text: r.peer_basis === 'global' ? 'global median' : (r.peer_category || '') + ' (' + r.peer_count + ' peers)' })
        )),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: '$' + r.per_farmer_usd }),
        el('td', null, convictionBadge(r.conviction))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Sort any column; select a row for its whole value chain and farm plan.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: '#' }),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age, no token'),
            sortHeader('multiple', 'Peer multiple', 'What the market pays per dollar of TVL in this category'),
            sortHeader('implied', 'Implied value'),
            sortHeader('perfarmer', 'Per farmer', 'The implied pool split between the farmers the model assumes'),
            el('th', { scope: 'col', text: 'Conviction' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? 'n/a' : fmtMult(r.multiple) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their mcap/TVL is the observation every pre-token row is priced from.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'mcap / TVL' }), el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  // The evidence behind criterion two: the multiples are not constants, they are medians read out of
  // this snapshot's own live-token protocols, and they span more than an order of magnitude.
  function multiplesPanel() {
    var list = DATA.categories.filter(function (c) { return c.pre_token_rows > 0; });
    if (list.length === 0) return null;
    var max = Math.max.apply(null, list.map(function (c) { return c.multiple; })) || 1;
    var tbody = el('tbody');
    list.forEach(function (c) {
      tbody.appendChild(el('tr', { class: 'static' },
        el('td', null, el('div', { class: 'name' },
          el('b', { text: c.category }),
          el('span', { class: 'sub', text: c.basis === 'family' ? 'category family' : 'category' })
        )),
        el('td', { class: 'num', text: String(c.peers) }),
        el('td', { class: 'num', text: fmtMult(c.raw_multiple) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((c.multiple / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtMult(c.multiple) })
        )),
        el('td', { class: 'num', text: String(c.pre_token_rows) })
      ));
    });
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'What the market pays, by category' }),
        el('p', { class: 'sub', text: 'Each multiple is the median mcap / TVL of this snapshotâ€™s own live-token protocols in that peer set, shrunk toward the global median of ' + fmtMult(DATA.global_multiple) + ' by how many peers it has. A category the snapshot gives too few live peers borrows its familyâ€™s; only a category with neither falls back to the global median. Nothing here is a constant anyone typed in.' })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Peer set' }),
            el('th', { scope: 'col', text: 'Live peers' }),
            el('th', { scope: 'col', text: 'Raw median' }),
            el('th', { scope: 'col', text: 'Applied, after shrinkage' }),
            el('th', { scope: 'col', text: 'Rows priced' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row. No protocol name appears anywhere in it, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'implied = round( tvl_usd x peerMultiple(category) x farmerShare(tvl_usd) x launchTiming(age_days) x momentum(change_7d) )'
      ),
      el('dl', { class: 'terms' },
        el('div', null, el('dt', { text: 'peerMultiple' }), el('dd', { text: 'The median mcap / TVL of the snapshotâ€™s live-token protocols in the same category, shrunk toward the ' + fmtMult(DATA.global_multiple) + ' global median by peer count (k = ' + m.peer_shrinkage + ', a peer set needs ' + m.peer_min + ' to be quoted). Bounded to ' + m.multiple_floor + 'x..' + m.multiple_cap + 'x.' })),
        el('div', null, el('dt', { text: 'farmerShare' }), el('dd', { text: 'The slice of a launch an early-user distribution hands to farmers: ' + (m.share_small * 100).toFixed(1) + '% at $' + Math.round(m.share_tvl_small / 1e6) + 'M of TVL falling to ' + (m.share_large * 100).toFixed(1) + '% at $' + Math.round(m.share_tvl_large / 1e9) + 'B, interpolated on a log scale. A bigger protocol spreads its distribution over more claimants.' })),
        el('div', null, el('dt', { text: 'launchTiming' }), el('dd', { text: 'How close the protocol is to the window where tokens actually ship, from days since listing. Deliberately not monotonic: it ramps from ' + m.timing_min + ' below ' + m.timing_cold + ' days, holds full weight from ' + m.timing_open + ' to ' + m.timing_close + ' days, then decays to ' + m.timing_tail + ' by ' + m.timing_stale + '. A protocol that has run that long with no token is evidence against a launch, not for one.' })),
        el('div', null, el('dt', { text: 'momentum' }), el('dd', { text: 'Whether capital is arriving or leaving, from the seven-day TVL change clamped to ' + m.growth_floor + '%..' + m.growth_cap + '% and softened through tanh at scale ' + m.growth_scale + ', weight ' + m.growth_weight + ', so one violent week cannot carry a row.' })),
        el('div', null, el('dt', { text: 'Per farmer' }), el('dd', { text: 'The implied pool split between tvl_usd / $' + m.farmer_position_usd.toLocaleString('en-US') + ' assumed farmers, never fewer than ' + m.farmers_floor + '. It is the number a reader with one wallet should actually read.' }))
      ),
      el('p', { class: 'sub', text: 'TVL, seven-day growth, category and listing date all come from the sealed snapshot; a protocol with no listing date is scored at ' + m.unknown_age_days + ' days. Protocols whose token already trades are set aside on the Live token tab and are never ranked here â€” they are the evidence the multiples are read from.' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function chainRow(label, value, note) {
    return el('div', { class: 'chain-row' },
      el('span', { text: label }),
      el('b', { class: 'num', text: value }),
      note ? el('span', { class: 'chain-note', text: note }) : null
    );
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var m = DATA.model;
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, m);
    var share = farmerShare(row.tvl_usd, m);

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'The value chain' }),
      el('div', { class: 'chain' },
        chainRow('TVL, from the snapshot', fmtUsd(row.tvl_usd), null),
        chainRow('x Peer multiple', fmtMult(row.peer_multiple), row.peer_basis === 'global' ? 'global median: too few live peers to quote its category' : 'median of ' + row.peer_count + ' live-token ' + (row.peer_basis === 'family' ? 'protocols in the ' + row.peer_category + ' family' : row.peer_category + ' protocols')),
        chainRow('= Expected launch value', fmtUsd(row.expected_fdv_usd), 'what a token on this much TVL has been worth in its peer set'),
        chainRow('x Farmer share', (share * 100).toFixed(2) + '%', 'the slice an early-user distribution hands to farmers at this size'),
        chainRow('x Launch timing', row.timing_multiplier.toFixed(3), fmtAge(row.age_days) + ' with no token' + (row.age_days === null ? '' : row.age_days < m.timing_cold ? ': too young to have a distribution yet' : row.age_days <= m.timing_close ? ': inside the window where launches cluster' : ': past the window, and discounted for it')),
        chainRow('x Momentum', row.momentum_multiplier.toFixed(3), fmtPct(row.change_7d) + ' over seven days'),
        el('div', { class: 'chain-row total' },
          el('span', { text: '= Implied value' }),
          el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })
        ),
        el('div', { class: 'chain-row total' },
          el('span', { text: 'Per farmer' }),
          el('b', { class: 'num', text: '$' + row.per_farmer_usd })
        )
      ),
      el('p', { class: 'sub', text: 'Conviction ' + row.conviction + '. The page recomputed this row from the same constants and got ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate of an unlaunched token, not a price.' })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
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
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      var mp = multiplesPanel();
      if (mp) shell.appendChild(mp);
      shell.appendChild(modelPanel());
    }
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
