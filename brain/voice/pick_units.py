"""Picks the best settings for a recorded voice: the most natural-sounding variant (UTMOS) among those that stay
nearly as clear as the clearest one (Vosk word accuracy). Without naturalness scores, the clearest one wins.

Usage: pick_units.py WORK_DIR SPEAKER VARIANTS_DIR
Prints the winning variant name; writes WORK_DIR/best-units.txt (its settings) and WORK_DIR/pick.md.
"""
import json, os, shutil, sys

work, spk, vdir = sys.argv[1], sys.argv[2], sys.argv[3]


def load(name):
    try:
        return json.load(open(os.path.join(work, name)))
    except Exception:
        return {}


acc, nat = load("voice-report.json"), load("naturalness.json")
prefix = f"wav_rec-{spk}-"
names = sorted(os.path.splitext(f)[0] for f in os.listdir(vdir) if f.endswith(".txt"))
rows = []
for n in names:
    a = acc.get(prefix + n)
    m = nat.get(prefix + n)
    s = nat.get(f"sample_rec-{spk}-{n}")
    if a is not None:
        rows.append((n, a, m, s))
best = "d-both" if "d-both" in names else (names[0] if names else "")
if rows:
    top = max(r[1] for r in rows)
    ok = [r for r in rows if r[1] >= top - 5]
    if any(r[2] is not None for r in ok):
        best = max(ok, key=lambda r: (r[2] or 0) + 0.5 * (r[3] or r[2] or 0))[0]
    else:
        best = max(ok, key=lambda r: (r[1], r[0] == "d-both"))[0]
lines = [f"# Settings for the {spk} voice\n", "| settings | clarity | naturalness (tests) | naturalness (sample) |", "|---|---|---|---|"]
for n, a, m, s in sorted(rows, key=lambda r: -((r[2] or 0) + 0.5 * (r[3] or r[2] or 0))):
    lines.append(f"| {n}{' (picked)' if n == best else ''} | {a:.0f}% | {'' if m is None else f'{m:.2f}'} | {'' if s is None else f'{s:.2f}'} |")
open(os.path.join(work, "pick.md"), "w").write("\n".join(lines) + "\n")
if best:
    shutil.copy(os.path.join(vdir, best + ".txt"), os.path.join(work, "best-units.txt"))
print(best)
