import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clone as skClone } from 'three/addons/utils/SkeletonUtils.js';
import { ERAS, SPECIES, STAGES, MODEL_YAW, MODEL_ROLL, UPGRADES, YEARS_PER_MIN } from './content.js';
import { Sound } from './audio.js';
import { openAnalysis, ramp } from './analysis.js';

/* =========================================================
   크로노스 프로토콜 · 1차시 고생대의 바다
   교사용 URL 옵션: ?era=1|2|3  ?skip  ?teacher  ?touch / ?mouse  ?view=zoo(모델 방향 확인)
   ========================================================= */
const $ = id => document.getElementById(id);
const P = new URLSearchParams(location.search);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const fmt = n => Math.round(n).toLocaleString('ko-KR');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TODAY = new Date();
const V3 = () => new THREE.Vector3();

function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
}
function fbm(x, z) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < 4; i++) { s += a * noise2(x * f, z * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }

/* ---------------- 바다 지형 · 환경 모델 ---------------- */
const WORLD = 150;
const REEFS = [[-62, 34, 15], [-18, -52, 14], [14, 44, 17], [52, -8, 13], [-96, -34, 14], [88, 62, 12], [-40, 92, 13]];
const HOME = new THREE.Vector3(-40, 0, 14);
function reefDist(x, z) { let m = 1e9; for (const [rx, rz, r] of REEFS) m = Math.min(m, Math.hypot(x - rx, z - rz) - r); return m; }
function floorY(x, z) {
  let y = -10 - 48 * smooth(-115, 135, x);
  y += (fbm(x * 0.018 + 3, z * 0.018) - 0.5) * 12;
  y += (noise2(x * 0.11, z * 0.11) - 0.5) * 1.6;
  for (const [rx, rz, r] of REEFS) { const q = Math.hypot(x - rx, z - rz) / r; if (q < 1.6) y += 3.5 * Math.exp(-q * q * 1.8); }
  return y;
}
HOME.y = floorY(HOME.x, HOME.z);
function env(x, y, z, E, t) {
  const depth = Math.max(0, -y), [ux, uz, ur] = E.up;
  const up = Math.exp(-((x - ux) ** 2 + (z - uz) ** 2) / (2 * ur * ur));
  const temp = E.T0 + E.dT * t - depth * 0.13 - up * 3.2 + (noise2(x * 0.03 + 50, z * 0.03) - 0.5) * 1.6;
  const nut = Math.max(0, 1.5 + depth * 0.06 + up * 15 + (noise2(x * 0.05, z * 0.05 + 9) - 0.5) * 2.4);
  let o2 = E.O0 - E.dO * t - depth * 0.05 - Math.max(0, temp - 18) * 0.11 + (noise2(x * 0.04 + 3, z * 0.04) - 0.5) * 0.7;
  o2 -= smooth(42, 64, depth) * 2.6;
  if (E.anox) { const lvl = Math.max(8, 70 - E.anox * t); o2 -= smooth(lvl - 12, lvl + 4, depth) * 4.5; }
  const rd = reefDist(x, z);
  o2 += Math.max(0, 1 - rd / 20) * 0.5;
  const co2 = E.C0 + E.dC * t + (noise2(x * 0.02 + 70, z * 0.02) - 0.5) * 120;
  const ph = 8.25 - 0.18 * Math.log2(co2 / 280), light = Math.exp(-depth / 35);
  const food = clamp((nut / 17) * (0.55 + 0.45 * light) * 10 * (temp > 34 ? 0.5 : 1), 0, 10);
  return { depth, temp, o2: Math.max(0, o2), co2, ph, nut, food, reef: Math.max(0, rd) };
}

/* ---------------- 렌더러 ---------------- */
const IS_TOUCH = !P.has('mouse') && (P.has('touch') || (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches));
if (IS_TOUCH) document.body.classList.add('touch');
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const PR_MAX = Math.min(devicePixelRatio, IS_TOUCH ? 1.5 : 1.75), PR_MIN = 0.6;
let pixRatio = Math.min(PR_MAX, IS_TOUCH ? 1.25 : 1.6), perfT = 0, perfN = 0;
renderer.setPixelRatio(pixRatio); renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
function adaptResolution(raw) {
  if (raw > 0.25) return; perfT += raw; perfN++; if (perfT < 2) return;
  const fps = perfN / perfT; perfT = 0; perfN = 0;
  const next = fps < 40 ? Math.max(PR_MIN, pixRatio - 0.15) : fps > 57 ? Math.min(PR_MAX, pixRatio + 0.1) : pixRatio;
  if (next !== pixRatio) { pixRatio = next; renderer.setPixelRatio(pixRatio); }
}
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 700);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const sound = new Sound();
const sfx = (n, v, r) => sound.play(n, v, r);

/* ---------------- 에셋 ---------------- */
const FILES = ['trilobite', 'anomalocaris', 'dunkleosteus', 'helicoprion', 'shark', 'opabinia', 'hallucigenia', 'pikaia', 'haikouichthys', 'megalograptus', 'orthocone', 'ammonite', 'jellyfish', 'coelacanth', 'groenlandaspis', 'brachiopod', 'rock', 'coral', 'timemachine', 'lab'];
const assets = {}, clips = {};
const texLoader = new THREE.TextureLoader();
async function loadAssets() {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const prog = {};
  const upd = () => { let l = 0, t = 0; for (const k of FILES) { l += prog[k]?.l || 0; t += prog[k]?.t || 1; } $('loadbar').firstElementChild.style.width = (100 * l / t).toFixed(1) + '%'; };
  await Promise.all(FILES.map(k => new Promise((res, rej) => {
    loader.load('assets/' + k + '.glb', g => { assets[k] = g.scene; clips[k] = g.animations; prog[k] = { l: 1, t: 1 }; upd(); res(); },
      e => { prog[k] = { l: e.loaded, t: e.total || e.loaded * 2 || 1 }; upd(); }, rej);
  })));
  const tex = n => { const t = texLoader.load('assets/' + n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  assets.sand = { map: tex('sand_diff.jpg'), normal: tex('sand_nor_gl.jpg'), rough: tex('sand_rough.jpg') };
  assets.sand.map.colorSpace = THREE.SRGBColorSpace;
}
// 모델을 +Z가 머리, 중심이 원점, 수평 길이가 len이 되게 감싸기
function makeModel(key, len, tint) {
  const inner = clips[key]?.length ? skClone(assets[key]) : assets[key].clone(true);
  inner.rotation.set(0, MODEL_YAW[key] || 0, MODEL_ROLL[key] || 0, 'YXZ');
  if (tint) { const c = new THREE.Color(tint); inner.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(c); } }); }
  const wrap = new THREE.Group(); wrap.add(inner); wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap), size = box.getSize(V3()), c = box.getCenter(V3());
  inner.position.sub(c);
  const s = len / Math.max(size.x, size.z); wrap.scale.setScalar(s);
  const pivot = new THREE.Group(); pivot.add(wrap);
  pivot.userData = { wrap, inner, height: size.y * s };
  if (clips[key]?.length) {
    const mixer = new THREE.AnimationMixer(inner), byName = n => clips[key].find(a => a.name === n) || clips[key][0];
    pivot.userData.mixer = mixer; pivot.userData.act = n => { const a = mixer.clipAction(byName(n)); a.reset().play(); return a; };
    const a = mixer.clipAction(byName('Swim')); a.time = Math.random() * a.getClip().duration; a.play();
  }
  pivot.traverse(o => { if (o.isMesh) o.frustumCulled = true; });
  return pivot;
}
function firstMesh(root) { let m; root.traverse(o => { if (!m && o.isMesh) m = o; }); return m; }
function bakedGeometry(key, len) {
  const piv = makeModel(key, len); piv.updateMatrixWorld(true);
  const m = firstMesh(piv), g = m.geometry.clone();
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k];
    if (a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array)) {
      const f = new Float32Array(a.count * a.itemSize), get = [a.getX, a.getY, a.getZ, a.getW];
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = get[c].call(a, i);
      g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
    }
  }
  g.applyMatrix4(m.matrixWorld); g.computeBoundingBox(); g.translate(0, -g.boundingBox.min.y, 0);
  return { geo: g, mat: m.material };
}

/* ---------------- 수중 카우스틱 ---------------- */
const CAUS = { uTime: { value: 0 } };
function patchCaustics(mat, strength = 1) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = CAUS.uTime; sh.uniforms.uStr = { value: strength };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cwp = instanceMatrix * cwp;
        #endif
        vWPos = (modelMatrix * cwp).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos; uniform float uTime; uniform float uStr;
      float caustic(vec2 uv){
        vec2 p = uv * 6.28318 - 250.0; vec2 i = p; float c = 1.0; float inten = .005;
        for (int n = 0; n < 4; n++) { float t = uTime * 0.45 * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
          c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten))); }
        c /= 4.0; c = 1.17 - pow(c, 1.4); return pow(abs(c), 8.0);
      }`)
      .replace('#include <fog_fragment>', `
        gl_FragColor.rgb += vec3(0.55, 0.9, 1.0) * caustic(vWPos.xz * 0.045) * uStr * exp(vWPos.y * 0.03) * 1.1;
        #include <fog_fragment>`);
  };
  mat.needsUpdate = true;
}
function radialTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
}
function ringTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.strokeStyle = '#fff'; g.lineWidth = 7; g.shadowColor = '#fff'; g.shadowBlur = 10; g.beginPath(); g.arc(64, 64, 52, 0, 7); g.stroke();
  return new THREE.CanvasTexture(c);
}
function bangTex() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = '#ff2d45'; g.beginPath(); g.arc(64, 64, 54, 0, 7); g.fill(); g.fillStyle = '#fff'; g.font = '900 92px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('!', 64, 70);
  return new THREE.CanvasTexture(c);
}
const RING_TEX = ringTex(), BANG_TEX = bangTex(), GLOW_TEX = radialTex('rgba(255,60,60,0.9)', 'rgba(255,60,60,0)');

/* =========================================================
   연구소
   ========================================================= */
