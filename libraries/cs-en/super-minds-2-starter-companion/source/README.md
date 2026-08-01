# Super Minds Second Edition Starter – LexiQuest Companion

Converted to the LexiQuest Adventure Library Format 1.7 resource-only package.

## Contents

- `manifest.yaml` — package metadata and resource roots
- `adventure.yaml` — Adventure metadata and Quest references
- `quests/` — 8 Quests preserving the original lesson vocabulary scope
- `dictionary/core.yaml` — 128 vocabulary concepts with accepted Czech and English terms
- `images/` — placeholder root for images to be added later
- `audio/` — placeholder root for audio to be added later

## Runtime behavior

The package does not prescribe mandatory Challenge types or a fixed question sequence. The LexiQuest engine selects suitable question formats dynamically from child level, direction, progress, settings, and available media. Previous quiz plans are retained only under `legacyHints.nonBinding` for migration traceability.

## Media

Image and audio references point to their final package paths, but the media files are intentionally not included. Missing media must be handled fail-soft. TTS may be used where available.

## Copyright note

This is an unofficial companion library with original LexiQuest vocabulary and structure. It does not include copied textbook pages or publisher media.
