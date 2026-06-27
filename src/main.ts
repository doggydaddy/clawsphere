import './styles.css';

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';
import { pageText } from './pageText';

const vertexShader = `
vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 10.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

vec3 fade(vec3 t) {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

float pnoise(vec3 P, vec3 rep) {
  vec3 Pi0 = mod(floor(P), rep);
  vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
  Pi0 = mod289(Pi0);
  Pi1 = mod289(Pi1);
  vec3 Pf0 = fract(P);
  vec3 Pf1 = Pf0 - vec3(1.0);
  vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
  vec4 iy = vec4(Pi0.yy, Pi1.yy);
  vec4 iz0 = Pi0.zzzz;
  vec4 iz1 = Pi1.zzzz;
  vec4 ixy = permute(permute(ix) + iy);
  vec4 ixy0 = permute(ixy + iz0);
  vec4 ixy1 = permute(ixy + iz1);
  vec4 gx0 = ixy0 * (1.0 / 7.0);
  vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
  gx0 = fract(gx0);
  vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
  vec4 sz0 = step(gz0, vec4(0.0));
  gx0 -= sz0 * (step(0.0, gx0) - 0.5);
  gy0 -= sz0 * (step(0.0, gy0) - 0.5);
  vec4 gx1 = ixy1 * (1.0 / 7.0);
  vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
  gx1 = fract(gx1);
  vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
  vec4 sz1 = step(gz1, vec4(0.0));
  gx1 -= sz1 * (step(0.0, gx1) - 0.5);
  gy1 -= sz1 * (step(0.0, gy1) - 0.5);
  vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
  vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
  vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
  vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
  vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
  vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
  vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
  vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
  vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
  g000 *= norm0.x;
  g010 *= norm0.y;
  g100 *= norm0.z;
  g110 *= norm0.w;
  vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
  g001 *= norm1.x;
  g011 *= norm1.y;
  g101 *= norm1.z;
  g111 *= norm1.w;
  float n000 = dot(g000, Pf0);
  float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
  float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
  float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
  float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
  float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
  float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
  float n111 = dot(g111, Pf1);
  vec3 fade_xyz = fade(Pf0);
  vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
  vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
  float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
  return 2.2 * n_xyz;
}

uniform float u_time;
uniform float u_frequency;
uniform float u_noiseStrength;
uniform float u_audioStrength;

void main() {
  float audio = max(u_frequency / 255.0, 0.08);
  float noise = u_noiseStrength * pnoise(position + vec3(u_time * 0.55), vec3(10.0));
  float displacement = audio * u_audioStrength * noise;
  vec3 newPosition = position + normal * displacement;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
}
`;

const fragmentShader = `
uniform vec3 u_color;

void main() {
  gl_FragColor = vec4(u_color, 1.0);
}
`;

function getElement<T extends HTMLElement>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

const canvas = getElement<HTMLCanvasElement>('#scene');
const audio = getElement<HTMLAudioElement>('#audio');
const appTitle = getElement<HTMLHeadingElement>('#app-title');
const queueStatus = getElement<HTMLParagraphElement>('#queue-status');
const systemStatus = getElement<HTMLParagraphElement>('#system-status');
const systemToggle = getElement<HTMLButtonElement>('#system-toggle');

document.title = pageText.title;
appTitle.textContent = pageText.h1;

const renderer = new THREE.WebGLRenderer({ antialias: true, canvas });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x05070c, 0.035);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 0, 13);

const params = {
  color: '#3d305a',
  particleColor: '#534ad3',
  noiseStrength: 3.0,
  audioStrength: 0.52,
  particlePulse: 0.75,
  orbitOpacity: 0.82,
  orbitSpeed: 0.72,
  orbitSmear: 1.0,
  micRingOpacity: 0.86,
  micRingRadius: 2.72,
  micRingSensitivity: 28,
  bloomThreshold: 0.15,
  bloomStrength: 1.1,
  bloomRadius: 0.72
};

