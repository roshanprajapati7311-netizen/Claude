#!/usr/bin/env bash
# Looks inside the free CMU ARCTIC voice recordings (Carnegie Mellon University) and writes what it finds.
W="$1"; cd "$W" || exit 1
for s in rms ksp slt bdl; do
  f="cmu_us_${s}_arctic.tar.bz2"
  [ -d "cmu_us_${s}_arctic" ] || { curl -fsSL --retry 3 -o "$f" "http://festvox.org/cmu_arctic/packed/$f" && ls -la "$f" && tar xjf "$f" && rm -f "$f"; } || echo "could not get $s"
done
for d in cmu_us_*_arctic; do
  echo "=== $d"; du -sh "$d"; ls "$d" | head -30
  for sub in "$d"/*/; do echo "--- $sub: $(ls "$sub" | wc -l) files, e.g. $(ls "$sub" | head -3 | tr '\n' ' ')"; done
done
d=cmu_us_rms_arctic
echo "=== txt.done.data"; head -3 $d/etc/txt.done.data 2>/dev/null; wc -l $d/etc/txt.done.data 2>/dev/null
echo "=== a lab file"; head -15 $d/lab/arctic_a0001.lab 2>/dev/null
echo "=== COPYING"; head -40 $d/COPYING 2>/dev/null
python3 - <<'PY'
import glob, wave, collections, os
for d in sorted(glob.glob('cmu_us_*_arctic')):
    ws = sorted(glob.glob(d + '/wav/*.wav'))
    tot = 0; rates = collections.Counter()
    for w in ws:
        try:
            f = wave.open(w); tot += f.getnframes() / f.getframerate(); rates[(f.getframerate(), f.getsampwidth(), f.getnchannels())] += 1
        except Exception as e: rates[str(e)[:40]] += 1
    ph = collections.Counter()
    for l in glob.glob(d + '/lab/*.lab'):
        body = open(l).read().split('#', 1)[-1].split('\n')
        for line in body:
            p = line.split()
            if len(p) >= 3: ph[p[2]] += 1
    print(d, len(ws), 'wavs', round(tot / 60, 1), 'min', dict(rates))
    print('  phones:', len(ph), sorted(ph.items()))
PY
