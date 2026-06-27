import './styles.css';

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import GUI from 'lil-gui';
import { pageText } from './pageText';

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
  color: '#2ffcff',
  particleColor: '#ff3cf7',
  noiseStrength: 3.0,
  audioStrength: 0.52,
  particlePulse: 0.75,
  orbitOpacity: 0.82,
  orbitSpeed: 0.72,
  orbitSmear: 1.0,
  micRingOpacity: 0.3,
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

type CubeCell = {
  basePosition: THREE.Vector3;
  direction: THREE.Vector3;
  distance: number;
  edgeFactor: number;
  frequencyRatio: number;
  response: number;
  color: THREE.Color;
  phase: number;
};

const cubeGridSize = 5;
const cubeSpacing = 0.88;
const cubeSize = 0.68;
const outerCubeSize = cubeSpacing * (cubeGridSize - 1) + cubeSize;
const cubeHalfIndex = (cubeGridSize - 1) / 2;
const cubeCells: CubeCell[] = [];
const cubeInstanceCount = cubeGridSize ** 3;
const cubeEdgeVertexCount = cubeInstanceCount * 24;
const cubeGeometry = new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize);
const cubeFillMaterial = new THREE.MeshBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.015,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
  vertexColors: true
});
const cubeMaterial = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.24,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
  vertexColors: true
});
const cubeFillLattice = new THREE.InstancedMesh(cubeGeometry, cubeFillMaterial, cubeInstanceCount);
cubeFillLattice.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
cubeFillLattice.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cubeInstanceCount * 3), 3);
const cubeEdgePositions = new Float32Array(cubeEdgeVertexCount * 3);
const cubeEdgeColors = new Float32Array(cubeEdgeVertexCount * 3);
const cubeEdgeGeometry = new THREE.BufferGeometry();
cubeEdgeGeometry.setAttribute('position', new THREE.BufferAttribute(cubeEdgePositions, 3));
cubeEdgeGeometry.setAttribute('color', new THREE.BufferAttribute(cubeEdgeColors, 3));
const cubeLattice = new THREE.LineSegments(cubeEdgeGeometry, cubeMaterial);
scene.add(cubeFillLattice);
scene.add(cubeLattice);

const outerCubeMaterial = new THREE.LineBasicMaterial({
  color: params.color,
  transparent: true,
  opacity: 0.08,
  blending: THREE.AdditiveBlending,
  depthTest: false,
  depthWrite: false
});
const outerCube = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(outerCubeSize, outerCubeSize, outerCubeSize)), outerCubeMaterial);
scene.add(outerCube);

const cubeMatrix = new THREE.Matrix4();
const cubePosition = new THREE.Vector3();
const cubeScale = new THREE.Vector3();
const cubeQuaternion = new THREE.Quaternion();
const cubeColor = new THREE.Color();
const cubeAccentColor = new THREE.Color();
const cubeWhiteColor = new THREE.Color(0xffffff);
const cubeEdgeOffsets = [
  [-1, -1, -1],
  [1, -1, -1],
  [1, -1, -1],
  [1, 1, -1],
  [1, 1, -1],
  [-1, 1, -1],
  [-1, 1, -1],
  [-1, -1, -1],
  [-1, -1, 1],
  [1, -1, 1],
  [1, -1, 1],
  [1, 1, 1],
  [1, 1, 1],
  [-1, 1, 1],
  [-1, 1, 1],
  [-1, -1, 1],
  [-1, -1, -1],
  [-1, -1, 1],
  [1, -1, -1],
  [1, -1, 1],
  [1, 1, -1],
  [1, 1, 1],
  [-1, 1, -1],
  [-1, 1, 1]
] as const;

for (let x = 0; x < cubeGridSize; x += 1) {
  for (let y = 0; y < cubeGridSize; y += 1) {
    for (let z = 0; z < cubeGridSize; z += 1) {
      const basePosition = new THREE.Vector3(
        (x - cubeHalfIndex) * cubeSpacing,
        (y - cubeHalfIndex) * cubeSpacing,
        (z - cubeHalfIndex) * cubeSpacing
      );
      const direction = basePosition.lengthSq() > 0 ? basePosition.clone().normalize() : new THREE.Vector3(0, 1, 0);
      const edgeFactor = Math.max(Math.abs(x - cubeHalfIndex), Math.abs(y - cubeHalfIndex), Math.abs(z - cubeHalfIndex)) / cubeHalfIndex;
      const frequencyRatio = (x + y * cubeGridSize + z * cubeGridSize * cubeGridSize) / (cubeInstanceCount - 1);

      cubeCells.push({
        basePosition,
        direction,
        distance: basePosition.length(),
        edgeFactor,
        frequencyRatio,
        response: 0,
        color: new THREE.Color(),
        phase: (x * 0.73 + y * 1.17 + z * 1.61) % (Math.PI * 2)
      });
    }
  }
}

