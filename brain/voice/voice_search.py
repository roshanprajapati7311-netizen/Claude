"""Kaivra tunes its own voice.

It tries small changes to the voice settings, listens to the result with an open-source speech recognizer
(Vosk) and keeps a change only when more words come through correctly (hill climbing, the recognizer is the
judge). It practises on practice.txt and is checked on sentences.txt, which it never practises on, so a better
score on the check means the voice really got clearer and did not just learn the practice sentences.

Usage: voice_search.py WORK_DIR MINUTES
WORK_DIR must hold the compiled voice (j/), the Vosk models and (optionally) cmudict.dict.
Writes best.txt (the changes), best-settings.txt (every setting), search.md (the report) into WORK_DIR.
"""
import json, os, random, re, shutil, subprocess, sys, tempfile, time, wave
from multiprocessing import Pool, cpu_count

WORK, MINUTES = os.path.abspath(sys.argv[1]), float(sys.argv[2])
HERE = os.path.dirname(os.path.abspath(__file__))
PRACTICE, CHECK = os.path.join(HERE, "practice.txt"), os.path.join(HERE, "sentences.txt")
J = os.path.join(WORK, "j")
DICT = os.path.join(WORK, "cmudict.dict")
if not (os.path.exists(DICT) and os.path.getsize(DICT) > 0):
    DICT = "-"
SMALL = os.path.join(WORK, "vosk-model-small-en-us-0.15")
BIG = os.path.join(WORK, "vosk-model-en-us-0.22-lgraph")

# What may change: (setting, "*" multiply or "+" add, lowest, highest, typical step, whole numbers?)
SPACE = [
    ("global.ASP_AH", "*", 0.4, 2.5, 0.2, False), ("global.HH_AH", "*", 0.4, 2.5, 0.2, False),
    ("global.BURST_GAIN", "*", 0.25, 3.0, 0.25, False), ("global.PAR_GAIN", "*", 0.5, 2.0, 0.12, False),
    ("global.VOICE_BAR", "*", 0.0, 3.0, 0.4, False), ("global.VOT_STRESSED", "+", -6, 6, 1.5, True),
    ("global.VOT_UNSTRESSED", "+", -4, 5, 1.5, True), ("global.BURST_FRAMES", "+", -1, 3, 1, True),
    ("global.CLOSURE_LEN", "*", 0.6, 1.6, 0.1, False), ("global.SMOOTH_F1", "+", -2, 3, 1, True),
    ("global.SMOOTH_F23", "+", -3, 3, 1, True), ("global.SMOOTH_AV", "+", -1, 2, 1, True),
    ("global.NASAL_SPREAD", "+", -6, 6, 2, True), ("global.V_STRESS1", "*", 0.8, 1.35, 0.06, False),
    ("global.V_STRESS0", "*", 0.8, 1.4, 0.06, False), ("global.CONS_LEN", "*", 0.8, 1.4, 0.06, False),
    ("global.FINAL_LEN", "*", 0.8, 1.3, 0.06, False), ("global.TILT", "+", -0.3, 0.25, 0.05, False),
    ("global.OQ", "+", -0.2, 0.15, 0.04, False), ("global.NASAL_ZERO_BW", "*", 0.5, 3.0, 0.3, False),
    ("global.F4", "*", 0.9, 1.12, 0.02, False), ("global.CLUSTER", "*", 0.8, 1.2, 0.05, False),
    ("global.ONSET_RAMP", "+", -5, 6, 1.5, True),
]
for p in ("P", "B", "T", "D", "M", "N", "L", "R", "W", "F", "V", "TH", "S", "SH"):
    SPACE += [(p + ".f2", "*", 0.8, 1.25, 0.05, False)]  # where the tongue and lips point the formants
for p in ("M", "N", "NG"):
    SPACE += [(p + ".av", "*", 0.4, 1.4, 0.1, False), (p + ".dur", "*", 0.7, 1.5, 0.1, False),
              (p + ".zero", "*", 0.7, 1.4, 0.06, False)]
