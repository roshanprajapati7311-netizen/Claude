"""Builds Kaivra's recorded voice from a CMU ARCTIC speaker (free recordings from Carnegie Mellon University).

Every recording is cut into two-sound pieces (diphones: from the middle of one speech sound to the middle of the
next). For each piece the builder stores where it is, what surrounds it (stress, word and phrase position) and how
its edges sound (MFCC spectrum, pitch, loudness), so the phone can later pick pieces that fit the sentence and join
smoothly. The audio is stored as 8-bit mu-law. Everything here is Kaivra's own code; only numpy is used.

Usage: build_units.py SPEAKER_DIR CMUDICT OUT.bin [NAME]
SPEAKER_DIR holds wav/, lab/ (sound labels), pm/ (pitch marks, optional) and etc/txt.done.data.
"""
import os, re, struct, sys
import numpy as np

SR = 16000
PAU_KEEP = 960          # keep at most 60 ms of silence next to speech
VOWELS = {"aa", "ae", "ah", "ao", "aw", "ax", "axr", "ay", "eh", "er", "ey", "ih", "ix", "iy", "ow", "oy", "uh", "uw"}
SILENCE = {"pau", "h#", "ssil", "sil", "brth"}


def read_wav(path):
    import wave
    w = wave.open(path, "rb")
    assert w.getsampwidth() == 2 and w.getnchannels() == 1
    x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    if w.getframerate() != SR:
        n = int(len(x) * SR / w.getframerate())
        x = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return x


def read_lab(path):
    """Festival label file: after '#', lines 'end_time colour phone'."""
    text = open(path, encoding="latin-1").read()
    if "#" in text:
        text = text.split("#", 1)[1]
    out, start = [], 0.0
    for line in text.split("\n"):
        p = line.split()
        if len(p) < 3:
            continue
        end = float(p[0])
        ph = p[2].lower()
        if ph in SILENCE:
            ph = "pau"
        if end > start:
            out.append([start, end, ph])
        start = end
    # merge neighbouring pauses
    merged = []
    for s, e, ph in out:
        if merged and ph == "pau" and merged[-1][2] == "pau":
            merged[-1][1] = e
        else:
            merged.append([s, e, ph])
    return merged


def read_pm(path):
    """EST pitch-mark track: times (seconds), one per line after the header."""
    if not os.path.exists(path):
        return None
    lines = open(path, encoding="latin-1").read().split("\n")
    if "EST_Header_End" in lines:
        lines = lines[lines.index("EST_Header_End") + 1:]
    t = []
    for line in lines:
        p = line.split()
        if p:
            try:
                t.append(float(p[0]))
            except ValueError:
                pass
    return np.array(t)


def own_pitch_marks(x):
    """Kaivra's own pitch marks when none come with the recording: one mark per voice period (largest peak)."""
    marks, hop, n = [], 80, len(x)
    i = 0
    while i < n - 640:
        seg = x[i:i + 640] - x[i:i + 640].mean()
        f0 = f0_at(seg)
        if f0 > 0:
            per = int(SR / f0)
            j = i + int(np.argmax(seg[:per]))
            while j < i + 640 - per // 2:
                marks.append(j)
                lo, hi = j + int(per * 0.8), min(n, j + int(per * 1.2) + 1)
                if hi <= lo:
                    break
                j = lo + int(np.argmax(x[lo:hi]))
            i = j if j > i else i + hop
        else:
            marks.append(i)
            i += hop
    return np.array(sorted(set(marks))) / SR


def f0_at(seg):
    """Pitch (Hz) of a short piece by normalized autocorrelation, 0 if unvoiced."""
    seg = seg - seg.mean()
    e = float((seg ** 2).sum())
    if e < 1e-7 * len(seg):
        return 0.0
    w = seg * np.hanning(len(seg))
    ac = np.correlate(w, w, "full")[len(w) - 1:]
    win = np.correlate(np.hanning(len(seg)), np.hanning(len(seg)), "full")[len(seg) - 1:]
    ac = ac / (ac[0] + 1e-12) / np.maximum(win / win[0], 1e-3)
    lo, hi = SR // 400, SR // 60
    k = lo + int(np.argmax(ac[lo:hi]))
    return SR / k if ac[k] > 0.5 else 0.0


