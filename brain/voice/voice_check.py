"""Kaivra's ears for testing its own voice: open-source speech recognizers (Vosk) transcribe the test sentences.
Word accuracy shows how clear the voice is. eSpeak NG (a well-known robotic voice) is the baseline."""
import json, os, re, sys, time, wave
from vosk import KaldiRecognizer, Model, SetLogLevel

SetLogLevel(-1)
work, out = sys.argv[1], sys.argv[2]
sents = [l.strip() for l in open(os.path.join(os.path.dirname(__file__), "sentences.txt"), encoding="utf-8") if l.strip()]
NUM = {"4": "four", "30": "thirty", "85": "eighty five"}

def words(s):
    s = s.lower().replace("-", " ")
    return re.sub(r"[^a-z' ]", " ", s).split()

def errors(ref, hyp):
    d = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(hyp) + 1):
            cur = min(d[j] + 1, d[j - 1] + 1, prev + (ref[i - 1] != hyp[j - 1]))
            prev, d[j] = d[j], cur
    return d[len(hyp)]

def transcribe(model, path):
    w = wave.open(path, "rb")
    rec = KaldiRecognizer(model, w.getframerate())
    while True:
        data = w.readframes(4000)
        if not data:
            break
        rec.AcceptWaveform(data)
    return json.loads(rec.FinalResult()).get("text", "")

systems = [d for d in sorted(os.listdir(work)) if d.startswith("wav_")]
models = [m for m in sorted(os.listdir(work)) if m.startswith("vosk-model")]
lines = [f"# Kaivra voice listening test\n\nRun {os.environ.get('RUN_NUMBER', '')}, {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}\n"]
summary = {}
detail = []
for m in models:
    model = Model(os.path.join(work, m))
    for s in systems:
        tot = err = 0
        for i, ref in enumerate(sents):
            p = os.path.join(work, s, f"{i:02d}.wav")
            hyp = transcribe(model, p)
            r = words(ref)
            e = errors(r, hyp.split())
            tot += len(r); err += e
            detail.append(f"| {m.replace('vosk-model-', '')} | {s[4:]} | {ref} | {hyp} | {e} |")
        summary[(m, s)] = 100.0 * max(0, tot - err) / tot
lines.append("| recognizer | " + " | ".join(s[4:] for s in systems) + " |")
lines.append("|---|" + "---|" * len(systems))
for m in models:
    lines.append(f"| {m.replace('vosk-model-', '')} | " + " | ".join(f"{summary[(m, s)]:.0f}%" for s in systems) + " |")
lines.append("\nWord accuracy (higher is clearer).\n\n| recognizer | voice | said | heard | errors |\n|---|---|---|---|---|")
lines += detail
open(out, "w").write("\n".join(lines) + "\n")
print("\n".join(lines[:8]))
