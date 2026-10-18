import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/* =========================================================
   크로노스 프로토콜 · 1차시 고생대의 바다
   교사용 URL 옵션: ?era=1|2|3 (해당 시대부터), ?skip (연구소 인트로 건너뛰기)
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

function hash(x, z) { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); }
function noise2(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  return lerp(lerp(hash(xi, zi), hash(xi + 1, zi), u), lerp(hash(xi, zi + 1), hash(xi + 1, zi + 1), u), v);
}
function fbm(x, z) { let s = 0, a = 1, f = 1, n = 0; for (let i = 0; i < 4; i++) { s += a * noise2(x * f, z * f); n += a; a *= 0.5; f *= 2.03; } return s / n; }

/* ---------------- 바다 지형 · 환경 모델 ---------------- */
const WORLD = 150;
const NPLANK = 320, NWORM = 100;
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

// E: 시대 설정, t: 시대 경과 시간(분)
function env(x, y, z, E, t) {
  const depth = Math.max(0, -y);
  const [ux, uz, ur] = E.up;
  const up = Math.exp(-((x - ux) ** 2 + (z - uz) ** 2) / (2 * ur * ur));
  const temp = E.T0 + E.dT * t - depth * 0.13 - up * 3.2 + (noise2(x * 0.03 + 50, z * 0.03) - 0.5) * 1.6;
  const nut = Math.max(0, 1.5 + depth * 0.06 + up * 15 + (noise2(x * 0.05, z * 0.05 + 9) - 0.5) * 2.4);
  let o2 = E.O0 - E.dO * t - depth * 0.05 - Math.max(0, temp - 18) * 0.11 + (noise2(x * 0.04 + 3, z * 0.04) - 0.5) * 0.7;
  o2 -= smooth(42, 64, depth) * 2.6;
  if (E.anox) { const lvl = Math.max(8, 70 - E.anox * t); o2 -= smooth(lvl - 12, lvl + 4, depth) * 4.5; }
  const rd = reefDist(x, z);
  o2 += Math.max(0, 1 - rd / 20) * 0.5;
  const co2 = E.C0 + E.dC * t + (noise2(x * 0.02 + 70, z * 0.02) - 0.5) * 120;
  const ph = 8.25 - 0.18 * Math.log2(co2 / 280);
  const light = Math.exp(-depth / 35);
  const food = clamp((nut / 17) * (0.55 + 0.45 * light) * 10 * (temp > 34 ? 0.5 : 1), 0, 10);
  return { depth, temp, o2: Math.max(0, o2), co2, ph, nut, food, reef: Math.max(0, rd) };
}

/* ---------------- 시대(스테이지) 데이터 ---------------- */
const ERAS = [
  {
    key: 'cambrian', name: '캄브리아기', ago: '약 5억 1천만 년 전', jump: '−510,000,000', sub: '생물 대폭발의 얕은 열대 바다',
    fog: 0x1f8a9c, fogD: 0.0175, sun: 0xd8fbff, hemiSky: 0x7fe3ee, hemiGround: 0x3a3020, floorTint: [1.0, 0.94, 0.8], surface: 0x8ff0ff,
    T0: 29, dT: 0, O0: 7.0, dO: 0, C0: 4500, dC: 0, anox: 0, up: [70, -55, 28],
    predator: 'anomalocaris', predName: '아노말로카리스', predCount: 3, predLen: 6, predSpeed: 7.2, predDetect: 20,
    predPref: (x, z, e) => 0.25 + e.food / 10,
    probes: [[-110, 62], [70, -55], [112, -18], [-58, 46], [24, -104]],
    outlierProbe: 3,
    land: ['대기 산소 약 13%로 지금(21%)보다 훨씬 낮아요.', '대기 CO₂ 약 4,500ppm! 지금(약 420ppm)의 10배가 넘어서 아주 따뜻해요.', '육지는 바위와 모래뿐… 식물도 동물도 없어요. 오존층이 약해 자외선이 너무 강하거든요.', '어? 이 부표는 센서가 고장 났나 봐요. 수온 99℃ 같은 말도 안 되는 값이 섞였어요. 분석할 때 조심!', '영양염류가 많은 곳에 플랑크톤이 몰려 있어요. 깊은 바닷물이 올라오는 “용승” 해역 같아요.'],
    intro: [
      { who: '시스템', text: '고생대 캄브리아기 · 약 5억 1천만 년 전\n얕은 열대 바다' },
      { who: 'ARIA', text: '박사님, 들리세요? 착륙… 아니, 추락했어요. 그런데 놀라지 마세요.' },
      { who: 'ARIA', text: '타임머신의 “생체 적응 모듈”이 박사님을 이 시대에서 살아남을 수 있는 생물로 바꿨어요.\n지금 박사님은… 삼엽충이에요.' },
      { who: '나', text: '…삼엽충? 교과서 화석 사진에서만 보던 그 삼엽충?!' },
      { who: 'ARIA', text: '네! 고생대 바다의 주인공이죠. 문제는 타임머신 에너지가 0%라는 거예요. 돌아가려면 두 가지가 필요해요.' },
      { who: 'ARIA', text: '① 생체 에너지 — 먹이를 먹으면 타임머신이 충전돼요.\n② 귀환 좌표를 계산할 빅데이터 — 추락하며 흩어진 관측 부표 5개를 찾아 주세요.' },
      { who: 'ARIA', text: '박사님 몸의 센서는 0.5초마다 수심·수온·산소·영양염류를 자동으로 기록해요. 저는 기상 관측 드론으로 육지의 대기를 관측할게요.' },
      { who: 'ARIA', text: '조심하세요! 이 바다에는 캄브리아기 최강 포식자 아노말로카리스가 살아요. 위험하면 몸을 말아(E) 방어하세요!' },
    ],
    questions: [{
      q: '데이터를 분석해 보면, 먹이(플랑크톤)가 가장 풍부한 곳의 조건은?',
      opts: ['수온이 가장 높은 얕은 곳', '영양염류가 풍부한 곳 (용승 해역)', '가장 깊은 곳', '조건과 상관없이 고르게 퍼져 있다'], a: 1,
      ok: '정답! 깊은 곳의 영양염류가 위로 올라오는 용승 해역에서 플랑크톤이 번성해요. 현대에 엘니뇨가 오면 동태평양의 용승이 약해져 영양염류가 줄고, 페루 연안 어획량이 감소하는 것도 같은 원리예요.',
      no: 'X축을 “영양염류”, Y축을 “먹이 밀도”로 놓고 상관계수 r을 확인해 보세요. 고장 난 부표의 이상값도 걸러 보고요!',
    }],
    axes: ['nut', 'food'],
  },
  {
    key: 'devonian', name: '데본기', ago: '약 3억 7천만 년 전', jump: '−370,000,000', sub: '“어류의 시대”, 갑옷 물고기의 바다',
    fog: 0x16607e, fogD: 0.019, sun: 0xcff2ff, hemiSky: 0x6fc4e0, hemiGround: 0x22281c, floorTint: [0.86, 0.9, 0.82], surface: 0x7fd8f0,
    T0: 27, dT: 0, O0: 8.0, dO: 0, C0: 2000, dC: 0, anox: 0, up: [-30, -92, 26],
    predator: 'dunkleosteus', predName: '둔클레오스테우스', predCount: 4, predLen: 11, predSpeed: 8.4, predDetect: 24,
    predPref: (x, z) => 0.05 + smooth(2, 40, reefDist(x, z)),
    probes: [[-30, -92], [104, 30], [-104, 70], [10, 44], [60, 110]],
    outlierProbe: -1,
    land: ['대기 산소가 약 17%로 늘었어요. 육상 식물이 광합성으로 산소를 내뿜고 있어요.', '육지에 숲이 생기기 시작했어요! 오존층이 자외선을 막아 준 덕분이에요.', '대기 CO₂는 약 2,000ppm으로 줄었어요. 식물이 이산화탄소를 흡수하고 있거든요.', '물가에서 네 발 달린 물고기 같은 동물이 보여요! 척추동물이 육지로 올라오기 시작했어요.', '포식자 목격 기록을 보면 암초 근처에서는 거의 안 보여요. 숨기 좋은 곳이라서일까요?'],
    intro: [
      { who: '시스템', text: '고생대 데본기 · 약 3억 7천만 년 전\n“어류의 시대”' },
      { who: 'ARIA', text: '귀환 실패… 좌표가 아직 불완전해서 1억 4천만 년 뒤로만 점프했어요.' },
      { who: 'ARIA', text: '저 갑옷 같은 머리뼈를 가진 거대한 물고기 보이세요? 판피어류 둔클레오스테우스예요. 무는 힘이 어마어마해요!' },
      { who: 'ARIA', text: '이번엔 포식자 데이터가 중요해요. 박사님 센서가 주변 포식자 수도 함께 기록하고 있어요. 어디가 안전한지 데이터로 찾아봐요.' },
    ],
    questions: [{
      q: '포식자 목격 데이터로 볼 때, 삼엽충에게 가장 안전한 곳은?',
      opts: ['탁 트인 먼바다', '암초·산호 지대 근처', '수면 바로 아래', '어디나 위험도가 같다'], a: 1,
      ok: '정답! “암초까지 거리”가 멀수록 “포식자 수”가 늘어나는 양의 상관관계가 보여요. 데이터가 생존 전략을 알려 준 거죠.',
      no: 'X축을 “암초까지 거리”, Y축을 “포식자 수”로 바꿔 보세요.',
    }, {
      q: '드론의 대기 관측 데이터로 볼 때, 데본기에 생물이 육지로 진출할 수 있었던 가장 중요한 까닭은?',
      opts: ['대기 중 CO₂가 늘어나서', '오존층이 형성되어 자외선을 막아 줘서', '바다 수온이 내려가서', '초대륙 판게아가 만들어져서'], a: 1,
      ok: '정답! 광합성으로 산소가 늘고, 성층권에 오존층이 만들어지면서 해로운 자외선이 줄어 생물이 육지에서도 살 수 있게 되었어요.',
      no: '오른쪽 위 “드론 기상 관측” 표에서 캄브리아기와 데본기의 오존층 칸을 비교해 보세요.',
    }],
    axes: ['reef', 'pred'],
  },
  {
    key: 'permian', name: '페름기 말', ago: '약 2억 5천 2백만 년 전', jump: '−252,000,000', sub: '초대륙 판게아, 대멸종 직전의 바다',
    fog: 0x3d5a3f, fogD: 0.022, sun: 0xffe2b8, hemiSky: 0x9ab58a, hemiGround: 0x2a1f14, floorTint: [0.9, 0.78, 0.66], surface: 0xc8d9a0,
    T0: 29, dT: 1.2, O0: 6.6, dO: 0.3, C0: 900, dC: 350, anox: 6, up: [40, 70, 24],
    predator: 'helicoprion', predName: '헬리코프리온', predCount: 3, predLen: 10, predSpeed: 8.8, predDetect: 22,
    predPref: (x, z) => 0.5 + smooth(-55, -15, floorY(x, z)),
    probes: [[40, 70], [-112, -40], [96, -70], [-20, -52], [-70, 110]],
    outlierProbe: -1,
    land: ['대기 CO₂가 빠르게 치솟고 있어요. 시베리아의 거대한 화산 분출(시베리아 트랩) 때문이에요.', '평균 기온이 급격히 오르고 있어요. 적도 바다 수온이 40℃ 가까이 올랐다는 연구도 있어요.', '바다가 산성화되고 있어요. CO₂가 바닷물에 녹으면 pH가 낮아져 껍데기를 만드는 생물이 힘들어져요.', '깊은 바다부터 산소가 없는 “무산소 해역”이 위로 퍼지고 있어요!', '대륙이 하나로 합쳐지면서 얕은 대륙붕 바다가 크게 줄었어요. 살 곳 자체가 줄어든 거예요.'],
    intro: [
      { who: '시스템', text: '고생대 페름기 말 · 약 2억 5천 2백만 년 전\n초대륙 판게아' },
      { who: 'ARIA', text: '또 점프했어요… 그런데 이번엔 뭔가 이상해요. 바다가 탁하고, 수온이 계속 오르고 있어요.' },
      { who: 'ARIA', text: '드론 관측 결과, 대륙이 하나로 합쳐진 초대륙 판게아예요. 시베리아에서 거대한 화산 분출이 이어지고 있어요.' },
      { who: 'ARIA', text: 'CO₂ 급증 → 지구 온난화 → 바닷속 산소 감소. 지구 역사상 최대의 대멸종이 시작되고 있어요. 해양 생물 종의 90% 가까이가 사라지고, 삼엽충도 이때 완전히 멸종해요.' },
      { who: 'ARIA', text: '바다가 생명이 살 수 없게 되기 전에 탈출해야 해요! 시간에 따라 데이터가 어떻게 바뀌는지 잘 기록해 주세요.' },
    ],
    questions: [null, {
      q: '이번 대멸종의 원인 흐름을 데이터가 가장 잘 뒷받침하는 것은?',
      opts: ['거대 운석 충돌 → 급격한 한랭화', '대규모 화산 활동 → CO₂ 급증 → 온난화·해양 무산소', '빙하기 도래 → 해수면 하강', '포식자 증가 → 먹이 사슬 붕괴'], a: 1,
      ok: '정답! 시간이 지날수록 CO₂와 수온은 오르고 용존 산소와 pH는 내려갔어요. 오늘날 기후 변화 예측에도 이런 지질 시대 데이터가 활용돼요.',
      no: '데이터셋을 “해역 평균(시계열)”로 두고 Y축을 CO₂, 수온, 용존 산소로 하나씩 바꿔 보세요.',
    }],
    axes: ['t', 'avgO2'],
  },
];

