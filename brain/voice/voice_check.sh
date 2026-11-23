#!/usr/bin/env bash
# Listening test for Kaivra's own voice. Open-source recognizers (Vosk) transcribe what the voice says;
# eSpeak NG is the baseline. The report goes to the voice-log branch.
# Runs from the brain workflow on the voice-lab branch, or from the app build when a commit says [voice-test].
set -o pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"      # brain/
REPO_ROOT="$(cd "$ROOT/.." && pwd)"
APP="$REPO_ROOT/app/src/main/java/com/kaivra/app"
W="$REPO_ROOT/work"; mkdir -p "$W"; W="$(cd "$W" && pwd)"

publish_report() {
  cd "$REPO_ROOT" || return
  local entries="" name path blob
  for pair in "report.md:$W/voice-report.md" "app-build.txt:$W/app-build.txt" "run.txt:$W/voice-run.txt"; do
    name="${pair%%:*}"; path="${pair#*:}"
    [ -f "$path" ] || continue
    blob=$(git hash-object -w "$path")
    entries+="100644 blob $blob"$'\t'"$name"$'\n'
  done
  [ -n "$entries" ] || return
  local tree commit
  tree=$(printf "%s" "$entries" | git mktree)
  commit=$(git -c user.name=kaivra-trainer -c user.email=kaivra-trainer@users.noreply.github.com commit-tree "$tree" -m "Voice test ${RUN_NUMBER:-${GITHUB_RUN_NUMBER:-0}}")
  git push -q -f origin "$commit:refs/heads/voice-log" && echo "report published to voice-log"
}
trap publish_report EXIT
exec > >(tee "$W/voice-run.txt") 2>&1

cd "$W"
if [ -z "$KAIVRA_FROM_GRADLE" ]; then bash "$ROOT/voice/app_check.sh" "$W" || true; fi
python3 -m venv "$W/venv" && "$W/venv/bin/pip" install --quiet vosk || { echo "could not install vosk"; exit 1; }
(sudo apt-get install -y -qq espeak-ng >/dev/null 2>&1 && echo "espeak-ng ready") || echo "no espeak-ng"
for m in vosk-model-small-en-us-0.15 vosk-model-en-us-0.22-lgraph; do
  [ -d "$m" ] || { curl -fsL --retry 3 -o "$m.zip" "https://alphacephei.com/vosk/models/$m.zip" && unzip -q "$m.zip" && rm "$m.zip"; } || echo "could not get $m"
done
[ -s cmudict.dict ] || curl -fsL --retry 3 -o cmudict.dict "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict" || echo "no dictionary"
rm -rf j wav_*; mkdir -p j
javac -encoding UTF-8 -d j "$APP/KaivraVoice.java" "$ROOT/voice/VoiceTest.java" || exit 1
DICT=cmudict.dict; [ -s cmudict.dict ] || DICT=-
mkdir -p wav_kaivra-base; java -cp j com.kaivra.app.VoiceTest "$DICT" "$ROOT/voice/sentences.txt" wav_kaivra-base 0
for f in "$ROOT"/voice/variants/*.txt; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .txt); mkdir -p "wav_kaivra-$n"
  java -cp j com.kaivra.app.VoiceTest "$DICT" "$ROOT/voice/sentences.txt" "wav_kaivra-$n" 0 "$f"
done
if command -v espeak-ng >/dev/null; then
  mkdir -p wav_espeak; i=0
  while IFS= read -r line; do espeak-ng -v en-us -s 165 -w "wav_espeak/$(printf %02d $i).wav" "$line"; i=$((i+1)); done < "$ROOT/voice/sentences.txt"
fi
"$W/venv/bin/python" "$ROOT/voice/voice_check.py" "$W" "$W/voice-report.md"
