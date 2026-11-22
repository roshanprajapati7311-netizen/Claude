#!/usr/bin/env bash
# Kaivra's nightly training on GitHub's free computers (run by .github/workflows/kaivra-brain.yml).
#  1. builds the training data and knowledge library from Simple English Wikipedia (only when needed)
#  2. trains the brain, continuing from last night's checkpoint
#  3. publishes brain, library and hearing to the "kaivra-packs" release, where the app downloads them
#  4. writes the run's log to the brain-log branch
set -eo pipefail
if [ "${GITHUB_REF_NAME:-}" = "voice-lab" ]; then exec bash "$(dirname "$0")/voice/voice_check.sh"; fi
REPO="${GITHUB_REPOSITORY:?}"
TAG="kaivra-packs"
ROOT="$(cd "$(dirname "$0")" && pwd)"
W="$ROOT/../work"
mkdir -p "$W"
W="$(cd "$W" && pwd)"
START=$(date +%s)
STATUS="failed"
exec > >(tee -a "$W/ci.log") 2>&1
log() { echo "[ci $(( $(date +%s) - START ))s] $*"; }

publish_log() {
  set +e
  log "status: $STATUS"
  sleep 1
  rm -rf /tmp/kaivra-log && mkdir -p /tmp/kaivra-log && cd /tmp/kaivra-log || return
  git init -q && git checkout -q -b brain-log
  git remote add origin "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"
  if git fetch -q --depth 1 origin brain-log 2>/dev/null; then git checkout -q FETCH_HEAD -- . 2>/dev/null; fi
  cp "$W/ci.log" latest-run.txt
  for f in samples.txt train_stats.json data_stats.json data_samples.txt; do [ -f "$W/$f" ] && cp "$W/$f" "$f"; done
  [ -f history.md ] || printf '# Kaivra brain training history\n\n| run | date (UTC) | result | total steps | tokens seen | validation loss |\n|---|---|---|---|---|---|\n' > history.md
  python3 - "$W" "$STATUS" "${RUN_NUMBER:-0}" >> history.md <<'PY'
import json, os, sys, time
w, status, run = sys.argv[1:4]
st = {}
p = os.path.join(w, "train_stats.json")
if os.path.exists(p) and status == "ok":
    st = json.load(open(p))
print(f"| {run} | {time.strftime('%Y-%m-%d %H:%M')} | {status} | {st.get('steps', '')} | "
      f"{round(st['tokens'] / 1e6, 1) if 'tokens' in st else ''}M | {st.get('val_loss', '')} |")
PY
  git add -A
  git -c user.name="kaivra-trainer" -c user.email="kaivra-trainer@users.noreply.github.com" commit -qm "Training run ${RUN_NUMBER:-0}: $STATUS"
  git push -q -f origin brain-log && echo "log published to the brain-log branch"
}
trap publish_log EXIT

cd "$ROOT"
python3 -m pip install --quiet numpy
python3 -c "import numpy; print('numpy', numpy.__version__)"
nproc; free -g | head -2

if ! gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  log "creating the $TAG release"
  gh release create "$TAG" -R "$REPO" --prerelease --latest=false --title "Kaivra's own parts (brain, library, hearing)" \
    --notes "Kaivra downloads its brain, knowledge library and hearing from here. Updated after every training night. The APK is in the other releases."
fi
ASSETS=$(gh release view "$TAG" -R "$REPO" --json assets -q '.assets[].name')
have() { echo "$ASSETS" | grep -qx "$1"; }
get() { gh release download "$TAG" -R "$REPO" -p "$1" -D "$W" --clobber; }
put() { gh release upload "$TAG" -R "$REPO" --clobber "$@"; }

DV=$(python3 -c "import json; print(json.load(open('config.json'))['data_version'])")
CORPUS="corpus-v$DV.bin"

# ---- 1. training data and knowledge library ----
if have tokenizer.json; then get tokenizer.json; fi
if have "$CORPUS" && have "library-v$DV.bin.gz" && have tokenizer.json; then
  log "reusing $CORPUS and the library"
  get "$CORPUS"
  get "library-v$DV.bin.gz"
  if have data_stats.json; then get data_stats.json; fi
  cp "$W/$CORPUS" "$W/corpus.bin"
  gunzip -c "$W/library-v$DV.bin.gz" > "$W/library.bin"