function updateCubeColors() {
  const baseColor = new THREE.Color(params.color);
  cubeAccentColor.set(params.particleColor);
  outerCubeMaterial.color.copy(baseColor).lerp(cubeWhiteColor, 0.16);

  for (let i = 0; i < cubeCells.length; i += 1) {
    const cell = cubeCells[i];
    const colorMix = THREE.MathUtils.clamp((cell.basePosition.x + cell.basePosition.y + cell.basePosition.z) / (cubeSpacing * cubeHalfIndex * 6) + 0.5, 0, 1);
    cubeColor.copy(baseColor).lerp(cubeAccentColor, colorMix).lerp(cubeWhiteColor, 0.12 + cell.edgeFactor * 0.12);
    cell.color.copy(cubeColor);
    cubeFillLattice.setColorAt(i, cubeColor);

    for (let vertexIndex = 0; vertexIndex < 24; vertexIndex += 1) {
      const colorOffset = (i * 24 + vertexIndex) * 3;
      cubeEdgeColors[colorOffset] = cubeColor.r;
      cubeEdgeColors[colorOffset + 1] = cubeColor.g;
      cubeEdgeColors[colorOffset + 2] = cubeColor.b;
    }
  }

  if (cubeFillLattice.instanceColor) {
    cubeFillLattice.instanceColor.needsUpdate = true;
  }
  cubeEdgeGeometry.attributes.color.needsUpdate = true;
}

function getCubeFrequencyLevel(cell: CubeCell, frequencyData: Uint8Array | null) {
  if (!frequencyData || frequencyData.length === 0) {
    return 0;
  }

  const curvedRatio = cell.frequencyRatio ** 1.45;
  const binIndex = Math.round(curvedRatio * (frequencyData.length - 1));
  const start = Math.max(0, binIndex - 1);
  const end = Math.min(frequencyData.length - 1, binIndex + 1);
  let total = 0;

  for (let index = start; index <= end; index += 1) {
    total += frequencyData[index];
  }

  return total / ((end - start + 1) * 255);
}

function updateCubeLattice(elapsed: number, audioLevel: number, frequencyData: Uint8Array | null) {
  const audioPush = audioLevel * params.audioStrength;

  cubeLattice.rotation.y = elapsed * 0.006;
  cubeLattice.rotation.x = Math.sin(elapsed * 0.12) * 0.035;
  cubeLattice.rotation.z = Math.sin(elapsed * 0.1) * 0.012;
  cubeFillLattice.rotation.copy(cubeLattice.rotation);
  outerCube.rotation.copy(cubeLattice.rotation);
  outerCube.scale.setScalar(1 + audioPush * 0.12);
  cubeFillMaterial.opacity = 0.012 + audioLevel * 0.03;
  cubeMaterial.opacity = 0.22 + audioLevel * 0.14;
  outerCubeMaterial.opacity = 0.04 + audioLevel * 0.05;

  for (let i = 0; i < cubeCells.length; i += 1) {
    const cell = cubeCells[i];
    const frequencyLevel = getCubeFrequencyLevel(cell, frequencyData);
    const responseSpeed = frequencyLevel > cell.response ? 0.32 : 0.12;
    cell.response = THREE.MathUtils.lerp(cell.response, frequencyLevel, responseSpeed);

    const ripple = Math.sin(elapsed * (1.4 + params.noiseStrength * 0.1) - cell.distance * 1.8 + cell.phase) * 0.025;
    const frequencyPush = cell.response * params.audioStrength * (0.45 + cell.edgeFactor * 1.05);
    const expansion = frequencyPush + audioPush * 0.12 + ripple;
    const scale = 1 + cell.response * params.audioStrength * (0.16 + cell.edgeFactor * 0.12);

    cubePosition.copy(cell.basePosition).addScaledVector(cell.direction, expansion);
    cubeScale.setScalar(scale);
    cubeMatrix.compose(cubePosition, cubeQuaternion, cubeScale);
    cubeFillLattice.setMatrixAt(i, cubeMatrix);

    for (let vertexIndex = 0; vertexIndex < cubeEdgeOffsets.length; vertexIndex += 1) {
      const [x, y, z] = cubeEdgeOffsets[vertexIndex];
      const positionOffset = (i * cubeEdgeOffsets.length + vertexIndex) * 3;

      cubeEdgePositions[positionOffset] = cubePosition.x + x * cubeSize * 0.5 * scale;
      cubeEdgePositions[positionOffset + 1] = cubePosition.y + y * cubeSize * 0.5 * scale;
      cubeEdgePositions[positionOffset + 2] = cubePosition.z + z * cubeSize * 0.5 * scale;
    }
  }

  cubeFillLattice.instanceMatrix.needsUpdate = true;
  cubeEdgeGeometry.attributes.position.needsUpdate = true;
}

updateCubeColors();
updateCubeLattice(0, 0, null);

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
    updateCubeColors();
    orbitalMaterial.color.set(sphereColor);
    micRingMaterial.color.set(sphereColor);
    micRingBaseMaterial.color.set(sphereColor);
  }

  if (isHexColor(settings.particleColor)) {
    params.particleColor = settings.particleColor;
    updateCubeColors();
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
const sphereColorController = gui.addColor(params, 'color').name('Cube').onChange((value: string) => {
  updateCubeColors();
  orbitalMaterial.color.set(value);
  micRingMaterial.color.set(value);
  micRingBaseMaterial.color.set(value);
});
const particleColorController = gui.addColor(params, 'particleColor').name('Particles').onChange((value: string) => {
  updateCubeColors();
  particleMaterial.color.set(value);
});
const noiseController = gui.add(params, 'noiseStrength', 0.2, 7, 0.01).name('Cube ripple');
const audioController = gui.add(params, 'audioStrength', 0.05, 1.5, 0.01).name('Cube push');
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
  const frequencyData = audio.paused ? null : analyser.getFrequencyData();
  const frequency = frequencyData
    ? frequencyData.reduce((total, value) => total + value, 0) / frequencyData.length
    : 0;
  smoothedFrequency = THREE.MathUtils.lerp(smoothedFrequency, frequency, 0.12);
  const audioLevel = smoothedFrequency / 255;

  updateCubeLattice(elapsed, audioLevel, frequencyData);

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
