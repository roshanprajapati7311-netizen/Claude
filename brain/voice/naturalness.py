"""How natural Kaivra's voices sound, scored by UTMOS (an open-source naturalness predictor from University of Tokyo
researchers, trained on people's 1-5 listening scores). Used only in this test, never in the app.

Usage: naturalness.py WORK_DIR OUT.md
Scores every WAV in WORK_DIR/wav_* and WORK_DIR/sample_* and writes OUT.md plus OUT.json ({folder: mean score}).
"""
import glob, json, os, sys, time, wave
import numpy as np

work, out = sys.argv[1], sys.argv[2]
result, errors = {}, []
try:
    import torch
    torch.set_num_threads(max(1, os.cpu_count() or 1))
    model = None
    for ref in ("tarepan/SpeechMOS:v1.2.0", "tarepan/SpeechMOS"):
        try:
            model = torch.hub.load(ref, "utmos22_strong", trust_repo=True)
            break
        except Exception as e:  # try the next one
            errors.append(f"{ref}: {e}")
    if model is None:
        raise RuntimeError("could not load UTMOS")
    model.eval()
    t0 = time.time()
    dirs = sorted(d for d in os.listdir(work) if (d.startswith("wav_") or d.startswith("sample_")) and os.path.isdir(os.path.join(work, d)))
    for d in dirs:
        scores = []
        for f in sorted(glob.glob(os.path.join(work, d, "*.wav"))):
            w = wave.open(f, "rb")
            x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
            sr = w.getframerate()
            if len(x) < sr // 4:
                continue
            with torch.no_grad():
                s = float(model(torch.from_numpy(x).unsqueeze(0), sr).reshape(-1)[0])
            scores.append(s)
        if scores:
            result[d] = float(np.mean(scores))
        print(f"{d}: {result.get(d, float('nan')):.3f} ({len(scores)} files)", flush=True)
    print(f"naturalness scored in {time.time() - t0:.0f} s")
except Exception as e:
    errors.append(str(e))

lines = ["# How natural the voices sound\n", "UTMOS naturalness (1 = bad, 5 = excellent; recorded human speech usually scores about 4).\n"]
if result:
    lines += ["| voice | naturalness |", "|---|---|"]
    lines += [f"| {d} | **{v:.2f}** |" for d, v in sorted(result.items(), key=lambda kv: -kv[1])]
if errors:
    lines += ["", "Problems:", *[f"- {e}" for e in errors]]
open(out, "w").write("\n".join(lines) + "\n")
json.dump(result, open(os.path.splitext(out)[0] + ".json", "w"), indent=1)
print("\n".join(lines))