const VARS = {
  t: ['경과 시간', '분'], depth: ['수심', 'm'], temp: ['수온', '℃'], o2: ['용존 산소', 'mg/L'], co2: ['CO₂', 'ppm'], ph: ['pH', ''],
  nut: ['영양염류', 'μmol/L'], food: ['먹이 밀도', '점'], pred: ['포식자 수', '마리'], reef: ['암초까지 거리', 'm'],
  avgT: ['해역 평균 수온', '℃'], avgO2: ['해역 평균 용존 산소', 'mg/L'],
};
const OBS_VARS = ['depth', 'temp', 'o2', 'co2', 'ph', 'nut', 'food', 'pred', 'reef', 't'];
const SER_VARS = ['t', 'avgT', 'avgO2', 'co2'];
const LAND = {
  cols: ['캄브리아기', '데본기', '페름기 말', '현재'],
  rows: [['대기 산소', '약 13%', '약 17%', '약 18% ↓', '21%'], ['대기 CO₂', '약 4,500ppm', '약 2,000ppm', '급증 ↑', '약 420ppm'], ['평균 기온', '약 22℃', '약 20℃', '30℃ 이상 ↑', '약 15℃'], ['오존층', '약함', '형성됨', '약화 징후', '있음'], ['육상 생물', '없음', '숲·초기 네발동물', '겉씨식물·파충류', '매우 다양']],
};

/* ---------------- 렌더러 ---------------- */
// 패드(디벗) 감지: ?touch 로 강제, ?mouse 로 끄기
const IS_TOUCH = !P.has('mouse') && (P.has('touch') || (navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches));
if (IS_TOUCH) document.body.classList.add('touch');
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
// 해상도 자동 조절: 프레임이 떨어지면 낮추고, 여유가 있으면 올림
const PR_MAX = Math.min(devicePixelRatio, IS_TOUCH ? 1.25 : 1.6), PR_MIN = 0.6;
let pixRatio = PR_MAX, perfT = 0, perfN = 0;
renderer.setPixelRatio(pixRatio);
function adaptResolution(rawDt) {
  if (rawDt > 0.25) return; // 탭 전환 등은 무시
  perfT += rawDt; perfN++;
  if (perfT < 2) return;
  const fps = perfN / perfT; perfT = 0; perfN = 0;
  const next = fps < 40 ? Math.max(PR_MIN, pixRatio - 0.15) : fps > 57 ? Math.min(PR_MAX, pixRatio + 0.1) : pixRatio;
  if (next !== pixRatio) { pixRatio = next; renderer.setPixelRatio(pixRatio); if (!$('analysis').classList.contains('hidden')) drawPlot(); }
}
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 700);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
const pmrem = new THREE.PMREMGenerator(renderer);
const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

/* ---------------- 사운드 (간단 합성) ---------------- */
let actx;
function tone(f = 440, d = 0.15, type = 'sine', vol = 0.12, slide = 0, delay = 0) {
  try {
    actx = actx || new AudioContext();
    const t0 = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, f + slide), t0 + d);
    g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0008, t0 + d);
    o.connect(g).connect(actx.destination); o.start(t0); o.stop(t0 + d + 0.02);
  } catch (e) { /* 소리 없이 진행 */ }
}
const SFX = {
  eat: () => tone(520 + Math.random() * 200, 0.09, 'triangle', 0.07, 380),
  probe: () => { tone(660, 0.18, 'sine', 0.1); tone(990, 0.25, 'sine', 0.08, 0, 0.1); tone(1320, 0.35, 'sine', 0.06, 0, 0.2); },
  hit: () => { tone(140, 0.35, 'sawtooth', 0.18, -80); tone(90, 0.4, 'square', 0.08, -40); },
  bounce: () => tone(300, 0.15, 'square', 0.08, 400),
  level: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', 0.08, 0, i * 0.08)); },
  alarm: () => { tone(880, 0.22, 'square', 0.07); tone(660, 0.22, 'square', 0.07, 0, 0.25); },
  warp: () => { tone(120, 2.6, 'sawtooth', 0.06, 1400); tone(60, 2.6, 'sine', 0.12, 300); },
  ok: () => { tone(784, 0.15, 'triangle', 0.09); tone(1175, 0.3, 'triangle', 0.08, 0, 0.12); },
  no: () => tone(220, 0.25, 'square', 0.06, -60),
  blip: () => tone(1200, 0.04, 'square', 0.025),
};

/* ---------------- 에셋 로딩 ---------------- */
const MODELS = {
  trilobite: { file: 'trilobite.glb', yaw: 0 },
  anomalocaris: { file: 'anomalocaris.glb', yaw: -Math.PI / 2 },
  dunkleosteus: { file: 'dunkleosteus.glb', yaw: 0 },
  helicoprion: { file: 'helicoprion.glb', yaw: 0 },
  rock: { file: 'rock.glb' }, coral: { file: 'coral.glb' }, timemachine: { file: 'timemachine.glb' }, lab: { file: 'lab.glb' },
};
const assets = {};
const texLoader = new THREE.TextureLoader();
async function loadAssets() {
  const loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder);
  const keys = Object.keys(MODELS), prog = {};
  const upd = () => {
    let l = 0, t = 0; for (const k of keys) { l += prog[k]?.l || 0; t += prog[k]?.t || 1; }
    $('loadbar').firstElementChild.style.width = (100 * l / t).toFixed(1) + '%';
  };
  await Promise.all(keys.map(k => new Promise((res, rej) => {
    loader.load('assets/' + MODELS[k].file, g => { assets[k] = g.scene; prog[k] = { l: 1, t: 1 }; upd(); res(); },
      e => { prog[k] = { l: e.loaded, t: e.total || e.loaded * 2 || 1 }; upd(); }, rej);
  })));
  const tex = n => { const t = texLoader.load('assets/' + n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; return t; };
  assets.sand = { map: tex('sand_diff.jpg'), normal: tex('sand_nor_gl.jpg'), rough: tex('sand_rough.jpg') };
  assets.sand.map.colorSpace = THREE.SRGBColorSpace;
}

// 모델을 감싸서 +Z가 앞쪽, 중심이 원점, 가로 길이가 len이 되도록 맞춤
function makeModel(key, len) {
  const inner = assets[key].clone(true);
  inner.rotation.y = MODELS[key].yaw || 0;
  const wrap = new THREE.Group(); wrap.add(inner); wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  inner.position.sub(c);
  wrap.scale.setScalar(len / Math.max(size.x, size.z));
  const pivot = new THREE.Group(); pivot.add(wrap); pivot.userData.wrap = wrap;
  pivot.userData.height = size.y * len / Math.max(size.x, size.z);
  return pivot;
}
function firstMesh(root) { let m; root.traverse(o => { if (!m && o.isMesh) m = o; }); return m; }
function bakedGeometry(key, len) {
  const piv = makeModel(key, len); piv.updateMatrixWorld(true);
  const m = firstMesh(piv), g = m.geometry.clone();
  // meshopt 양자화(int16) 속성을 float로 풀어야 변환 시 값이 ±1로 잘리지 않음
  for (const k of Object.keys(g.attributes)) {
    const a = g.attributes[k];
    if (a.isInterleavedBufferAttribute || !(a.array instanceof Float32Array)) {
      const f = new Float32Array(a.count * a.itemSize), get = [a.getX, a.getY, a.getZ, a.getW];
      for (let i = 0; i < a.count; i++) for (let c = 0; c < a.itemSize; c++) f[i * a.itemSize + c] = get[c].call(a, i);
      g.setAttribute(k, new THREE.BufferAttribute(f, a.itemSize));
    }
  }
  g.applyMatrix4(m.matrixWorld);
  g.computeBoundingBox(); const b = g.boundingBox; g.translate(0, -b.min.y, 0);
  return { geo: g, mat: m.material };
}

/* ---------------- 수중 카우스틱(빛 일렁임) 셰이더 패치 ---------------- */
const CAUS = { uTime: { value: 0 }, uCaus: { value: 1 } };
function patchCaustics(mat, strength = 1) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uTime = CAUS.uTime; sh.uniforms.uCaus = CAUS.uCaus; sh.uniforms.uStr = { value: strength };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 cwp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          cwp = instanceMatrix * cwp;
        #endif
        vWPos = (modelMatrix * cwp).xyz;`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPos; uniform float uTime; uniform float uCaus; uniform float uStr;
      float caustic(vec2 uv){
        vec2 p = uv * 6.28318 - 250.0; vec2 i = p; float c = 1.0; float inten = .005;
        for (int n = 0; n < 4; n++) {
          float t = uTime * 0.45 * (1.0 - (3.5 / float(n + 1)));
          i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
          c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
        }
        c /= 4.0; c = 1.17 - pow(c, 1.4); return pow(abs(c), 8.0);
      }`)
      .replace('#include <fog_fragment>', `
        float cz = caustic(vWPos.xz * 0.045) * uCaus * uStr * exp(vWPos.y * 0.03);
        gl_FragColor.rgb += vec3(0.55, 0.9, 1.0) * cz * 1.1;
        #include <fog_fragment>`);
  };
  mat.needsUpdate = true;
}

/* =========================================================
   장면 1 · 연구소
   ========================================================= */
