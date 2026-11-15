// The farm plan, derived from one protocol's own record: its chains decide what a transaction costs,
// its TVL decides the position, its age decides how long to hold, and its category decides the two
// actions that leave a footprint. No protocol is named anywhere in here.
//
// This file is a classic script on purpose: the dashboard is opened from disk, and a browser refuses
// ES modules over file://. It sets window.FARM in the page and module.exports under Node, so the same
// bytes generate the plan in the page and are checked against board.json by tools/verify-farm.mjs.
(function (root) {
  'use strict';

  // What one transaction costs on a chain, in US dollars. A table of chains, not of protocols: a
  // chain the table does not carry is charged the default. These are ordinary busy-hour costs, stated
  // so a reader can argue with them.
  var CHAIN_GAS = {
    Ethereum: 2.5,
    Tron: 1,
    Bitcoin: 1.5,
    BSC: 0.15,
    Avalanche: 0.08,
    Base: 0.05, Arbitrum: 0.05, OP_Mainnet: 0.05, Optimism: 0.05, Polygon: 0.05,
    Linea: 0.05, Scroll: 0.05, Blast: 0.05, Mantle: 0.05, Mode: 0.05, Taiko: 0.05,
    zkSync_Era: 0.05, Starknet: 0.05, Berachain: 0.05, Unichain: 0.05, Ink: 0.05,
    Solana: 0.01, Sui: 0.02, Aptos: 0.02, Near: 0.02, Sei: 0.02, Ton: 0.02,
    Hyperliquid: 0.02, Injective: 0.02, Osmosis: 0.02, Stellar: 0.01, Tempo: 0.02
  };
  var DEFAULT_GAS = 0.2;

  function gasOf(chain) {
    var key = String(chain).replace(/\s+/g, '_');
    return Object.prototype.hasOwnProperty.call(CHAIN_GAS, key) ? CHAIN_GAS[key] : DEFAULT_GAS;
  }

  // A farmer uses the cheapest chain the protocol runs on: same footprint, less of it spent on fees.
  function pickChain(chains) {
    if (!chains || chains.length === 0) return { name: 'its main chain', gas: DEFAULT_GAS, of: 0 };
    var best = chains[0];
    var bestGas = gasOf(best);
    for (var i = 1; i < chains.length; i++) {
      var g = gasOf(chains[i]);
      if (g < bestGas) { best = chains[i]; bestGas = g; }
    }
    return { name: best, gas: bestGas, of: chains.length };
  }

  // The position one wallet opens, from the protocol's own size: a bigger protocol needs a bigger
  // position before the deposit registers against everyone else's.
  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    if (tvl >= 2e7) return 75;
    return 50;
  }

  // How long to stay, from where the protocol sits against the launch window the model scores it on.
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 120) return 120;
    if (age < 270) return 90;
    if (age <= 900) return 60;
    return 45;
  }

  // Money reads as money: whole dollars from ten up, cents below it.
  function money(n) {
    if (n >= 10) return '$' + Math.round(n);
    return '$' + n.toFixed(2);
  }

  // The two actions that leave a footprint, by category. The first is the position itself; the second
  // is a different kind of action, because one deposit sitting still is the easiest thing to discount.
  function actionsFor(category, name, capital, chain) {
    var c = String(category || '').toLowerCase();
    var half = Math.max(10, Math.round(capital / 2));
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) {
      return [
        'Supply ' + money(capital) + ' of USDC to ' + name + ' on ' + chain + ' as your main position.',
        'Borrow about ' + money(half) + ' against it and repay it before you exit: a borrow is a second kind of action, and most lending distributions have counted borrowers separately from suppliers.'
      ];
    }
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) {
      return [
        'Provide ' + money(capital) + ' of liquidity to one of ' + name + "'s deeper pools on " + chain + ', a stable pair first if it has one, so impermanent loss cannot eat the position.',
        'Swap about ' + money(half) + ' through the pool in both directions: volume and liquidity are usually counted apart, and a pool you never trade in looks like parked capital.'
      ];
    }
    if (c.indexOf('bridge') >= 0) {
      return [
        'Bridge ' + money(capital) + ' of USDC to ' + chain + ' through ' + name + ' rather than through a centralised exchange.',
        'Bridge about ' + money(half) + ' back out after a few weeks: a round trip is the action a bridge can actually measure, and one-way volume reads as an exit.'
      ];
    }
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('staking pool') >= 0) {
      return [
        'Stake ' + money(capital) + " of the chain's staking asset through " + name + ' on ' + chain + ' and keep the receipt token.',
        'Put the receipt token to work somewhere that accepts it, or delegate it if ' + name + ' has a vote: an idle receipt is the thinnest footprint there is.'
      ];
    }
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) {
      return [
        'Deposit ' + money(capital) + ' of USDC as margin on ' + name + ' and open one small, hedged position rather than a directional bet.',
        'Trade it a few times across different weeks: perp distributions have usually counted volume and days traded, not the balance sitting as margin.'
      ];
    }
    if (c.indexOf('prediction') >= 0) {
      return [
        'Fund ' + money(capital) + ' on ' + name + ' and take positions on several markets, not one.',
        'Take both sides across different markets so the footprint is trading activity rather than one directional bet you may have to sit on past the window.'
      ];
    }
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('liquidity manager') >= 0 || c.indexOf('yield') >= 0) {
      return [
        'Deposit ' + money(capital) + ' into one of ' + name + "'s vaults on " + chain + ' and hold the shares.',
        'Move about ' + money(half) + ' between two of its vaults once: allocators can see which depositors actually use the product rather than parking in the largest vault.'
      ];
    }
    if (c.indexOf('stable') >= 0) {
      return [
        'Mint or deposit ' + money(capital) + ' of the stable asset through ' + name + ' on ' + chain + '.',
        'Use it on ' + chain + ' at least once, in a pool or a payment: a stablecoin that never leaves the mint address is the easiest balance to discount.'
      ];
    }
    if (c.indexOf('rwa') >= 0) {
      return [
        'Mint ' + money(capital) + " of the protocol's yield asset on " + chain + ' and hold it through at least one yield accrual.',
        'Hold it across a full accrual period rather than trading in and out: RWA products settle slowly, and short positions rarely register.'
      ];
    }
    if (c.indexOf('insurance') >= 0) {
      return [
        'Buy ' + money(capital) + ' of cover from ' + name + ' on ' + chain + ' and keep the policy open.',
        'Renew the policy once rather than buying a single long one: a renewal is a second action, and lapsed cover usually stops counting.'
      ];
    }
    if (c.indexOf('bitcoin') >= 0 || c.indexOf('btc') >= 0) {
      return [
        'Deposit ' + money(capital) + ' of wrapped BTC into ' + name + ' on ' + chain + ' and keep the position open.',
        'Use the receipt somewhere that accepts it, so the footprint is not one deposit sitting still for the whole window.'
      ];
    }
    return [
      'Deposit ' + money(capital) + ' of USDC into ' + name + ' on ' + chain + ' as your main position.',
      'Make one different kind of action in the app, a swap, a vote or a second product, so the footprint is not a single deposit sitting still.'
    ];
  }

  /**
   * One protocol's farm plan: seven steps, each an action with what it costs and how long it takes.
   * `row` is a board row (or a snapshot protocol with age_days and per_farmer_usd on it).
   */
  function plan(row) {
    var chain = pickChain(row.chains);
    var capital = capitalFor(row.tvl_usd);
    var hold = holdDaysFor(row.age_days);
    var weeks = Math.max(1, Math.round(hold / 7));
    var acts = actionsFor(row.category, row.name, capital, chain.name);
    // Transactions: funding, the two positions, one a week, and the exit.
    var txCount = 1 + 2 + weeks + 1;
    var gasTotal = chain.gas * txCount;
    var expected = row.per_farmer_usd;

    var cheapest = chain.of > 1 ? ', the cheapest of the ' + chain.of + ' chains it runs on' : '';
    var verdict;
    var ratio = expected / gasTotal;
    if (ratio >= 50) {
      verdict = 'The model expects ' + money(expected) + ' back for one position of this size against ' + money(gasTotal) + ' of fees, which on this chain are rounding: here the ' + money(capital) + ' of capital and whether the token ships at all are the only real risks.';
    } else if (ratio >= 3) {
      verdict = 'The model expects ' + money(expected) + ' back for one position of this size, about ' + Math.round(ratio) + ' times the ' + money(gasTotal) + ' of fees: here the ' + money(capital) + ' of capital is the risk, not the fees.';
    } else if (expected >= gasTotal) {
      verdict = 'The model expects ' + money(expected) + ' back against ' + money(gasTotal) + ' of fees: a thin margin that only pays if the token ships at all, so farm this one only alongside others on the same chain.';
    } else {
      verdict = 'The model expects ' + money(expected) + ' back, less than the ' + money(gasTotal) + ' this plan spends on fees: on these figures the protocol is not worth farming with one wallet at this size. Read it as a watch item, not a position.';
    }

    var steps = [
      {
        text: 'Use a fresh wallet that holds only what you farm with, keep its seed phrase offline, and fund it with ' + money(capital + gasTotal) + ' on ' + chain.name + cheapest + '.',
        cost: money(capital) + ' of capital plus ' + money(gasTotal) + ' of fees for the whole plan',
        time: '15 minutes'
      },
      {
        text: acts[0],
        cost: money(capital) + ' locked, about ' + money(chain.gas * 2) + ' of gas',
        time: '15 minutes'
      },
      {
        text: acts[1],
        cost: 'about ' + money(chain.gas * 2) + ' of gas, no new capital',
        time: '15 minutes'
      },
      {
        text: 'Do one qualifying action a week for ' + weeks + ' weeks, each in a different week so the activity lands in more than one snapshot: a deposit, a withdrawal, a swap, a vote, anything the app records.',
        cost: 'about ' + money(chain.gas * weeks) + ' of gas over ' + weeks + ' weeks',
        time: '10 minutes a week'
      },
      {
        text: 'Hold the position ' + hold + ' days. ' + (row.age_days === null ? 'This protocol gives no listing date, so the plan assumes an ordinary window.' : row.age_days < 120 ? 'It is only ' + row.age_days + ' days old, too young for a distribution, so the plan stays long enough to be early rather than absent.' : row.age_days <= 900 ? 'At ' + row.age_days + ' days it sits inside the window where launches cluster, which is why the model gives it full weight.' : 'At ' + row.age_days + ' days it is past the usual window, so the plan commits less time to it.'),
        cost: 'the ' + money(capital) + ' stays locked for ' + hold + ' days',
        time: hold + ' days'
      },
      {
        text: 'Before you withdraw, open the protocol’s own site and check its points or rewards page from the link it publishes there. Never sign a claim from a message, a search advert or a direct message, and never pay to claim.',
        cost: 'nothing to check, and never pay a claim fee',
        time: '10 minutes'
      },
      {
        text: verdict,
        cost: money(gasTotal) + ' of fees against ' + money(expected) + ' modelled',
        time: 'decide before you fund the wallet'
      }
    ];

    return steps.map(function (s) {
      var t = s.text + ' Cost: ' + s.cost + '. Time: ' + s.time + '.';
      if (t.length > 600) t = t.slice(0, 596) + '...';
      if (t.length < 20) t = t + ' Hold the position and check the protocol’s own page.';
      return t;
    });
  }

  var api = { plan: plan, pickChain: pickChain, capitalFor: capitalFor, holdDaysFor: holdDaysFor, CHAIN_GAS: CHAIN_GAS, DEFAULT_GAS: DEFAULT_GAS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.FARM = api;
})(typeof window !== 'undefined' ? window : globalThis);
