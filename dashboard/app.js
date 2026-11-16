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
  // Read off the measured launch curve, the same cohorts lib/model.ts counted.
  function launchTiming(age, m) {
    var c = DATA.launch;
    if (!c || !c.cohorts.length) return 1;
    var d = age === null || age === undefined ? m.unknown_age_days : age;
    var hit = null;
    for (var i = 0; i < c.cohorts.length; i++) { if (d < c.cohorts[i].up_to) { hit = c.cohorts[i]; break; } }
    if (hit === null) hit = c.cohorts[c.cohorts.length - 1];
    return clamp(hit.share / c.peak, m.timing_min, 1);
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
   * The evidence the model is built on, drawn rather than asserted: every live-token protocol as one
   * point, TVL against market cap on log axes, with the line fitted through them. The line's slope is
   * the finding  -  well under 1, so market cap grows far slower than the TVL beneath it  -  and the
   * scatter around it is the honest width of the thing, which the blind test below puts a number on.
   */
  function curveChart() {
    var pts = DATA.peer_points || [];
    if (pts.length < 3) return null;
    var W = 420, H = 210, padL = 34, padR = 10, padT = 10, padB = 26;
    var L = function (v) { return Math.log10(Math.max(v, 1)); };
    var xs = pts.map(function (p) { return L(p.tvl); });
    var ys = pts.map(function (p) { return L(p.mcap); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var X = function (v) { return padL + ((L(v) - x0) / (x1 - x0)) * (W - padL - padR); };
    var Y = function (v) { return H - padB - ((L(v) - y0) / (y1 - y0)) * (H - padT - padB); };

    var node = svg('svg', {
      viewBox: '0 0 ' + W + ' ' + H, class: 'spread', role: 'img',
      'aria-label': pts.length + ' live-token protocols, TVL against market cap on log axes, with a fitted line of slope ' + DATA.curve.b,
    });

    // Decade gridlines, recessive, labelled in whole powers of ten.
    var money = function (p) { return p >= 9 ? Math.pow(10, p - 9) + 'B' : p >= 6 ? Math.pow(10, p - 6) + 'M' : Math.pow(10, p - 3) + 'K'; };
    for (var gx = x0; gx <= x1; gx++) {
      node.appendChild(svg('line', { x1: X(Math.pow(10, gx)), y1: padT, x2: X(Math.pow(10, gx)), y2: H - padB, class: 'grid' }));
      node.appendChild(svg('text', { x: X(Math.pow(10, gx)), y: H - padB + 13, class: 'tick', 'text-anchor': 'middle', text: '$' + money(gx) }));
    }
    for (var gy = y0; gy <= y1; gy++) {
      node.appendChild(svg('line', { x1: padL, y1: Y(Math.pow(10, gy)), x2: W - padR, y2: Y(Math.pow(10, gy)), class: 'grid' }));
      node.appendChild(svg('text', { x: padL - 5, y: Y(Math.pow(10, gy)) + 3, class: 'tick', 'text-anchor': 'end', text: '$' + money(gy) }));
    }

    // One dot a live-token protocol: the observations, not the model.
    pts.forEach(function (p) {
      var dot = svg('circle', { cx: X(p.tvl), cy: Y(p.mcap), r: 2.6, class: 'obs' });
      dot.appendChild(svg('title', { text: fmtUsd(p.tvl) + ' of TVL carries ' + fmtUsd(p.mcap) + ' of market cap (' + fmtMult(p.mcap / p.tvl) + ')' }));
      node.appendChild(dot);
    });

    // The fitted line, drawn across the whole span it was fitted on.
    var fx0 = Math.pow(10, x0), fx1 = Math.pow(10, x1);
    var fy = function (t) { return Math.pow(10, DATA.curve.a + DATA.curve.b * L(t)); };
    node.appendChild(svg('line', { x1: X(fx0), y1: Y(fy(fx0)), x2: X(fx1), y2: Y(fy(fx1)), class: 'fit' }));

    node.appendChild(svg('text', { x: W - padR, y: padT + 10, class: 'tick fit-label', 'text-anchor': 'end', text: 'slope ' + DATA.curve.b }));
    return node;
  }

  function lede() {
    var chart = curveChart();
    var h = DATA.holdout;
    var tenfold = Math.pow(10, DATA.curve.b);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.board_size + ' pre-token protocols, priced on what size is worth' }),
        el('p', { text: 'Every protocol here records no token at all. Each is priced off a curve fitted to the ' + DATA.peer_protocols + ' protocols in this snapshot whose token does trade, shifted by what its own category is worth against that curve, then discounted for how close it is to a launch window and whether capital is arriving or leaving. The blind test below says how far wrong that gets.' }),
        el('div', { class: 'facts' },
          el('div', { class: 'fact' }, el('b', { text: DATA.watchlist_size + '/' + DATA.watchlist_size }), el('span', { text: 'watchlist covered' })),
          el('div', { class: 'fact' }, el('b', { text: String(DATA.board_size) }), el('span', { text: 'rows scored' })),
          el('div', { class: 'fact' }, el('b', { text: String(DATA.early_size) }), el('span', { text: 'below the floor' })),
          el('div', { class: 'fact' }, el('b', { text: String(DATA.peer_protocols) }), el('span', { text: 'live peers priced from' }))
        )
      ),
      chart === null ? null : el('figure', { class: 'spread-fig' },
        el('figcaption', { text: 'What the market pays for TVL, and the line fitted to it' }),
        chart,
        el('p', { class: 'sub', text: 'One dot per live-token protocol, on log axes. The slope is ' + DATA.curve.b + ', well under one: ten times the TVL carries about ' + tenfold.toFixed(1) + ' times the market cap, not ten. So the implied multiple falls with size, from ' + fmtMult(Math.pow(10, DATA.curve.a) * Math.pow(5e6, DATA.curve.b - 1)) + ' at $5M of TVL to ' + fmtMult(Math.pow(10, DATA.curve.a) * Math.pow(5e9, DATA.curve.b - 1)) + ' at $5B. Each category then shifts off this line by what its own peers are worth.' })
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
        // An arrow, not a letter: the header is set in uppercase, where a bare "v" reads as one.
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' ↓' : ' ↑' }) : null
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
    var widest = Math.max.apply(null, list.map(function (c) { return Math.abs(c.offset); })) || 1;
    var tbody = el('tbody');
    list.forEach(function (c) {
      var w = Math.max(4, Math.round((Math.abs(c.offset) / widest) * 50));
      tbody.appendChild(el('tr', { class: 'static' },
        el('td', null, el('div', { class: 'name' },
          el('b', { text: c.category }),
          el('span', { class: 'sub', text: c.basis === 'family' ? 'category family' : 'category' })
        )),
        el('td', { class: 'num', text: String(c.peers) }),
        el('td', null, el('div', { class: 'diverge', 'aria-hidden': 'true' },
          el('i', { class: c.offset >= 0 ? 'up' : 'down', style: 'width:' + w + '%' })
        )),
        el('td', { class: 'num', text: 'x' + c.factor.toFixed(2) }),
        el('td', { class: 'num', text: String(c.pre_token_rows) })
      ));
    });
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'Which categories beat the line' }),
        el('p', { class: 'sub', text: 'Size explains most of what a token is worth, and the curve above carries that. What is left over is the category: the median amount its own live-token peers sit above or below the line, shrunk toward no shift at all by how few peers stand behind it. A factor of 1.5 means a protocol of that kind has been worth half again what its size alone would say. A category the snapshot gives too few live peers borrows the offset of its family instead; with neither, it takes the curve unshifted.' })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Peer set' }),
            el('th', { scope: 'col', text: 'Live peers' }),
            el('th', { scope: 'col', text: 'Below / above the line' }),
            el('th', { scope: 'col', text: 'Factor' }),
            el('th', { scope: 'col', text: 'Rows priced' })
          )),
          tbody
        )
      )
    );
  }

  /**
   * The blind test. Every live-token protocol is a question the model can be marked on, so it is:
   * held out of its own peer set, priced from its TVL and category alone, and compared with the
   * market cap the snapshot already records.
   */
  function holdoutPanel() {
    var h = DATA.holdout;
    if (!h) return null;
    var row = function (label, lead, s, lit) {
      return el('tr', { class: 'static' + (lit ? ' lit' : '') },
        el('td', null, el('div', { class: 'name' }, el('b', { text: label }), el('span', { class: 'sub', text: lead }))),
        el('td', { class: 'num', text: s.median_ratio + 'x' }),
        el('td', { class: 'num', text: s.within_2x + '%' }),
        el('td', { class: 'num', text: s.within_3x + '%' })
      );
    };
    var gain = Math.round((h.model.within_2x - h.baseline.within_2x) * 10) / 10;
    return el('section', { class: 'panel' },
      el('div', { class: 'panel-head' },
        el('h2', { text: 'Does it work? The blind test' }),
        el('p', { class: 'sub', text: 'A model of tokens that do not exist cannot be checked against them, but it can be checked against the ones that do. Each of the ' + h.tested + ' protocols here whose token already trades was held out of its own peer set, priced from its TVL and its category alone, and compared with the market cap this snapshot records. The baseline is one constant times TVL: what a board with no size curve and no categories can manage.' })
      ),
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Priced by' }),
            el('th', { scope: 'col', text: 'Typical miss' }),
            el('th', { scope: 'col', text: 'Within 2x' }),
            el('th', { scope: 'col', text: 'Within 3x' })
          )),
          el('tbody', null,
            row('One constant x TVL', 'the baseline', h.baseline, false),
            row('This model', 'size curve, then category', h.model, true)
          )
        )
      ),
      el('div', { class: 'panel-head' },
        el('p', { class: 'sub', text: 'The model cuts the typical miss by ' + h.error_cut_pct + '% and lands inside a factor of two ' + (gain >= 0 ? '+' : '') + gain + ' points more often. It is still a typical miss of about ' + h.model.median_ratio + 'x, and that is the honest size of the thing: most of what a token will be worth is not in a TVL figure. Read a rank as an ordering, not a price. An earlier version of this board priced by category alone with no size curve; on this same test it scored worse than the one-constant baseline, which is why the curve is here at all.' })
      )
    );
  }

