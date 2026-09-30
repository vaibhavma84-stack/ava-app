# Earmark

An Android app that turns speech into text, entirely on the phone.

- **Input:** record in the app, open an audio file (MP3, M4A, WAV, OGG, OPUS, FLAC), or pick or share in a video (MP4, MKV, WebM, MOV, 3GP). For videos, only the sound track is used.
- **Engine:** Whisper (English-only `.en` models) running on-device via whisper.cpp. No internet needed after a one-time model download; nothing leaves the phone.
- **Output:** a timestamped transcript you can play back, search and edit, exported as plain text, text with timestamps, SRT or VTT.
- **Language:** English only for the first release.
- **Stack:** Kotlin, Jetpack Compose, Room, WorkManager, Media3, whisper.cpp (NDK). Android 9+ (API 28).

## Design

The full design, with screen mockups, architecture, model choice, edge cases and build plan, is in [`docs/design.html`](docs/design.html). Download it and open it in a browser.

## Status

Design stage. No app code yet. Next step: prove the engine (whisper.cpp running from Kotlin on a real phone, with speed and memory measured for `tiny.en`, `base.en` and `small.en`).

## Open question

Should speaker labels ("Speaker 1 / Speaker 2") be in the first release? The plan currently leaves them for later.
