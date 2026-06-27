import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { readFile, readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, type Connect, type Plugin } from 'vite';

const audioDirectory = path.resolve(__dirname, 'txt2speech/output');
const visualSettingsFile = path.resolve(__dirname, 'visual_settings.json');
const micStatusFile = path.resolve(__dirname, 'speech2txt/mic_status.json');
const micDaemonFile = path.resolve(__dirname, 'speech2txt/whisper-mic-daemon.py');
const rootPython = path.resolve(__dirname, '.venv/bin/python');
const micDaemonPidFile = path.resolve(__dirname, 'speech2txt/whisper-mic-daemon.pid');
const ttsDaemonFile = path.resolve(__dirname, 'txt2speech/tts-watch.py');
const ttsDaemonPidFile = path.resolve(__dirname, 'txt2speech/tts-watch.pid');
const bridgeDaemonFile = path.resolve(__dirname, 'clawsphere-bridge.py');
const bridgeDaemonPidFile = path.resolve(__dirname, 'state/clawsphere-bridge.pid');
const audioExtensions = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac', '.webm']);
const audioReadyAgeMs = 1000;
const audioStableCheckMs = 250;

type ManagedDaemon = {
  args: string[];
  cwd: string;
  name: string;
  pidFile: string;
  python: string;
};

const micDaemon: ManagedDaemon = {
  args: ['-u', micDaemonFile, '--model', 'base', '--threshold', '0.006', '--silence', '1.6'],
  cwd: __dirname,
  name: 'speech2txt',
  pidFile: micDaemonPidFile,
  python: rootPython
};

const ttsDaemon: ManagedDaemon = {
  args: ['-u', ttsDaemonFile],
  cwd: __dirname,
  name: 'txt2speech',
  pidFile: ttsDaemonPidFile,
  python: rootPython
};

const bridgeDaemon: ManagedDaemon = {
  args: ['-u', bridgeDaemonFile],
  cwd: __dirname,
  name: 'clawsphere-bridge',
  pidFile: bridgeDaemonPidFile,
  python: rootPython
};

type AudioFile = {
  id: string;
  name: string;
  path: string;
  mtimeMs: number;
};

function sendJson(res: Connect.ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function getContentType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.ogg':
      return 'audio/ogg';
    case '.m4a':
    case '.aac':
      return 'audio/aac';
    case '.flac':
      return 'audio/flac';
    case '.webm':
      return 'audio/webm';
    default:
      return 'application/octet-stream';
  }
}

async function getAudioFiles() {
  const entries = await readdir(audioDirectory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isFile() &&
          !entry.name.startsWith('.') &&
          !entry.name.includes('.part.') &&
          audioExtensions.has(path.extname(entry.name).toLowerCase())
      )
      .map(async (entry): Promise<AudioFile | null> => {
        const filePath = path.join(audioDirectory, entry.name);
        const fileStat = await stat(filePath).catch(() => null);

        if (!fileStat?.isFile()) {
          return null;
        }

        if (Date.now() - fileStat.mtimeMs < audioReadyAgeMs) {
          return null;
        }

        await new Promise((resolve) => setTimeout(resolve, audioStableCheckMs));
        const stableStat = await stat(filePath).catch(() => null);

        if (!stableStat?.isFile() || stableStat.size !== fileStat.size || stableStat.mtimeMs !== fileStat.mtimeMs) {
          return null;
        }

        return {
          id: encodeURIComponent(entry.name),
          name: entry.name,
          path: filePath,
          mtimeMs: stableStat.mtimeMs
        };
      })
  );

  return files
    .filter((file): file is AudioFile => Boolean(file))
    .sort((left, right) => left.mtimeMs - right.mtimeMs || left.name.localeCompare(right.name));
}

async function findAudioFile(id: string) {
  const decodedName = decodeURIComponent(id);

  if (decodedName !== path.basename(decodedName)) {
    return null;
  }

  const filePath = path.join(audioDirectory, decodedName);
  const resolvedPath = path.resolve(filePath);

  if (!resolvedPath.startsWith(`${audioDirectory}${path.sep}`)) {
    return null;
  }

  const fileStat = await stat(resolvedPath).catch(() => null);
  if (
    decodedName.startsWith('.') ||
    decodedName.includes('.part.') ||
    !fileStat?.isFile() ||
    Date.now() - fileStat.mtimeMs < audioReadyAgeMs ||
    !audioExtensions.has(path.extname(resolvedPath).toLowerCase())
  ) {
    return null;
  }

  return resolvedPath;
}

async function readJsonBody(req: Connect.IncomingMessage) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

async function getDaemonPid(daemon: ManagedDaemon) {
  const rawPid = await readFile(daemon.pidFile, 'utf8').catch(() => '');
  const pid = Number.parseInt(rawPid.trim(), 10);
  return Number.isFinite(pid) ? pid : null;
}

function isProcessRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function getDaemonStatus(daemon: ManagedDaemon) {
  const pid = await getDaemonPid(daemon);
  const running = pid !== null && isProcessRunning(pid);

  if (pid !== null && !running) {
    await unlink(daemon.pidFile).catch(() => undefined);
  }

  return { running, pid: running ? pid : null };
}

