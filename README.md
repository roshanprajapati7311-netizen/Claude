# KAIVRA

A personal assistant that lives on your phone. It's loyal to one owner and wakes up only when that owner calls it.

**v0.1 — the core.** The home screen is the Kaivra core from the *Kaivra Home Screen* design: a 3D map of every part of Kaivra.

- **Tap the core** (the bright centre) to wake Kaivra: it switches to LISTENING, then back to STANDING BY.
- **Tap a part** to focus on it and see what it does in the card at the bottom. **Tap it again** to open its data vault.
- Inside a vault, **tap a file block** for its summary tab, and **tap again** (or OPEN FILE) to read it.
- **Pinch** to zoom: up to 100,000× across the system, and 10,000× inside a part or a file (lines → cells → bytes → bits).
- **Drag** to rotate, or to move around when zoomed in. **Tap empty space** to step back out.

## Voice

Tap the core and Kaivra says *"Kaivra online. How can I help?"*, then listens. It answers out loud, shows the conversation in the bottom card, and keeps listening until you say **stop** or stay quiet.

| Say | Kaivra |
|---|---|
| "What time is it?" / "What's the date?" / "Battery" | tells you |
| "Open YouTube" (any installed app) | opens it |
| "Show me the security guard" / "Open memory" | flies to that part / opens its vault, and describes it |
| "Who are you?" / "What can you do?" | introduces itself / lists its skills |
| "Zoom out" | back to the full view |
| "Stop" / "Go to sleep" | "Standing by." |

The first time, Android asks for microphone permission. Listening uses the phone's speech recognition (the Google app), which may need internet unless the offline English (India) pack is installed. Anything else gets an honest "I can't answer that yet": the real brain (offline + online) is the next big step.

## What's inside (outside → in)

| Belt / layer | Parts |
|---|---|
| Belt C · Devices & links | This phone, paired PC, Android TV, online brain link, GitHub builds, cloud GPU training |
| Belt B · Agents | Researcher, Scriptwriter, Designer, Editor, Learning team |
| Belt A · Plugins | Calls & SMS, Email, WhatsApp, Music, Reminders, Reel editor, Learn crawler, Code builder |
| Layer 3 · Guard | Security guard, Permission watch, Encryption, Heartbeat |
| Layer 2 · Framework | Voice engine, Voice lock, Brain models, Phone control, Master key, Change log & undo |
| Layer 1 · Data | Memory, Knowledge library, Skills, Training lessons, Soul pack |
| Layer 0 · Core | Kaivra core: brain router, rulebook, identity |

## Install on your phone

1. Open **Releases** on this repo, or go to `…/releases/latest`.
2. Download `Kaivra-v0.1.N.apk`.
3. Open the file. If Android asks, allow **Install unknown apps** for your browser.

Every push to `main` builds a new APK automatically (**Actions** tab), so no PC is needed.
If an update ever refuses to install, uninstall the old Kaivra first and then install the new one.

## How it's built

```
app/src/main/assets/core/   the core — kaivra-core.js is the design's code unchanged; main.js runs it full-screen
app/src/main/java/…/        Android shell: full-screen view, voice (text-to-speech), listening (speech recognition), vibration, opening apps
.github/workflows/          builds the APK and publishes it to Releases
```

The core talks to Android through `window.KaivraNative` (`say`, `listen`, `stop`, `vibrate`, `battery`, `openApp`, `version`); Android answers through `window.KaivraVoice.onEvent(type, text)`.
The running core is `window.KaivraCore`.

## Roadmap

- [x] Holographic core home screen: parts, vaults, files, deep zoom, tap to wake
- [x] Voice: speaks, listens, replies to simple commands, opens apps, shows parts
- [ ] Wake phrase spoken in the owner's own voice (voice lock)
- [ ] Runs in the background, including while the phone is locked
- [ ] Basics: calls, texts, email on command
- [ ] Offline brain (on-phone model) + online brain, switchable
- [ ] Memory vaults that really store data, browsable inside the hologram
- [ ] Plugin system: add features on command
- [ ] Agent team: create agents, assign work, watch them in Belt B
- [ ] Learn mode: research a topic online for a project
- [ ] Reach the owner's other devices after a one-time approval