const lab = { scene: new THREE.Scene(), t: 0, power: 0, alarm: false, shake: 0, camFrom: new THREE.Vector3(), camTo: new THREE.Vector3(), look: new THREE.Vector3() };
function buildLab() {
  const s = lab.scene;
  s.environment = envTex; s.environmentIntensity = 0.55; s.background = new THREE.Color(0x03070a);
  s.fog = new THREE.Fog(0x03070a, 18, 40);
  const room = assets.lab.clone(true);
  const b = new THREE.Box3().setFromObject(room), c = b.getCenter(new THREE.Vector3());
  room.position.set(-c.x, -b.min.y, -c.z); s.add(room);
  // 타임머신
  const tm = makeModel('timemachine', 6.2);
  const metal = new THREE.MeshStandardMaterial({ color: 0x8d97a3, metalness: 0.92, roughness: 0.32, envMapIntensity: 1.2 });
  tm.traverse(o => { if (o.isMesh) o.material = metal; });
  tm.position.set(3.0, tm.userData.height / 2, 1.6); tm.rotation.y = 0.5;
  s.add(tm); lab.tm = tm;
  // 시간 포털(빛나는 고리)
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
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.1, 64), vortexMat);
  ring.add(torus, torus2, disc); lab.ring = ring; lab.vortex = vortexMat; lab.torus = [torus, torus2];
  ring.position.set(-1.02, 0.5, 0.08); ring.rotation.y = Math.PI / 2; ring.scale.setScalar(0.66); // 타임머신 고리 입구(로컬 좌표)
  tm.add(ring);
  // 조명
  s.add(new THREE.AmbientLight(0x9fdcff, 0.35));
  const key = new THREE.SpotLight(0xbff4ff, 60, 30, 0.7, 0.6); key.position.set(1, 5.2, 4); key.target = tm; s.add(key, key.target);
  lab.tmLight = new THREE.PointLight(0x5ff2ff, 0, 14); lab.tmLight.position.set(1.6, 2.2, 2.6); s.add(lab.tmLight);
  lab.red = new THREE.PointLight(0xff2030, 0, 30); lab.red.position.set(0, 4.5, 0); s.add(lab.red);
  for (const [x, z] of [[-6, -2], [0, -3], [6, 2]]) { const l = new THREE.PointLight(0x7fdfff, 6, 12); l.position.set(x, 4.6, z); s.add(l); }
  // 스파크 파티클
  const sg = new THREE.BufferGeometry(); const sp = new Float32Array(300 * 3); sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  lab.sparkV = Array.from({ length: 300 }, () => new THREE.Vector3());
  lab.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffd28a, size: 0.06, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.add(lab.sparks);
}
function updateLab(dt) {
  lab.t += dt;
  const pw = lab.power;
  lab.vortex.uniforms.uTime.value = lab.t; lab.vortex.uniforms.uPow.value = pw;
  lab.vortex.uniforms.uCol.value.set(lab.alarm ? 0xff5070 : 0x5ff2ff);
  lab.torus[0].rotation.z += dt * (0.4 + pw * 6); lab.torus[1].rotation.z -= dt * (0.3 + pw * 4);
  lab.torus.forEach(t => t.material.color.set(lab.alarm && Math.sin(lab.t * 18) > 0 ? 0xff4060 : 0x5ff2ff));
  lab.tmLight.intensity = pw * 40 * (1 + 0.2 * Math.sin(lab.t * 9));
  lab.red.intensity = lab.alarm ? 120 * (0.5 + 0.5 * Math.sin(lab.t * 9)) : 0;
  // 카메라: 천천히 다가가기
  const k = smooth(0, 1, Math.min(1, lab.t / 26));
  camera.position.lerpVectors(lab.camFrom, lab.camTo, k);
  if (lab.alarm) { lab.shake = Math.min(1, lab.shake + dt * 0.5); camera.position.x += (Math.random() - 0.5) * 0.06 * lab.shake; camera.position.y += (Math.random() - 0.5) * 0.06 * lab.shake; }
  camera.lookAt(lab.look);
  // 스파크
  const pos = lab.sparks.geometry.attributes.position;
  if (lab.alarm) {
    lab.sparks.material.opacity = 1;
    const origin = new THREE.Vector3(); lab.ring.getWorldPosition(origin);
    for (let i = 0; i < 300; i++) {
      const v = lab.sparkV[i];
      if (pos.getY(i) < 0.02 || v.lengthSq() === 0) { pos.setXYZ(i, origin.x + rand(-1, 1), origin.y + rand(-1, 1), origin.z + rand(-0.3, 0.3)); v.set(rand(-3, 3), rand(0, 4), rand(-3, 3)); }
      v.y -= 9.8 * dt;
      pos.setXYZ(i, pos.getX(i) + v.x * dt, Math.max(0.01, pos.getY(i) + v.y * dt), pos.getZ(i) + v.z * dt);
    }
    pos.needsUpdate = true;
  } else lab.sparks.material.opacity = 0;
}
function startLabCamera(returning) {
  lab.t = 0; lab.shake = 0;
  lab.camFrom.set(-2.8, 2.0, 6.6); lab.camTo.set(0.4, 1.75, 4.9); lab.look.set(2.3, 1.9, 1.4);
  if (returning) { lab.camFrom.set(0.6, 1.7, 4.4); lab.camTo.set(-2.4, 1.9, 6.4); }
}

/* =========================================================
   장면 2 · 시공간 워프
   ========================================================= */
const warp = { scene: new THREE.Scene(), t: 0, dur: 3.4, col: new THREE.Color(0x5ff2ff) };
{
  const N = 1400, g = new THREE.BufferGeometry(), pos = new Float32Array(N * 6);
  warp.seed = [];
  for (let i = 0; i < N; i++) { const a = Math.random() * Math.PI * 2, r = rand(1.5, 22); warp.seed.push([Math.cos(a) * r, Math.sin(a) * r, rand(-420, 0)]); }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  warp.lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x9ff6ff, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending }));
  warp.scene.add(warp.lines); warp.scene.background = new THREE.Color(0x01040a);
}
function updateWarp(dt) {
  warp.t += dt;
  const sp = 120 + 520 * Math.sin(Math.PI * clamp(warp.t / warp.dur, 0, 1));
  const pos = warp.lines.geometry.attributes.position;
  warp.seed.forEach((s, i) => {
    s[2] += sp * dt; if (s[2] > 2) s[2] -= 420;
    const len = sp * 0.05;
    pos.setXYZ(i * 2, s[0], s[1], s[2]); pos.setXYZ(i * 2 + 1, s[0], s[1], s[2] - len);
  });
  pos.needsUpdate = true;
  warp.lines.material.color.copy(warp.col).offsetHSL(Math.sin(warp.t * 3) * 0.05, 0, 0);
  camera.position.set(0, 0, 0); camera.rotation.set(0, 0, warp.t * 0.6);
  camera.fov = 62 + 40 * Math.sin(Math.PI * clamp(warp.t / warp.dur, 0, 1)); camera.updateProjectionMatrix();
}

/* =========================================================
   장면 3 · 고생대 바다
   ========================================================= */
const ocean = { scene: new THREE.Scene() };
const sea = ocean.scene;
let era = ERAS[0], eraIdx = 0, eraT = 0;
const pl = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, hp: 100, st: 100, charge: 0, eaten: 0, level: 1, scale: 1, rolled: false, hidden: false, inv: 0, shake: 0 };
const predators = [], probes = [], colliders = [];
let rows = [], series = [], gridData = new Map();
const stats = { rows: 0, eaten: 0, deaths: 0, probes: 0, start: 0 };
const frags = [String(TODAY.getFullYear()), String(TODAY.getMonth() + 1).padStart(2, '0'), String(TODAY.getDate()).padStart(2, '0')];
const gotFrag = [false, false, false];
let landUnlocked = [0, 0, 0];

function radialTex(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); return t;
}

function buildOcean() {
  sea.environment = envTex; sea.environmentIntensity = 0.3;
  sea.fog = new THREE.FogExp2(0x1f8a9c, 0.018); sea.background = new THREE.Color(0x1f8a9c);
  ocean.hemi = new THREE.HemisphereLight(0x7fe3ee, 0x3a3020, 1.3); sea.add(ocean.hemi);
  ocean.sun = new THREE.DirectionalLight(0xd8fbff, 2.4); ocean.sun.position.set(30, 100, 20); sea.add(ocean.sun);

  // 해저 지형
  const N = IS_TOUCH ? 150 : 220, geo = new THREE.PlaneGeometry(WORLD * 2 + 60, WORLD * 2 + 60, N, N); geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, floorY(p.getX(i), p.getZ(i)));
  geo.computeVertexNormals();
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
  ocean.floorGeo = geo;
  const s = assets.sand; [s.map, s.normal, s.rough].forEach(t => t.repeat.set(36, 36));
  const fm = new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normal, roughnessMap: s.rough, vertexColors: true, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) });
  patchCaustics(fm, 1);
  sea.add(new THREE.Mesh(geo, fm));

  // 바위 (Poly Haven) · 산호초 (Sketchfab) — 인스턴싱
  const rock = bakedGeometry('rock', 3.2), coral = bakedGeometry('coral', 4.2);
  const rockMat = rock.mat.clone(); patchCaustics(rockMat, 0.8);
  const coralMat = coral.mat.clone(); patchCaustics(coralMat, 0.6);
  const rockList = [], coralList = [];
  REEFS.forEach(([x, z, r], i) => {
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
  place(rockList, rock.geo, rockMat, 1.25, 0.15);
  place(coralList, coral.geo, coralMat, 1.8, 0.1);

  // 바다나리(크리노이드) · 고배류(해면 같은 컵 모양 생물) — 절차적 모델
  const parts = [];
  const stalk = new THREE.CylinderGeometry(0.05, 0.09, 3, 6); stalk.translate(0, 1.5, 0); parts.push(stalk);
  const cup = new THREE.SphereGeometry(0.2, 10, 8); cup.translate(0, 3.05, 0); parts.push(cup);
  for (let i = 0; i < 10; i++) { const arm = new THREE.ConeGeometry(0.05, 1.3, 5); arm.translate(0, 0.65, 0); arm.rotateZ(0.6); arm.rotateY(i / 10 * Math.PI * 2); arm.translate(0, 3.1, 0); parts.push(arm); }
  const crGeo = mergeGeometries(parts.map(g => g.toNonIndexed()));
  const crMat = new THREE.MeshStandardMaterial({ roughness: 0.6 }); patchCaustics(crMat, 0.6);
  ocean.crinoids = new THREE.InstancedMesh(crGeo, crMat, 90); ocean.crList = [];
  const cpal = [0xc86bd6, 0xf08a5d, 0xffc96b, 0xe85d8a, 0x9f7bff];
  for (let i = 0; i < 90; i++) {
    const [rx, rz, r] = REEFS[i % REEFS.length]; const a = rand(0, 6.28), d = r * rand(0.2, 1.4);
    const x = rx + Math.cos(a) * d, z = rz + Math.sin(a) * d;
    ocean.crList.push({ x, z, y: floorY(x, z) - 0.1, s: rand(0.6, 1.5), ph: rand(0, 6.28), ry: rand(0, 6.28) });
    ocean.crinoids.setColorAt(i, new THREE.Color(cpal[i % 5]));
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

  // 수면, 빛줄기, 바다눈
  ocean.surf = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshBasicMaterial({ color: 0x8ff0ff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }));
  ocean.surf.rotation.x = Math.PI / 2; ocean.surf.position.y = 0.2; sea.add(ocean.surf);
  const rc = document.createElement('canvas'); rc.width = 64; rc.height = 256; const rg = rc.getContext('2d');
  const grd = rg.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  rg.fillStyle = grd; rg.fillRect(0, 0, 64, 256);
  const hg = rg.createLinearGradient(0, 0, 64, 0); hg.addColorStop(0, 'rgba(0,0,0,1)'); hg.addColorStop(0.5, 'rgba(0,0,0,0)'); hg.addColorStop(1, 'rgba(0,0,0,1)');
  rg.globalCompositeOperation = 'destination-out'; rg.fillStyle = hg; rg.fillRect(0, 0, 64, 256);
  const rayMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(rc), transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  ocean.rays = [];
  for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(rand(3, 7), 46), rayMat); m.userData = { a: rand(0, 6.28), r: rand(8, 42), ph: rand(0, 6.28) }; sea.add(m); ocean.rays.push(m); }
  const SN = IS_TOUCH ? 1200 : 2600, sg = new THREE.BufferGeometry(), sp = new Float32Array(SN * 3);
  for (let i = 0; i < SN; i++) { sp[i * 3] = rand(-40, 40); sp[i * 3 + 1] = rand(-40, 40); sp[i * 3 + 2] = rand(-40, 40); }
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  ocean.snow = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.12, map: radialTex(), transparent: true, opacity: 0.55, depthWrite: false, color: 0xdffbff }));
  ocean.snow.frustumCulled = false; sea.add(ocean.snow);

  // 먹이: 플랑크톤 덩어리 + 해저 벌레
  ocean.plank = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.26, 1), new THREE.MeshStandardMaterial({ color: 0xc8ffe6, emissive: 0x3dffa8, emissiveIntensity: 1.8, roughness: 0.4 }), NPLANK);
  ocean.plankGlow = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(NPLANK * 3), 3)),
    new THREE.PointsMaterial({ size: 1.9, map: radialTex('rgba(140,255,200,0.9)', 'rgba(140,255,200,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  ocean.plankGlow.frustumCulled = false;
  ocean.worm = new THREE.InstancedMesh(new THREE.CapsuleGeometry(0.11, 0.8, 4, 8).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xff8f9f, emissive: 0x80202c, emissiveIntensity: 0.6, roughness: 0.5 }), NWORM);
  sea.add(ocean.plank, ocean.plankGlow, ocean.worm);
  ocean.food = [];
  for (let i = 0; i < NPLANK; i++) ocean.food.push({ kind: 'plank', i, p: new THREE.Vector3(), ph: rand(0, 6.28) });
  for (let i = 0; i < NWORM; i++) ocean.food.push({ kind: 'worm', i, p: new THREE.Vector3(), ph: rand(0, 6.28), ry: rand(0, 6.28) });

  // 추락한 타임머신
  const tm = makeModel('timemachine', 7.5);
  const metal = new THREE.MeshStandardMaterial({ color: 0x7d8792, metalness: 0.9, roughness: 0.45 }); patchCaustics(metal, 0.5);
  tm.traverse(o => { if (o.isMesh) o.material = metal; });
  tm.position.set(HOME.x, HOME.y + tm.userData.height * 0.42, HOME.z); tm.rotation.set(0.12, 0.8, 0.18);
  sea.add(tm); ocean.tm = tm;
  colliders.push({ c: new THREE.Vector3(HOME.x, HOME.y + 1, HOME.z), r: 3.2 });
  ocean.tmLight = new THREE.PointLight(0xff8a3d, 30, 18); ocean.tmLight.position.set(HOME.x, HOME.y + 3, HOME.z); sea.add(ocean.tmLight);
  ocean.beacon = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 2.2, 90, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  ocean.beacon.position.set(HOME.x, HOME.y + 45, HOME.z); ocean.beacon.visible = false; sea.add(ocean.beacon);

  // 플레이어(삼엽충)
  ocean.player = makeModel('trilobite', 1.3); sea.add(ocean.player);
  const pLight = new THREE.PointLight(0xdffbff, 14, 10); pLight.position.set(0, 2.4, -1.5); ocean.player.add(pLight);
  ocean.shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: radialTex('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
  ocean.shadow.rotation.x = -Math.PI / 2; sea.add(ocean.shadow);
}

function setupEra(i) {
  eraIdx = i; era = ERAS[i]; eraT = 0;
  sea.fog.color.set(era.fog); sea.fog.density = era.fogD; sea.background.set(era.fog);
  ocean.hemi.color.set(era.hemiSky); ocean.hemi.groundColor.set(era.hemiGround); ocean.sun.color.set(era.sun);
  ocean.surf.material.color.set(era.surface);
  // 해저 색: 깊을수록 어둡게 + 시대 색조
  const p = ocean.floorGeo.attributes.position, col = ocean.floorGeo.attributes.color, [tr, tg, tb] = era.floorTint;
  for (let k = 0; k < p.count; k++) { const d = smooth(-8, -62, p.getY(k)); const v = 1 - d * 0.55; col.setXYZ(k, tr * v, tg * v, tb * v * (1 + d * 0.15)); }
  col.needsUpdate = true;
  // 포식자
  predators.forEach(pr => sea.remove(pr.obj)); predators.length = 0;
  for (let k = 0; k < era.predCount; k++) predators.push(new Predator(k));
  // 부표
  probes.forEach(pb => sea.remove(pb.obj)); probes.length = 0;
  era.probes.forEach(([x, z], k) => probes.push(makeProbe(x, z, k)));
  // 먹이 배치
  ocean.food.forEach(f => respawnFood(f));
  // 플레이어 초기화
  pl.pos.set(HOME.x + 6, HOME.y + 4, HOME.z + 6); pl.vel.set(0, 0, 0); pl.yaw = 0.6; pl.pitch = 0;
  pl.hp = 100; pl.st = 100; pl.charge = 0; pl.inv = 2;
  rows = []; series = []; gridData = new Map(); landUnlocked[i] = 0;
  ocean.beacon.visible = false; G.missionDone = false;
  camera.fov = 62; camera.updateProjectionMatrix(); camera.rotation.set(0, 0, 0);
  camera.position.copy(pl.pos).add(new THREE.Vector3(-6, 3, -6));
  $('m-era').textContent = era.name; $('m-ago').textContent = era.jump + ' YEARS · ' + era.ago;
  $('o-home').classList.add('hidden');
}

/* ---------------- 부표 ---------------- */
function makeProbe(x, z, k) {
  const g = new THREE.Group();
  const y = Math.min(-3, floorY(x, z) + rand(3, 6));
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.6, 16), new THREE.MeshStandardMaterial({ color: 0xdfe8ee, metalness: 0.7, roughness: 0.3, emissive: 0x0a3a48 }));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 10), new THREE.MeshBasicMaterial({ color: 0x5ff2ff }));
  cap.position.y = 0.95;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.05, 8, 48), new THREE.MeshBasicMaterial({ color: 0x5ff2ff, transparent: true, opacity: 0.8 }));
  ring.rotation.x = Math.PI / 2;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex('rgba(95,242,255,0.9)', 'rgba(95,242,255,0)'), blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.set(5, 5, 1);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, Math.abs(y), 8, 1, true), new THREE.MeshBasicMaterial({ color: 0x5ff2ff, transparent: true, opacity: 0.06, blending: THREE.AdditiveBlending, depthWrite: false }));
  beam.position.y = Math.abs(y) / 2;
  g.add(body, cap, ring, glow, beam);
  g.position.set(x, y, z); sea.add(g);
  return { obj: g, ring, k, got: false, pos: g.position };
}