else
  log "downloading Simple English Wikipedia"
  ok=""
  for url in \
    "https://dumps.wikimedia.org/simplewiki/latest/simplewiki-latest-pages-articles.xml.bz2" \
    "https://ftp.acc.umu.se/mirror/wikimedia.org/dumps/simplewiki/latest/simplewiki-latest-pages-articles.xml.bz2" \
    "https://dumps.wikimedia.your.org/simplewiki/latest/simplewiki-latest-pages-articles.xml.bz2"; do
    if curl -fL --retry 4 --retry-delay 10 -o "$W/simplewiki.xml.bz2" "$url"; then ok=1; break; fi
  done
  [ -n "$ok" ] || { log "could not download the dump"; exit 1; }
  ls -la "$W/simplewiki.xml.bz2"
  TOK=""
  [ -f "$W/tokenizer.json" ] && TOK="--tokenizer $W/tokenizer.json"
  python3 data.py --dump "$W/simplewiki.xml.bz2" --out "$W" $TOK
  rm -f "$W/simplewiki.xml.bz2"
  cp "$W/corpus.bin" "$W/$CORPUS"
  gzip -9 -c "$W/library.bin" > "$W/library-v$DV.bin.gz"
  log "uploading the data"
  put "$W/tokenizer.json" "$W/$CORPUS" "$W/library-v$DV.bin.gz" "$W/data_stats.json"
  for old in $(echo "$ASSETS" | grep -E '^(corpus|library)-v[0-9]+\.bin(\.gz)?$' | grep -v -e "$CORPUS" -e "library-v$DV.bin.gz" || true); do
    gh release delete-asset "$TAG" "$old" -R "$REPO" -y || true
  done
fi
cat "$W/data_stats.json" 2>/dev/null || true

# ---- 2. hearing (open-source Vosk model for Indian English, Apache 2.0) ----
if ! have hearing-en-in.zip; then
  log "fetching the hearing model"
  curl -fL --retry 4 -o "$W/hearing-en-in.zip" "https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip"
  put "$W/hearing-en-in.zip"
else
  get hearing-en-in.zip
fi

# ---- 3. training ----
if have ckpt.npz; then get ckpt.npz; fi
ELAPSED=$(( ($(date +%s) - START) / 60 ))
MINUTES=$(python3 -c "import json; print(max(5, min(float(json.load(open('config.json'))['train_minutes']), 320 - $ELAPSED)))")
log "training for $MINUTES minutes"
python3 train.py --work "$W" --minutes "$MINUTES"
cat "$W/samples.txt"

# ---- 4. publish ----
gzip -9 -c "$W/brain.bin" > "$W/brain.bin.gz"
python3 - "$W" "$DV" > "$W/packs.json" <<'PY'
import hashlib, json, os, sys, time
w, dv = sys.argv[1], sys.argv[2]
def info(name, **extra):
    p = os.path.join(w, name)
    h = hashlib.sha256(open(p, "rb").read()).hexdigest()
    return dict(file=name, bytes=os.path.getsize(p), sha256=h, **extra)
st = json.load(open(os.path.join(w, "train_stats.json")))
ds = json.load(open(os.path.join(w, "data_stats.json"))) if os.path.exists(os.path.join(w, "data_stats.json")) else {}
print(json.dumps(dict(
    version=1, updated=time.strftime("%Y-%m-%dT%H:%MZ", time.gmtime()),
    brain=info("brain.bin.gz", version=st["steps"], steps=st["steps"], tokens=st["tokens"], val_loss=st["val_loss"], trained=st["trained"]),
    library=info(f"library-v{dv}.bin.gz", version=int(dv), articles=ds.get("leads")),
    hearing=info("hearing-en-in.zip", version=1, model="vosk-model-small-en-in-0.4"),
), indent=1))
PY
cat "$W/packs.json"
log "uploading the brain"
put "$W/ckpt.npz" "$W/brain.bin.gz"
put "$W/packs.json"
STATUS="ok"
log "done"