# ---------------- spectrum at a point (MFCC, Kaivra's own) ----------------

def mel_bank(n_fft=512, n_mel=26):
    def mel(f):
        return 2595 * np.log10(1 + f / 700)

    def hz(m):
        return 700 * (10 ** (m / 2595) - 1)
    pts = hz(np.linspace(mel(60), mel(7800), n_mel + 2))
    bins = np.floor((n_fft + 1) * pts / SR).astype(int)
    fb = np.zeros((n_mel, n_fft // 2 + 1))
    for m in range(1, n_mel + 1):
        a, b, c = bins[m - 1], bins[m], bins[m + 1]
        for k in range(a, b):
            fb[m - 1, k] = (k - a) / max(1, b - a)
        for k in range(b, c):
            fb[m - 1, k] = (c - k) / max(1, c - b)
    return fb


FB = mel_bank()
DCT = np.array([[np.cos(np.pi * i * (j + 0.5) / 26) for j in range(26)] for i in range(14)])
HAM = np.hamming(400)


def edge_features(x, c):
    """13 MFCCs, loudness (dB) and log pitch (0 = unvoiced) of 25-40 ms around sample c."""
    a = int(c) - 200
    seg = np.zeros(400)
    lo, hi = max(0, a), min(len(x), a + 400)
    if hi > lo:
        seg[lo - a:hi - a] = x[lo:hi]
    en = 10 * np.log10((seg ** 2).mean() + 1e-10)
    pre = np.append(seg[0], seg[1:] - 0.97 * seg[:-1]) * HAM
    spec = np.abs(np.fft.rfft(pre, 512)) ** 2
    cep = DCT @ np.log(FB @ spec + 1e-8)
    a2 = int(c) - 320
    seg2 = x[max(0, a2):max(0, a2) + 640]
    f0 = f0_at(seg2) if len(seg2) >= 320 else 0.0
    return cep[1:14], en, (np.log(f0) if f0 > 0 else 0.0), f0


# ---------------- words: stress and word positions from the CMU dictionary ----------------

def load_dict(path):
    d = {}
    if path and os.path.exists(path):
        for line in open(path, encoding="latin-1"):
            p = line.split("#")[0].split()
            if len(p) >= 2 and "(" not in p[0]:
                d.setdefault(p[0].lower(), p[1:])
    return d


def read_texts(path):
    out = {}
    for line in open(path, encoding="latin-1"):
        m = re.match(r'\(\s*(\S+)\s+"(.*)"\s*\)', line.strip())
        if m:
            out[m.group(1)] = m.group(2)
    return out


def word_phones(text, cmu):
    """(phone, stress, word index) from the dictionary; phrase breaks come from the labels."""
    out = []
    words = re.findall(r"[a-z']+", text.lower())
    for wi, w in enumerate(words):
        pron = cmu.get(w) or cmu.get(w.strip("'"))
        if not pron:
            continue
        for p in pron:
            m = re.match(r"([A-Z]+)([012]?)", p)
            if m:
                out.append((m.group(1).lower(), int(m.group(2)) if m.group(2) else -1, wi))
    return out


def align(lab_phones, dict_phones):
    """Edit-distance alignment of label sounds to dictionary sounds; returns dict index (or -1) per label sound."""
    n, m = len(lab_phones), len(dict_phones)
    D = np.zeros((n + 1, m + 1))
    D[:, 0] = np.arange(n + 1)
    D[0, :] = np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            sub = 0 if lab_phones[i - 1] == dict_phones[j - 1][0] else 1
            D[i, j] = min(D[i - 1, j] + 1, D[i, j - 1] + 1, D[i - 1, j - 1] + sub)
    res = [-1] * n
    i, j = n, m
    while i > 0 and j > 0:
        sub = 0 if lab_phones[i - 1] == dict_phones[j - 1][0] else 1
        if D[i, j] == D[i - 1, j - 1] + sub:
            res[i - 1] = j - 1
            i, j = i - 1, j - 1
        elif D[i, j] == D[i - 1, j] + 1:
            i -= 1
        else:
            j -= 1
    return res


def contexts(lab, words):
    """Per label sound: stress, word index, word start/end, phrase-final word, phrase-initial word."""
    speech = [k for k, s in enumerate(lab) if s[2] != "pau"]
    idx = align([lab[k][2] for k in speech], words)
    info = [dict(stress=-1, word=-1) for _ in lab]
    for k, j in zip(speech, idx):
        if j >= 0:
            info[k]["stress"] = words[j][1] if lab[k][2] in VOWELS else -1
            info[k]["word"] = words[j][2]
        elif lab[k][2] in VOWELS:
            info[k]["stress"] = 0
    # fill missing word numbers from neighbours
    last = -1
    for k in range(len(lab)):
        if lab[k][2] == "pau":
            continue
        if info[k]["word"] < 0:
            info[k]["word"] = last if last >= 0 else 0
        last = info[k]["word"]
    for k in range(len(lab)):
        if lab[k][2] == "pau":
            continue
        prev = k - 1 if k > 0 else None
        info[k]["wstart"] = prev is None or lab[prev][2] == "pau" or info[prev]["word"] != info[k]["word"]
        nxt = k + 1 if k + 1 < len(lab) else None
        info[k]["wend"] = nxt is None or lab[nxt][2] == "pau" or info[nxt]["word"] != info[k]["word"]
    # phrase position: words touching a pause
    for k in range(len(lab)):
        if lab[k][2] == "pau":
            continue
        w = info[k]["word"]
        q = k
        while q + 1 < len(lab) and lab[q + 1][2] != "pau" and info[q + 1]["word"] == w:
            q += 1
        info[k]["pfinal"] = q + 1 >= len(lab) or lab[q + 1][2] == "pau"
        q = k
        while q - 1 >= 0 and lab[q - 1][2] != "pau" and info[q - 1]["word"] == w:
            q -= 1
        info[k]["pinit"] = q - 1 < 0 or lab[q - 1][2] == "pau"
    return info


# ---------------- the build ----------------

def build(spk_dir, dict_path, out_path, name):
    cmu = load_dict(dict_path)
    texts = read_texts(os.path.join(spk_dir, "etc", "txt.done.data"))
    utts = sorted(u for u in texts if os.path.exists(os.path.join(spk_dir, "lab", u + ".lab")))
    phones = ["pau"]
    pid = {"pau": 0}
    units, audio, utt_table = [], [], []
    cep_all = []
    offset = 0
    skipped = 0
    for ui, u in enumerate(utts):
        try:
            x = read_wav(os.path.join(spk_dir, "wav", u + ".wav"))
            lab = read_lab(os.path.join(spk_dir, "lab", u + ".lab"))
        except Exception:
            skipped += 1
            continue
        if len(lab) < 3:
            skipped += 1
            continue
        x = x - x.mean()
        pm = read_pm(os.path.join(spk_dir, "pm", u + ".pm"))
        if pm is None or len(pm) < 5:
            pm = own_pitch_marks(x)
        pms = np.round(pm * SR).astype(int)
        info = contexts(lab, word_phones(texts[u], cmu))
        for s in lab:
            if s[2] not in pid:
                pid[s[2]] = len(phones)
                phones.append(s[2])

        def snap(c, lo, hi):
            if len(pms) == 0:
                return int(c)
            k = int(np.searchsorted(pms, c))
            best = None
            for q in (k - 1, k):
                if 0 <= q < len(pms) and lo <= pms[q] <= hi:
                    if best is None or abs(pms[q] - c) < abs(best - c):
                        best = pms[q]
            return int(best) if best is not None else int(c)

        # the two edges of every sound: where a piece ending in it stops, where a piece starting with it begins
        edgeR, edgeL = [], []
        for s, e, ph in lab:
            a, b = int(s * SR), int(e * SR)
            mid = (a + b) // 2
            if ph == "pau":
                edgeR.append(min(mid, a + PAU_KEEP))
                edgeL.append(max(mid, b - PAU_KEEP))
            else:
                m = snap(mid, a + (b - a) // 4, b - (b - a) // 4)
                edgeR.append(m)
                edgeL.append(m)
        first, last = edgeL[0], edgeR[-1]
        lo, hi = max(0, first - 800), min(len(x), last + 800)
        clip = x[lo:hi]
        # loudness: the same speaking level for every sentence
        fr = clip[: len(clip) // 320 * 320].reshape(-1, 320)
        lev = np.sqrt((fr ** 2).mean(axis=1)) if len(fr) else np.array([0.1])
        ref = np.percentile(lev, 90) if len(lev) else 0.1
        clip = clip * (0.15 / max(ref, 1e-4))
        clip = np.clip(clip, -0.999, 0.999)
        mu = np.sign(clip) * np.log1p(255 * np.abs(clip)) / np.log(256)
        audio.append(np.round((mu + 1) / 2 * 255).astype(np.uint8))
        utt_table.append((offset, len(clip)))
        offset += len(clip)
        xs = clip  # features from the stored (levelled) audio
        for k in range(len(lab) - 1):
            L, R = lab[k], lab[k + 1]
            left, right = edgeL[k] - lo, edgeR[k + 1] - lo
            if right - left < 80:
                continue
            cL, enL, lf0L, f0L = edge_features(xs, left)
            cR, enR, lf0R, f0R = edge_features(xs, right)
            cep_all.append(cL)
            cep_all.append(cR)
            iL, iR = info[k], info[k + 1]
            flags = 0
            if R[2] != "pau" and iR.get("wstart"):
                flags |= 1
            if R[2] != "pau" and iR.get("pfinal"):
                flags |= 2
            if L[2] != "pau" and iL.get("pinit"):
                flags |= 4
            if L[2] != "pau" and iL.get("wend"):
                flags |= 8
            units.append(dict(
                l=pid[L[2]], r=pid[R[2]],
                pp=pid[lab[k - 1][2]] if k > 0 else 0,
                nn=pid[lab[k + 2][2]] if k + 2 < len(lab) else 0,
                utt=len(utt_table) - 1, left=left, right=right,
                perL=int(round(SR / f0L)) if f0L > 0 else 0, perR=int(round(SR / f0R)) if f0R > 0 else 0,
                sL=iL.get("stress", -1) if L[2] != "pau" else -1, sR=iR.get("stress", -1) if R[2] != "pau" else -1,
                flags=flags, lf0L=lf0L, lf0R=lf0R, enL=enL, enR=enR, cL=cL, cR=cR))
        if ui % 100 == 0:
            print(f"{ui}/{len(utts)} sentences, {len(units)} pieces", flush=True)
    cep_all = np.array(cep_all)
    std = cep_all.std(axis=0) + 1e-6
    with open(out_path, "wb") as f:
        f.write(b"KVU1")
        nm = name.encode()
        f.write(struct.pack("<iii", 1, SR, len(phones)))
        f.write(struct.pack("<B", len(nm)) + nm)
        for p in phones:
            b = p.encode()
            f.write(struct.pack("<B", len(b)) + b)
        f.write(struct.pack("<13f", *(std / 20.0)))
        f.write(struct.pack("<i", len(utt_table)))
        for o, n in utt_table:
            f.write(struct.pack("<ii", o, n))
        f.write(struct.pack("<i", len(units)))
        for u in units:
            qL = np.clip(np.round(u["cL"] / std * 20), -127, 127).astype(np.int8)
            qR = np.clip(np.round(u["cR"] / std * 20), -127, 127).astype(np.int8)
            f.write(struct.pack("<hhhhiiihhbbBBhhhh", u["l"], u["r"], u["pp"], u["nn"], u["utt"], u["left"], u["right"],
                                u["perL"], u["perR"], u["sL"], u["sR"], u["flags"], 0,
                                int(round(u["lf0L"] * 1000)), int(round(u["lf0R"] * 1000)),
                                int(round(u["enL"] * 100)), int(round(u["enR"] * 100))))
            f.write(qL.tobytes() + qR.tobytes())
        blob = np.concatenate(audio) if audio else np.zeros(0, np.uint8)
        f.write(struct.pack("<i", len(blob)))
        f.write(blob.tobytes())
    pairs = {(u["l"], u["r"]) for u in units}
    print(f"{name}: {len(utt_table)} sentences ({skipped} skipped), {offset / SR / 60:.1f} min kept, {len(units)} pieces, "
          f"{len(pairs)} different sound pairs, {len(phones)} sounds: {' '.join(phones)}")


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4] if len(sys.argv) > 4 else os.path.basename(sys.argv[1].rstrip("/")))