/* ---------------- 포식자 ---------------- */
class Predator {
  constructor(k) {
    this.obj = makeModel(era.predator, era.predLen); sea.add(this.obj);
    this.wrap = this.obj.userData.wrap;
    this.pos = new THREE.Vector3(rand(-100, 100), 0, rand(-100, 100));
    if (this.pos.distanceTo(HOME) < 50) this.pos.x += 70;
    this.pos.y = floorY(this.pos.x, this.pos.z) + rand(3, 8);
    this.dir = new THREE.Vector3(rand(-1, 1), 0, rand(-1, 1)).normalize();
    this.state = 'wander'; this.timer = 0; this.cool = 0; this.ph = rand(0, 6.28);
    this.target = new THREE.Vector3(); this.pickTarget();
  }
  pickTarget() {
    let best = null, bw = -1;
    for (let i = 0; i < 12; i++) {
      const x = rand(-135, 135), z = rand(-135, 135);
      if (Math.hypot(x - HOME.x, z - HOME.z) < 22) continue;
      const fy = floorY(x, z), e = env(x, fy + 4, z, era, eraT);
      const w = Math.pow(era.predPref(x, z, e), 2) * Math.random();
      if (w > bw) { bw = w; best = [x, z, fy]; }
    }
    best = best || [0, 0, floorY(0, 0)];
    this.target.set(best[0], Math.min(-3, best[2] + rand(2.5, 9)), best[1]);
  }
  update(dt) {
    this.ph += dt * 3; this.cool -= dt; this.timer -= dt;
    const toP = pl.pos.clone().sub(this.pos), dist = toP.length();
    let detect = era.predDetect * (pl.hidden ? 0.4 : 1) * (pl.rolled ? 0.6 : 1);
    let speed = era.predSpeed * 0.45, want;
    if (this.state === 'wander') {
      want = this.target.clone().sub(this.pos);
      if (want.length() < 6) this.pickTarget();
      if (dist < detect && this.cool <= 0 && G.playing) { this.state = 'chase'; this.timer = 7; }
    } else if (this.state === 'chase') {
      want = toP; speed = era.predSpeed;
      if (dist > detect * 1.9 || this.timer <= 0 || pl.hidden && dist > 6) { this.state = 'wander'; this.cool = 4; this.pickTarget(); }
    } else { // retreat
      want = toP.clone().negate(); speed = era.predSpeed * 0.8;
      if (this.timer <= 0) { this.state = 'wander'; this.pickTarget(); }
    }
    want.normalize();
    this.dir.lerp(want, 1 - Math.exp(-dt * (this.state === 'chase' ? 2.2 : 1.1))).normalize();
    this.pos.addScaledVector(this.dir, speed * dt);
    const fy = floorY(this.pos.x, this.pos.z) + era.predLen * 0.18;
    if (this.pos.y < fy) { this.pos.y = fy; this.dir.y = Math.abs(this.dir.y); }
    if (this.pos.y > -2.5) { this.pos.y = -2.5; this.dir.y = -Math.abs(this.dir.y); }
    const R = Math.hypot(this.pos.x, this.pos.z); if (R > WORLD - 5) { this.dir.x -= this.pos.x / R * 0.2; this.dir.z -= this.pos.z / R * 0.2; }
    this.obj.position.copy(this.pos);
    this.obj.lookAt(this.pos.clone().add(this.dir));
    this.wrap.rotation.y = Math.sin(this.ph * (this.state === 'chase' ? 2.2 : 1)) * 0.14;
    // 공격
    const reach = era.predLen * 0.32 + 0.5 * pl.scale;
    if (G.playing && this.state === 'chase' && dist < reach && pl.inv <= 0) {
      const away = toP.clone().normalize();
      if (pl.rolled) { pl.vel.addScaledVector(away, 9); SFX.bounce(); toast('몸 말기 방어 성공! 공격을 튕겨냈어요', 'gold'); }
      else { pl.hp -= 24; pl.vel.addScaledVector(away, 15); pl.shake = 0.6; pl.inv = 1.2; SFX.hit(); flash('rgba(255,40,60,.45)'); toast(`${era.predName}에게 물렸어요! (체력 −24)`, 'red'); }
      this.state = 'retreat'; this.timer = 3; this.cool = 5;
    }
  }
}

/* ---------------- 먹이 ---------------- */
function respawnFood(f) {
  for (let k = 0; k < 40; k++) {
    const x = rand(-140, 140), z = rand(-140, 140), fy = floorY(x, z);
    // 플랑크톤은 빛이 드는 위쪽 물(약 25m 이내)에, 벌레는 해저에
    const y = f.kind === 'worm' ? fy + 0.12 : rand(Math.max(fy + 0.8, -24), -2.2);
    const e = env(x, y, z, era, eraT);
    if (Math.random() * 11.5 < e.food + 1.5 || k === 39) { f.p.set(x, y, z); return; }
  }
}

/* ---------------- 데이터 기록 ---------------- */
function addRow(r) {
  rows.push(r); stats.rows++;
  const key = Math.floor((r.x + WORLD) / 6) + ',' + Math.floor((r.z + WORLD) / 6);
  gridData.set(key, r);
}
function sampleRow(x, y, z, extra = {}) {
  const e = env(x, y, z, era, eraT);
  return { x, z, t: eraT, depth: e.depth, temp: e.temp, o2: e.o2, co2: e.co2, ph: e.ph, nut: e.nut, food: e.food, reef: e.reef, pred: 0, ...extra };
}
function livePredCount(p) { return predators.filter(pr => pr.pos.distanceTo(p) < 35).length; }
function probeRows(pb) {
  for (let k = 0; k < 180; k++) {
    const a = rand(0, 6.28), d = rand(0, 65), x = clamp(pb.pos.x + Math.cos(a) * d, -145, 145), z = clamp(pb.pos.z + Math.sin(a) * d, -145, 145);
    const fy = floorY(x, z), y = rand(fy + 0.5, -1);
    const r = sampleRow(x, y, z);
    r.food = clamp(r.food + rand(-0.8, 0.8), 0, 10);
    r.pred = Math.max(0, Math.round(era.predPref(x, z, r) * 2.4 * rand(0.4, 1.6) - 0.4));
    addRow(r);
  }
  if (pb.k === era.outlierProbe) {
    for (let k = 0; k < 24; k++) { const r = sampleRow(pb.pos.x + rand(-5, 5), pb.pos.y, pb.pos.z + rand(-5, 5)); r.temp = rand(85, 99); r.food = rand(7, 10); r.nut = rand(0, 2); r.outlier = true; addRow(r); }
  }
}
function seriesRow() {
  let T = 0, O = 0, C = 0; const n = 30;
  for (let k = 0; k < n; k++) { const x = rand(-140, 140), z = rand(-140, 140), fy = floorY(x, z), e = env(x, rand(fy + 1, -1), z, era, eraT); T += e.temp; O += e.o2; C += e.co2; }
  series.push({ t: eraT, avgT: T / n + rand(-0.15, 0.15), avgO2: O / n + rand(-0.08, 0.08), co2: C / n });
}

