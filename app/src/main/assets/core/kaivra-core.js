/* Kaivra core: from the "Kaivra Home Screen" design, moved into the app unchanged. */
class Component extends DCLogic {
  componentDidMount() {
    this._yaw = 0; this._pitch = 0.06; this._vy = 0; this._vp = 0; this._dist = 4.6; this._distTarget = null;
    this._T = [0, 0, 0]; this._focus = null;
    this._open = null; this._openT = 0; this._fileSel = null; this._tree = null; this._filePicks = [];
    this._pan = [0, 0]; this._tabOpen = {}; this._tabMode = 'beside'; this._fileOpen = null; this._uiHits = []; this._fit = 0.076; this._kT = 100;
    this._o = 0; this._t = 0; this._w = 0; this._touched = false;
    this._dragging = false; this._dragMoved = 0; this._ptrs = {}; this._pinchD = 0;
    this._picks = []; this._coreHit = null;
    this._vf = null; this._vk = null; this._partBase = null; this._focusBase = null;
    let reduced = false;
    try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { reduced = false; }
    this._reduced = reduced;
    if (!this._geo) this._build();
    let last = 0, lastDraw = 0;
    const loop = (now) => {
      this._raf = requestAnimationFrame(loop);
      if (!last) { last = now; lastDraw = now; return; }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this._step(dt);
      if (now - lastDraw >= 22) { lastDraw = now; this._draw(); }
    };
    this._raf = requestAnimationFrame(loop);
  }

  componentWillUnmount() {
    if (this._raf) cancelAnimationFrame(this._raf);
    if (this._offTimer) clearTimeout(this._offTimer);
  }

  _catalog() {
    if (this._cat) return this._cat;
    const L0 = 'LAYER 0 · CORE', L1 = 'LAYER 1 · DATA', L2 = 'LAYER 2 · FRAMEWORK', L3 = 'LAYER 3 · GUARD';
    const BA = 'BELT A · PLUGINS', BB = 'BELT B · AGENTS', BC = 'BELT C · DEVICES & LINKS';
    this._cat = {
      core: [L0, 'Kaivra Core', 'The brain router (offline, online, auto), your rulebook and Kaivra’s identity. Everything else plugs into this.', ['router', 'rulebook', 'identity']],
      memory: [L1, 'Memory', 'What Kaivra knows about you and your projects, stored on this phone.', ['memory_store', 'recall', 'forget']],
      library: [L1, 'Knowledge Library', 'Everything Learn mode gathered, one section per project, with sources.', ['learn_mode', 'crawler', 'summarizer']],
      skills: [L1, 'Skills', 'Step-by-step routines Kaivra worked out or you taught it, reused on command.', ['skill_runner', 'skill_recorder']],
      lessons: [L1, 'Training Lessons', 'Your corrections and new knowledge, packed for training the brain’s add-on.', ['lesson_packer', 'trainer_link']],
      soulpack: [L1, 'Soul Pack', 'Encrypted export of rulebook, memory, library and skills for moving to new devices.', ['exporter', 'importer']],
      voice: [L2, 'Voice Engine', 'Wake word, speech-to-text and Kaivra’s voice, all running offline.', ['wake_word', 'speech_to_text', 'voice_out']],
      voicelock: [L2, 'Voice Lock', 'Checks every command is your voice; a passphrase guards power actions.', ['voiceprint', 'passphrase']],
      brains: [L2, 'Brain Models', 'The small offline model on the phone and the link to the online model.', ['offline_brain', 'online_link', 'brain_switch']],
      hands: [L2, 'Phone Control', 'Accessibility service and Android intents: taps, typing, calls and texts.', ['accessibility', 'intents', 'screen_reader']],
      masterkey: [L2, 'Master Key', 'Shizuku access that lets Kaivra grant its own permissions after one setup.', ['shizuku_bridge', 'permission_granter']],
      changes: [L2, 'Change Log & Undo', 'Every self-change is recorded and the previous version kept.', ['change_log', 'undo']],
      guard: [L3, 'Security Guard', 'Watches new apps, unlock attempts, updates and devices on your Wi-Fi.', ['app_watch', 'unlock_watch', 'wifi_watch']],
      perms: [L3, 'Permission Watch', 'Flags risky permissions and takes them back from apps you don’t trust.', ['permission_scan', 'revoker']],
      encrypt: [L3, 'Encryption', 'Keeps the soul pack and logs unreadable to anyone but you.', ['vault', 'keys']],
      heartbeat: [L3, 'Heartbeat', 'Alerts you if listening or guarding ever stops.', ['heartbeat', 'alerts']],
      p_calls: [BA, 'Calls & SMS', 'Places calls and sends texts by voice, even while the phone is locked.', ['calls', 'sms']],
      p_email: [BA, 'Email', 'Reads, drafts and sends email on your command.', ['mail_reader', 'mail_sender']],
      p_whatsapp: [BA, 'WhatsApp', 'Sends and reads messages through the phone-control layer.', ['whatsapp_bridge', 'chat_parser']],
      p_music: [BA, 'Music', 'Plays, pauses and picks music by voice.', ['player_control', 'queue']],
      p_remind: [BA, 'Reminders & Alarms', 'Sets reminders, alarms and timers.', ['reminders', 'alarms']],
      p_reels: [BA, 'Reel Editor', 'Example of a plugin Kaivra writes for itself on your order.', ['reel_editor', 'timeline', 'beat_sync']],
      p_learn: [BA, 'Learn Crawler', 'Searches and reads the web for Learn mode.', ['web_search', 'page_reader']],
      p_build: [BA, 'Code Builder', 'Edits Kaivra’s own code on GitHub and builds the new version.', ['github_client', 'apk_builder']],
      a_research: [BB, 'Agent · Researcher', 'A crew member the commander creates to dig up information.', ['agent', 'tasks']],
      a_script: [BB, 'Agent · Scriptwriter', 'A crew member for writing scripts and text.', ['agent', 'tasks']],
      a_design: [BB, 'Agent · Designer', 'A crew member for visuals and layouts.', ['agent', 'tasks']],
      a_edit: [BB, 'Agent · Editor', 'A crew member that checks and polishes the team’s work.', ['agent', 'tasks']],
      a_team: [BB, 'Learning Team', 'A permanent crew that keeps your project libraries up to date.', ['team', 'schedule']],
      d_phone: [BC, 'This Phone', 'Infinix Note 50x 5G: Kaivra’s current body.', ['device_body', 'sensors']],
      d_pc: [BC, 'Paired PC', 'A future body with a bigger offline brain.', ['pairing', 'remote_brain']],
      d_tv: [BC, 'Android TV', 'A paired screen Kaivra can control.', ['pairing', 'tv_control']],
      d_cloud: [BC, 'Online Brain Link', 'Connection to the cloud model for heavy jobs.', ['api_client', 'quota']],
      d_github: [BC, 'GitHub Builds', 'Where Kaivra’s code lives and new versions are built.', ['repo_sync', 'build_watch']],
      d_colab: [BC, 'Cloud GPU Training', 'Free cloud GPU used to train the brain’s add-on.', ['colab_runner', 'adapter_fetch']]
    };
    return this._cat;
  }

