/* Mounts the Kaivra core full-screen and gives it a voice: it speaks, listens, reads what you type and replies.
   Native side (Android): window.KaivraNative.* (say, listen, stop, nextVoice, accessStatus, requestAccess,
   call, text, control, torch, volume, vibrate, battery, openApp, version, setBrainKey, brainStatus, ask, openUrl).
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
  let nameSay = store.get('nameSay', 'Kye vrah'); // how the voice pronounces "Kaivra"
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
    const prov = brainProvider();
    $('brain-status').innerHTML = prov
      ? 'Connected · <b>' + (prov === 'claude' ? 'Claude' : 'Google Gemini') + '</b>. Kaivra can answer any question. Paste a new key to replace it, or save an empty box to disconnect.'
      : 'Not connected. With a free key, Kaivra can answer any question, explain things and help with your work.';
  }
  function requestAccess(key) {
    if (native && native.requestAccess) { try { native.requestAccess(key); } catch (e) {} }
  }
  function openAccess(open, focus) {
    if (open) { readAccess(); renderAccess(); }
    accessPanel.classList.toggle('open', open);
    if (open && focus === 'brain') setTimeout(() => { $('brain-sec').scrollIntoView({ block: 'start' }); $('brain-key').focus(); }, 60);
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
  $('brain-get').addEventListener('click', (e) => { e.preventDefault(); try { native.openUrl('https://aistudio.google.com/apikey'); } catch (err) { window.open('https://aistudio.google.com/apikey', '_blank'); } });
  $('brain-save').addEventListener('click', () => {
    const k = $('brain-key').value.trim();
    let prov = '';
    try { if (native && native.setBrainKey) prov = native.setBrainKey(k); } catch (e) {}
    $('brain-key').value = '';
    $('brain-key').blur();
    renderAccess();
    awake(true);
    voice.heard = '';
    say(prov ? 'My brain is connected. Ask me anything.' : 'My online brain is disconnected.', false);
  });

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

  // ---------- the online brain (Gemini or Claude, through Android) ----------
  const brain = { id: 0, waiting: 0, typed: false, history: [] };
  function brainProvider() { try { return native && native.brainStatus ? native.brainStatus() : ''; } catch (e) { return ''; } }
  function systemPrompt() {
    const d = new Date();
    return [
      'You are Kaivra, a personal AI assistant that lives on your owner\'s Android phone as a holographic core. Your owner built you, and you are loyal only to them.',
      'Be warm, confident and direct, like a capable assistant inspired by Jarvis but with your own character.',
      'Your replies are spoken aloud by a text-to-speech voice, so answer in one to three short sentences unless the owner asks for detail or a longer piece, and then keep it as short as the task allows.',
      'Use plain sentences only: no markdown, bullet lists, emojis, tables or code blocks.',
      'Reply in the language the owner uses: English, Hindi or Bengali; Hinglish is fine.',
      'The app handles these commands itself, so if the owner asks for one, tell them the exact words to say: "what time is it", "battery", "open" plus an app name, "call" plus a name, "text" plus a name and "saying" plus the message, "go home", "open notifications", "lock the phone", "take a screenshot", "torch on" or "torch off", "volume up" or "volume down", "show me" plus a part of your core, "change voice", "mute".',
      'You cannot yet set reminders, read messages, see the screen or browse the web; say so plainly instead of pretending.',
      'Current date and time: ' + d.toDateString() + ', ' + d.toLocaleTimeString() + '.'
    ].join(' ');
  }
  function askBrain(text, typed) {
    const answer = (t) => say(t, !typed);
    if (!brainProvider()) {
      openAccess(true, 'brain');
      answer('My online brain is not connected yet, so I only know my built-in commands. Paste a free Gemini key in the brain box, and I will be able to answer anything.');
      return;
    }
    brain.history.push({ role: 'user', text: text });
    while (brain.history.length > 12 || (brain.history.length && brain.history[0].role !== 'user')) brain.history.shift();
    brain.id += 1; brain.waiting = brain.id; brain.typed = !!typed;
    voice.mode = 'thinking'; voice.reply = '';
    keepAlive(); comp._paint();
    try { native.ask(JSON.stringify({ id: brain.id, system: systemPrompt(), history: brain.history })); }
    catch (e) { brain.waiting = 0; brain.history.pop(); answer('I could not reach my online brain.'); }
  }
  const BRAIN_ERRORS = {
    nokey: 'My online brain is not connected. Add a key in the Access screen.',
    badkey: 'That brain key did not work. Check it in the Access screen.',
    limit: 'I have used up the free limit for now. Try again in a minute.',
    credit: 'The Claude account for my brain has no credit left.',
    network: 'I could not reach my online brain. Check the internet connection.',
    empty: 'My brain had nothing to say to that. Try asking another way.',
    model: 'My online brain is not available right now. Try again a little later.',
    server: 'My online brain had a problem. Try again in a moment.'
  };
  function onBrain(json) {
    let r = {};
    try { r = JSON.parse(json); } catch (e) {}
    if (!brain.waiting || (r.id && r.id !== brain.waiting)) return; // an older question, or a command came in meanwhile
    brain.waiting = 0;
    const answer = (t) => say(t, !brain.typed);
    if (r.ok && r.text) {
      const text = String(r.text).replace(/\*\*|__|[*#`>~]/g, '').replace(/^\s*[-•]\s+/gm, '').trim();
      brain.history.push({ role: 'assistant', text: text });
      answer(text);
      return;
    }
    if (brain.history.length && brain.history[brain.history.length - 1].role === 'user') brain.history.pop();
    if (r.error === 'nokey' || r.error === 'badkey') openAccess(true, 'brain');
    answer(BRAIN_ERRORS[r.error] || BRAIN_ERRORS.server);
  }

  // ---------- Kaivra's built-in brain (offline, simple commands) ----------
  const pad = (n) => String(n).padStart(2, '0');
  const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const HELP = 'I can tell you the time, the date and the battery, open any app, call or text your contacts, go home, open notifications, lock the phone, take a screenshot, turn the torch on or off, change the volume, and show any part of my core. With my online brain connected, you can also ask me anything. Say change voice to hear another voice, or stop when you are done.';
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
    if (word(/^(connect|add|set up|setup)( (your|the|my|online))* brain\b/) || word(/^brain (key|setup|settings)$/)) {
      openAccess(true, 'brain');
      answer(brainProvider() ? 'My brain is already connected. You can paste a new key to replace it.' : 'Paste a free Gemini key in the brain box, then tap save.');
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