/* ---------------- 입력 ---------------- */
const keys = {}; const ptr = { x: 0, y: 0, in: false, L: false, R: false };
addEventListener('keydown', e => {
  keys[e.code] = true;
  if ((e.code === 'Space' || e.code === 'Enter') && !$('dialog').classList.contains('hidden')) { e.preventDefault(); nextLine(); return; }
  if (e.code === 'KeyM' && G.mode === 'ocean') { mapVar = (mapVar + 1) % MAPVARS.length; drawMinimap(true); }
  if (e.code === 'KeyN' && e.ctrlKey && e.shiftKey && G.playing) { pl.charge = 100; probes.forEach(pb => { if (!pb.got) collectProbe(pb); }); }
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
// 마우스 (PC)
if (!IS_TOUCH) {
  canvas.addEventListener('mousemove', e => { ptr.x = e.clientX / innerWidth * 2 - 1; ptr.y = e.clientY / innerHeight * 2 - 1; ptr.in = true; });
  canvas.addEventListener('mouseleave', () => { ptr.in = false; });
  canvas.addEventListener('mousedown', e => { if (e.button === 0) ptr.L = true; if (e.button === 2) ptr.R = true; });
  addEventListener('mouseup', e => { if (e.button === 0) ptr.L = false; if (e.button === 2) ptr.R = false; });
}
addEventListener('contextmenu', e => e.preventDefault());
// 터치 (패드): 화면 아무 곳이나 누르면 그 자리에 가상 조이스틱이 생김
const joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 }, JOY_R = 60;
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse' && !IS_TOUCH) return;
  if (!$('dialog').classList.contains('hidden')) { nextLine(); return; }
  if (joy.id !== null) return;
  joy.id = e.pointerId; joy.ox = e.clientX; joy.oy = e.clientY; joy.x = joy.y = 0;
  canvas.setPointerCapture(e.pointerId);
  const el = $('joy'); el.style.left = joy.ox + 'px'; el.style.top = joy.oy + 'px'; el.classList.add('on'); $('joyhint').classList.add('hidden');
  el.firstElementChild.style.transform = '';
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId !== joy.id) return;
  let dx = e.clientX - joy.ox, dy = e.clientY - joy.oy; const L = Math.hypot(dx, dy);
  if (L > JOY_R) { dx *= JOY_R / L; dy *= JOY_R / L; }
  joy.x = dx / JOY_R; joy.y = dy / JOY_R;
  $('joy').firstElementChild.style.transform = `translate(${dx}px,${dy}px)`;
});
const joyEnd = e => { if (e.pointerId !== joy.id) return; joy.id = null; joy.x = joy.y = 0; $('joy').classList.remove('on'); };
canvas.addEventListener('pointerup', joyEnd); canvas.addEventListener('pointercancel', joyEnd);
// 돌진 · 몸 말기 버튼 (누르고 있는 동안)
function holdButton(el, key) {
  const on = e => { e.preventDefault(); ptr[key] = true; el.classList.add('on'); try { el.setPointerCapture(e.pointerId); } catch (_) { } };
  const off = () => { ptr[key] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
}
holdButton($('tb-dash'), 'L'); holdButton($('tb-roll'), 'R');
$('mapbox').addEventListener('pointerdown', () => { if (G.mode === 'ocean') { mapVar = (mapVar + 1) % MAPVARS.length; drawMinimap(true); SFX.blip(); } });
if (P.has('teacher')) $('tb-teacher').classList.remove('hidden');
$('tb-teacher').addEventListener('click', () => { if (G.playing) { pl.charge = 100; probes.forEach(pb => { if (!pb.got) collectProbe(pb); }); } });

/* ---------------- 플레이어 업데이트 ---------------- */
const LEVELS = [0, 6, 14, 24, 36];
const fwd = new THREE.Vector3();
function updatePlayer(dt) {
  let yi = 0, pi = 0;
  if (keys.KeyA || keys.ArrowLeft) yi += 1; if (keys.KeyD || keys.ArrowRight) yi -= 1;
  if (keys.KeyW || keys.ArrowUp) pi += 1; if (keys.KeyS || keys.ArrowDown) pi -= 1;
  if (!yi && !pi && joy.id !== null) {
    if (Math.abs(joy.x) > 0.12) yi = -clamp((joy.x - Math.sign(joy.x) * 0.12) * 1.25, -1, 1);
    if (Math.abs(joy.y) > 0.15) pi = -clamp((joy.y - Math.sign(joy.y) * 0.15) * 1.25, -1, 1);
  } else if (!yi && !pi && ptr.in) {
    if (Math.abs(ptr.x) > 0.08) yi = -clamp((ptr.x - Math.sign(ptr.x) * 0.08) * 1.8, -1, 1);
    if (Math.abs(ptr.y) > 0.1) pi = -clamp((ptr.y - Math.sign(ptr.y) * 0.1) * 1.8, -1, 1);
  }
  pl.rolled = (keys.KeyE || ptr.R) && pl.st > 2;
  const boost = (keys.Space || ptr.L || keys.ShiftLeft) && pl.st > 1 && !pl.rolled;
  pl.st = clamp(pl.st + (boost ? -26 : pl.rolled ? -10 : 15) * dt, 0, 100);
  pl.yaw += yi * 2.1 * dt;
  pl.pitch = lerp(pl.pitch, pi * 0.8, 1 - Math.exp(-dt * 3));
  pl.roll = lerp(pl.roll, -yi * 0.45, 1 - Math.exp(-dt * 4));
  fwd.set(Math.sin(pl.yaw) * Math.cos(pl.pitch), Math.sin(pl.pitch), Math.cos(pl.yaw) * Math.cos(pl.pitch));
  const speed = pl.rolled ? 0 : (5.2 + pl.level * 0.45) * (boost ? 2.3 : 1);
  pl.vel.lerp(fwd.clone().multiplyScalar(speed), 1 - Math.exp(-dt * (pl.rolled ? 1.2 : 2.8)));
  pl.pos.addScaledVector(pl.vel, dt);
  // 충돌: 해저, 수면, 경계, 바위·산호
  const fy = floorY(pl.pos.x, pl.pos.z) + 0.3 * pl.scale;
  if (pl.pos.y < fy) { pl.pos.y = fy; if (pl.vel.y < 0) pl.vel.y *= -0.2; }
  if (pl.pos.y > -1.2) { pl.pos.y = -1.2; if (pl.vel.y > 0) pl.vel.y = 0; }
  const R = Math.hypot(pl.pos.x, pl.pos.z);
  if (R > WORLD - 6) { pl.pos.x *= (WORLD - 6) / R; pl.pos.z *= (WORLD - 6) / R; if (Math.random() < 0.02) toast('탐사 가능 구역의 끝이에요', ''); }
  for (const c of colliders) {
    const d = pl.pos.clone().sub(c.c), L = d.length(), r = c.r + 0.4 * pl.scale;
    if (L < r && L > 0.001) { pl.pos.addScaledVector(d, (r - L) / L); }
  }
  pl.hidden = reefDist(pl.pos.x, pl.pos.z) < 3 && pl.pos.y - floorY(pl.pos.x, pl.pos.z) < 5;
  // 환경 스트레스
  const e = env(pl.pos.x, pl.pos.y, pl.pos.z, era, eraT); G.e = e;
  let stress = 0;
  if (e.o2 < 2.6) stress += (2.6 - e.o2) * 5.5;
  if (e.temp > 34) stress += (e.temp - 34) * 3;
  if (stress > 0 && pl.inv <= 0) pl.hp -= stress * dt;
  else pl.hp = Math.min(100, pl.hp + dt * 0.6);
  pl.inv -= dt;
  // 모델
  pl.scale = lerp(pl.scale, 1 + (pl.level - 1) * 0.25, 1 - Math.exp(-dt * 2));
  const o = ocean.player;
  o.position.copy(pl.pos);
  o.rotation.set(-pl.pitch, pl.yaw, pl.roll, 'YXZ');
  const w = o.userData.wrap;
  const roll = pl.rolled ? 1 : 0;
  w.rotation.x = lerp(w.rotation.x, roll * -1.1, 1 - Math.exp(-dt * 8));
  w.rotation.z = Math.sin(G.t * 9) * 0.04 * (1 - roll);
  o.scale.setScalar(pl.scale * (1 - roll * 0.15));
  const fyR = floorY(pl.pos.x, pl.pos.z);
  ocean.shadow.position.set(pl.pos.x, fyR + 0.06, pl.pos.z);
  const hgt = pl.pos.y - fyR; ocean.shadow.scale.setScalar(pl.scale * 2.2 * (1 + hgt * 0.05)); ocean.shadow.material.opacity = clamp(1 - hgt / 14, 0, 1);
  if (pl.hp <= 0) respawn();
}

async function respawn() {
  if (G.respawning) return; G.respawning = true; G.playing = false; stats.deaths++;
  flash('rgba(0,0,0,1)', 900); await sleep(700);
  pl.pos.set(HOME.x + 6, HOME.y + 4, HOME.z + 6); pl.vel.set(0, 0, 0); pl.hp = 100; pl.inv = 3; pl.charge = Math.max(0, pl.charge - 10);
  radio('생체 신호 위험! 타임머신 옆으로 긴급 소환했어요. 충전량이 조금 줄었어요(−10%).');
  G.playing = true; G.respawning = false;
}

function eatCheck() {
  const r2 = (1.0 * pl.scale + 0.8) ** 2;
  for (const f of ocean.food) {
    if (f.p.distanceToSquared(pl.pos) < r2) {
      const big = f.kind === 'worm';
      pl.charge = Math.min(100, pl.charge + (big ? 6 : 3)); pl.hp = Math.min(100, pl.hp + (big ? 5 : 2));
      pl.eaten++; stats.eaten++; SFX.eat(); floatText(big ? '+6%' : '+3%', f.p);
      respawnFood(f);
      const lv = LEVELS.filter(x => pl.eaten >= x).length;
      if (lv > pl.level) { pl.level = lv; SFX.level(); toast(`성장! 탈피해서 몸집이 커졌어요 (${lv}단계)`, 'gold'); }
    }
  }
}

function collectProbe(pb) {
  pb.got = true; sea.remove(pb.obj); stats.probes++; SFX.probe();
  probeRows(pb);
  landUnlocked[eraIdx]++;
  floatText('+180행', pb.pos, '#5ff2ff');
  radio(`부표 ${probes.filter(p => p.got).length}/5 회수! 부표 관측 데이터 180행 수신.\n드론 대기 관측: ${era.land[pb.k]}`, 8000);
}

/* ---------------- 바다 업데이트 ---------------- */
let sampleT = 0, seriesT = 0, hudT = 0, mapT = 0, logT = 0;
function updateOcean(dt) {
  CAUS.uTime.value = G.t;
  if (G.playing) {
    eraT += dt / 60;
    updatePlayer(dt);
    eatCheck();
    for (const pb of probes) if (!pb.got && pb.pos.distanceTo(pl.pos) < 3 + pl.scale) collectProbe(pb);
    sampleT -= dt; seriesT -= dt;
    if (sampleT <= 0) { sampleT = 0.5; addRow(sampleRow(pl.pos.x, pl.pos.y, pl.pos.z, { pred: livePredCount(pl.pos) })); }
    if (seriesT <= 0) { seriesT = 3; seriesRow(); }
    const done = pl.charge >= 100 && probes.every(p => p.got);
    if (done && !G.missionDone) { G.missionDone = true; ocean.beacon.visible = true; SFX.level(); radio('에너지와 데이터가 모두 모였어요! 노란 빛기둥, 타임머신으로 돌아와 주세요!', 7000); $('o-home').classList.remove('hidden'); }
    if (G.missionDone && pl.pos.distanceTo(HOME) < 9) openAnalysis();
    if (era.anox && eraT > 4 && !G.warned) { G.warned = true; radio('경고! 무산소 해역이 얕은 곳까지 올라오고 있어요. 서둘러요!', 6000); }
  }
  for (const pr of predators) pr.update(G.playing ? dt : dt * 0.3);
  // 먹이 애니메이션
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), V = new THREE.Vector3();
  const gp = ocean.plankGlow.geometry.attributes.position;
  for (const f of ocean.food) {
    if (f.kind === 'plank') {
      V.copy(f.p); V.y += Math.sin(G.t * 1.5 + f.ph) * 0.25; const s = 0.85 + 0.25 * Math.sin(G.t * 3 + f.ph);
      M.compose(V, Q, S.set(s, s, s)); ocean.plank.setMatrixAt(f.i, M); gp.setXYZ(f.i, V.x, V.y, V.z);
    } else {
      Q.setFromEuler(new THREE.Euler(0, f.ry + Math.sin(G.t * 2 + f.ph) * 0.4, 0));
      M.compose(f.p, Q, S.set(1, 1, 1)); ocean.worm.setMatrixAt(f.i, M);
    }
  }
  ocean.plank.instanceMatrix.needsUpdate = true; ocean.worm.instanceMatrix.needsUpdate = true; gp.needsUpdate = true;
  // 바다나리 흔들림
  ocean.crList.forEach((c, i) => {
    Q.setFromEuler(new THREE.Euler(Math.sin(G.t * 0.8 + c.ph) * 0.12, c.ry, Math.cos(G.t * 0.6 + c.ph) * 0.1));
    M.compose(V.set(c.x, c.y, c.z), Q, S.set(c.s, c.s, c.s)); ocean.crinoids.setMatrixAt(i, M);
  });
  ocean.crinoids.instanceMatrix.needsUpdate = true;
  probes.forEach(pb => { pb.ring.rotation.z += dt * 1.5; pb.ring.scale.setScalar(1 + 0.15 * Math.sin(G.t * 3 + pb.k)); });
  ocean.tmLight.intensity = (G.missionDone ? 60 : 22) * (0.6 + 0.4 * Math.sin(G.t * (G.missionDone ? 3 : 11)));
  ocean.tmLight.color.set(G.missionDone ? 0xffd66b : 0xff8a3d);
  ocean.beacon.material.opacity = 0.18 + 0.08 * Math.sin(G.t * 3);
  // 빛줄기 · 바다눈
  ocean.rays.forEach(r => {
    const u = r.userData, a = u.a + G.t * 0.02;
    r.position.set(camera.position.x + Math.cos(a) * u.r, -20, camera.position.z + Math.sin(a) * u.r);
    r.rotation.set(0, Math.atan2(camera.position.x - r.position.x, camera.position.z - r.position.z), 0.18);
    r.material.opacity = 0.11;
  });
  const sp = ocean.snow.geometry.attributes.position, cp = camera.position;
  for (let i = 0; i < sp.count; i++) {
    let x = sp.getX(i), y = sp.getY(i) - dt * 0.25, z = sp.getZ(i);
    if (x - cp.x > 40) x -= 80; else if (cp.x - x > 40) x += 80;
    if (y - cp.y > 40) y -= 80; else if (cp.y - y > 40) y += 80;
    if (z - cp.z > 40) z -= 80; else if (cp.z - z > 40) z += 80;
    sp.setXYZ(i, x, Math.min(y, -0.5), z);
  }
  sp.needsUpdate = true;
  // 페름기: 시간이 갈수록 바다가 탁해짐
  if (era.anox) { const k = clamp(eraT / 8, 0, 1); sea.fog.color.set(era.fog).lerp(new THREE.Color(0x4a3a22), k * 0.6); sea.background.copy(sea.fog.color); sea.fog.density = era.fogD + k * 0.008; }
  updateCamera(dt);
  hudT -= dt; if (hudT <= 0) { hudT = 0.1; updateHUD(); }
  mapT -= dt; if (mapT <= 0) { mapT = 0.25; drawMinimap(); }
  logT -= dt; if (logT <= 0) { logT = 0.5; updateLog(); }
  updateMarkers();
}

