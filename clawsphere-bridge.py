#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
INPUT_DIR = ROOT / 'speech2txt' / 'input'
OUTPUT_DIR = ROOT / os.environ.get('CLAWSPHERE_REPLY_DIR', 'txt2transcribe')
STATE_DIR = ROOT / 'state'
LOG_FILE = STATE_DIR / 'clawsphere-bridge.log'
PID_FILE = STATE_DIR / 'clawsphere-bridge.pid'
POLL_SECONDS = float(os.environ.get('CLAWSPHERE_BRIDGE_POLL_SECONDS', '0.25'))
SESSION_KEY = 'agent:main:main'

SYSTEM_PROMPT = (
    'This message came from Clawsphere microphone input. '
    'Respond appropriately for Clawsphere audio-only conversation. '
    'Your reply should be concise, natural speech. '
    'Do not mention webchat or internal tooling. '
    'If no reply is warranted, reply with exactly NO_REPLY.'
)


def log(message: str) -> None:
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().astimezone().isoformat(timespec='seconds')
    with LOG_FILE.open('a', encoding='utf-8') as handle:
        handle.write(f'[{timestamp}] {message}\n')


def session_send(message: str) -> str:
    result = subprocess.run(
        [
            'openclaw',
            'agent',
            '--session-key',
            SESSION_KEY,
            '--message',
            f'{SYSTEM_PROMPT}\n\nTranscript:\n{message}',
            '--json',
            '--timeout',
            '120',
        ],
        capture_output=True,
        text=True,
        cwd=str(ROOT),
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or 'openclaw agent failed')

    stdout = result.stdout.strip()
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f'Could not parse agent output: {stdout}') from error

    response = data.get('reply') or data.get('message') or data.get('content') or ''
    if isinstance(response, dict):
        response = response.get('text', '')
    if not isinstance(response, str):
        response = str(response)
    return response.strip()


def write_reply(text: str) -> Path:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    path = OUTPUT_DIR / f'{timestamp}_clawsphere_reply.txt'
    temp_path = path.with_name(f'.{path.name}.part')
    temp_path.write_text(text.strip() + '\n', encoding='utf-8')
    temp_path.replace(path)
    return path


def mark_done(path: Path) -> Path:
    target = path.with_suffix('').with_suffix('.mic.done') if path.name.endswith('_mic.txt') else path.with_suffix('.done')
    path.rename(target)
    return target


def read_text(path: Path) -> str:
    return path.read_text(encoding='utf-8').strip()


def is_ready_transcript(path: Path) -> bool:
    if path.name.startswith('.') or '.part' in path.name:
        return False

    try:
        first = path.stat()
    except FileNotFoundError:
        return False

    time.sleep(0.05)

    try:
        second = path.stat()
    except FileNotFoundError:
        return False

    return first.st_size == second.st_size and first.st_mtime_ns == second.st_mtime_ns


def main() -> int:
    INPUT_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    STATE_DIR.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(f'{os.getpid()}\n', encoding='utf-8')
    log('clawsphere bridge started')

    try:
        while True:
            for path in sorted(INPUT_DIR.glob('*_mic.txt')):
                try:
                    if not is_ready_transcript(path):
                        continue

                    transcript = read_text(path)
                    if not transcript:
                        done = mark_done(path)
                        log(f'marked empty transcript handled: {done.name}')
                        continue

                    log(f'handling transcript: {path.name}')
                    reply = session_send(transcript)
                    if reply and reply != 'NO_REPLY':
                        reply_path = write_reply(reply)
                        log(f'wrote reply script: {reply_path.name}')
                    else:
                        log(f'no reply for transcript: {path.name}')

                    done = mark_done(path)
                    log(f'marked handled: {done.name}')
                except Exception as error:  # noqa: BLE001
                    log(f'error handling {path.name}: {error}')
            time.sleep(POLL_SECONDS)
    finally:
        PID_FILE.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        log('clawsphere bridge stopped by user')
        raise SystemExit(0)
