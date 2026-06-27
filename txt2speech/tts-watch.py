#!/usr/bin/env python3
"""
tts-watch.py — Text-to-Speech watcher daemon
Watches ~/clawsphere/txt2transcribe for .txt files,
converts each to speech (MP3), saves to ~/clawsphere/txt2speech/output/,
then removes the original text file.

Engine priority:
  1. gTTS (Google TTS, online) — best quality
  2. espeak-ng (offline fallback) — always available if installed
"""

import os
import sys
import time
import logging
import subprocess
import fcntl
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]

# ── Config ─────────────────────────────────────────────────────────────────────
WATCH_DIR   = PROJECT_ROOT / "txt2transcribe"
OUTPUT_DIR  = PROJECT_ROOT / "txt2speech" / "output"
LOG_FILE    = PROJECT_ROOT / "txt2speech" / "tts-watch.log"
PID_FILE    = PROJECT_ROOT / "txt2speech" / "tts-watch.pid"
LOCK_FILE   = PROJECT_ROOT / "txt2speech" / "tts-watch.lock"
POLL_INTERVAL = 0.1    # seconds between directory scans
INPUT_READY_AGE = 0.05 # minimum age before considering a text file
STABLE_CHECK_INTERVAL = 0.05
GTTS_LANG     = "en"  # language code for gTTS; change to e.g. "sv" for Swedish
ESPEAK_VOICE  = "en"  # espeak-ng voice

# ── Logging ────────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)

# ── TTS engines ────────────────────────────────────────────────────────────────

def try_gtts(text: str, out_path: Path) -> bool:
    """Convert text → MP3 via gTTS (requires internet)."""
    try:
        from gtts import gTTS
        tts = gTTS(text=text, lang=GTTS_LANG)
        tts.save(str(out_path))
        return True
    except Exception as e:
        log.warning(f"gTTS failed: {e}")
        return False


def try_espeak(text: str, out_path: Path) -> bool:
    """Convert text → WAV via espeak-ng (offline)."""
    try:
        wav_path = out_path.with_suffix(".wav")
        result = subprocess.run(
            ["espeak-ng", "-v", ESPEAK_VOICE, "-w", str(wav_path), text],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            log.warning(f"espeak-ng error: {result.stderr.strip()}")
            return False
        # Rename to match expected output path (already .wav if we passed wav_path)
        if out_path.suffix.lower() == ".mp3":
            # Convert wav → mp3 with ffmpeg if available
            ff = subprocess.run(
                ["ffmpeg", "-y", "-i", str(wav_path), str(out_path)],
                capture_output=True, timeout=120,
            )
            wav_path.unlink(missing_ok=True)
            if ff.returncode != 0:
                log.warning("ffmpeg unavailable; espeak MP3 conversion failed")
                return False
        return out_path.exists()
    except FileNotFoundError:
        log.warning("espeak-ng not found on PATH")
        return False
    except Exception as e:
        log.warning(f"espeak-ng failed: {e}")
        return False


def convert(text_file: Path) -> bool:
    """Read text_file, convert to speech, save output, delete source."""
    try:
        text = text_file.read_text(encoding="utf-8").strip()
    except Exception as e:
        log.error(f"Cannot read {text_file}: {e}")
        return False

    if not text:
        log.warning(f"Empty file, skipping: {text_file.name}")
        text_file.unlink(missing_ok=True)
        return True

    ts    = datetime.now().strftime("%Y%m%d_%H%M%S")
    stem  = text_file.stem[:40].replace(" ", "_")
    out_mp3 = OUTPUT_DIR / f"{ts}_{stem}.mp3"
    temp_mp3 = OUTPUT_DIR / f".{ts}_{stem}.part.mp3"

    log.info(f"Converting: {text_file.name}  →  {out_mp3.name}")

    success = try_gtts(text, temp_mp3) or try_espeak(text, temp_mp3)

    if success:
        try:
            temp_mp3.replace(out_mp3)
        except Exception as e:
            log.error(f"Could not publish audio file {out_mp3.name}: {e}")
            temp_mp3.unlink(missing_ok=True)
            return False

        # Remove original text file
        try:
            text_file.unlink()
            log.info(f"Deleted source: {text_file.name}")
        except Exception as e:
            log.error(f"Could not delete {text_file.name}: {e}")
    else:
        temp_mp3.unlink(missing_ok=True)
        temp_mp3.with_suffix(".wav").unlink(missing_ok=True)
        log.error(f"All TTS engines failed for: {text_file.name}")

    return success


# ── Main loop ──────────────────────────────────────────────────────────────────

def is_stable_text_file(text_file: Path) -> bool:
    try:
        first = text_file.stat()
    except FileNotFoundError:
        return False

    if time.time() - first.st_mtime < INPUT_READY_AGE:
        return False

    time.sleep(STABLE_CHECK_INTERVAL)

    try:
        second = text_file.stat()
    except FileNotFoundError:
        return False

    return first.st_size == second.st_size and first.st_mtime == second.st_mtime

def main():
    # Ensure directories exist (handle case where path exists as non-dir)
    for d in (WATCH_DIR, OUTPUT_DIR):
        if d.exists() and not d.is_dir():
            log.error(f"{d} exists but is not a directory — please remove it")
            sys.exit(1)
        d.mkdir(parents=True, exist_ok=True)

    lock_handle = LOCK_FILE.open("w", encoding="utf-8")
    try:
        fcntl.flock(lock_handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        log.warning("tts-watch is already running; exiting duplicate process")
        return

    lock_handle.write(f"{os.getpid()}\n")
    lock_handle.flush()
    PID_FILE.write_text(f"{os.getpid()}\n", encoding="utf-8")
    log.info(f"tts-watch started")
    log.info(f"  Watching : {WATCH_DIR}")
    log.info(f"  Output   : {OUTPUT_DIR}")
    log.info(f"  Log      : {LOG_FILE}")
    log.info(f"  PID file : {PID_FILE}")

    seen: set[str] = set()  # track files currently being processed

    while True:
        txt_files = sorted(WATCH_DIR.glob("*.txt"))
        for tf in txt_files:
            if not is_stable_text_file(tf):
                continue
            key = f"{tf.name}:{tf.stat().st_size if tf.exists() else 0}"
            if key in seen:
                continue
            seen.add(key)
            convert(tf)
            seen.discard(key)

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("tts-watch stopped by user")
        sys.exit(0)
    finally:
        PID_FILE.unlink(missing_ok=True)
