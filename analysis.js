/* =========================================================
   빅데이터 분석실 — 단계별 안내형
   ① 내가 모은 빅데이터(3V)  ② 시대별 그래프 1개 + 안내 질문  ③ 드론 대기 기록  ④ 귀환 좌표 조각
   ========================================================= */
import { ATMOS } from './content.js';

const $ = id => document.getElementById(id);
const fmt = n => Math.round(n).toLocaleString('ko-KR');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

let A = null; // 현재 분석 상태

export function openAnalysis(ctx) {
  A = { ...ctx, step: 0 };
  $('an-era').textContent = `${ctx.era.name} · ${ctx.era.ago}`;
  $('analysis').classList.remove('hidden');
  render();
}

const STEP_NAMES = ['① 내가 모은 빅데이터', '② 데이터로 규칙 찾기', '③ 드론 대기 관측', '④ 귀환 좌표'];
function render() {
  $('an-steps').innerHTML = STEP_NAMES.map((s, i) => `<span class="${i === A.step ? 'on' : i < A.step ? 'done' : ''}">${s}</span>`).join('');
  $('an-next').classList.add('hidden'); $('an-next').disabled = false;
  [stepVolume, stepChart, stepDrone, stepFrag][A.step]();
  $('analysis').querySelector('.box').scrollTop = 0;
}
function showNext(label, fn) {
  const b = $('an-next'); b.textContent = label; b.classList.remove('hidden');
  b.onclick = () => { A.sfx('click'); fn ? fn() : (A.step++, render()); };
  setTimeout(() => b.scrollIntoView({ behavior: 'smooth', block: 'end' }), 300);
}

/* ---------- ① 빅데이터 3V ---------- */
function stepVolume() {
  const rows = A.rows.length, drone = A.droneRecords, readMin = (rows + drone) / 60;
  const readTxt = readMin > 60 * 24 ? `약 ${fmt(readMin / 60 / 24)}일` : readMin > 60 ? `약 ${fmt(readMin / 60)}시간` : `약 ${fmt(readMin)}분`;
  $('an-body').innerHTML = `
    <div class="lead">이번 시대에서 모은 데이터예요. 이 정도면 <b>사람이 표로 하나하나 보기 어려워요.</b> 그래서 빅데이터라고 불러요.</div>
    <div class="v3">
      <div class="vcard"><div class="vk">양 · Volume</div><div class="vbig mono" id="cnt-rows">0</div><div class="vs">행 (내 몸 센서 + 관측 부표)</div>
        <div class="vbig2 mono" id="cnt-drone">0</div><div class="vs">건 (드론 대기 관측)</div>
        <div class="vnote">1초에 1개씩 읽으면 <b>${readTxt}</b> 걸려요!</div></div>
      <div class="vcard"><div class="vk">다양성 · Variety</div>
        <div class="chips2">${['수심', '수온', '용존 산소', 'CO₂', 'pH', '영양염류', '먹이 밀도', '포식자 수', '암초 거리', '시간'].map(v => `<span>${v}</span>`).join('')}</div>
        <div class="vs" style="margin:8px 0 4px">드론이 모은 대기 데이터</div>
        <div class="chips2 sky">${['대기 산소', '대기 CO₂', '기온', '오존층', '육상 생물'].map(v => `<span>${v}</span>`).join('')}</div></div>
      <div class="vcard"><div class="vk">속도 · Velocity</div>
        <div class="vbig mono">0.5<small>초</small></div><div class="vs">마다 새 데이터 1행 (1분에 120행)</div>
        <div class="vbig2 mono">3,840<small>건/초</small></div><div class="vs">드론 12대 × 센서 32개 × 1초에 10번</div></div>
    </div>
    <div class="aiuse"><b>이 데이터로 AI가 한 일</b> · 예측 정확도 <b>${A.accuracy}%</b> · 먹이 위치 안내 <b>${A.aiStats.food}회</b> · 위험 경고 <b>${A.aiStats.danger}회</b>${A.aiStats.vent ? ` · 분출 예측 <b>${A.aiStats.vent}회</b>` : ''}</div>`;
  countUp($('cnt-rows'), rows); countUp($('cnt-drone'), drone);
  showNext('다음: 데이터로 규칙 찾기 ▶');
}
function countUp(el, to) {
  const t0 = performance.now();
  const tick = () => { const k = Math.min(1, (performance.now() - t0) / 1400); el.textContent = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); };
  tick();
}

