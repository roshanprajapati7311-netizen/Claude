# KAIVRA

A personal assistant that lives on your phone. It's loyal to one owner and wakes up only when that owner calls it.

**v0.1 — the core.** The home screen is a single amber hologram with no buttons or menus.

- **Drag** to spin the core a full 360°.
- **Pinch** to zoom inside, one layer at a time, down to the kernel.
- **Tap the core** to wake Kaivra. It lights up, the blades spread out, and it says "Kaivra online." Tap again, or leave it for 12 seconds, and it goes back to standby.
- **Double-tap empty space** to reset the view.

## The layers (outside → in)

| # | Layer | Shows now | Will hold |
|---|-------|-----------|-----------|
| — | Blade satellites | 3 orbiting rings of blade panels | live status of background jobs |
| 01 | Shell | planet surface + atmosphere | the interface |
| 02 | Plugins | geodesic lattice, 12 sockets | installed plugins |
| 03 | Agents | comets on 4 orbits | the agent team and their jobs |
| 04 | Memory vaults | 20 vaults | Kaivra's stored data, one vault per area |
| 05 | Brain | offline half (below) · online half (above) | on-phone brain + online brain, switchable |
| 06 | Kernel | pulsing core | owner lock and core rules |

## Install on your phone

1. Open **Releases** on this repo, or go to `…/releases/latest`.
2. Download `Kaivra-v0.1.N.apk`.
3. Open the file. If Android asks, allow **Install unknown apps** for your browser.

Every push to `main` builds a new APK automatically (**Actions** tab), so no PC is needed.
If an update ever refuses to install, uninstall the old Kaivra first and then install the new one.

## How it's built

```
app/src/main/assets/core/   the hologram — plain HTML + canvas, no libraries, works offline
app/src/main/java/…/        Android shell: full-screen view, voice (text-to-speech), vibration
.github/workflows/          builds the APK and publishes it to Releases
```

The core talks to Android through `window.KaivraNative` (`speak`, `vibrate`, `version`).
Android can control the core through `window.Kaivra` (`activate`, `deactivate`, `zoomTo`, `setLayerInfo`).

## Roadmap

- [x] Holographic core home screen, tap to wake, voice + haptics
- [ ] Wake phrase spoken in the owner's own voice (voice lock)
- [ ] Runs in the background, including while the phone is locked
- [ ] Basics: calls, texts, email on command
- [ ] Offline brain (on-phone model) + online brain, switchable
- [ ] Memory vaults that really store data, browsable inside the hologram
- [ ] Plugin system: add features on command
- [ ] Agent team: create agents, assign work, watch them in layer 03
- [ ] Learn mode: research a topic online for a project
- [ ] Reach the owner's other devices after a one-time approval