type NumericVisualSetting =
  | 'noiseStrength'
  | 'audioStrength'
  | 'particlePulse'
  | 'orbitOpacity'
  | 'orbitSpeed'
  | 'orbitSmear'
  | 'micRingOpacity'
  | 'micRingRadius'
  | 'micRingSensitivity'
  | 'bloomThreshold'
  | 'bloomStrength'
  | 'bloomRadius';

type VisualSettings = Partial<Record<NumericVisualSetting, number>> & {
  color?: string;
  sphereColor?: string;
  particleColor?: string;
};

const numericVisualSettingRanges: Record<NumericVisualSetting, [number, number]> = {
  noiseStrength: [0.2, 7],
  audioStrength: [0.05, 1.5],
  particlePulse: [0, 2],
  orbitOpacity: [0, 1],
  orbitSpeed: [0.05, 2],
  orbitSmear: [0.2, 2.2],
  micRingOpacity: [0, 1],
  micRingRadius: [2.1, 4.4],
  micRingSensitivity: [1, 80],
  bloomThreshold: [0, 1],
  bloomStrength: [0, 3],
  bloomRadius: [0, 1]
};

let visualSettingsSignature = '';
let visualSettingControllers: Array<{ updateDisplay: () => void }> = [];

const uniforms = {
  u_time: { value: 0 },
  u_frequency: { value: 0 },
  u_noiseStrength: { value: params.noiseStrength },
  u_audioStrength: { value: params.audioStrength },
  u_color: { value: new THREE.Color(params.color) }
};

const sphere = new THREE.Mesh(
  new THREE.IcosahedronGeometry(2, 26),
  new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    wireframe: true
  })
);
scene.add(sphere);

const particleCount = 1400;
const particlePositions = new Float32Array(particleCount * 3);
for (let i = 0; i < particleCount; i += 1) {
  const radius = THREE.MathUtils.randFloat(4.5, 18);
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
  const index = i * 3;

  particlePositions[index] = radius * Math.sin(phi) * Math.cos(theta);
  particlePositions[index + 1] = radius * Math.sin(phi) * Math.sin(theta);
  particlePositions[index + 2] = radius * Math.cos(phi);
}

const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));

