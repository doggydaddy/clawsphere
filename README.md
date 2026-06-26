# Clawsphere

Three.js audio visualizer with an automated text-to-speech queue.

## Project Shape

- `src/main.ts` contains the Three.js scene, audio analyser, visual effects, queue polling, and GUI controls.
- `src/styles.css` contains the page and control styling.
- `vite.config.ts` adds local API routes for queued audio files.
- `visual_settings.json` is the live visual settings file. The app polls it and applies changes while running.
- `speech2txt/whisper-mic-daemon.py` listens to microphone input, transcribes speech with Whisper, and writes text files to `speech2txt/input/`.
- `speech2txt/input/` receives microphone transcripts from the Whisper daemon.
- `txt2speech/output/` is the runtime audio queue. The visualizer plays audio files from here and removes each file after playback completes.
- `audio_script/` is where agents should save generated script/text output that is intended to become speech.
- `txt2speech/tts-watch.py` watches/handles text-to-speech generation.

## Agent Workflow

When producing new narration, prompts, test scripts, or other text that should be turned into audio, save the output in `audio_script/`.

For audio-only conversation mode, the agent is the bridge between microphone transcripts and spoken replies:

- Whisper writes incoming user speech transcripts to `speech2txt/input/`
- a Clawsphere watcher should be running whenever audio-only conversation mode is active
- the watcher/agent should poll `speech2txt/input/` every 5 seconds for new transcript files
- the agent should read those transcript files
- the agent should write spoken reply scripts to `audio_script/`
- after handling a microphone transcript, the agent should mark it as handled by renaming it to a `.mic.done` file
- the TTS watcher converts those reply scripts into audio in `txt2speech/output/`
- the visualizer plays queued audio and deletes it after playback

Do not put agent-generated speech text directly in `txt2speech/output/`; that folder is for generated audio files only and files there are deleted after playback.

Whisper currently saves microphone transcripts with names like `20260626_195253_mic.txt`. After the agent handles one of these files, it should rename it to a handled form such as `20260626_195253_mic.done`.

Use stable, descriptive filenames in `audio_script/`, for example:

```text
audio_script/scene_01_intro.txt
audio_script/test_01.txt
```

### Clawsphere Watcher / Bridge

Use the local bridge helper to monitor microphone transcripts and route them through the agent while Clawsphere is active:

```bash
python3 clawsphere-bridge.py
```

The bridge polls `speech2txt/input/` every 5 seconds, sends each new microphone transcript into the configured OpenClaw session, writes spoken reply scripts into `audio_script/`, and then renames handled microphone transcript files to `.mic.done`.

Logs and state files:

```text
state/clawsphere-bridge.log
state/clawsphere-bridge.pid
```

This bridge should remain running whenever the agent is expected to conduct audio-only conversation through Clawsphere.

## Visual Settings

Edit `visual_settings.json` to change the running visualizer without touching source code. The browser polls this file through `/api/visual-settings` about once per second.

Supported keys:

```json
{
  "sphereColor": "#3d305a",
  "particleColor": "#534ad3",
  "noiseStrength": 3,
  "audioStrength": 0.52,
  "particlePulse": 0.75,
  "orbitOpacity": 0.82,
  "orbitSpeed": 0.72,
  "orbitSmear": 1,
  "micRingOpacity": 0.86,
  "micRingRadius": 2.72,
  "micRingSensitivity": 28,
  "bloomThreshold": 0.15,
  "bloomStrength": 1.1,
  "bloomRadius": 0.72
}
```

`sphereColor` also controls the orbiting particles. Partial updates are fine; omitted keys keep their current values.

## Environment Setup

Install the browser dependencies once:

```bash
npm install
```

Create the shared Python environment and install the speech service dependencies:

```bash
uv venv .venv
uv pip install -r requirements.txt --python .venv/bin/python
```

Whisper also needs `ffmpeg` available on the system. The first run may download the selected Whisper model into `speech2txt/models/`.

Both Python services are launched through the root `.venv`; there are no separate virtual environments under `speech2txt/` or `txt2speech/`.

## Running The Visualizer

Start the local dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:5173/
```

Click `Start` to turn on both speech services and unlock browser audio playback. After that, the app polls `txt2speech/output/`, plays the next audio file, and deletes it when playback finishes. Click `Stop` to pause playback and stop both speech services.

The TTS watcher writes audio to hidden `.part` files first, then atomically renames completed audio into `txt2speech/output/`. The visualizer queue ignores hidden/temp/recently modified files, so playback only starts after the audio file is fully published.

The TTS watcher also uses `txt2speech/tts-watch.lock` to prevent duplicate watcher processes from converting the same text file twice.

The circular mic ring reacts to the Whisper daemon's live mic-status feed from `speech2txt/mic_status.json`.

The main UI includes a single `Start` / `Stop` toggle. `Start` turns on both speech services and begins the audio playback queue. `Stop` pauses playback and stops both Python daemons to reduce system usage.

## Speech To Text

Run the microphone daemon:

```bash
.venv/bin/python speech2txt/whisper-mic-daemon.py
```

It listens to the default microphone, detects speech using a volume threshold, transcribes each speech clip with local Whisper, and saves timestamped `.txt` files in:

```text
speech2txt/input/
```

Useful options:

```bash
.venv/bin/python speech2txt/whisper-mic-daemon.py --model small --language en
.venv/bin/python speech2txt/whisper-mic-daemon.py --device 1 --threshold 0.018
```

The visualizer manages the speech services through:

```text
GET  /api/system/status
POST /api/system/start
POST /api/system/stop
```

The individual compatibility endpoints still exist for the microphone daemon:

```text
GET  /api/microphone/status
POST /api/microphone/start
POST /api/microphone/stop
```

Runtime PID files:

```text
speech2txt/whisper-mic-daemon.pid
txt2speech/tts-watch.pid
```

## Verification

Run:

```bash
npm run build
```

This type-checks the TypeScript and builds the Vite app.
