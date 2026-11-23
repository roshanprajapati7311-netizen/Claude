#!/usr/bin/env bash
# Builds Kaivra's recorded voices from the free CMU ARCTIC recordings (Carnegie Mellon University) with
# build_units.py, speaks the test sentences and a sample with each, and publishes the voice packs to the
# voice-pack branch. Expects: work dir with venv (numpy), cmudict.dict and the compiled voice in j/.
W="$1"; ROOT="$(cd "$(dirname "$0")/.." && pwd)"; REPO_ROOT="$(cd "$ROOT/.." && pwd)"
cd "$W" || exit 1
SPEAKERS="${VOICE_SPEAKERS:-rms ksp slt}"
for s in $SPEAKERS; do
  d="cmu_us_${s}_arctic"; f="$d-0.95-release.tar.bz2"
  [ -d "$d/lab" ] || { curl -fsSL --retry 3 -o "$f" "http://festvox.org/cmu_arctic/cmu_arctic/packed/$f" && tar xjf "$f" && rm -f "$f"; } || echo "could not get $s"
done
{
  echo "Kaivra recorded voices, built by Kaivra's own code (brain/voice/build_units.py) from the CMU ARCTIC databases."
  echo "The recordings, sound labels and pitch marks are by Carnegie Mellon University; the packs are cut, levelled"
  echo "and re-encoded (8-bit mu-law) versions of them. The original notice follows."
  echo
  cat cmu_us_rms_arctic/COPYING 2>/dev/null
} > VOICE-NOTICE.txt
: > voices.txt
for s in $SPEAKERS; do
  d="cmu_us_${s}_arctic"
  [ -d "$d/lab" ] || continue
  "$W/venv/bin/python" "$ROOT/voice/build_units.py" "$d" cmudict.dict "voice-$s.bin" "$s" 2>&1 | tail -3 | tee -a voices.txt
  [ -s "voice-$s.bin" ] || continue
  gzip -9 -c "voice-$s.bin" > "voice-$s.bin.gz"
  ls -la "voice-$s.bin" "voice-$s.bin.gz" | tee -a voices.txt
  mkdir -p "wav_rec-$s" "sample-$s"
  KAIVRA_UNITS="voice-$s.bin" java -cp j com.kaivra.app.VoiceTest cmudict.dict "$ROOT/voice/sentences.txt" "wav_rec-$s" 0 2>&1 | tail -5
  KAIVRA_UNITS="voice-$s.bin" java -cp j com.kaivra.app.VoiceTest cmudict.dict "$ROOT/voice/sample.txt" "sample-$s" 0 2>&1 | tail -5
  if [ -s "sample-$s/00.wav" ]; then
    command -v ffmpeg >/dev/null || sudo apt-get install -y -qq ffmpeg >/dev/null 2>&1
    ffmpeg -y -loglevel error -i "sample-$s/00.wav" -codec:a libmp3lame -b:a 64k "sample-$s.mp3" && base64 -w0 "sample-$s.mp3" > "sample-$s.mp3.b64"
  fi
done
# publish the packs (each well under GitHub's 100 MB file limit)
cd "$REPO_ROOT" || exit 1
entries=""
for f in "$W"/voice-*.bin.gz "$W"/VOICE-NOTICE.txt; do
  [ -s "$f" ] || continue
  blob=$(git hash-object -w "$f")
  entries+="100644 blob $blob"$'\t'"$(basename "$f")"$'\n'
done
if [ -n "$entries" ]; then
  tree=$(printf "%s" "$entries" | git mktree)
  commit=$(git -c user.name=kaivra-trainer -c user.email=kaivra-trainer@users.noreply.github.com commit-tree "$tree" -m "Kaivra recorded voices")
  git push -q -f origin "$commit:refs/heads/voice-pack" && echo "voice packs published to voice-pack" | tee -a "$W/voices.txt"
fi
