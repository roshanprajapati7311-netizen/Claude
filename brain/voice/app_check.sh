#!/usr/bin/env bash
# Builds the Android app on the voice-lab branch and keeps the errors, so problems can be read without signing in.
# Writes $1/app-build.txt
W="$1"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$W" || exit 0
if [ ! -x gradle-8.11.1/bin/gradle ]; then
  curl -fsSL --retry 3 -o gradle.zip https://services.gradle.org/distributions/gradle-8.11.1-bin.zip && unzip -q gradle.zip && rm gradle.zip
fi
cd "$ROOT"
"$W/gradle-8.11.1/bin/gradle" assembleDebug --no-daemon --console=plain > "$W/app-build-full.txt" 2>&1
code=$?
{
  echo "gradle exit code: $code"
  echo
  grep -nE "^e: |error:|What went wrong|FAILED|Could not|Unresolved|Exception|BUILD SUCCESSFUL|BUILD FAILED" -A4 "$W/app-build-full.txt" | head -200
  echo
  echo "---- last lines ----"
  tail -80 "$W/app-build-full.txt"
} > "$W/app-build.txt"
ls -la "$ROOT/app/build/outputs/apk/debug/" >> "$W/app-build.txt" 2>&1
echo "app build exit $code"
