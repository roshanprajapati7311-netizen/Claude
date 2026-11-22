#!/usr/bin/env bash
# Listening test for Kaivra's own voice (runs on the voice-lab branch). Report goes to the voice-log branch.
set -eo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"      # brain/
APP="$ROOT/../app/src/main/java/com/kaivra/app"
W="$ROOT/../work"; mkdir -p "$W"; W="$(cd "$W" && pwd)"
cd "$W"
python3 -m pip install --quiet vosk
(sudo apt-get install -y -qq espeak-ng >/dev/null 2>&1 && echo "espeak-ng ready") || echo "no espeak-ng"
for m in vosk-model-small-en-us-0.15 vosk-model-small-en-in-0.4 vosk-model-en-us-0.22-lgraph; do
  curl -fsL --retry 3 -o "$m.zip" "https://alphacephei.com/vosk/models/$m.zip" && unzip -q "$m.zip" && rm "$m.zip" || echo "could not get $m"
done
curl -fsL --retry 3 -o cmudict.dict "https://raw.githubusercontent.com/cmusphinx/cmudict/master/cmudict.dict" || echo "no dictionary"
mkdir -p j
javac -encoding UTF-8 -d j "$APP/KaivraVoice.java" "$ROOT/voice/VoiceTest.java"
DICT=cmudict.dict; [ -s cmudict.dict ] || DICT=-
for v in 0 2; do mkdir -p "wav_kaivra-$v"; java -cp j com.kaivra.app.VoiceTest "$DICT" "$ROOT/voice/sentences.txt" "wav_kaivra-$v" "$v"; done
if command -v espeak-ng >/dev/null; then
  mkdir -p wav_espeak; i=0
  while IFS= read -r line; do espeak-ng -v en-us -s 165 -w "wav_espeak/$(printf %02d $i).wav" "$line"; i=$((i+1)); done < "$ROOT/voice/sentences.txt"
fi
python3 "$ROOT/voice/voice_check.py" "$W" "$W/voice-report.md"
rm -rf /tmp/vlog && mkdir /tmp/vlog && cd /tmp/vlog
git init -q && git checkout -q -b voice-log
cp "$W/voice-report.md" report.md
git add -A && git -c user.name=kaivra-trainer -c user.email=kaivra-trainer@users.noreply.github.com commit -qm "Voice test ${RUN_NUMBER:-0}"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" voice-log && echo "report published to voice-log"