const particleMaterial = new THREE.PointsMaterial({
  color: params.particleColor,
  size: 0.035,
  transparent: true,
  opacity: 0.72,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const particles = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particles);

type OrbitalParticle = {
  axis: THREE.Vector3;
  phase: number;
  radius: number;
  speed: number;
};

const orbitalCount = 10;
const orbitalParticles: OrbitalParticle[] = Array.from({ length: orbitalCount }, (_, index) => ({
  axis: new THREE.Vector3(
    Math.sin(index * 1.7) * 0.6,
    1,
    Math.cos(index * 1.3) * 0.42
  ).normalize(),
  phase: (index / orbitalCount) * Math.PI * 2,
  radius: THREE.MathUtils.randFloat(2.65, 3.25),
  speed: THREE.MathUtils.randFloat(0.55, 1.2)
}));

const orbitalGeometry = new THREE.BufferGeometry();
const orbitalPositions = new Float32Array(orbitalCount * 3);
orbitalGeometry.setAttribute('position', new THREE.BufferAttribute(orbitalPositions, 3));

function createOrbitalTexture() {
  const size = 128;
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = size;
  textureCanvas.height = size;

  const context = textureCanvas.getContext('2d');
  if (!context) {
    throw new Error('Could not create orbital texture context.');
  }

  const center = size / 2;
  const gradient = context.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.16, 'rgba(214, 255, 248, 0.92)');
  gradient.addColorStop(0.42, 'rgba(143, 242, 223, 0.32)');
  gradient.addColorStop(1, 'rgba(143, 242, 223, 0)');

  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const orbitalMaterial = new THREE.PointsMaterial({
  color: params.color,
  map: createOrbitalTexture(),
  size: 0.2,
  transparent: true,
  opacity: params.orbitOpacity,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  alphaTest: 0.01
});

const orbitals = new THREE.Points(orbitalGeometry, orbitalMaterial);
scene.add(orbitals);

const micRingSegments = 192;
const micRingPositions = new Float32Array((micRingSegments + 1) * 3);
const micRingBasePositions = new Float32Array((micRingSegments + 1) * 3);
const micRingGeometry = new THREE.BufferGeometry();
micRingGeometry.setAttribute('position', new THREE.BufferAttribute(micRingPositions, 3));

const micRingMaterial = new THREE.LineBasicMaterial({
  color: params.color,
  transparent: true,
  opacity: params.micRingOpacity,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});

const micRing = new THREE.Line(micRingGeometry, micRingMaterial);
scene.add(micRing);

const micRingBaseGeometry = new THREE.BufferGeometry();
micRingBaseGeometry.setAttribute('position', new THREE.BufferAttribute(micRingBasePositions, 3));

const micRingBaseMaterial = new THREE.LineBasicMaterial({
  color: params.color,
  transparent: true,
  opacity: 0.28,
  blending: THREE.AdditiveBlending,
  depthWrite: false
});

const micRingBase = new THREE.Line(micRingBaseGeometry, micRingBaseMaterial);
scene.add(micRingBase);

function getOrbitalPosition(particle: OrbitalParticle, elapsed: number, audioLevel: number) {
  const angle = particle.phase + elapsed * params.orbitSpeed * particle.speed;
  const orbitRadius = particle.radius + Math.sin(elapsed * 0.7 + particle.phase) * 0.12 + audioLevel * 0.25;
  const basePosition = new THREE.Vector3(Math.cos(angle) * orbitRadius, Math.sin(angle) * orbitRadius * 0.42, 0);
  return basePosition.applyAxisAngle(particle.axis, particle.phase * 0.35);
}

function updateOrbitals(elapsed: number, audioLevel: number) {
  orbitalMaterial.opacity = params.orbitOpacity + audioLevel * 0.12;
  orbitalMaterial.size = 0.15 + params.orbitSmear * 0.13 + audioLevel * 0.08;

  for (let i = 0; i < orbitalParticles.length; i += 1) {
    const particle = orbitalParticles[i];
    const head = getOrbitalPosition(particle, elapsed, audioLevel);
    const pointOffset = i * 3;

    orbitalPositions[pointOffset] = head.x;
    orbitalPositions[pointOffset + 1] = head.y;
    orbitalPositions[pointOffset + 2] = head.z;
  }

  orbitalGeometry.attributes.position.needsUpdate = true;
}

type MicAnalyserState = {
  analyser: AnalyserNode;
  data: Uint8Array<ArrayBuffer>;
  stream: MediaStream;
};

type MicStatus = {
  updatedAt: number;
  rms: number;
  waveform: number[];
};

type MicrophoneServiceStatus = {
  running: boolean;
  pid: number | null;
};

type SystemServiceStatus = {
  running: boolean;
  speech2txt: MicrophoneServiceStatus;
  txt2speech: MicrophoneServiceStatus;
  bridge: MicrophoneServiceStatus;
};

let micAnalyserState: MicAnalyserState | null = null;
let micRequestInFlight = false;
let micRingLevel = 0;
let daemonMicStatus: MicStatus = { updatedAt: 0, rms: 0, waveform: [] };
let systemServiceRunning = false;

function setSystemServiceStatus(status: SystemServiceStatus) {
  systemServiceRunning = status.running;
  systemStatus.textContent = status.running ? 'System on' : 'System off';
  systemStatus.title = `speech2txt: ${status.speech2txt.running ? `on (${status.speech2txt.pid})` : 'off'}, txt2speech: ${
    status.txt2speech.running ? `on (${status.txt2speech.pid})` : 'off'
  }, bridge: ${status.bridge.running ? `on (${status.bridge.pid})` : 'off'}`;
  systemToggle.textContent = status.running ? 'Stop' : 'Start';
}

async function fetchSystemServiceStatus() {
  const response = await fetch('/api/system/status', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`System status failed (${response.status})`);
  }

  return (await response.json()) as SystemServiceStatus;
}

