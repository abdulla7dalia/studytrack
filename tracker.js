import { loadProfile } from './profile.js';
import './site-polish.js';
import { openIslamic, configureAdhkar, renderAdhkar } from './islamic.js';
import { login, signup, logout, getUser, handleAuthCallback, requestPasswordRecovery, updateUser } from '@netlify/identity';

(function () {
  'use strict';

  var $ = function (s) { return document.querySelector(s); };
  var PAL = 8;
  var DEFAULT_SUBJECTS = ['Math', 'Physics', 'ESS', 'TOK', 'CAS', 'Arabic', 'English'];
  var DKEY = 'focus-ledger-data';
  var RING_C = 603.19;
  var MIN_LOG_MS = 30000;

  /* Switching views keeps the same live timer and loaded account data. */
  function showView(name) {
    if (!['account', 'tracker', 'history', 'islamic'].includes(name)) name = 'tracker';
    document.querySelectorAll('[data-view]').forEach(function (view) {
      view.hidden = view.dataset.view !== name;
    });
    document.querySelectorAll('[data-view-target]').forEach(function (button) {
      if (button.dataset.viewTarget === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    var copy = {
      account: ['Your personal space', 'Account', 'Keep your study progress with you, wherever you go.'],
      tracker: ['Make time for what matters', 'Tracker', 'One subject. One focused session at a time.'],
      islamic: ['A moment for your faith', 'Islamic', 'Prayer, remembrance, and Quran alongside your studies.'],
      history: ['See how far you’ve come', 'History', 'Your daily, weekly, monthly, and all-time study progress.']
    }[name];
    $('#viewEyebrow').textContent = copy[0];
    $('#viewTitle').textContent = copy[1];
    $('#viewDescription').textContent = copy[2];
    $('.view-heading').hidden = name === 'account';
    $('#signinNotice').hidden = name === 'account' || name === 'islamic' || !!currentUser;
    if (name === 'islamic') openIslamic();
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (name === 'history') {
      var weeks = $('#days');
      if (!weeks.dataset.positioned) { weeks.scrollLeft = weeks.scrollWidth; weeks.dataset.positioned = 'true'; }
    }
  }
  $('.bottom-nav').addEventListener('click', function (event) {
    var button = event.target.closest('[data-view-target]');
    if (button) showView(button.dataset.viewTarget);
  });
  $('#openAccount').addEventListener('click', function () { showView('account'); });

  /* ---------- helpers ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function fmtHM(sec) {
    var m = Math.round(sec / 60), h = Math.floor(m / 60), mm = m % 60;
    if (h === 0) return mm + 'm';
    if (mm === 0) return h + 'h';
    return h + 'h ' + mm + 'm';
  }
  function fmtShort(sec) {
    if (sec <= 0) return '';
    if (sec < 3600) return Math.max(1, Math.round(sec / 60)) + 'm';
    return (sec / 3600).toFixed(1).replace('.0', '') + 'h';
  }
  function fmtClock(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(r) : pad(m) + ':' + pad(r);
  }
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function el(tag, props) {
    var n = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k === 'style') n.setAttribute('style', v);
        else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
        else if (v === true) n.setAttribute(k, '');
        else if (v !== false && v != null) n.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      n.append(c.nodeType ? c : document.createTextNode(c));
    }
    return n;
  }
  function chipStyle(name) { return '--chip: var(--c' + colorIdx(name) + ')'; }
  function colorIdx(name) {
    var s = settings.subjects.filter(function (x) { return x.name === name; })[0];
    if (s) return s.color % PAL;
    var h = 0;
    for (var i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    return h % PAL;
  }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3400);
  }

  function armed(btn, label, fn) {
    if (btn.dataset.armed === '1') {
      btn.dataset.armed = '0';
      btn.classList.remove('armed');
      btn.textContent = btn.dataset.orig;
      fn();
      return;
    }
    btn.dataset.orig = btn.textContent;
    btn.dataset.armed = '1';
    btn.classList.add('armed');
    btn.textContent = label;
    setTimeout(function () {
      if (btn.dataset.armed === '1') {
        btn.dataset.armed = '0';
        btn.classList.remove('armed');
        btn.textContent = btn.dataset.orig;
      }
    }, 3000);
  }

  /* ---------- state ---------- */
  var settings = {
    subjects: DEFAULT_SUBJECTS.map(function (n, i) { return { name: n, color: i }; }),
    goalMin: 240
  };
  var sessions = [];
  var range = 7;
  var editing = false;
  var currentUser = null, version = null, ready = false, saving = false;
  var busy = false;

  var T = Object.assign(
    { mode: 'stopwatch', phase: 'focus', running: false, startedAt: 0, accMs: 0, subject: '', pomoMin: 25 },
    {}
  );
  if (T.mode !== 'pomodoro') T.mode = 'stopwatch';
  if (T.phase !== 'break') T.phase = 'focus';
  if (T.pomoMin !== 50) T.pomoMin = 25;
  if (typeof T.accMs !== 'number' || T.accMs < 0) T.accMs = 0;
  if (typeof T.startedAt !== 'number') T.startedAt = 0;
  if (!T.startedAt) T.running = false;
  var timerDirty = false;
  function markChanged() {
    if (!ready || !currentUser) return;
    timerDirty = true;
    setNote('Unsaved changes');
  }
  function saveTimer() { markChanged(); }

  function breakMin() { return T.pomoMin >= 50 ? 10 : 5; }
  function targetMs() { return T.mode === 'pomodoro' ? (T.phase === 'focus' ? T.pomoMin : breakMin()) * 60000 : 0; }
  function elapsedMs() { return Math.max(0, T.accMs + (T.running ? Date.now() - T.startedAt : 0)); }

  /* ---------- audio and wake lock ---------- */
  var actx = null;
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!actx) actx = new AC();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) {}
  }
  function beep() {
    try {
      if (!actx) return;
      var t = actx.currentTime;
      [0, 0.24].forEach(function (off) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = 'sine'; o.frequency.value = 880;
        g.gain.setValueAtTime(0.0001, t + off);
        g.gain.exponentialRampToValueAtTime(0.18, t + off + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.18);
        o.connect(g); g.connect(actx.destination);
        o.start(t + off); o.stop(t + off + 0.2);
      });
    } catch (e) {}
  }
  var wake = null;
  function holdWake() {
    try {
      if (navigator.wakeLock && !wake && document.visibilityState === 'visible') {
        navigator.wakeLock.request('screen').then(function (w) {
          wake = w;
          w.addEventListener('release', function () { wake = null; });
        }).catch(function () { wake = null; });
      }
    } catch (e) { wake = null; }
  }
  function releaseWake() { try { if (wake) wake.release(); } catch (e) {} wake = null; }

  /* ---------- storage ---------- */
  function setNote(msg) { $('#syncNote').textContent = msg; }

  function applySettings(st) {
    if (!st) return;
    var subs = Array.isArray(st.subjects) ? st.subjects.filter(function (s) {
      return s && typeof s.name === 'string' && s.name.trim();
    }).map(function (s) { return { name: s.name.slice(0, 24), color: Number(s.color) >= 0 ? Number(s.color) % PAL : 0 }; }) : [];
    if (subs.length) settings.subjects = subs;
    if (Array.isArray(st.adhkar)) settings.adhkar = st.adhkar;
    if (typeof st.goalMin === 'number' && st.goalMin >= 30 && st.goalMin <= 960) settings.goalMin = st.goalMin;
  }

  async function api(method, body, keepalive = false) {
    const response = await fetch('/api/tracker', { method, keepalive, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save your data.');
    return result;
  }
  function snapshot() { return JSON.parse(JSON.stringify({ sessions, settings, timer: T })); }
  function lock(value) { renderAdhkar(); $('#trackerMain').inert = value; $('#accountLogout').disabled = saving; $('#importData').disabled = saving; }
  async function persistAccount(keepalive = false) {
    if (!ready || !currentUser) return false;
    if (!timerDirty) return true;
    if (saving) return false;
    saving = true; lock(true); setNote('Saving…');
    try {
      const result = await api('PUT', { data: snapshot(), version }, keepalive);
      version = result.version; timerDirty = false; setNote('Saved'); return true;
    } catch (e) {
      ready = false; $('#accountMessage').textContent = e.message + ' Reload to continue.';
      setNote('Changes not saved'); return false;
    } finally { saving = false; lock(!ready); }
  }
  var saveSettings = markChanged;
  function writeFail(e) { toast(e.message || 'Could not save. Please try again.'); }
  async function logSession(subject, durationSec, mode, whenMs) {
    if (!ready || saving) return false;
    const endedAt = whenMs || Date.now();
    const rec = { id: crypto.randomUUID(), subject, durationSec: Math.round(durationSec), endedAt, day: dayKey(new Date(endedAt)), mode };
    sessions.push(rec);
    markChanged();
    paintStats(); return true;
  }
  async function deleteSession(id) {
    if (!ready || saving) return;
    sessions = sessions.filter(s => s.id !== id);
    markChanged();
    paintStats();
  }
  var accountMode = 'login';
  function message(text) { $('#accountMessage').textContent = text; }
  async function loadAccount(user) {
    ready = false; timerDirty = false; lock(true); currentUser = user;
    loadProfile(user);
    $('#signinNotice').hidden = !!user || !$('#view-account').hidden || !$('#view-islamic').hidden;
    sessions = []; settings = { subjects: DEFAULT_SUBJECTS.map((name, color) => ({ name, color })), goalMin: 240 };
    T.running = false; T.accMs = 0; T.startedAt = 0; T.subject = ''; releaseWake();
    $('#accountForm').hidden = !!user;
    $('#accountActions').hidden = !user;
    $('#accountTitle').textContent = user ? 'Account' : 'Sign in';
    $('#accountHint').textContent = user ? user.email : 'Sign in to save your sessions, subjects, and daily goal across devices.';
    paintAll();
    if (!user) { setNote('Sign in'); return; }
    setNote('Loading your account…');
    try {
      const result = await api('GET'); version = result.version;
      if (result.data) {
        sessions = result.data.sessions; applySettings(result.data.settings);
        const timer = result.data.timer;
        if (timer && ['stopwatch', 'pomodoro'].includes(timer.mode) &&
            ['focus', 'break'].includes(timer.phase) && Number.isFinite(timer.accMs) && timer.accMs >= 0 &&
            Number.isFinite(timer.startedAt) && typeof timer.running === 'boolean' &&
            typeof timer.subject === 'string' && [25, 50].includes(timer.pomoMin)) {
          Object.assign(T, timer);
          if (T.running && (T.startedAt <= 0 || T.startedAt > Date.now())) T.running = false;
          if (T.running) holdWake();
        }
      }
      ready = true; lock(false); setNote('Saved');
      showView('tracker');
      $('#importData').hidden = !(lsGet(DKEY)?.sessions?.length);
      paintAll();
    } catch (e) { message(e.message + ' Reload to try again.'); setNote('Account data unavailable'); }
  }
  $('#accountToggle').onclick = function () {
    accountMode = accountMode === 'signup' ? 'login' : 'signup';
    $('#accountSubmit').textContent = accountMode === 'signup' ? 'Create account' : 'Sign in';
    this.textContent = accountMode === 'signup' ? 'Already have an account? Sign in' : 'Create an account';
    $('#accountPassword').autocomplete = accountMode === 'signup' ? 'new-password' : 'current-password'; message('');
  };
  $('#accountForm').onsubmit = async function (e) {
    e.preventDefault(); const button = $('#accountSubmit'); button.disabled = true; message('');
    try {
      if (accountMode === 'reset') {
        await updateUser({ password: $('#accountPassword').value });
        accountMode = 'login'; location.replace(location.pathname); return;
      }
      const email = $('#accountEmail').value.trim(), password = $('#accountPassword').value;
      const user = accountMode === 'signup' ? await signup(email, password) : await login(email, password);
      $('#accountPassword').value = '';
      if (accountMode === 'signup' && !user.emailVerified) message('Check your email to confirm your account, then return here to sign in.');
      else await loadAccount(user);
    } catch (e) { message(e.status === 401 ? 'Check your email and password, and confirm your email before signing in.' : e.message); }
    finally { button.disabled = false; }
  };
  $('#accountForgot').onclick = async function () {
    if (!$('#accountEmail').reportValidity()) return;
    this.disabled = true;
    try { await requestPasswordRecovery($('#accountEmail').value.trim()); message('Check your email for a password reset link.'); }
    catch (e) { message(e.message); } finally { this.disabled = false; }
  };
  $('#accountLogout').onclick = async function () {
    this.disabled = true;
    try {
      if (!await persistAccount()) return;
      await logout(); message(''); await loadAccount(null);
    }
    catch (e) { message(e.message); } finally { this.disabled = false; }
  };
  $('#importData').onclick = async function () {
    const legacy = lsGet(DKEY); if (!ready || !legacy) return;
    const ids = new Set(sessions.map(s => s.id));
    (legacy.sessions || []).forEach(s => { if (!ids.has(s.id)) sessions.push({ ...s, id: s.id || crypto.randomUUID() }); });
    if (!version) applySettings(legacy.settings);
    markChanged(); this.hidden = true; message('Previous history added. It saves when you leave the site.');
    paintAll();
  };

  /* ---------- timer actions ---------- */
  function startPause() {
    unlockAudio();
    if (T.running) {
      T.accMs = elapsedMs(); T.running = false; T.startedAt = 0;
      releaseWake();
    } else {
      T.running = true; T.startedAt = Date.now();
      holdWake();
    }
    saveTimer(); paintTimer();
  }

  function finishPhase() {
    if (saving || !ready) return;
    var wasFocus = T.phase === 'focus';
    var secs = Math.round(targetMs() / 1000);
    var subject = T.subject;
    T.running = false; T.accMs = 0; T.startedAt = 0; T.phase = wasFocus ? 'break' : 'focus';
    releaseWake(); saveTimer(); beep();
    if (wasFocus) {
      toast('Focus block done. Take a break.');
      logSession(subject, secs, 'pomodoro').then(function (ok) {
        if (!ok) toast('Could not save that block. Add it under "Add time you already studied".');
      });
    } else {
      toast('Break over. Ready for the next block.');
    }
    paintTimer();
  }

  function onFinish() {
    if (T.phase === 'break') {
      T.running = false; T.accMs = 0; T.startedAt = 0; T.phase = 'focus';
      releaseWake(); saveTimer(); paintTimer();
      return;
    }
    var e = elapsedMs();
    if (e < MIN_LOG_MS || busy) return;
    busy = true;
    var secs = Math.round(e / 1000), subject = T.subject, mode = T.mode;
    T.accMs = e; T.running = false; T.startedAt = 0; releaseWake(); saveTimer(); paintTimer();
    logSession(subject, secs, mode).then(function (ok) {
      busy = false;
      if (ok) {
        T.accMs = 0; T.phase = 'focus'; saveTimer();
        toast('Logged ' + fmtHM(secs) + ' of ' + subject + '.');
      }
      paintTimer();
    });
  }

  function onReset() {
    var doReset = function () {
      T.running = false; T.accMs = 0; T.startedAt = 0; T.phase = 'focus';
      releaseWake(); saveTimer(); paintTimer();
    };
    if (elapsedMs() >= MIN_LOG_MS && T.phase === 'focus') armed($('#btnReset'), 'Sure?', doReset);
    else doReset();
  }

  /* ---------- aggregation ---------- */
  function lastDays(n) {
    var out = [], d = new Date();
    d.setHours(0, 0, 0, 0);
    for (var i = n - 1; i >= 0; i--) {
      var x = new Date(d);
      x.setDate(d.getDate() - i);
      out.push({ key: dayKey(x), date: x });
    }
    return out;
  }
  function totalsFor(keys) {
    var set = {}; keys.forEach(function (k) { set[k] = 1; });
    var by = {}, total = 0;
    sessions.forEach(function (s) {
      if (set[s.day]) { by[s.subject] = (by[s.subject] || 0) + s.durationSec; total += s.durationSec; }
    });
    return { by: by, total: total };
  }
  function subjectOrder(a, b) {
    var names = settings.subjects.map(function (s) { return s.name; });
    var ia = names.indexOf(a), ib = names.indexOf(b);
    if (ia < 0) ia = 99; if (ib < 0) ib = 99;
    return ia - ib || (a < b ? -1 : 1);
  }

  /* ---------- painting ---------- */
  var lastDay = dayKey(new Date());

  function paintAll() {
    renderAdhkar();
    $('#todayLabel').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    if (!settings.subjects.some(function (s) { return s.name === T.subject; })) {
      T.subject = settings.subjects[0].name; saveTimer();
    }
    paintTimer();
    paintStats();
  }

  function paintTimer() {
    document.querySelectorAll('#modeSeg button').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.mode === T.mode ? 'true' : 'false');
    });
    var pomo = T.mode === 'pomodoro';
    $('#pomoOpts').hidden = !pomo;
    var idle = elapsedMs() === 0 && !T.running;
    document.querySelectorAll('#pomoOpts button').forEach(function (b) {
      b.setAttribute('aria-pressed', Number(b.dataset.min) === T.pomoMin ? 'true' : 'false');
      b.disabled = !idle;
    });
    $('#ringWrap').dataset.phase = T.phase;

    var started = elapsedMs() > 0;
    $('#btnStart').textContent = T.running ? 'Pause' : (started ? 'Resume' : (T.phase === 'break' ? 'Start break' : 'Start'));
    $('#btnFinish').textContent = T.phase === 'break' ? 'Skip break' : 'Log entry';
    $('#btnReset').textContent = 'Discard';
    $('#btnReset').dataset.armed = '0';
    $('#btnReset').classList.remove('armed');

    var lab;
    if (T.phase === 'break') lab = 'Break · ' + breakMin() + ' min';
    else if (pomo) lab = 'Focus · ' + T.subject;
    else lab = 'Studying · ' + T.subject;
    if (!T.running && started) lab += ' · Paused';
    $('#clockLabel').textContent = lab;

    paintChips();
    tick();
  }

  function paintChips() {
    var wrap = $('#chips');
    wrap.replaceChildren();
    settings.subjects.forEach(function (s) {
      var chip = el('button', {
        type: 'button', class: 'chip', role: 'radio', style: '--chip: var(--c' + (s.color % PAL) + ')',
        'aria-checked': !editing && s.name === T.subject ? 'true' : 'false',
        'data-name': s.name
      }, s.name, editing ? el('span', { class: 'x', 'aria-hidden': 'true' }, '×') : null);
      if (editing) chip.setAttribute('aria-label', 'Remove ' + s.name);
      wrap.append(chip);
    });
    $('#editNote').hidden = !editing;
    $('#addForm').hidden = !editing;
    $('#btnEdit').textContent = editing ? 'Done' : 'Edit';

    var sel = $('#mSubject');
    var prev = sel.value;
    sel.replaceChildren();
    settings.subjects.forEach(function (s) { sel.append(el('option', { value: s.name }, s.name)); });
    sel.value = settings.subjects.some(function (s) { return s.name === prev; }) ? prev : T.subject;
  }

  var ktFmt = null;
  try {
    ktFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
  } catch (e) {}
  function paintKurdistanTime() {
    if (!ktFmt) return;
    var now = new Date();
    var s = ktFmt.format(now);
    $('#ktDate').textContent = now.toLocaleDateString('en-GB', { timeZone: 'Asia/Baghdad', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    var node = $('#ktTime');
    if (node.textContent !== s) node.textContent = s;
  }

  function tick() {
    paintKurdistanTime();
    $('#timerIndicator').hidden = !T.running;
    var nowKey = dayKey(new Date());
    if (nowKey !== lastDay) { lastDay = nowKey; paintAll(); return; }
    var e = elapsedMs();
    if (T.mode === 'pomodoro' && T.running && e >= targetMs()) { finishPhase(); return; }
    var p, text;
    if (T.mode === 'pomodoro') {
      var tgt = targetMs();
      var remain = Math.max(0, tgt - e);
      text = fmtClock(Math.ceil(remain / 1000) * 1000);
      p = Math.min(1, e / tgt);
    } else {
      text = fmtClock(e);
      p = (e % 3600000) / 3600000;
    }
    var clock = $('#clock');
    if (clock.textContent !== text) clock.textContent = text;
    var arc = $('#ringArc');
    arc.style.opacity = p < 0.004 ? '0' : '1';
    arc.setAttribute('stroke-dashoffset', String(RING_C * (1 - p)));
    $('#btnFinish').disabled = busy || (T.phase === 'focus' && e < MIN_LOG_MS);
  }

  function paintStats() {
    var today = dayKey(new Date());
    var tToday = totalsFor([today]).total;
    var goalSec = settings.goalMin * 60;
    $('#todayTotal').textContent = fmtHM(tToday);
    $('#goalOf').textContent = 'of ' + fmtHM(goalSec) + ' goal';
    $('#goalVal').textContent = fmtHM(goalSec);
    var pct = Math.min(100, Math.round(tToday / goalSec * 100));
    $('#goalFill').style.width = pct + '%';
    $('#goalMeter').setAttribute('aria-valuenow', String(pct));
    $('#goalMinus').disabled = settings.goalMin <= 30;
    $('#goalPlus').disabled = settings.goalMin >= 960;

    document.querySelectorAll('#rangeSeg button').forEach(function (b) {
      b.setAttribute('aria-selected', Number(b.dataset.range) === range ? 'true' : 'false');
    });
    var days = range === 0
      ? Array.from(new Set(sessions.map(function (s) { return s.day; })))
      : lastDays(range).map(function (d) { return d.key; });
    var agg = totalsFor(days);
    $('#rangeLabel').textContent = range === 0 ? 'All time' : range === 1 ? 'Today' : 'Past ' + range + ' days';
    $('#bigTotal').textContent = fmtHM(agg.total);
    var tracked = days.filter(function (k) { return totalsFor([k]).total > 0; }).length;
    $('#rangeSub').textContent = !agg.total ? ''
      : range === 1 ? 'Across ' + Object.keys(agg.by).length + ' subject' + (Object.keys(agg.by).length === 1 ? '' : 's')
      : 'avg ' + fmtHM(agg.total / tracked) + ' a day · ' + tracked + ' day' + (tracked === 1 ? '' : 's') + ' tracked';

    var split = $('#split'), legend = $('#legend');
    split.replaceChildren(); legend.replaceChildren();
    var names = Object.keys(agg.by).sort(function (a, b) { return agg.by[b] - agg.by[a]; });
    $('#splitEmpty').hidden = names.length > 0;
    split.hidden = names.length === 0;
    names.forEach(function (n) { split.append(el('i', { style: chipStyle(n) + '; flex: ' + agg.by[n] + ' 1 0' })); });
    var rows = names.slice();
    settings.subjects.forEach(function (s) { if (rows.indexOf(s.name) < 0) rows.push(s.name); });
    var maxSec = names.length ? agg.by[names[0]] : 0;
    rows.forEach(function (n) {
      var sec = agg.by[n] || 0;
      var w = maxSec ? sec / maxSec * 100 : 0;
      legend.append(el('li', { class: sec ? '' : 'zero', style: chipStyle(n) },
        el('span', { class: 'nm' }, el('span', { class: 'dot' }), n),
        el('div', { class: 'bar' }, el('i', { style: '--w:' + w.toFixed(1) })),
        el('span', { class: 'tm' }, sec ? fmtHM(sec) : '–'),
        el('span', { class: 'pc' }, sec ? Math.round(sec / agg.total * 100) + '%' : '–')));
    });

    paintDays();
    paintRecent();
    var totalDays = new Set(sessions.filter(function (s) { return s.durationSec > 0; }).map(function (s) { return s.day; })).size;
    $('#totalDays').replaceChildren(document.createTextNode(totalDays + ' '), el('small', null, totalDays === 1 ? 'day' : 'days'));
  }

  var selDay = null;

  function sessionItem(s) {
    var t = new Date(s.endedAt);
    var meta = pad(t.getHours()) + ':' + pad(t.getMinutes()) + ' · ' + (s.mode === 'pomodoro' ? 'Pomodoro' : s.mode === 'manual' ? 'Added' : 'Stopwatch');
    var del = el('button', { type: 'button', 'aria-label': 'Remove this session' }, 'Remove');
    del.addEventListener('click', function () { armed(del, 'Sure?', function () { deleteSession(s.id); }); });
    return el('li', { style: chipStyle(s.subject) },
      el('span', { class: 'dot' }),
      el('div', { class: 'who' }, el('b', null, s.subject), el('small', null, meta)),
      el('span', { class: 'tm' }, fmtHM(s.durationSec)),
      del);
  }

  function studyCalendarDays() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var start = new Date(today);
    start.setDate(start.getDate() - (start.getDay() + 1) % 7 - 7);
    sessions.forEach(function (s) {
      var p = s.day.split('-').map(Number), date = new Date(p[0], p[1] - 1, p[2]);
      if (date < start) start = date;
    });
    start.setDate(start.getDate() - (start.getDay() + 1) % 7);
    var end = new Date(today);
    end.setDate(end.getDate() + (6 - (end.getDay() + 1) % 7));
    var days = [];
    for (var date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      days.push({ key: dayKey(date), date: new Date(date) });
    }
    return days;
  }

  function paintDays() {
    var days = studyCalendarDays();
    var todayKey = dayKey(new Date());
    if (!selDay || !days.some(function (d) { return d.key === selDay; })) selDay = todayKey;
    var grouped = {};
    sessions.forEach(function (s) { (grouped[s.day] || (grouped[s.day] = [])).push(s); });
    var info = days.map(function (d) {
      var by = {}, total = 0, list = grouped[d.key] || [];
      list.forEach(function (s) { by[s.subject] = (by[s.subject] || 0) + s.durationSec; total += s.durationSec; });
      return { d: d, by: by, total: total, list: list };
    });
    var maxT = info.reduce(function (max, x) { return Math.max(max, x.total); }, 0);
    var wrap = $('#days');
    var previousScroll = wrap.scrollLeft;
    wrap.replaceChildren();
    var weekDays;
    info.forEach(function (x, index) {
      if (index % 7 === 0) {
        var end = info[index + 6].d.date;
        var label = x.d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' – ' + end.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
        weekDays = el('div', { class: 'days', role: 'group', 'aria-label': label });
        wrap.append(el('div', { class: 'week' }, el('div', { class: 'week-label' }, label), weekDays));
      }
      var dn = x.d.date.toLocaleDateString('en-GB', { weekday: 'short' });
      var fill = el('div', { class: 'dfill', style: 'width:' + (maxT ? x.total / maxT * 100 : 0) + '%' });
      Object.keys(x.by).sort(subjectOrder).forEach(function (n) {
        fill.append(el('i', { style: chipStyle(n) + '; flex: ' + x.by[n] + ' 1 0' }));
      });
      var btn = el('button', {
        type: 'button', class: 'day' + (x.d.key === todayKey ? ' today' : '') + (x.d.key > todayKey ? ' future' : ''),
        'aria-pressed': x.d.key === selDay ? 'true' : 'false',
        'aria-label': x.d.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) + ': ' + fmtHM(x.total)
      }, el('span', { class: 'dn' }, dn), el('span', { class: 'dd' }, x.d.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })), el('span', { class: 'dv' }, x.total ? fmtShort(x.total) : '–'), el('div', { class: 'dbar' }, fill));
      btn.addEventListener('click', function () { selDay = x.d.key; paintDays(); });
      weekDays.append(btn);
    });
    wrap.scrollLeft = previousScroll;
    paintDayView(info.filter(function (x) { return x.d.key === selDay; })[0], todayKey);
  }

  function paintDayView(x, todayKey) {
    var box = $('#dayview');
    box.replaceChildren();
    var yKey = lastDays(2)[0].key;
    var label = x.d.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });
    var rel = x.d.key === todayKey ? 'Today' : x.d.key === yKey ? 'Yesterday' : '';
    box.append(el('div', { class: 'dv-head' },
      el('b', null, label, rel ? el('small', null, rel) : null),
      el('span', { class: 'dv-total' }, fmtHM(x.total))));
    if (!x.total) { box.append(el('p', { class: 'empty' }, 'Nothing logged on this day.')); return; }
    var names = Object.keys(x.by).sort(function (a, b) { return x.by[b] - x.by[a]; });
    var split = el('div', { class: 'split', 'aria-hidden': 'true' });
    var legend = el('ul', { class: 'legend' });
    var maxSec = x.by[names[0]];
    names.forEach(function (n) {
      var sec = x.by[n];
      split.append(el('i', { style: chipStyle(n) + '; flex: ' + sec + ' 1 0' }));
      legend.append(el('li', { style: chipStyle(n) },
        el('span', { class: 'nm' }, el('span', { class: 'dot' }), n),
        el('div', { class: 'bar' }, el('i', { style: '--w:' + (sec / maxSec * 100).toFixed(1) })),
        el('span', { class: 'tm' }, fmtHM(sec)),
        el('span', { class: 'pc' }, Math.round(sec / x.total * 100) + '%')));
    });
    var list = el('ul', { class: 'recent' });
    x.list.sort(function (a, b) { return b.endedAt - a.endedAt; }).forEach(function (s) { list.append(sessionItem(s)); });
    box.append(split, legend, list);
  }

  function paintRecent() {
    var list = $('#recent');
    list.replaceChildren();
    var recent = sessions.slice().sort(function (a, b) { return b.endedAt - a.endedAt; }).slice(0, 8);
    $('#recentEmpty').hidden = recent.length > 0;
    var todayKey = dayKey(new Date());
    var yKey = lastDays(2)[0].key;
    recent.forEach(function (s) {
      var dt = new Date(s.endedAt);
      var when = s.day === todayKey ? 'Today' : s.day === yKey ? 'Yesterday' : dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
      var meta = when + ' · ' + dt.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true }) + ' · ' + (s.mode === 'pomodoro' ? 'Pomodoro' : s.mode === 'manual' ? 'Added' : 'Stopwatch');
      var del = el('button', { type: 'button', 'aria-label': 'Remove this session' }, 'Remove');
      del.addEventListener('click', function () { armed(del, 'Sure?', function () { deleteSession(s.id); }); });
      list.append(el('li', { style: chipStyle(s.subject) },
        el('span', { class: 'dot' }),
        el('div', { class: 'who' }, el('b', null, s.subject), el('small', null, meta)),
        el('span', { class: 'tm' }, fmtHM(s.durationSec)),
        del));
    });
  }

  /* ---------- events ---------- */
  $('#modeSeg').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    if (b.dataset.mode === T.mode) return;
    if (elapsedMs() > 0 || T.running) { toast('Log or discard the timer before switching modes.'); return; }
    T.mode = b.dataset.mode; T.phase = 'focus'; saveTimer(); paintTimer();
  });
  $('#pomoOpts').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || b.disabled) return;
    T.pomoMin = Number(b.dataset.min) === 50 ? 50 : 25; saveTimer(); paintTimer();
  });
  $('#btnStart').addEventListener('click', startPause);
  $('#btnFinish').addEventListener('click', onFinish);
  $('#btnReset').addEventListener('click', onReset);

  $('#chips').addEventListener('click', function (ev) {
    var b = ev.target.closest('.chip'); if (!b) return;
    var name = b.dataset.name;
    if (editing) {
      if (settings.subjects.length <= 1) { toast('Keep at least one subject.'); return; }
      settings.subjects = settings.subjects.filter(function (s) { return s.name !== name; });
      if (T.subject === name) T.subject = settings.subjects[0].name;
      saveTimer(); saveSettings(); paintAll();
    } else {
      T.subject = name; saveTimer(); paintTimer();
    }
  });
  $('#btnEdit').addEventListener('click', function () { editing = !editing; paintChips(); });
  $('#addForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var inp = $('#newSubject');
    var name = inp.value.trim().replace(/\s+/g, ' ').slice(0, 24);
    if (!name) return;
    if (settings.subjects.some(function (s) { return s.name.toLowerCase() === name.toLowerCase(); })) { toast('That subject is already in the list.'); return; }
    var used = settings.subjects.map(function (s) { return s.color; });
    var color = 0;
    for (var i = 0; i < PAL; i++) { if (used.indexOf(i) < 0) { color = i; break; } color = settings.subjects.length % PAL; }
    settings.subjects.push({ name: name, color: color });
    inp.value = '';
    saveSettings(); paintAll();
  });

  ['olderWeek', 'newerWeek'].forEach(function (id) {
    $('#' + id).addEventListener('click', function () {
      var weeks = $('#days');
      weeks.scrollBy({ left: weeks.clientWidth * (id === 'olderWeek' ? -1 : 1), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  });

  $('#rangeSeg').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    range = Number(b.dataset.range); paintStats();
  });
  $('#goalMinus').addEventListener('click', function () { settings.goalMin = Math.max(30, settings.goalMin - 30); saveSettings(); paintStats(); });
  $('#goalPlus').addEventListener('click', function () { settings.goalMin = Math.min(960, settings.goalMin + 30); saveSettings(); paintStats(); });

  $('#mDate').value = dayKey(new Date());
  $('#mDate').max = dayKey(new Date());
  $('#manualForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var mins = Math.round(Number($('#mMinutes').value));
    if (!(mins >= 1 && mins <= 720)) { toast('Enter between 1 and 720 minutes.'); return; }
    var dv = $('#mDate').value || dayKey(new Date());
    var when;
    if (dv === dayKey(new Date())) when = Date.now();
    else {
      var p = dv.split('-').map(Number);
      when = new Date(p[0], p[1] - 1, p[2], 12, 0, 0).getTime();
      if (!(when < Date.now())) { toast('Pick today or an earlier date.'); return; }
    }
    var subject = $('#mSubject').value || T.subject;
    logSession(subject, mins * 60, 'manual', when).then(function (ok) {
      if (ok) { $('#mMinutes').value = ''; toast('Added ' + fmtHM(mins * 60) + ' of ' + subject + '.'); }
    });
  });

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && T.running) holdWake();
    if (document.visibilityState === 'hidden') persistAccount(true);
    tick();
  });

  configureAdhkar({
    getItems: () => settings.adhkar,
    canEdit: () => ready && !!currentUser && !saving,
    setItems: (items) => { settings.adhkar = items; markChanged(); }
  });
  /* ---------- start ---------- */
  paintAll();
  setInterval(tick, 250);
  // Hidden is the last reliable event on mobile; pagehide covers navigation and closing.
  window.addEventListener('pagehide', function () { persistAccount(true); });
  if (T.running) holdWake();

  (async function init() {
    try {
      const callback = await handleAuthCallback();
      if (callback?.type === 'recovery') {
        accountMode = 'reset';
        showView('account');
        $('#accountEmail').required = false; $('#accountEmail').parentElement.hidden = true;
        $('#accountSubmit').textContent = 'Save new password';
        $('#accountPassword').autocomplete = 'new-password';
        $('#accountToggle').hidden = true; $('#accountForgot').hidden = true;
        message('Enter a new password for your account.'); return;
      }
      await loadAccount(await getUser());
    } catch (e) { message(e.message); setNote('Unable to load your account'); }
  })();
})();
