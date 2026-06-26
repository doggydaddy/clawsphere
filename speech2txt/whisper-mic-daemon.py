#!/usr/bin/env python3
"""
whisper-mic-daemon.py - Microphone speech-to-text watcher daemon.

Continuously listens to the default microphone, groups speech into short clips,
transcribes each clip with local Whisper, and writes text files to:

  speech2txt/input/

Install dependencies:

  python -m pip install -r speech2txt/requirements.txt

Whisper also requires ffmpeg to be installed on the system.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import queue
import sys
import tempfile
import time
import wave
from datetime import datetime
from pathlib import Path

import numpy as np
import sounddevice as sd
import whisper


PROJECT_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_DIR = PROJECT_ROOT / "speech2txt" / "input"
LOG_FILE = PROJECT_ROOT / "speech2txt" / "whisper-mic-daemon.log"
MODEL_DIR = PROJECT_ROOT / "speech2txt" / "models"
MIC_STATUS_FILE = PROJECT_ROOT / "speech2txt" / "mic_status.json"
PID_FILE = PROJECT_ROOT / "speech2txt" / "whisper-mic-daemon.pid"

SAMPLE_RATE = 16_000
CHANNELS = 1
BLOCK_SECONDS = 0.25
SILENCE_SECONDS_TO_FLUSH = 1.1
MIN_CLIP_SECONDS = 0.8
MAX_CLIP_SECONDS = 30.0
RMS_THRESHOLD = 0.006
DEFAULT_MODEL = "base"
STATUS_SAMPLE_COUNT = 192
STATUS_WRITE_INTERVAL = 0.1


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe microphone input with Whisper.")
    parser.add_argument("--model", default=DEFAULT_MODEL, help="Whisper model name, e.g. tiny, base, small.")
    parser.add_argument("--language", default=None, help="Optional language code, e.g. en or sv.")
    parser.add_argument("--device", default=None, help="Optional sounddevice input device name or index.")
    parser.add_argument("--threshold", type=float, default=RMS_THRESHOLD, help="RMS threshold for speech detection.")
    parser.add_argument("--silence", type=float, default=SILENCE_SECONDS_TO_FLUSH, help="Seconds of silence before transcribing.")
    parser.add_argument("--max-clip", type=float, default=MAX_CLIP_SECONDS, help="Maximum clip length before forced transcription.")
    return parser.parse_args()


def rms(samples: np.ndarray) -> float:
    if samples.size == 0:
        return 0.0

    return float(np.sqrt(np.mean(np.square(samples, dtype=np.float32))))


def write_mic_status(samples: np.ndarray, block_rms: float) -> None:
    if samples.size == 0:
        return

    sample_indexes = np.linspace(0, samples.size - 1, STATUS_SAMPLE_COUNT).astype(np.int64)
    waveform = np.clip(samples[sample_indexes], -1.0, 1.0).round(4).tolist()
    payload = {
        "updatedAt": time.time(),
        "rms": round(block_rms, 6),
        "waveform": waveform,
    }
    temp_path = MIC_STATUS_FILE.with_suffix(".json.tmp")
    temp_path.write_text(json.dumps(payload), encoding="utf-8")
    temp_path.replace(MIC_STATUS_FILE)


def write_wav(samples: np.ndarray, wav_path: Path) -> None:
    clipped = np.clip(samples, -1.0, 1.0)
    pcm = (clipped * 32767).astype(np.int16)

    with wave.open(str(wav_path), "wb") as wav_file:
        wav_file.setnchannels(CHANNELS)
        wav_file.setsampwidth(2)
        wav_file.setframerate(SAMPLE_RATE)
        wav_file.writeframes(pcm.tobytes())


def save_transcript(text: str) -> Path | None:
    cleaned = " ".join(text.strip().split())
    if not cleaned:
        return None

    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = OUTPUT_DIR / f"{timestamp}_mic.txt"
    suffix = 1

    while out_path.exists():
        out_path = OUTPUT_DIR / f"{timestamp}_mic_{suffix:02d}.txt"
        suffix += 1

    out_path.write_text(f"{cleaned}\n", encoding="utf-8")
    return out_path


def transcribe_clip(model: whisper.Whisper, samples: np.ndarray, language: str | None) -> None:
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as temp_file:
        wav_path = Path(temp_file.name)

    try:
        write_wav(samples, wav_path)
        log.info("Transcribing %.2f seconds of audio", len(samples) / SAMPLE_RATE)
        result = model.transcribe(str(wav_path), language=language, fp16=False)
        text = str(result.get("text", "")).strip()
        out_path = save_transcript(text)

        if out_path:
            log.info("Saved transcript: %s", out_path)
        else:
            log.info("Whisper returned no text; skipping output file")
    except Exception as error:
        log.exception("Transcription failed: %s", error)
    finally:
        wav_path.unlink(missing_ok=True)


def main() -> int:
    args = parse_args()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(f"{os.getpid()}\n", encoding="utf-8")

    log.info("Loading Whisper model: %s", args.model)
    model = whisper.load_model(args.model, download_root=str(MODEL_DIR))
    audio_queue: queue.Queue[np.ndarray] = queue.Queue()

    def callback(indata: np.ndarray, frames: int, time_info, status: sd.CallbackFlags) -> None:
        del frames, time_info
        if status:
            log.warning("Audio input status: %s", status)
        audio_queue.put(indata.copy().reshape(-1))

    blocksize = int(SAMPLE_RATE * BLOCK_SECONDS)
    frames_buffer: list[np.ndarray] = []
    clip_seconds = 0.0
    silence_seconds = 0.0
    speech_started = False

    log.info("whisper-mic-daemon started")
    log.info("  Output   : %s", OUTPUT_DIR)
    log.info("  Log      : %s", LOG_FILE)
    log.info("  Mic JSON : %s", MIC_STATUS_FILE)
    log.info("  PID file : %s", PID_FILE)
    log.info("  Device   : %s", args.device if args.device is not None else "default")
    log.info("  Threshold: %.4f", args.threshold)

    last_status_write = 0.0

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        dtype="float32",
        blocksize=blocksize,
        device=args.device,
        callback=callback,
    ):
        while True:
            block = audio_queue.get()
            block_rms = rms(block)
            now = time.time()
            if now - last_status_write >= STATUS_WRITE_INTERVAL:
                write_mic_status(block, block_rms)
                last_status_write = now

            is_speech = block_rms >= args.threshold

            if is_speech:
                speech_started = True
                silence_seconds = 0.0

            if speech_started:
                frames_buffer.append(block)
                clip_seconds += len(block) / SAMPLE_RATE

                if not is_speech:
                    silence_seconds += len(block) / SAMPLE_RATE

            should_flush = (
                speech_started
                and clip_seconds >= MIN_CLIP_SECONDS
                and silence_seconds >= args.silence
            ) or (speech_started and clip_seconds >= args.max_clip)

            if not should_flush:
                continue

            samples = np.concatenate(frames_buffer)
            frames_buffer.clear()
            clip_seconds = 0.0
            silence_seconds = 0.0
            speech_started = False
            transcribe_clip(model, samples, args.language)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log.info("whisper-mic-daemon stopped by user")
        raise SystemExit(0)
    finally:
        PID_FILE.unlink(missing_ok=True)