const lab = { scene: new THREE.Scene(), t: 0, power: 0, alarm: false, shake: 0, camFrom: V3(), camTo: V3(), look: V3() };
function buildLab() {
  const s = lab.scene;
  s.environment = envTex; s.environmentIntensity = 0.55; s.background = new THREE.Color(0x03070a); s.fog = new THREE.Fog(0x03070a, 18, 40);
  const room = assets.lab.clone(true), b = new THREE.Box3().setFromObject(room), c = b.getCenter(V3());
  room.position.set(-c.x, -b.min.y, -c.z); s.add(room);
  const tm = makeModel('timemachine', 6.2), metal = new THREE.MeshStandardMaterial({ color: 0x8d97a3, metalness: 0.92, roughness: 0.32, envMapIntensity: 1.2 });
  tm.traverse(o => { if (o.isMesh) o.material = metal; });
  tm.position.set(3.0, tm.userData.height / 2, 1.6); tm.rotation.y = 0.5; s.add(tm); lab.tm = tm;
  const ring = new THREE.Group();
  const torus = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.06, 16, 96), new THREE.MeshBasicMaterial({ color: 0x5ff2ff }));
  const torus2 = new THREE.Mesh(new THREE.TorusGeometry(0.95, 0.025, 12, 96), new THREE.MeshBasicMaterial({ color: 0xbffaff }));
  const vortexMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uTime: { value: 0 }, uPow: { value: 0 }, uCol: { value: new THREE.Color(0x5ff2ff) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uTime; uniform float uPow; uniform vec3 uCol;
      void main(){ vec2 p = vUv*2.0-1.0; float r = length(p); if(r>1.0) discard;
        float a = atan(p.y,p.x); float sw = sin(a*6.0 + r*14.0 - uTime*6.0)*0.5+0.5;
        float glow = smoothstep(1.0,0.0,r); float v = (sw*0.6+0.4)*glow*uPow;
        gl_FragColor = vec4(uCol*(v*1.6 + pow(glow,6.0)*uPow*2.0), v); }`,
  });
  ring.add(torus, torus2, new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), vortexMat));
  lab.ring = ring; lab.vortex = vortexMat; lab.torus = [torus, torus2];
  ring.position.set(-1.02, 0.5, 0.08); ring.rotation.y = Math.PI / 2; ring.scale.setScalar(0.66); tm.add(ring);
  s.add(new THREE.AmbientLight(0x9fdcff, 0.35));
  const key = new THREE.SpotLight(0xbff4ff, 60, 30, 0.7, 0.6); key.position.set(1, 5.2, 4); key.target = tm; s.add(key, key.target);
  lab.tmLight = new THREE.PointLight(0x5ff2ff, 0, 14); lab.tmLight.position.set(1.6, 2.2, 2.6); s.add(lab.tmLight);
  lab.red = new THREE.PointLight(0xff2030, 0, 30); lab.red.position.set(0, 4.5, 0); s.add(lab.red);
  for (const [x, z] of [[-6, -2], [0, -3], [6, 2]]) { const l = new THREE.PointLight(0x7fdfff, 6, 12); l.position.set(x, 4.6, z); s.add(l); }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(900), 3));
  lab.sparkV = Array.from({ length: 300 }, () => V3());
  lab.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffd28a, size: 0.06, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.add(lab.sparks);
}
function updateLab(dt) {
  lab.t += dt; const pw = lab.power;
  lab.vortex.uniforms.uTime.value = lab.t; lab.vortex.uniforms.uPow.value = pw; lab.vortex.uniforms.uCol.value.set(lab.alarm ? 0xff5070 : 0x5ff2ff);
  lab.torus[0].rotation.z += dt * (0.4 + pw * 6); lab.torus[1].rotation.z -= dt * (0.3 + pw * 4);
  lab.torus.forEach(t => t.material.color.set(lab.alarm && Math.sin(lab.t * 18) > 0 ? 0xff4060 : 0x5ff2ff));
  lab.tmLight.intensity = pw * 40 * (1 + 0.2 * Math.sin(lab.t * 9));
  lab.red.intensity = lab.alarm ? 120 * (0.5 + 0.5 * Math.sin(lab.t * 9)) : 0;
  camera.position.lerpVectors(lab.camFrom, lab.camTo, smooth(0, 1, Math.min(1, lab.t / 26)));
  if (lab.alarm) { lab.shake = Math.min(1, lab.shake + dt * 0.5); camera.position.x += (Math.random() - 0.5) * 0.06 * lab.shake; camera.position.y += (Math.random() - 0.5) * 0.06 * lab.shake; }
  camera.lookAt(lab.look);
  const pos = lab.sparks.geometry.attributes.position;
  lab.sparks.material.opacity = lab.alarm ? 1 : 0;
  if (lab.alarm) {
    const o = V3(); lab.ring.getWorldPosition(o);
    for (let i = 0; i < 300; i++) {
      const v = lab.sparkV[i];
      if (pos.getY(i) < 0.02 || v.lengthSq() === 0) { pos.setXYZ(i, o.x + rand(-1, 1), o.y + rand(-1, 1), o.z + rand(-0.3, 0.3)); v.set(rand(-3, 3), rand(0, 4), rand(-3, 3)); }
      v.y -= 9.8 * dt; pos.setXYZ(i, pos.getX(i) + v.x * dt, Math.max(0.01, pos.getY(i) + v.y * dt), pos.getZ(i) + v.z * dt);
    }
    pos.needsUpdate = true;
  }
}
function startLabCamera(returning) {
  lab.t = 0; lab.shake = 0;
  lab.camFrom.set(-2.8, 2.0, 6.6); lab.camTo.set(0.4, 1.75, 4.9); lab.look.set(2.3, 1.9, 1.4);
  if (returning) { lab.camFrom.set(0.6, 1.7, 4.4); lab.camTo.set(-2.4, 1.9, 6.4); }
}

/* =========================================================
   시공간 워프
   ========================================================= */
const warp = { scene: new THREE.Scene(), t: 0, dur: 3.4, col: new THREE.Color(0x5ff2ff), seed: [] };
{
  const N = 1400, g = new THREE.BufferGeometry();
  for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, r = rand(1.5, 22); warp.seed.push([Math.cos(a) * r, Math.sin(a) * r, rand(-420, 0)]); }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
  warp.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9ff6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }));
  warp.scene.add(warp.lines); warp.scene.background = new THREE.Color(0x01040a);
}
function updateWarp(dt) {
  warp.t += dt; const k = clamp(warp.t / warp.dur, 0, 1), sp = 120 + 520 * Math.sin(Math.PI * k), pos = warp.lines.geometry.attributes.position;
  warp.seed.forEach((s, i) => { s[2] += sp * dt; if (s[2] > 2) s[2] -= 420; pos.setXYZ(i * 2, s[0], s[1], s[2]); pos.setXYZ(i * 2 + 1, s[0], s[1], s[2] - sp * 0.05); });
  pos.needsUpdate = true; warp.lines.material.color.copy(warp.col).offsetHSL(Math.sin(warp.t * 3) * 0.05, 0, 0);
  camera.position.set(0, 0, 0); camera.rotation.set(0, 0, warp.t * 0.6); camera.fov = 62 + 40 * Math.sin(Math.PI * k); camera.updateProjectionMatrix();
}

/* =========================================================
   고생대 바다
   ========================================================= */
const sea = new THREE.Scene(), ocean = {};
let era = ERAS[0], eraIdx = 0, eraT = 0;
const STAGE_MAX = STAGES.length;
const pl = { pos: V3(), vel: V3(), yaw: 0, pitch: 0, roll: 0, hp: 100, hpMax: 100, st: 100, charge: 0, xp: 0, level: 1, len: STAGES[0].len, rolled: false, hidden: false, inv: 0, shake: 0, stingCD: 0, upg: { armor: false, jet: false } };
const creatures = [], probes = [], colliders = [], vents = [], flocks = [];
let rows = [], series = [], attacks = [];
const stats = { rows: 0, eaten: 0, deaths: 0, probes: 0, start: 0, maxLevel: 1 };
const SEEN = new Set();
const frags = [String(TODAY.getFullYear()), String(TODAY.getMonth() + 1).padStart(2, '0'), String(TODAY.getDate()).padStart(2, '0')];
const gotFrag = [false, false, false];
let aiStats = { food: 0, danger: 0, vent: 0 };

function buildOcean() {
  sea.environment = envTex; sea.environmentIntensity = 0.3;
  sea.fog = new THREE.FogExp2(0x1f8a9c, 0.018); sea.background = new THREE.Color(0x1f8a9c);
  ocean.hemi = new THREE.HemisphereLight(0x7fe3ee, 0x3a3020, 1.3); sea.add(ocean.hemi);
  ocean.sun = new THREE.DirectionalLight(0xd8fbff, 2.4); ocean.sun.position.set(30, 100, 20); sea.add(ocean.sun);
  // 해저
  const N = IS_TOUCH ? 170 : 220, geo = new THREE.PlaneGeometry(WORLD * 2 + 60, WORLD * 2 + 60, N, N); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, floorY(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals(); geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.count * 3), 3)); ocean.floorGeo = geo;
  const s = assets.sand; [s.map, s.normal, s.rough].forEach(t => t.repeat.set(36, 36));
  const fm = new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normal, roughnessMap: s.rough, vertexColors: true, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) });
  patchCaustics(fm, 1); sea.add(new THREE.Mesh(geo, fm));
  // 바위 · 산호
  const rock = bakedGeometry('rock', 3.2), coral = bakedGeometry('coral', 4.2);
  const rockMat = rock.mat.clone(); patchCaustics(rockMat, 0.8); const coralMat = coral.mat.clone(); patchCaustics(coralMat, 0.6);
  const rockList = [], coralList = [];
  REEFS.forEach(([x, z, r]) => {
    coralList.push([x + rand(-3, 3), z + rand(-3, 3), rand(1.5, 2.1), rand(0, 6.28)]);
    for (let k = 0; k < 3; k++) { const a = rand(0, 6.28), d = r * rand(0.55, 0.95); rockList.push([x + Math.cos(a) * d, z + Math.sin(a) * d, rand(0.9, 1.9), rand(0, 6.28)]); }
  });
  for (let k = 0; k < 10; k++) { const x = rand(-130, 130), z = rand(-130, 130); if (Math.hypot(x - HOME.x, z - HOME.z) > 16) rockList.push([x, z, rand(1.2, 3), rand(0, 6.28)]); }
  const place = (list, g, m, rad, sink) => {
    const im = new THREE.InstancedMesh(g, m, list.length), M = new THREE.Matrix4(), Q = new THREE.Quaternion();
    list.forEach(([x, z, sc, ry], i) => {
      const y = floorY(x, z) - sink * sc;
      M.compose(new THREE.Vector3(x, y, z), Q.setFromEuler(new THREE.Euler(rand(-0.1, 0.1), ry, rand(-0.1, 0.1))), new THREE.Vector3(sc, sc, sc));
      im.setMatrixAt(i, M); colliders.push({ c: new THREE.Vector3(x, y + rad * sc * 0.45, z), r: rad * sc });
    });
    sea.add(im);
  };
  place(rockList, rock.geo, rockMat, 1.25, 0.15); place(coralList, coral.geo, coralMat, 1.8, 0.1);
  // 바다나리 · 고배류
  const parts = [], stalk = new THREE.CylinderGeometry(0.05, 0.09, 3, 6); stalk.translate(0, 1.5, 0); parts.push(stalk);
  const cup = new THREE.SphereGeometry(0.2, 10, 8); cup.translate(0, 3.05, 0); parts.push(cup);
  for (let i = 0; i < 10; i++) { const arm = new THREE.ConeGeometry(0.05, 1.3, 5); arm.translate(0, 0.65, 0); arm.rotateZ(0.6); arm.rotateY(i / 10 * Math.PI * 2); arm.translate(0, 3.1, 0); parts.push(arm); }
  const crMat = new THREE.MeshStandardMaterial({ roughness: 0.6 }); patchCaustics(crMat, 0.6);
  ocean.crinoids = new THREE.InstancedMesh(mergeGeometries(parts.map(g => g.toNonIndexed())), crMat, 90); ocean.crList = [];
  const cpal = [0xc86bd6, 0xf08a5d, 0xffc96b, 0xe85d8a, 0x9f7bff];
  for (let i = 0; i < 90; i++) {
    const [rx, rz, r] = REEFS[i % REEFS.length], a = rand(0, 6.28), d = r * rand(0.2, 1.4), x = rx + Math.cos(a) * d, z = rz + Math.sin(a) * d;
    ocean.crList.push({ x, z, y: floorY(x, z) - 0.1, s: rand(0.6, 1.5), ph: rand(0, 6.28), ry: rand(0, 6.28) }); ocean.crinoids.setColorAt(i, new THREE.Color(cpal[i % 5]));
  }
  sea.add(ocean.crinoids);
  const lathe = new THREE.LatheGeometry([[0.05, 0], [0.25, 0.1], [0.35, 0.6], [0.55, 1.4], [0.62, 1.6], [0.5, 1.58], [0.42, 0.7], [0.0, 0.5]].map(([x, y]) => new THREE.Vector2(x, y)), 14);
  const spMat = new THREE.MeshStandardMaterial({ roughness: 0.9 }); patchCaustics(spMat, 0.7);
  const sponges = new THREE.InstancedMesh(lathe, spMat, 70), M = new THREE.Matrix4();
  for (let i = 0; i < 70; i++) {
    const x = rand(-140, 140), z = rand(-140, 140), sc = rand(0.6, 1.6);
    M.compose(new THREE.Vector3(x, floorY(x, z) - 0.1, z), new THREE.Quaternion(), new THREE.Vector3(sc, sc * rand(0.8, 1.3), sc));
    sponges.setMatrixAt(i, M); sponges.setColorAt(i, new THREE.Color().setHSL(rand(0.05, 0.12), 0.55, rand(0.45, 0.6)));
  }
  sea.add(sponges);
  // 수면 · 빛줄기 · 바다눈
  ocean.surf = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ocean.surf.rotation.x = Math.PI / 2; ocean.surf.position.y = 0.2; sea.add(ocean.surf);
  const rc = document.createElement('canvas'); rc.width = 64; rc.height = 256; const rg = rc.getContext('2d');
  const grd = rg.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); rg.fillStyle = grd; rg.fillRect(0, 0, 64, 256);
  const hg = rg.createLinearGradient(0, 0, 64, 0); hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(0.5, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,1)');
  rg.globalCompositeOperation = 'destination-out'; rg.fillStyle = hg; rg.fillRect(0, 0, 64, 256);
  const rayMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(rc), transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  ocean.rays = []; for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(rand(3, 7), 46), rayMat); m.userData = { a: rand(0, 6.28), r: rand(8, 42) }; sea.add(m); ocean.rays.push(m); }
  const SN = IS_TOUCH ? 1400 : 2600, sg = new THREE.BufferGeometry(), sp = new Float32Array(SN * 3);
  for (let i = 0; i < SN * 3; i++) sp[i] = rand(-40, 40);
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  ocean.snow = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.12, map: radialTex(), transparent: true, opacity: 0.55, depthWrite: false, color: 0xdffbff }));
  ocean.snow.frustumCulled = false; sea.add(ocean.snow);
  // 먹이: 플랑크톤 · 해저 벌레
  const NP = 300, NW = 100;
  ocean.plank = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.22, 1), new THREE.MeshStandardMaterial({ color: 0xc8ffe6, emissive: 0x3dffa8, emissiveIntensity: 1.8, roughness: 0.4 }), NP);
  ocean.plankGlow = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3), 3)),
    new THREE.PointsMaterial({ size: 1.6, map: radialTex('rgba(140,255,200,0.9)', 'rgba(140,255,200,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  ocean.plankGlow.frustumCulled = false;
  ocean.worm = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.1, 0.7, 4, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff8f9f, emissive: 0x80202c, emissiveIntensity: 0.6, roughness: 0.5 }), NW);
  sea.add(ocean.plank, ocean.plankGlow, ocean.worm);
  ocean.food = [];
  for (let i = 0; i < NP; i++) ocean.food.push({ kind: 'plank', i, p: V3(), ph: rand(0, 6.28) });
  for (let i = 0; i < NW; i++) ocean.food.push({ kind: 'worm', i, p: V3(), ph: rand(0, 6.28), ry: rand(0, 6.28) });
  // 추락한 타임머신
  const tm = makeModel('timemachine', 7.5), metal = new THREE.MeshStandardMaterial({ color: 0x7d8792, metalness: 0.9, roughness: 0.45 }); patchCaustics(metal, 0.5);
  tm.traverse(o => { if (o.isMesh) o.material = metal; });
  tm.position.set(HOME.x, HOME.y + tm.userData.height * 0.42, HOME.z); tm.rotation.set(0.12, 0.8, 0.18); sea.add(tm);
  colliders.push({ c: new THREE.Vector3(HOME.x, HOME.y + 1, HOME.z), r: 3.2 });
  ocean.tmLight = new THREE.PointLight(0xff8a3d, 30, 18); ocean.tmLight.position.set(HOME.x, HOME.y + 3, HOME.z); sea.add(ocean.tmLight);
  ocean.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 90, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  ocean.beacon.position.set(HOME.x, HOME.y + 45, HOME.z); ocean.beacon.visible = false; sea.add(ocean.beacon);
  // 플레이어
  ocean.player = makeModel('trilobite', 1); sea.add(ocean.player);
  ocean.pLight = new THREE.PointLight(0xdffbff, 14, 12); ocean.pLight.position.set(0, 2.4, -1.5); ocean.player.add(ocean.pLight);
  // 미래 기술 장비 (플레이어 몸길이 1 기준 좌표)
  const ph = ocean.player.userData.height, glowMat = new THREE.MeshStandardMaterial({ color: 0x56606a, metalness: 0.9, roughness: 0.35, emissive: 0x22ccee, emissiveIntensity: 0.55 });
  ocean.armor = new THREE.Group();
  for (const s of [-1, 1]) { const plate = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.018, 0.5), glowMat); plate.position.set(s * 0.17, ph * 0.18, 0.02); plate.rotation.y = s * 0.1; ocean.armor.add(plate); }
  const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.016, 0.42), glowMat); ridge.position.set(0, ph * 0.42, -0.02); ocean.armor.add(ridge);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 8), new THREE.MeshBasicMaterial({ color: 0x8ff6ff })); core.position.set(0, ph * 0.45, 0.2); ocean.armor.add(core);
  ocean.jet = new THREE.Group();
  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.2, 12), new THREE.MeshStandardMaterial({ color: 0x5a6470, metalness: 0.95, roughness: 0.25 })); nozzle.rotation.x = Math.PI / 2; nozzle.position.set(0, 0, -0.5); nozzle.scale.setScalar(0.7); ocean.jet.add(nozzle);
  ocean.jetGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(120,230,255,1)', 'rgba(120,230,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false })); ocean.jetGlow.position.set(0, 0, -0.62); ocean.jetGlow.scale.setScalar(0.25); ocean.jet.add(ocean.jetGlow);
  ocean.player.add(ocean.armor, ocean.jet); ocean.armor.visible = ocean.jet.visible = false;
  ocean.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radialTex('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
  ocean.shadow.rotation.x = -Math.PI / 2; sea.add(ocean.shadow);
  // 거품·충격 파티클
  const BN = 400, bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BN * 3), 3));
  ocean.bub = { pts: new THREE.Points(bg, new THREE.PointsMaterial({ size: 0.35, map: radialTex('rgba(220,250,255,0.9)', 'rgba(220,250,255,0)'), transparent: true, depthWrite: false })), v: Array.from({ length: BN }, () => V3()), life: new Float32Array(BN), next: 0 };
  ocean.bub.pts.frustumCulled = false; sea.add(ocean.bub.pts);
  // 무산소 구름(페름기)
  ocean.anoxClouds = [];
  const cloudMat = new THREE.SpriteMaterial({ map: radialTex('rgba(30,24,10,0.85)', 'rgba(30,24,10,0)'), transparent: true, depthWrite: false });
  for (let i = 0; i < 26; i++) { const sp2 = new THREE.Sprite(cloudMat); sp2.userData = { x: rand(-130, 140), z: rand(-130, 130), s: rand(18, 34) }; sp2.visible = false; sea.add(sp2); ocean.anoxClouds.push(sp2); }
}
function burst(p, n, speed = 4, up = 1.5) {
  const b = ocean.bub, pos = b.pts.geometry.attributes.position;
  for (let k = 0; k < n; k++) { const i = b.next = (b.next + 1) % b.life.length; pos.setXYZ(i, p.x + rand(-0.3, 0.3), p.y + rand(-0.3, 0.3), p.z + rand(-0.3, 0.3)); b.v[i].set(rand(-1, 1), rand(0, 1) * up, rand(-1, 1)).multiplyScalar(speed); b.life[i] = rand(0.6, 1.4); }
}

/* ---------------- 화산 분출구 (페름기) ---------------- */
function buildVents() {
  vents.forEach(v => sea.remove(v.g)); vents.length = 0;
  if (!era.vents) return;
  const spots = [[-10, 20], [30, -30], [70, 40], [-70, -10], [10, 90], [100, -40], [-30, -90], [-100, 60]];
  if (!ocean.ventRock) { const r = bakedGeometry('rock', 3.2); ocean.ventRock = r.geo; ocean.ventMat = r.mat.clone(); ocean.ventMat.color = new THREE.Color(0x2a1d16); ocean.ventMat.emissive = new THREE.Color(0x3a0c00); patchCaustics(ocean.ventMat, 0.3); }
  for (const [x, z] of spots) {
    const g = new THREE.Group(), y = floorY(x, z);
    for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(ocean.ventRock, ocean.ventMat); const a = k / 3 * 6.28; m.position.set(Math.cos(a) * 1.6, -0.3, Math.sin(a) * 1.6); m.rotation.set(rand(-0.3, 0.3), a, rand(-0.3, 0.3)); m.scale.set(1.3, 1.6, 1.3); g.add(m); }
    const lava = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(255,140,40,1)', 'rgba(255,60,0,0)'), blending: THREE.AdditiveBlending, depthWrite: false, color: 0xff5a1a })); lava.position.y = 2.8; lava.scale.set(4, 4, 1); g.add(lava);
    const light = new THREE.PointLight(0xff6a2a, 10, 24); light.position.y = 5; g.add(light);
    const PN = 260, pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PN * 3), 3));
    const plume = new THREE.Points(pg, new THREE.PointsMaterial({ size: 3.4, map: radialTex('rgba(215,200,180,0.8)', 'rgba(215,200,180,0)'), transparent: true, depthWrite: false })); plume.frustumCulled = false; g.add(plume);
    const pv = Array.from({ length: PN }, () => ({ v: V3(), life: 0 }));
    g.position.set(x, y, z); sea.add(g);
    colliders.push({ c: new THREE.Vector3(x, y + 1.5, z), r: 3.2 });
    vents.push({ g, x, z, y, lava, light, plume, pv, timer: rand(8, 22), state: 'idle', erupt: 0, observed: 0, warned: false });
  }
}
function updateVents(dt) {
  for (const v of vents) {
    v.timer -= dt;
    const speedUp = 1 - 0.4 * clamp(eraT / 6, 0, 1);
    if (v.state === 'idle' && v.timer < 2.5) { v.state = 'warn'; if (dist2(v) < 60 * 60) sfx('roar', 0.35, 0.6); }
    if (v.state === 'warn' && v.timer <= 0) {
      v.state = 'erupt'; v.erupt = 3.2; const d = Math.sqrt(dist2(v));
      if (d < 120) { sfx('eruption', clamp(1.3 - d / 90, 0.15, 1)); if (d < 90) v.observed++; }
      if (d < 40) pl.shake = Math.max(pl.shake, 0.6 * (1 - d / 40));
    }
    if (v.state === 'erupt') { v.erupt -= dt; if (v.erupt <= 0) { v.state = 'idle'; v.timer = rand(14, 26) * speedUp; v.warned = false; } }
    const heat = v.state === 'erupt' ? 1 : v.state === 'warn' ? 0.6 + 0.4 * Math.sin(G.t * 20) : 0.25;
    v.lava.material.color.setHSL(0.05, 1, 0.3 + heat * 0.35); v.lava.scale.setScalar(3 + heat * 6); v.light.intensity = 8 + heat * 90;
    // 연기 기둥
    const pos = v.plume.geometry.attributes.position, rate = v.state === 'erupt' ? 1 : v.state === 'warn' ? 0.25 : 0.05;
    for (let i = 0; i < v.pv.length; i++) {
      const q = v.pv[i];
      if (q.life <= 0) { if (Math.random() < rate) { q.life = rand(1.5, 3); pos.setXYZ(i, rand(-0.8, 0.8), 2.8, rand(-0.8, 0.8)); q.v.set(rand(-2, 2), v.state === 'erupt' ? rand(16, 26) : rand(2, 4), rand(-2, 2)); } else { pos.setXYZ(i, 0, -999, 0); continue; } }
      q.life -= dt; q.v.multiplyScalar(1 - dt * 0.6); q.v.x += rand(-1, 1) * dt * 3; q.v.z += rand(-1, 1) * dt * 3;
      pos.setXYZ(i, pos.getX(i) + q.v.x * dt, pos.getY(i) + q.v.y * dt, pos.getZ(i) + q.v.z * dt);
    }
    pos.needsUpdate = true;
    // 피해
    if (v.state === 'erupt' && G.playing) {
      const dx = pl.pos.x - v.x, dz = pl.pos.z - v.z, h = Math.hypot(dx, dz), dy = pl.pos.y - v.y;
      if (h < 7 + dy * 0.12 && dy < 40) { hurt(30 * dt * (pl.rolled ? 0.5 : 1), null, true); pl.vel.y += 30 * dt; pl.vel.x += dx / (h + 0.1) * 12 * dt; pl.vel.z += dz / (h + 0.1) * 12 * dt; }
    }
  }
}
const dist2 = v => (pl.pos.x - v.x) ** 2 + (pl.pos.z - v.z) ** 2;
function ventPredicted(v) { return accuracy() >= 40 && v.observed > 0; }

/* ---------------- 부표 ---------------- */
function makeProbe(x, z, k) {
  const g = new THREE.Group(), y = Math.min(-3, floorY(x, z) + rand(3, 6));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 16), new THREE.MeshStandardMaterial({ color: 0xdfe8ee, metalness: 0.7, roughness: 0.3, emissive: 0x0a3a48 }));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10), new THREE.MeshBasicMaterial({ color: 0x5ff2ff })); cap.position.y = 0.95;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: 0x5ff2ff, transparent: true, opacity: 0.8 })); ring.rotation.x = Math.PI / 2;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(95,242,255,0.9)', 'rgba(95,242,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false })); glow.scale.set(5, 5, 1);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, Math.abs(y), 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x5ff2ff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.y = Math.abs(y) / 2; g.add(body, cap, ring, glow, beam); g.position.set(x, y, z); sea.add(g);
  return { obj: g, ring, k, got: false, pos: g.position };
}

/* =========================================================
   생물 (먹이사슬)
   ========================================================= */
class Creature {
  constructor(key, flock) {
    const sp = this.sp = SPECIES[key]; this.key = key; this.len = sp.len * rand(0.9, 1.1);
    this.obj = makeModel(sp.model, this.len, sp.tint); sea.add(this.obj);
    this.ud = this.obj.userData; this.pos = V3(); this.dir = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize(); this.target = V3();
    this.state = 'wander'; this.timer = 0; this.cool = 0; this.ph = rand(0, 6.28); this.dead = 0; this.flock = flock; this.off = new THREE.Vector3(rand(-3, 3), rand(-1.2, 1.2), rand(-3, 3));
    this.ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: RING_TEX, transparent: true, depthWrite: false, opacity: 0.85 })); this.ring.visible = false; sea.add(this.ring);
    if (sp.move === 'hunter') {
      this.bang = new THREE.Sprite(new THREE.SpriteMaterial({ map: BANG_TEX, depthTest: false, transparent: true })); this.bang.scale.setScalar(1.6 + this.len * 0.12); this.bang.visible = false; this.bang.renderOrder = 10; sea.add(this.bang);
      this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); this.glow.visible = false; sea.add(this.glow);
    }
    this.spawn(true);
  }
  get edible() { return !this.sp.apex && this.len <= pl.len * 0.9; }
  get hostile() { return this.sp.move === 'hunter' && (this.sp.apex || this.len > pl.len * 1.1); }
  spawn(first) {
    let best = null, bw = -1;
    for (let i = 0; i < 14; i++) {
      const x = rand(-138, 138), z = rand(-138, 138);
      if (Math.hypot(x - pl.pos.x, z - pl.pos.z) < (first ? 25 : 55) || Math.hypot(x - HOME.x, z - HOME.z) < 20) continue;
      const fy = floorY(x, z), e = env(x, fy + 3, z, era, eraT);
      const w = (this.sp.move === 'hunter' ? era.predPref(x, z, e, reefDist(x, z)) ** 2 : 0.3 + e.food / 10) * Math.random();
      if (w > bw) { bw = w; best = [x, z, fy]; }
    }
    best = best || [rand(-100, 100), rand(-100, 100), -30];
    const fl = this.flock;
    if (fl && fl.placed) this.pos.copy(fl.pos).add(this.off);
    else { this.pos.set(best[0], this.yFor(best[2]), best[1]); if (fl) { fl.pos.copy(this.pos); fl.target.copy(this.pos); fl.placed = true; } }
    this.pickTarget(); this.obj.visible = true; this.dead = 0; this.state = 'wander';
  }
  yFor(fy) { const m = this.sp.move; return m === 'floor' || m === 'static' ? fy + this.len * 0.12 : Math.min(-2.5, fy + rand(2, m === 'hunter' ? 10 : 8)); }
  pickTarget() {
    const x = clamp(this.pos.x + rand(-45, 45), -138, 138), z = clamp(this.pos.z + rand(-45, 45), -138, 138);
    if (this.sp.move === 'hunter') {
      let best = [x, z], bw = -1;
      for (let i = 0; i < 8; i++) { const cx = rand(-135, 135), cz = rand(-135, 135); if (Math.hypot(cx - HOME.x, cz - HOME.z) < 22) continue; const e = env(cx, -10, cz, era, eraT), w = era.predPref(cx, cz, e, reefDist(cx, cz)) ** 2 * Math.random(); if (w > bw) { bw = w; best = [cx, cz]; } }
      this.target.set(best[0], this.yFor(floorY(best[0], best[1])), best[1]);
    } else this.target.set(x, this.yFor(floorY(x, z)), z);
  }
  kill() {
    this.dead = rand(18, 30); this.obj.visible = false; this.ring.visible = false; if (this.bang) { this.bang.visible = false; this.glow.visible = false; }
  }
  update(dt) {
    const sp = this.sp, m = sp.move;
    if (this.dead > 0) { this.dead -= dt; if (this.dead <= 0) this.spawn(false); return; }
    this.ph += dt; this.cool -= dt; this.timer -= dt;
    const toP = V3().subVectors(pl.pos, this.pos), dist = toP.length();
    const far = dist > 110; this.obj.visible = !far;
    if (far && m !== 'hunter') { this.ring.visible = false; return; }
    let want = null, speed = sp.speed * 0.5;
    const edible = this.edible, hostile = this.hostile;
    if (m === 'hunter') ({ want, speed } = this.hunt(dt, toP, dist, hostile, edible));
    else if (edible && dist < 10 && m !== 'static') { want = toP.clone().negate(); speed = sp.speed * 1.5; }
    if (this.flock && !want) { want = V3().subVectors(V3().addVectors(this.flock.pos, this.off), this.pos); speed = this.flock.speed; if (want.length() < 0.5) want = this.flock.dir.clone(); }
    if (!want) { want = V3().subVectors(this.target, this.pos); if (want.length() < 4) this.pickTarget(); }
    if (m === 'static') speed = 0;
    if (m === 'floor') want.y = 0;
    if (want.lengthSq() > 1e-6) { want.normalize(); this.dir.lerp(want, 1 - Math.exp(-dt * (this.state === 'lunge' ? 0.3 : 2))).normalize(); }
    if (m === 'drift') { this.pos.y += Math.sin(this.ph * 1.3) * dt * 0.5; }
    this.pos.addScaledVector(this.dir, speed * dt);
    const fy = floorY(this.pos.x, this.pos.z);
    if (m === 'floor' || m === 'static') this.pos.y = fy + this.len * 0.12;
    else { this.pos.y = clamp(this.pos.y, fy + this.len * 0.25 + 0.4, -2.2); }
    const R = Math.hypot(this.pos.x, this.pos.z); if (R > WORLD - 6) { this.pos.x *= (WORLD - 6) / R; this.pos.z *= (WORLD - 6) / R; this.pickTarget(); }
    // 모습
    const o = this.obj; o.position.copy(this.pos);
    if (m !== 'drift' && m !== 'static') { const look = V3().addVectors(this.pos, m === 'floor' ? new THREE.Vector3(this.dir.x, 0, this.dir.z) : this.dir); o.lookAt(look); }
    const w = this.ud.wrap;
    if (m === 'drift') { w.scale.y = w.scale.x * (1 + Math.sin(this.ph * 2.4) * 0.12); }
    else if (!this.ud.mixer && m !== 'static') w.rotation.y = Math.sin(this.ph * (this.state === 'chase' || this.state === 'lunge' ? 9 : 4) * (m === 'floor' ? 0.6 : 1)) * (m === 'floor' ? 0.04 : 0.12);
    if (this.ud.mixer) this.ud.mixer.update(dt * (this.state === 'chase' ? 2 : 1));
    if (this.state === 'lunge') { w.scale.z = w.scale.x * 1.12; } else if (m !== 'drift') w.scale.z = w.scale.x;
    // 먹이사슬 테두리
    const camD = this.pos.distanceTo(camera.position), showRing = dist < 30 && (edible || hostile) && camD > this.len * 1.4 + 2;
    this.ring.visible = showRing;
    if (showRing) { this.ring.position.copy(this.pos); this.ring.scale.setScalar(this.len * 0.95 + 0.5); this.ring.material.color.set(edible ? 0x5dff8a : 0xff3b50); this.ring.material.opacity = clamp((camD - this.len) / 12, 0, 1) * (0.3 + 0.3 * (1 - dist / 30)); }
    if (!SEEN.has(this.key) && dist < 12 && G.playing) discover(this);
    // 해파리 독침 · 큰 생물과 부딪힘
    if (G.playing && !edible && dist < this.len * 0.45 + pl.len * 0.4) {
      if (sp.sting && pl.stingCD <= 0) { pl.stingCD = 1.2; hurt(sp.sting, this); sfx('sting'); }
      if (m !== 'hunter') pl.vel.addScaledVector(toP.normalize(), 3);
    }
  }
  hunt(dt, toP, dist, hostile, edible) {
    const sp = this.sp; let want = null, speed = sp.speed * 0.45;
    const det = sp.detect * (pl.hidden ? 0.45 : 1) * (pl.rolled ? 0.7 : 1) * (1 + 0.15 * eraIdx);
    if (!hostile) {
      this.setAlert(false);
      if (edible && dist < 12) { this.state = 'flee'; return { want: toP.clone().negate(), speed: sp.speed * 1.3 }; }
      this.state = 'wander'; return { want: null, speed };
    }
    switch (this.state) {
      case 'wander': case 'flee':
        this.state = 'wander';
        if (G.playing && dist < det && this.cool <= 0) { this.state = 'notice'; this.timer = 0.65; sfx('alert', 0.8); sfx('roar', 0.5, 0.9 + Math.random() * 0.2); }
        break;
      case 'notice': want = toP; speed = sp.speed * 0.2; if (this.timer <= 0) { this.state = 'chase'; this.timer = 12; } break;
      case 'chase': {
        const lead = V3().addVectors(pl.pos, V3().copy(pl.vel).multiplyScalar(0.5)); want = lead.sub(this.pos); speed = sp.speed;
        if (dist < this.len * 0.9 + 3) { this.state = 'windup'; this.timer = 0.5; sfx('roar', 0.6, 1.2); }
        if (dist > det * 2.2 || this.timer <= 0 || (pl.hidden && dist > 7)) { this.state = 'wander'; this.cool = 5; this.pickTarget(); }
        break;
      }
      case 'windup': want = toP; speed = sp.speed * 0.25; if (this.timer <= 0) { this.state = 'lunge'; this.timer = 0.55; this.lungeDir = toP.clone().normalize(); this.hit = false; sfx('dash', 0.8, 0.7); } break;
      case 'lunge':
        this.dir.copy(this.lungeDir); speed = sp.speed * 2.7; want = null;
        if (!this.hit && G.playing && dist < this.len * 0.42 + pl.len * 0.45 && pl.inv <= 0) { this.hit = true; this.bite(toP); }
        if (this.timer <= 0) { this.state = 'recover'; this.timer = this.hit ? 2.6 : 1.1; }
        break;
      case 'recover': speed = sp.speed * (this.hit ? 0.7 : 0.35); if (this.hit) want = toP.clone().negate(); if (this.timer <= 0) { this.state = 'chase'; this.timer = 9; } break;
    }
    this.setAlert(this.state === 'notice' || this.state === 'windup' || this.state === 'lunge');
    return { want, speed };
  }
  setAlert(on) {
    if (!this.bang) return;
    this.bang.visible = on && this.obj.visible; this.glow.visible = (this.state === 'windup' || this.state === 'lunge') && this.obj.visible;
    if (on) { this.bang.position.copy(this.pos).add(new THREE.Vector3(0, this.ud.height * 0.7 + 1.2, 0)); this.bang.material.opacity = 0.7 + 0.3 * Math.sin(G.t * 20); }
    if (this.glow.visible) { this.glow.position.copy(this.pos).addScaledVector(this.dir, this.len * 0.4); this.glow.scale.setScalar(this.len * (0.9 + 0.3 * Math.sin(G.t * 30))); }
  }
  bite(toP) {
    const away = toP.clone().normalize(), dmg = this.sp.bite * (pl.rolled ? 0.25 : 1);
    pl.vel.addScaledVector(away, pl.rolled ? 10 : 16);
    hurt(dmg, this); sfx(pl.rolled ? 'shield' : 'bite'); burst(pl.pos, 28, 6);
    attacks.push({ x: pl.pos.x, z: pl.pos.z, reef: reefDist(pl.pos.x, pl.pos.z), t: eraT });
    if (pl.rolled) toast('몸 말기로 피해를 크게 줄였어요!', 'gold');
    else { slowmo(0.35); toast(`${this.sp.name}의 공격! (−${Math.round(dmg)})`, 'red'); }
  }
}
function spawnCreatures() {
  creatures.forEach(c => { sea.remove(c.obj); sea.remove(c.ring); if (c.bang) { sea.remove(c.bang); sea.remove(c.glow); } }); creatures.length = 0; flocks.length = 0;
  for (const [key, [n, size]] of Object.entries(era.roster)) {
    for (let i = 0; i < n; i++) {
      if (size > 1) { const fl = { pos: V3(), dir: new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize(), target: V3(), speed: SPECIES[key].speed * 0.55, placed: false, members: [] }; flocks.push(fl); for (let k = 0; k < size; k++) { const c = new Creature(key, fl); fl.members.push(c); creatures.push(c); } }
      else creatures.push(new Creature(key));
    }
  }
}
function updateFlocks(dt) {
  for (const fl of flocks) {
    const alive = fl.members.filter(m => !m.dead); if (!alive.length) continue;
    const toP = V3().subVectors(pl.pos, fl.pos), d = toP.length(), scared = alive[0].edible && d < 14;
    let want = scared ? toP.negate() : V3().subVectors(fl.target, fl.pos);
    if (!scared && want.length() < 6) { fl.target.set(clamp(fl.pos.x + rand(-50, 50), -135, 135), 0, clamp(fl.pos.z + rand(-50, 50), -135, 135)); fl.target.y = Math.min(-3, floorY(fl.target.x, fl.target.z) + rand(3, 9)); }
    want.normalize(); fl.dir.lerp(want, 1 - Math.exp(-dt * 1.5)).normalize();
    const sp = SPECIES[alive[0].key].speed * (scared ? 1.4 : 0.55); fl.speed = sp;
    fl.pos.addScaledVector(fl.dir, sp * dt); fl.pos.y = clamp(fl.pos.y, floorY(fl.pos.x, fl.pos.z) + 2, -2.5);
    const R = Math.hypot(fl.pos.x, fl.pos.z); if (R > WORLD - 10) { fl.pos.x *= (WORLD - 10) / R; fl.pos.z *= (WORLD - 10) / R; }
  }
}

/* ---------------- 먹이 ---------------- */
function respawnFood(f) {
  for (let k = 0; k < 40; k++) {
    const x = rand(-140, 140), z = rand(-140, 140), fy = floorY(x, z);
    const y = f.kind === 'worm' ? fy + 0.12 : rand(Math.max(fy + 0.8, -24), -2.2);
    if (Math.random() * 11.5 < env(x, y, z, era, eraT).food + 1.5 || k === 39) { f.p.set(x, y, z); return; }
  }
}

/* =========================================================
   데이터 · AI 예측
   ========================================================= */
const GN = 30, GC = (WORLD * 2) / GN;
const GKEYS = ['food', 'o2', 'temp', 'nut', 'pred'];
let grid, gridPred, predT = 0;
function resetGrid() {
  grid = { cnt: new Float32Array(GN * GN) }; gridPred = {};
  for (const k of GKEYS) { grid[k] = new Float32Array(GN * GN); gridPred[k] = new Float32Array(GN * GN).fill(NaN); }
}
const cellOf = (x, z) => clamp(Math.floor((z + WORLD) / GC), 0, GN - 1) * GN + clamp(Math.floor((x + WORLD) / GC), 0, GN - 1);
function addRow(r) {
  rows.push(r); stats.rows++;
  if (r.outlier) return;
  const c = cellOf(r.x, r.z); grid.cnt[c]++; for (const k of GKEYS) grid[k][c] += r[k];
}
function sampleRow(x, y, z, extra = {}) {
  const e = env(x, y, z, era, eraT);
  return { x, z, t: eraT, depth: e.depth, temp: e.temp, o2: e.o2, co2: e.co2, ph: e.ph, nut: e.nut, food: e.food, reef: e.reef, pred: 0, ...extra };
}
const hostileNear = (p, r = 30) => creatures.filter(c => !c.dead && c.sp.move === 'hunter' && c.hostile && c.pos.distanceTo(p) < r).length;
function probeRows(pb) {
  for (let k = 0; k < 180; k++) {
    const a = rand(0, 6.28), d = rand(0, 65), x = clamp(pb.pos.x + Math.cos(a) * d, -145, 145), z = clamp(pb.pos.z + Math.sin(a) * d, -145, 145);
    const r = sampleRow(x, rand(floorY(x, z) + 0.5, -1), z); r.food = clamp(r.food + rand(-0.8, 0.8), 0, 10);
    r.pred = Math.max(0, Math.round(era.predPref(x, z, r, r.reef) * 2.4 * rand(0.4, 1.6) - 0.4)); addRow(r);
  }
  if (pb.k === era.outlierProbe) for (let k = 0; k < 30; k++) { const r = sampleRow(pb.pos.x + rand(-6, 6), pb.pos.y, pb.pos.z + rand(-6, 6)); r.temp = rand(85, 99); r.food = rand(8, 10); r.nut = rand(0, 1); r.outlier = true; addRow(r); }
}
function seriesRow() {
  let T = 0, O = 0, C = 0; const n = 30;
  for (let k = 0; k < n; k++) { const x = rand(-140, 140), z = rand(-140, 140), e = env(x, rand(floorY(x, z) + 1, -1), z, era, eraT); T += e.temp; O += e.o2; C += e.co2; }
  series.push({ t: eraT, avgT: T / n + rand(-0.15, 0.15), avgO2: O / n + rand(-0.08, 0.08), co2: C / n });
}
const accuracy = () => Math.round(100 * (1 - Math.exp(-rows.length / 700)));
// 관측한 칸에서 주변 칸으로 값을 퍼뜨려 예측 지도 만들기 (거리 가중 평균)
function predict() {
  const R = 4;
  for (const k of GKEYS) {
    const out = gridPred[k];
    for (let j = 0; j < GN; j++) for (let i = 0; i < GN; i++) {
      let s = 0, w = 0;
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= GN || jj >= GN) continue;
        const c = jj * GN + ii, n = grid.cnt[c]; if (!n) continue;
        const ww = n / (1 + di * di + dj * dj) ** 1.5; s += grid[k][c] / n * ww; w += ww;
      }
      out[j * GN + i] = w > 0.15 ? s / w : NaN;
    }
  }
  // 공격받은 곳은 위험도를 높임
  for (const a of attacks) { const c = cellOf(a.x, a.z); if (!isNaN(gridPred.pred[c])) gridPred.pred[c] += 1.5; }
}
let aiFood = null, aiT = 0, dangerT = 0;
function aiHints(dt) {
  aiT -= dt; dangerT -= dt;
  const acc = accuracy();
  if (acc >= 35 && aiT <= 0) {
    aiT = 14; let best = -1, bc = -1;
    for (let c = 0; c < GN * GN; c++) {
      const f = gridPred.food[c], dg = gridPred.pred[c]; if (isNaN(f)) continue;
      const cx = (c % GN + 0.5) * GC - WORLD, cz = (Math.floor(c / GN) + 0.5) * GC - WORLD, d = Math.hypot(cx - pl.pos.x, cz - pl.pos.z);
      if (d < 15 || d > 110) continue; const score = f - (dg || 0) * 1.5 - d * 0.01; if (score > best) { best = score; bc = c; }
    }
    if (bc >= 0) {
      const cx = (bc % GN + 0.5) * GC - WORLD, cz = (Math.floor(bc / GN) + 0.5) * GC - WORLD;
      const first = !aiFood; aiFood = new THREE.Vector3(cx, Math.min(-4, floorY(cx, cz) + 5), cz); aiStats.food++;
      if (first) radio(`데이터 ${fmt(rows.length)}행 학습 완료! AI 예측 정확도 ${acc}%. 초록 화살표 쪽에 먹이가 많고 안전할 확률이 높아요.`);
    }
  }
  // 진행 방향의 위험 예측
  if (acc >= 35 && dangerT <= 0) {
    const ahead = V3().copy(pl.pos).addScaledVector(fwd, 22), c = cellOf(ahead.x, ahead.z), dg = gridPred.pred[c];
    if (dg > 1.2) { dangerT = 9; aiStats.danger++; G.aiWarn = { until: G.t + 4, p: Math.min(95, Math.round(acc * 0.5 + dg * 18)) }; sfx('alert', 0.4); }
  }
}

/* ---------------- 입력 ---------------- */
const keys = {}; const ptr = { x: 0, y: 0, in: false, L: false, R: false };
addEventListener('keydown', e => {
  keys[e.code] = true;
  if ((e.code === 'Space' || e.code === 'Enter') && !$('dialog').classList.contains('hidden')) { e.preventDefault(); nextLine(); return; }
  if (e.code === 'KeyM' && G.mode === 'ocean') { mapVar = (mapVar + 1) % MAPVARS.length; drawMinimap(true); }
  if (e.code === 'KeyN' && e.ctrlKey && e.shiftKey && G.playing) teacherComplete();
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('contextmenu', e => e.preventDefault());
// 왼쪽 화면 = 이동 조이스틱, 오른쪽 화면 = 시점 돌리기 (마우스는 끌어서 시점 돌리기)
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0, full: 0 }, JOY_R = 64;
const look = { id: null, x: 0, y: 0 };
const cam = { yaw: 0.6, pitch: -0.18, last: -99 };
const JOY_HOME = () => ({ x: Math.max(110, innerWidth * 0.13), y: innerHeight - Math.max(120, innerHeight * 0.2) });
function joyShow(x, y) { const el = $('joy'); el.style.left = x + 'px'; el.style.top = y + 'px'; }
canvas.addEventListener('pointerdown', e => {
  if (!$('dialog').classList.contains('hidden')) { nextLine(); return; }
  const leftSide = e.clientX < innerWidth * 0.45 && e.pointerType !== 'mouse';
  if (leftSide && joy.id === null) {
    joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0; joy.full = 0;
    joyShow(joy.ox, joy.oy); $('joy').classList.add('on'); $('joy').firstElementChild.style.transform = '';
  } else if (look.id === null) { look.id = e.pointerId; look.x = e.clientX; look.y = e.clientY; }
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId === joy.id) {
    let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const L = Math.hypot(dx, dy);
    if (L > JOY_R) { dx *= JOY_R / L; dy *= JOY_R / L; }
    joy.x = dx / JOY_R; joy.y = dy / JOY_R; $('joy').firstElementChild.style.transform = `translate(${dx}px,${dy}px)`;
  } else if (e.pointerId === look.id) {
    const s = e.pointerType === 'mouse' ? 0.005 : 0.0065;
    cam.yaw -= (e.clientX - look.x) * s * LOOK_INV; cam.pitch = clamp(cam.pitch - (e.clientY - look.y) * s * 0.8, -1.1, 0.75);
    look.x = e.clientX; look.y = e.clientY; cam.last = G.t;
  }
});
const ptrEnd = e => {
  if (e.pointerId === joy.id) { joy.id = null; joy.x = joy.y = 0; const h = JOY_HOME(); joyShow(h.x, h.y); $('joy').classList.remove('on'); $('joy').firstElementChild.style.transform = ''; }
  if (e.pointerId === look.id) look.id = null;
};
canvas.addEventListener('pointerup', ptrEnd); canvas.addEventListener('pointercancel', ptrEnd);
addEventListener('resize', () => { if (joy.id === null) { const h = JOY_HOME(); joyShow(h.x, h.y); } });
{ const h = JOY_HOME(); joyShow(h.x, h.y); }
function holdButton(el, key) {
  const on = e => { e.preventDefault(); ptr[key] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (_) { } };
  const off = () => { ptr[key] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
}
holdButton($('tb-dash'), 'L'); holdButton($('tb-roll'), 'R');
$('mapbox').addEventListener('pointerdown', () => { if (G.mode === 'ocean') { mapVar = (mapVar + 1) % MAPVARS.length; drawMinimap(true); sfx('click'); } });
if (P.has('teacher')) $('tb-teacher').classList.remove('hidden');
$('tb-teacher').addEventListener('click', () => { if (G.playing) teacherComplete(); });
$('mute').addEventListener('click', () => { $('mute').textContent = sound.toggleMute() ? '소리 꺼짐' : '소리 켜짐'; });
// 시점 반전 (패드마다 기본값을 기억)
let LOOK_INV = 1; try { LOOK_INV = localStorage.getItem('lookInv') === '1' ? -1 : 1; } catch (_) { }
const invLabel = () => $('invert').textContent = LOOK_INV < 0 ? '시점 반전 켬' : '시점 반전 끔'; invLabel();
$('invert').addEventListener('click', () => { LOOK_INV *= -1; try { localStorage.setItem('lookInv', LOOK_INV < 0 ? '1' : '0'); } catch (_) { } invLabel(); });
function teacherComplete() { pl.charge = 100; probes.forEach(pb => { if (!pb.got) collectProbe(pb); }); }

/* ---------------- 플레이어 ---------------- */
const fwd = new THREE.Vector3(0, 0, 1);
function updatePlayer(dt) {
  // 이동 입력 (조이스틱 또는 WASD) — 카메라가 보는 방향 기준
  let jx = 0, jy = 0;
  if (keys.KeyA || keys.ArrowLeft) jx -= 1; if (keys.KeyD || keys.ArrowRight) jx += 1;
  if (keys.KeyW || keys.ArrowUp) jy -= 1; if (keys.KeyS || keys.ArrowDown) jy += 1;
  if (keys.KeyQ) cam.pitch = clamp(cam.pitch + dt * 1.2, -1.1, 0.75); if (keys.KeyZ) cam.pitch = clamp(cam.pitch - dt * 1.2, -1.1, 0.75);
  if (!jx && !jy && joy.id !== null) { jx = joy.x; jy = joy.y; }
  let mag = clamp(Math.hypot(jx, jy), 0, 1); if (mag < 0.12) mag = 0;
  const cf = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  const cr = new THREE.Vector3(-Math.cos(cam.yaw), 0, Math.sin(cam.yaw));
  // 조이스틱을 끝까지 밀고 있으면 자동 가속
  joy.full = mag > 0.9 && joy.id !== null ? joy.full + dt : 0;
  pl.rolled = (keys.KeyE || ptr.R) && pl.st > 2;
  const jet = pl.upg.jet, boost = (keys.Space || ptr.L || keys.ShiftLeft || joy.full > 0.6) && pl.st > 1 && !pl.rolled;
  if (boost && !pl.boosting) sfx('dash', 0.5); pl.boosting = boost;
  pl.st = clamp(pl.st + (boost ? -24 * (jet ? 0.7 : 1) : pl.rolled ? -9 : 16) * dt, 0, 100);
  if (mag > 0) {
    const d = V3().addScaledVector(cf, -jy).addScaledVector(cr, jx).normalize();
    const ty = Math.atan2(d.x, d.z), tp = clamp(Math.asin(clamp(d.y, -1, 1)), -0.95, 0.95);
    let dy = ty - pl.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    pl.yaw += clamp(dy, -4.5 * dt, 4.5 * dt);
    pl.pitch = lerp(pl.pitch, tp, 1 - Math.exp(-dt * 4)); pl.roll = lerp(pl.roll, -clamp(dy, -0.6, 0.6), 1 - Math.exp(-dt * 5));
  } else { pl.pitch = lerp(pl.pitch, 0, 1 - Math.exp(-dt * 1.5)); pl.roll = lerp(pl.roll, 0, 1 - Math.exp(-dt * 4)); }
  if (boost && mag === 0) mag = 1; // 돌진 버튼만 눌러도 앞으로 돌진
  // 시점을 한동안 안 돌리면 카메라가 천천히 등 뒤로 돌아와요
  if (G.t - cam.last > 2.5 && mag > 0.2) { let dc = pl.yaw - cam.yaw; dc = Math.atan2(Math.sin(dc), Math.cos(dc)); cam.yaw += dc * (1 - Math.exp(-dt * 0.8)); }
  fwd.set(Math.sin(pl.yaw) * Math.cos(pl.pitch), Math.sin(pl.pitch), Math.cos(pl.yaw) * Math.cos(pl.pitch));
  const base = 4.2 + pl.len * 1.1;
  const speed = pl.rolled ? 0 : base * (boost ? (jet ? 2.85 : 2.2) : mag);
  pl.vel.lerp(fwd.clone().multiplyScalar(speed), 1 - Math.exp(-dt * (pl.rolled ? 1.2 : 3.2)));
  pl.pos.addScaledVector(pl.vel, dt);
  if (boost && Math.random() < 0.4) burst(V3().copy(pl.pos).addScaledVector(fwd, -pl.len * 0.6), 1, 1, 1);
  const fy = floorY(pl.pos.x, pl.pos.z) + 0.25 * pl.len;
  if (pl.pos.y < fy) { pl.pos.y = fy; if (pl.vel.y < 0) pl.vel.y *= -0.2; }
  if (pl.pos.y > -1.2) { pl.pos.y = -1.2; if (pl.vel.y > 0) pl.vel.y = 0; }
  const R = Math.hypot(pl.pos.x, pl.pos.z); if (R > WORLD - 6) { pl.pos.x *= (WORLD - 6) / R; pl.pos.z *= (WORLD - 6) / R; }
  for (const c of colliders) { const d = V3().subVectors(pl.pos, c.c), L = d.length(), r = c.r + 0.35 * pl.len; if (L < r && L > 0.001) pl.pos.addScaledVector(d, (r - L) / L); }
  pl.hidden = reefDist(pl.pos.x, pl.pos.z) < 3 && pl.pos.y - floorY(pl.pos.x, pl.pos.z) < 5;
  // 환경
  const e = env(pl.pos.x, pl.pos.y, pl.pos.z, era, eraT); G.e = e;
  let stress = 0; if (e.o2 < 2.6) stress += (2.6 - e.o2) * 6; if (e.temp > 34) stress += (e.temp - 34) * 3.2;
  if (stress > 0) hurt(stress * dt, null, true); else pl.hp = Math.min(pl.hpMax, pl.hp + dt * 1.2);
  pl.inv -= dt; pl.stingCD -= dt;
  // 크기 · 모습
  pl.len = lerp(pl.len, STAGES[pl.level - 1].len, 1 - Math.exp(-dt * 2));
  const o = ocean.player; o.position.copy(pl.pos); o.rotation.set(-pl.pitch, pl.yaw, pl.roll, 'YXZ');
  const w = o.userData.wrap, roll = pl.rolled ? 1 : 0;
  w.rotation.x = lerp(w.rotation.x, roll * -1.1, 1 - Math.exp(-dt * 8)); w.rotation.z = Math.sin(G.t * 9) * 0.04 * (1 - roll);
  o.scale.setScalar(pl.len * (1 - roll * 0.15) * (pl.inv > 0 && Math.sin(G.t * 40) > 0 ? 1.04 : 1));
  ocean.pLight.distance = 10 + pl.len * 3;
  if (pl.upg.jet) ocean.jetGlow.scale.setScalar(pl.boosting ? 0.55 + Math.random() * 0.2 : 0.22);
  const fr = floorY(pl.pos.x, pl.pos.z), hgt = pl.pos.y - fr;
  ocean.shadow.position.set(pl.pos.x, fr + 0.06, pl.pos.z); ocean.shadow.scale.setScalar(pl.len * 2.2 * (1 + hgt * 0.05)); ocean.shadow.material.opacity = clamp(1 - hgt / 14, 0, 1);
  if (pl.hp <= 0) respawn();
}
function hurt(dmg, src, quiet) {
  if (dmg <= 0 || G.respawning) return;
  if (pl.upg.armor) dmg *= 0.8;
  pl.hp -= dmg;
  if (!quiet) { pl.inv = 1.0; pl.shake = 0.7; flash('rgba(255,40,60,.45)', 450); floatText('−' + Math.round(dmg), pl.pos, '#ff5b6b', true); }
  else if (Math.random() < dt60()) floatText('−' + Math.max(1, Math.round(dmg * 30)), pl.pos, '#ffb547');
}
let _dt = 1 / 60; const dt60 = () => _dt * 1.5;
function gainXP(xp, charge, at) {
  pl.xp += xp; pl.charge = Math.min(100, pl.charge + charge); pl.hp = Math.min(pl.hpMax, pl.hp + xp * 0.6);
  floatText(`+${xp} XP`, at, '#5dff8a');
  const next = STAGES[pl.level];
  if (next && pl.xp >= next.xp) molt();
}
function molt() {
  pl.level++; stats.maxLevel = Math.max(stats.maxLevel, pl.level);
  const st = STAGES[pl.level - 1]; pl.hpMax = st.hp; pl.hp = pl.hpMax;
  // 벗은 껍데기(탈피각) 남기기 — 삼엽충 화석 중 많은 수가 이런 탈피 껍데기예요
  const shell = makeModel('trilobite', pl.len); shell.traverse(m => { if (m.isMesh) { m.material = m.material.clone(); m.material.transparent = true; m.material.opacity = 0.55; m.material.color.multiplyScalar(0.8); } });
  shell.position.copy(pl.pos); shell.rotation.copy(ocean.player.rotation); sea.add(shell); ocean.shells = ocean.shells || []; ocean.shells.push({ m: shell, t: 10 });
  sfx('molt'); burst(pl.pos, 40, 5);
  banner('탈피 성공!', st.name, `몸길이 ↑ · 체력 ${st.hp} · 이제 더 큰 생물도 먹을 수 있어요`, 2400);
}
async function respawn() {
  if (G.respawning) return; G.respawning = true; G.playing = false; stats.deaths++;
  flash('rgba(0,0,0,1)', 1000); await sleep(700);
  pl.pos.set(HOME.x + 6, HOME.y + 4, HOME.z + 6); pl.vel.set(0, 0, 0); pl.hp = pl.hpMax; pl.inv = 3; pl.charge = Math.max(0, pl.charge - 10);
  creatures.forEach(c => { if (c.sp.move === 'hunter') { c.state = 'wander'; c.cool = 6; } });
  radio('생체 신호 위험! 타임머신 옆으로 긴급 소환했어요. 충전량이 조금 줄었어요(−10%).');
  G.playing = true; G.respawning = false;
}
function eatCheck() {
  const r0 = pl.len * 0.6 + 0.6, pull = (r0 * 2.6) ** 2;
  for (const f of ocean.food) {
    if (f.p.distanceToSquared(pl.pos) < pull) f.p.lerp(pl.pos, 1 - Math.exp(-_dt * 4)); // 가까운 먹이는 빨려 들어와요
    if (f.p.distanceToSquared(pl.pos) < r0 * r0) { const big = f.kind === 'worm'; stats.eaten++; sfx('eat'); gainXP(big ? 4 : 2, big ? 4 : 2, f.p); respawnFood(f); }
  }
  for (const c of creatures) {
    if (c.dead || !c.edible) continue;
    const r = pl.len * 0.65 + c.len * 0.4;
    if (c.pos.distanceToSquared(pl.pos) < r * r) {
      const xp = Math.round(6 + c.len * 9); stats.eaten++; sfx('eat', 1, 0.7); burst(c.pos, 14, 3); gainXP(xp, xp * 0.7, c.pos); c.kill();
    }
  }
}
function collectProbe(pb) {
  pb.got = true; sea.remove(pb.obj); stats.probes++; sfx('probe'); probeRows(pb);
  floatText('+180행 데이터', pb.pos, '#5ff2ff');
  radio(`부표 ${probes.filter(p => p.got).length}/5 회수! 관측 데이터 180행 수신.\n드론 대기 관측: ${era.land[pb.k]}`, 8000);
}
function discover(c) {
  SEEN.add(c.key);
  radio(`새 생물 발견! ${c.sp.name}\n${c.sp.fact}`, 6500);
}

/* ---------------- 바다 장면 설정 ---------------- */
function setupEra(i, keep) {
  eraIdx = i; era = ERAS[i]; eraT = 0;
  sea.fog.color.set(era.fog); sea.fog.density = era.fogD; sea.background.set(era.fog);
  ocean.hemi.color.set(era.hemiSky); ocean.hemi.groundColor.set(era.hemiGround); ocean.sun.color.set(era.sun); ocean.surf.material.color.set(era.surface);
  const p = ocean.floorGeo.attributes.position, col = ocean.floorGeo.attributes.color, [tr, tg, tb] = era.floorTint;
  for (let k = 0; k < p.count; k++) { const d = smooth(-8, -62, p.getY(k)), v = 1 - d * 0.55; col.setXYZ(k, tr * v, tg * v, tb * v * (1 + d * 0.15)); }
  col.needsUpdate = true;
  // 성장은 타임머신의 생체 데이터로 다음 시대에 이어져요
  if (!keep) { pl.level = 1; pl.xp = 0; pl.len = STAGES[0].len; }
  pl.hpMax = STAGES[pl.level - 1].hp; pl.hp = pl.hpMax; pl.st = 100; pl.charge = 0; pl.inv = 2;
  pl.upg.armor = i >= 1; pl.upg.jet = i >= 2; ocean.armor.visible = pl.upg.armor; ocean.jet.visible = pl.upg.jet;
  pl.pos.set(HOME.x + 6, HOME.y + 4, HOME.z + 6); pl.vel.set(0, 0, 0); pl.yaw = 0.6; pl.pitch = 0;
  radioQ.length = 0; rows = []; series = []; attacks = []; resetGrid(); aiStats = { food: 0, danger: 0, vent: 0 }; aiFood = null; aiT = 6; G.aiWarn = null;
  probes.forEach(pb => sea.remove(pb.obj)); probes.length = 0; era.probes.forEach(([x, z], k) => probes.push(makeProbe(x, z, k)));
  spawnCreatures(); buildVents();
  ocean.food.forEach(f => respawnFood(f));
  ocean.anoxClouds.forEach(c => c.visible = !!era.anox);
  (ocean.shells || []).forEach(s => sea.remove(s.m)); ocean.shells = [];
  ocean.beacon.visible = false; G.missionDone = false;
  camera.fov = 62; camera.updateProjectionMatrix(); camera.rotation.set(0, 0, 0);
  $('m-era').textContent = era.name; $('m-ago').textContent = era.jump + ' YEARS · ' + era.ago; $('o-home').classList.add('hidden');
}

/* ---------------- 바다 업데이트 ---------------- */
let sampleT = 0, seriesT = 0, hudT = 0, mapT = 0, logT = 0, beatT = 0;
function updateOcean(dt) {
  CAUS.uTime.value = G.t;
  if (G.playing) {
    eraT += dt / 60;
    updatePlayer(dt); eatCheck();
    for (const pb of probes) if (!pb.got && pb.pos.distanceTo(pl.pos) < 3 + pl.len) collectProbe(pb);
    sampleT -= dt; seriesT -= dt; predT -= dt;
    if (sampleT <= 0) { sampleT = 0.5; addRow(sampleRow(pl.pos.x, pl.pos.y, pl.pos.z, { pred: hostileNear(pl.pos) })); }
    if (seriesT <= 0) { seriesT = 3; seriesRow(); }
    if (predT <= 0) { predT = 2; predict(); }
    aiHints(dt);
    const done = pl.charge >= 100 && probes.every(p => p.got);
    if (done && !G.missionDone) { G.missionDone = true; ocean.beacon.visible = true; sfx('molt'); radio('에너지와 데이터가 모두 모였어요! 노란 빛기둥, 타임머신으로 돌아와 주세요!', 7000); $('o-home').classList.remove('hidden'); }
    if (G.missionDone && pl.pos.distanceTo(HOME) < 9) goAnalysis();
    if (era.anox && eraT > 4 && !G.warned) { G.warned = true; radio('경고! 무산소 해역이 얕은 곳까지 올라오고 있어요. 서둘러요!', 6000); }
    if (pl.hp < pl.hpMax * 0.3) { beatT -= dt; if (beatT <= 0) { beatT = 0.85; sfx('heartbeat', 0.8); } }
  }
  updateFlocks(dt);
  for (const c of creatures) c.update(G.playing ? dt : dt * 0.3);
  if (era.vents) updateVents(dt);
  const chasing = creatures.some(c => !c.dead && c.sp.move === 'hunter' && ['chase', 'windup', 'lunge', 'notice'].includes(c.state));
  sound.chase(chasing && G.playing); G.chasing = chasing;
  // 먹이 · 장식 애니메이션
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), Vt = V3();
  const gp = ocean.plankGlow.geometry.attributes.position;
  for (const f of ocean.food) {
    if (f.kind === 'plank') { Vt.copy(f.p); Vt.y += Math.sin(G.t * 1.5 + f.ph) * 0.25; const s = 0.85 + 0.25 * Math.sin(G.t * 3 + f.ph); M.compose(Vt, Q.identity(), S.set(s, s, s)); ocean.plank.setMatrixAt(f.i, M); gp.setXYZ(f.i, Vt.x, Vt.y, Vt.z); }
    else { Q.setFromEuler(new THREE.Euler(0, f.ry + Math.sin(G.t * 2 + f.ph) * 0.4, 0)); M.compose(f.p, Q, S.set(1, 1, 1)); ocean.worm.setMatrixAt(f.i, M); }
  }
  ocean.plank.instanceMatrix.needsUpdate = true; ocean.worm.instanceMatrix.needsUpdate = true; gp.needsUpdate = true;
  ocean.crList.forEach((c, i) => { Q.setFromEuler(new THREE.Euler(Math.sin(G.t * 0.8 + c.ph) * 0.12, c.ry, Math.cos(G.t * 0.6 + c.ph) * 0.1)); M.compose(Vt.set(c.x, c.y, c.z), Q, S.set(c.s, c.s, c.s)); ocean.crinoids.setMatrixAt(i, M); });
  ocean.crinoids.instanceMatrix.needsUpdate = true;
  probes.forEach(pb => { pb.ring.rotation.z += dt * 1.5; pb.ring.scale.setScalar(1 + 0.15 * Math.sin(G.t * 3 + pb.k)); });
  ocean.tmLight.intensity = (G.missionDone ? 60 : 22) * (0.6 + 0.4 * Math.sin(G.t * (G.missionDone ? 3 : 11))); ocean.tmLight.color.set(G.missionDone ? 0xffd66b : 0xff8a3d);
  ocean.beacon.material.opacity = 0.18 + 0.08 * Math.sin(G.t * 3);
  (ocean.shells || []).forEach(s => { s.t -= dt; s.m.position.y -= dt * 0.2; s.m.traverse(m => { if (m.isMesh) m.material.opacity = 0.55 * clamp(s.t / 4, 0, 1); }); if (s.t <= 0) sea.remove(s.m); });
  ocean.shells = (ocean.shells || []).filter(s => s.t > 0);
  // 거품
  const b = ocean.bub, bp = b.pts.geometry.attributes.position;
  for (let i = 0; i < b.life.length; i++) { if (b.life[i] <= 0) { bp.setY(i, -999); continue; } b.life[i] -= dt; b.v[i].multiplyScalar(1 - dt * 2); b.v[i].y += dt * 2; bp.setXYZ(i, bp.getX(i) + b.v[i].x * dt, bp.getY(i) + b.v[i].y * dt, bp.getZ(i) + b.v[i].z * dt); }
  bp.needsUpdate = true;
  // 빛줄기 · 바다눈 · 무산소 구름
  ocean.rays.forEach(r => { const u = r.userData, a = u.a + G.t * 0.02; r.position.set(camera.position.x + Math.cos(a) * u.r, -20, camera.position.z + Math.sin(a) * u.r); r.rotation.set(0, Math.atan2(camera.position.x - r.position.x, camera.position.z - r.position.z), 0.18); });
  const spn = ocean.snow.geometry.attributes.position, cp = camera.position;
  for (let i = 0; i < spn.count; i++) {
    let x = spn.getX(i), y = spn.getY(i) - dt * 0.25, z = spn.getZ(i);
    if (x - cp.x > 40) x -= 80; else if (cp.x - x > 40) x += 80; if (y - cp.y > 40) y -= 80; else if (cp.y - y > 40) y += 80; if (z - cp.z > 40) z -= 80; else if (cp.z - z > 40) z += 80;
    spn.setXYZ(i, x, Math.min(y, -0.5), z);
  }
  spn.needsUpdate = true;
  if (era.anox) {
    const lvl = Math.max(8, 70 - era.anox * eraT);
    ocean.anoxClouds.forEach(c => { const u = c.userData, fy = floorY(u.x, u.z); c.position.set(u.x + Math.sin(G.t * 0.1 + u.s) * 3, Math.max(fy + u.s * 0.25, -lvl + 4), u.z); c.scale.setScalar(u.s * (1 + eraT * 0.08)); c.visible = -lvl > fy; });
    const k = clamp(eraT / 8, 0, 1); sea.fog.color.set(era.fog).lerp(new THREE.Color(0x4a3a22), k * 0.6); sea.background.copy(sea.fog.color); sea.fog.density = era.fogD + k * 0.008;
  }
  updateCamera(dt);
  hudT -= dt; if (hudT <= 0) { hudT = 0.1; updateHUD(); }
  mapT -= dt; if (mapT <= 0) { mapT = 0.25; drawMinimap(); }
  logT -= dt; if (logT <= 0) { logT = 0.5; updateLog(); }
  updateMarkers(); updateLabels();
}
function updateCamera(dt) {
  const back = 3.2 + pl.len * 2.4, cf = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(cam.pitch), Math.sin(cam.pitch), Math.cos(cam.yaw) * Math.cos(cam.pitch));
  const want = V3().copy(pl.pos).addScaledVector(cf, -back).add(new THREE.Vector3(0, 0.8 + pl.len * 0.6, 0));
  want.y = Math.max(want.y, floorY(want.x, want.z) + 0.8); want.y = Math.min(want.y, -0.6);
  camera.position.lerp(want, 1 - Math.exp(-dt * 8));
  if (pl.shake > 0) { pl.shake -= dt; camera.position.x += (Math.random() - 0.5) * pl.shake * 0.7; camera.position.y += (Math.random() - 0.5) * pl.shake * 0.7; }
  camera.lookAt(V3().copy(pl.pos).addScaledVector(cf, 2 + pl.len).add(new THREE.Vector3(0, 0.4 + pl.len * 0.2, 0)));
}

/* =========================================================
   HUD
   ========================================================= */
const SENS = [
  ['depth', '수심', 'm', 1, () => 'ok'], ['temp', '수온', '℃', 1, v => v > 34 ? 'bad' : v > 31.5 ? 'warn' : 'ok'],
  ['o2', '용존 산소', 'mg/L', 2, v => v < 2.6 ? 'bad' : v < 3.6 ? 'warn' : 'ok'], ['co2', 'CO₂', 'ppm', 0, () => 'ok'],
  ['ph', 'pH', '', 2, v => v < 7.5 ? 'warn' : 'ok'], ['nut', '영양염류', 'μmol/L', 1, () => 'ok'],
];
$('srows').innerHTML = SENS.map(([k, n, u]) => `<div class="srow" id="sr-${k}"><span class="k">${n}</span><span class="v"><span>-</span><small>${u}</small></span></div>`).join('');
const TOTAL_SPECIES = () => Object.keys(era.roster).length;
function updateHUD() {
  const e = G.e; if (!e) return;
  for (const [k, , , d, f] of SENS) { const el = $('sr-' + k), v = e[k]; el.querySelector('.v span').textContent = k === 'co2' ? fmt(v) : v.toFixed(d); el.className = 'srow ' + f(v); }
  const mm = Math.floor(eraT), ss = Math.floor((eraT - mm) * 60); $('s-time').textContent = era.vents ? `관측 ${fmt(eraT * YEARS_PER_MIN)}년` : String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  const got = probes.filter(p => p.got).length, acc = accuracy();
  $('v-charge').textContent = Math.floor(pl.charge) + '%'; $('o-charge').querySelector('i').style.width = pl.charge + '%'; $('o-charge').classList.toggle('done', pl.charge >= 100);
  $('v-probe').textContent = got + ' / 5'; $('o-probe').querySelector('i').style.width = got * 20 + '%'; $('o-probe').classList.toggle('done', got === 5);
  $('v-rows').textContent = fmt(rows.length) + '행'; $('v-acc').textContent = acc + '%'; $('o-acc').querySelector('i').style.width = acc + '%';
  const seenHere = Object.keys(era.roster).filter(k => SEEN.has(k)).length; $('v-dex').textContent = `${seenHere} / ${TOTAL_SPECIES()}`;
  // 상단 상태 바
  $('hp-i').style.width = clamp(pl.hp / pl.hpMax * 100, 0, 100) + '%'; $('v-hp').textContent = `${Math.max(0, Math.ceil(pl.hp))} / ${pl.hpMax}`;
  $('status').classList.toggle('low', pl.hp < pl.hpMax * 0.3);
  const cur = STAGES[pl.level - 1], nxt = STAGES[pl.level];
  $('xp-i').style.width = (nxt ? clamp((pl.xp - cur.xp) / (nxt.xp - cur.xp) * 100, 0, 100) : 100) + '%';
  $('v-stage').textContent = `${pl.level}단계 · ${cur.name}`; $('st-i').style.width = pl.st + '%';
  const chips = [];
  if (G.chasing) chips.push('<span class="chip red">포식자가 노리고 있어요! 빨간 “!” 뒤 돌진을 옆으로 피하세요</span>');
  if (pl.rolled) chips.push('<span class="chip gold">몸 말기 방어 중 (피해 75% 감소)</span>');
  if (pl.hidden) chips.push('<span class="chip green">암초에 숨는 중 · 포식자가 잘 못 봐요</span>');
  if (G.aiWarn && G.t < G.aiWarn.until) chips.push(`<span class="chip ai">AI 예측: 앞쪽은 포식자 출현 위험 ${G.aiWarn.p}%</span>`);
  const nearVent = vents.find(v => v.state !== 'idle' || (ventPredicted(v) && v.timer < 5));
  if (nearVent && Math.sqrt(dist2(nearVent)) < 28) chips.push(ventPredicted(nearVent) ? `<span class="chip red">AI 분출 예측: ${Math.max(0, nearVent.timer).toFixed(1)}초 뒤 분출! 멀리 피하세요</span>` : '<span class="chip red">땅이 울려요… 분출 조짐!</span>');
  if (e.o2 < 2.6) chips.push('<span class="chip red">산소 부족! 얕은 곳으로</span>');
  if (e.temp > 34) chips.push('<span class="chip red">수온 위험!</span>');
  $('chips').innerHTML = chips.slice(0, 3).join('');
  const danger = G.chasing || pl.hp < pl.hpMax * 0.3;
  $('vignette').style.boxShadow = `inset 0 0 160px 40px rgba(255,30,50,${danger ? 0.35 + 0.15 * Math.sin(G.t * 8) : 0})`;
}
function updateLog() {
  if (IS_TOUCH) return;
  const last = rows.slice(-5).reverse();
  $('log').innerHTML = '<span class="h">t     수심   수온   O₂    영양  먹이 포식</span>\n' + last.map(r => { const m = Math.floor(r.t), s = Math.floor((r.t - m) * 60); return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${r.depth.toFixed(1).padStart(5)} ${r.temp.toFixed(1).padStart(5)} ${r.o2.toFixed(2).padStart(5)} ${r.nut.toFixed(1).padStart(5)} ${r.food.toFixed(1).padStart(4)} ${String(r.pred).padStart(3)}`; }).join('\n');
}
const MAPVARS = [['food', '먹이 예측', 0, 10], ['pred', '포식자 위험 예측', 0, 3], ['o2', '용존 산소 예측', 0, 8], ['temp', '수온 예측', 10, 36]];
let mapVar = 0;
function drawMinimap(force) {
  const cv = $('minimap'), g = cv.getContext('2d'), W = cv.width, s = W / (WORLD * 2), [k, name, lo, hi] = MAPVARS[mapVar], acc = accuracy();
  if (force) { $('map-var').textContent = name; $('leg-lo').textContent = lo; $('leg-hi').textContent = hi; }
  $('map-acc').textContent = acc < 20 ? '데이터 부족' : `정확도 ${acc}%`;
  g.fillStyle = '#04141d'; g.fillRect(0, 0, W, W);
  g.save(); g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); g.clip();
  const cs = GC * s, arr = gridPred[k];
  g.globalAlpha = clamp(0.25 + acc / 100, 0, 1);
  for (let c = 0; c < GN * GN; c++) { const v = arr[c]; if (isNaN(v)) continue; g.fillStyle = ramp((v - lo) / (hi - lo)); g.fillRect((c % GN) * cs, Math.floor(c / GN) * cs, cs + 0.5, cs + 0.5); }
  g.globalAlpha = 1;
  g.strokeStyle = 'rgba(255,255,255,0.18)'; for (const [x, z, r] of REEFS) { g.beginPath(); g.arc((x + WORLD) * s, (z + WORLD) * s, r * s, 0, 7); g.stroke(); }
  g.restore();
  for (const a of attacks) { g.fillStyle = '#ff2d45'; g.font = 'bold 18px sans-serif'; g.fillText('×', (a.x + WORLD) * s - 5, (a.z + WORLD) * s + 6); }
  for (const pb of probes) if (!pb.got) { g.fillStyle = '#5ff2ff'; g.beginPath(); g.arc((pb.pos.x + WORLD) * s, (pb.pos.z + WORLD) * s, 7 + 2 * Math.sin(G.t * 4), 0, 7); g.fill(); }
  for (const v of vents) { g.fillStyle = v.state === 'erupt' ? '#ff5a1a' : ventPredicted(v) && v.timer < 6 ? '#ffb547' : '#7a4a30'; g.beginPath(); g.moveTo((v.x + WORLD) * s, (v.z + WORLD) * s - 9); g.lineTo((v.x + WORLD) * s + 8, (v.z + WORLD) * s + 6); g.lineTo((v.x + WORLD) * s - 8, (v.z + WORLD) * s + 6); g.fill(); }
  if (aiFood) { g.strokeStyle = '#5dff8a'; g.lineWidth = 3; g.beginPath(); g.arc((aiFood.x + WORLD) * s, (aiFood.z + WORLD) * s, 11, 0, 7); g.stroke(); }
  g.fillStyle = G.missionDone ? '#ffd66b' : '#ff8a3d'; g.fillRect((HOME.x + WORLD) * s - 8, (HOME.z + WORLD) * s - 8, 16, 16);
  for (const c of creatures) if (!c.dead && c.hostile && c.pos.distanceTo(pl.pos) < 60) { g.fillStyle = '#ff4f5e'; g.beginPath(); g.arc((c.pos.x + WORLD) * s, (c.pos.z + WORLD) * s, 6, 0, 7); g.fill(); }
  g.save(); g.translate((pl.pos.x + WORLD) * s, (pl.pos.z + WORLD) * s); g.rotate(-pl.yaw + Math.PI);
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.restore();
}
function project(wp) { const v = wp.clone().project(camera); return { x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight, behind: v.z > 1, nx: v.x, ny: v.y }; }
function placeMarker(el, wp, show, label) {
  if (!show) { el.classList.add('hidden'); return; }
  const v = wp.clone().project(camera); let x = v.x, y = v.y; if (v.z > 1) { x = -x; y = -y; }
  if (v.z > 1 || Math.abs(x) > 0.72 || Math.abs(y) > 0.6) { const m = Math.max(Math.abs(x) / 0.72, Math.abs(y) / 0.6); x /= m; y /= m; }
  el.classList.remove('hidden'); el.style.left = ((x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - y) / 2 * innerHeight) + 'px';
  el.querySelector('span').textContent = label;
}
function updateMarkers() {
  const left = probes.filter(p => !p.got).sort((a, b) => a.pos.distanceTo(pl.pos) - b.pos.distanceTo(pl.pos));
  placeMarker($('mk-probe'), left[0]?.pos || pl.pos, G.playing && left.length > 0, `관측 부표 ${Math.round((left[0]?.pos || pl.pos).distanceTo(pl.pos))}m`);
  const home = new THREE.Vector3(HOME.x, HOME.y + 3, HOME.z);
  placeMarker($('mk-home'), home, G.playing && G.missionDone, `타임머신 ${Math.round(home.distanceTo(pl.pos))}m`);
  placeMarker($('mk-ai'), aiFood || pl.pos, G.playing && !!aiFood && aiFood.distanceTo(pl.pos) > 12 && !G.missionDone, `AI 추천 먹이 지역 ${aiFood ? Math.round(aiFood.distanceTo(pl.pos)) : 0}m`);
  // 화면 밖에서 덮치는 포식자 방향
  const threats = creatures.filter(c => !c.dead && ['chase', 'windup', 'lunge', 'notice'].includes(c.state));
  document.querySelectorAll('.threat').forEach((el, i) => {
    const c = threats[i]; if (!c || !G.playing) { el.classList.add('hidden'); return; }
    const p = project(c.pos); if (!p.behind && Math.abs(p.nx) < 0.9 && Math.abs(p.ny) < 0.85) { el.classList.add('hidden'); return; }
    let x = p.behind ? -p.nx : p.nx, y = p.behind ? -p.ny : p.ny; const m = Math.max(Math.abs(x) / 0.88, Math.abs(y) / 0.8); x /= m; y /= m;
    el.classList.remove('hidden'); el.style.left = ((x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - y) / 2 * innerHeight) + 'px';
    el.style.transform = `translate(-50%,-50%) rotate(${Math.atan2(-y, x)}rad)`;
  });
}
function updateLabels() {
  const near = creatures.filter(c => !c.dead && c.obj.visible && c.pos.distanceTo(pl.pos) < 13 + c.len).sort((a, b) => a.pos.distanceTo(pl.pos) - b.pos.distanceTo(pl.pos)).slice(0, 3);
  document.querySelectorAll('.clabel').forEach((el, i) => {
    const c = near[i]; if (!c || !G.playing) { el.classList.add('hidden'); return; }
    const p = project(V3().copy(c.pos).add(new THREE.Vector3(0, c.ud.height * 0.6 + 0.6, 0))); if (p.behind) { el.classList.add('hidden'); return; }
    const tag = c.edible ? ['eat', '먹을 수 있어요'] : c.hostile ? ['bad', '위험!'] : c.sp.sting ? ['bad', '독침 주의'] : ['meh', c.sp.move === 'hunter' ? '아직은 무섭지 않아요' : '아직 너무 커요'];
    el.className = 'clabel ' + tag[0]; el.innerHTML = `${c.sp.name}<small>${tag[1]}</small>`; el.style.left = p.x + 'px'; el.style.top = p.y + 'px';
  });
}

