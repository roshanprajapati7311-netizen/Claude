/* Mounts the Kaivra core full-screen and gives it a voice: it speaks, listens and replies.
   Native side (Android): window.KaivraNative.say/stop/vibrate/battery/openApp.
   Native events arrive at window.KaivraVoice.onEvent(type, text). */
(function () {
  'use strict';
  const ACCENT = '#4FD8C4'; // the design's colour; other options in the design: #FFB13B amber, #FF8A1F orange, #B98CFF violet
  const native = window.KaivraNative || null;
  const $ = (id) => document.getElementById(id);
  const btn = $('core-btn'), cv = $('cv');

  const comp = new Component({ accent: ACCENT });
  let V = comp.renderVals();
  V.canvasRef(cv);

  // ---------- conversation state ----------
  const voice = { mode: 'idle', heard: '', partial: '', reply: '' }; // mode: idle | speaking | listening | thinking
  let safety = null;

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
      $('state').textContent = voice.mode === 'speaking' ? 'SPEAKING' : voice.mode === 'thinking' ? 'THINKING' : 'LISTENING';
      const heard = voice.partial || voice.heard;
      if (heard || voice.reply) {
        $('card').style.display = 'block';
        $('hint').style.display = 'none';
        $('sel-layer').textContent = heard ? 'YOU' : 'KAIVRA';
        $('sel-name').textContent = heard ? '“' + heard + '”' : voice.reply;
        $('sel-desc').textContent = heard && voice.reply ? 'Kaivra: ' + voice.reply : '';
      }
    }
  };

  // ---------- speaking ----------
  function buzz(ms) {
    try { if (native && native.vibrate) native.vibrate(ms); else if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }
  function keepAlive() {
    if (safety) clearTimeout(safety);
    safety = setTimeout(() => { if (comp._activeT) sleep(false); }, native ? 30000 : 12000);
  }
  function say(text, listenAfter) {
    voice.reply = text;
    voice.mode = 'speaking';
    if (native && native.say) {
      try { native.say(text, !!listenAfter); } catch (e) {}
    } else {
      try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch (e) {}
    }
    keepAlive();
    comp._paint();
  }

  // ---------- waking and sleeping ----------
  const rawToggle = comp._toggle.bind(comp);
  function wake() {
    voice.heard = ''; voice.partial = ''; voice.reply = '';
    say('Kaivra online. How can I help?', true);
  }
  function sleep(spoken, letFinish) {
    if (safety) { clearTimeout(safety); safety = null; }
    if (!letFinish) { try { if (native && native.stop) native.stop(); } catch (e) {} }
    if (comp._activeT) rawToggle();
    if (comp._offTimer) { clearTimeout(comp._offTimer); comp._offTimer = null; }
    voice.mode = 'idle'; voice.heard = ''; voice.partial = '';
    if (spoken) { try { if (native && native.say) native.say('Standing by.', false); } catch (e) {} }
    buzz(12);
    comp._paint();
  }
  comp._toggle = function () {
    if (comp._activeT) { sleep(true); return; }
    rawToggle();
    if (comp._offTimer) { clearTimeout(comp._offTimer); comp._offTimer = null; } // Kaivra decides when to sleep
    buzz(28);
    wake();
  };

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
  const HELP = 'Right now I can tell you the time, the date and the battery, open apps on this phone, and show any part of my core, like memory or voice. Say stop when you are done.';

  function handle(raw) {
    const t = String(raw || '').toLowerCase().replace(/[.,!?]/g, ' ').replace(/\s+/g, ' ').trim();
    voice.heard = raw; voice.partial = '';
    if (!t) { say('I did not catch that. Please say it again.', true); return; }
    const has = (...ws) => ws.some((w) => t.includes(w));
    const word = (re) => re.test(t);

    if (/^(stop|sleep|bye|goodbye|cancel|nothing|that's all|that is all|go to sleep|standby|stand by)\b/.test(t) || has('go to sleep', 'stand by', 'standby', 'goodbye')) {
      voice.reply = 'Standing by.';
      sleep(true);
      return;
    }
    if (has('what time', 'the time', 'time is it') || t === 'time') {
      const d = new Date(), h = d.getHours() % 12 || 12;
      say('It is ' + h + ':' + pad(d.getMinutes()) + (d.getHours() < 12 ? ' AM.' : ' PM.'), true); return;
    }
    if (word(/\b(date|what day|which day|today)\b/)) {
      const d = new Date();
      say('Today is ' + DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + '.', true); return;
    }
    if (word(/\b(battery|charge|charging)\b/)) {
      let b = -1;
      try { if (native && native.battery) b = native.battery(); } catch (e) {}
      say(b >= 0 ? 'Battery is at ' + b + ' percent.' : 'I cannot read the battery here.', true); return;
    }
    if (has('your name', 'who are you', 'what are you')) { say('I am Kaivra, your personal assistant. I live on this phone and I answer only to you.', true); return; }
    if (has('who made you', 'who created you', 'who built you')) { say('You did. I am built from your own design, and my code lives on your GitHub.', true); return; }
    if (has('what can you do') || word(/\bhelp\b/)) { say(HELP, true); return; }
    if (has('how are you')) { say('All systems running. Ready when you are.', true); return; }
    if (has('thank')) { say('You are welcome.', true); return; }
    if (/^(hi|hello|hey|namaste|good morning|good evening|good night)\b/.test(t)) { say('Hello. I am listening.', true); return; }
    if (has('zoom out', 'reset', 'go back', 'full view', 'close it', 'close the')) { resetView(); say('Back to the full view.', true); return; }

    const m = t.match(/^(?:please\s+|can you\s+|kaivra\s+)?(open|launch|start|run|show me|show|go to|zoom into|zoom in on|zoom in to|take me to)\s+(.+)$/);
    if (m) {
      const verb = m[1], target = m[2].replace(/^(the|my)\s+/, '').replace(/\s+(app|application|please)$/, '').trim();
      const cat = comp._catalog();
      const viaApp = (strict) => { try { return native && native.openApp ? native.openApp(target, strict) : ''; } catch (e) { return ''; } };
      if (verb === 'open' || verb === 'launch' || verb === 'start' || verb === 'run') {
        let app = viaApp(true);
        if (app) { voice.reply = 'Opening ' + app + '.'; say(voice.reply, false); setTimeout(() => sleep(false, true), 600); return; }
        const c = findPart(target);
        if (c && showPart(c, verb === 'open')) { say((verb === 'open' && c !== 'core' ? 'Opening the ' + cat[c][1] + ' vault. ' : 'Here is ' + cat[c][1] + '. ') + cat[c][2], true); return; }
        app = viaApp(false);
        if (app) { voice.reply = 'Opening ' + app + '.'; say(voice.reply, false); setTimeout(() => sleep(false, true), 600); return; }
        say('I could not find an app or a part called ' + target + '.', true); return;
      }
      const c = findPart(target);
      if (c && showPart(c, false)) { say('Here is ' + cat[c][1] + '. ' + cat[c][2], true); return; }
      say('I could not find a part called ' + target + '.', true); return;
    }
    const c = findPart(t);
    if (c && has('show', 'where', 'what is', 'tell me about')) { showPart(c, false); say(comp._catalog()[c][1] + '. ' + comp._catalog()[c][2], true); return; }

    say('I heard you, but I cannot answer that yet, because my brain is not connected. For now I can do the time, the date, the battery, open apps and show my parts.', true);
  }

  // ---------- events from Android ----------
  window.KaivraVoice = {
    onEvent(type, text) {
      if (!comp._activeT && type !== 'spoken') return;
      keepAlive();
      if (type === 'speaking') voice.mode = 'speaking';
      else if (type === 'spoken') { if (voice.mode === 'speaking') voice.mode = comp._activeT ? 'listening' : 'idle'; }
      else if (type === 'listening') { voice.mode = 'listening'; voice.partial = ''; }
      else if (type === 'partial') { voice.partial = text; voice.reply = ''; voice.heard = ''; }
      else if (type === 'thinking') voice.mode = 'thinking';
      else if (type === 'result') { voice.mode = 'thinking'; handle(text); return; }
      else if (type === 'error') { onError(String(text)); return; }
      comp._paint();
    },
    handle: handle, // for testing: KaivraVoice.handle('what time is it')
  };
  let busyRetries = 0;
  function onError(code) {
    if (code === '5') return; // cancelled on purpose
    if (code === '6' || code === '7') { sleep(true); return; } // nothing was said
    if (code === '8' && busyRetries < 2) { busyRetries++; setTimeout(() => { try { native.listen(); } catch (e) {} }, 500); return; }
    busyRetries = 0;
    if (code === 'permission') { voice.reply = 'I need microphone permission to hear you.'; say(voice.reply, false); setTimeout(() => sleep(false, true), 4000); return; }
    if (code === 'unavailable') { voice.reply = 'Speech recognition is not available on this phone. Please install or update the Google app.'; say(voice.reply, false); setTimeout(() => sleep(false, true), 7000); return; }
    if (code === 'tts') { voice.reply = 'My voice engine is not available on this phone.'; comp._paint(); return; }
    if (code === '1' || code === '2' || code === '4') { voice.reply = 'I could not hear you properly. Check the internet connection.'; say(voice.reply, false); setTimeout(() => sleep(false, true), 5000); return; }
    voice.reply = 'Something went wrong with my hearing. Tap the core to try again.'; say(voice.reply, false); setTimeout(() => sleep(false, true), 5000);
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
})();