async function startDaemon(daemon: ManagedDaemon) {
  const currentStatus = await getDaemonStatus(daemon);
  if (currentStatus.running) {
    return currentStatus;
  }

  const child = spawn(daemon.python, daemon.args, {
    cwd: daemon.cwd,
    detached: true,
    stdio: 'ignore'
  });
  child.unref();

  await new Promise((resolve) => setTimeout(resolve, 600));
  return getDaemonStatus(daemon);
}

async function stopDaemon(daemon: ManagedDaemon) {
  const pid = await getDaemonPid(daemon);

  if (pid === null || !isProcessRunning(pid)) {
    await unlink(daemon.pidFile).catch(() => undefined);
    return { running: false, pid: null };
  }

  process.kill(pid, 'SIGINT');

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (!isProcessRunning(pid)) {
      await unlink(daemon.pidFile).catch(() => undefined);
      return { running: false, pid: null };
    }
  }

  process.kill(pid, 'SIGTERM');
  await unlink(daemon.pidFile).catch(() => undefined);
  return { running: false, pid: null };
}

async function getSystemStatus() {
  const [speech2txt, txt2speech, bridge] = await Promise.all([
    getDaemonStatus(micDaemon),
    getDaemonStatus(ttsDaemon),
    getDaemonStatus(bridgeDaemon)
  ]);
  return {
    running: speech2txt.running && txt2speech.running && bridge.running,
    speech2txt,
    txt2speech,
    bridge
  };
}

async function startSystem() {
  const [speech2txt, txt2speech, bridge] = await Promise.all([
    startDaemon(micDaemon),
    startDaemon(ttsDaemon),
    startDaemon(bridgeDaemon)
  ]);
  return {
    running: speech2txt.running && txt2speech.running && bridge.running,
    speech2txt,
    txt2speech,
    bridge
  };
}

async function stopSystem() {
  const [speech2txt, txt2speech, bridge] = await Promise.all([
    stopDaemon(micDaemon),
    stopDaemon(ttsDaemon),
    stopDaemon(bridgeDaemon)
  ]);
  return {
    running: false,
    speech2txt,
    txt2speech,
    bridge
  };
}

function audioQueuePlugin(): Plugin {
  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (
      !req.url?.startsWith('/api/audio') &&
      !req.url?.startsWith('/api/visual-settings') &&
      !req.url?.startsWith('/api/mic-status') &&
      !req.url?.startsWith('/api/microphone') &&
      !req.url?.startsWith('/api/system')
    ) {
      next();
      return;
    }

    const url = new URL(req.url, 'http://localhost');

    try {
      if (req.method === 'GET' && url.pathname === '/api/visual-settings') {
        const rawSettings = await readFile(visualSettingsFile, 'utf8').catch((error: unknown) => {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return '{}';
          }

          throw error;
        });
        sendJson(res, 200, { settings: JSON.parse(rawSettings) });
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/mic-status') {
        const rawStatus = await readFile(micStatusFile, 'utf8').catch((error: unknown) => {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
            return '{"updatedAt":0,"rms":0,"waveform":[]}';
          }

          throw error;
        });
        sendJson(res, 200, JSON.parse(rawStatus));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/microphone/status') {
        sendJson(res, 200, await getDaemonStatus(micDaemon));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/microphone/start') {
        sendJson(res, 200, await startDaemon(micDaemon));
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/microphone/stop') {
        sendJson(res, 200, await stopDaemon(micDaemon));
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/system/status') {
        sendJson(res, 200, await getSystemStatus());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/system/start') {
        sendJson(res, 200, await startSystem());
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/system/stop') {
        sendJson(res, 200, await stopSystem());
        return;
      }

      if (req.method === 'GET' && url.pathname === '/api/audio/next') {
        const [nextAudio] = await getAudioFiles();
        sendJson(
          res,
          200,
          nextAudio
            ? { audio: { id: nextAudio.id, name: nextAudio.name, url: `/api/audio/file/${nextAudio.id}` } }
            : { audio: null }
        );
        return;
      }

      if (req.method === 'GET' && url.pathname.startsWith('/api/audio/file/')) {
        const id = url.pathname.replace('/api/audio/file/', '');
        const filePath = await findAudioFile(id);

        if (!filePath) {
          sendJson(res, 404, { error: 'Audio file not found' });
          return;
        }

        res.statusCode = 200;
        res.setHeader('Content-Type', getContentType(filePath));
        createReadStream(filePath).pipe(res);
        return;
      }

      if (req.method === 'POST' && url.pathname === '/api/audio/complete') {
        const body = await readJsonBody(req);
        const id = typeof body.id === 'string' ? body.id : '';
        const filePath = await findAudioFile(id);

        if (!filePath) {
          sendJson(res, 404, { error: 'Audio file not found' });
          return;
        }

        await unlink(filePath);
        sendJson(res, 200, { removed: path.basename(filePath) });
        return;
      }

      sendJson(res, 404, { error: 'Unknown audio endpoint' });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : 'Audio endpoint failed' });
    }
  };

  return {
    name: 'clawsphere-audio-queue',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    }
  };
}

export default defineConfig({
  plugins: [audioQueuePlugin()],
  server: {
    watch: {
      ignored: ['**/speech2txt/**', '**/txt2speech/output/**', '**/.venv/**', '**/.uv-cache/**']
    }
  }
});
