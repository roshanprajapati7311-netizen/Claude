# KAIVRA

A personal assistant that lives on your phone. It's loyal to one owner and wakes up only when that owner calls it.

**v0.1 — the core.** The home screen is the Kaivra core from the *Kaivra Home Screen* design: a 3D map of every part of Kaivra.

- **Tap the core** (the bright centre) to wake Kaivra: it switches to LISTENING, then back to STANDING BY.
- **Tap a part** to focus on it and see what it does in the card at the bottom. **Tap it again** to open its data vault.
- Inside a vault, **tap a file block** for its summary tab, and **tap again** (or OPEN FILE) to read it.
- **Pinch** to zoom: up to 100,000× across the system, and 10,000× inside a part or a file (lines → cells → bytes → bits).
- **Drag** to rotate, or to move around when zoomed in. **Tap empty space** to step back out.

## Voice and typing

Tap the core and Kaivra says *"Kaivra online. How can I help?"*, then listens. It answers out loud, shows the conversation in the bottom card, and keeps listening until you say **stop** or stay quiet.

Can't speak right now? Tap the **keyboard** button and type instead. Typed commands get the same answers; the speaker button next to the box mutes Kaivra's voice so it replies in text only.

| Say or type | Kaivra |
|---|---|
| "What time is it?" / "What's the date?" / "Battery" | tells you |
| "Open YouTube" (any installed app) | opens it |
| "Call Mom" / "Text Rahul saying I'm on my way" | calls / opens the message ready to send |
| "Go home" / "Open notifications" / "Quick settings" / "Recent apps" | does it (needs Phone control) |
| "Lock the phone" / "Take a screenshot" | does it (needs Phone control) |
| "Torch on" / "Torch off" / "Volume up" / "Volume down" | does it |
| "Show me the security guard" / "Open memory" | flies to that part / opens its vault, and describes it |
| "Change voice" | switches to the next voice on the phone and remembers it |
| "Say your name as Kai-vraa" | changes how the voice pronounces *Kaivra* |
| "Mute" / "Unmute" | text-only replies / voice back on |
| "Permissions" | opens the Access screen |
| "What can you do?" / "Stop" | lists its skills / "Standing by." |
| Anything else ("What is a black hole?", "Help me write a poem") | answered by the online brain |

Listening uses the phone's speech recognition (the Google app), which may need internet unless the offline English (India) pack is installed. For better voices: Settings → Text-to-speech → Speech Services by Google → install voice data → English (India).

## Online brain

Anything that isn't a built-in command goes to Kaivra's online brain, so it can answer questions, explain things and help with work, and it remembers the last few exchanges of the conversation.

1. Get a free key at [Google AI Studio](https://aistudio.google.com/apikey) (sign in → **Create API key** → copy).
2. In Kaivra: shield button → **Online brain** → paste the key → **SAVE**. Or say "connect brain".

The key is stored only on the phone. Free Gemini keys have rate limits, and Google may use free-tier conversations to improve its products. A Claude key (starting `sk-ant-`, paid) also works. Next step on the roadmap: an offline brain that runs on the phone itself.

## Access

On first launch Kaivra opens its **Access** screen (also the shield button, top right). Android only lets an app reach the phone with the owner's OK, so each kind of access is approved once:

- **Microphone, Contacts, Phone calls, Notifications**: tap **ALLOW ALL**.
- **Phone control**: Settings → Accessibility → *Kaivra phone control* → on. If Android calls it a *restricted setting*: App info → ⋮ → *Allow restricted settings*, then turn it on.

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
app/src/main/java/…/        Android shell: full-screen view, voice, listening, device access, phone control service, online brain (Brain.kt)
.github/workflows/          builds the APK and publishes it to Releases
```

The core talks to Android through `window.KaivraNative` (`say`, `listen`, `stop`, `nextVoice`, `accessStatus`, `requestAccess`, `call`, `text`, `control`, `torch`, `volume`, `vibrate`, `battery`, `openApp`, `setBrainKey`, `brainStatus`, `ask`, `openUrl`, `version`); Android answers through `window.KaivraVoice.onEvent(type, text)`.
The running core is `window.KaivraCore`.

## Roadmap

- [x] Holographic core home screen: parts, vaults, files, deep zoom, tap to wake
- [x] Voice: speaks, listens, replies to simple commands, opens apps, shows parts
- [x] Typing, voice choice, name pronunciation, Access screen, phone control (home, back, notifications, lock, screenshot), calls, texts, torch, volume
- [ ] Wake phrase spoken in the owner's own voice (voice lock)
- [ ] Runs in the background, including while the phone is locked
- [ ] Basics: email, WhatsApp, reminders on command
- [x] Online brain (Gemini free key, or Claude) with conversation memory
- [ ] Offline brain (on-phone model), switchable with the online brain
- [ ] Memory vaults that really store data, browsable inside the hologram
- [ ] Plugin system: add features on command
- [ ] Agent team: create agents, assign work, watch them in Belt B
- [ ] Learn mode: research a topic online for a project
- [ ] Reach the owner's other devices after a one-time approval
