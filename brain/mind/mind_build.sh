#!/usr/bin/env bash
# Builds Kaivra's thinking brain from the open model Qwen3.5-2B (Apache 2.0 licence: the owner may use, change and
# keep it): converts it from its official source with llama.cpp's converter (MIT licence), shrinks it to 4 bits
# (Q4_K_M, about 1.3 GB), tests it with the same Java code and bridge the phone runs (MindTest), and publishes it to
# the kaivra-packs release with mind.json, which the app reads. The report goes to the mind-log branch.
# Runs from the app build when a commit message says [mind-build] (brain-train.gradle.kts). With [mind-test] instead,
# it only tests the model already published, with the current code (no conversion, nothing published).
if [ -z "${GH_TOKEN:-}" ]; then
  H=$(git -C "$(dirname "$0")/../.." config --get http.https://github.com/.extraheader 2>/dev/null || true)
  if [ -n "$H" ]; then GH_TOKEN=$(printf '%s' "${H##* }" | base64 -d 2>/dev/null | cut -d: -f2- || true); export GH_TOKEN; fi
fi
set -o pipefail
REPO="${GITHUB_REPOSITORY:?}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
W="$ROOT/work-mind"; mkdir -p "$W"
LLAMA_TAG=v1.0.0
LLAMA_COMMIT=b1b770d90d94cad9e9ea5b993bdbc383a522fb28
MODEL=Qwen/Qwen3.5-2B
OUT=mind-qwen3.5-2b-q4km.gguf
STATUS=failed
START=$(date +%s)
TEST_ONLY=""
git -C "$ROOT" log -1 --format=%B | grep -q "\[mind-build\]" || TEST_ONLY=1
log() { echo "[mind $(( $(date +%s) - START ))s] $*"; }

publish_log() {
  cd "$ROOT" || return
  [ -s "$W/report.md" ] || printf '# Kaivra thinking brain build: %s\n\nSee run.txt.\n' "$STATUS" > "$W/report.md"
  local entries="" blob
  for pair in "report.md:$W/report.md" "run.txt:$W/run.txt"; do
    [ -f "${pair#*:}" ] || continue
    blob=$(git hash-object -w "${pair#*:}")
    entries+="100644 blob $blob"$'\t'"${pair%%:*}"$'\n'
  done
  local tree commit
  tree=$(printf "%s" "$entries" | git mktree)
  commit=$(git -c user.name=kaivra-trainer -c user.email=kaivra-trainer@users.noreply.github.com commit-tree "$tree" -m "Thinking brain build ${GITHUB_RUN_NUMBER:-0}: $STATUS")
  git push -q -f origin "$commit:refs/heads/mind-log" && echo "report published to mind-log"
}
trap publish_log EXIT
exec > >(tee "$W/run.txt") 2>&1

log "disk before: $(df -h / | tail -1)"
sudo rm -rf /usr/share/dotnet /opt/ghc /usr/local/.ghcup /opt/hostedtoolcache/CodeQL /usr/local/share/boost 2>/dev/null || true
log "disk after cleanup: $(df -h / | tail -1)"
cd "$W" || exit 1

# the engine and its tools, at the same fixed version the app uses
[ -d llama.cpp ] || git clone -q --depth 1 --branch "$LLAMA_TAG" https://github.com/ggml-org/llama.cpp llama.cpp || { log "could not get llama.cpp"; exit 1; }
[ "$(git -C llama.cpp rev-parse HEAD)" = "$LLAMA_COMMIT" ] || { log "llama.cpp $LLAMA_TAG is not the expected commit"; exit 1; }
if [ -z "$TEST_ONLY" ]; then
  cmake -S llama.cpp -B llama.cpp/build -DCMAKE_BUILD_TYPE=Release -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF \
    -DLLAMA_BUILD_SERVER=OFF -DLLAMA_BUILD_APP=OFF -DLLAMA_OPENSSL=OFF -DBUILD_SHARED_LIBS=OFF > /dev/null \
    && cmake --build llama.cpp/build --target llama-quantize -j"$(nproc)" > /dev/null || { log "could not build llama-quantize"; exit 1; }
fi
log "llama.cpp $LLAMA_TAG ready"

if [ -n "$TEST_ONLY" ]; then
  log "test only: using the published model"
  gh release download kaivra-packs -R "$REPO" -p "$OUT" -D . --clobber || { log "no published model to test"; exit 1; }
else
# the model, from its official source
python3 -m venv venv && . venv/bin/activate
pip install --quiet -r llama.cpp/requirements/requirements-convert_hf_to_gguf.txt huggingface_hub || { log "could not install the converter"; exit 1; }
python3 - "$MODEL" <<'PY' || { log "could not download the model"; exit 1; }
import sys
from huggingface_hub import snapshot_download
snapshot_download(sys.argv[1], local_dir="hf",
                  allow_patterns=["*.json", "*.safetensors", "*.txt", "*.jinja", "LICENSE*", "*.model", "*.tiktoken", "*.py"])
PY
du -sh hf; ls hf
cp hf/LICENSE mind-LICENSE.txt 2>/dev/null || curl -fsL -o mind-LICENSE.txt https://www.apache.org/licenses/LICENSE-2.0.txt
python3 llama.cpp/convert_hf_to_gguf.py hf --outfile mind-bf16.gguf --outtype bf16 2>&1 | tail -15 || true
[ -s mind-bf16.gguf ] || { log "could not convert the model"; exit 1; }
rm -rf hf
llama.cpp/build/bin/llama-quantize mind-bf16.gguf "$OUT" Q4_K_M 2>&1 | tail -4
rm -f mind-bf16.gguf
[ -s "$OUT" ] || { log "could not shrink the model"; exit 1; }
log "model ready: $(ls -la "$OUT")"
fi

# test it with the same Java code and bridge the phone runs (and with the internet, like the phone)
cmake -S "$ROOT/app/src/main/cpp" -B bridge -DCMAKE_BUILD_TYPE=Release -DKAIVRA_LLAMA_DIR="$W/llama.cpp" > /dev/null \
  && cmake --build bridge -j"$(nproc)" > /dev/null || { log "could not build the bridge"; exit 1; }
mkdir -p jt && javac -d jt "$ROOT/app/src/main/java/com/kaivra/app/KaivraMind.java" "$ROOT/app/src/main/java/com/kaivra/app/KaivraWeb.java" \
  "$ROOT/brain/mind/MindTest.java" || { log "could not compile the test"; exit 1; }
java -Djava.library.path=bridge -cp jt com.kaivra.app.MindTest "$OUT" "$ROOT/brain/mind/questions.txt" "$(nproc)" > report.md \
  || { log "the test failed"; cat report.md; exit 1; }
cat report.md
if [ -n "$TEST_ONLY" ]; then STATUS=ok; log "tested"; exit 0; fi

# publish: the model first, then the manifest that points the app to it
SHA=$(sha256sum "$OUT" | cut -d' ' -f1)
printf '{"file": "%s", "bytes": %s, "sha256": "%s", "version": %s, "model": "%s", "quant": "Q4_K_M", "licence": "Apache-2.0", "engine": "llama.cpp %s (MIT)"}\n' \
  "$OUT" "$(stat -c %s "$OUT")" "$SHA" "$(date +%s)" "$MODEL" "$LLAMA_TAG" > mind.json
cat mind.json
gh release view kaivra-packs -R "$REPO" >/dev/null 2>&1 || gh release create kaivra-packs -R "$REPO" --prerelease --latest=false \
  --title "Kaivra's own parts (brain, library, hearing)" --notes "Kaivra downloads its parts from here. The APK is in the other releases."
gh release upload kaivra-packs -R "$REPO" --clobber "$OUT" mind-LICENSE.txt || { log "could not upload the model"; exit 1; }
gh release upload kaivra-packs -R "$REPO" --clobber mind.json || { log "could not upload mind.json"; exit 1; }
STATUS=ok
log "done"