/* ---------- ② 시대별 그래프 ---------- */
function stepChart() {
  const an = A.era.analysis;
  $('an-body').innerHTML = `
    <div class="an-grid">
      <div><div class="ctitle">${an.title}</div><div id="chartbox"></div></div>
      <div><div class="guide"><b>이렇게 보세요</b><ol>${an.guide.map(g => `<li>${g}</li>`).join('')}</ol></div><div id="qbox"></div></div>
    </div>`;
  ({ mapPair, bars, lines })[an.chart]();
  const qs = an.questions.map(q => q.dynamic ? DYN[q.dynamic]() : q);
  questions($('qbox'), qs, () => showNext('다음: 드론 대기 관측 ▶'));
}

// 캄브리아기: 영양염류 지도 vs 먹이 지도 (데이터 양 슬라이더 + 고장 부표 빼기)
function mapPair() {
  const all = A.rows.slice().sort(() => Math.random() - 0.5);
  const hasOut = all.some(r => r.outlier);
  $('chartbox').innerHTML = `
    <div class="maps"><div><canvas id="mapA"></canvas><div class="mlab">영양염류</div></div><div><canvas id="mapB"></canvas><div class="mlab">먹이(플랑크톤)</div></div></div>
    <div class="legend2"><span>적음</span><i></i><span>많음</span><span class="dim">· 검은 칸 = 데이터 없음</span></div>
    <div class="slider">사용할 데이터 <input type="range" id="mp-n" min="0" max="100" value="100"><b id="mp-nv" class="mono"></b></div>
    ${hasOut ? '<label class="check"><input type="checkbox" id="mp-clean"> 데이터 검증: 고장 난 부표의 이상한 값 빼기</label>' : ''}`;
  const draw = () => {
    const k = +$('mp-n').value / 100, n = Math.max(30, Math.round(30 * Math.pow(all.length / 30, k)));
    let sub = all.slice(0, n); if ($('mp-clean')?.checked) sub = sub.filter(r => !r.outlier);
    $('mp-nv').textContent = `${fmt(sub.length)}개`;
    heat($('mapA'), sub, 'nut', 0, 16); heat($('mapB'), sub, 'food', 0, 10);
  };
  $('mp-n').oninput = draw; if ($('mp-clean')) $('mp-clean').onchange = draw;
  draw(); A.redraw = draw;
}
function heat(cv, rows, key, lo, hi) {
  const g = sizeCanvas(cv, 1), W = cv.clientWidth, N = 24, cs = W / N, WD = A.WORLD;
  const sum = new Float32Array(N * N), cnt = new Float32Array(N * N);
  for (const r of rows) { const i = clamp(Math.floor((r.x + WD) / (2 * WD) * N), 0, N - 1), j = clamp(Math.floor((r.z + WD) / (2 * WD) * N), 0, N - 1); sum[j * N + i] += r[key]; cnt[j * N + i]++; }
  g.fillStyle = '#02080c'; g.fillRect(0, 0, W, W);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const c = cnt[j * N + i]; if (!c) continue; g.fillStyle = ramp((sum[j * N + i] / c - lo) / (hi - lo)); g.fillRect(i * cs, j * cs, cs + 0.6, cs + 0.6); }
  g.strokeStyle = 'rgba(255,255,255,.18)'; g.lineWidth = 1;
  for (const [x, z, r] of A.REEFS) { g.beginPath(); g.arc((x + WD) / (2 * WD) * W, (z + WD) / (2 * WD) * W, r / (2 * WD) * W, 0, 7); g.stroke(); }
}

