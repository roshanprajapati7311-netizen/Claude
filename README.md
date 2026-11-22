# KAIVRA

A personal assistant that lives on your phone. It's loyal to one owner and wakes up only when that owner calls it.
**Everything Kaivra thinks, says and hears is its own:** no Google, no OpenAI, no Anthropic, no big company inside.

| Part | What it is | Made by |
|---|---|---|
| **Brain** | A transformer neural network written from scratch (`brain/`), with its own tokenizer, hand-written backpropagation and its own trainer. It runs on the phone in pure Java (`KaivraBrain.java`). | This project |
| **Training** | Every night on GitHub's free computers, continuing from the night before (`brain/ci.sh`). Progress: the `brain-log` branch. | This project |
| **Knowledge library** | Facts from Simple English Wikipedia, cleaned and indexed by our own code (`brain/data.py`), searched offline on the phone (`KaivraLibrary.java`). | Text: Wikipedia volunteers (Wikimedia, nonprofit). Code: this project |
| **Voice** | A formant speech synthesizer written from scratch (`KaivraVoice.java`): text → sounds → timing and melody → a simulated voice and vocal tract. | This project. Pronunciations: CMU Pronouncing Dictionary (Carnegie Mellon University) |
| **Hearing** | Vosk, open-source offline speech recognition, Indian English model. | Alpha Cephei (open source, Apache 2.0) |
| **Home screen** | The holographic core from the *Kaivra Home Screen* design. | This project |

The only outside pieces are Android itself and GitHub, which builds the app and stores Kaivra's parts.

## The home screen

- **Tap the core** (the bright centre) to wake Kaivra. It says *"Kaivra online. How can I help?"* and listens.
- **Tap a part** to focus on it and see what it does. **Tap it again** to open its data vault; tap a file block to read it.
- **Pinch** to zoom (up to 100,000×), **drag** to rotate or move, **tap empty space** to step back out.
- Can't speak right now? Tap the **keyboard** button and type. The speaker button next to the box mutes the voice.

## What you can say or type

| Say or type | Kaivra |
|---|---|
| "What time is it?" / "What's the date?" / "Battery" | tells you |
| "What is 12 times 7?" / "25 plus 17" | works it out |
| "Open YouTube" (any installed app) | opens it |
| "Call Mom" / "Text Rahul saying I'm on my way" | calls / opens the message ready to send |
| "Go home" / "Open notifications" / "Quick settings" / "Recent apps" / "Lock the phone" / "Take a screenshot" | does it (needs Phone control) |
| "Torch on" / "Torch off" / "Volume up" / "Volume down" | does it |
| "Show me the security guard" / "Open memory" | flies to that part of the core and describes it |
| "Change voice" / "Mute" / "Unmute" | switches between Kaivra's own voices / text only / voice back |
| "Permissions" / "Download your parts" | opens the Access screen |
| "What is a black hole?" / "Who was Gandhi?" / "How are you?" | answered by Kaivra's own brain and knowledge library |
| "Stop" | "Standing by." |

## First start

1. Install the APK from **Releases** (`Kaivra-v0.1.N.apk`).
2. Kaivra opens its **Access** screen (also the shield button, top right):
   - **Kaivra's own parts → DOWNLOAD** gets the brain, knowledge library and hearing (about 55 MB, once). After that everything works offline. Tap again after a training night to get the newest brain.
   - **ALLOW ALL** for microphone, contacts, calls and notifications.
   - **Phone control**: Settings → Accessibility → *Kaivra phone control* → on. If Android calls it a *restricted setting*: App info → ⋮ → *Allow restricted settings*.

## How the brain learns

`brain/` holds all of it, in plain Python and NumPy:

- `tokenizer.py`: byte-level BPE tokenizer, trained from scratch.
- `model.py`: the transformer (RMSNorm, rotary positions, SwiGLU), its backward pass written by hand, AdamW, and the export to the phone format (int8).
- `data.py`: downloads Simple English Wikipedia, cleans the wiki markup with our own parser, builds the knowledge library and the training text, including question-and-answer practice.
- `talk.py`: Kaivra's own conversations: who it is, how it talks, what it can and cannot do yet.
- `train.py`: trains for a time budget, resumes from the last checkpoint, writes sample answers.
- `ci.sh`: the nightly run; publishes `brain.bin`, the library and the hearing model to the **kaivra-packs** release, where the app downloads them.

The brain is small (about 7 million parameters) and starts out weak. It gets a little better every night; the `brain-log` branch shows its history and sample answers. For facts it reads from its knowledge library, so answers about things in Simple Wikipedia are right from the start.

## How it's built

```
app/src/main/assets/core/   the home screen: kaivra-core.js is the design's code unchanged; main.js runs it and talks to Android
app/src/main/java/…/        Android: MainActivity (screen, voice playback, hearing, phone access), Packs (downloads Kaivra's parts),
                            KaivraBrain, KaivraLibrary, KaivraVoice, KaivraControlService (phone control)
brain/                      the brain's code and the nightly training; brain/voice/ is the listening test for the voice
.github/workflows/          build-apk.yml builds the APK on every push; kaivra-brain.yml trains the brain every night
```

## Roadmap

- [x] Holographic core home screen: parts, vaults, files, deep zoom, tap to wake
- [x] Typing, Access screen, phone control (home, back, notifications, lock, screenshot), calls, texts, torch, volume
- [x] Own brain, trained from scratch every night, with its own knowledge library
- [x] Own voice, written from scratch; offline open-source hearing
- [ ] Hindi and Bengali (brain, voice and hearing)
- [ ] Wake phrase spoken in the owner's own voice (voice lock), running in the background
- [ ] Reminders, email, WhatsApp on command
- [ ] Memory vaults that really store data, browsable inside the hologram
- [ ] Plugin system, agent team, learn mode
- [ ] Reach the owner's other devices after a one-time approval
