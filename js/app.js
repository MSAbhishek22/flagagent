/* FlagAgent — console wiring. Browser only.
   Flow: instruction → plan (read-only) → per-change approval → apply
   (executor re-checks hash + guards) → receipt with read-backs → board. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function now() { return new Date().toLocaleTimeString('en-GB'); }

  var adapter = null;
  var snapshot = null;
  var currentPlan = null;
  var lowMotion = false;
  var HERO_FLAGS = ['new_checkout', 'search_v2', 'payments_kill_switch'];

  function log(msg) {
    var li = document.createElement('li');
    li.innerHTML = '<b>' + now() + '</b> ' + esc(msg);
    var list = $('logList');
    list.insertBefore(li, list.firstChild);
  }

  function currentEnvId() { return $('envSelect').value; }
  function envName(envId) {
    var hit = snapshot.environments.filter(function (e) { return e.id === envId; })[0];
    return hit ? hit.name : envId;
  }

  /* ---------- rendering ---------- */

  function renderMode() {
    adapter.describe().then(function (d) {
      var chip = $('modeChip');
      chip.textContent = d.mode === 'LIVE' ? 'LIVE — ' + d.projectName : 'MOCK — demo project';
      chip.classList.toggle('live', d.mode === 'LIVE');
      $('projectLabel').textContent = d.projectName;
      $('sourceLabel').textContent = d.mode === 'LIVE' ? 'Flagsmith API' : 'local demo board (MOCK)';
    });
  }

  function renderEnvSelect(keepId) {
    var sel = $('envSelect');
    sel.innerHTML = '';
    snapshot.environments.forEach(function (env) {
      var o = document.createElement('option');
      o.value = env.id; o.textContent = env.name;
      sel.appendChild(o);
    });
    var prod = snapshot.environments.filter(function (e) { return e.name === 'Production'; })[0];
    sel.value = keepId || (prod ? prod.id : snapshot.environments[0].id);
  }

  function renderWatch() {
    var envId = currentEnvId();
    $('watchEnvName').textContent = envName(envId);
    var feats = snapshot.featuresByEnv[envId] || [];
    $('watchBody').innerHTML = feats.map(function (f) {
      var st = f.state;
      var val = '';
      if (st.variants) val = st.variants.map(function (v) { return esc(v.key) + ' ' + v.weight + '%'; }).join(' · ');
      else if (st.value != null) val = esc(st.value);
      else val = '—';
      var ov = (st.segmentOverrides || []).map(function (o) {
        return esc(o.segment) + ': ' + (o.enabled ? 'ON' : 'OFF');
      }).join(' · ') || '—';
      return '<tr><td class="fname">' + esc(f.name) + '<br><span class="mono">' + esc(f.description) + '</span></td>' +
        '<td><span class="pill' + (st.enabled ? ' on' : '') + '">' + (st.enabled ? 'ON' : 'OFF') + '</span></td>' +
        '<td><span class="rollbar"><i style="width:' + st.rollout + '%"></i></span><span class="roll-num">' + st.rollout + '%</span></td>' +
        '<td class="mono">' + val + '</td><td class="mono">' + ov + '</td></tr>';
    }).join('');
    $('watchUpdated').textContent = 'Read back at ' + now();
  }

  function renderHero() {
    var prod = snapshot.environments.filter(function (e) { return e.name === 'Production'; })[0];
    if (!prod) return;
    var feats = snapshot.featuresByEnv[prod.id] || [];
    $('heroSwitches').innerHTML = HERO_FLAGS.map(function (name) {
      var f = feats.filter(function (x) { return x.name === name; })[0];
      if (!f) return '';
      var on = f.state.enabled;
      var lampCls = name === 'payments_kill_switch' ? (on ? 'lamp guard-on' : 'lamp') : (on ? 'lamp on' : 'lamp');
      return '<div class="sw-row"><span class="' + lampCls + '"></span>' +
        '<div class="sw-meta"><div class="sw-name">' + esc(f.name) + '</div>' +
        '<div class="sw-desc">' + esc(f.description) + '</div></div>' +
        '<span class="sw-state">' + (on ? 'ON · ' + f.state.rollout + '%' : 'OFF') + '</span>' +
        '<button class="switch" type="button" role="switch" aria-checked="' + on + '" data-hero-flag="' + esc(name) + '" aria-label="Toggle ' + esc(name) + ' in Production"><span class="thumb"></span></button></div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('[data-hero-flag]'), function (btn) {
      btn.addEventListener('click', function () { flipHero(btn.getAttribute('data-hero-flag')); });
    });
  }

  function flipHero(name) {
    var prod = snapshot.environments.filter(function (e) { return e.name === 'Production'; })[0];
    adapter.getFeatureState(prod.id, name).then(function (st) {
      return adapter.applyChange({ kind: 'set_enabled', envId: prod.id, feature: name, after: { enabled: !st.enabled } });
    }).then(function (res) {
      log(res.ok ? 'Board switch flipped by hand: ' + res.detail : 'Board switch refused: ' + res.detail);
      return refreshAll();
    });
  }

  function refreshAll() {
    return adapter.snapshot().then(function (snap) {
      snapshot = snap;
      renderWatch(); renderHero();
    });
  }

  /* ---------- planning ---------- */

  function setRail(step, state) {
    Array.prototype.forEach.call(document.querySelectorAll('.rail-step'), function (el) {
      var n = parseInt(el.getAttribute('data-step'), 10);
      el.classList.toggle('active', state === 'active' && n === step);
      el.classList.toggle('done', state === 'done' && n < step);
    });
  }

  function planFromText() {
    var text = $('instruction').value.trim();
    if (!text) { $('instruction').focus(); return; }
    var envId = currentEnvId();
    var name = envName(envId);
    var lower = text.toLowerCase();
    var namesEnv = snapshot.environments.some(function (e) {
      return lower.indexOf(e.name.toLowerCase()) !== -1 || (e.name === 'Production' && /\bprod\b/.test(lower)) || (e.name === 'Development' && /\bdev\b/.test(lower));
    });
    var parseText = namesEnv ? text : text + ' in ' + name;
    currentPlan = window.FlagAgentPlanner.parseInstruction(parseText, snapshot);
    if (!namesEnv) currentPlan.assumptions.unshift('Environment taken from the console selector: ' + name + '.');
    renderPlan();
    log('Planned: "' + text + '" → ' + currentPlan.changes.length + ' change(s), status ' + currentPlan.status + ', hash ' + currentPlan.hash + '.');
    setRail(2, 'done'); setRail(3, 'active');
  }

  function renderPlan() {
    var plan = currentPlan;
    $('planArea').hidden = false;
    $('receiptArea').hidden = true;
    $('planHash').textContent = 'plan #' + plan.hash;
    $('planAssumptions').innerHTML = plan.assumptions.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    $('planErrors').innerHTML = plan.errors.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    $('planWarnings').innerHTML = plan.warnings.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('');
    $('guardList').innerHTML = plan.guards.map(function (g) {
      var lamp = g.status === 'holding' ? 'lamp on' : (g.status === 'violated' ? 'lamp guard-on' : 'lamp');
      var label = g.feature ? ('<b>' + esc(g.feature) + '</b> must stay ' + (g.mustBe || '?').toUpperCase() + ' in ' + esc(plan.envName) + ' — ' + g.status)
                            : ('Guard not matched to a flag: "' + esc(g.text) + '"');
      return '<div class="guard"><span class="' + lamp + '"></span><span>' + label + '</span></div>';
    }).join('');
    $('changeList').innerHTML = plan.changes.map(function (c) {
      var badges = '';
      if (c.caution) badges += ' <span class="badge">caution</span>';
      if (c.requiresTypedConfirm) badges += ' <span class="badge stop">delete</span>';
      var confirm = c.requiresTypedConfirm ?
        '<div class="confirm-row" data-confirm-row="' + c.id + '"><label>Type the flag name to arm this delete: <input type="text" data-confirm-input="' + c.id + '" autocomplete="off" spellcheck="false" placeholder="' + esc(c.requiresTypedConfirm) + '"></label></div>' : '';
      return '<div class="change"><input type="checkbox" data-approve="' + c.id + '" checked aria-label="Approve this change">' +
        '<span class="diff">' + esc(c.text) + '</span>' + badges + confirm + '</div>';
    }).join('');
    Array.prototype.forEach.call(document.querySelectorAll('[data-approve]'), function (box) {
      box.addEventListener('change', updateApplyState);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-confirm-input]'), function (inp) {
      inp.addEventListener('input', updateApplyState);
      var row = document.querySelector('[data-confirm-row="' + inp.getAttribute('data-confirm-input') + '"]');
      if (row) row.classList.add('show');
    });
    updateApplyState();
  }

  function approvedIds() {
    return Array.prototype.map.call(document.querySelectorAll('[data-approve]:checked'), function (b) {
      return b.getAttribute('data-approve');
    });
  }
  function typedConfirms() {
    var out = {};
    Array.prototype.forEach.call(document.querySelectorAll('[data-confirm-input]'), function (inp) {
      out[inp.getAttribute('data-confirm-input')] = inp.value.trim();
    });
    return out;
  }

  function updateApplyState() {
    var btn = $('applyBtn'), hint = $('applyHint');
    if (!currentPlan) { btn.disabled = true; return; }
    if (currentPlan.status !== 'ready') { btn.disabled = true; hint.textContent = 'This plan is ' + currentPlan.status.replace('_', ' ') + ' — fix the instruction and plan again.'; return; }
    var ids = approvedIds();
    if (!ids.length) { btn.disabled = true; hint.textContent = 'Tick at least one change to approve it.'; return; }
    var confirms = typedConfirms();
    var unarmed = currentPlan.changes.filter(function (c) {
      return c.requiresTypedConfirm && ids.indexOf(c.id) !== -1 && confirms[c.id] !== c.requiresTypedConfirm;
    });
    if (unarmed.length) { btn.disabled = true; hint.textContent = 'Type the flag name to arm the delete.'; return; }
    btn.disabled = false;
    hint.textContent = ids.length + ' of ' + currentPlan.changes.length + ' changes approved. Guards and the plan hash are checked again when you apply.';
  }

  /* ---------- applying ---------- */

  function applyCurrent() {
    if (!currentPlan) return;
    var btn = $('applyBtn');
    btn.disabled = true; btn.textContent = 'Applying…';
    window.FlagAgentExecutor.applyPlan(adapter, currentPlan, approvedIds(), typedConfirms(), window.FlagAgentPlanner)
      .then(function (receipt) {
        btn.textContent = 'Apply approved changes';
        renderReceipt(receipt);
        if (receipt.refused) log('Apply refused: ' + receipt.refused);
        else {
          receipt.applied.forEach(function (r) { log((r.ok ? 'Applied + read back: ' : 'FAILED: ') + r.change.text); });
          receipt.skipped.forEach(function (c) { log('Skipped (not approved): ' + c.text); });
        }
        return refreshAll();
      })
      .then(function () { setRail(4, 'done'); updateApplyState(); });
  }

  function renderReceipt(receipt) {
    $('receiptArea').hidden = false;
    if (receipt.refused) {
      $('receiptBody').innerHTML = '<div class="refused">' + esc(receipt.refused) + '</div>';
      return;
    }
    var lines = receipt.applied.map(function (r) {
      return '<div class="receipt-line"><span class="' + (r.ok ? 'ok' : 'bad') + '">' + (r.ok ? '✓' : '✗') + '</span> ' + esc(r.change.text) + '<br><span class="mono">' + esc(r.detail) + '</span></div>';
    }).join('');
    var skipped = receipt.skipped.length ?
      '<p class="receipt-summary">Not applied (not approved): ' + receipt.skipped.map(function (c) { return esc(c.feature); }).join(', ') + '.</p>' : '';
    $('receiptBody').innerHTML = lines + '<p class="receipt-summary">' + esc(receipt.summary) + '</p>' + skipped;
  }

  /* ---------- settings / live mode ---------- */

  function useAdapter(newAdapter, note) {
    adapter = newAdapter;
    return adapter.snapshot().then(function (snap) {
      snapshot = snap;
      renderMode(); renderEnvSelect(); renderWatch(); renderHero();
      if (note) log(note);
    });
  }

  function connectLive() {
    var key = $('apiKeyInput').value.trim();
    var pid = $('projectIdInput').value.trim();
    var label = $('projectNameInput').value.trim();
    if (!key || !pid) { $('settingsStatus').textContent = 'Both the API key and the project ID are needed.'; return; }
    $('settingsStatus').textContent = 'Connecting…';
    var live = window.FlagAgentAdapter.createAdapter(
      { mode: 'LIVE', apiKey: key, projectId: pid, projectName: label || ('Flagsmith project ' + pid) },
      window.FlagAgentSeed.buildSeedProject());
    live.snapshot().then(function (snap) {
      adapter = live; snapshot = snap;
      $('apiKeyInput').value = '';
      $('settingsStatus').textContent = 'Connected. Working the live project now.';
      renderMode(); renderEnvSelect(); renderWatch(); renderHero();
      log('Connected to a live Flagsmith project. The demo board is off.');
    }).catch(function (e) {
      $('settingsStatus').textContent = 'Could not read that project (' + e.message + '). Still on the demo project.';
    });
  }

  /* ---------- motion ---------- */

  function setLowMotion(on) {
    lowMotion = on;
    document.body.classList.toggle('low-motion', on);
    $('motionToggle').textContent = 'Low motion: ' + (on ? 'on' : 'off');
    $('motionToggle').setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) $('heroBoard').style.transform = '';
  }

  function wireTilt() {
    var board = $('heroBoard');
    if (!window.matchMedia || window.matchMedia('(pointer: coarse)').matches) return;
    board.addEventListener('pointermove', function (e) {
      if (lowMotion || document.body.classList.contains('low-motion')) return;
      var r = board.getBoundingClientRect();
      var dx = (e.clientX - r.left) / r.width - 0.5;
      var dy = (e.clientY - r.top) / r.height - 0.5;
      board.style.transform = 'rotateY(' + (dx * 6).toFixed(2) + 'deg) rotateX(' + (-dy * 6).toFixed(2) + 'deg)';
    });
    board.addEventListener('pointerleave', function () { board.style.transform = ''; });
  }

  function wireReveal() {
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (el) { el.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.12 });
    Array.prototype.forEach.call(document.querySelectorAll('.reveal'), function (el) { io.observe(el); });
  }

  /* ---------- init ---------- */

  function init() {
    var cfg = window.FLAGAGENT_CONFIG || null;
    var start = window.FlagAgentAdapter.createAdapter(cfg, window.FlagAgentSeed.buildSeedProject());
    useAdapter(start, 'Console ready on the demo project (MOCK). Nothing here can touch a real Flagsmith account.').catch(function (e) {
      log('Start-up problem: ' + e.message);
    });
    $('planBtn').addEventListener('click', planFromText);
    $('applyBtn').addEventListener('click', applyCurrent);
    $('refreshBtn').addEventListener('click', function () { refreshAll().then(function () { log('Board refreshed from the adapter.'); }); });
    $('envSelect').addEventListener('change', renderWatch);
    Array.prototype.forEach.call(document.querySelectorAll('[data-example]'), function (chip) {
      chip.addEventListener('click', function () {
        $('instruction').value = chip.getAttribute('data-example');
        $('instruction').focus();
      });
    });
    $('settingsBtn').addEventListener('click', function () {
      var p = $('settingsPanel'); p.hidden = !p.hidden;
    });
    $('connectBtn').addEventListener('click', connectLive);
    $('mockBtn').addEventListener('click', function () {
      var mock = window.FlagAgentAdapter.createAdapter(null, window.FlagAgentSeed.buildSeedProject());
      useAdapter(mock, 'Back on the demo project (MOCK).').then(function () {
        $('settingsStatus').textContent = 'On the demo project.';
      });
    });
    $('motionToggle').addEventListener('click', function () { setLowMotion(!lowMotion); });
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) setLowMotion(true);
    wireTilt(); wireReveal();
    setRail(1, 'active');
  }

  document.addEventListener('DOMContentLoaded', init);
})();
