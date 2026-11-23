"""Kaivra's ears for testing its own voice: open-source speech recognizers (Vosk) transcribe the test sentences.
Word accuracy shows how clear the voice is. eSpeak NG (a well-known robotic voice) is the baseline."""
import json, os, re, sys, time, wave
from multiprocessing import Pool, cpu_count

work, out = sys.argv[1], sys.argv[2]
sents = [l.strip() for l in open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "sentences.txt"), encoding="utf-8") if l.strip()]


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


MODEL = None


def init(path):
    global MODEL
    from vosk import Model, SetLogLevel
    SetLogLevel(-1)
    MODEL = Model(path)


def score(system):
    from vosk import KaldiRecognizer
    tot = err = 0
    heard = []
    for i, ref in enumerate(sents):
        w = wave.open(os.path.join(work, system, f"{i:02d}.wav"), "rb")
        rec = KaldiRecognizer(MODEL, w.getframerate())
        while True:
            data = w.readframes(4000)
            if not data:
                break
            rec.AcceptWaveform(data)
        hyp = json.loads(rec.FinalResult()).get("text", "")
        r = words(ref)
        e = errors(r, hyp.split())
        tot += len(r)
        err += e
        heard.append((ref, hyp, e))
    return system, 100.0 * max(0, tot - err) / tot, heard


if __name__ == "__main__":
    systems = [d for d in sorted(os.listdir(work)) if d.startswith("wav_")]
    models = [m for m in sorted(os.listdir(work)) if m.startswith("vosk-model")]
    lines = [f"# Kaivra voice listening test\n\nRun {os.environ.get('RUN_NUMBER', '')}, {time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime())}\n"]
    summary, detail = {}, []
    for m in models:
        with Pool(min(len(systems), cpu_count()), initializer=init, initargs=(os.path.join(work, m),)) as pool:
            for s, acc, heard in pool.map(score, systems):
                summary[(m, s)] = acc
                detail += [f"| {m.replace('vosk-model-', '')} | {s[4:]} | {ref} | {hyp} | {e} |" for ref, hyp, e in heard]
    mean = {s: sum(summary[(m, s)] for m in models) / max(1, len(models)) for s in systems}
    order = sorted(systems, key=lambda s: -mean[s])
    lines.append("| voice | average | " + " | ".join(m.replace('vosk-model-', '') for m in models) + " |")
    lines.append("|---|---|" + "---|" * len(models))
    for s in order:
        lines.append(f"| {s[4:]} | **{mean[s]:.0f}%** | " + " | ".join(f"{summary[(m, s)]:.0f}%" for m in models) + " |")
    lines.append("\nWord accuracy (higher is clearer).\n\n| recognizer | voice | said | heard | errors |\n|---|---|---|---|---|")
    lines += detail
    open(out, "w").write("\n".join(lines) + "\n")
    json.dump(mean, open(os.path.splitext(out)[0] + ".json", "w"), indent=1)
    print("\n".join(lines[:4 + len(systems)]))