  _files(c) {
    const cat = this._catalog()[c];
    if (!cat) return null;
    const layerSlug = cat[0].split('·')[1].trim().toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, '');
    const base = '/kaivra/' + layerSlug + '/' + c + '/';
    let hs = 0;
    for (let i = 0; i < c.length; i++) hs = (hs * 31 + c.charCodeAt(i)) | 0;
    const hsh = (n) => { const v = Math.sin(hs * 0.013 + n * 12.9898) * 43758.5453; return v - Math.floor(v); };
    const pascal = (s) => s.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    const camel = (s) => { const p = pascal(s); return p.charAt(0).toLowerCase() + p.slice(1); };
    const stamp = (n) => '20 Nov 2026, ' + (20 + Math.floor(hsh(n) * 4)) + ':' + String(10 + Math.floor(hsh(n + 50) * 49));
    const bytes = (lines) => lines.reduce((a, l) => a + l.length + 1, 0);
    const kb = (b) => (b < 1024 ? b + ' B' : (b / 1024).toFixed(1) + ' KB');
    const dart = (stem) => [
      '// ' + cat[1] + ' · ' + stem + '.dart',
      '// Part of Kaivra ' + cat[0].toLowerCase(),
      "import 'package:kaivra/core.dart';",
      "import 'package:kaivra/rulebook.dart';",
      '',
      'class ' + pascal(stem) + ' {',
      '  final Rulebook rules;',
      '  final Bus bus;',
      '  ' + pascal(stem) + '(this.rules, this.bus);',
      '',
      '  Future<void> start() async {',
      "    if (!rules.allows('" + c + '.' + stem + "')) return;",
      '    bus.on(Event.command, handle);',
      '    await bus.emit(Event.' + camel(stem) + 'Ready);',
      '  }',
      '',
      '  Future<Result> handle(Command cmd) async {',
      '    final ctx = await Memory.recall(cmd.topic);',
      "    Log.write('" + stem + "', cmd.text);",
      '    return Result.ok(ctx);',
      '  }',
      '}'
    ];
    const json = () => [
      '{',
      '  "component": "' + c + '",',
      '  "name": "' + cat[1] + '",',
      '  "layer": "' + cat[0] + '",',
      '  "enabled": true,',
      '  "brain": "auto",',
      '  "needs_unlock": ' + (hsh(3) > 0.6 ? 'true' : 'false') + ',',
      '  "confirm_before": ["delete", "pay"],',
      '  "version": "0.1.' + Math.floor(hsh(4) * 90 + 10) + '"',
      '}'
    ];
    const md = (stems) => {
      const out = ['# ' + cat[1], ''];
      let cur = '';
      cat[2].split(' ').forEach((wd) => { if ((cur + ' ' + wd).trim().length > 46) { out.push(cur.trim()); cur = wd; } else cur += ' ' + wd; });
      if (cur.trim()) out.push(cur.trim());
      out.push('', '## Files');
      stems.forEach((s) => out.push('- src/' + s + '.dart'));
      out.push('- data/' + c + '.db', '- data/state.json', '- config.json', '', '## Owner', 'Only you. Rules come from', 'your rulebook.');
      return out;
    };
    const hex = (seed) => {
      const out = [];
      for (let r = 0; r < 22; r++) {
        let line = (r * 16).toString(16).padStart(6, '0') + '  ';
        let asc = '';
        for (let b = 0; b < 16; b++) {
          const v = r === 0 && b < 6 ? [75, 65, 73, 86, 82, 65][b] : Math.floor(hsh(seed + r * 16 + b) * 256);
          line += v.toString(16).padStart(2, '0').toUpperCase() + (b === 7 ? '  ' : ' ');
          asc += v >= 32 && v < 127 ? String.fromCharCode(v) : '.';
        }
        out.push(line + ' ' + asc);
      }
      return out;
    };
    const state = () => ['{', '  "running": true,', '  "last_event": "' + stamp(9) + '",', '  "errors": 0,', '  "queue": ' + Math.floor(hsh(10) * 9) + '', '}'];
    const offsOf = (lines) => { const o = []; let acc = 0; lines.forEach((l) => { o.push(acc); acc += l.length + 1; }); return o; };
    const mk = (name, folder, type, lines, purpose, n, size) => ({ name: name, path: base + folder + name, type: type, lines: lines, offs: offsOf(lines), nLines: lines.length, size: size || kb(bytes(lines)), updated: stamp(n), purpose: purpose });
    const stems = cat[3];
    const src = stems.map((s, i) => mk(s + '.dart', 'src/', 'Dart source', dart(s), 'Source code for ' + pascal(s) + ', part of ' + cat[1] + '.', i + 1));
    const data = [
      mk(c + '.db', 'data/', 'Database', hex(77), 'Stored records for ' + cat[1] + ', encrypted at rest.', 20, Math.floor(40 + hsh(21) * 900) + ' KB'),
      mk('state.json', 'data/', 'JSON data', state(), 'Live state of ' + cat[1] + ' right now.', 22)
    ];
    const rootFiles = [
      mk('config.json', '', 'JSON settings', json(), 'Settings for ' + cat[1] + ', controlled by your rulebook.', 30),
      mk('README.md', '', 'Markdown', md(stems), 'Overview of ' + cat[1] + ' and its files.', 31)
    ];
    const folders = [{ name: 'src/', items: src }, { name: 'data/', items: data }, { name: '/', items: rootFiles, isRoot: true }];
    const nSlots = Math.max(src.length, data.length, rootFiles.length);
    const PITCH = 0.05, BH = 0.042, BW = 0.054, RW = 0.064;
    const colA = [-0.075, 0, 0.075];
    const top = 0.125, hub0 = 0.097, hd1 = 0.085, hd0 = 0.062, slot0 = 0.052;
    const bot = slot0 - (nSlots - 1) * PITCH - BH;
    const mid = (top + bot) / 2;
    const nodes = [];
    nodes.push({ kind: 'root', name: c + '/', path: base, count: src.length + data.length + rootFiles.length, a0: -0.11, a1: 0.11, b0: hub0 - mid, b1: top - mid, h0: -0.05, h1: -0.014 });
    folders.forEach((fd, fi) => {
      const ac = colA[fi];
      nodes.push({ kind: 'folder', name: fd.isRoot ? '/ root' : fd.name, path: fd.isRoot ? base : base + fd.name, count: fd.items.length, parent: 0, col: fi, a0: ac - RW / 2, a1: ac + RW / 2, b0: hd0 - mid, b1: hd1 - mid, h0: -0.05, h1: -0.02, rb0: bot - 0.006 - mid, rb1: hd0 - 0.003 - mid });
      const pIdx = nodes.length - 1;
      fd.items.forEach((f, k) => {
        const b1 = slot0 - k * PITCH - mid;
        nodes.push({ kind: 'file', file: f, name: f.name, parent: pIdx, col: fi, slot: k, a0: ac - BW / 2, a1: ac + BW / 2, b0: b1 - BH, b1: b1, h0: -0.047, h1: -0.016 });
      });
    });
    return { comp: c, base: base, nodes: nodes, nSlots: nSlots, colA: colA, slotTop: slot0 - mid, pitch: PITCH, bh: BH, ext: { a0: -0.125, a1: 0.125, b0: bot - 0.014 - mid, b1: top + 0.014 - mid } };
  }

  _math() {
    if (this._h) return this._h;
    const axisAngle = (n, a) => {
      const c = Math.cos(a), s = Math.sin(a), t = 1 - c, x = n[0], y = n[1], z = n[2];
      return [t * x * x + c, t * x * y - s * z, t * x * z + s * y, t * x * y + s * z, t * y * y + c, t * y * z - s * x, t * x * z - s * y, t * y * z + s * x, t * z * z + c];
    };
    const mm = (A, B) => {
      const o = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[i * 3 + j] = A[i * 3] * B[j] + A[i * 3 + 1] * B[3 + j] + A[i * 3 + 2] * B[6 + j];
      return o;
    };
    const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
    const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
    const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    const ap = (M, p) => [M[0] * p[0] + M[1] * p[1] + M[2] * p[2], M[3] * p[0] + M[4] * p[1] + M[5] * p[2], M[6] * p[0] + M[7] * p[1] + M[8] * p[2]];
    this._h = { axisAngle: axisAngle, mm: mm, rotY: rotY, rotZ: rotZ, norm: norm, ap: ap };
    return this._h;
  }

  _build() {
    const H = this._math();
    let seed = 5512093;
    const rng = () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
    let uid = 1;
    const R = (d) => (d * Math.PI) / 180;
    const TAU = Math.PI * 2;
    const randAxis = () => {
      const u = rng() * 2 - 1, th = rng() * TAU, s = Math.sqrt(1 - u * u);
      return [s * Math.cos(th), u, s * Math.sin(th)];
    };
    const sph = (r, lat, lon) => [r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon)];
    const tile = (r, la1, la2, lo1, lo2, c) => {
      const k = 3, pts = [];
      for (let i = 0; i < k; i++) pts.push(sph(r, la1, lo1 + ((lo2 - lo1) * i) / k));
      for (let i = 0; i < k; i++) pts.push(sph(r, la1 + ((la2 - la1) * i) / k, lo2));
      for (let i = 0; i < k; i++) pts.push(sph(r, la2, lo2 - ((lo2 - lo1) * i) / k));
      for (let i = 0; i < k; i++) pts.push(sph(r, la2 - ((la2 - la1) * i) / k, lo1));
      const o = { pts: pts, closed: true };
      if (c) { o.c = c; o.id = uid++; o.cn = [sph(r, la1, lo1), sph(r, la1, lo2), sph(r, la2, lo2), sph(r, la2, lo1)]; o.nm = null; }
      return o;
    };
    const latLine = (r, la, lo1, lo2) => {
      const n = Math.max(2, Math.ceil(Math.abs(lo2 - lo1) / R(4))), pts = [];
      for (let i = 0; i <= n; i++) pts.push(sph(r, la, lo1 + ((lo2 - lo1) * i) / n));
      return { pts: pts, closed: false };
    };
    const lonLine = (r, lo, la1, la2) => {
      const n = Math.max(2, Math.ceil(Math.abs(la2 - la1) / R(4))), pts = [];
      for (let i = 0; i <= n; i++) pts.push(sph(r, la1 + ((la2 - la1) * i) / n, lo));
      return { pts: pts, closed: false };
    };
    const subLayers = (r) => {
      const nodes = [];
      for (let i = 0; i < 110; i++) { const d = randAxis(); nodes.push([d[0] * r * 0.94, d[1] * r * 0.94, d[2] * r * 0.94]); }
      const links = [];
      for (let i = 0; i < nodes.length; i++) {
        let b1 = -1, b2 = -1, d1 = 1e9, d2 = 1e9;
        for (let j = 0; j < nodes.length; j++) {
          if (i === j) continue;
          const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1], nodes[i][2] - nodes[j][2]);
          if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = j; } else if (d < d2) { d2 = d; b2 = j; }
        }
        if (b1 > i) links.push({ pts: [nodes[i], nodes[b1]], closed: false });
        if (b2 > i) links.push({ pts: [nodes[i], nodes[b2]], closed: false });
      }
      const grid = [];
      [-50, -25, 0, 25, 50].forEach((la) => grid.push(latLine(r * 0.88, R(la), 0, TAU)));
      for (let i = 0; i < 8; i++) grid.push(lonLine(r * 0.88, (i / 8) * TAU, R(-80), R(80)));
      const inner = [];
      for (let la = -60; la < 60; la += 20) {
        for (let lo = 0; lo < 360; lo += 30) {
          if (rng() < 0.35) inner.push(tile(r * 0.82, R(la + 2), R(la + 16), R(lo + 3), R(lo + 24), null));
        }
      }
      return { nodes: nodes, links: links, grid: grid, inner: inner };
    };
    const shell = (r, keep, speed, comps) => {
      const polys = [], cells = [], lit = [];
      for (let la = -72; la < 72; la += 12) {
        const nLon = Math.max(6, Math.round(26 * Math.cos(R(la + 6))));
        const dLon = 360 / nLon;
        const off = rng() * dLon;
        for (let j = 0; j < nLon; j++) {
          if (rng() > keep) continue;
          let span = dLon;
          if (rng() < 0.3) { span = dLon * 2; j++; }
          const lo1 = R(off + j * dLon), lo2 = lo1 + R(span);
          const la1 = R(la), la2 = R(la + 12);
          const mLa = (la2 - la1) * 0.08, mLo = (lo2 - lo1) * 0.06;
          let rj = r + (rng() - 0.5) * 0.04;
          if (rng() < 0.15) rj += 0.04 + rng() * 0.04;
          const a1 = la1 + mLa, a2 = la2 - mLa, b1 = lo1 + mLo, b2 = lo2 - mLo;
          let frac = (((b1 + b2) / 2) % TAU) / TAU;
          if (frac < 0) frac += 1;
          const c = comps[Math.min(comps.length - 1, Math.floor(frac * comps.length))];
          if (rng() < 0.3) {
            const am = (a1 + a2) / 2;
            polys.push(tile(rj, a1, am - R(0.6), b1, b2, c));
            polys.push(tile(rj, am + R(0.6), a2, b1, b2, c));
          } else {
            polys.push(tile(rj, a1, a2, b1, b2, c));
          }
          if (rng() < 0.6) {
            if (rng() < 0.5) cells.push(latLine(rj, (a1 + a2) / 2, b1, b2));
            else cells.push(lonLine(rj, (b1 + b2) / 2, a1, a2));
          }
          if (rng() < 0.35) {
            const x1 = b1 + (b2 - b1) * rng() * 0.7, y1 = a1 + (a2 - a1) * rng() * 0.7;
            lit.push(tile(rj + 0.002, y1, y1 + (a2 - a1) * 0.25, x1, x1 + (b2 - b1) * 0.22, null));
          }
        }
      }
      return { r: r, axis: randAxis(), speed: speed, polys: polys, cells: cells, lit: lit, sub: subLayers(r) };
    };

    const shells = [
      shell(0.98, 0.3, 0.06, ['guard', 'perms', 'encrypt', 'heartbeat']),
      shell(0.78, 0.4, -0.1, ['voice', 'voicelock', 'brains', 'hands', 'masterkey', 'changes']),
      shell(0.58, 0.38, 0.16, ['memory', 'library', 'skills', 'lessons', 'soulpack'])
    ];

    const planet = [];
    [-60, -30, 0, 30, 60].forEach((la) => planet.push(latLine(0.3, R(la), 0, TAU)));
    for (let i = 0; i < 6; i++) planet.push(lonLine(0.3, (i / 6) * TAU, R(-85), R(85)));

    const P = 1.618034, LN = Math.sqrt(1 + P * P);
    const iv = [[-1, P, 0], [1, P, 0], [-1, -P, 0], [1, -P, 0], [0, -1, P], [0, 1, P], [0, -1, -P], [0, 1, -P], [P, 0, -1], [P, 0, 1], [-P, 0, -1], [-P, 0, 1]].map((v) => v.map((c) => (c / LN) * 0.1));
    const nucleus = [];
    for (let i = 0; i < iv.length; i++) for (let j = i + 1; j < iv.length; j++) {
      const d = Math.hypot(iv[i][0] - iv[j][0], iv[i][1] - iv[j][1], iv[i][2] - iv[j][2]);
      if (Math.abs(d - (2 / LN) * 0.1) < 0.004) nucleus.push({ pts: [iv[i], iv[j]], closed: false });
    }

    const ringPts = (r, a1, a2) => {
      const n = Math.max(2, Math.ceil(Math.abs(a2 - a1) / R(4))), pts = [];
      for (let i = 0; i <= n; i++) { const a = a1 + ((a2 - a1) * i) / n; pts.push([r * Math.cos(a), 0, r * Math.sin(a)]); }
      return { pts: pts, closed: false };
    };
    const rings = [[0.66, false, 0.5], [0.88, true, -0.35], [1.02, false, 0.25]].map((d) => {
      const polys = [];
      if (d[1]) { for (let i = 0; i < 64; i++) { const a = (i / 64) * TAU; polys.push(ringPts(d[0], a, a + R(2.5))); } }
      else polys.push(ringPts(d[0], 0, TAU));
      return { polys: polys, tilt: H.axisAngle(randAxis(), 0.4 + rng() * 1.0), sp: d[2] };
    });
    const brightArc = [ringPts(0.66, 0, R(190))];
    const microRings = [0.14, 0.18, 0.22].map((r) => ({ polys: [ringPts(r, 0, TAU)], tilt: H.axisAngle(randAxis(), rng() * Math.PI), sp: 0.6 + rng() }));

    const streaks = [];
    for (let i = 0; i < 20; i++) {
      const tilt = H.axisAngle(randAxis(), rng() * Math.PI);
      const r = 0.4 + rng() * 0.6, a = rng() * TAU, l = R(10 + rng() * 40);
      const seg = ringPts(r, a, a + l);
      seg.pts = seg.pts.map((p) => H.ap(tilt, p));
      streaks.push(seg);
    }

    const panelZ = (r1, r2, a1, a2, z0, tk, c) => {
      const rm = (r1 + r2) / 2, pts = [];
      const zr = (r) => z0 + (r - rm) * tk;
      const n = Math.max(2, Math.ceil(Math.abs(a2 - a1) / R(3.5)));
      for (let i = 0; i <= n; i++) { const a = a1 + ((a2 - a1) * i) / n; pts.push([r2 * Math.cos(a), r2 * Math.sin(a), zr(r2)]); }
      for (let i = n; i >= 0; i--) { const a = a1 + ((a2 - a1) * i) / n; pts.push([r1 * Math.cos(a), r1 * Math.sin(a), zr(r1)]); }
      const o = { pts: pts, closed: true };
      if (c) { o.c = c; o.id = uid++; o.nm = [0, 0, 1]; o.cn = [[r2 * Math.cos(a1), r2 * Math.sin(a1), zr(r2)], [r2 * Math.cos(a2), r2 * Math.sin(a2), zr(r2)], [r1 * Math.cos(a2), r1 * Math.sin(a2), zr(r1)], [r1 * Math.cos(a1), r1 * Math.sin(a1), zr(r1)]]; }
      return o;
    };
    const belt = (tilt, spin, rIn, rOut, count, coverage, comps, longs) => {
      const polys = [], cells = [], lit = [];
      const start = rng() * TAU, unit = TAU / count;
      for (let i = 0; i < count; i++) {
        if (rng() > coverage) continue;
        const a = start + i * unit + (rng() - 0.5) * unit * 0.2;
        const len = unit * (0.55 + rng() * 0.4);
        const c = comps[Math.min(comps.length - 1, Math.floor((i / count) * comps.length))];
        const r1 = rIn + (rng() - 0.5) * 0.03;
        const r2 = rOut + (rng() - 0.5) * 0.04 + (rng() < 0.25 ? 0.05 : 0);
        const z0 = (rng() - 0.5) * 0.06, tk = (rng() - 0.5) * 0.5;
        if (rng() < 0.35) {
          const m = (r1 + r2) / 2;
          polys.push(panelZ(r1, m - 0.006, a, a + len, z0, tk, c));
          polys.push(panelZ(m + 0.006, r2, a, a + len, z0, tk, c));
        } else {
          polys.push(panelZ(r1, r2, a, a + len, z0, tk, c));
        }
        if (rng() < 0.3) polys.push(panelZ(r2 + 0.01, r2 + 0.03 + rng() * 0.05, a + len * 0.2, a + len * (0.5 + rng() * 0.4), z0 - 0.02, tk, c));
        const rm = (r1 + r2) / 2;
        for (let q = a + R(3); q < a + len - R(1); q += R(3 + rng() * 3)) {
          cells.push({ pts: [[r1 * Math.cos(q), r1 * Math.sin(q), z0 + (r1 - rm) * tk], [r2 * Math.cos(q), r2 * Math.sin(q), z0 + (r2 - rm) * tk]], closed: false });
        }
        if (rng() < 0.6) {
          const cr = r1 + (r2 - r1) * (0.25 + rng() * 0.45), ca = a + rng() * Math.max(R(1), len - R(3));
          lit.push(panelZ(cr, cr + 0.02, ca, ca + R(1.5 + rng() * 2.5), z0 + 0.004, tk, null));
        }
      }
      longs.forEach((g) => {
        const a = R(g[0]), rs = rOut - 0.02, L = g[1], wd = g[2], z = g[3], c = g[4], tk = (rng() - 0.5) * 0.3;
        const ux = Math.cos(a), uy = Math.sin(a), vx = -Math.sin(a), vy = Math.cos(a);
        const Pp = (r, q) => [ux * r + vx * q, uy * r + vy * q, z + (r - rs) * tk];
        const hw = wd / 2, ins = 0.014;
        const corners = [Pp(rs, -hw), Pp(rs + L, -hw), Pp(rs + L, hw), Pp(rs, hw)];
        polys.push({ pts: corners, closed: true, c: c, id: uid++, nm: [0, 0, 1], cn: corners });
        cells.push({ pts: [Pp(rs + ins, -hw + ins), Pp(rs + L - ins, -hw + ins), Pp(rs + L - ins, hw - ins), Pp(rs + ins, hw - ins)], closed: true });
        cells.push({ pts: [Pp(rs, 0), Pp(rs + L, 0)], closed: false });
        for (let d = 0.05; d < L - 0.02; d += 0.045 + rng() * 0.03) cells.push({ pts: [Pp(rs + d, -hw), Pp(rs + d, hw)], closed: false });
        for (let q = 0; q < 3; q++) {
          if (rng() < 0.65) {
            const d = rng() * Math.max(0.01, L - 0.06), t0 = (rng() - 0.5) * Math.max(0.01, wd - 0.03);
            lit.push({ pts: [Pp(rs + d, t0), Pp(rs + d + 0.025, t0), Pp(rs + d + 0.025, t0 + 0.02), Pp(rs + d, t0 + 0.02)], closed: true });
          }
        }
      });
      return { tilt: tilt, spin: spin, polys: polys, cells: cells, lit: lit };
    };

    const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const belts = [
      belt(I, 0.035, 1.06, 1.2, 34, 0.9, ['p_calls', 'p_email', 'p_whatsapp', 'p_music', 'p_remind', 'p_reels', 'p_learn', 'p_build'], [
        [84, 0.42, 0.13, -0.06, 'p_build'], [92, 0.6, 0.16, -0.1, 'p_learn'], [100, 0.36, 0.12, 0.04, 'p_reels'], [74, 0.28, 0.09, 0.06, 'p_build'],
        [268, 0.5, 0.13, -0.05, 'p_calls'], [284, 0.56, 0.14, 0.05, 'p_email'], [254, 0.28, 0.09, -0.03, 'p_music'],
        [176, 0.18, 0.08, 0, 'p_remind'], [6, 0.13, 0.07, 0, 'p_whatsapp']
      ]),
      belt(H.axisAngle([1, 0, 0], 1.15), -0.06, 1.12, 1.24, 22, 0.75, ['a_research', 'a_script', 'a_design', 'a_edit', 'a_team'], [[40, 0.22, 0.09, 0, 'a_team'], [220, 0.2, 0.08, 0, 'a_research']]),
      belt(H.mm(H.axisAngle([0, 1, 0], 1.25), H.axisAngle([1, 0, 0], 0.55)), 0.09, 1.17, 1.27, 18, 0.7, ['d_phone', 'd_pc', 'd_tv', 'd_cloud', 'd_github', 'd_colab'], [[130, 0.2, 0.08, 0, 'd_cloud']])
    ];

    const shards = [];
    [[18, 1.5, 0.05], [205, 1.48, -0.04]].forEach((s) => shards.push({ a: R(s[0]), r: s[1], z: s[2], w: 0.3, h: 0.13, ax: randAxis(), ph: rng() * TAU }));

    const strands = [];
    for (let k = 0; k < 10; k++) strands.push({ ax: rng() * Math.PI, ay: rng() * Math.PI, rs: 0.8 + rng() * 0.45, ph: rng() * TAU, w: 0.8 + rng() * 1.4, wh: 0.2 + rng() * 0.6 });

    const sparks = [];
    for (let i = 0; i < 380; i++) sparks.push({ d: randAxis(), r: 0.3 + Math.pow(rng(), 0.75) * 1.45, sz: 0.6 + rng() * 1.6, f: 0.8 + rng() * 3, ph: rng() * TAU, v: 0.02 + rng() * 0.08 });

    this._geo = { shells: shells, planet: planet, planetAxis: randAxis(), nucleus: nucleus, nucleusAxis: randAxis(), microRings: microRings, rings: rings, brightArc: brightArc, streaks: streaks, streakAxis: randAxis(), belts: belts, shards: shards, strands: strands, sparks: sparks };
    this._tmp = new Float32Array(1024);
  }

  _layerMats() {
    const Hm = this._math(), g = this._geo, w = this._w, out = {};
    g.shells.forEach((sh, i) => { out['s' + i] = Hm.axisAngle(sh.axis, sh.speed * w); });
    g.belts.forEach((b, i) => { out['b' + i] = Hm.mm(b.tilt, Hm.rotZ(b.spin * w)); });
    return out;
  }

  _polyRef(ref) {
    if (!ref) return null;
    const g = this._geo;
    const layer = ref.k.charAt(0) === 's' ? g.shells[+ref.k.slice(1)] : g.belts[+ref.k.slice(1)];
    return layer ? layer.polys[ref.i] : null;
  }

  _vaultFrame(ref) {
    const Hm = this._math();
    const poly = this._polyRef(ref);
    const M = this._layerMats()[ref.k];
    if (!poly || !poly.cn || !M) return null;
    const cn = poly.cn;
    const O = [0, 1, 2].map((q) => (cn[0][q] + cn[1][q] + cn[2][q] + cn[3][q]) / 4);
    let n = poly.nm ? Hm.norm(poly.nm) : Hm.norm(O);
    const nw = Hm.ap(M, n);
    const fw = [-Math.sin(this._yaw) * Math.cos(this._pitch), Math.sin(this._pitch), Math.cos(this._yaw) * Math.cos(this._pitch)];
    if (nw[0] * fw[0] + nw[1] * fw[1] + nw[2] * fw[2] < 0) n = [-n[0], -n[1], -n[2]];
    const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    let up = [M[3], M[4], M[5]];
    let d = dot(up, n);
    let v = [up[0] - n[0] * d, up[1] - n[1] * d, up[2] - n[2] * d];
    if (Math.hypot(v[0], v[1], v[2]) < 0.25) {
      up = [cn[3][0] - cn[0][0], cn[3][1] - cn[0][1], cn[3][2] - cn[0][2]];
      d = dot(up, n);
      v = [up[0] - n[0] * d, up[1] - n[1] * d, up[2] - n[2] * d];
    }
    v = Hm.norm(v);
    const u = [v[1] * n[2] - v[2] * n[1], v[2] * n[0] - v[0] * n[2], v[0] * n[1] - v[1] * n[0]];
    return { O: O, u: u, v: v, n: n };
  }

  _step(dt) {
    const target = this._activeT ? 1 : 0;
    this._o += (target - this._o) * Math.min(1, dt * 2.4);
    if (Math.abs(target - this._o) < 0.002) this._o = target;
    const ot = this._open ? 1 : 0;
    this._openT += (ot - this._openT) * Math.min(1, dt * 3);
    if (!this._open && this._openT < 0.01) { this._openT = 0; this._tree = null; this._vf = null; }
    const o = this._o, m = this._reduced ? 0.15 : 1;
    const mag = 4.6 / this._dist;
    const hold = this._focus || this._open || this._freeT ? 1 : 0;
    this._holdT = (this._holdT || 0) + (hold - (this._holdT || 0)) * Math.min(1, dt * 2);
    const still = this._freeT && !this._focus && !this._open ? 1 : 0.92;
    const slow = (1 / (1 + 0.15 * Math.max(0, mag - 1))) * (1 - this._openT) * (1 - still * this._holdT);
    this._t += dt;
    this._w += dt * (1 + 3 * o) * m * slow;
    const sp = this._geo.sparks;
    for (let i = 0; i < sp.length; i++) {
      sp[i].r += dt * sp[i].v * (0.3 + 1.7 * o) * m * Math.max(0.05, slow);
      if (sp[i].r > 1.85) sp[i].r = 0.3 + Math.random() * 0.25;
    }
    if (this._distTarget != null) {
      const k = Math.min(1, dt * 3);
      this._dist = Math.exp(Math.log(this._dist) + (Math.log(this._distTarget) - Math.log(this._dist)) * k);
      if (Math.abs(this._dist / this._distTarget - 1) < 0.01) this._distTarget = null;
    }
    if (!this._dragging) {
      this._yaw += this._vy * dt;
      this._pitch += this._vp * dt;
      const damp = Math.pow(0.05, dt);
      this._vy *= damp; this._vp *= damp;
      if (!this._touched && !this._reduced) {
        const targetYaw = 0.45 * Math.sin(this._t * 0.12);
        this._yaw += (targetYaw - this._yaw) * Math.min(1, dt * 0.6);
      }
    }
    this._pitch = Math.max(-1.45, Math.min(1.45, this._pitch));
    if (this._fileOpen != null && this._distTarget == null && this._dist > (this._fit || 0.076) * 2.4) { this._fileOpen = null; this._pan = [0, 0]; this.setState({ fileOpen: null }); }
    const minD = this._fileOpen != null ? (this._fit || 0.07) / 10000 : (this._open || this._focus) && this._partBase ? this._partBase / 10000 : 4.6 / 100000;
    this._minD = minD;
    if (this._freeT && 4.6 / this._dist < 1.3) { this._freeT = null; this._freeL = null; this._pan = [0, 0]; }
    this._dist = Math.max(minD, Math.min(7, this._dist));
  }

  _zoomAt(clientX, clientY, D0, D1) {
    const cv = this._canvas;
    if (!cv || !(D0 > 0) || !(D1 > 0)) return;
    const r = cv.getBoundingClientRect();
    const scl = (cv.clientWidth || 390) / (r.width || 1);
    const mx = (clientX - r.left) * scl, my = (clientY - r.top) * scl;
    const W = cv.clientWidth || 390, Hh = cv.clientHeight || 560;
    if (!this._focus && !this._open && this._T && this._geo) {
      const pk = this._picks || [];
      const Ms = this._layerMats();
      const S = 1 + 0.05 * (this._o || 0), CY = 0.15, F = this._F || 460;
      const cyw = Math.cos(this._yaw), syw = Math.sin(this._yaw), cpt = Math.cos(this._pitch), spt = Math.sin(this._pitch);
      const fw = [-syw * cpt, spt, cyw * cpt], RT = [cyw, 0, syw], UPv = [syw * spt, cpt, -cyw * spt];
      const T = this._T;
      const C = [T[0] + fw[0] * D0, T[1] + fw[1] * D0, T[2] + fw[2] * D0];
      const ux = (mx - W / 2) / F, uy = -(my - Hh / 2) / F;
      const dir = [-fw[0] + RT[0] * ux + UPv[0] * uy, -fw[1] + RT[1] * ux + UPv[1] * uy, -fw[2] + RT[2] * ux + UPv[2] * uy];
      const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      const seen = {};
      let bestZ = null, bestH = null, bestK = null, bestN = null;
      for (let i = 0; i < pk.length; i++) {
        const id = pk[i].k + ':' + pk[i].i;
        if (seen[id]) continue;
        seen[id] = 1;
        const poly = this._polyRef(pk[i]);
        const M = Ms[pk[i].k];
        if (!poly || !poly.cn || !M) continue;
        const wc = [0, 1, 3].map((q) => { const p = poly.cn[q]; return [(M[0] * p[0] + M[1] * p[1] + M[2] * p[2]) * S, (M[3] * p[0] + M[4] * p[1] + M[5] * p[2]) * S + CY, (M[6] * p[0] + M[7] * p[1] + M[8] * p[2]) * S]; });
        const e1 = [wc[1][0] - wc[0][0], wc[1][1] - wc[0][1], wc[1][2] - wc[0][2]], e2 = [wc[2][0] - wc[0][0], wc[2][1] - wc[0][1], wc[2][2] - wc[0][2]];
        const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
        const den = dot(dir, n);
        if (Math.abs(den) < 1e-14) continue;
        const tt = ((wc[0][0] - C[0]) * n[0] + (wc[0][1] - C[1]) * n[1] + (wc[0][2] - C[2]) * n[2]) / den;
        if (!(tt > 0)) continue;
        const Hp = [C[0] + dir[0] * tt, C[1] + dir[1] * tt, C[2] + dir[2] * tt];
        const hx = [Hp[0] - wc[0][0], Hp[1] - wc[0][1], Hp[2] - wc[0][2]];
        const g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2), r1 = dot(hx, e1), r2 = dot(hx, e2), gd = g11 * g22 - g12 * g12;
        if (Math.abs(gd) < 1e-18) continue;
        const ua = (r1 * g22 - r2 * g12) / gd, vb = (r2 * g11 - r1 * g12) / gd;
        if (ua < -0.25 || ua > 1.25 || vb < -0.25 || vb > 1.25) continue;
        const z = (Hp[0] - T[0]) * fw[0] + (Hp[1] - T[1]) * fw[1] + (Hp[2] - T[2]) * fw[2];
        if (z >= D0 * 0.999) continue;
        if (this._freeT && D1 <= D0 && z < -1e-9) continue;
        if (bestZ == null || z > bestZ) { bestZ = z; bestH = Hp; bestK = pk[i].k; bestN = dot(n, fw) < 0 ? [-n[0], -n[1], -n[2]] : n; }
      }
      if (bestZ != null && Math.abs(bestZ) > 1e-12) {
        const z = bestZ, M = Ms[bestK];
        const q = [bestH[0] / S, (bestH[1] - CY) / S, bestH[2] / S];
        const nl = Math.hypot(bestN[0], bestN[1], bestN[2]) || 1, nn = [bestN[0] / nl, bestN[1] / nl, bestN[2] / nl];
        this._freeL = { k: bestK, p: [M[0] * q[0] + M[3] * q[1] + M[6] * q[2], M[1] * q[0] + M[4] * q[1] + M[7] * q[2], M[2] * q[0] + M[5] * q[1] + M[8] * q[2]], n: [M[0] * nn[0] + M[3] * nn[1] + M[6] * nn[2], M[1] * nn[0] + M[4] * nn[1] + M[7] * nn[2], M[2] * nn[0] + M[5] * nn[1] + M[8] * nn[2]] };
        this._align = true;
        this._freeT = bestH.slice();
        const ratio = D1 / D0;
        D0 = D0 - z; D1 = D0 * ratio;
        this._pan = [-(mx - W / 2) * D0 / F, (my - Hh / 2) * D0 / F];
        this._T = [T[0] + fw[0] * z, T[1] + fw[1] * z, T[2] + fw[2] * z];
        this._dist = Math.max(this._minD || 0, D1);
        for (let i = 0; i < pk.length; i++) pk[i].z -= z;
      }
    }
    const dk = (D0 - D1) / (this._F || 460);
    this._pan[0] += (mx - W / 2) * dk;
    this._pan[1] -= (my - Hh / 2) * dk;
    this._snapT = 2;
  }

  _draw() {
    const cv = this._canvas;
    if (!cv || !this._geo) return;
    const Hm = this._math();
    const W = cv.clientWidth || 390, Hh = cv.clientHeight || 560;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(W * dpr), phh = Math.round(Hh * dpr);
    if (cv.width !== pw || cv.height !== phh) { cv.width = pw; cv.height = phh; }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, W, Hh);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const g = this._geo, o = this._o, t = this._t, w = this._w;
    const sel = (this.state && this.state.sel) || null;
    const openC = this._open ? this._open.c : null;
    const oT = this._openT;
    const Bt = 0.4 + 0.6 * o;
    let Bd = Bt * (1 - 0.72 * oT);
    const col = this._rgb || [79, 216, 196];
    const rgba = (a, wh) => {
      const r = Math.round(col[0] + (255 - col[0]) * wh);
      const gg = Math.round(col[1] + (255 - col[1]) * wh);
      const b = Math.round(col[2] + (255 - col[2]) * wh);
      return 'rgba(' + r + ',' + gg + ',' + b + ',' + Math.max(0, Math.min(1, a)).toFixed(3) + ')';
    };
    const S = 1 + 0.05 * o, CY = 0.15;
    const D = this._dist, F = Math.min(W, Hh * 0.75) * 1.18, cx0 = W / 2, cy0 = Hh / 2;
    const mag = 4.6 / D;
    if (mag > 10) Bd *= Math.max(0.18, 1 - Math.log10(mag / 10) * 0.3);
    this._fit = (F * 0.054 * S) / (0.9 * W);
    this._selD = (F * 0.054 * S) / (0.42 * W);
    this._F = F; this._Wc = W; this._Hc = Hh;
    this._kT = F / D;
    const Ms = this._layerMats();
    let vW = null;
    if (this._tree && this._vf && this._vk && Ms[this._vk]) {
      const VM = Ms[this._vk], vf = this._vf;
      vW = { O: Hm.ap(VM, vf.O), U: Hm.ap(VM, vf.u), V: Hm.ap(VM, vf.v), N: Hm.ap(VM, vf.n) };
    }
    const vPt = (a, b, h) => [(vW.O[0] + vW.U[0] * a + vW.V[0] * b + vW.N[0] * h) * S, (vW.O[1] + vW.U[1] * a + vW.V[1] * b + vW.N[1] * h) * S + CY, (vW.O[2] + vW.U[2] * a + vW.V[2] * b + vW.N[2] * h) * S];
    if (this._align && !this._dragging && (this._focus || this._open || (this._freeL && mag > 3))) {
      let back = null;
      if (!this._focus && !this._open && this._freeL && Ms[this._freeL.k]) {
        back = Hm.norm(Hm.ap(Ms[this._freeL.k], this._freeL.n));
      } else if (this._open && vW) {
        const n = Hm.norm(vW.N), v = Hm.norm(vW.V);
        const tl = this._fileOpen != null ? 0 : 0.5 * Math.max(0, Math.min(1, (D - 0.1) / 0.25));
        const c = Math.cos(tl), s2 = Math.sin(tl);
        back = Hm.norm([n[0] * c - v[0] * s2, n[1] * c - v[1] * s2, n[2] * c - v[2] * s2]);
      } else {
        const ref = this._open || this._focus;
        const apoly = this._polyRef(ref);
        const AM = Ms[ref.k];
        if (apoly && apoly.cn && AM) {
          const cn = apoly.cn;
          const cc = [(cn[0][0] + cn[1][0] + cn[2][0] + cn[3][0]) / 4, (cn[0][1] + cn[1][1] + cn[2][1] + cn[3][1]) / 4, (cn[0][2] + cn[1][2] + cn[2][2] + cn[3][2]) / 4];
          if (apoly.nm) {
            back = Hm.norm(Hm.ap(AM, apoly.nm));
            const fw = [-Math.sin(this._yaw) * Math.cos(this._pitch), Math.sin(this._pitch), Math.cos(this._yaw) * Math.cos(this._pitch)];
            if (back[0] * fw[0] + back[1] * fw[1] + back[2] * fw[2] < 0) back = [-back[0], -back[1], -back[2]];
          } else back = Hm.norm(Hm.ap(AM, cc));
        }
      }
      if (back) {
        const dPitch = Math.asin(Math.max(-0.97, Math.min(0.97, back[1])));
        const dYaw = Math.atan2(-back[0], back[2]);
        let dif = dYaw - this._yaw;
        dif = Math.atan2(Math.sin(dif), Math.cos(dif));
        this._yaw += dif * 0.12;
        this._pitch += (dPitch - this._pitch) * 0.12;
      }
    }
    const cyw = Math.cos(this._yaw), syw = Math.sin(this._yaw), cpt = Math.cos(this._pitch), spt = Math.sin(this._pitch);
    const RIGHT = [cyw, 0, syw], UP = [syw * spt, cpt, -cyw * spt];
    const EXP = 0.08 * oT;

    let vaultT = null;
    if (this._open && vW) {
      const tr = this._tree;
      let a = 0, b = 0, h = -0.03;
      const nd = this._fileSel != null ? tr.nodes[this._fileSel] : null;
      if (nd && nd.kind === 'file') {
        a = (nd.a0 + nd.a1) / 2; b = (nd.b0 + nd.b1) / 2; h = nd.h1;
        if (this._fileOpen !== this._fileSel && this._tabOpen[this._fileSel] && this._tabMode !== 'over') a += (nd.a1 - nd.a0) * 0.34;
      } else if (nd && nd.kind === 'folder') { a = (nd.a0 + nd.a1) / 2; b = (nd.rb0 + nd.b1) / 2; h = -0.02; }
      vaultT = vPt(a, b, h);
    }

    const zoomT = Math.max(0, Math.min(1, (4.6 - D) / 3.2));
    let tgt = [0, CY * zoomT, 0];
    if (this._freeL && !this._focus && !this._open && Ms[this._freeL.k]) {
      const FM = Ms[this._freeL.k], fp = this._freeL.p;
      tgt = [(FM[0] * fp[0] + FM[1] * fp[1] + FM[2] * fp[2]) * S, (FM[3] * fp[0] + FM[4] * fp[1] + FM[5] * fp[2]) * S + CY, (FM[6] * fp[0] + FM[7] * fp[1] + FM[8] * fp[2]) * S];
      this._freeT = tgt.slice();
    }
    if (vaultT) {
      tgt = vaultT;
    } else if (this._focus && Ms[this._focus.k]) {
      const poly = this._polyRef(this._focus);
      if (poly && poly.cn) {
        const cn = poly.cn, fu = 0.5625, fv = 0.5;
        const cc = [0, 1, 2].map((q) => (1 - fv) * ((1 - fu) * cn[0][q] + fu * cn[1][q]) + fv * ((1 - fu) * cn[3][q] + fu * cn[2][q]));
        const wp = Hm.ap(Ms[this._focus.k], cc);
        const ft = Math.max(0, Math.min(1, (4.6 - D) / 2.6));
        tgt = [wp[0] * S * ft, (wp[1] * S + CY) * ft + CY * zoomT * (1 - ft), wp[2] * S * ft];
      }
    }
    tgt[0] += RIGHT[0] * this._pan[0] + UP[0] * this._pan[1];
    tgt[1] += RIGHT[1] * this._pan[0] + UP[1] * this._pan[1];
    tgt[2] += RIGHT[2] * this._pan[0] + UP[2] * this._pan[1];
    const ease = this._panning || this._snapT > 0 ? 1 : 0.18;
    if (this._snapT > 0) this._snapT--;
    this._T[0] += (tgt[0] - this._T[0]) * ease;
    this._T[1] += (tgt[1] - this._T[1]) * ease;
    this._T[2] += (tgt[2] - this._T[2]) * ease;
    const T0 = this._T[0], T1 = this._T[1], T2 = this._T[2];

    let PX = 0, PY = 0, PZ = 0, PK = 1, PV = true;
    const pj = (x, y, z) => {
      x -= T0; y -= T1; z -= T2;
      const X = x * cyw + z * syw;
      const Z = -x * syw + z * cyw;
      const Y = y * cpt - Z * spt;
      const Z2 = y * spt + Z * cpt;
      const d = D - Z2;
      PV = d > 1e-10;
      const k = F / Math.max(1e-10, d);
      PX = cx0 + X * k; PY = cy0 - Y * k; PZ = Z2; PK = k;
    };
    pj(0, CY, 0);
    const ccx = PX, ccy = PY, ck = PK, zc = PZ, coreVis = PV;
    const hideFront = mag > 1.6 || !!this._open;
    let hideEps = D * 0.35;
    const vEps = hideEps;
    if (this._open && vW) { const fp = vPt(0, 0, -0.05); pj(fp[0], fp[1], fp[2]); if (PV) hideEps = Math.min(hideEps, PZ + 0.004); }
    this._coreHit = coreVis ? { x: ccx, y: ccy, r: Math.max(16, Math.min(80, 0.22 * ck)) } : null;
    const picks = [];
    const detailQ = [];
    const tmp = this._tmp;
    let selSum = [0, 0, 0];

    const planeD = (poly, M) => {
      const cn = poly.cn;
      const w = [0, 1, 3].map((q) => {
        const p = cn[q];
        let x = p[0], y = p[1], z = p[2];
        if (M) { const xa = M[0] * x + M[1] * y + M[2] * z, ya = M[3] * x + M[4] * y + M[5] * z, za = M[6] * x + M[7] * y + M[8] * z; x = xa; y = ya; z = za; }
        return [x * S, y * S + CY, z * S];
      });
      const e1 = [w[1][0] - w[0][0], w[1][1] - w[0][1], w[1][2] - w[0][2]], e2 = [w[2][0] - w[0][0], w[2][1] - w[0][1], w[2][2] - w[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nl = Math.hypot(n[0], n[1], n[2]) || 1;
      const span = Math.max(Math.hypot(e1[0], e1[1], e1[2]), Math.hypot(e2[0], e2[1], e2[2]));
      const cx = w[0][0] + (e1[0] + e2[0]) / 2, cy = w[0][1] + (e1[1] + e2[1]) / 2, cz = w[0][2] + (e1[2] + e2[2]) / 2;
      if (Math.hypot(T0 - cx, T1 - cy, T2 - cz) > span * 1.2) return 1e9;
      return Math.abs(((T0 - w[0][0]) * n[0] + (T1 - w[0][1]) * n[1] + (T2 - w[0][2]) * n[2]) / nl);
    };
    const drawPolys = (polys, M, fillA, glowA, lineA, lw, wh, key) => {
      const front = new Path2D(), back = new Path2D();
      const fillP = fillA > 0 ? new Path2D() : null;
      const selP = new Path2D();
      let anySel = false;
      for (let j = 0; j < polys.length; j++) {
        const pts = polys[j].pts;
        const lifted = openC && polys[j].c === openC && EXP > 0;
        if (lifted && oT > 0.12) continue;
        const nm = polys[j].nm;
        let zs = 0, sx = 0, sy = 0, ok = true, x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
        for (let i = 0; i < pts.length; i++) {
          let x = pts[i][0], y = pts[i][1], z = pts[i][2];
          if (lifted) {
            if (nm) { x += nm[0] * EXP; y += nm[1] * EXP; z += nm[2] * EXP; }
            else { const l = Math.hypot(x, y, z) || 1; const f = 1 + EXP / l; x *= f; y *= f; z *= f; }
          }
          if (M) {
            const xa = M[0] * x + M[1] * y + M[2] * z;
            const ya = M[3] * x + M[4] * y + M[5] * z;
            const za = M[6] * x + M[7] * y + M[8] * z;
            x = xa; y = ya; z = za;
          }
          pj(x * S, y * S + CY, z * S);
          if (!PV) { ok = false; break; }
          tmp[2 * i] = PX; tmp[2 * i + 1] = PY; zs += PZ; sx += PX; sy += PY;
          if (PX < x0) x0 = PX; if (PX > x1) x1 = PX; if (PY < y0) y0 = PY; if (PY > y1) y1 = PY;
        }
        if (!ok) {
          if (key && polys[j].c && polys[j].cn && !openC) {
            const cn = polys[j].cn;
            let cx = (cn[0][0] + cn[1][0] + cn[2][0] + cn[3][0]) / 4, cy = (cn[0][1] + cn[1][1] + cn[2][1] + cn[3][1]) / 4, cz = (cn[0][2] + cn[1][2] + cn[2][2] + cn[3][2]) / 4;
            if (M) { const xa = M[0] * cx + M[1] * cy + M[2] * cz, ya = M[3] * cx + M[4] * cy + M[5] * cz, za = M[6] * cx + M[7] * cy + M[8] * cz; cx = xa; cy = ya; cz = za; }
            pj(cx * S, cy * S + CY, cz * S);
            if (PV && !(hideFront && PZ > hideEps)) { detailQ.push({ poly: polys[j], M: M, size: 1e6 }); picks.push({ x: PX, y: PY, z: PZ, c: polys[j].c, k: key, i: j }); }
          }
          continue;
        }
        if (x1 < -40 || x0 > W + 40 || y1 < -40 || y0 > Hh + 40) continue;
        const n = pts.length, az = zs / n;
        if (hideFront && az > hideEps && !(key && polys[j].cn && planeD(polys[j], M) < Math.max(hideEps, 1e-9))) continue;
        const path = az >= zc ? front : back;
        path.moveTo(tmp[0], tmp[1]);
        for (let i = 1; i < n; i++) path.lineTo(tmp[2 * i], tmp[2 * i + 1]);
        const isSel = sel && polys[j].c === sel;
        if (polys[j].closed) {
          path.closePath();
          if (fillP) {
            fillP.moveTo(tmp[0], tmp[1]);
            for (let i = 1; i < n; i++) fillP.lineTo(tmp[2 * i], tmp[2 * i + 1]);
            fillP.closePath();
          }
          if (isSel) {
            anySel = true;
            selP.moveTo(tmp[0], tmp[1]);
            for (let i = 1; i < n; i++) selP.lineTo(tmp[2 * i], tmp[2 * i + 1]);
            selP.closePath();
            selSum[0] += sx / n; selSum[1] += sy / n; selSum[2] += 1;
          }
        }
        if (key && polys[j].c) {
          picks.push({ x: sx / n, y: sy / n, z: az, c: polys[j].c, k: key, i: j });
          const size = Math.max(x1 - x0, y1 - y0);
          if (!openC && polys[j].cn && size > 60) detailQ.push({ poly: polys[j], M: M, size: size });
        }
      }
      if (fillP) { ctx.fillStyle = rgba(fillA * Bd, wh * 0.5); ctx.fill(fillP); }
      if (glowA > 0) {
        ctx.lineWidth = lw * 3.4;
        ctx.strokeStyle = rgba(glowA * Bd, 0); ctx.stroke(front);
        ctx.strokeStyle = rgba(glowA * Bd * 0.45, 0); ctx.stroke(back);
      }
      if (lineA > 0) {
        ctx.lineWidth = lw;
        ctx.strokeStyle = rgba(lineA * Bd, wh); ctx.stroke(front);
        ctx.strokeStyle = rgba(lineA * Bd * 0.45, wh); ctx.stroke(back);
      }
      if (anySel) {
        const pulse = 0.75 + 0.25 * Math.sin(t * 5);
        ctx.fillStyle = rgba(0.3 * pulse, 0.7); ctx.fill(selP);
        ctx.lineWidth = lw * 4; ctx.strokeStyle = rgba(0.3 * pulse, 0.3); ctx.stroke(selP);
        ctx.lineWidth = lw * 1.5; ctx.strokeStyle = rgba(1, 0.85); ctx.stroke(selP);
      }
    };

    if (coreVis) {
      const grd0 = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, Math.min(2000, 1.9 * ck));
      grd0.addColorStop(0, rgba(0.2 * Bd, 0.2));
      grd0.addColorStop(0.45, rgba(0.07 * Bd, 0));
      grd0.addColorStop(1, rgba(0, 0));
      ctx.fillStyle = grd0;
      ctx.fillRect(0, 0, W, Hh);
    }

    const yP = -1.85;
    pj(0, yP, 0);
    if (PV && mag < 6) {
      const pcx = PX, pcy = PY, pk = PK;
      ctx.save();
      ctx.translate(pcx, pcy);
      ctx.scale(1, 0.18 + 0.75 * Math.abs(Math.sin(this._pitch + 0.2)));
      const grd = ctx.createRadialGradient(0, 0, 0, 0, 0, 1.6 * pk);
      grd.addColorStop(0, rgba(0.32 * Bd, 0.3));
      grd.addColorStop(0.6, rgba(0.08 * Bd, 0));
      grd.addColorStop(1, rgba(0, 0));
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(0, 0, 1.6 * pk, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    const platPolys = [];
    [0.32, 0.55, 0.78, 0.98, 1.15, 1.3].forEach((r) => {
      const pts = [];
      for (let i = 0; i <= 72; i++) { const a = (i / 72) * Math.PI * 2; pts.push([r * Math.cos(a), (yP - CY) / S, r * Math.sin(a)]); }
      platPolys.push({ pts: pts, closed: false });
    });
    drawPolys(platPolys, null, 0, 0.08, 0.55, 1.1, 0.15, null);
    const beam = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2 + t * 0.1;
      beam.push({ pts: [[0.34 * Math.cos(a), (yP - CY) / S, 0.34 * Math.sin(a)], [0.22 * Math.cos(a), -0.9, 0.22 * Math.sin(a)]], closed: false });
    }
    drawPolys(beam, null, 0, 0, 0.08, 1, 0.2, null);

    g.rings.forEach((rg) => drawPolys(rg.polys, Hm.mm(rg.tilt, Hm.rotY(rg.sp * w)), 0, 0.07, 0.4, 0.9, 0.15, null));
    drawPolys(g.brightArc, Hm.mm(g.rings[0].tilt, Hm.rotY(g.rings[0].sp * w * 1.6)), 0, 0.22, 0.95, Math.min(7, 0.028 * ck), 0.35, null);

    const subA = Math.max(0, Math.min(1, (3.4 - D) / 1.6)) * (1 - oT);
    const shellSet = [[0.03, 0.11, 0.85, 1.0], [0.035, 0.12, 0.9, 1.05], [0.045, 0.13, 0.9, 1.1]];
    g.shells.forEach((sh, i) => {
      const M = Ms['s' + i];
      const s = shellSet[i];
      drawPolys(sh.polys, M, s[0], s[1], s[2], s[3], 0.15, 's' + i);
      drawPolys(sh.cells, M, 0, 0.02, 0.32, 0.7, 0.1, null);
      drawPolys(sh.lit, M, 0.8, 0, 0, 1, 0.6, null);
      if (subA > 0.02) {
        drawPolys(sh.sub.links, M, 0, 0.03 * subA, 0.4 * subA, 0.8, 0.3, null);
        drawPolys(sh.sub.grid, M, 0, 0, 0.18 * subA, 0.7, 0.1, null);
        drawPolys(sh.sub.inner, M, 0.025 * subA, 0.05 * subA, 0.5 * subA, 0.8, 0.15, null);
        ctx.fillStyle = rgba(0.9 * subA * Bd, 0.6);
        const nd = sh.sub.nodes;
        for (let q = 0; q < nd.length; q++) {
          const p = nd[q];
          pj((M[0] * p[0] + M[1] * p[1] + M[2] * p[2]) * S, (M[3] * p[0] + M[4] * p[1] + M[5] * p[2]) * S + CY, (M[6] * p[0] + M[7] * p[1] + M[8] * p[2]) * S);
          if (!PV || (hideFront && PZ > hideEps)) continue;
          const sz = Math.min(7, Math.max(1.5, 0.008 * PK));
          ctx.fillRect(PX - sz / 2, PY - sz / 2, sz, sz);
        }
      }
    });

    drawPolys(g.streaks, Hm.axisAngle(g.streakAxis, -0.22 * w), 0, 0.06, 0.4, 0.8, 0.3, null);
    drawPolys(g.planet, Hm.axisAngle(g.planetAxis, 0.35 * w), 0, 0.05, 0.35, 0.8, 0.3, null);
    [0.1, 0.03, 0.009, 0.0027, 0.0008, 0.00024, 0.00007, 0.00002, 0.000006, 0.0000018].forEach((r, li) => {
      const ps = r * ck * S;
      if (ps < 3 || ps > 4 * W) return;
      const M0 = Hm.mm(Hm.axisAngle(g.nucleusAxis, (0.9 + li * 0.45) * w * (li % 2 ? -1 : 1)), Hm.rotY(li * 0.7));
      drawPolys(g.nucleus, M0.map((v) => v * (r / 0.1)), 0, 0.1, 0.8, 1, 0.5, null);
      if (li > 0) { const mr = g.microRings[li % 3]; const Mr = Hm.mm(mr.tilt, Hm.rotY(mr.sp * w * (1 + li * 0.3))); drawPolys(mr.polys, Mr.map((v) => v * ((r * 1.6) / 0.14)), 0, 0.06, 0.55, 0.9, 0.4, null); }
    });
    g.microRings.forEach((mr) => drawPolys(mr.polys, Hm.mm(mr.tilt, Hm.rotY(mr.sp * w)), 0, 0.06, 0.55, 0.9, 0.4, null));

    g.strands.forEach((sd, k) => {
      const cax = Math.cos(sd.ax), sax = Math.sin(sd.ax), cay = Math.cos(sd.ay), say = Math.sin(sd.ay);
      const p = new Path2D();
      let started = false;
      for (let i = 0; i <= 70; i++) {
        const u = i / 70;
        const r = (0.04 + 0.3 * Math.pow(u, 0.8)) * sd.rs * (0.9 + 0.15 * o);
        const a = u * Math.PI * 3.4 + w * 0.8 * (1 + 0.1 * k) + sd.ph;
        const x = r * Math.cos(a), y = r * Math.sin(a) * 0.8, z = 0.1 * Math.sin(u * 6 + sd.ph + t * 1.5);
        const y1 = y * cax - z * sax, z1 = y * sax + z * cax;
        const x2 = x * cay + z1 * say, z2 = -x * say + z1 * cay;
        pj(x2 * S, y1 * S + CY, z2 * S);
        if (!PV) { started = false; continue; }
        if (!started) { p.moveTo(PX, PY); started = true; } else p.lineTo(PX, PY);
      }
      ctx.lineWidth = sd.w * 3.4; ctx.strokeStyle = rgba(0.12 * Bd, 0.1); ctx.stroke(p);
      ctx.lineWidth = sd.w * (0.8 + 0.4 * o); ctx.strokeStyle = rgba(0.85 * Bd, sd.wh); ctx.stroke(p);
    });

    if (coreVis && D - zc > 0.3) {
      const cr = Math.min(Hh, 0.55 * ck);
      const grd = ctx.createRadialGradient(ccx, ccy, 0, ccx, ccy, cr);
      grd.addColorStop(0, rgba((sel === 'core' ? 1 : 0.95) * Bd, 0.85));
      grd.addColorStop(0.25, rgba((sel === 'core' ? 0.7 : 0.45) * Bd, 0.3));
      grd.addColorStop(1, rgba(0, 0));
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.arc(ccx, ccy, cr, 0, Math.PI * 2); ctx.fill();
    }

    g.belts.forEach((b, i) => {
      const M = Ms['b' + i];
      drawPolys(b.polys, M, 0.05, 0.13, 0.95, 1.15, 0.2, 'b' + i);
      drawPolys(b.cells, M, 0, 0.03, 0.38, 0.7, 0.1, null);
      drawPolys(b.lit, M, 0.85, 0, 0, 1, 0.65, null);
    });

    const shPolys = [], shCells = [];
    g.shards.forEach((s) => {
      const cen = [s.r * Math.cos(s.a), s.r * Math.sin(s.a) + 0.04 * Math.sin(t * 1.1 + s.ph), s.z];
      const M = Hm.axisAngle(s.ax, 0.35 + 0.25 * Math.sin(w * 0.3 + s.ph));
      const Q = (x, y) => [cen[0] + M[0] * x + M[1] * y, cen[1] + M[3] * x + M[4] * y, cen[2] + M[6] * x + M[7] * y];
      shPolys.push({ pts: [Q(-s.w / 2, -s.h / 2), Q(s.w / 2, -s.h / 2 + 0.03), Q(s.w / 2, s.h / 2 + 0.03), Q(-s.w / 2, s.h / 2)], closed: true });
      for (let k = 1; k < 4; k++) { const x = -s.w / 2 + (s.w * k) / 4, dy = (0.03 * k) / 4; shCells.push({ pts: [Q(x, -s.h / 2 + dy), Q(x, s.h / 2 + dy)], closed: false }); }
    });
    const shM = Hm.rotZ(0.035 * w);
    drawPolys(shPolys, shM, 0.06, 0.14, 0.95, 1.1, 0.2, null);
    drawPolys(shCells, shM, 0, 0, 0.35, 0.7, 0.1, null);

    if (mag > 2) {
      const lim = Math.max(D * 0.35, 1e-9);
      detailQ.forEach((it) => { const pd = planeD(it.poly, it.M); it.key = pd < lim ? pd - 1e12 : -it.size; });
      detailQ.sort((a, b) => a.key - b.key);
    } else detailQ.sort((a, b) => b.size - a.size);
    const hsh = (a, b, c) => { const v = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453; return v - Math.floor(v); };
    const hx2 = (v) => ((Math.floor(v * 256) | 0) + 256).toString(16).slice(-2).toUpperCase();
    const dGrid = new Path2D(), dFill = new Path2D(), dData = new Path2D(), dBits = new Path2D(), dTrace = new Path2D(), dLinks = new Path2D();
    const dSub = [new Path2D(), new Path2D(), new Path2D()];
    const dNodes = [], dTexts = [];
    const q8 = [0, 0, 0, 0, 0, 0, 0, 0];
    let budget = 6500;
    const nDetail = Math.min(detailQ.length, 30);
    for (let qi = 0; qi < nDetail; qi++) {
      const it = detailQ[qi], poly = it.poly, M = it.M, cn = poly.cn;
      const lp = (u, v) => {
        const a = cn[0], b = cn[1], c = cn[2], d = cn[3];
        return [(1 - v) * ((1 - u) * a[0] + u * b[0]) + v * ((1 - u) * d[0] + u * c[0]), (1 - v) * ((1 - u) * a[1] + u * b[1]) + v * ((1 - u) * d[1] + u * c[1]), (1 - v) * ((1 - u) * a[2] + u * b[2]) + v * ((1 - u) * d[2] + u * c[2])];
      };
      const prj = (u, v) => {
        const p = lp(u, v);
        pj((M[0] * p[0] + M[1] * p[1] + M[2] * p[2]) * S, (M[3] * p[0] + M[4] * p[1] + M[5] * p[2]) * S + CY, (M[6] * p[0] + M[7] * p[1] + M[8] * p[2]) * S);
        return PV;
      };
      const quad = (u0, u1, v0, v1) => {
        if (!prj(u0, v0)) return false; q8[0] = PX; q8[1] = PY;
        if (!prj(u1, v0)) return false; q8[2] = PX; q8[3] = PY;
        if (!prj(u1, v1)) return false; q8[4] = PX; q8[5] = PY;
        if (!prj(u0, v1)) return false; q8[6] = PX; q8[7] = PY;
        return true;
      };
      const addQuad = (path) => { path.moveTo(q8[0], q8[1]); path.lineTo(q8[2], q8[3]); path.lineTo(q8[4], q8[5]); path.lineTo(q8[6], q8[7]); path.closePath(); };
      const camP = (u, v) => {
        const p = lp(u, v);
        const x = (M[0] * p[0] + M[1] * p[1] + M[2] * p[2]) * S - T0, y = (M[3] * p[0] + M[4] * p[1] + M[5] * p[2]) * S + CY - T1, z = (M[6] * p[0] + M[7] * p[1] + M[8] * p[2]) * S - T2;
        const X = x * cyw + z * syw, Z = -x * syw + z * cyw;
        return [X, y * cpt - Z * spt, D - (y * spt + Z * cpt)];
      };
      const clipBox = (u0, u1, v0, v1) => {
        const cs = [camP(u0, v0), camP(u1, v0), camP(u1, v1), camP(u0, v1)];
        const eps = D * 1e-3;
        let x0 = 1e18, y0 = 1e18, x1 = -1e18, y1 = -1e18, any = false;
        const add = (X, Y, d) => { const k = F / d, sx = cx0 + X * k, sy = cy0 - Y * k; if (sx < x0) x0 = sx; if (sx > x1) x1 = sx; if (sy < y0) y0 = sy; if (sy > y1) y1 = sy; any = true; };
        for (let i = 0; i < 4; i++) {
          const a = cs[i], b = cs[(i + 1) % 4];
          if (a[2] > eps) add(a[0], a[1], a[2]);
          if ((a[2] > eps) !== (b[2] > eps)) { const tt = (eps - a[2]) / (b[2] - a[2]); add(a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt, eps); }
        }
        return any ? [x0, y0, x1, y1] : null;
      };
      const box = () => [Math.min(q8[0], q8[2], q8[4], q8[6]), Math.min(q8[1], q8[3], q8[5], q8[7]), Math.max(q8[0], q8[2], q8[4], q8[6]), Math.max(q8[1], q8[3], q8[5], q8[7])];
      const off = (b) => b[2] < -20 || b[0] > W + 20 || b[3] < -20 || b[1] > Hh + 20;
      const rec = (u0, u1, v0, v1, lvl, sd) => {
        if (budget <= 0 || lvl > 16) return;
        budget--;
        const full = quad(u0, u1, v0, v1);
        let bx, size;
        if (full) {
          bx = box();
          if (off(bx)) return;
          size = Math.max(bx[2] - bx[0], bx[3] - bx[1]);
        } else {
          bx = clipBox(u0, u1, v0, v1);
          if (!bx || off(bx)) return;
          size = 1e9;
        }
        if (size < 6) return;
        if (lvl > 0 && full) addQuad(dGrid);
        const du = u1 - u0, dv = v1 - v0, type = lvl % 4;
        if (type === 0) {
          const C = 8, RR = 5;
          if (full && size > 240 && dTexts.length < 360) dTexts.push((bx[0] + bx[2]) / 2, bx[1] + Math.min(18, size * 0.04) + 4, Math.min(14, size * 0.035), 'MODULE ' + hx2(hsh(sd, 1, 2)) + hx2(hsh(sd, 3, 4)));
          for (let i = 0; i < C; i++) {
            for (let j = 0; j < RR; j++) {
              const a0 = u0 + du * ((i + 0.08) / C), a1 = u0 + du * ((i + 0.92) / C), b0 = v0 + dv * ((j + 0.1) / RR), b1 = v0 + dv * ((j + 0.9) / RR);
              const s2 = hsh(sd, i, j);
              if (size / C > 42) rec(a0, a1, b0, b1, lvl + 1, sd * 1.37 + i * 31 + j * 7 + 1);
              else if (quad(a0, a1, b0, b1)) { addQuad(dGrid); if (s2 < 0.32) addQuad(dFill); }
            }
          }
        } else if (type === 1) {
          const RR = 5;
          for (let j = 0; j < RR; j++) {
            const b0 = v0 + dv * ((j + 0.12) / RR), b1 = v0 + dv * ((j + 0.88) / RR), mid = (b0 + b1) / 2;
            const ue = u0 + du * (0.28 + 0.6 * hsh(sd, j, 9));
            if (prj(u0 + du * 0.16, mid)) { const ax = PX, ay = PY; if (prj(ue, mid)) { dData.moveTo(ax, ay); dData.lineTo(PX, PY); } }
            if (quad(u0 + du * 0.03, u0 + du * 0.1, b0, b1)) addQuad(dFill);
            if (quad(u0, u1, b0, b1)) {
              const rb = box();
              const rh = rb[3] - rb[1];
              if (rh > 26 && dTexts.length < 360 && !off(rb)) dTexts.push((rb[0] + rb[2]) / 2, (rb[1] + rb[3]) / 2, Math.min(14, rh * 0.32), 'REC ' + String(Math.floor(hsh(sd, j, 3) * 9000) + 1000) + '  ' + hx2(hsh(sd, j, 4)) + ' ' + hx2(hsh(sd, j, 5)) + ' ' + hx2(hsh(sd, j, 6)));
              if (rh > 70) rec(u0 + du * 0.12, u1 - du * 0.03, b0, b1, lvl + 1, sd * 2.11 + j * 13 + 3);
            } else rec(u0 + du * 0.12, u1 - du * 0.03, b0, b1, lvl + 1, sd * 2.11 + j * 13 + 3);
          }
        } else if (type === 2) {
          const BC = 8, BR = 6;
          for (let i = 0; i < BC; i++) {
            for (let j = 0; j < BR; j++) {
              const a0 = u0 + du * ((i + 0.1) / BC), a1 = u0 + du * ((i + 0.9) / BC), b0 = v0 + dv * ((j + 0.1) / BR), b1 = v0 + dv * ((j + 0.9) / BR);
              if (!quad(a0, a1, b0, b1)) { rec(a0, a1, b0, b1, lvl + 1, sd * 1.91 + i * 17 + j * 5 + 2); continue; }
              const cb = box();
              if (off(cb)) continue;
              const hv = hsh(sd, i * 3 + 1, j * 5 + 2);
              const cs = Math.max(cb[2] - cb[0], cb[3] - cb[1]);
              if (cs > 130) { rec(a0, a1, b0, b1, lvl + 1, sd * 1.91 + i * 17 + j * 5 + 2); continue; }
              addQuad(dGrid);
              if (hv > 0.5) addQuad(dBits);
              if (cs > 40 && dTexts.length < 360) dTexts.push((cb[0] + cb[2]) / 2, (cb[1] + cb[3]) / 2, Math.min(16, cs * 0.3), hx2(hv));
            }
          }
        } else {
          const pts = [];
          for (let q = 0; q < 7; q++) {
            const u = u0 + du * (0.1 + 0.8 * hsh(sd, q, 11)), v = v0 + dv * (0.1 + 0.8 * hsh(sd, q, 23));
            if (prj(u, v)) pts.push([PX, PY, u, v]);
          }
          for (let q = 1; q < pts.length; q++) {
            const a = pts[q - 1], b = pts[q];
            dTrace.moveTo(a[0], a[1]); dTrace.lineTo(b[0], a[1]); dTrace.lineTo(b[0], b[1]);
          }
          pts.forEach((p) => dNodes.push(p[0], p[1], Math.max(2, Math.min(10, size * 0.012))));
          if (full && size > 300 && dTexts.length < 360) dTexts.push((bx[0] + bx[2]) / 2, bx[3] - Math.min(14, size * 0.03) - 4, Math.min(13, size * 0.03), 'BUS ' + hx2(hsh(sd, 7, 7)) + ' · ' + Math.floor(hsh(sd, 8, 8) * 900 + 100) + ' links');
          if (size / 3 > 56) {
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
              if (hsh(sd, i + 40, j + 40) < 0.25) continue;
              rec(u0 + du * ((i + 0.12) / 3), u0 + du * ((i + 0.88) / 3), v0 + dv * ((j + 0.12) / 3), v0 + dv * ((j + 0.88) / 3), lvl + 1, sd * 1.53 + i * 19 + j * 3 + 4);
            }
          }
        }
      };
      rec(0, 1, 0, 1, 0, poly.id);
      if (qi === 0 && it.key != null && it.key < -1e11) {
        if (prj(0, 0)) {
          const p00 = [PX, PY];
          if (prj(1, 0)) {
            const p10 = [PX, PY];
            if (prj(0, 1)) {
              const p01 = [PX, PY];
              const ax = p10[0] - p00[0], ay = p10[1] - p00[1], bx2 = p01[0] - p00[0], by2 = p01[1] - p00[1];
              const det = ax * by2 - ay * bx2;
              if (Math.abs(det) > 1e-9) {
                let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
                [[0, 0], [W, 0], [W, Hh], [0, Hh]].forEach((sp) => {
                  const dx = sp[0] - p00[0], dy = sp[1] - p00[1];
                  const u = (by2 * dx - bx2 * dy) / det, v = (-ay * dx + ax * dy) / det;
                  u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
                });
                const mu = (u1 - u0) * 0.1, mv = (v1 - v0) * 0.1;
                u0 = Math.max(-0.25, u0 - mu); u1 = Math.min(1.25, u1 + mu); v0 = Math.max(-0.25, v0 - mv); v1 = Math.min(1.25, v1 + mv);
                const pxU = Math.hypot(ax, ay), pxV = Math.hypot(bx2, by2);
                if (u1 > u0 && v1 > v0) {
                  const major = [[], []];
                  const lines = (base, pxPer, lo, hi, alongU) => {
                    let sp = base;
                    while (sp * pxPer > 1200) sp /= 4;
                    for (let L = 0; L < 3 && sp * pxPer >= 12; L++, sp /= 4) {
                      const k0 = Math.ceil(lo / sp), k1 = Math.floor(hi / sp);
                      if (k1 - k0 > 240) break;
                      if (L === 0) for (let k = k0; k <= k1; k++) major[alongU ? 0 : 1].push(k * sp);
                      for (let k = k0; k <= k1; k++) {
                        const c = k * sp;
                        if (alongU ? !prj(c, v0) : !prj(u0, c)) continue;
                        const ax0 = PX, ay0 = PY;
                        if (alongU ? !prj(c, v1) : !prj(u1, c)) continue;
                        dSub[L].moveTo(ax0, ay0); dSub[L].lineTo(PX, PY);
                      }
                    }
                  };
                  lines(1 / 8, pxU, u0, u1, true);
                  lines(1 / 5, pxV, v0, v1, false);
                  if (major[0].length * major[1].length <= 400) {
                    for (let a = 0; a < major[0].length; a++) for (let b = 0; b < major[1].length; b++) {
                      if (prj(major[0][a], major[1][b])) dNodes.push(PX, PY, 3.5);
                    }
                  }
                }
              }
            }
          }
        }
      }

      const c0 = cn[0], c1 = cn[1];
      const tsz = Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]);
      let nrm = poly.nm;
      if (!nrm) { const ctr = lp(0.5, 0.5); const l = Math.hypot(ctr[0], ctr[1], ctr[2]) || 1; nrm = [ctr[0] / l, ctr[1] / l, ctr[2] / l]; }
      let px = null, py = null;
      for (let q = 0; q < 7; q++) {
        const u = 0.1 + 0.8 * hsh(poly.id, q, 91), v = 0.1 + 0.8 * hsh(poly.id, q, 37), hh = (0.06 + 0.14 * hsh(poly.id, q, 5)) * tsz;
        const base = lp(u, v);
        const top = [base[0] + nrm[0] * hh, base[1] + nrm[1] * hh, base[2] + nrm[2] * hh];
        pj((M[0] * base[0] + M[1] * base[1] + M[2] * base[2]) * S, (M[3] * base[0] + M[4] * base[1] + M[5] * base[2]) * S + CY, (M[6] * base[0] + M[7] * base[1] + M[8] * base[2]) * S);
        if (!PV) continue;
        const bx = PX, by = PY;
        pj((M[0] * top[0] + M[1] * top[1] + M[2] * top[2]) * S, (M[3] * top[0] + M[4] * top[1] + M[5] * top[2]) * S + CY, (M[6] * top[0] + M[7] * top[1] + M[8] * top[2]) * S);
        if (!PV) continue;
        dLinks.moveTo(bx, by); dLinks.lineTo(PX, PY);
        if (px !== null) { dLinks.moveTo(px, py); dLinks.lineTo(PX, PY); }
        px = PX; py = PY;
        dNodes.push(PX, PY, Math.min(9, Math.max(2, 0.004 * PK)));
      }
    }
    if (nDetail > 0) {
      ctx.lineWidth = 0.8;
      ctx.lineWidth = 1.3; ctx.strokeStyle = rgba(0.35 * Bt + 0.4, 0.2); ctx.stroke(dSub[0]);
      ctx.lineWidth = 0.9; ctx.strokeStyle = rgba(0.2 * Bt + 0.22, 0.1); ctx.stroke(dSub[1]);
      ctx.lineWidth = 0.7; ctx.strokeStyle = rgba(0.1 * Bt + 0.1, 0); ctx.stroke(dSub[2]);
      ctx.strokeStyle = rgba(0.36 * Bt + 0.12, 0.1); ctx.stroke(dGrid);
      ctx.fillStyle = rgba(0.13 * Bt + 0.04, 0.3); ctx.fill(dFill);
      ctx.lineWidth = 1.1; ctx.strokeStyle = rgba(0.6 * Bt + 0.15, 0.45); ctx.stroke(dData);
      ctx.fillStyle = rgba(0.4 * Bt + 0.1, 0.55); ctx.fill(dBits);
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(0.55 * Bt + 0.12, 0.35); ctx.stroke(dTrace);
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(0.5 * Bt + 0.1, 0.4); ctx.stroke(dLinks);
      ctx.fillStyle = rgba(0.95, 0.7);
      for (let i = 0; i < dNodes.length; i += 3) { const s = dNodes[i + 2]; ctx.fillRect(dNodes[i] - s / 2, dNodes[i + 1] - s / 2, s, s); }
    }
    const buckets = [[], [], [], []];
    const sM = Hm.rotY(0.05 * w);
    const sp = g.sparks;
    for (let i = 0; i < sp.length; i++) {
      const q = sp[i];
      const x = q.d[0] * q.r, y = q.d[1] * q.r, z = q.d[2] * q.r;
      pj((sM[0] * x + sM[2] * z) * S, y * S + CY, (sM[6] * x + sM[8] * z) * S);
      if (!PV || PX < -10 || PX > W + 10 || PY < -10 || PY > Hh + 10) continue;
      if (hideFront && PZ > hideEps) continue;
      const al = Bd * (0.25 + 0.75 * Math.abs(Math.sin(t * q.f + q.ph))) * (PZ >= zc ? 1 : 0.55);
      buckets[Math.min(3, Math.floor(al * 4))].push(PX, PY, Math.min(6, q.sz * (PK / 100)));
    }
    for (let b = 0; b < 4; b++) {
      ctx.fillStyle = rgba((b + 0.6) / 4, 0.55);
      const arr = buckets[b];
      for (let i = 0; i < arr.length; i += 3) ctx.fillRect(arr[i] - arr[i + 2] / 2, arr[i + 1] - arr[i + 2] / 2, arr[i + 2], arr[i + 2]);
    }

    const filePicks = [];
    const uiHits = [];
    const vtr = this._tree;
    if (vtr && vW && oT > 0.02) {
      ctx.globalCompositeOperation = 'lighter';
      const rise = oT * oT * (3 - 2 * oT);
      const VA = Math.min(1, oT * 1.25);
      const HF = -0.05;
      const VO = vW.O, VU = vW.U, VV = vW.V, VN = vW.N;
      const pv = (a, b, h) => {
        const hh = HF + (h - HF) * rise;
        pj((VO[0] + VU[0] * a + VV[0] * b + VN[0] * hh) * S, (VO[1] + VU[1] * a + VV[1] * b + VN[1] * hh) * S + CY, (VO[2] + VU[2] * a + VV[2] * b + VN[2] * hh) * S);
        return PV && PZ <= vEps;
      };
      const C8 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], K8 = [0, 0, 0, 0, 0, 0, 0, 0];
      const boxP = (a0, a1, b0, b1, h0, h1) => {
        let n = 0;
        for (let i = 0; i < 8; i++) {
          K8[i] = pv(i & 1 ? a1 : a0, i & 2 ? b1 : b0, i & 4 ? h1 : h0) ? 1 : 0;
          C8[2 * i] = PX; C8[2 * i + 1] = PY; n += K8[i];
        }
        return n;
      };
      const EDG = [0, 1, 2, 3, 4, 5, 6, 7, 0, 2, 1, 3, 4, 6, 5, 7, 0, 4, 1, 5, 2, 6, 3, 7];
      const boxE = (path) => {
        for (let e = 0; e < 24; e += 2) {
          const i = EDG[e], j = EDG[e + 1];
          if (!K8[i] || !K8[j]) continue;
          path.moveTo(C8[2 * i], C8[2 * i + 1]); path.lineTo(C8[2 * j], C8[2 * j + 1]);
        }
      };
      const topF = (path) => {
        if (!K8[4] || !K8[5] || !K8[6] || !K8[7]) return false;
        path.moveTo(C8[12], C8[13]); path.lineTo(C8[14], C8[15]); path.lineTo(C8[10], C8[11]); path.lineTo(C8[8], C8[9]); path.closePath();
        return true;
      };
      const seg = (path, a0, b0, h0, a1, b1, h1) => {
        if (!pv(a0, b0, h0)) return;
        const x = PX, y = PY;
        if (!pv(a1, b1, h1)) return;
        path.moveTo(x, y); path.lineTo(PX, PY);
      };
      const ph = (t * 0.42) % 1;

      // the chamber: floor grid, walls and rim, sunk into the layer
      const ex = vtr.ext;
      const pCh = new Path2D(), pGrid = new Path2D();
      boxP(ex.a0, ex.a1, ex.b0, ex.b1, HF, 0);
      boxE(pCh);
      for (let a = ex.a0 + 0.025; a < ex.a1 - 0.005; a += 0.025) seg(pGrid, a, ex.b0, HF, a, ex.b1, HF);
      for (let b = ex.b0 + 0.025; b < ex.b1 - 0.005; b += 0.025) seg(pGrid, ex.a0, b, HF, ex.a1, b, HF);
      for (let a = ex.a0 + 0.05; a < ex.a1 - 0.01; a += 0.05) { seg(pCh, a, ex.b0, HF, a, ex.b0, 0); seg(pCh, a, ex.b1, HF, a, ex.b1, 0); }
      for (let b = ex.b0 + 0.05; b < ex.b1 - 0.01; b += 0.05) { seg(pCh, ex.a0, b, HF, ex.a0, b, 0); seg(pCh, ex.a1, b, HF, ex.a1, b, 0); }
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(0.2 * VA, 0.1); ctx.stroke(pGrid);
      ctx.lineWidth = 3.2; ctx.strokeStyle = rgba(0.1 * VA, 0); ctx.stroke(pCh);
      ctx.lineWidth = 1.1; ctx.strokeStyle = rgba(0.65 * VA, 0.25); ctx.stroke(pCh);

      // data conduits from the root hub to every rack, with pulses that all move in step
      const hubN = vtr.nodes[0];
      const HC = HF + 0.0012;
      const pCond = new Path2D(), pulses = [], colPulse = {};
      seg(pCond, vtr.colA[0], hubN.b0, HC, vtr.colA[2], hubN.b0, HC);
      vtr.nodes.forEach((nd) => {
        if (nd.kind !== 'folder') return;
        const ac = (nd.a0 + nd.a1) / 2, sa = nd.a0 + 0.0025, sb = nd.rb0 + 0.004;
        seg(pCond, ac, hubN.b0, HC, ac, nd.b1, HC);
        seg(pCond, ac, nd.b0, HC, sa, nd.b0, HC);
        seg(pCond, sa, nd.b0, HC, sa, sb, HC);
        const L1 = hubN.b0 - nd.b1, L2 = nd.b0 - sb, L = L1 + L2;
        const bl = [];
        for (let r = 0; r < 2; r++) {
          const s = ((ph + r * 0.5) % 1) * L;
          const b = s < L1 ? hubN.b0 - s : nd.b0 - (s - L1);
          bl.push(b);
          if (pv(s < L1 ? ac : sa, b, HC)) pulses.push(PX, PY, PK);
        }
        colPulse[nd.col] = bl;
      });

      // racks, folder headers, the hub and the file blocks
      const pRack = new Path2D(), pBox = new Path2D(), pTop = new Path2D(), pSel = new Path2D(), pSelF = new Path2D(), pLedOn = new Path2D(), pLedOff = new Path2D();
      const faces = [];
      const fsel = this._fileSel, fopen = this._fileOpen;
      vtr.nodes.forEach((nd, ni) => {
        const isSel = fsel === ni || fopen === ni;
        if (nd.kind === 'folder') {
          boxP(nd.a0, nd.a1, nd.rb0, nd.rb1, HF, -0.01);
          boxE(isSel ? pSel : pRack);
          for (let k = 0; k < vtr.nSlots; k++) {
            const b1 = vtr.slotTop - k * vtr.pitch;
            if (k > 0) {
              seg(pRack, nd.a0, b1 + 0.004, -0.01, nd.a1, b1 + 0.004, -0.01);
              seg(pRack, nd.a0, b1 + 0.004, HF, nd.a1, b1 + 0.004, HF);
            }
            if (k >= nd.count) { boxP(nd.a0 + 0.006, nd.a1 - 0.006, b1 - vtr.bh, b1, HF, HF + 0.006); boxE(pRack); }
          }
        }
        const n8 = boxP(nd.a0, nd.a1, nd.b0, nd.b1, nd.h0, nd.h1);
        boxE(isSel ? pSel : pBox);
        if (n8 === 8 && topF(isSel ? pSelF : pTop)) { pv((nd.a0 + nd.a1) / 2, (nd.b0 + nd.b1) / 2, nd.h1); faces.push([ni, PZ]); }
        if (nd.kind === 'file') {
          const bl = colPulse[nd.col] || [];
          const bc = (nd.b0 + nd.b1) / 2;
          let lit = 0;
          for (let q = 0; q < bl.length; q++) lit = Math.max(lit, Math.exp(-Math.pow((bl[q] - bc) / 0.02, 2)));
          seg(lit > 0.35 ? pLedOn : pLedOff, nd.a0 + 0.006, nd.b0, nd.h1 - 0.005, nd.a1 - 0.006, nd.b0, nd.h1 - 0.005);
          seg(pBox, nd.a0, nd.b0, nd.h0 + 0.011, nd.a1, nd.b0, nd.h0 + 0.011);
        } else if (nd.kind === 'root') {
          for (let q = 0; q < 3; q++) { const ac = vtr.colA[q]; boxP(ac - 0.008, ac + 0.008, nd.b0 - 0.004, nd.b0, HF, HF + 0.01); boxE(pBox); }
        }
      });
      ctx.lineWidth = 2.6; ctx.strokeStyle = rgba(0.08 * VA, 0); ctx.stroke(pRack);
      ctx.lineWidth = 1; ctx.strokeStyle = rgba(0.48 * VA, 0.2); ctx.stroke(pRack);
      ctx.lineWidth = 3; ctx.strokeStyle = rgba(0.1 * VA, 0); ctx.stroke(pCond);
      ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(0.55 * VA, 0.35); ctx.stroke(pCond);
      ctx.fillStyle = rgba(0.06 * VA, 0.05); ctx.fill(pTop);
      ctx.lineWidth = 3.4; ctx.strokeStyle = rgba(0.12 * VA, 0); ctx.stroke(pBox);
      ctx.lineWidth = 1.15; ctx.strokeStyle = rgba(0.85 * VA, 0.3); ctx.stroke(pBox);
      const pulseS = 0.75 + 0.25 * Math.sin(t * 5);
      ctx.fillStyle = rgba(0.14 * VA * pulseS, 0.4); ctx.fill(pSelF);
      ctx.lineWidth = 4.5; ctx.strokeStyle = rgba(0.28 * VA * pulseS, 0.3); ctx.stroke(pSel);
      ctx.lineWidth = 1.6; ctx.strokeStyle = rgba(VA, 0.8); ctx.stroke(pSel);
      ctx.lineWidth = 2.4; ctx.strokeStyle = rgba(0.25 * VA, 0.1); ctx.stroke(pLedOff);
      ctx.lineWidth = 7; ctx.strokeStyle = rgba(0.2 * VA, 0.3); ctx.stroke(pLedOn);
      ctx.lineWidth = 2.6; ctx.strokeStyle = rgba(VA, 0.85); ctx.stroke(pLedOn);

      // top faces: labels, file contents as a grid of cells, bytes, bits and bit cells
      faces.sort((p, q) => p[1] - q[1]);
      ctx.globalCompositeOperation = 'source-over';
      ctx.font = '500 10px "JetBrains Mono", monospace';
      const mEm = (ctx.measureText('M').width || 6) / 10;
      const AF = [0, 0, 0, 0, 0, 0], AC = [0, 0, 0, 0, 0, 0];
      const faceInfo = {};
      const fpj = (nd, FW, FH, x, y) => pv(nd.a0 + (nd.a1 - nd.a0) * (x / FW), nd.b1 - (nd.b1 - nd.b0) * (y / FH), nd.h1);
      const affAt = (nd, FW, FH, x, y, d, out) => {
        if (!fpj(nd, FW, FH, x, y)) return false;
        const px = PX, py = PY;
        if (!fpj(nd, FW, FH, x + d, y)) return false;
        out[0] = (PX - px) / d; out[1] = (PY - py) / d;
        if (!fpj(nd, FW, FH, x, y + d)) return false;
        out[2] = (PX - px) / d; out[3] = (PY - py) / d;
        out[4] = px; out[5] = py;
        return true;
      };
      const mapA = (A, x, y) => [A[4] + A[0] * x + A[2] * y, A[5] + A[1] * x + A[3] * y];
      const setA = (A) => ctx.setTransform(dpr * A[0], dpr * A[1], dpr * A[2], dpr * A[3], dpr * A[4], dpr * A[5]);
      const offQ = (q) => {
        const mnx = Math.min(q[0], q[2], q[4], q[6]), mxx = Math.max(q[0], q[2], q[4], q[6]);
        const mny = Math.min(q[1], q[3], q[5], q[7]), mxy = Math.max(q[1], q[3], q[5], q[7]);
        return mxx < 0 || mnx > W || mxy < 0 || mny > Hh;
      };
      const quadA = (A, x0, y0, x1, y1) => {
        const a = mapA(A, x0, y0), b = mapA(A, x1, y0), c = mapA(A, x1, y1), d = mapA(A, x0, y1);
        return [a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]];
      };
      const addQ = (path, q) => { path.moveTo(q[0], q[1]); path.lineTo(q[2], q[3]); path.lineTo(q[4], q[5]); path.lineTo(q[6], q[7]); path.closePath(); };

      const drawFace = (ni) => {
        const nd = vtr.nodes[ni];
        const FW = 400, FH = (400 * (nd.b1 - nd.b0)) / (nd.a1 - nd.a0);
        const cs = [];
        const cq = [0, 0, FW, 0, FW, FH, 0, FH];
        for (let q = 0; q < 8; q += 2) { if (!fpj(nd, FW, FH, cq[q], cq[q + 1])) return; cs.push(PX, PY); }
        if (offQ(cs)) return;
        const bx0 = Math.min(cs[0], cs[2], cs[4], cs[6]), bx1 = Math.max(cs[0], cs[2], cs[4], cs[6]);
        const by0 = Math.min(cs[1], cs[3], cs[5], cs[7]), by1 = Math.max(cs[1], cs[3], cs[5], cs[7]);
        filePicks.push({ x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0, idx: ni });
        const fwPx = Math.hypot(cs[2] - cs[0], cs[3] - cs[1]);
        faceInfo[ni] = { trx: cs[2], tr_y: cs[3], fwPx: fwPx };
        if (fwPx < 12) return;
        if (!affAt(nd, FW, FH, FW / 2, FH / 2, FW / 4, AF)) return;
        AF[4] -= AF[0] * (FW / 2) + AF[2] * (FH / 2);
        AF[5] -= AF[1] * (FW / 2) + AF[3] * (FH / 2);
        const sc = Math.hypot(AF[0], AF[1]);
        const isSelF = this._fileSel === ni, isOpenF = this._fileOpen === ni;
        const lw = (px) => px / sc;
        const fit = (size) => size * sc >= 3 && size * sc <= 1600;
        const big = fwPx > 9000;
        const scT = ((F / D) * S * (nd.a1 - nd.a0)) / FW;
        ctx.globalAlpha = VA;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const back = new Path2D();
        addQ(back, cs);
        ctx.fillStyle = 'rgba(6,6,14,0.6)'; ctx.fill(back);
        ctx.fillStyle = rgba(isOpenF ? 0.16 : isSelF ? 0.12 : 0.06, 0.05); ctx.fill(back);
        ctx.lineWidth = isSelF ? 2.2 : 1.2; ctx.strokeStyle = rgba(isSelF ? 1 : 0.8, isSelF ? 0.6 : 0.25); ctx.stroke(back);

        if (nd.kind !== 'file') {
          if (big) return;
          setA(AF);
          ctx.textBaseline = 'middle';
          const isRoot = nd.kind === 'root';
          if (!isRoot) {
            ctx.strokeStyle = rgba(0.9, 0.3); ctx.lineWidth = lw(1.6);
            ctx.beginPath(); ctx.moveTo(18, FH * 0.3); ctx.lineTo(34, FH * 0.3); ctx.lineTo(40, FH * 0.38); ctx.lineTo(62, FH * 0.38); ctx.lineTo(62, FH * 0.72); ctx.lineTo(18, FH * 0.72); ctx.closePath(); ctx.stroke();
          }
          const f1 = FH * (isRoot ? 0.32 : 0.42);
          if (fit(f1)) {
            ctx.fillStyle = rgba(1, 0.75); ctx.textAlign = 'left';
            ctx.font = '700 ' + f1.toFixed(3) + 'px Rajdhani, sans-serif';
            ctx.fillText(isRoot ? nd.path.replace('/kaivra/', 'kaivra/') : nd.name, isRoot ? 14 : 78, FH * 0.52);
          }
          const f2 = FH * (isRoot ? 0.26 : 0.3);
          if (fit(f2)) {
            ctx.textAlign = 'right'; ctx.fillStyle = rgba(0.7, 0.4);
            ctx.font = '600 ' + f2.toFixed(3) + 'px Rajdhani, sans-serif';
            ctx.fillText(isRoot ? nd.count + ' files · 3 racks' : nd.count + (nd.count === 1 ? ' file' : ' files'), FW - 14, FH * 0.52);
          }
          return;
        }

        const f = nd.file;
        const HDR = 40, X0 = 34, Y0 = HDR + 6, COLS = 76, ROWS = 24;
        const CW = (FW - X0 - 4) / COLS, RH = (FH - Y0 - 4) / ROWS;
        const cwp = CW * scT;
        const fsz = CW / mEm;
        if (!big) {
          setA(AF);
          ctx.fillStyle = rgba(0.2, 0.1); ctx.fillRect(0, 0, FW, HDR);
          ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
          if (fit(26)) {
            ctx.fillStyle = rgba(1, 0.75); ctx.font = '700 26px Rajdhani, sans-serif'; ctx.fillText(f.name, 12, 21);
            ctx.textAlign = 'right'; ctx.fillStyle = rgba(0.75, 0.4); ctx.font = '600 16px Rajdhani, sans-serif'; ctx.fillText(f.type.toUpperCase(), FW - 60, 21);
          }
          const tabOn = !!this._tabOpen[ni];
          ctx.fillStyle = rgba(tabOn ? 0.55 : 0.25, 0.3); ctx.fillRect(FW - 50, 5, 42, 30);
          ctx.strokeStyle = rgba(0.95, 0.5); ctx.lineWidth = lw(1.4); ctx.strokeRect(FW - 50, 5, 42, 30);
          if (fit(22)) { ctx.textAlign = 'center'; ctx.fillStyle = rgba(1, 0.85); ctx.font = '700 22px Rajdhani, sans-serif'; ctx.fillText('i', FW - 29, 21); }
          if (30 * sc >= 9) {
            const hq = quadA(AF, FW - 54, 0, FW, HDR);
            const hx0 = Math.min(hq[0], hq[2], hq[4], hq[6]), hy0 = Math.min(hq[1], hq[3], hq[5], hq[7]);
            uiHits.push({ x: hx0, y: hy0, w: Math.max(hq[0], hq[2], hq[4], hq[6]) - hx0, h: Math.max(hq[1], hq[3], hq[5], hq[7]) - hy0, a: 'handle', idx: ni });
          }
        }
        if (cwp < 0.9) {
          setA(AF);
          ctx.fillStyle = rgba(0.38, 0.2);
          const nL = Math.min(ROWS, f.lines.length);
          for (let l = 0; l < nL; l++) {
            const len = Math.min(COLS, f.lines[l].length);
            if (len) ctx.fillRect(X0, Y0 + l * RH + RH * 0.3, len * CW, RH * 0.42);
          }
          ctx.fillStyle = rgba(0.3, 0.6); ctx.fillRect(X0, Y0 + ph * ROWS * RH, COLS * CW, lw(1));
          return;
        }
        if (cwp < 14) {
          setA(AF);
          if (cwp >= 4) {
            const gp = new Path2D();
            for (let l = 0; l <= ROWS; l++) { gp.moveTo(X0, Y0 + l * RH); gp.lineTo(X0 + COLS * CW, Y0 + l * RH); }
            const step = cwp >= 8 ? 1 : 4;
            for (let ci = 0; ci <= COLS; ci += step) { gp.moveTo(X0 + ci * CW, Y0); gp.lineTo(X0 + ci * CW, Y0 + ROWS * RH); }
            ctx.lineWidth = lw(0.6); ctx.strokeStyle = rgba(0.16, 0.1); ctx.stroke(gp);
          }
          ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
          ctx.font = '500 ' + fsz.toFixed(3) + 'px "JetBrains Mono", monospace';
          ctx.fillStyle = rgba(0.95, 0.65);
          const nL = Math.min(ROWS, f.lines.length);
          const m = RH * sc * 2;
          for (let l = 0; l < nL; l++) {
            const yy = Y0 + l * RH + RH * 0.55;
            const p0 = mapA(AF, X0, yy), p1 = mapA(AF, X0 + COLS * CW, yy);
            if ((p0[1] < -m && p1[1] < -m) || (p0[1] > Hh + m && p1[1] > Hh + m)) continue;
            ctx.fillText(f.lines[l].slice(0, COLS), X0, yy);
          }
          ctx.fillStyle = rgba(0.4, 0.1); ctx.textAlign = 'right';
          ctx.font = '500 ' + (fsz * 0.85).toFixed(3) + 'px "JetBrains Mono", monospace';
          for (let l = 0; l < ROWS; l++) ctx.fillText(String(l + 1), X0 - 4, Y0 + l * RH + RH * 0.55);
          ctx.fillStyle = rgba(0.3, 0.6); ctx.fillRect(X0, Y0 + ph * ROWS * RH, COLS * CW, lw(1));
          return;
        }

        // close up: every character is a database cell holding one byte
        const det = AF[0] * AF[3] - AF[1] * AF[2];
        if (Math.abs(det) < 1e-12) return;
        let fx0 = 1e18, fy0 = 1e18, fx1 = -1e18, fy1 = -1e18;
        const scr = [0, 0, W, 0, W, Hh, 0, Hh];
        for (let q = 0; q < 8; q += 2) {
          const dx = scr[q] - AF[4], dy = scr[q + 1] - AF[5];
          const fx = (AF[3] * dx - AF[2] * dy) / det, fy = (-AF[1] * dx + AF[0] * dy) / det;
          if (fx < fx0) fx0 = fx; if (fx > fx1) fx1 = fx; if (fy < fy0) fy0 = fy; if (fy > fy1) fy1 = fy;
        }
        const c0 = Math.max(0, Math.floor((fx0 - X0) / CW) - 1), c1 = Math.min(COLS - 1, Math.floor((fx1 - X0) / CW) + 1);
        const r0 = Math.max(0, Math.floor((fy0 - Y0) / RH) - 1), r1 = Math.min(ROWS - 1, Math.floor((fy1 - Y0) / RH) + 1);
        const gp = new Path2D(), bOn = new Path2D(), bOff = new Path2D(), lat = new Path2D(), latOn = new Path2D();
        const subP = [new Path2D(), new Path2D(), new Path2D()];
        {
          const gx0 = Math.max(0, fx0), gx1 = Math.min(FW, fx1), gy0 = Math.max(Y0, fy0), gy1 = Math.min(FH, fy1);
          if (gx1 > gx0 && gy1 > gy0) {
            let sp = CW / 4;
            while (sp * sc > 1200) sp /= 4;
            for (let L = 0; L < 3 && sp * sc >= 10; L++, sp /= 4) {
              const P = subP[L];
              const i0 = Math.ceil(gx0 / sp), i1 = Math.floor(gx1 / sp), j0 = Math.ceil(gy0 / sp), j1 = Math.floor(gy1 / sp);
              if (i1 - i0 > 240 || j1 - j0 > 240) break;
              for (let i = i0; i <= i1; i++) { const pa = mapA(AF, i * sp, gy0), pb = mapA(AF, i * sp, gy1); P.moveTo(pa[0], pa[1]); P.lineTo(pb[0], pb[1]); }
              for (let j = j0; j <= j1; j++) { const pa = mapA(AF, gx0, j * sp), pb = mapA(AF, gx1, j * sp); P.moveTo(pa[0], pa[1]); P.lineTo(pb[0], pb[1]); }
            }
          }
        }
        const latDots = [], texts = [];
        let latBudget = 2600;
        const T_ = (A, e, s, x, y, size, weight, al, wh, align, maxPx) => {
          const px = size * e;
          if (px < 3.5 || px > (maxPx || 1600)) return;
          texts.push([A[0], A[1], A[2], A[3], A[4], A[5], s, x, y, size, weight, al, wh, align || 'center']);
        };
        const latt = (A, x0, y0, x1, y1, lvl, sd, on) => {
          if (latBudget <= 0) return;
          const q = quadA(A, x0, y0, x1, y1);
          if (offQ(q)) return;
          latBudget--;
          const sz = Math.max(Math.hypot(q[2] - q[0], q[3] - q[1]), Math.hypot(q[6] - q[0], q[7] - q[1]));
          addQ(lat, q);
          if (on && hsh(sd, lvl, 3) < 0.6) addQ(latOn, q);
          if (sz / 3 > 34 && lvl < 10) {
            for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
              latt(A, x0 + ((x1 - x0) * (i + 0.1)) / 3, y0 + ((y1 - y0) * (j + 0.1)) / 3, x0 + ((x1 - x0) * (i + 0.9)) / 3, y0 + ((y1 - y0) * (j + 0.9)) / 3, lvl + 1, sd * 1.31 + i * 7 + j * 3 + 1, on);
            }
          } else latDots.push((q[0] + q[4]) / 2, (q[1] + q[5]) / 2, Math.max(1.5, Math.min(6, sz * 0.12)));
        };
        if (fx0 < X0) {
          for (let l = r0; l <= r1; l++) {
            if (!affAt(nd, FW, FH, 4, Y0 + l * RH, RH, AC)) continue;
            const e = Math.hypot(AC[0], AC[1]);
            T_(AC, e, 'R' + String(l + 1).padStart(2, '0'), 0, RH * 0.5, Math.min(RH * 0.4, 9), '600', 0.45, 0.15, 'left');
          }
        }
        for (let l = r0; l <= r1; l++) {
          const line = f.lines[l];
          const lineLen = line == null ? -1 : line.length;
          for (let ci = c0; ci <= c1; ci++) {
            if (!affAt(nd, FW, FH, X0 + ci * CW, Y0 + l * RH, CW, AC)) continue;
            const e = Math.hypot(AC[0], AC[1]);
            const cpx = CW * e;
            const cell = quadA(AC, 0, 0, CW, RH);
            if (offQ(cell)) continue;
            addQ(gp, cell);
            let code = -1;
            if (lineLen >= 0 && ci < lineLen) code = line.charCodeAt(ci);
            else if (lineLen >= 0 && ci === lineLen) code = 10;
            if (code < 0) continue;
            const soft = code === 32 || code === 10;
            const ch = code === 10 ? '↵' : code === 32 ? '·' : line.charAt(ci);
            const hx = code.toString(16).toUpperCase().padStart(2, '0');
            if (cpx < 48) {
              T_(AC, e, ch, CW / 2, RH * 0.55, fsz, '500', soft ? 0.35 : 0.95, 0.65);
            } else if (cpx < 160) {
              T_(AC, e, ch, CW / 2, RH * 0.24, fsz * 0.62, '600', soft ? 0.4 : 0.95, 0.7);
              T_(AC, e, '0x' + hx, CW / 2, RH * 0.56, CW * 0.26, '600', 0.85, 0.5);
              T_(AC, e, code.toString(2).padStart(8, '0'), CW / 2, RH * 0.8, CW * 0.13, '500', 0.55, 0.3);
            } else {
              T_(AC, e, ch, CW * 0.26, RH * 0.13, fsz * 0.42, '600', soft ? 0.4 : 0.95, 0.7, 'center', 420);
              T_(AC, e, hx, CW * 0.74, RH * 0.13, CW * 0.22, '700', 0.85, 0.5, 'center', 300);
              if (cpx > 300) T_(AC, e, 'R' + (l + 1) + ' C' + (ci + 1) + ' · @' + ((f.offs[l] || 0) + ci), CW / 2, RH * 0.29, CW * 0.075, '500', 0.5, 0.25, 'center', 200);
              const gx0 = CW * 0.06, gy0 = RH * 0.36, bw = (CW * 0.88) / 2, bh = (RH * 0.6) / 4;
              for (let b = 0; b < 8; b++) {
                const bc = b % 2, br = (b / 2) | 0;
                const v = (code >> (7 - b)) & 1;
                const x0 = gx0 + bc * bw + bw * 0.06, y0 = gy0 + br * bh + bh * 0.08, ww = bw * 0.88, hh = bh * 0.84;
                const bq = quadA(AC, x0, y0, x0 + ww, y0 + hh);
                if (offQ(bq)) continue;
                addQ(v ? bOn : bOff, bq);
                const bpx = ww * e;
                T_(AC, e, String(v), x0 + ww / 2, y0 + hh * 0.5, hh * 0.5, '700', v ? 1 : 0.45, v ? 0.8 : 0.2, 'center', 200);
                if (bpx > 90) T_(AC, e, 'BIT ' + (7 - b) + ' = ' + v, x0 + ww / 2, y0 + hh * 0.86, hh * 0.09, '500', 0.5, 0.2, 'center', 160);
                if (bpx > 150) latt(AC, x0 + ww * 0.08, y0 + hh * 0.1, x0 + ww * 0.92, y0 + hh * 0.72, 0, code * 31 + b * 7 + l * 131 + ci * 17, v);
              }
            }
          }
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineWidth = 0.8;
        ctx.strokeStyle = rgba(0.22, 0.12); ctx.stroke(subP[0]);
        ctx.strokeStyle = rgba(0.14, 0.06); ctx.stroke(subP[1]);
        ctx.strokeStyle = rgba(0.08, 0); ctx.stroke(subP[2]);
        ctx.lineWidth = 1; ctx.strokeStyle = rgba(0.32, 0.12); ctx.stroke(gp);
        ctx.fillStyle = rgba(0.26, 0.45); ctx.fill(bOn);
        ctx.lineWidth = 1.2; ctx.strokeStyle = rgba(0.9, 0.5); ctx.stroke(bOn);
        ctx.lineWidth = 1; ctx.strokeStyle = rgba(0.35, 0.15); ctx.stroke(bOff);
        ctx.fillStyle = rgba(0.2, 0.5); ctx.fill(latOn);
        ctx.lineWidth = 0.8; ctx.strokeStyle = rgba(0.42, 0.2); ctx.stroke(lat);
        ctx.fillStyle = rgba(0.9, 0.7);
        for (let i = 0; i < latDots.length; i += 3) { const s = latDots[i + 2]; ctx.fillRect(latDots[i] - s / 2, latDots[i + 1] - s / 2, s, s); }
        ctx.textBaseline = 'middle';
        for (let i = 0; i < texts.length; i++) {
          const q = texts[i];
          ctx.setTransform(dpr * q[0], dpr * q[1], dpr * q[2], dpr * q[3], dpr * q[4], dpr * q[5]);
          ctx.textAlign = q[13];
          ctx.font = q[10] + ' ' + q[9].toFixed(4) + 'px "JetBrains Mono", monospace';
          ctx.fillStyle = rgba(q[11], q[12]);
          ctx.fillText(q[6], q[7], q[8]);
        }
      };
      for (let fi = 0; fi < faces.length; fi++) {
        ctx.save();
        drawFace(faces[fi][0]);
        ctx.restore();
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < pulses.length; i += 3) {
        const s = Math.max(2, Math.min(7, pulses[i + 2] * 0.004));
        ctx.fillStyle = rgba(0.3 * VA, 0.3); ctx.fillRect(pulses[i] - s * 1.2, pulses[i + 1] - s * 1.2, s * 2.4, s * 2.4);
        ctx.fillStyle = rgba(VA, 0.85); ctx.fillRect(pulses[i] - s / 2, pulses[i + 1] - s / 2, s, s);
      }
      ctx.globalCompositeOperation = 'source-over';

      // summary tabs, pinned beside (or on top of) their file block
      vtr.nodes.forEach((nd, ni) => {
        if (nd.kind !== 'file' || !this._tabOpen[ni]) return;
        const fc = faceInfo[ni];
        if (!fc) return;
        const f = nd.file;
        const beside = this._tabMode !== 'over';
        const TW = 220, TH = 330;
        const tw = Math.min(240, fc.fwPx * 0.62);
        if (tw < 44) return;
        const th = (tw * TH) / TW, ts = tw / TW;
        const tt = beside ? [fc.trx + 6, fc.tr_y] : [fc.trx - tw - 6, fc.tr_y + 6];
        if (tt[0] > W || tt[1] > Hh || tt[0] + tw < 0 || tt[1] + th < 0) return;
        ctx.save();
        ctx.globalAlpha = VA;
        ctx.setTransform(dpr * ts, 0, 0, dpr * ts, dpr * tt[0], dpr * tt[1]);
        ctx.fillStyle = 'rgba(8,7,16,0.85)'; ctx.fillRect(0, 0, TW, TH);
        ctx.fillStyle = rgba(0.12, 0.2); ctx.fillRect(0, 0, TW, TH);
        ctx.strokeStyle = rgba(0.95, 0.5); ctx.lineWidth = 3; ctx.strokeRect(1.5, 1.5, TW - 3, TH - 3);
        ctx.beginPath(); ctx.rect(0, 0, TW, TH); ctx.clip();
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.fillStyle = rgba(1, 0.75); ctx.font = '700 20px Rajdhani, sans-serif';
        ctx.fillText('SUMMARY', 12, 24);
        const btn = (bx, by, bw, bh, label, act) => {
          ctx.fillStyle = rgba(0.22, 0.25); ctx.fillRect(bx, by, bw, bh);
          ctx.strokeStyle = rgba(0.9, 0.45); ctx.lineWidth = 2; ctx.strokeRect(bx, by, bw, bh);
          ctx.fillStyle = rgba(1, 0.85); ctx.textAlign = 'center';
          ctx.font = '700 ' + Math.round(bh * 0.55) + 'px Rajdhani, sans-serif';
          ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
          ctx.textAlign = 'left';
          if (bh * ts >= 10) uiHits.push({ x: tt[0] + bx * ts, y: tt[1] + by * ts, w: bw * ts, h: bh * ts, a: act, idx: ni });
        };
        btn(TW - 76, 8, 32, 32, beside ? '↙' : '↗', 'move');
        btn(TW - 40, 8, 32, 32, '×', 'close');
        const rows = [['TYPE', f.type], ['SIZE', f.size], ['LINES', String(f.nLines)], ['EDITED', f.updated.split(', ')[1] + ', ' + f.updated.split(', ')[0].replace(' 2026', '')], ['PATH', f.path.replace('/kaivra/', '')]];
        let ry = 62;
        rows.forEach((r) => {
          if (ry > TH - 70) return;
          ctx.fillStyle = rgba(0.6, 0.3); ctx.font = '600 14px Rajdhani, sans-serif';
          ctx.fillText(r[0], 12, ry);
          ctx.fillStyle = rgba(1, 0.8); ctx.font = '600 17px Rajdhani, sans-serif';
          let v = r[1];
          while (ctx.measureText(v).width > TW - 24 && v.length > 4) v = '…' + v.slice(2);
          ctx.fillText(v, 12, ry + 19);
          ry += 44;
        });
        btn(12, TH - 50, TW - 24, 38, this._fileOpen === ni ? 'CLOSE FILE' : 'OPEN FILE', 'openfile');
        ctx.restore();
      });
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'lighter';
    }
    this._filePicks = filePicks;
    this._uiHits = uiHits;

    ctx.globalCompositeOperation = 'source-over';
    if (dTexts.length) {
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = rgba(0.85, 0.7);
      for (let i = 0; i < dTexts.length; i += 4) {
        const fs = Math.max(8, Math.min(16, dTexts[i + 2]));
        ctx.font = '500 ' + fs.toFixed(0) + 'px "JetBrains Mono", monospace';
        ctx.fillText(dTexts[i + 3], dTexts[i], dTexts[i + 1]);
      }
    }
    if (sel && sel !== 'core' && selSum[2] > 0 && mag < 3 && !openC) {
      const mx = selSum[0] / selSum[2], my = selSum[1] / selSum[2];
      ctx.strokeStyle = rgba(0.9, 0.8);
      ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(mx, my, 10 + 2 * Math.sin(t * 5), 0, Math.PI * 2); ctx.stroke();
    }
    const fmt = (m) => (m < 10 ? m.toFixed(1) : Math.round(m).toLocaleString('en-US')) + '×';
    ctx.font = '600 12px Rajdhani, sans-serif';
    ctx.textAlign = 'right'; ctx.textBaseline = 'top';
    ctx.fillStyle = rgba(0.9, 0.3);
    if (this._fileOpen != null) {
      ctx.fillText('FILE ' + fmt(this._fit / D) + '  /  10,000×', W - 14, 10);
    } else if ((this._open || this._focus) && this._partBase) {
      ctx.fillText('PART ' + fmt(this._partBase / D) + '  /  10,000×', W - 14, 10);
    } else if (mag > 1.05) {
      ctx.fillText('SYSTEM ' + fmt(mag) + '  /  100,000×', W - 14, 10);
    }

    this._picks = picks;
  }

  _toggle() {
    if (this._offTimer) clearTimeout(this._offTimer);
    this._activeT = !this._activeT;
    this.setState({ active: this._activeT });
    if (this._activeT) {
      this._offTimer = setTimeout(() => { this._activeT = false; this.setState({ active: false }); }, 10000);
    }
  }

  _closeOpen() {
    this._open = null; this._fileSel = null; this._fileOpen = null; this._pan = [0, 0];
    this._align = true;
    this._distTarget = this._focusBase || 1.2;
    this._partBase = this._focusBase || null;
    this.setState({ open: null, file: null, fileOpen: null });
  }

  _openFile(idx) {
    this._fileSel = idx;
    this._fileOpen = idx;
    this._pan = [0, 0];
    this._align = true;
    this._distTarget = this._fit || 0.07;
    this.setState({ file: idx, fileOpen: idx });
  }

  _closeFile() {
    this._fileOpen = null;
    this._pan = [0, 0];
    this._align = true;
    this._distTarget = this._selD || 0.15;
    this.setState({ fileOpen: null });
  }

  _tap(clientX, clientY) {
    const cv = this._canvas;
    if (!cv) { this._toggle(); return; }
    const rect = cv.getBoundingClientRect();
    const sc = (cv.clientWidth || 390) / (rect.width || 1);
    const x = (clientX - rect.left) * sc, y = (clientY - rect.top) * sc;
    const cur = (this.state && this.state.sel) || null;
    const mag = 4.6 / this._dist;

    if (this._open) {
      const ui = this._uiHits || [];
      for (let i = ui.length - 1; i >= 0; i--) {
        const h = ui[i];
        if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
          if (h.a === 'handle') { this._tabOpen[h.idx] = !this._tabOpen[h.idx]; this.setState({ tabs: Date.now() }); }
          else if (h.a === 'close') { this._tabOpen[h.idx] = false; this.setState({ tabs: Date.now() }); }
          else if (h.a === 'move') { this._tabMode = this._tabMode === 'over' ? 'beside' : 'over'; }
          else if (h.a === 'openfile') { if (this._fileOpen === h.idx) this._closeFile(); else this._openFile(h.idx); }
          return;
        }
      }
      const fps = this._filePicks || [];
      let hit = null;
      for (let i = fps.length - 1; i >= 0; i--) {
        const f = fps[i];
        if (x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h) { hit = f; break; }
      }
      if (hit) {
        const nd = this._tree && this._tree.nodes[hit.idx];
        if (this._fileOpen === hit.idx) return;
        if (nd && nd.kind === 'file') {
          if (this._fileSel === hit.idx) { this._openFile(hit.idx); return; }
          this._fileSel = hit.idx;
          this._fileOpen = null;
          this._tabOpen[hit.idx] = true;
          this._pan = [0, 0];
          this._align = true;
          this._distTarget = this._selD || 0.15;
          this.setState({ file: hit.idx, fileOpen: null });
          return;
        }
        this._fileSel = hit.idx; this._fileOpen = null; this._pan = [0, 0]; this._align = true;
        if (nd && nd.kind === 'folder') this._distTarget = Math.max(0.12, ((this._F || 460) * (nd.b1 - nd.rb0) * 1.2) / (0.9 * (this._Hc || 560)));
        else this._distTarget = this._openD || 0.36;
        this.setState({ file: hit.idx, fileOpen: null });
        return;
      }
      if (this._fileOpen != null) { this._closeFile(); return; }
      if (this._fileSel != null) { this._fileSel = null; this._pan = [0, 0]; this._align = true; this._distTarget = this._openD || 0.36; this.setState({ file: null }); return; }
      this._closeOpen();
      return;
    }

    const ch = this._coreHit;
    if (ch && mag < 4 && Math.hypot(x - ch.x, y - ch.y) < ch.r) {
      this._focus = null; this._pan = [0, 0]; this._align = false; this._partBase = null; this._focusBase = null;
      if (cur !== 'core') this.setState({ sel: 'core' });
      this._toggle();
      return;
    }
    let best = null, bestScore = Infinity;
    const picks = this._picks || [];
    for (let i = 0; i < picks.length; i++) {
      const p = picks[i];
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < 24 + Math.min(60, mag * 2)) {
        const score = d - p.z * 30;
        if (score < bestScore) { bestScore = score; best = p; }
      }
    }
    if (best) {
      if (cur === best.c && mag < 40) {
        this._open = { k: best.k, i: best.i, c: best.c };
        this._focus = { k: best.k, i: best.i };
        this._tree = this._files(best.c);
        this._vk = best.k;
        this._vf = this._vaultFrame(best);
        this._fileSel = null; this._fileOpen = null; this._tabOpen = {};
        this._pan = [0, 0];
        this._align = true;
        const vtr = this._tree, F0 = this._F || 460;
        this._openD = Math.max((F0 * 0.27) / (0.9 * (this._Wc || 390)), (F0 * (vtr.ext.b1 - vtr.ext.b0)) / (0.82 * (this._Hc || 560)));
        this._distTarget = this._openD;
        this._partBase = this._openD;
        this.setState({ open: best.c, file: null, fileOpen: null });
        return;
      }
      if (mag >= 40) return;
      this._focus = { k: best.k, i: best.i };
      this._pan = [0, 0];
      this._freeT = null; this._freeL = null;
      this._align = true;
      this._touched = true;
      this._vy = 0; this._vp = 0;
      const fpoly = this._polyRef(best);
      let span = 0.2;
      if (fpoly && fpoly.cn) { const c0 = fpoly.cn[0], c1 = fpoly.cn[1], c3 = fpoly.cn[3]; span = Math.max(Math.hypot(c1[0] - c0[0], c1[1] - c0[1], c1[2] - c0[2]), Math.hypot(c3[0] - c0[0], c3[1] - c0[1], c3[2] - c0[2])); }
      const pf = ((this._F || 460) * span) / (0.9 * (this._Wc || 390));
      const fd = Math.min(this._dist, Math.max(0.6, Math.min(1.6, pf * 2.5)));
      this._distTarget = fd; this._partBase = fd; this._focusBase = fd;
      this.setState({ sel: best.c });
      return;
    }
    if (mag > 1.5) return;
    if (cur) { this._focus = null; this._pan = [0, 0]; this._align = false; this._partBase = null; this._focusBase = null; this.setState({ sel: null }); }
    else this._toggle();
  }

  renderVals() {
    const st = this.state || {};
    const active = st.active === true;
    const sel = st.sel || null;
    const accent = this.props.accent ?? '#FF8A1F';
    let h = String(accent).replace('#', '');
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    this._rgb = isNaN(n) ? [255, 138, 31] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const cat = this._catalog();
    const info = sel && cat[sel] ? cat[sel] : null;
    let selLayer = '', selName = '', selDesc = '';
    const tr = this._tree;
    const fileNode = st.open && tr && st.file != null ? tr.nodes[st.file] : null;
    if (fileNode && fileNode.kind === 'file') {
      const f = fileNode.file;
      selLayer = f.path;
      selName = f.name;
      if (st.fileOpen === st.file) selDesc = 'Reading ' + f.name + ' (' + f.nLines + ' lines, ' + f.size + '). Pinch up to 10,000×: lines become cells, cells show their byte, bytes split into 8 bits, and each bit opens into its cell structure. Drag to move, pinch out to step back.';
      else selDesc = f.type + ' · ' + f.size + ' · ' + f.nLines + ' lines · edited ' + f.updated + '. ' + f.purpose + ' Tap the block again or OPEN FILE in its tab to read it. The i button shows or hides its tab.';
    } else if (fileNode) {
      selLayer = fileNode.path || (tr ? tr.base : '');
      selName = fileNode.name;
      selDesc = fileNode.kind === 'root' ? 'Root of this part: ' + fileNode.count + ' files in 3 racks, all fed from this hub in step. Tap a rack or a file block.' : 'Rack holding ' + fileNode.count + (fileNode.count === 1 ? ' file block' : ' file blocks') + '. Tap a block to see its summary tab; tap empty space to go back.';
    } else if (info) {
      selLayer = info[0];
      selName = info[1];
      selDesc = info[2] + (st.open ? ' Its files are built into the layer as racks of data blocks: tap a block for its summary, or tap empty space to close.' : ' Tap it again to open its data vault.');
    }
    const has = !!selName;

    const panMode = () => this._fileOpen != null || 4.6 / this._dist > 20;

    return {
      accent: accent,
      active: active,
      activeAttr: active ? 'true' : 'false',
      stateLabel: active ? 'LISTENING' : 'STANDING BY',
      coreLabel: 'Kaivra core, a 3D map of every layer. Tap the core to wake it. Tap a part to focus on it, tap it again to open its files, tap a file for its summary tab and again to read it. Drag to rotate, or to move around when zoomed in. Pinch, scroll or use plus and minus to zoom: up to 100,000 times across the system, and 10,000 times inside each part and each file. Press R to reset.',
      hasSel: has,
      noSel: !has,
      selLayer: selLayer,
      selName: selName,
      selDesc: selDesc,
      hintA: active ? 'Speak your command' : 'Tap the core to wake · Tap a part, then tap again to open it',
      hintB: 'Drag to rotate · Pinch to zoom up to 100,000×',
      canvasRef: (el) => { this._canvas = el; },
      onDown: (e) => {
        this._ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        const ids = Object.keys(this._ptrs);
        this._touched = true;
        if (ids.length === 1) {
          this._dragging = true;
          this._dragMoved = 0;
          this._lastMoveT = performance.now();
          this._vy = 0; this._vp = 0;
        } else if (ids.length === 2) {
          const a = this._ptrs[ids[0]], b = this._ptrs[ids[1]];
          this._pinchD = Math.hypot(a.x - b.x, a.y - b.y);
          this._dragMoved += 50;
          this._panning = false;
        }
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) {}
      },
      onMove: (e) => {
        if (!this._ptrs[e.pointerId]) return;
        const prev = this._ptrs[e.pointerId];
        const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
        this._ptrs[e.pointerId] = { x: e.clientX, y: e.clientY };
        const ids = Object.keys(this._ptrs);
        if (ids.length >= 2) {
          const a = this._ptrs[ids[0]], b = this._ptrs[ids[1]];
          const nd = Math.hypot(a.x - b.x, a.y - b.y);
          if (this._pinchD > 0 && nd > 0) {
            const D0 = this._dist;
            const D1 = Math.max(this._minD || 0, Math.min(7, D0 * (this._pinchD / nd)));
            this._dist = D1; this._distTarget = null;
            this._zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, D0, D1);
            if (this._focus || this._open) this._align = true;
          }
          this._pinchD = nd;
          this._dragMoved += 10;
          return;
        }
        this._dragMoved += Math.abs(dx) + Math.abs(dy);
        if (panMode()) {
          const cv = this._canvas;
          let scl = 1;
          if (cv) { const r = cv.getBoundingClientRect(); scl = (cv.clientWidth || 390) / (r.width || 1); }
          const k = this._kT || 100;
          this._pan[0] -= (dx * scl) / k;
          this._pan[1] += (dy * scl) / k;
          this._panning = true;
          this._distTarget = null;
          return;
        }
        const k = 0.0105;
        this._align = false;
        this._yaw += dx * k;
        this._pitch += dy * k;
        const now = performance.now();
        const dtm = Math.max(8, now - this._lastMoveT) / 1000;
        this._vy = Math.max(-8, Math.min(8, (dx * k) / dtm));
        this._vp = Math.max(-8, Math.min(8, (dy * k) / dtm));
        this._lastMoveT = now;
      },
      onUp: (e) => {
        delete this._ptrs[e.pointerId];
        const left = Object.keys(this._ptrs).length;
        if (left < 2) this._pinchD = 0;
        if (left === 0) {
          this._dragging = false;
          this._panning = false;
          this._upX = e.clientX; this._upY = e.clientY;
          if (performance.now() - (this._lastMoveT || 0) > 90) { this._vy = 0; this._vp = 0; }
        }
      },
      onWheel: (e) => {
        const D0 = this._dist;
        const D1 = Math.max(this._minD || 0, Math.min(7, D0 * Math.exp((e.deltaY || 0) * 0.0015)));
        this._dist = D1;
        this._distTarget = null;
        if (e.clientX != null) this._zoomAt(e.clientX, e.clientY, D0, D1);
        if (this._focus || this._open) this._align = true;
        this._touched = true;
      },
      onClick: (e) => {
        if (this._dragMoved > 8) { this._dragMoved = 0; return; }
        if (e && e.detail === 0) { this._toggle(); return; }
        this._tap(this._upX != null ? this._upX : e.clientX, this._upY != null ? this._upY : e.clientY);
      },
      onKey: (e) => {
        const step = 0.26;
        const k = this._kT || 100;
        const pm = panMode();
        if (e.key === 'ArrowLeft') { if (pm) this._pan[0] -= 60 / k; else { this._yaw -= step; this._align = false; } }
        else if (e.key === 'ArrowRight') { if (pm) this._pan[0] += 60 / k; else { this._yaw += step; this._align = false; } }
        else if (e.key === 'ArrowUp') { if (pm) this._pan[1] += 60 / k; else { this._pitch -= step; this._align = false; } }
        else if (e.key === 'ArrowDown') { if (pm) this._pan[1] -= 60 / k; else { this._pitch += step; this._align = false; } }
        else if (e.key === '+' || e.key === '=') { this._dist *= 0.7; this._distTarget = null; if (this._focus || this._open) this._align = true; }
        else if (e.key === '-' || e.key === '_') { this._dist /= 0.7; this._distTarget = null; }
        else if (e.key === 'i' || e.key === 'I') { if (this._fileSel != null) { this._tabOpen[this._fileSel] = !this._tabOpen[this._fileSel]; this.setState({ tabs: Date.now() }); } }
        else if (e.key === 'r' || e.key === 'R') { this._dist = 4.6; this._distTarget = null; this._yaw = 0; this._pitch = 0.06; this._focus = null; this._open = null; this._fileSel = null; this._fileOpen = null; this._pan = [0, 0]; this._tabOpen = {}; this._partBase = null; this._focusBase = null; this._align = false; this._freeT = null; this._freeL = null; this.setState({ sel: null, open: null, file: null, fileOpen: null }); }
        else if (e.key === 'Escape') {
          if (this._fileOpen != null) this._closeFile();
          else if (this._fileSel != null) { this._fileSel = null; this._pan = [0, 0]; this._distTarget = this._openD || 0.36; this.setState({ file: null }); }
          else if (this._open) this._closeOpen();
          else { this._focus = null; this._pan = [0, 0]; this._partBase = null; this._focusBase = null; this._align = false; this.setState({ sel: null }); }
        }
        else return;
        e.preventDefault();
        this._touched = true;
        this._vy = 0; this._vp = 0;
      }
    };
  }
}
