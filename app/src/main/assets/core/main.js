/* Mounts the Kaivra core full-screen and gives it a voice: it speaks, listens, reads what you type and replies.
   Native side (Android): window.KaivraNative.* (say, listen, stop, nextVoice, accessStatus, requestAccess,
   call, text, control, torch, volume, vibrate, battery, openApp, version).
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
  let nameSay = store.get('nameSay', 'Kai-vraa'); // how the voice pronounces "Kaivra"
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
  const speakable = (text) => String(text).replace(/kaivra/gi, nameSay);
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
  }
  function requestAccess(key) {
    if (native && native.requestAccess) { try { native.requestAccess(key); } catch (e) {} }
  }
  function openAccess(open) {
    if (open) { readAccess(); renderAccess(); }
    accessPanel.classList.toggle('open', open);
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
  function findPart(target) {
    const cat = comp._catalog();
    const q = target.replace(/\b(the|my|your|part|layer|vault|agent)\b/g, ' ').replace(/\s+/g, ' ').trim();
    if (!q) return null;
    let best = null, bestScore = 0, bestLen = 0;
    Object.keys(cat).forEach((c) => {
      const names = [cat[c][1].toLowerCase(), cat[c][1].toLowerCase().replace(/^agent · /, ''), c.replace(/^[pad]_/, '').replace(/_/g, ' ')].concat(EXTRA[c] || []);
      names.forEach((n) => {
        const s = q === n ? 3 : (n.length >= 4 && q.includes(n)) ? 2 : (q.length >= 4 && n.includes(q)) ? 1 : 0;
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

  // ---------- Kaivra's built-in brain (offline, simple commands) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const HELP = 'I can tell you the time, the date and the battery, open any app, call or text your contacts, go home, open notifications, lock the phone, take a screenshot, turn the torch on or off, change the volume, and show any part of my core. Say change voice to hear another voice, or stop when you are done.';
  const CONTROL = {
    home: ['Going home.', true], back: ['Going back.', false], recents: ['Here are your recent apps.', true],
    notifications: ['Here are your notifications.', true], quicksettings: ['Here are your quick settings.', true],
    power: ['Here is the power menu.', true], lock: ['Locking the phone.', true], screenshot: ['Taking a screenshot.', false]
  };

  function handle(raw, typed) {
    if (laterSleep) { clearTimeout(laterSleep); laterSleep = null; }
    const rawN = String(raw || '').replace(/\s+/g, ' ').trim();
    const t = rawN.toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
    voice.heard = rawN; voice.partial = ''; voice.typed = !!typed;
    const answer = (text) => say(text, !typed);           // spoken commands keep the conversation going; typed ones wait for typing
    const answerThenSleep = (text, ms) => { say(text, false); sleepLater(ms); };
    if (!t) { answer('I did not catch that. Please say it again.'); return; }
    const has = (...ws) => ws.some((w) => t.includes(w));
    const word = (re) => re.test(t);

    // my voice: mute, unmute, change it, say my name
    if (word(/^(mute|be quiet|quiet|silent|silence|stop talking|no voice|text only)\b/)) { setMuted(true); voice.reply = 'Muted. I will reply in text only.'; voice.mode = 'idle'; keepAlive(); comp._paint(); return; }
    if (word(/^(unmute|speak|talk to me|voice on|speak again)\b/)) { setMuted(false); answer('I am speaking again.'); return; }
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
    if (word(/\b(permissions?|access|setup|set up)\b/) && !has('permission watch')) {
      openAccess(true);
      answer('Here is what I can reach on this phone. Tap anything that is not on yet.');
      return;
    }
    if (has('what time', 'the time', 'time is it') || t === 'time') {
      const d = new Date(), h = d.getHours() % 12 || 12;
      answer('It is ' + h + ':' + pad(d.getMinutes()) + (d.getHours() < 12 ? ' AM.' : ' PM.')); return;
    }
    if (word(/\b(date|what day|which day|today)\b/)) {
      const d = new Date();
      answer('Today is ' + DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + '.'); return;
    }
    if (word(/\b(battery|charge|charging)\b/)) {
      let b = -1;
      try { if (native && native.battery) b = native.battery(); } catch (e) {}
      answer(b >= 0 ? 'Battery is at ' + b + ' percent.' : 'I cannot read the battery here.'); return;
    }
    if (has('your name', 'who are you', 'what are you')) { answer('I am Kaivra, your personal assistant. I live on this phone and I answer only to you.'); return; }
    if (has('who made you', 'who created you', 'who built you')) { answer('You did. I am built from your own design, and my code lives on your GitHub.'); return; }
    if (has('what can you do') || word(/\bhelp\b/)) { answer(HELP); return; }
    if (has('how are you')) { answer('All systems running. Ready when you are.'); return; }
    if (has('thank')) { answer('You are welcome.'); return; }
    if (/^(hi|hello|hey|namaste|good morning|good evening|good night)\b/.test(t)) { answer(typed ? 'Hello. Type what you need.' : 'Hello. I am listening.'); return; }

    // phone control (needs Phone control turned on)
    let ctl = null;
    if (word(/\b(go (to )?home|home screen)\b/)) ctl = 'home';
    else if (word(/\b(recent apps|recents|app switcher)\b/)) ctl = 'recents';
    else if (word(/\bquick settings\b/)) ctl = 'quicksettings';
    else if (word(/\b(notifications?|notification panel)\b/) && (word(/\b(open|show|pull|check|see)\b/) || t === 'notifications')) ctl = 'notifications';
    else if (word(/\block (the |my )?(phone|screen|device)\b/) || t === 'lock') ctl = 'lock';
    else if (word(/\b(screenshot|screen shot)\b/)) ctl = 'screenshot';
    else if (word(/\bpower (menu|options)\b/)) ctl = 'power';
    else if (word(/^(press back|back button)$/)) ctl = 'back';
    if (ctl) {
      let ok = false;
      try { ok = !!(native && native.control && native.control(ctl)); } catch (e) {}
      if (ok) { const c = CONTROL[ctl]; if (c[1]) answerThenSleep(c[0], 700); else answer(c[0]); return; }
      openAccess(true);
      answer('I need Phone control for that. Turn on Kaivra phone control, then ask me again.');
      return;
    }
    if (word(/\b(torch|flashlight|flash light)\b/)) {
      const on = !word(/\boff\b/);
      let ok = false;
      try { ok = !!(native && native.torch && native.torch(on)); } catch (e) {}
      answer(ok ? (on ? 'Torch on.' : 'Torch off.') : 'I could not reach the torch.'); return;
    }
    if (word(/\b(volume up|louder|increase (the )?volume|raise (the )?volume)\b/)) { try { native.volume(1); native.volume(1); } catch (e) {} answer('Volume up.'); return; }
    if (word(/\b(volume down|quieter|softer|decrease (the )?volume|lower (the )?volume)\b/)) { try { native.volume(-1); native.volume(-1); } catch (e) {} answer('Volume down.'); return; }

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

    if (has('zoom out', 'reset', 'go back', 'full view', 'close it', 'close the')) { resetView(); answer('Back to the full view.'); return; }

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
      answer('I could not find a part called ' + target + '.'); return;
    }
    const c = findPart(t);
    if (c && has('show', 'where', 'what is', 'tell me about')) { showPart(c, false); answer(comp._catalog()[c][1] + '. ' + comp._catalog()[c][2]); return; }

    answer('I cannot answer that yet, because my brain is not connected. Ask me what I can do to hear my commands.');
  }

  // ---------- events from Android ----------
  window.KaivraVoice = {
    onEvent(type, text) {
      if (type === 'access') { readAccess(text); if (accessPanel.classList.contains('open')) renderAccess(); return; }
      if (!comp._activeT && type !== 'spoken') return;
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
    if (code === 'unavailable') { voice.reply = 'Speech recognition is not available on this phone. Please install or update the Google app. You can type to me meanwhile.'; say(voice.reply, false); openTypebar(true); return; }
    if (code === 'tts') { voice.reply = 'My voice engine is not available on this phone.'; comp._paint(); return; }
    if (code === '1' || code === '2' || code === '4') { voice.reply = 'I could not hear you properly. Check the internet connection, or type to me.'; say(voice.reply, false); openTypebar(true); return; }
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
