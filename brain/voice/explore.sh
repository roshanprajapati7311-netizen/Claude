#!/usr/bin/env bash
# Looks inside the free CMU ARCTIC voice recordings (Carnegie Mellon University, full 0.95 release) and writes what it finds.
W="$1"; cd "$W" || exit 1
for s in rms ksp slt; do
  for u in "http://www.speech.cs.cmu.edu/cmu_arctic/packed/cmu_us_${s}_arctic-0.95-release.tar.bz2" \
           "http://festvox.org/cmu_arctic/cmu_arctic/packed/cmu_us_${s}_arctic-0.95-release.tar.bz2" \
           "http://festvox.org/cmu_arctic/packed/cmu_us_${s}_arctic-0.95-release.tar.bz2" \
           "http://www.festvox.org/cmu_arctic/cmu_arctic/packed/cmu_us_${s}_arctic-0.95-release.zip" \
           "http://festvox.org/packed/festival/2.4/voices/festvox_cmu_us_${s}_cg.tar.gz"; do
    [ -d "cmu_us_${s}_arctic" ] && break
    f=$(basename "$u")
    if curl -fsSL --retry 2 -o "$f" "$u"; then
      echo "got $u"; ls -la "$f"
      case "$f" in *.zip) unzip -q "$f" ;; *.bz2) tar xjf "$f" ;; *.gz) tar xzf "$f" ;; esac
      rm -f "$f"
    else echo "no $u"; fi
  done
done
ls -la
for d in cmu_us_*_arctic; do
  echo "=== $d"; du -sh "$d"; ls "$d" | head -40
  for sub in "$d"/*/; do echo "--- $sub: $(ls "$sub" | wc -l) files, e.g. $(ls "$sub" | head -3 | tr '\n' ' ')"; done
done
d=cmu_us_rms_arctic
echo "=== a lab file"; head -12 $d/lab/arctic_a0001.lab 2>/dev/null
echo "=== a pm file"; head -14 $d/pm/arctic_a0001.pm 2>/dev/null
echo "=== COPYING"; cat $d/COPYING 2>/dev/null | head -40
echo "=== ksp pm"; head -14 cmu_us_ksp_arctic/pm/arctic_a0001.pm 2>/dev/null
python3 - <<'PY'
import glob, wave, collections
for d in sorted(glob.glob('cmu_us_*_arctic')):
    ws = sorted(glob.glob(d + '/wav/*.wav'))
    tot = 0; rates = collections.Counter()
    for w in ws:
        f = wave.open(w); tot += f.getnframes() / f.getframerate(); rates[(f.getframerate(), f.getsampwidth(), f.getnchannels())] += 1
    ph = collections.Counter(); nl = 0
    for l in glob.glob(d + '/lab/*.lab'):
        nl += 1
        body = open(l).read().split('#', 1)[-1].split('\n')
        for line in body:
            p = line.split()
            if len(p) >= 3: ph[p[2]] += 1
    print(d, len(ws), 'wavs', round(tot / 60, 1), 'min', dict(rates), nl, 'labs')
    print('  phones:', len(ph), sorted(ph.items()))
PY