/* ---------------- 알림 ---------------- */
let toastTimer; const radioQ = []; let radioBusy = false;
function toast(msg, tone = '') {
  const t = $('toast'); t.textContent = msg; t.className = 'panel show ' + tone;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function radio(msg, ms = 6000) { radioQ.push([msg, ms]); if (!radioBusy) nextRadio(); }
function nextRadio() {
  const it = radioQ.shift(); if (!it) { radioBusy = false; $('radio').classList.remove('show'); return; }
  radioBusy = true; $('radio-text').textContent = it[0]; $('radio').classList.add('show'); sfx('click');
  setTimeout(nextRadio, Math.max(3500, it[1] - radioQ.length * 1500));
}
function floatText(txt, wp, color, big) {
  const p = project(wp); if (p.behind) return;
  const el = document.createElement('div'); el.className = 'fx' + (big ? ' big' : ''); el.textContent = txt; if (color) el.style.color = color;
  el.style.left = p.x + 'px'; el.style.top = p.y + 'px'; $('hud').appendChild(el);
  setTimeout(() => { el.style.transform = 'translateY(-54px)'; el.style.opacity = '0'; }, 20); setTimeout(() => el.remove(), 1000);
}
function flash(color = '#fff', ms = 500) {
  const f = $('flash'); f.style.transition = 'none'; f.style.background = color; f.style.opacity = 1; void f.offsetWidth;
  setTimeout(() => { f.style.transition = `opacity ${ms}ms`; f.style.opacity = 0; }, 30);
}
let slowUntil = 0; function slowmo(sec) { slowUntil = performance.now() + sec * 1000; }
async function banner(a, b, c, ms = 3200) { $('bn-a').textContent = a; $('bn-b').textContent = b; $('bn-c').textContent = c; $('banner').classList.add('show'); await sleep(ms); $('banner').classList.remove('show'); }

/* ---------------- 대화 ---------------- */
let dlgQ = [], dlgDone = null, typing = null;
function say(lines) { return new Promise(res => { dlgQ = lines.slice(); dlgDone = res; $('dialog').classList.remove('hidden'); $('hud').classList.add('dim'); nextLine(); }); }
function nextLine() {
  if (typing) { clearInterval(typing.id); $('dlg-text').textContent = typing.text; typing = null; return; }
  if (!dlgQ.length) { $('dialog').classList.add('hidden'); $('hud').classList.remove('dim'); const d = dlgDone; dlgDone = null; d && d(); return; }
  const l = dlgQ.shift(), d = $('dialog');
  d.className = 'panel ' + (l.who === '나' ? 'me' : l.who === '시스템' ? 'sys' : '');
  $('dlg-who').textContent = l.who === '나' ? `${G.name} 박사` : l.who;
  const text = l.text.replaceAll('{name}', G.name); let i = 0; $('dlg-text').textContent = '';
  typing = { text, id: setInterval(() => { i++; $('dlg-text').textContent = text.slice(0, i); if (i >= text.length) { clearInterval(typing.id); typing = null; } }, 22) };
  if (l.fx) l.fx();
}
$('dialog').addEventListener('click', nextLine);

/* =========================================================
   흐름
   ========================================================= */
const G = { mode: 'title', playing: false, t: 0, name: 'K', missionDone: false };
let active = lab.scene;
window.G = G; window.DBG = { lab, ocean, pl, camera, THREE, renderer, creatures, vents, setActive: s => { active = s; } };

function goAnalysis() {
  G.playing = false; G.mode = 'analysis'; sound.chase(false); sound.music('analysis', 1.5);
  $('hud').classList.add('dim');
  openAnalysis({
    era, eraIdx, rows, series, attacks, eraT, WORLD, REEFS, frags, gotFrag, accuracy: accuracy(), aiStats,
    droneRecords: Math.round(eraT * 60 * 10 * 32 * 12), sfx: n => sfx(n),
    onDone: async () => {
      $('hud').classList.remove('dim');
      if (eraIdx < 2) { await doWarp(ERAS[eraIdx + 1].jump, 'TEMPORAL JUMP · 생체 데이터 저장 완료', 0x5ff2ff); startEra(eraIdx + 1, true); }
      else { await doWarp('+252,000,000', 'RETURN · 귀환 좌표 ' + frags.join('.'), 0xffd66b); returnToLab(); }
    },
  });
}
async function doWarp(big, small, col) {
  G.mode = 'warp'; G.playing = false; active = warp.scene; warp.t = 0; warp.col.set(col);
  $('hud').classList.add('hidden'); $('warptxt').classList.remove('hidden'); $('wp-a').textContent = small; sfx('warp');
  const t0 = performance.now();
  while (performance.now() - t0 < warp.dur * 1000) { const k = (performance.now() - t0) / (warp.dur * 1000); $('wp-b').textContent = k > 0.75 ? big : big.replace(/\d/g, () => Math.floor(Math.random() * 10)); await sleep(50); }
  $('wp-b').textContent = big; flash('#fff', 900); await sleep(150);
  $('warptxt').classList.add('hidden'); camera.fov = 62; camera.updateProjectionMatrix(); camera.rotation.set(0, 0, 0);
}
async function startEra(i, keep) {
  setupEra(i, keep); G.mode = 'ocean'; active = sea; G.playing = false; G.warned = false;
  $('hud').classList.remove('hidden'); mapVar = 0; drawMinimap(true); sound.music(era.bgm, 2.5);
  for (let k = 0; k < 40; k++) updateCamera(0.05);
  G.e = env(pl.pos.x, pl.pos.y, pl.pos.z, era, 0); updateHUD();
  banner(era.jump + ' YEARS', era.name, keep ? `생체 데이터 복원 · ${pl.level}단계 ${STAGES[pl.level - 1].name}${UPGRADES[i] ? ' · 새 장비: ' + UPGRADES[i].name : ''}` : era.sub); await sleep(1800);
  const howto = IS_TOUCH ? `조작법
· 왼쪽 화면: 조이스틱으로 이동 (끝까지 밀고 있으면 자동 가속)
· 오른쪽 화면 끌기: 시점 돌리기 (보는 쪽으로 헤엄쳐요)
· 노란 버튼: 돌진   · 파란 버튼: 몸 말기 방어   · 지도 탭: 지도 종류 바꾸기`
    : `조작법
· WASD/방향키: 이동   · 마우스 끌기: 시점 돌리기 (보는 쪽으로 헤엄쳐요)
· 스페이스/Shift: 돌진   · E: 몸 말기 방어   · M: 지도 종류 바꾸기`;
  await say(era.intro.concat(i === 0 ? [{ who: '시스템', text: howto }] : []));
  G.playing = true;
}
async function labIntro() {
  G.mode = 'lab'; active = lab.scene; startLabCamera(false); lab.power = 0; lab.alarm = false; sound.music('lab', 2);
  const d = `${TODAY.getFullYear()}년 ${TODAY.getMonth() + 1}월 ${TODAY.getDate()}일`;
  await sleep(600);
  await say([
    { who: '시스템', text: `${d} · 크로노스 연구소 지하 3층\n타임머신 “크로노스-7” 첫 시험 가동` },
    { who: 'ARIA', text: '좋은 아침이에요, {name} 박사님. 오늘은 드디어 크로노스-7의 첫 시험 가동 날이에요.' },
    { who: '나', text: 'ARIA, 목표 좌표는?' },
    { who: 'ARIA', text: '딱 1시간 전, 바로 이 연구소예요. 박사님이 3년 동안 모은 시공간 빅데이터로 계산한 좌표죠.' },
    { who: '나', text: '좋아. 크로노스-7, 가동 시작!', fx: () => { lab.powerOn = true; } },
    { who: 'ARIA', text: '에너지 충전 87%… 93%… 시간 좌표 고정 중…' },
    { who: 'ARIA', text: '잠깐만요! 좌표 데이터에 이상한 값이 섞여 있어요! 검증되지 않은 데이터가… 경고! 경고!', fx: () => { lab.alarm = true; G.alarmId = setInterval(() => sfx('alarm'), 520); $('alarm').classList.add('on'); } },
    { who: '시스템', text: 'TEMPORAL COORDINATE ERROR\n▶ TARGET: −510,000,000 YEARS' },
    { who: '나', text: '뭐라고?! 5억 년 전이라고?! ARIA, 멈춰—!' },
  ]);
  clearInterval(G.alarmId); $('alarm').classList.remove('on'); flash('#fff', 1200); await sleep(200);
  await doWarp(ERAS[0].jump, 'TEMPORAL COORDINATE ERROR', 0xff6b8a); startEra(0);
}
async function returnToLab() {
  G.mode = 'lab'; active = lab.scene; lab.alarm = false; lab.power = 1; startLabCamera(true); sound.music('ending', 2);
  $('hud').classList.add('hidden'); await sleep(800);
  await say([
    { who: '시스템', text: `귀환 좌표 ${frags.join('.')} · 크로노스 연구소` },
    { who: 'ARIA', text: '귀환 성공! 박사님, 원래 몸으로 돌아오셨어요!' },
    { who: '나', text: '삼엽충으로 살아 본 건 평생 못 잊을 거야… 그리고 이 데이터들도.' },
    { who: 'ARIA', text: `우리가 모은 데이터는 모두 ${fmt(stats.rows)}행이에요. 데이터가 쌓일수록 제 예측이 정확해졌던 것 기억하시죠? 이게 바로 빅데이터의 힘이에요.` },
    { who: 'ARIA', text: '페름기 말 데이터는 지금 우리에게도 경고예요. CO₂가 급증하자 바다가 뜨거워지고 산소가 사라졌죠. 오늘날 기후 변화 예측에도 이런 데이터가 쓰여요.' },
    { who: 'ARIA', text: '그런데 박사님… 방금 타임머신이 이상한 신호를 받았어요. 미래에서 온 구조 요청이에요.', fx: () => { lab.alarm = true; } },
    { who: '시스템', text: 'INCOMING SIGNAL ▶ FUTURE\n“…도와주세요… 바이러스가… 유전체 데이터가…”' },
    { who: '나', text: '다음 목적지가 정해진 것 같군.' },
  ]);
  lab.alarm = false; showEnding();
}
function showEnding() {
  const mins = Math.round((performance.now() - stats.start) / 60000);
  $('end-stats').innerHTML = [[fmt(stats.rows), '수집한 데이터(행)'], [stats.eaten, '먹은 생물·먹이'], [SEEN.size, '발견한 생물 종'], [stats.deaths, '긴급 소환 횟수'], [mins + '분', '탐사 시간']].map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
  $('ending').classList.remove('hidden');
}

/* ---------------- 모델 방향 확인용 (?view=zoo) ---------------- */
function zoo() {
  const s = new THREE.Scene(); s.background = new THREE.Color(0x3a4650); s.environment = envTex;
  s.add(new THREE.HemisphereLight(0xffffff, 0x445566, 2)); const d = new THREE.DirectionalLight(0xffffff, 2); d.position.set(5, 10, 3); s.add(d);
  active = s; G.mode = 'zoo';
  const keysList = [...new Set(Object.values(SPECIES).map(sp => sp.model))];
  window.ZOO = keysList;
  keysList.forEach((k, i) => {
    const m = makeModel(k, 3); m.position.set((i % 6) * 5 - 12.5, 0, Math.floor(i / 6) * 6 - 6); s.add(m);
    s.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), m.position.clone().add(new THREE.Vector3(0, 2, -1.5)), 3, 0xff3355, 0.8, 0.5));
  });
  camera.up.set(0, 0, -1); camera.position.set(0, 26, 0.01); camera.lookAt(0, 0, 0);
}