async function refreshSystemServiceStatus() {
  try {
    setSystemServiceStatus(await fetchSystemServiceStatus());
  } catch (error) {
    console.warn('Could not load system service status.', error);
    systemStatus.textContent = 'System unknown';
    systemStatus.title = 'Could not read system service status';
  }
}

function stopQueuePlayback() {
  queueEnabled = false;
  queuePaused = true;
  window.clearInterval(queuePollTimer);
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  currentAudioId = null;
  setQueueStatus('System stopped');
}

async function setSystemServiceEnabled(enabled: boolean) {
  systemToggle.disabled = true;
  systemStatus.textContent = enabled ? 'Starting' : 'Stopping';

  try {
    const response = await fetch(enabled ? '/api/system/start' : '/api/system/stop', {
      method: 'POST'
    });

    if (!response.ok) {
      throw new Error(`System toggle failed (${response.status})`);
    }

    setSystemServiceStatus((await response.json()) as SystemServiceStatus);

    if (!enabled) {
      stopQueuePlayback();
      daemonMicStatus = { updatedAt: 0, rms: 0, waveform: [] };
      return;
    }

    queueEnabled = true;
    queuePaused = false;
    setQueueStatus('Checking for audio');
    await unlockAudio();
    startQueuePolling();
    await loadNextQueuedAudio();
  } catch (error) {
    console.warn('Could not toggle system service.', error);
    systemStatus.textContent = 'System error';
    systemStatus.title = error instanceof Error ? error.message : 'Could not toggle system services';
  } finally {
    systemToggle.disabled = false;
  }
}

async function syncSystemServiceState() {
  try {
    const status = await fetchSystemServiceStatus();
    setSystemServiceStatus(status);

    if (!status.running && queueEnabled) {
      stopQueuePlayback();
    }
  } catch (error) {
    console.warn('Could not sync system service state.', error);
  }
}

async function pollMicStatus() {
  try {
    const response = await fetch('/api/mic-status', { cache: 'no-store' });
    if (!response.ok) {
      return;
    }

    const status = (await response.json()) as MicStatus;
    if (Array.isArray(status.waveform)) {
      daemonMicStatus = status;
    }
  } catch (error) {
    console.warn('Could not load microphone status.', error);
  }
}

function updateMicRing(elapsed: number) {
  let averageAmplitude = 0;
  const hasDaemonMic = Date.now() / 1000 - daemonMicStatus.updatedAt < 2 && daemonMicStatus.waveform.length > 0;

  if (!hasDaemonMic && micAnalyserState) {
    micAnalyserState.analyser.getByteTimeDomainData(micAnalyserState.data);
  }

  for (let i = 0; i <= micRingSegments; i += 1) {
    const dataIndex = hasDaemonMic
      ? Math.floor((i / micRingSegments) * (daemonMicStatus.waveform.length - 1))
      : micAnalyserState
        ? Math.floor((i / micRingSegments) * (micAnalyserState.data.length - 1))
        : 0;
    const sample = hasDaemonMic
      ? daemonMicStatus.waveform[dataIndex] ?? 0
      : micAnalyserState
        ? (micAnalyserState.data[dataIndex] - 128) / 128
        : 0;
    const angle = (i / micRingSegments) * Math.PI * 2;
    const idleRipple = Math.sin(angle * 9 + elapsed * 1.7) * 0.012;
    const amplitude = Math.abs(sample);
    const spike = THREE.MathUtils.clamp(sample * params.micRingSensitivity, -1.4, 1.4);
    const ringRadius = params.micRingRadius + spike + idleRipple;
    const x = Math.cos(angle) * ringRadius;
    const y = Math.sin(angle) * ringRadius;
    const offset = i * 3;

    averageAmplitude += amplitude;
    micRingPositions[offset] = x;
    micRingPositions[offset + 1] = y;
    micRingPositions[offset + 2] = 0.04;

    micRingBasePositions[offset] = Math.cos(angle) * params.micRingRadius;
    micRingBasePositions[offset + 1] = Math.sin(angle) * params.micRingRadius;
    micRingBasePositions[offset + 2] = 0;
  }

  averageAmplitude /= micRingSegments + 1;
  const nextLevel = hasDaemonMic ? Math.max(averageAmplitude, daemonMicStatus.rms) : averageAmplitude;
  micRingLevel = THREE.MathUtils.lerp(micRingLevel, nextLevel, 0.18);
  micRingMaterial.opacity = params.micRingOpacity * (0.45 + micRingLevel * 4.2);
  micRingBaseMaterial.opacity = params.micRingOpacity * 0.24;
  micRingMaterial.color.set(params.color);
  micRingBaseMaterial.color.set(params.color);
  micRingGeometry.attributes.position.needsUpdate = true;
  micRingBaseGeometry.attributes.position.needsUpdate = true;
}