// 데본기: 암초 거리 구간별 평균 포식자 수 (막대그래프)
const BINS = [[0, 10, '암초 0~10m'], [10, 25, '10~25m'], [25, 45, '25~45m'], [45, 999, '45m 이상 (먼바다)']];
function binStats() {
  return BINS.map(([a, b, label]) => {
    const rs = A.rows.filter(r => r.reef >= a && r.reef < b);
    const atk = A.attacks.filter(p => p.reef >= a && p.reef < b).length;
    return { label, n: rs.length, avg: rs.length ? rs.reduce((s, r) => s + r.pred, 0) / rs.length : 0, atk };
  });
}
function bars() {
  $('chartbox').innerHTML = '<canvas id="barcv"></canvas><div class="note">데이터 개수가 많을수록 그 막대를 더 믿을 수 있어요.</div>';
  const cv = $('barcv'), draw = () => {
    const st = binStats(), g = sizeCanvas(cv, 0.68), W = cv.clientWidth, H = W * 0.68, L = 46, B = 64, T = 26;
    const mx = Math.max(0.5, ...st.map(s => s.avg)) * 1.2, bw = (W - L - 20) / st.length;
    g.fillStyle = '#8fb3c2'; g.font = '12px "Noto Sans KR"'; g.textAlign = 'right';
    for (let i = 0; i <= 4; i++) { const v = mx * i / 4, y = T + (H - T - B) * (1 - i / 4); g.fillText(v.toFixed(1), L - 6, y + 4); g.strokeStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.moveTo(L, y); g.lineTo(W - 10, y); g.stroke(); }
    st.forEach((s, i) => {
      const x = L + i * bw + bw * 0.15, w = bw * 0.7, h = (H - T - B) * s.avg / mx, y = H - B - h;
      const grd = g.createLinearGradient(0, y, 0, H - B); grd.addColorStop(0, '#ff7b6b'); grd.addColorStop(1, '#ffb547');
      g.fillStyle = grd; g.fillRect(x, y, w, h);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = '700 15px "JetBrains Mono"'; g.fillText(s.avg.toFixed(2) + '마리', x + w / 2, y - 6);
      g.font = '600 12.5px "Noto Sans KR"'; g.fillStyle = '#e8f6fb'; g.fillText(s.label, x + w / 2, H - B + 18);
      g.fillStyle = '#8fb3c2'; g.font = '11px "Noto Sans KR"'; g.fillText(`데이터 ${fmt(s.n)}개`, x + w / 2, H - B + 34);
    });
    g.save(); g.translate(14, T + (H - T - B) / 2); g.rotate(-Math.PI / 2); g.fillStyle = '#e8f6fb'; g.textAlign = 'center'; g.font = '600 12px "Noto Sans KR"'; g.fillText('평균 포식자 수', 0, 0); g.restore();
  };
  draw(); A.redraw = draw;
}