/* ---------------- 루프 ---------------- */
let last = performance.now();
function loop(now) { requestAnimationFrame(loop); const raw = (now - last) / 1000; last = now; adaptResolution(raw); frame(Math.min(0.05, raw) * (performance.now() < slowUntil ? 0.35 : 1)); }
window.DBG.step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) frame(dt); };
function frame(dt) {
  G.t += dt; _dt = dt;
  $('touchui').classList.toggle('hidden', !(IS_TOUCH && G.mode === 'ocean' && G.playing));
  if (G.mode === 'lab' || G.mode === 'title') { if (lab.powerOn) lab.power = Math.min(1, lab.power + dt * 0.5); updateLab(dt); }
  else if (G.mode === 'warp') updateWarp(dt);
  else if (G.mode === 'ocean' || G.mode === 'analysis') updateOcean(dt);
  else if (G.mode === 'zoo') { creatures.forEach(c => c.ud?.mixer?.update(dt)); }
  renderer.render(active, camera);
}

/* ---------------- 시작 ---------------- */
$('end-restart').onclick = () => location.reload();
(async () => {
  try { await loadAssets(); }
  catch (e) { $('loadtxt').textContent = '모델을 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침해 주세요.'; console.error(e); return; }
  sound.probe();
  buildLab(); buildOcean(); startLabCamera(false);
  renderer.compile(sea, camera); renderer.compile(lab.scene, camera);
  $('loading').classList.add('hidden'); $('startbox').classList.remove('hidden');
  $('screen').style.background = 'radial-gradient(ellipse at 50% 30%,rgba(2,7,11,.35),rgba(2,7,11,.92) 70%)';
  requestAnimationFrame(loop);
  if (P.get('view') === 'zoo') { $('screen').classList.add('hidden'); zoo(); return; }
  const go = async () => {
    G.name = $('pname').value.trim() || 'K'; $('screen').classList.add('hidden'); stats.start = performance.now();
    sound.unlock();
    if (IS_TOUCH) { const de = document.documentElement; try { (de.requestFullscreen || de.webkitRequestFullscreen)?.call(de)?.catch?.(() => { }); } catch (_) { } try { screen.orientation?.lock?.('landscape').catch(() => { }); } catch (_) { } }
    const wake = async () => { try { await navigator.wakeLock?.request('screen'); } catch (_) { } };
    wake(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
    const e = +P.get('era');
    if (e >= 1 && e <= 3) { pl.level = [1, 3, 5][e - 1]; pl.xp = STAGES[pl.level - 1].xp; pl.len = STAGES[pl.level - 1].len; await doWarp(ERAS[e - 1].jump, 'TEACHER MODE', 0x5ff2ff); startEra(e - 1, e > 1); }
    else if (P.has('skip')) { await doWarp(ERAS[0].jump, 'TEMPORAL COORDINATE ERROR', 0xff6b8a); startEra(0); }
    else labIntro();
  };
  $('startbtn').onclick = go; $('pname').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
})();