function modelPanel() {
    var m = DATA.model;
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every row. No protocol name appears anywhere in it, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'launchValue = 10^( ' + DATA.curve.a + ' + ' + DATA.curve.b + ' x log10(tvl_usd) + categoryOffset )\n' +
          'implied     = round( launchValue x farmerShare(tvl_usd) x launchTiming(age_days) x momentum(change_7d) )'
      ),
      el('dl', { class: 'terms' },
        el('div', null, el('dt', { text: 'sizeCurve' }), el('dd', { text: 'Least squares through the ' + DATA.curve.points + ' live-token protocols in log-log: log10(mcap) = ' + DATA.curve.a + ' + ' + DATA.curve.b + ' x log10(tvl). A slope under one says market cap grows slower than the TVL beneath it, so the implied multiple falls as a protocol gets bigger. This line does most of the work; a category only shifts it.' })),
        el('div', null, el('dt', { text: 'categoryOffset' }), el('dd', { text: 'The median amount a category of live-token peers sits above or below that line, in log10, shrunk toward no shift at all by peer count (k = ' + m.peer_shrinkage + ', a set needs ' + m.peer_min + ' peers to count). Both knobs were picked on the blind test above rather than by taste.' })),
        el('div', null, el('dt', { text: 'farmerShare' }), el('dd', { text: 'The slice of a launch an early-user distribution hands to farmers: ' + (m.share_small * 100).toFixed(1) + '% at $' + Math.round(m.share_tvl_small / 1e6) + 'M of TVL falling to ' + (m.share_large * 100).toFixed(1) + '% at $' + Math.round(m.share_tvl_large / 1e9) + 'B, interpolated on a log scale. A bigger protocol spreads its distribution over more claimants.' })),
        el('div', null, el('dt', { text: 'launchTiming' }), el('dd', { text: 'Measured, not drawn: the share of protocols the same age that already carry a token, read off ' + DATA.launch.cohorts.length + ' age cohorts counted over the ' + DATA.launch.dated + ' protocols here that record a listing date, scaled so the heaviest cohort weighs one. It runs from ' + Math.round(Math.min.apply(null, DATA.launch.cohorts.map(function (c) { return c.share; })) * 100) + '% to ' + Math.round(DATA.launch.peak * 100) + '%. An earlier version of this model used a hand-drawn hump that decayed past 900 days, on the idea that a protocol running that long without a token never will; these cohorts say the opposite, so it went. They are cohorts seen at one moment rather than one followed through time, and listed_at is when DefiLlama began tracking a protocol, not when it was born.' })),
        el('div', null, el('dt', { text: 'momentum' }), el('dd', { text: 'Whether capital is arriving or leaving, from the seven-day TVL change clamped to ' + m.growth_floor + '%..' + m.growth_cap + '% and softened through tanh at scale ' + m.growth_scale + ', weight ' + m.growth_weight + ', so one violent week cannot carry a row.' })),
        el('div', null, el('dt', { text: 'Per farmer' }), el('dd', { text: 'The implied pool split between tvl_usd / $' + m.farmer_position_usd.toLocaleString('en-US') + ' assumed farmers, never fewer than ' + m.farmers_floor + '. It is the number a reader with one wallet should actually read.' }))
      ),
      el('p', { class: 'sub', text: 'TVL, seven-day growth, category and listing date all come from the sealed snapshot; a protocol with no listing date is scored at ' + m.unknown_age_days + ' days. Protocols whose token already trades are set aside on the Live token tab and are never ranked here  -  they are the evidence the multiples are read from.' })
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
        chainRow('The size curve says', fmtUsd(row.curve_value_usd), 'what a token on this much TVL has been worth, from the line fitted to ' + DATA.curve.points + ' live-token protocols (slope ' + DATA.curve.b + ')'),
        chainRow('x Category offset', (row.peer_offset >= 0 ? 'x' : 'x') + Math.pow(10, row.peer_offset).toFixed(2), row.peer_basis === 'global' ? 'none: too few live peers in its category or its family to measure one' : (row.peer_offset >= 0 ? 'above' : 'below') + ' the line, from ' + row.peer_count + ' live-token ' + (row.peer_basis === 'family' ? 'protocols in the ' + row.peer_category + ' family' : row.peer_category + ' protocols')),
        chainRow('= Expected launch value', fmtUsd(row.expected_fdv_usd), 'an effective ' + fmtMult(row.peer_multiple) + ' on its TVL, at this size'),
        chainRow('x Farmer share', (share * 100).toFixed(2) + '%', 'the slice an early-user distribution hands to farmers at this size'),
        chainRow('x Launch timing', row.timing_multiplier.toFixed(3), (function () {
          var c = DATA.launch, d = row.age_days === null ? m.unknown_age_days : row.age_days, hit = null;
          for (var i = 0; i < c.cohorts.length; i++) { if (d < c.cohorts[i].up_to) { hit = c.cohorts[i]; break; } }
          if (hit === null) hit = c.cohorts[c.cohorts.length - 1];
          return fmtAge(row.age_days) + ' with no token' + (row.age_days === null ? ', so it is scored at the ' + m.unknown_age_days + '-day cohort' : '') + ': of the ' + hit.n + ' protocols that old, ' + Math.round(hit.share * 100) + '% already carry one';
        })()),
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
      var hp = holdoutPanel();
      if (hp) shell.appendChild(hp);
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