for p in ("P", "T", "K", "B", "D", "G", "CH", "JH"):
    SPACE += [(p + ".par", "+", -12, 12, 3, False), (p + ".dur", "*", 0.7, 1.5, 0.1, False)]
for p in ("F", "TH", "S", "SH", "V", "DH", "Z", "ZH"):
    SPACE += [(p + ".par", "+", -12, 12, 3, False), (p + ".dur", "*", 0.7, 1.5, 0.1, False)]
for p in ("V", "DH", "Z", "ZH"):
    SPACE += [(p + ".av", "*", 0.3, 3.0, 0.3, False)]
for p in ("W", "Y", "R", "L"):
    SPACE += [(p + ".av", "*", 0.6, 1.3, 0.08, False), (p + ".dur", "*", 0.7, 1.5, 0.1, False)]
SPACE += [("HH.dur", "*", 0.7, 1.5, 0.1, False), ("DX.dur", "*", 0.7, 1.6, 0.1, False)]
BY_KEY = {s[0]: s for s in SPACE}


def ident(key):
    return 1.0 if BY_KEY[key][1] == "*" else 0.0


def spec(params):
    out = []
    for k, v in sorted(params.items()):
        if abs(v - ident(k)) > 1e-9:
            out.append(f"{k} {BY_KEY[k][1]}= {v:.4g}")
    return "\n".join(out) + "\n"


WEIGHT = {s[0]: 1.0 for s in SPACE}  # settings whose changes helped get tried more often


def mutate(params, scale):
    p = dict(params)
    keys = list(WEIGHT)
    for _ in range(random.choice((1, 1, 2, 2, 3))):
        key, op, lo, hi, step, whole = BY_KEY[random.choices(keys, weights=[WEIGHT[k] for k in keys])[0]]
        cur = p.get(key, ident(key))
        new = cur + random.gauss(0, step * scale)
        if whole:
            new = round(new)
            if new == cur:
                new = cur + random.choice((-1, 1))
        p[key] = min(hi, max(lo, new))
    return p


def words(s):
    return re.sub(r"[^a-z' ]", " ", s.lower().replace("-", " ")).split()


def edits(ref, hyp):
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


def transcribe(path):
    from vosk import KaldiRecognizer
    w = wave.open(path, "rb")
    rec = KaldiRecognizer(MODEL, w.getframerate())
    rec.SetWords(True)
    while True:
        data = w.readframes(4000)
        if not data:
            break
        rec.AcceptWaveform(data)
    r = json.loads(rec.FinalResult())
    return r.get("text", ""), [x.get("conf", 0.0) for x in r.get("result", [])]