const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  params.bloomStrength,
  params.bloomRadius,
  params.bloomThreshold
);
bloomPass.threshold = params.bloomThreshold;
bloomPass.strength = params.bloomStrength;
bloomPass.radius = params.bloomRadius;

const composer = new EffectComposer(renderer);
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function applyVisualSettings(settings: VisualSettings) {
  const sphereColor = settings.sphereColor ?? settings.color;

  if (isHexColor(sphereColor)) {
    params.color = sphereColor;
    uniforms.u_color.value.set(sphereColor);
    orbitalMaterial.color.set(sphereColor);
    micRingMaterial.color.set(sphereColor);
    micRingBaseMaterial.color.set(sphereColor);
  }

  if (isHexColor(settings.particleColor)) {
    params.particleColor = settings.particleColor;
    particleMaterial.color.set(settings.particleColor);
  }

  (Object.keys(numericVisualSettingRanges) as NumericVisualSetting[]).forEach((key) => {
    const value = settings[key];

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return;
    }

    const [min, max] = numericVisualSettingRanges[key];
    params[key] = THREE.MathUtils.clamp(value, min, max);
  });

  uniforms.u_noiseStrength.value = params.noiseStrength;
  uniforms.u_audioStrength.value = params.audioStrength;
  bloomPass.threshold = params.bloomThreshold;
  bloomPass.radius = params.bloomRadius;
  visualSettingControllers.forEach((controller) => controller.updateDisplay());
}

async function pollVisualSettings() {
  try {
    const response = await fetch('/api/visual-settings', { cache: 'no-store' });

    if (!response.ok) {
      return;
    }

    const payload = (await response.json()) as { settings?: VisualSettings };
    const settings = payload.settings ?? {};
    const nextSignature = JSON.stringify(settings);

    if (nextSignature === visualSettingsSignature) {
      return;
    }

    visualSettingsSignature = nextSignature;
    applyVisualSettings(settings);
  } catch (error) {
    console.warn('Could not load visual settings.', error);
  }
}

const listener = new THREE.AudioListener();
camera.add(listener);

const sound = new THREE.Audio(listener);
const analyser = new THREE.AudioAnalyser(sound, 128);
let mediaSourceAttached = false;
let targetMouseX = 0;
let targetMouseY = 0;
let smoothedFrequency = 0;
let queueEnabled = false;
let queuePaused = false;
let queuePollTimer = 0;
let currentAudioId: string | null = null;
let isLoadingAudio = false;

type QueuedAudio = {
  id: string;
  name: string;
  url: string;
};

function attachMediaSource() {
  if (mediaSourceAttached) {
    return;
  }

  sound.setMediaElementSource(audio);
  mediaSourceAttached = true;
}

async function unlockAudio() {
  attachMediaSource();

  if (listener.context.state === 'suspended') {
    await listener.context.resume();
  }
}

