/* Mounts the Kaivra core full-screen and gives it a voice: it speaks, listens, reads what you type and replies.
   Everything is Kaivra's own and runs on the phone: its own voice, its own brain and knowledge library, offline hearing.
   Native side (Android): window.KaivraNative.* (say, listen, stop, nextVoice, accessStatus, requestAccess,
   packsStatus, checkPacks, downloadPacks, think, call, text, control, torch, volume, vibrate, battery, openApp, version, openUrl).
   Native events arrive at window.KaivraVoice.onEvent(type, text). */
(function () {
  'use strict';
  const ACCENT = '#4FD8C4'; // the design's colour; other options in the design: #FFB13B amber, #FF8A1F orange, #B98CFF violet
  const native = window.KaivraNative || null;
  const $ = (id) => document.getElementById(id);
  const btn = $('core-btn'), cv = $('cv');
  const store = {
    get(k, d) { try { const v = localStorage.getItem('kaivra.' + k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('kaivra.' + k, v); } catch (e) {} }
  };

  const comp = new Component({ accent: ACCENT });
  let V = comp.renderVals();
  V.canvasRef(cv);

  // ---------- conversation state ----------
  // mode: idle | speaking | listening | thinking
  const voice = { mode: 'idle', heard: '', partial: '', reply: '', listenNext: false, muted: store.get('muted', '0') === '1', typed: false };
  let nameSay = store.get('nameSay', 'Kaivra'); // how the voice pronounces "Kaivra" (its own voice knows the name)
  let safety = null;
  let laterSleep = null; // a pending "go to standby after speaking"
  const sleepLater = (ms) => { if (laterSleep) clearTimeout(laterSleep); laterSleep = setTimeout(() => { laterSleep = null; sleep(false, true); }, ms); };
  const typebar = $('typebar'), typeIn = $('type-in');

  comp._paint = function () {
    V = comp.renderVals();
    document.documentElement.style.setProperty('--accent', V.accent);
    $('state').textContent = V.stateLabel;
    $('bars').style.display = V.active ? 'flex' : 'none';
    btn.setAttribute('aria-pressed', V.activeAttr);
    btn.setAttribute('aria-label', V.coreLabel);
    $('card').style.display = V.hasSel ? 'block' : 'none';
    $('hint').style.display = V.noSel ? 'block' : 'none';
    $('sel-layer').textContent = V.selLayer;
    $('sel-name').textContent = V.selName;
    $('sel-desc').textContent = V.selDesc;
    $('hintA').textContent = V.hintA;
    $('hintB').textContent = V.hintB;

    // while awake, the bottom card shows the conversation
    if (comp._activeT) {
      $('state').textContent = voice.mode === 'speaking' ? 'SPEAKING' : voice.mode === 'thinking' ? 'THINKING' : voice.mode === 'listening' ? 'LISTENING' : 'ONLINE';
      $('bars').style.display = voice.mode === 'idle' ? 'none' : 'flex';
      const heard = voice.partial || voice.heard;
      if (heard || voice.reply) {
        $('card').style.display = 'block';
        $('hint').style.display = 'none';
        $('sel-layer').textContent = heard ? 'YOU' : 'KAIVRA';
        $('sel-name').textContent = heard ? '“' + heard + '”' : voice.reply;
        $('sel-desc').textContent = heard && voice.reply ? 'Kaivra: ' + voice.reply : '';
      } else if (typebar.classList.contains('open')) {
        $('hint').style.display = 'none';
      }
    }
    if (typebar.classList.contains('open') && !comp._activeT && !V.hasSel) $('hint').style.display = 'none';
    $('mute-btn').innerHTML = voice.muted
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 010 7M19 6a8.5 8.5 0 010 12"/></svg>';
    $('mute-btn').setAttribute('aria-label', voice.muted ? "Unmute Kaivra's voice" : "Mute Kaivra's voice");
    $('mute-btn').classList.toggle('on', voice.muted);
    $('kb-btn').classList.toggle('on', typebar.classList.contains('open'));
  };

  // ---------- speaking ----------
  function buzz(ms) {
    try { if (native && native.vibrate) native.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }
  function keepAlive() {
    if (safety) clearTimeout(safety);
    const ms = typebar.classList.contains('open') ? 120000 : native ? 30000 : 12000;
    safety = setTimeout(() => { if (comp._activeT) sleep(false); }, ms);
  }
  const speakable = (text) => String(text).replace(/kaivra/gi, nameSay).replace(/\*\*|__|[*#`>~]/g, '');
  function say(text, listenAfter) {
    voice.reply = text;
    voice.listenNext = !!listenAfter;
    if (voice.muted) {
      voice.mode = listenAfter ? 'listening' : 'idle';
      if (listenAfter) { try { if (native && native.listen) native.listen(); } catch (e) {} }
    } else {
      voice.mode = 'speaking';
      if (native && native.say) {
        try { native.say(speakable(text), !!listenAfter); } catch (e) {}
      } else {
        try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(speakable(text))); } catch (e) {}
      }
    }
    keepAlive();
    comp._paint();
  }

  // ---------- waking and sleeping ----------
  const rawToggle = comp._toggle.bind(comp);
  function awake(quietly) {
    if (comp._activeT) return;
    rawToggle();
    if (comp._offTimer) { clearTimeout(comp._offTimer); comp._offTimer = null; } // Kaivra decides when to sleep
    buzz(quietly ? 15 : 28);
  }
  function wake() {
    voice.heard = ''; voice.partial = ''; voice.reply = ''; voice.typed = false;
    say('Kaivra online. How can I help?', true);
  }
  function sleep(spoken, letFinish) {
    if (safety) { clearTimeout(safety); safety = null; }
    if (laterSleep) { clearTimeout(laterSleep); laterSleep = null; }
    if (!letFinish) { try { if (native && native.stop) native.stop(); } catch (e) {} }
    if (comp._activeT) rawToggle();
    if (comp._offTimer) { clearTimeout(comp._offTimer); comp._offTimer = null; }
    voice.mode = 'idle'; voice.heard = ''; voice.partial = ''; voice.listenNext = false;
    if (spoken && !voice.muted) { try { if (native && native.say) native.say('Standing by.', false); } catch (e) {} }
    buzz(12);
    comp._paint();
  }
  comp._toggle = function () {
    if (comp._activeT) { sleep(true); return; }
    awake(false);
    wake();
  };

  // ---------- typing ----------
  function openTypebar(open) {
    typebar.classList.toggle('open', open);
    if (open) setTimeout(() => typeIn.focus(), 50); else typeIn.blur();
    comp._paint();
  }
  $('kb-btn').addEventListener('click', () => openTypebar(!typebar.classList.contains('open')));
  $('mute-btn').addEventListener('click', () => { setMuted(!voice.muted); typeIn.focus(); });
  typebar.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = typeIn.value.trim();
    if (!text) return;
    typeIn.value = '';
    try { if (native && native.stop) native.stop(); } catch (err) {}
    awake(true);
    handle(text, true);
  });
  function setMuted(m) {
    voice.muted = m;
    store.set('muted', m ? '1' : '0');
    if (m) { try { if (native && native.stop) native.stop(); } catch (e) {} }
    comp._paint();
  }

  // ---------- access screen ----------
  const ACCESS = [
    ['mic', 'Microphone', 'Hear your commands'],
    ['contacts', 'Contacts', 'Find the people you ask me to call or text'],
    ['phone', 'Phone calls', 'Place calls for you directly'],
    ['notifications', 'Notifications', 'Alert you when something needs you'],
    ['control', 'Phone control', 'Go home, go back, open notifications and quick settings, show recent apps, lock the screen, take screenshots']
  ];
  let access = {};
  const accessPanel = $('access');
  function readAccess(json) {
    try { access = JSON.parse(json || (native && native.accessStatus ? native.accessStatus() : '{}')) || {}; } catch (e) { access = {}; }
  }
  function renderAccess() {
    const list = $('acc-list');
    list.innerHTML = '';
    ACCESS.forEach(([key, name, desc]) => {
      const on = !!access[key];
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'acc-row';
      row.innerHTML = '<div class="t"><div class="n"></div><div class="d"></div></div><div class="acc-chip"></div>';
      row.querySelector('.n').textContent = name;
      row.querySelector('.d').textContent = desc;
      const chip = row.querySelector('.acc-chip');
      chip.textContent = on ? 'ON' : key === 'control' ? 'TURN ON' : 'ALLOW';
      chip.classList.toggle('ok', on);
      row.addEventListener('click', () => { if (!on || key === 'control') requestAccess(key); });
      list.appendChild(row);
    });
    const allOn = ACCESS.every(([k]) => k === 'control' || access[k]);
    $('acc-all').textContent = allOn ? (access.control ? 'ALL SET' : 'TURN ON PHONE CONTROL') : 'ALLOW ALL';
    renderParts();
  }
  function requestAccess(key) {
    if (native && native.requestAccess) { try { native.requestAccess(key); } catch (e) {} }
  }
  function openAccess(open, focus) {
    if (open) { readAccess(); readParts(); renderAccess(); }
    accessPanel.classList.toggle('open', open);
    if (open && focus === 'parts') setTimeout(() => $('parts-sec').scrollIntoView({ block: 'start' }), 60);
    if (open) { try { if (native && native.checkPacks) native.checkPacks(); } catch (e) {} }
  }
  $('access-btn').addEventListener('click', () => openAccess(true));
  $('acc-close').addEventListener('click', () => openAccess(false));
  $('acc-appinfo').addEventListener('click', (e) => { e.preventDefault(); requestAccess('appinfo'); });
  $('acc-all').addEventListener('click', () => {
    const allOn = ACCESS.every(([k]) => k === 'control' || access[k]);
    if (!allOn) requestAccess('all');
    else if (!access.control) requestAccess('control');
    else openAccess(false);
  });
  accessPanel.addEventListener('click', (e) => { if (e.target === accessPanel) openAccess(false); });
  // ---------- Kaivra's own parts: brain, knowledge library, hearing ----------
  let parts = {};
  const PARTS = [
    ['brain', 'Brain', 'My own neural network, trained from zero'],
    ['library', 'Knowledge library', 'Facts from Simple English Wikipedia, offline'],
    ['hearing', 'Hearing', 'Offline speech recognition (open-source Vosk)']
  ];
  const mb = (b) => (b / 1048576).toFixed(b > 10485760 ? 0 : 1) + ' MB';
  function readParts(json) {
    try { parts = JSON.parse(json || (native && native.packsStatus ? native.packsStatus() : '{}')) || {}; } catch (e) { parts = {}; }
  }
  function partNeeds(p) { return p && p.available !== undefined && (!p.ready || p.installed !== p.available); }
  function renderParts() {
    const list = $('parts-list');
    if (!list) return;
    list.innerHTML = '';
    let need = 0, any = false;
    PARTS.forEach(([key, name, desc]) => {
      const p = parts[key] || {};
      const row = document.createElement('div');
      row.className = 'part';
      row.innerHTML = '<div class="t"><div class="n"></div><div class="d"></div></div><div class="acc-chip"></div>';
      row.querySelector('.n').textContent = name;
      let d = desc;
      const info = p.info || p.latest || {};
      if (key === 'brain' && p.ready && info.steps) d = 'Trained ' + Number(info.steps).toLocaleString() + ' steps' + (info.trained ? ', ' + info.trained : '');
      if (key === 'library' && p.ready && info.articles) d = Number(info.articles).toLocaleString() + ' articles, offline';
      row.querySelector('.d').textContent = d;
      const chip = row.querySelector('.acc-chip');
      if (partNeeds(p)) { chip.textContent = p.ready ? 'UPDATE' : 'GET'; need += p.bytes || 0; any = true; }
      else if (p.ready) { chip.textContent = 'READY'; chip.classList.add('ok'); }
      else { chip.textContent = 'MISSING'; any = true; }
      list.appendChild(row);
    });
    const btn = $('parts-btn'), help = $('parts-help');
    btn.disabled = !!parts.busy;
    if (parts.busy) {
      const pr = parts.progress;
      btn.textContent = pr && pr.total ? 'DOWNLOADING ' + Math.floor(100 * pr.done / pr.total) + '%' : 'DOWNLOADING…';
    } else if (need > 0) btn.textContent = 'DOWNLOAD (' + mb(need) + ')';
    else if (any) btn.textContent = parts.checked ? 'NOT READY YET' : 'CHECK FOR PARTS';
    else btn.textContent = 'ALL UP TO DATE';
    if (parts.error === 'offline') help.textContent = 'Could not reach GitHub. Check the internet connection and try again. After this, everything works offline.';
    else if (parts.error === 'notyet') help.textContent = 'My first training night has not finished yet. Try again a little later.';
    else if (parts.error === 'damaged') help.textContent = 'A download was damaged. Tap to try again.';
    else help.textContent = 'Downloaded once from your own GitHub, then everything works offline. The brain trains every night; tap again to get the newest one.';
  }
  $('parts-btn').addEventListener('click', () => {
    try { if (native && native.downloadPacks) native.downloadPacks(); } catch (e) {}
  });
  function onPacks(json) {
    readParts(json);
    if (accessPanel.classList.contains('open')) renderParts();
    if (parts.finished && parts.changed) {
      awake(true);
      voice.heard = '';
      const got = parts.changed.split(',').filter(Boolean);
      if (got.length) say(got.indexOf('brain') >= 0 ? 'My brain is ready. Ask me anything.' : 'My parts are ready.', false);
      else if (!parts.error) say('Everything is already up to date.', false);
    }
  }

  // ---------- the parts Kaivra can show ----------
  const EXTRA = {
    core: ['core', 'kaivra core'], guard: ['security', 'security guard', 'guard'], perms: ['permissions', 'permission watch'],
    encrypt: ['encryption'], brains: ['brain', 'brains', 'brain models'], hands: ['phone control', 'hands'],
    masterkey: ['master key'], changes: ['change log', 'undo'], voicelock: ['voice lock'], voice: ['voice', 'voice engine'],
    soulpack: ['soul pack'], lessons: ['lessons', 'training lessons'], library: ['library', 'knowledge', 'knowledge library'],
    p_calls: ['calls', 'sms', 'calls and sms'], p_remind: ['reminders', 'alarms'], p_reels: ['reel editor', 'reels'],
    p_learn: ['learn crawler', 'crawler'], p_build: ['code builder', 'builder'], a_team: ['learning team', 'team'],
    d_phone: ['this phone', 'phone'], d_pc: ['pc', 'computer', 'paired pc'], d_tv: ['tv', 'android tv'],
    d_cloud: ['online brain', 'cloud'], d_github: ['github', 'github builds'], d_colab: ['gpu', 'training', 'cloud gpu']
  };
  function findPart(target, exactOnly) {
    const cat = comp._catalog();
    const q = target.replace(/\b(the|my|your|part|layer|vault|agent)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!q) return null;
    let best = null, bestScore = 0, bestLen = 0;
    Object.keys(cat).forEach((c) => {
      const names = [cat[c][1].toLowerCase(), cat[c][1].toLowerCase().replace(/^agent · /, ''), c.replace(/^[pad]_/, '').replace(/_/g, ' ')].concat(EXTRA[c] || []);
      names.forEach((n) => {
        const s = q === n ? 3 : exactOnly ? 0 : (n.length >= 4 && q.includes(n)) ? 2 : (q.length >= 4 && n.includes(q)) ? 1 : 0;
        if (s > bestScore || (s > 0 && s === bestScore && n.length > bestLen)) { bestScore = s; bestLen = n.length; best = c; }
      });
    });
    return best;
  }
  function resetView() {
    try { comp.renderVals().onKey({ key: 'r', preventDefault() {} }); } catch (e) {}
  }
  // focus on a part (and open its vault) exactly as two taps on it would
  function showPart(c, open, tries) {
    if (c === 'core') { resetView(); return true; }
    if (comp._open || comp._focus || 4.6 / comp._dist > 1.5) {
      if ((tries || 0) < 1) { resetView(); setTimeout(() => showPart(c, open, 1), 900); return true; }
    }
    const pk = (comp._picks || []).filter((p) => p.c === c);
    if (!pk.length) return false;
    const best = pk.reduce((a, b) => (b.z > a.z ? b : a));
    const r = cv.getBoundingClientRect(), s = r.width / (cv.clientWidth || 1);
    const x = r.left + best.x * s, y = r.top + best.y * s;
    comp._picks = [best]; comp._coreHit = null;
    comp._tap(x, y);
    if (open) { comp._picks = [best]; comp._coreHit = null; comp._tap(x, y); }
    return true;
  }

  // ---------- Kaivra's own brain (on the phone) ----------
  const brain = { id: 0, waiting: 0, typed: false, history: [], asked: '' };
  function askBrain(text, typed) {
    const answer = (t) => say(t, !typed);
    if (!native || !native.think) { answer('My brain only runs inside the Kaivra app.'); return; }
    brain.id += 1; brain.waiting = brain.id; brain.typed = !!typed; brain.asked = text;
    voice.mode = 'thinking'; voice.reply = '';
    keepAlive(); comp._paint();
    try { native.think(JSON.stringify({ id: brain.id, question: text, history: brain.history.slice(-4) })); }
    catch (e) { brain.waiting = 0; answer('My brain could not start.'); }
  }
  const BRAIN_ERRORS = {
    nobrain: 'My brain is not on this phone yet. Open the shield, and download my parts.',
    empty: 'I am not sure what to say to that. Try asking another way.',
    brain: 'Something went wrong in my brain. Try again.'
  };
  function onBrain(json) {
    let r = {};
    try { r = JSON.parse(json); } catch (e) {}
    if (!brain.waiting || (r.id && r.id !== brain.waiting)) return; // an older question, or a command came in meanwhile
    brain.waiting = 0;
    const answer = (t) => say(t, !brain.typed);
    if (r.ok && r.text) {
      const text = String(r.text).trim();
      brain.history.push([brain.asked, text]);
      if (brain.history.length > 6) brain.history.shift();
      answer(text);
      return;
    }
    if (r.error === 'nobrain') openAccess(true, 'parts');
    answer(BRAIN_ERRORS[r.error] || BRAIN_ERRORS.brain);
  }

  // ---------- a small calculator (numbers typed or spoken as words) ----------
  const NUMW = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
    twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  function wordsToNumber(str) {
    const w = str.trim().replace(/-/g, ' ').split(/\s+/).filter((x) => x && x !== 'and');
    if (!w.length) return null;
    if (w.length === 1 && /^-?\d+(\.\d+)?$/.test(w[0])) return parseFloat(w[0]);
    let total = 0, cur = 0, seen = false, neg = false, dec = '', inDec = false;
    for (const x of w) {
      if (x === 'minus' || x === 'negative') { neg = true; continue; }
      if (x === 'point') { inDec = true; continue; }
      if (inDec) { if (NUMW[x] !== undefined && NUMW[x] < 10) dec += NUMW[x]; else if (/^\d+$/.test(x)) dec += x; else return null; continue; }
      if (/^\d+(\.\d+)?$/.test(x)) { cur += parseFloat(x); seen = true; continue; }
      if (NUMW[x] !== undefined) { cur += NUMW[x]; seen = true; continue; }
      if (x === 'hundred') { cur = (cur || 1) * 100; seen = true; continue; }
      const big = { thousand: 1e3, lakh: 1e5, million: 1e6, crore: 1e7, billion: 1e9 }[x];
      if (big) { total += (cur || 1) * big; cur = 0; seen = true; continue; }
      return null;
    }
    if (!seen) return null;
    let v = total + cur;
    if (dec) v = parseFloat(v + '.' + dec);
    return neg ? -v : v;
  }
  const OPS = [['plus', '+'], ['added to', '+'], ['minus', '-'], ['less', '-'], ['times', '*'], ['multiplied by', '*'], ['into', '*'], ['x', '*'],
    ['divided by', '/'], ['over', '/'], ['+', '+'], ['*', '*'], ['/', '/'], ['-', '-']];
  function calculate(t) {
    const m = t.match(/^(?:what is|what's|whats|calculate|compute|how much is|tell me)?\s*(.+?)\s*$/);
    if (!m) return null;
    const expr = m[1];
    for (const [w, op] of OPS) {
      const i = expr.indexOf(' ' + w + ' ');
      const j = (op === w) ? expr.indexOf(w) : -1;
      let a, b;
      if (i > 0) { a = expr.slice(0, i); b = expr.slice(i + w.length + 2); }
      else if (j > 0 && w.length === 1) { a = expr.slice(0, j); b = expr.slice(j + 1); }
      else continue;
      if (w === '-' && /^\s*$/.test(a)) continue;
      const x = wordsToNumber(a), y = wordsToNumber(b);
      if (x === null || y === null) continue;
      let r = op === '+' ? x + y : op === '-' ? x - y : op === '*' ? x * y : (y === 0 ? NaN : x / y);
      if (!isFinite(r)) return 'That cannot be divided by zero.';
      r = Math.round(r * 1e6) / 1e6;
      return 'That is ' + (Math.abs(r) >= 1e15 ? r.toExponential(3) : String(r)) + '.';
    }
    return null;
  }

  // ---------- Kaivra's built-in brain (offline, simple commands) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const HELP = 'I can tell you the time, the date and the battery, open any app, call or text your contacts, go home, open notifications, lock the phone, take a screenshot, turn the torch on or off, change the volume, and show any part of my core. I can also answer questions from my own brain and knowledge library, and do simple sums. Say change voice to hear another voice, or stop when you are done.';
  const CONTROL = {
    home: ['Going home.', true], back: ['Going back.', false], recents: ['Here are your recent apps.', true],
    notifications: ['Here are your notifications.', true], quicksettings: ['Here are your quick settings.', true],
    power: ['Here is the power menu.', true], lock: ['Locking the phone.', true], screenshot: ['Taking a screenshot.', false]
  };

  function handle(raw, typed) {
    if (laterSleep) { clearTimeout(laterSleep); laterSleep = null; }
    brain.waiting = 0;
    const rawN = String(raw || '').replace(/\s+/g, ' ').trim();
    const t = rawN.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
    voice.heard = rawN; voice.partial = ''; voice.typed = !!typed;
    const answer = (text) => say(text, !typed);           // spoken commands keep the conversation going; typed ones wait for typing
    const answerThenSleep = (text, ms) => { say(text, false); sleepLater(ms); };
    if (!t) { answer('I did not catch that. Please say it again.'); return; }
    const has = (...ws) => ws.some((w) => t.includes(w));
    const word = (re) => re.test(t);

    // my voice: mute, unmute, change it, say my name
    if (word(/^(mute|mute yourself|be quiet|quiet|silent|silence|stop talking|no voice|text only)( please)?$/)) { setMuted(true); voice.reply = 'Muted. I will reply in text only.'; voice.mode = 'idle'; keepAlive(); comp._paint(); return; }
    if (word(/^(unmute|unmute yourself|voice on|speak again|talk to me|you can speak)( please)?$/)) { setMuted(false); answer('I am speaking again.'); return; }
    if (has('change voice', 'change your voice', 'next voice', 'another voice', 'different voice', 'new voice', 'other voice')) {
      let label = '';
      try { if (native && native.nextVoice) label = native.nextVoice(); } catch (e) {}
      if (label && voice.muted) setMuted(false);
      answer(label ? 'How about this voice? ' + label + '. Say change voice again for the next one.' : 'I cannot change my voice on this phone.');
      return;
    }
    const nm = rawN.match(/(?:say|pronounce|call)\s+your(?:self| name)?\s+(?:name\s+)?(?:as|like)\s+(.+)$/i);
    if (nm) {
      nameSay = nm[1].replace(/[."“”]/g, '').trim() || nameSay;
      store.set('nameSay', nameSay);
      if (voice.muted) setMuted(false);
      answer('Got it. I am Kaivra.');
      return;
    }
    if (has('say your name', 'how do you say your name', 'pronounce your name')) { answer('I am Kaivra.'); return; }

    if (/^(stop|sleep|bye|goodbye|cancel|nothing|that's all|that is all|go to sleep|standby|stand by)\b/.test(t) || has('go to sleep', 'stand by', 'standby', 'goodbye')) {
      voice.reply = 'Standing by.';
      sleep(true);
      return;
    }
    if (word(/^((connect|add|set up|setup|download|update|get)( (your|the|my|own))* (brain|parts|library|hearing))$/) || word(/^brain (setup|settings|status)$/)) {
      openAccess(true, 'parts');
      answer('Here are my own parts. Tap download to get the newest ones.');
      return;
    }
    if (word(/^(open |show )?(the |my )?(permissions?|access|setup|set up)( screen| settings)?$/)) {
      openAccess(true);
      answer('Here is what I can reach on this phone. Tap anything that is not on yet.');
      return;
    }
    if (word(/^(what('s| is) the time|what time is it|tell me the time|current time|time)( now| please)?$/)) {
      const d = new Date(), h = d.getHours() % 12 || 12;
      answer('It is ' + h + ':' + pad(d.getMinutes()) + (d.getHours() < 12 ? ' AM.' : ' PM.')); return;
    }
    if (word(/^(what('s| is) (the |today's )?(date|day)( today)?|today's date|what day is (it|today)|which day is (it|today)|date)( please)?$/)) {
      const d = new Date();
      answer('Today is ' + DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + '.'); return;
    }
    if (word(/^(battery|battery level|battery status|how much (battery|charge)( is left| do i have)?|what('s| is) (the |my )?(battery|charge)( level| percentage)?)( please)?$/)) {
      let b = -1;
      try { if (native && native.battery) b = native.battery(); } catch (e) {}
      answer(b >= 0 ? 'Battery is at ' + b + ' percent.' : 'I cannot read the battery here.'); return;
    }
    if (word(/^(what('s| is) your name|who are you|what are you)$/)) { answer('I am Kaivra, your personal assistant. I live on this phone and I answer only to you.'); return; }
    if (word(/^who (made|created|built) you$/)) { answer('You did. I am built from your own design, and my code lives on your GitHub.'); return; }
    if (word(/^(what can you do( for me)?|help|commands|what are your commands)$/)) { answer(HELP); return; }
    if (word(/^(thanks|thank you|thank you so much|thanks a lot)( kaivra)?$/)) { answer('You are welcome.'); return; }
    if (word(/^(hi|hello|hey|namaste|good morning|good evening|good night)( kaivra)?$/)) { answer(typed ? 'Hello. Type what you need.' : 'Hello. I am listening.'); return; }

    // phone control (needs Phone control turned on)
    let ctl = null;
    if (word(/^(go (to )?(the )?home( screen)?|home( screen)?)$/)) ctl = 'home';
    else if (word(/^((show|open) )?(me )?(the |my )?(recent apps|recents|app switcher)$/)) ctl = 'recents';
    else if (word(/^((show|open) )?(me )?(the )?quick settings$/)) ctl = 'quicksettings';
    else if (word(/^((open|show|pull down|check|see) )?(me )?(the |my )?notifications?( panel)?$/)) ctl = 'notifications';
    else if (word(/^lock( the| my)? (phone|screen|device)$|^lock$/)) ctl = 'lock';
    else if (word(/^((take|capture) )?(a )?(screenshot|screen shot)$/)) ctl = 'screenshot';
    else if (word(/^((open|show) )?(the )?power (menu|options)$/)) ctl = 'power';
    else if (word(/^(press back|back button)$/)) ctl = 'back';
    if (ctl) {
      let ok = false;
      try { ok = !!(native && native.control && native.control(ctl)); } catch (e) {}
      if (ok) { const c = CONTROL[ctl]; if (c[1]) answerThenSleep(c[0], 700); else answer(c[0]); return; }
      openAccess(true);
      answer('I need Phone control for that. Turn on Kaivra phone control, then ask me again.');
      return;
    }
    if (word(/^((turn|switch) (on|off) )?(the )?(torch|flashlight|flash light)( on| off)?$|^(turn|switch) (the )?(torch|flashlight|flash light) (on|off)$/)) {
      const on = !word(/\boff\b/);
      let ok = false;
      try { ok = !!(native && native.torch && native.torch(on)); } catch (e) {}
      answer(ok ? (on ? 'Torch on.' : 'Torch off.') : 'I could not reach the torch.'); return;
    }
    if (word(/^(volume up|louder|increase (the )?volume|raise (the )?volume|turn (the )?volume up|turn it up)$/)) { try { native.volume(1); native.volume(1); } catch (e) {} answer('Volume up.'); return; }
    if (word(/^(volume down|quieter|softer|decrease (the )?volume|lower (the )?volume|turn (the )?volume down|turn it down)$/)) { try { native.volume(-1); native.volume(-1); } catch (e) {} answer('Volume down.'); return; }

    // calls and messages (need Contacts; Phone calls to dial directly)
    const cm = rawN.match(/^(?:please\s+|kaivra\s+)?(?:call|dial|ring)\s+(.+?)\s*[.!?]?$/i);
    if (cm) {
      let r = { status: 'none' };
      try { if (native && native.call) r = JSON.parse(native.call(cm[1])); } catch (e) {}
      if (r.status === 'calling') { answerThenSleep('Calling ' + r.name + '.', 1500); return; }
      if (r.status === 'dialing') { answerThenSleep('Opening the dialer for ' + r.name + '. Allow phone calls in Access and I will call directly next time.', 1500); return; }
      if (r.status === 'nocontacts') { openAccess(true); answer('I need your contacts to find ' + cm[1] + '. Allow Contacts, then ask me again.'); return; }
      if (r.status === 'notfound') { answer('I could not find ' + cm[1] + ' in your contacts.'); return; }
      answer('I cannot make calls here.'); return;
    }
    const tm = rawN.match(/^(?:please\s+|kaivra\s+)?(?:text|message|sms|send (?:a )?(?:message|text|sms) to)\s+(.+?)(?:\s+(?:saying|that says|that|to say)\s+(.+))?$/i);
    if (tm) {
      let r = { status: 'none' };
      try { if (native && native.text) r = JSON.parse(native.text(tm[1], tm[2] || '')); } catch (e) {}
      if (r.status === 'composed') { answerThenSleep('Your message to ' + r.name + ' is ready. Tap send.', 1500); return; }
      if (r.status === 'nocontacts') { openAccess(true); answer('I need your contacts to find ' + tm[1] + '. Allow Contacts, then ask me again.'); return; }
      if (r.status === 'notfound') { answer('I could not find ' + tm[1] + ' in your contacts.'); return; }
      answer('I cannot send messages here.'); return;
    }

    const sum = calculate(rawN.toLowerCase().replace(/,/g, '').replace(/[!?]+$/, '').replace(/\.$/, '').trim());
    if (sum) { answer(sum); return; }

    if (word(/^(zoom out|reset( the)?( view)?|go back|full view|close it|close (the )?(vault|file|part))$/)) { resetView(); answer('Back to the full view.'); return; }

    const m = t.match(/^(?:please\s+|can you\s+|kaivra\s+)?(open|launch|start|run|show me|show|go to|zoom into|zoom in on|zoom in to|take me to)\s+(.+)$/);
    if (m) {
      const verb = m[1], target = m[2].replace(/^(the|my)\s+/, '').replace(/\s+(app|application|please)$/, '').trim();
      const cat = comp._catalog();
      const viaApp = (strict) => { try { return native && native.openApp ? native.openApp(target, strict) : ''; } catch (e) { return ''; } };
      if (verb === 'open' || verb === 'launch' || verb === 'start' || verb === 'run') {
        let app = viaApp(true);
        if (app) { answerThenSleep('Opening ' + app + '.', 600); return; }
        const c = findPart(target);
        if (c && showPart(c, verb === 'open')) { answer((verb === 'open' && c !== 'core' ? 'Opening the ' + cat[c][1] + ' vault. ' : 'Here is ' + cat[c][1] + '. ') + cat[c][2]); return; }
        app = viaApp(false);
        if (app) { answerThenSleep('Opening ' + app + '.', 600); return; }
        answer('I could not find an app or a part called ' + target + '.'); return;
      }
      const c = findPart(target);
      if (c && showPart(c, false)) { answer('Here is ' + cat[c][1] + '. ' + cat[c][2]); return; }
      askBrain(rawN, typed); return;
    }
    const pm = t.match(/^(?:what is|what's|tell me about|where is)\s+(?:the |my |your )?(.+)$/);
    const pc = pm ? findPart(pm[1], true) : null;
    if (pc) { showPart(pc, false); answer(comp._catalog()[pc][1] + '. ' + comp._catalog()[pc][2]); return; }

    askBrain(rawN, typed);
  }

  // ---------- events from Android ----------
  window.KaivraVoice = {
    onEvent(type, text) {
      if (type === 'access') { readAccess(text); if (accessPanel.classList.contains('open')) renderAccess(); return; }
      if (type === 'packs') { onPacks(text); return; }
      if (!comp._activeT && type !== 'spoken') return;
      if (type === 'brain') { onBrain(text); return; }
      keepAlive();
      if (type === 'speaking') voice.mode = 'speaking';
      else if (type === 'spoken') { if (voice.mode === 'speaking') voice.mode = comp._activeT && voice.listenNext ? 'listening' : 'idle'; }
      else if (type === 'listening') { voice.mode = 'listening'; voice.partial = ''; }
      else if (type === 'partial') { voice.partial = text; voice.reply = ''; voice.heard = ''; }
      else if (type === 'thinking') voice.mode = 'thinking';
      else if (type === 'result') { voice.mode = 'thinking'; handle(text, false); return; }
      else if (type === 'error') { onError(String(text)); return; }
      comp._paint();
    },
    handle: handle // for testing: KaivraVoice.handle('what time is it')
  };
  let busyRetries = 0;
  function onError(code) {
    if (code === '5') return; // cancelled on purpose
    if (code === 'launch') { voice.reply = 'I could not open that.'; comp._paint(); return; }
    if (code === '6' || code === '7') { // nothing was said
      if (typebar.classList.contains('open')) { voice.mode = 'idle'; comp._paint(); return; }
      sleep(true); return;
    }
    if (code === '8' && busyRetries < 2) { busyRetries++; setTimeout(() => { try { native.listen(); } catch (e) {} }, 500); return; }
    busyRetries = 0;
    if (code === 'permission') { voice.reply = 'I need microphone permission to hear you. You can still type to me.'; say(voice.reply, false); openTypebar(true); return; }
    if (code === 'unavailable') { voice.reply = 'My hearing could not start on this phone. You can type to me meanwhile.'; say(voice.reply, false); openTypebar(true); return; }
    if (code === 'tts') { voice.reply = 'My voice could not play on this phone.'; comp._paint(); return; }
    if (code === 'nohearing') { openAccess(true, 'parts'); voice.reply = 'I need my hearing first. Download my parts in the shield screen. You can type to me meanwhile.'; say(voice.reply, false); openTypebar(true); return; }
    if (code === '1' || code === '2' || code === '4') { voice.reply = 'I could not hear you properly. Try again, or type to me.'; say(voice.reply, false); openTypebar(true); return; }
    voice.reply = 'Something went wrong with my hearing. Tap the core to try again, or type to me.'; say(voice.reply, false); sleepLater(6000);
  }

  // ---------- input ----------
  btn.addEventListener('pointerdown', (e) => V.onDown(e));
  btn.addEventListener('pointermove', (e) => V.onMove(e));
  btn.addEventListener('pointerup', (e) => V.onUp(e));
  btn.addEventListener('pointercancel', (e) => V.onUp(e));
  btn.addEventListener('wheel', (e) => { e.preventDefault(); V.onWheel(e); }, { passive: false });
  btn.addEventListener('click', (e) => V.onClick(e));
  btn.addEventListener('keydown', (e) => V.onKey(e));
  btn.addEventListener('contextmenu', (e) => e.preventDefault());

  comp._paint();
  comp._mounted = true;
  comp.componentDidMount();
  window.KaivraCore = comp;

  // first launch: show what Kaivra can reach and ask for it
  if (store.get('accessSeen', '0') !== '1') {
    store.set('accessSeen', '1');
    setTimeout(() => openAccess(true), 1200);
  }
})();