def evaluate(job):
    """Speaks the sentences with these settings and scores what the recognizer heard."""
    tag, settings, sentfile, wavdir = job
    d = wavdir or tempfile.mkdtemp(dir=WORK, prefix="try_")
    os.makedirs(d, exist_ok=True)
    sf = os.path.join(d, "settings.txt")
    with open(sf, "w") as f:
        f.write(settings)
    r = subprocess.run(["java", "-cp", J, "com.kaivra.app.VoiceTest", DICT, sentfile, d, "0", sf],
                       stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
    if r.returncode != 0:
        return tag, None
    sents = [l.strip() for l in open(sentfile, encoding="utf-8") if l.strip()]
    err = tot = 0
    confs, heard = [], []
    for i, ref in enumerate(sents):
        text, conf = transcribe(os.path.join(d, f"{i:02d}.wav"))
        rw = words(ref)
        err += edits(rw, text.split())
        tot += len(rw)
        confs += conf
        heard.append(text)
    if not wavdir:
        shutil.rmtree(d, ignore_errors=True)
    acc = max(0.0, 1 - err / tot)
    mconf = sum(confs) / len(confs) if confs else 0.0
    return tag, {"score": acc + 0.02 * mconf, "acc": acc, "conf": mconf, "heard": heard}


def check(model, jobs):
    with Pool(min(len(jobs), cpu_count()), initializer=init, initargs=(model,)) as pool:
        return dict(pool.map(evaluate, jobs))


def main():
    random.seed(int(time.time()))
    n = max(2, cpu_count())
    t_end = time.time() + MINUTES * 60
    log = []
    best = {}
    with Pool(n, initializer=init, initargs=(SMALL,)) as pool:
        _, res = pool.map(evaluate, [("base", spec(best), PRACTICE, None)])[0]
        if res is None:
            print("the voice did not run")
            return
        base_acc = res["acc"]
        best_res = res
        print(f"start: practice accuracy {100 * res['acc']:.1f}%", flush=True)
        gen = tries = stale = 0
        momentum = {}
        while time.time() < t_end:
            gen += 1
            scale = 1.0 if stale < 6 else 0.6 if stale < 15 else 1.5
            cands = [mutate(best, scale) for _ in range(n)]
            if momentum:  # the last step helped: try going a bit further the same way
                c = dict(best)
                for k, d in momentum.items():
                    lo, hi, whole = BY_KEY[k][2], BY_KEY[k][3], BY_KEY[k][5]
                    v = best[k] + d
                    c[k] = min(hi, max(lo, round(v) if whole else v))
                cands[0] = c
            results = pool.map(evaluate, [(i, spec(c), PRACTICE, None) for i, c in enumerate(cands)])
            tries += len(cands)
            top = max((r for r in results if r[1] is not None), key=lambda r: r[1]["score"], default=None)
            if top and top[1]["score"] > best_res["score"] + 1e-6:
                old = best
                best, best_res = cands[top[0]], top[1]
                changed = [k for k in best if abs(best[k] - old.get(k, ident(k))) > 1e-9]
                momentum = {k: best[k] - old.get(k, ident(k)) for k in changed}
                for k in changed:
                    WEIGHT[k] += 1.0
                line = f"try {tries}: {100 * best_res['acc']:.1f}% ({', '.join(f'{k} {BY_KEY[k][1]} {best[k]:.3g}' for k in changed)})"
                log.append(line)
                print(line, flush=True)
                stale = 0
            else:
                stale += 1
                momentum = {}
            if gen % 10 == 0:
                print(f"... {tries} tries, best practice accuracy {100 * best_res['acc']:.1f}%", flush=True)
    with open(os.path.join(WORK, "best.txt"), "w") as f:
        f.write("# Kaivra voice tuning result: changes to the built-in settings\n" + spec(best))
    subprocess.run(["java", "-cp", J, "com.kaivra.app.VoiceTest", DICT, CHECK, tempfile.mkdtemp(dir=WORK), "0",
                    os.path.join(WORK, "best.txt"), os.path.join(WORK, "best-settings.txt")],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # the real check: sentences it never practised on, with two recognizers
    table = []
    detail = []
    systems = [("before tuning", spec({}), os.path.join(WORK, "chk_base")), ("after tuning", spec(best), os.path.join(WORK, "chk_best"))]
    for model in (SMALL, BIG):
        if not os.path.isdir(model):
            continue
        jobs = [(name, s, CHECK, d) for name, s, d in systems]
        res = check(model, jobs)
        mname = os.path.basename(model).replace("vosk-model-", "")
        for name, _, _ in systems:
            r = res.get(name)
            if r:
                table.append((mname, name, r["acc"]))
                sents = [l.strip() for l in open(CHECK, encoding="utf-8") if l.strip()]
                for ref, h in zip(sents, r["heard"]):
                    detail.append(f"| {mname} | {name} | {ref} | {h} |")
    lines = ["# Kaivra voice tuning", "",
             f"{tries} tries in {MINUTES:.0f} minutes. Practice sentences: {100 * base_acc:.1f}% before, {100 * best_res['acc']:.1f}% after.", "",
             "## Check on sentences it never practised on", "", "| recognizer | voice | words right |", "|---|---|---|"]
    lines += [f"| {m} | {n_} | **{100 * a:.0f}%** |" for m, n_, a in table]
    lines += ["", "## Changes kept", ""] + [f"- {l}" for l in log] + ["", "## Final changes", "", "```", spec(best).strip(), "```", "",
              "## What it heard", "", "| recognizer | voice | said | heard |", "|---|---|---|---|"] + detail
    with open(os.path.join(WORK, "search.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines[:12 + len(table)]))


if __name__ == "__main__":
    main()