async function startMicAnalyser() {
  if (micAnalyserState || micRequestInFlight) {
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    setQueueStatus('Microphone API unavailable');
    return;
  }

  micRequestInFlight = true;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    const micSource = listener.context.createMediaStreamSource(stream);
    const micAnalyser = listener.context.createAnalyser();
    micAnalyser.fftSize = 1024;
    micAnalyser.smoothingTimeConstant = 0.52;
    micSource.connect(micAnalyser);
    micAnalyserState = {
      analyser: micAnalyser,
      data: new Uint8Array(new ArrayBuffer(micAnalyser.fftSize)),
      stream
    };
  } catch (error) {
    console.warn('Could not start microphone visualizer.', error);
    setQueueStatus('Microphone unavailable');
  } finally {
    micRequestInFlight = false;
  }
}

function setQueueStatus(message: string) {
  queueStatus.textContent = message;
  queueStatus.title = message;
}

async function fetchNextAudio() {
  const response = await fetch('/api/audio/next', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Queue lookup failed (${response.status})`);
  }

  const payload = (await response.json()) as { audio: QueuedAudio | null };
  return payload.audio;
}

async function markAudioComplete(id: string) {
  const response = await fetch('/api/audio/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  });

  if (!response.ok && response.status !== 404) {
    throw new Error(`Could not remove completed audio (${response.status})`);
  }
}

async function playQueuedAudio(nextAudio: QueuedAudio) {
  currentAudioId = nextAudio.id;
  audio.src = `${nextAudio.url}?t=${Date.now()}`;
  audio.load();
  await unlockAudio();
  await audio.play();
  setQueueStatus(`Playing ${nextAudio.name}`);
}

async function loadNextQueuedAudio() {
  if (!queueEnabled || queuePaused || isLoadingAudio || !audio.paused || currentAudioId) {
    return;
  }

  isLoadingAudio = true;

  try {
    const nextAudio = await fetchNextAudio();
    if (!nextAudio) {
      setQueueStatus('Waiting for audio');
      return;
    }

    await playQueuedAudio(nextAudio);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Queue playback failed';
    setQueueStatus(message);
  } finally {
    isLoadingAudio = false;
  }
}

function startQueuePolling() {
  window.clearInterval(queuePollTimer);
  queuePollTimer = window.setInterval(() => {
    void loadNextQueuedAudio();
  }, 2000);
}

systemToggle.addEventListener('click', () => {
  void setSystemServiceEnabled(!systemServiceRunning);
});

audio.addEventListener('ended', () => {
  const completedId = currentAudioId;
  currentAudioId = null;
  audio.removeAttribute('src');
  audio.load();

  if (!completedId) {
    void loadNextQueuedAudio();
    return;
  }

  void (async () => {
    try {
      await markAudioComplete(completedId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not remove completed audio';
      setQueueStatus(message);
    }

    await loadNextQueuedAudio();
  })();
});

audio.addEventListener('error', () => {
  currentAudioId = null;
  audio.removeAttribute('src');
  audio.load();
  setQueueStatus('Audio failed to load');
  void loadNextQueuedAudio();
});

document.addEventListener('pointermove', (event) => {
  targetMouseX = (event.clientX - window.innerWidth / 2) / 120;
  targetMouseY = (event.clientY - window.innerHeight / 2) / 140;
});

const gui = new GUI({ title: 'Visualizer' });
const sphereColorController = gui.addColor(params, 'color').name('Sphere').onChange((value: string) => {
  uniforms.u_color.value.set(value);
  orbitalMaterial.color.set(value);
  micRingMaterial.color.set(value);
  micRingBaseMaterial.color.set(value);
});
const particleColorController = gui.addColor(params, 'particleColor').name('Particles').onChange((value: string) => {
  particleMaterial.color.set(value);
});
const noiseController = gui.add(params, 'noiseStrength', 0.2, 7, 0.01).name('Noise').onChange((value: number) => {
  uniforms.u_noiseStrength.value = value;
});
const audioController = gui.add(params, 'audioStrength', 0.05, 1.5, 0.01).name('Audio').onChange((value: number) => {
  uniforms.u_audioStrength.value = value;
});
const particlePulseController = gui.add(params, 'particlePulse', 0, 2, 0.01).name('Particle pulse');
const orbitFolder = gui.addFolder('Orbit');
const orbitOpacityController = orbitFolder.add(params, 'orbitOpacity', 0, 1, 0.01).name('Opacity');
const orbitSpeedController = orbitFolder.add(params, 'orbitSpeed', 0.05, 2, 0.01).name('Speed');
const orbitSmearController = orbitFolder.add(params, 'orbitSmear', 0.2, 2.2, 0.01).name('Smear');
const micRingFolder = gui.addFolder('Mic Ring');
const micRingOpacityController = micRingFolder.add(params, 'micRingOpacity', 0, 1, 0.01).name('Opacity');
const micRingRadiusController = micRingFolder.add(params, 'micRingRadius', 2.1, 4.4, 0.01).name('Radius');
const micRingSensitivityController = micRingFolder.add(params, 'micRingSensitivity', 1, 80, 0.1).name('Sensitivity');
const bloomFolder = gui.addFolder('Bloom');
const bloomThresholdController = bloomFolder.add(params, 'bloomThreshold', 0, 1, 0.01).name('Threshold').onChange((value: number) => {
  bloomPass.threshold = value;
});
const bloomStrengthController = bloomFolder.add(params, 'bloomStrength', 0, 3, 0.01).name('Strength').onChange((value: number) => {
  bloomPass.strength = value;
});
const bloomRadiusController = bloomFolder.add(params, 'bloomRadius', 0, 1, 0.01).name('Radius').onChange((value: number) => {
  bloomPass.radius = value;
});

visualSettingControllers = [
  sphereColorController,
  particleColorController,
  noiseController,
  audioController,
  particlePulseController,
  orbitOpacityController,
  orbitSpeedController,
  orbitSmearController,
  micRingOpacityController,
  micRingRadiusController,
  micRingSensitivityController,
  bloomThresholdController,
  bloomStrengthController,
  bloomRadiusController
];
void pollVisualSettings();
window.setInterval(() => {
  void pollVisualSettings();
}, 1000);
void pollMicStatus();
window.setInterval(() => {
  void pollMicStatus();
}, 100);
void refreshSystemServiceStatus();
window.setInterval(() => {
  void syncSystemServiceState();
}, 2000);

const clock = new THREE.Clock();

function animate() {
  const elapsed = clock.getElapsedTime();
  const frequency = audio.paused ? 0 : analyser.getAverageFrequency();
  smoothedFrequency = THREE.MathUtils.lerp(smoothedFrequency, frequency, 0.12);
  const audioLevel = smoothedFrequency / 255;

  uniforms.u_time.value = elapsed;
  uniforms.u_frequency.value = smoothedFrequency;

  sphere.rotation.y = elapsed * 0.08;
  sphere.rotation.x = Math.sin(elapsed * 0.25) * 0.08;

  particles.rotation.y = elapsed * (0.018 + audioLevel * 0.06);
  particles.rotation.x = Math.sin(elapsed * 0.18) * 0.08;
  particleMaterial.size = 0.032 + audioLevel * params.particlePulse * 0.11;
  particleMaterial.opacity = 0.42 + audioLevel * 0.5;
  updateOrbitals(elapsed, audioLevel);
  updateMicRing(elapsed);
  bloomPass.strength = params.bloomStrength + params.orbitSmear * 0.12 + audioLevel * 0.12;

  camera.position.x += (targetMouseX - camera.position.x) * 0.035;
  camera.position.y += (-targetMouseY - camera.position.y) * 0.035;
  camera.position.z = 12.5 - audioLevel * 1.4;
  camera.lookAt(scene.position);

  composer.render();
  requestAnimationFrame(animate);
}

animate();

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