function updateCamera(dt) {
  const back = 3.4 + pl.scale * 2.0, up = 1.4 + pl.scale * 0.8;
  const flat = new THREE.Vector3(Math.sin(pl.yaw), 0, Math.cos(pl.yaw));
  const want = pl.pos.clone().addScaledVector(flat, -back).add(new THREE.Vector3(0, up - pl.pitch * 2.2, 0));
  want.y = Math.max(want.y, floorY(want.x, want.z) + 0.8); want.y = Math.min(want.y, -0.6);
  camera.position.lerp(want, 1 - Math.exp(-dt * 4.5));
  if (pl.shake > 0) { pl.shake -= dt; camera.position.x += (Math.random() - 0.5) * pl.shake * 0.6; camera.position.y += (Math.random() - 0.5) * pl.shake * 0.6; }
  camera.lookAt(pl.pos.clone().addScaledVector(fwd.lengthSq() ? fwd : flat, 2.5));
}

/* =========================================================
   HUD
   ========================================================= */
const SENS = [
  ['depth', '수심', 'm', 1, () => 'ok'],
  ['temp', '수온', '℃', 1, v => v > 34 ? 'bad' : v > 31.5 ? 'warn' : 'ok'],
  ['o2', '용존 산소', 'mg/L', 2, v => v < 2.6 ? 'bad' : v < 3.6 ? 'warn' : 'ok'],
  ['co2', 'CO₂', 'ppm', 0, () => 'ok'],
  ['ph', 'pH', '', 2, v => v < 7.5 ? 'warn' : 'ok'],
  ['nut', '영양염류', 'μmol/L', 1, () => 'ok'],
];
$('srows').innerHTML = SENS.map(([k, n, u]) => `<div class="srow" id="sr-${k}"><span class="k">${n}</span><span class="v"><span>-</span><small>${u}</small></span></div>`).join('');
function updateHUD() {
  const e = G.e; if (!e) return;
  for (const [k, , , d, f] of SENS) {
    const el = $('sr-' + k), v = e[k];
    el.querySelector('.v span').textContent = k === 'co2' ? fmt(v) : v.toFixed(d);
    el.className = 'srow ' + f(v);
  }
  const mm = Math.floor(eraT), ss = Math.floor((eraT - mm) * 60);
  $('s-time').textContent = String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
  const got = probes.filter(p => p.got).length;
  $('v-charge').textContent = Math.floor(pl.charge) + '%'; $('o-charge').querySelector('i').style.width = pl.charge + '%';
  $('o-charge').classList.toggle('done', pl.charge >= 100);
  $('v-probe').textContent = got + ' / 5'; $('o-probe').querySelector('i').style.width = got * 20 + '%'; $('o-probe').classList.toggle('done', got === 5);
  $('v-rows').textContent = fmt(rows.length) + '행 × 10변수';
  $('v-hp').textContent = Math.max(0, Math.floor(pl.hp)); $('hpbar').firstElementChild.style.width = Math.max(0, pl.hp) + '%';
  $('v-st').textContent = Math.floor(pl.st); $('stbar').firstElementChild.style.width = pl.st + '%';
  $('v-lvl').textContent = pl.level; $('v-eat').textContent = pl.eaten;
  const chasing = predators.some(p => p.state === 'chase');
  const chips = [];
  if (chasing) chips.push(`<span class="chip red">${era.predName} 추격 중! 도망치거나 몸 말기(E)</span>`);
  if (pl.rolled) chips.push('<span class="chip gold">몸 말기 방어 중</span>');
  if (pl.hidden) chips.push('<span class="chip green">암초에 숨는 중 · 포식자가 잘 못 봐요</span>');
  if (e.o2 < 2.6) chips.push('<span class="chip red">산소 부족! 얕은 곳으로</span>');
  if (e.temp > 34) chips.push('<span class="chip red">수온 위험!</span>');
  $('chips').innerHTML = chips.join('');
  const danger = chasing || pl.hp < 35;
  $('vignette').style.boxShadow = `inset 0 0 160px 40px rgba(255,30,50,${danger ? 0.35 + 0.15 * Math.sin(G.t * 8) : 0})`;
}
function updateLog() {
  const last = rows.slice(-6).reverse();
  $('log').innerHTML = '<span class="h">t     수심   수온   O₂    영양  먹이 포식</span>\n' + last.map(r => {
    const m = Math.floor(r.t), s = Math.floor((r.t - m) * 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')} ${r.depth.toFixed(1).padStart(5)} ${r.temp.toFixed(1).padStart(5)} ${r.o2.toFixed(2).padStart(5)} ${r.nut.toFixed(1).padStart(5)} ${r.food.toFixed(1).padStart(4)} ${String(r.pred).padStart(3)}`;
  }).join('\n');
}

const MAPVARS = [['temp', '수온', 10, 36], ['o2', '용존 산소', 0, 8], ['nut', '영양염류', 0, 16], ['food', '먹이 밀도', 0, 10], ['pred', '포식자 수', 0, 3], ['depth', '수심', 0, 65]];
let mapVar = 0;
function ramp(t) {
  const c = [[43, 76, 255], [25, 211, 197], [155, 255, 92], [255, 210, 63], [255, 75, 75]];
  t = clamp(t, 0, 0.999) * 4; const i = Math.floor(t), f = t - i, a = c[i], b = c[i + 1];
  return `rgb(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0})`;
}
function drawMinimap(force) {
  const cv = $('minimap'), g = cv.getContext('2d'), W = cv.width, s = W / (WORLD * 2);
  const [k, name, lo, hi] = MAPVARS[mapVar];
  if (force) { $('map-var').textContent = name; $('leg-lo').textContent = lo; $('leg-hi').textContent = hi; }
  g.fillStyle = '#04141d'; g.fillRect(0, 0, W, W);
  g.save(); g.beginPath(); g.arc(W / 2, W / 2, W / 2, 0, Math.PI * 2); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.03)'; g.fillRect(0, 0, W, W);
  const cs = 6 * s;
  for (const [key, r] of gridData) {
    if (r.outlier) continue;
    const [i, j] = key.split(',').map(Number);
    g.fillStyle = ramp((r[k] - lo) / (hi - lo)); g.fillRect(i * cs, j * cs, cs + 0.5, cs + 0.5);
  }
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  for (const [x, z, r] of REEFS) { g.beginPath(); g.arc((x + WORLD) * s, (z + WORLD) * s, r * s, 0, 7); g.stroke(); }
  g.restore();
  for (const pb of probes) if (!pb.got) { g.fillStyle = '#5ff2ff'; g.beginPath(); g.arc((pb.pos.x + WORLD) * s, (pb.pos.z + WORLD) * s, 7 + 2 * Math.sin(G.t * 4), 0, 7); g.fill(); }
  g.fillStyle = G.missionDone ? '#ffd66b' : '#ff8a3d'; g.fillRect((HOME.x + WORLD) * s - 8, (HOME.z + WORLD) * s - 8, 16, 16);
  for (const pr of predators) { g.fillStyle = '#ff4f5e'; g.beginPath(); g.arc((pr.pos.x + WORLD) * s, (pr.pos.z + WORLD) * s, 6, 0, 7); g.fill(); }
  g.save(); g.translate((pl.pos.x + WORLD) * s, (pl.pos.z + WORLD) * s); g.rotate(-pl.yaw + Math.PI);
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -14); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill(); g.restore();
}

function placeMarker(el, wp, show) {
  if (!show) { el.classList.add('hidden'); return; }
  const v = wp.clone().project(camera); let x = v.x, y = v.y;
  const behind = v.z > 1;
  if (behind) { x = -x; y = -y; }
  const edge = behind || Math.abs(x) > 0.7 || Math.abs(y) > 0.6;
  if (edge) { const m = Math.max(Math.abs(x) / 0.7, Math.abs(y) / 0.6); x /= m; y /= m; }
  el.classList.remove('hidden');
  el.style.left = ((x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - y) / 2 * innerHeight) + 'px';
  el.querySelector('span').textContent = el.id === 'mk-home' ? `타임머신 ${Math.round(wp.distanceTo(pl.pos))}m` : `관측 부표 ${Math.round(wp.distanceTo(pl.pos))}m`;
}
function updateMarkers() {
  const left = probes.filter(p => !p.got).sort((a, b) => a.pos.distanceTo(pl.pos) - b.pos.distanceTo(pl.pos));
  placeMarker($('mk-probe'), left[0]?.pos || pl.pos, G.playing && left.length > 0);
  placeMarker($('mk-home'), new THREE.Vector3(HOME.x, HOME.y + 3, HOME.z), G.playing && G.missionDone);
}