// 페름기: 수온·산소·CO₂ 시계열 + 추세 예측선
function regress(xs, ys) {
  const n = xs.length; if (n < 2) return { a: ys[0] || 0, b: 0 };
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n; let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxx ? sxy / sxx : 0; return { a: my - b * mx, b };
}
function lines() {
  $('chartbox').innerHTML = '<canvas id="ln1"></canvas><canvas id="ln2"></canvas><canvas id="ln3"></canvas>';
  const draw = () => {
    const S = A.series, ts = S.map(s => s.t), tEnd = Math.max(A.eraT * 2.4, 6);
    line($('ln1'), S, 'avgT', '해역 평균 수온 (℃)', '#ff8a5b', tEnd);
    line($('ln2'), S, 'avgO2', '해역 평균 용존 산소 (mg/L)', '#5ff2ff', tEnd, 2, '삼엽충 생존 한계 2 mg/L');
    line($('ln3'), S, 'co2', 'CO₂ (ppm)', '#c9a6ff', tEnd);
  };
  draw(); A.redraw = draw;
}
function line(cv, S, key, title, col, tEnd, thr, thrLabel) {
  const g = sizeCanvas(cv, 0.3), W = cv.clientWidth, H = W * 0.3, L = 52, R = 12, T = 22, B = 22;
  const xs = S.map(s => s.t), ys = S.map(s => s[key]), reg = regress(xs, ys);
  let y0 = Math.min(...ys, reg.a + reg.b * tEnd), y1 = Math.max(...ys, reg.a + reg.b * tEnd); if (thr !== undefined) y0 = Math.min(y0, thr - 0.3);
  const p = (y1 - y0) * 0.12 || 1; y0 -= p; y1 += p;
  const X = t => L + t / tEnd * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  g.fillStyle = '#e8f6fb'; g.font = '700 12.5px "Noto Sans KR"'; g.textAlign = 'left'; g.fillText(title, L, 14);
  g.fillStyle = '#8fb3c2'; g.font = '11px "JetBrains Mono"'; g.textAlign = 'right';
  [y0 + p, (y0 + y1) / 2, y1 - p].forEach(v => { g.fillText(v >= 100 ? fmt(v) : v.toFixed(1), L - 6, Y(v) + 4); g.strokeStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.moveTo(L, Y(v)); g.lineTo(W - R, Y(v)); g.stroke(); });
  g.textAlign = 'center'; for (let t = 0; t <= tEnd; t += Math.ceil(tEnd / 6)) g.fillText(t + '분', X(t), H - 6);
  if (thr !== undefined) { g.setLineDash([5, 4]); g.strokeStyle = '#ff4f5e'; g.beginPath(); g.moveTo(L, Y(thr)); g.lineTo(W - R, Y(thr)); g.stroke(); g.setLineDash([]); g.fillStyle = '#ff8a95'; g.textAlign = 'left'; g.font = '11px "Noto Sans KR"'; g.fillText(thrLabel, L + 6, Y(thr) - 5); }
  g.strokeStyle = col; g.lineWidth = 2.5; g.beginPath(); S.forEach((s, i) => { const x = X(s.t), y = Y(s[key]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  const tn = A.eraT; g.setLineDash([6, 5]); g.globalAlpha = 0.8; g.beginPath(); g.moveTo(X(tn), Y(reg.a + reg.b * tn)); g.lineTo(X(tEnd), Y(reg.a + reg.b * tEnd)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
  g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 1; g.beginPath(); g.moveTo(X(tn), T); g.lineTo(X(tn), H - B); g.stroke();
  g.fillStyle = '#fff'; g.font = '11px "Noto Sans KR"'; g.textAlign = 'left'; g.fillText('지금', X(tn) + 4, T + 10);
  if (thr !== undefined && reg.b < 0) { const tc = (thr - reg.a) / reg.b; if (tc < tEnd) { g.fillStyle = '#ff4f5e'; g.beginPath(); g.arc(X(tc), Y(thr), 6, 0, 7); g.fill(); } }
}

const DYN = {
  safestBin() {
    const st = binStats().filter(s => s.n > 0), best = st.reduce((a, b) => (a.avg <= b.avg ? a : b), st[0]), worst = st.reduce((a, b) => (a.avg >= b.avg ? a : b), st[0]);
    return {
      q: '그래프를 보면, 포식자를 <b>가장 적게</b> 만난 구간은?', opts: BINS.map(b => b[2]), a: BINS.findIndex(b => b[2] === best.label),
      ok: `정답! “${best.label}”에서는 평균 ${best.avg.toFixed(2)}마리, “${worst.label}”에서는 ${worst.avg.toFixed(2)}마리를 만났어요. 암초에서 멀어질수록 위험해져요.`,
      no: '막대가 가장 낮은 구간을 찾아보세요.',
    };
  },
  o2Cross() {
    const reg = regress(A.series.map(s => s.t), A.series.map(s => s.avgO2));
    let k = reg.b < 0 ? Math.round((2 - reg.a) / reg.b - A.eraT) : 6; k = Math.max(1, k);
    const opts = [...new Set([k, k + 4, k + 9, k > 3 ? k - 3 : k + 14])].sort(() => Math.random() - 0.5);
    return {
      q: '산소 그래프의 <b>점선(예측)</b>이 빨간 생존 한계선과 만나는 때는 지금부터 약 몇 분 뒤일까요?', opts: opts.map(v => `약 ${v}분 뒤`), a: opts.indexOf(k),
      ok: `정답! 약 ${k}분 뒤예요. 지금까지의 데이터 추세로 미래를 예측한 거예요. 그 전에 탈출해요!`, no: '산소 그래프에서 빨간 점이 찍힌 곳의 시간에서 “지금” 시간을 빼 보세요.',
    };
  },
};

/* ---------- ③ 드론 대기 관측 (지질 시대 타임라인) ---------- */
function stepDrone() {
  $('an-body').innerHTML = `
    <div class="an-grid">
      <div><div class="ctitle">드론·위성 대기 관측 기록 · 지구 대기 5억 년</div><canvas id="tl"></canvas>
        <div class="legend3"><span style="color:#ffb547">━ 대기 CO₂ (ppm)</span><span style="color:#5ff2ff">━ 대기 산소 (%)</span><span class="dim">수치는 지질 기록 기반 추정치</span></div></div>
      <div><div class="guide"><b>이렇게 보세요</b><ol><li>가로축은 <b>몇백만 년 전</b>인지예요. 오른쪽 끝이 현재예요.</li><li>박사님이 지나온 시대까지만 그래프가 열려요.</li><li>점은 박사님이 방문한 시대예요.</li></ol></div>
        <div class="landfacts">${A.era.land.filter((_, i) => i !== A.era.outlierProbe).slice(0, 3).map(t => `<div>· ${t}</div>`).join('')}</div><div id="qbox"></div></div>
    </div>`;
  const draw = () => timeline($('tl'));
  draw(); A.redraw = draw;
  questions($('qbox'), [A.era.drone], () => showNext('귀환 좌표 조각 받기 ▶'));
}
function timeline(cv) {
  const g = sizeCanvas(cv, 0.62), W = cv.clientWidth, H = W * 0.62, L = 50, R = 46, T = 20, B = 34;
  const X = ma => L + (540 - ma) / 540 * (W - L - R), Yc = v => T + (1 - v / 5000) * (H - T - B), Yo = v => T + (1 - (v - 10) / 25) * (H - T - B);
  const reveal = A.era.ma, done = A.eraIdx === 2;
  g.fillStyle = '#8fb3c2'; g.font = '11px "JetBrains Mono"'; g.textAlign = 'center';
  [540, 450, 360, 270, 180, 90, 0].forEach(m => { g.fillText(m ? m + '' : '현재', X(m), H - 14); g.strokeStyle = 'rgba(255,255,255,.06)'; g.beginPath(); g.moveTo(X(m), T); g.lineTo(X(m), H - B); g.stroke(); });
  g.fillText('백만 년 전', X(270), H - 1);
  g.textAlign = 'right'; g.fillStyle = '#ffb547'; [0, 2500, 5000].forEach(v => g.fillText(fmt(v), L - 6, Yc(v) + 4));
  g.textAlign = 'left'; g.fillStyle = '#5ff2ff'; [10, 20, 30].forEach(v => g.fillText(v + '%', W - R + 6, Yo(v) + 4));
  // 고생대 영역 표시
  g.fillStyle = 'rgba(95,242,255,.05)'; g.fillRect(X(539), T, X(252) - X(539), H - T - B); g.fillStyle = '#8fb3c2'; g.font = '11px "Noto Sans KR"'; g.textAlign = 'center'; g.fillText('고생대', (X(539) + X(252)) / 2, T + 12);
  const seg = ATMOS.filter(p => p[0] >= reveal || (done && p[0] >= 240));
  const drawLine = (idx, col, Y) => { g.strokeStyle = col; g.lineWidth = 2.6; g.beginPath(); seg.forEach((p, i) => { const x = X(p[0]), y = Y(p[idx]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); };
  drawLine(1, '#ffb547', Yc); drawLine(2, '#5ff2ff', Yo);
  // 미확인 구간
  g.fillStyle = 'rgba(2,8,12,.55)'; const xr = X(done ? 240 : reveal); g.fillRect(xr + 2, T, X(0) - xr - 18, H - T - B);
  g.fillStyle = '#46606b'; g.fillText('아직 관측하지 못한 시간', (xr + X(0)) / 2, (T + H - B) / 2);
  // 현재 값
  const now = ATMOS[ATMOS.length - 1]; g.fillStyle = '#fff'; g.beginPath(); g.arc(X(0), Yc(now[1]), 5, 0, 7); g.fill(); g.beginPath(); g.arc(X(0), Yo(now[2]), 5, 0, 7); g.fill();
  g.font = '700 11.5px "Noto Sans KR"'; g.textAlign = 'right'; g.fillStyle = '#ffd9a0'; g.fillText('현재 CO₂ 약 420', X(0) - 8, Yc(now[1]) - 6); g.fillStyle = '#bff8ff'; g.fillText('현재 산소 21%', X(0) - 8, Yo(now[2]) - 6);
  // 방문한 시대
  [[510, '캄브리아기'], [370, '데본기'], [252, '페름기 말']].slice(0, A.eraIdx + 1).forEach(([m, n]) => {
    const p = ATMOS.find(q => q[0] === m); g.fillStyle = '#ffd66b'; g.beginPath(); g.arc(X(m), Yc(p[1]), 6, 0, 7); g.fill();
    g.fillStyle = '#ffe7a6'; g.font = '700 12px "Noto Sans KR"'; g.textAlign = 'center'; g.fillText(n, X(m), Yc(p[1]) - 10);
  });
}

/* ---------- ④ 좌표 조각 ---------- */
function stepFrag() {
  A.gotFrag[A.eraIdx] = true; A.sfx('molt');
  $('an-body').innerHTML = `<div class="fragwrap"><div class="lead">데이터 분석 완료! 귀환 좌표 조각을 얻었어요.</div>
    <div class="frag">${A.frags.map((f, i) => `<span class="${A.gotFrag[i] ? 'got' : ''}">${A.gotFrag[i] ? f : '?'.repeat(f.length)}</span>`).join('<b>.</b>')}</div>
    <div class="vs">${A.eraIdx < 2 ? '조각을 모두 모으면 원래 시대로 돌아갈 수 있어요.' : '모든 조각이 모였어요! 2026년으로 귀환해요.'}</div></div>`;
  showNext(A.eraIdx < 2 ? '다음 시대로 점프 ▶' : '귀환 좌표 입력 · 귀환 ▶', () => { $('analysis').classList.add('hidden'); A.onDone(); });
}

/* ---------- 공용: 질문 카드 ---------- */
function questions(box, qs, done) {
  let i = 0;
  const show = () => {
    const q = qs[i];
    box.innerHTML = `<div class="card"><h3>질문 ${i + 1} / ${qs.length}</h3><div class="q">${q.q}</div>
      <div class="opts">${q.opts.map((o, k) => `<button class="opt" data-k="${k}">${'①②③④'[k]} ${o}</button>`).join('')}</div><div class="fbx"></div></div>`;
    box.querySelectorAll('.opt').forEach(b => b.onclick = () => {
      const k = +b.dataset.k;
      if (k === q.a) {
        b.classList.add('right'); A.sfx('correct'); box.querySelectorAll('.opt').forEach(x => x.disabled = true);
        box.querySelector('.fbx').innerHTML = `<div class="fb ok">${q.ok}</div>` + (i < qs.length - 1 ? '<button class="btn small" id="qnext">다음 질문 ▶</button>' : '');
        if (i < qs.length - 1) $('qnext').onclick = () => { i++; show(); }; else done();
      } else { b.classList.add('wrong'); A.sfx('wrong'); box.querySelector('.fbx').innerHTML = `<div class="fb no">다시 생각해 봐요. 힌트: ${q.no}</div>`; }
    });
  };
  show();
}

/* ---------- 공용 ---------- */
function sizeCanvas(cv, ratio) {
  const dpr = Math.min(2, devicePixelRatio), W = cv.clientWidth || 400, H = ratio === 1 ? W : W * ratio;
  cv.style.height = H + 'px'; cv.width = W * dpr; cv.height = H * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); g.clearRect(0, 0, W, H); return g;
}
export function ramp(t) {
  const c = [[30, 40, 120], [25, 150, 190], [60, 220, 150], [240, 230, 80], [255, 120, 60]];
  t = clamp(t, 0, 0.999) * 4; const i = Math.floor(t), f = t - i, a = c[i], b = c[i + 1];
  return `rgb(${a[0] + (b[0] - a[0]) * f | 0},${a[1] + (b[1] - a[1]) * f | 0},${a[2] + (b[2] - a[2]) * f | 0})`;
}
addEventListener('resize', () => { if (A && !$('analysis').classList.contains('hidden') && A.redraw) A.redraw(); });