/* ---------------- 알림 UI ---------------- */
let toastTimer, radioTimer;
function toast(msg, tone = '') {
  const t = $('toast'); t.textContent = msg; t.className = 'panel show';
  t.style.color = tone === 'red' ? '#ffb3ba' : tone === 'gold' ? '#ffe7a6' : '#e8f6fb';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function radio(msg, ms = 6000) {
  $('radio-text').textContent = msg; $('radio').classList.add('show'); SFX.blip();
  clearTimeout(radioTimer); radioTimer = setTimeout(() => $('radio').classList.remove('show'), ms);
}
function floatText(txt, wp, color) {
  const v = wp.clone().project(camera); if (v.z > 1) return;
  const el = document.createElement('div'); el.className = 'fx'; el.textContent = txt; if (color) el.style.color = color;
  el.style.left = ((v.x + 1) / 2 * innerWidth) + 'px'; el.style.top = ((1 - v.y) / 2 * innerHeight) + 'px';
  $('hud').appendChild(el);
  requestAnimationFrame(() => { el.style.transform = 'translateY(-50px)'; el.style.opacity = '0'; });
  setTimeout(() => el.remove(), 1000);
}
function flash(color = '#fff', ms = 500) {
  const f = $('flash'); f.style.transition = 'none'; f.style.background = color; f.style.opacity = 1;
  void f.offsetWidth; // 스타일 즉시 반영
  setTimeout(() => { f.style.transition = `opacity ${ms}ms`; f.style.opacity = 0; }, 30);
}
async function banner(a, b, c) {
  $('bn-a').textContent = a; $('bn-b').textContent = b; $('bn-c').textContent = c;
  $('banner').classList.add('show'); await sleep(3200); $('banner').classList.remove('show');
}

/* ---------------- 대화 시스템 ---------------- */
let dlgQ = [], dlgDone = null, typing = null;
function say(lines) {
  return new Promise(res => {
    dlgQ = lines.slice(); dlgDone = res; $('dialog').classList.remove('hidden'); $('hud').classList.add('dim'); nextLine();
  });
}
function nextLine() {
  if (typing) { clearInterval(typing.id); $('dlg-text').textContent = typing.text; typing = null; return; }
  while (dlgQ.length && typeof dlgQ[0] === 'function') dlgQ.shift()();
  if (!dlgQ.length) { $('dialog').classList.add('hidden'); $('hud').classList.remove('dim'); const d = dlgDone; dlgDone = null; d && d(); return; }
  const l = dlgQ.shift(), d = $('dialog');
  d.className = 'panel ' + (l.who === '나' ? 'me' : l.who === '시스템' ? 'sys' : '');
  $('dlg-who').textContent = l.who === '나' ? `${G.name} 박사` : l.who;
  const text = l.text.replaceAll('{name}', G.name); let i = 0;
  $('dlg-text').textContent = '';
  typing = { text, id: setInterval(() => { i += 1; $('dlg-text').textContent = text.slice(0, i); if (i % 3 === 0) SFX.blip(); if (i >= text.length) { clearInterval(typing.id); typing = null; } }, 24) };
  if (l.fx) l.fx();
}
$('dialog').addEventListener('click', nextLine);

/* =========================================================
   빅데이터 분석실
   ========================================================= */
const an = { ds: 'obs', x: 'nut', y: 'food', n: 0, clean: false, qi: 0, seed: [] };
function datasetRows() {
  let r = an.ds === 'series' ? series : rows;
  if (an.clean) r = r.filter(o => !o.outlier);
  return r;
}
function fillSelect(sel, list, val) { sel.innerHTML = list.map(k => `<option value="${k}" ${k === val ? 'selected' : ''}>${VARS[k][0]}${VARS[k][1] ? ' (' + VARS[k][1] + ')' : ''}</option>`).join(''); }
function regress(xs, ys) {
  const n = xs.length; if (n < 2) return { a: 0, b: 0, r: 0 };
  let sx = 0, sy = 0; for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n; let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  const b = sxx ? sxy / sxx : 0; return { a: my - b * mx, b, r: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0 };
}
function drawPlot() {
  const cv = $('an-plot'), dpr = Math.min(2, devicePixelRatio), W = cv.clientWidth, H = cv.clientHeight;
  cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr);
  const all = datasetRows();
  const nMax = all.length; const slider = $('an-n'); slider.max = Math.max(5, nMax);
  if (!an.n || an.n > nMax) an.n = nMax; slider.value = an.n; $('an-nv').textContent = fmt(an.n) + ' / ' + fmt(nMax);
  // 일정한 무작위 표본(슬라이더를 움직여도 같은 순서)
  if (an.seed.length !== nMax) an.seed = all.map((_, i) => i).sort(() => Math.random() - 0.5);
  const pick = an.seed.slice(0, an.n).map(i => all[i]);
  const xs = pick.map(r => r[an.x]), ys = pick.map(r => r[an.y]);
  const L = 58, R = 18, T = 18, B = 46, pw = W - L - R, ph = H - T - B;
  let x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const reg = regress(xs, ys);
  const pred = eraIdx === 2 && an.ds === 'series' && an.y === 'avgO2' && an.x === 't' && reg.b < 0;
  if (pred) { const tc = (2 - reg.a) / reg.b; x1 = Math.max(x1, tc * 1.08); y0 = Math.min(y0, 1.5); }
  if (!isFinite(x0)) { x0 = 0; x1 = 1; y0 = 0; y1 = 1; }
  if (x1 - x0 < 1e-6) { x0 -= 1; x1 += 1; } if (y1 - y0 < 1e-6) { y0 -= 1; y1 += 1; }
  const px = (x1 - x0) * 0.04, py = (y1 - y0) * 0.06; x0 -= px; x1 += px; y0 -= py; y1 += py;
  const X = v => L + (v - x0) / (x1 - x0) * pw, Y = v => T + ph - (v - y0) / (y1 - y0) * ph;
  g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.fillStyle = '#8fb3c2'; g.font = '11px "JetBrains Mono"'; g.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const xv = x0 + (x1 - x0) * i / 5, yv = y0 + (y1 - y0) * i / 5;
    g.beginPath(); g.moveTo(X(xv), T); g.lineTo(X(xv), T + ph); g.stroke();
    g.beginPath(); g.moveTo(L, Y(yv)); g.lineTo(L + pw, Y(yv)); g.stroke();
    g.textAlign = 'center'; g.fillText(niceNum(xv), X(xv), T + ph + 16);
    g.textAlign = 'right'; g.fillText(niceNum(yv), L - 6, Y(yv) + 4);
  }
  g.font = '600 13px "Noto Sans KR"'; g.fillStyle = '#e8f6fb'; g.textAlign = 'center';
  g.fillText(`${VARS[an.x][0]} ${VARS[an.x][1] ? '(' + VARS[an.x][1] + ')' : ''}`, L + pw / 2, H - 8);
  g.save(); g.translate(14, T + ph / 2); g.rotate(-Math.PI / 2); g.fillText(`${VARS[an.y][0]} ${VARS[an.y][1] ? '(' + VARS[an.y][1] + ')' : ''}`, 0, 0); g.restore();
  // 점
  const rad = an.n > 800 ? 2 : an.n > 200 ? 2.6 : 3.4;
  pick.forEach(r => {
    g.fillStyle = r.outlier ? 'rgba(255,79,94,0.95)' : (an.ds === 'series' ? 'rgba(255,214,107,0.9)' : 'rgba(95,242,255,0.55)');
    g.beginPath(); g.arc(X(r[an.x]), Y(r[an.y]), r.outlier ? 4 : rad, 0, 7); g.fill();
  });
  // 추세선
  if (pick.length > 2) {
    g.strokeStyle = '#ffd66b'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(X(x0), Y(reg.a + reg.b * x0)); g.lineTo(X(x1), Y(reg.a + reg.b * x1)); g.stroke();
  }
  if (pred) {
    g.setLineDash([6, 5]); g.strokeStyle = '#ff4f5e'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(L, Y(2)); g.lineTo(L + pw, Y(2)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ff8a95'; g.textAlign = 'left'; g.font = '12px "Noto Sans KR"'; g.fillText('삼엽충 생존 한계 2 mg/L', L + 8, Y(2) - 6);
    const tc = (2 - reg.a) / reg.b; g.fillStyle = '#ff4f5e'; g.beginPath(); g.arc(X(tc), Y(2), 6, 0, 7); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.moveTo(X(eraT), T); g.lineTo(X(eraT), T + ph); g.stroke();
    g.fillStyle = '#fff'; g.fillText('지금', X(eraT) + 4, T + 12);
  }
  const ar = Math.abs(reg.r), strength = ar > 0.7 ? '강한' : ar > 0.4 ? '뚜렷한' : ar > 0.2 ? '약한' : '거의 없는';
  const sign = ar <= 0.2 ? '' : reg.r > 0 ? '양(+)의 ' : '음(−)의 ';
  $('an-stats').innerHTML = `데이터 <b>${fmt(an.n)}개</b> 사용 · 상관계수 <b>r = ${reg.r.toFixed(2)}</b> → ${strength} ${sign}상관관계` +
    (an.n < 30 ? '<br><span style="color:#ffb547">데이터가 적으면 추세선이 크게 흔들려요. 슬라이더를 오른쪽으로 끝까지 밀어 보세요!</span>' : '') +
    (pick.some(r => r.outlier) ? '<br><span style="color:#ff8a95">빨간 점은 고장 난 부표의 이상값이에요. 검증하지 않으면 분석이 틀어져요.</span>' : '');
}
function niceNum(v) { const a = Math.abs(v); return a >= 1000 ? fmt(v) : a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2); }

function renderLand() {
  const n = eraIdx; const cols = LAND.cols;
  let h = '<table class="land"><tr><th></th>' + cols.map((c, i) => `<th style="${i === n ? 'color:var(--cyan)' : ''}">${c}</th>`).join('') + '</tr>';
  for (const row of LAND.rows) {
    h += `<tr><td>${row[0]}</td>` + row.slice(1).map((v, i) => i === 3 || i <= n ? `<td>${v}</td>` : '<td class="lock">?</td>').join('') + '</tr>';
  }
  h += '</table><div class="note">수치는 지질 기록을 바탕으로 한 대략적 추정치예요.</div>';
  $('an-land').innerHTML = h;
}
function renderFrag() {
  $('an-frag').innerHTML = frags.map((f, i) => `<span class="${gotFrag[i] ? 'got' : ''}">${gotFrag[i] ? f : '????'.slice(0, f.length)}</span>`).join('<b>.</b>');
}
function permianQuestion() {
  const reg = regress(series.map(s => s.t), series.map(s => s.avgO2));
  let k = reg.b < 0 ? Math.round((2 - reg.a) / reg.b - eraT) : 6; k = Math.max(1, k);
  const opts = [...new Set([k, k + 4, k + 9, Math.max(1, k - 3) === k ? k + 14 : Math.max(1, k - 3)])].sort(() => Math.random() - 0.5);
  return {
    q: '시계열 데이터의 추세선으로 예측하면, 해역 평균 용존 산소가 삼엽충 생존 한계(2 mg/L) 아래로 떨어지는 때는 지금부터 약 몇 분 뒤일까?',
    opts: opts.map(v => `약 ${v}분 뒤`), a: opts.indexOf(k),
    ok: `정답! 추세선(노란 선)이 빨간 점선과 만나는 지점이 약 ${k}분 뒤예요. 데이터의 추세로 미래를 예측한 거예요. 그 전에 탈출하면 돼요!`,
    no: '데이터셋은 “해역 평균(시계열)”, X축은 경과 시간, Y축은 해역 평균 용존 산소로 두고, 노란 추세선이 빨간 점선과 만나는 곳을 찾아보세요.',
  };
}
function renderQuestion() {
  const qs = era.questions, q = qs[an.qi];
  $('an-qh').textContent = `예측 미션 ${an.qi + 1} / ${qs.length}`;
  $('an-q').innerHTML = `<div class="q">${q.q}</div><div class="opts">${q.opts.map((o, i) => `<button class="opt" data-i="${i}">${'①②③④'[i]} ${o}</button>`).join('')}</div><div id="an-fb"></div>`;
  $('an-q').querySelectorAll('.opt').forEach(b => b.onclick = () => {
    const i = +b.dataset.i;
    if (i === q.a) {
      b.classList.add('right'); SFX.ok(); $('an-q').querySelectorAll('.opt').forEach(x => x.disabled = true);
      $('an-fb').innerHTML = `<div class="fb ok">${q.ok}</div>`;
      if (an.qi < qs.length - 1) { setTimeout(() => { an.qi++; renderQuestion(); }, 2600); }
      else { gotFrag[eraIdx] = true; renderFrag(); $('an-next').classList.remove('hidden'); $('an-next').textContent = eraIdx < 2 ? '좌표 조각 획득! 다음 시대로 점프 ▶' : '귀환 좌표 완성! 2026년으로 귀환 ▶'; SFX.level(); setTimeout(() => $('an-next').scrollIntoView({ behavior: 'smooth', block: 'end' }), 400); }
    } else { b.classList.add('wrong'); SFX.no(); $('an-fb').innerHTML = `<div class="fb no">다시 생각해 봐요. 힌트: ${q.no}</div>`; }
  });
}
function openAnalysis() {
  G.playing = false; G.mode = 'analysis';
  if (eraIdx === 2) era.questions[0] = permianQuestion();
  an.ds = eraIdx === 2 ? 'series' : 'obs'; [an.x, an.y] = era.axes; an.n = 0; an.clean = false; an.qi = 0; an.seed = [];
  $('an-era').textContent = `${era.name} · ${era.ago} · 수집 데이터 ${fmt(rows.length)}행`;
  $('an-ds').innerHTML = `<option value="obs">내 센서 + 부표 관측 (${fmt(rows.length)}행)</option><option value="series">해역 평균 (시계열 ${series.length}행)</option>`;
  $('an-ds').value = an.ds;
  const vars = () => an.ds === 'series' ? SER_VARS : OBS_VARS;
  fillSelect($('an-x'), vars(), an.x); fillSelect($('an-y'), vars(), an.y);
  $('an-clean').checked = false; $('an-cleanbox').classList.toggle('hidden', !rows.some(r => r.outlier));
  $('an-next').classList.add('hidden');
  renderLand(); renderFrag(); renderQuestion();
  $('analysis').classList.remove('hidden'); $('hud').classList.add('dim');
  requestAnimationFrame(drawPlot);
  $('an-ds').onchange = e => { an.ds = e.target.value; const v = vars(); an.x = v.includes(an.x) ? an.x : v[0]; an.y = v.includes(an.y) ? an.y : v[1]; fillSelect($('an-x'), v, an.x); fillSelect($('an-y'), v, an.y); an.n = 0; an.seed = []; drawPlot(); };
  $('an-x').onchange = e => { an.x = e.target.value; drawPlot(); };
  $('an-y').onchange = e => { an.y = e.target.value; drawPlot(); };
  $('an-n').oninput = e => { an.n = +e.target.value; drawPlot(); };
  $('an-clean').onchange = e => { an.clean = e.target.checked; an.n = 0; an.seed = []; drawPlot(); };
}
addEventListener('resize', () => { if (!$('analysis').classList.contains('hidden')) drawPlot(); });
$('an-next').onclick = async () => {
  $('analysis').classList.add('hidden'); $('hud').classList.remove('dim');
  if (eraIdx < 2) { await doWarp(ERAS[eraIdx + 1].jump, 'TEMPORAL JUMP · 좌표 재계산', 0x5ff2ff); startEra(eraIdx + 1); }
  else { await doWarp('+252,000,000', 'RETURN · 귀환 좌표 ' + frags.join('.'), 0xffd66b); returnToLab(); }
};

/* =========================================================
   게임 흐름
   ========================================================= */
const G = { mode: 'title', playing: false, t: 0, name: 'K', missionDone: false };
let active = lab.scene;
window.G = G; window.DBG = { lab, ocean, pl, camera, THREE, renderer, setActive: s => { active = s; } }; // 디버그용

async function doWarp(big, small, col) {
  G.mode = 'warp'; G.playing = false; active = warp.scene; warp.t = 0; warp.col.set(col);
  $('hud').classList.add('hidden'); $('warptxt').classList.remove('hidden'); $('wp-a').textContent = small;
  SFX.warp();
  const t0 = performance.now();
  while (performance.now() - t0 < warp.dur * 1000) {
    const k = (performance.now() - t0) / (warp.dur * 1000);
    const digits = big.replace(/\d/g, () => (k > 0.75 ? null : Math.floor(Math.random() * 10)) ?? '');
    $('wp-b').textContent = k > 0.75 ? big : digits;
    await sleep(50);
  }
  $('wp-b').textContent = big;
  flash('#fff', 900); await sleep(150);
  $('warptxt').classList.add('hidden');
  camera.fov = 62; camera.updateProjectionMatrix(); camera.rotation.set(0, 0, 0);
}

async function startEra(i) {
  setupEra(i); G.mode = 'ocean'; active = sea; G.playing = false; G.warned = false;
  $('hud').classList.remove('hidden'); mapVar = i === 1 ? 4 : 0; drawMinimap(true);
  // 도착 장면: 카메라를 미리 플레이어 뒤로
  for (let k = 0; k < 40; k++) updateCamera(0.05);
  G.e = env(pl.pos.x, pl.pos.y, pl.pos.z, era, 0); updateHUD();
  banner(era.jump + ' YEARS', era.name, era.sub);
  await sleep(1800);
  const howto = IS_TOUCH
    ? '조작법\n· 화면을 누르고 끌기: 그 방향으로 헤엄\n· 노란 버튼(누르고 있기): 돌진   · 파란 버튼: 몸 말기 방어   · 왼쪽 지도 탭: 데이터 변수 바꾸기'
    : '조작법\n· 마우스가 가리키는 방향으로 헤엄 (WASD·방향키도 가능)\n· 클릭/스페이스: 돌진   · 오른쪽 클릭/E: 몸 말기 방어   · M: 데이터 지도 변수 바꾸기';
  await say(era.intro.concat(i === 0 ? [{ who: '시스템', text: howto }] : []));
  G.playing = true;
  if (i === 0) setTimeout(() => radio(IS_TOUCH ? '왼쪽 “데이터 지도”를 보세요. 박사님이 지나간 곳의 데이터가 색으로 쌓여요. 지도를 탭하면 변수가 바뀌어요!' : '오른쪽 아래 “데이터 지도”를 보세요. 박사님이 지나간 곳의 데이터가 색으로 쌓여요. M 키로 변수를 바꿀 수 있어요!', 7000), 12000);
}

async function labIntro() {
  G.mode = 'lab'; active = lab.scene; startLabCamera(false); lab.power = 0; lab.alarm = false;
  const d = `${TODAY.getFullYear()}년 ${TODAY.getMonth() + 1}월 ${TODAY.getDate()}일`;
  await sleep(600);
  await say([
    { who: '시스템', text: `${d} · 크로노스 연구소 지하 3층\n타임머신 “크로노스-7” 첫 시험 가동` },
    { who: 'ARIA', text: '좋은 아침이에요, {name} 박사님. 오늘은 드디어 크로노스-7의 첫 시험 가동 날이에요.' },
    { who: '나', text: 'ARIA, 목표 좌표는?' },
    { who: 'ARIA', text: '딱 1시간 전, 바로 이 연구소예요. 박사님이 3년 동안 모은 시공간 빅데이터로 계산한 좌표죠.' },
    { who: '나', text: '좋아. 크로노스-7, 가동 시작!', fx: () => { lab.powerOn = true; } },
    { who: 'ARIA', text: '에너지 충전 87%… 93%… 시간 좌표 고정 중…' },
    { who: 'ARIA', text: '잠깐만요! 좌표 데이터에 이상한 값이 섞여 있어요! 검증되지 않은 데이터가… 경고! 경고!', fx: () => { lab.alarm = true; G.alarmId = setInterval(SFX.alarm, 520); $('alarm').classList.add('on'); } },
    { who: '시스템', text: 'TEMPORAL COORDINATE ERROR\n▶ TARGET: −510,000,000 YEARS' },
    { who: '나', text: '뭐라고?! 5억 년 전이라고?! ARIA, 멈춰—!' },
  ]);
  clearInterval(G.alarmId); $('alarm').classList.remove('on');
  flash('#fff', 1200); await sleep(200);
  await doWarp(ERAS[0].jump, 'TEMPORAL COORDINATE ERROR', 0xff6b8a);
  startEra(0);
}

async function returnToLab() {
  G.mode = 'lab'; active = lab.scene; lab.alarm = false; lab.power = 1; startLabCamera(true);
  $('hud').classList.add('hidden');
  await sleep(800);
  await say([
    { who: '시스템', text: `귀환 좌표 ${frags.join('.')} · 크로노스 연구소` },
    { who: 'ARIA', text: '귀환 성공! 박사님, 원래 몸으로 돌아오셨어요!' },
    { who: '나', text: '삼엽충으로 살아 본 건 평생 못 잊을 거야… 그리고 이 데이터들도.' },
    { who: 'ARIA', text: `우리가 모은 데이터는 모두 ${fmt(stats.rows)}행이에요. 사람이 표로 하나하나 보기 힘든 양이죠. 이게 바로 빅데이터예요.` },
    { who: 'ARIA', text: '그리고 페름기 말 데이터는 지금 우리에게도 경고예요. CO₂가 급증하자 바다가 뜨거워지고 산소가 사라졌죠. 오늘날 기후 변화 예측에도 이런 데이터가 쓰여요.' },
    { who: 'ARIA', text: '그런데 박사님… 방금 타임머신이 이상한 신호를 받았어요. 미래에서 온 구조 요청이에요.', fx: () => { lab.alarm = true; } },
    { who: '시스템', text: 'INCOMING SIGNAL ▶ FUTURE\n“…도와주세요… 바이러스가… 유전체 데이터가…”' },
    { who: '나', text: '다음 목적지가 정해진 것 같군.' },
  ]);
  lab.alarm = false;
  showEnding();
}

function showEnding() {
  const mins = Math.round((performance.now() - stats.start) / 60000);
  $('end-stats').innerHTML = [[fmt(stats.rows), '수집한 데이터(행)'], [stats.probes, '회수한 관측 부표'], [stats.eaten, '먹은 먹이'], [stats.deaths, '긴급 소환 횟수'], [mins + '분', '탐사 시간']]
    .map(([b, s]) => `<div><b>${b}</b><span>${s}</span></div>`).join('');
  $('ending').classList.remove('hidden');
}

/* ---------------- 메인 루프 ---------------- */
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const raw = (now - last) / 1000; last = now;
  adaptResolution(raw);
  frame(Math.min(0.05, raw));
}
DBG.step = (n = 1, dt = 1 / 30) => { for (let i = 0; i < n; i++) frame(dt); };
function frame(dt) {
  G.t += dt;
  $('touchui').classList.toggle('hidden', !(IS_TOUCH && G.mode === 'ocean' && G.playing));
  if (G.mode === 'lab' || G.mode === 'title') { if (lab.powerOn) lab.power = Math.min(1, lab.power + dt * 0.5); updateLab(dt); }
  else if (G.mode === 'warp') updateWarp(dt);
  else if (G.mode === 'ocean' || G.mode === 'analysis') updateOcean(dt);
  renderer.render(active, camera);
}

/* ---------------- 시작 ---------------- */
$('creditbtn').onclick = $('end-credit').onclick = () => $('credits').classList.remove('hidden');
$('credit-close').onclick = () => $('credits').classList.add('hidden');
$('end-restart').onclick = () => location.reload();

(async () => {
  try { await loadAssets(); }
  catch (e) { $('loadtxt').textContent = '모델을 불러오지 못했어요. 로컬 서버(http://)로 열었는지 확인해 주세요.'; console.error(e); return; }
  buildLab(); buildOcean();
  startLabCamera(false);
  // 셰이더 미리 컴파일 (첫 장면 전환 끊김 방지)
  renderer.compile(sea, camera); renderer.compile(lab.scene, camera);
  $('loading').classList.add('hidden'); $('startbox').classList.remove('hidden');
  $('screen').style.background = 'radial-gradient(ellipse at 50% 30%,rgba(2,7,11,.35),rgba(2,7,11,.92) 70%)';
  requestAnimationFrame(loop);
  const go = async () => {
    G.name = $('pname').value.trim() || 'K';
    $('screen').classList.add('hidden'); stats.start = performance.now();
    // 패드: 소리 잠금 해제(iPad는 터치 순간에만 가능), 전체 화면, 화면 꺼짐 방지
    tone(1, 0.01, 'sine', 0.0001); try { actx && actx.resume(); } catch (_) { }
    if (IS_TOUCH) {
      const de = document.documentElement;
      try { (de.requestFullscreen || de.webkitRequestFullscreen)?.call(de)?.catch?.(() => { }); } catch (_) { }
      try { screen.orientation?.lock?.('landscape').catch(() => { }); } catch (_) { }
    }
    const wake = async () => { try { await navigator.wakeLock?.request('screen'); } catch (_) { } };
    wake(); document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') wake(); });
    const e = +P.get('era');
    if (e >= 1 && e <= 3) { await doWarp(ERAS[e - 1].jump, 'TEACHER MODE', 0x5ff2ff); startEra(e - 1); }
    else if (P.has('skip')) { await doWarp(ERAS[0].jump, 'TEMPORAL COORDINATE ERROR', 0xff6b8a); startEra(0); }
    else labIntro();
  };
  $('startbtn').onclick = go;
  $('pname').addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
})();
