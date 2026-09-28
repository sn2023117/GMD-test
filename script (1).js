'use strict';

/* =========================================================
   블록 러너 v2 - 순수 JavaScript / Canvas 2D
   한 스테이지 = [점프 구간] → 네온 라인 → [비행 구간] → ... 반복
   보라색 포털을 지나면 배경/맵 테마가 바뀝니다.
   ========================================================= */

// ---------- 기본 설정값 ----------
const W = 800, H = 450;      // 내부 해상도
const GROUND = 380;          // 바닥 y
const SIZE = 40;             // 캐릭터/장애물 기본 크기
const PLAYER_SCREEN_X = 150; // 캐릭터의 화면 고정 x
const JUMP_G = 2200, JUMP_V = 720;   // 점프 중력 / 점프 힘

// 난이도: speed(속도), segments(구간 수), maxSpikes(가시 연속 수), gap(비행 통로 높이)
const DIFF = {
  easy:   { speed: 300, segments: 4, maxSpikes: 2, gap: 240 },
  normal: { speed: 350, segments: 5, maxSpikes: 3, gap: 210 },
  hard:   { speed: 420, segments: 6, maxSpikes: 3, gap: 185 },
};

// 맵 테마 (포털을 지날 때마다 순서대로 바뀜)
const THEMES = [
  { name: '네온 시티',   kind: 'city',   top: '#141a3a', bot: '#2b2266', far: 'rgba(255,255,255,0.05)', near: 'rgba(255,255,255,0.09)', ground: '#0d1030', line: '#5cf2e0', solid: '#3b4cc0' },
  { name: '노을 언덕',   kind: 'hills',  top: '#3a1a4a', bot: '#ff7a59', far: 'rgba(60,10,60,0.45)',   near: 'rgba(40,5,45,0.6)',      ground: '#2a0f33', line: '#ffd166', solid: '#9b47bd' },
  { name: '우주 정거장', kind: 'space',  top: '#02030a', bot: '#101a40', far: '#ffffff',               near: '#7aa2ff',                ground: '#080b1e', line: '#c77dff', solid: '#2f7fa8' },
  { name: '깊은 숲',     kind: 'forest', top: '#0b2a22', bot: '#1f6b4f', far: 'rgba(0,0,0,0.25)',      near: 'rgba(0,0,0,0.4)',        ground: '#06180f', line: '#b8f27b', solid: '#2f9f63' },
];

// ---------- 전역 상태 ----------
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);
const screens = { menu: $('menu'), select: $('select'), gameover: $('gameover'), clear: $('clear') };

let state = 'menu';            // 'menu' | 'select' | 'game' | 'gameover' | 'clear'
const settings = { diff: 'normal' };
let game = null;
let spaceHeld = false;
let lastTime = 0;

// ---------- 게임 초기화 ----------
function init() {
  $('btn-start').onclick = () => showScreen('select');
  $('btn-back').onclick = goToMenu;
  $('btn-play').onclick = startGame;
  $('btn-retry').onclick = startGame;
  $('btn-again').onclick = startGame;
  $('btn-over-menu').onclick = goToMenu;
  $('btn-clear-menu').onclick = goToMenu;

  document.querySelectorAll('[data-diff]').forEach((b) => {
    b.onclick = () => { settings.diff = b.dataset.diff; updateSelection(); };
  });
  updateSelection();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', () => { if (state === 'game') spaceHeld = true; });
  window.addEventListener('pointerup', () => { spaceHeld = false; });

  showScreen('menu');
  requestAnimationFrame(loop);
}

function updateSelection() {
  document.querySelectorAll('[data-diff]').forEach((b) =>
    b.classList.toggle('selected', b.dataset.diff === settings.diff));
}

// 화면(오버레이) 전환. null이면 모두 숨김
function showScreen(name) {
  for (const key in screens) screens[key].classList.toggle('hidden', key !== name);
  if (name) state = name;
  if (document.activeElement) document.activeElement.blur();
}

// ---------- 키보드 입력 ----------
function onKeyDown(e) { if (e.code === 'Space') { e.preventDefault(); spaceHeld = true; } }
function onKeyUp(e)   { if (e.code === 'Space') { e.preventDefault(); spaceHeld = false; } }

// ---------- 게임 시작 / 재시작 ----------
function startGame() {
  const d = DIFF[settings.diff];
  const level = buildLevel(d);
  game = {
    d, speed: d.speed, length: level.length,
    obs: level.obs, events: level.events, evIdx: 0,
    pmode: 'jump',            // 현재 조작 모드: 'jump' | 'fly'
    theme: 0,                 // 현재 맵 테마 번호
    flash: 0, banner: null,
    player: { x: 0, y: GROUND - SIZE, vy: 0, rot: 0, onGround: true },
    particles: [], dead: false, deadTimer: 0, time: 0,
  };
  showScreen(null);
  state = 'game';
}

// ---------- 장애물 생성 ----------
const rnd = (a, b) => a + Math.random() * (b - a);
const addSolid = (o, x, y, w, h) => o.push({ t: 'solid', x, y, w, h });          // 밟을 수 있는 블록 (옆/아래 충돌은 위험)
const addSpike = (o, x, y, dir) => o.push({ t: 'spike', x, y, w: SIZE, h: SIZE, dir }); // dir 1: 위쪽 가시, -1: 아래쪽 가시

// 스테이지 전체 생성: 구간을 번갈아 만들고 사이에 네온 라인(gate)과 포털(portal)을 배치
function buildLevel(d) {
  const obs = [], events = [];
  const segLen = d.speed * 9;                    // 구간 하나의 길이(약 9초)
  const st = { center: GROUND / 2 };             // 비행 통로의 현재 높이 (구간 사이 이어짐)
  let mode = 'jump';
  for (let i = 0; i < d.segments; i++) {
    const start = i * segLen;
    if (i > 0) {
      events.push({ kind: 'gate', x: start, mode });                       // 모드 전환 네온 라인
      events.push({ kind: 'portal', x: start + 260, theme: i % THEMES.length }); // 맵 이동 포털
    }
    const from = start + (i === 0 ? 900 : 560), to = start + segLen - 450;   // 앞뒤로 안전 구간
    if (mode === 'jump') genJump(obs, from, to, d); else genFly(obs, from, to, d, st);
    mode = mode === 'jump' ? 'fly' : 'jump';
  }
  return { obs, events, length: d.segments * segLen + 400 };
}

// 점프 구간: 가시 / 계단 언덕 / 가시 있는 발판 / 낮은 블록
function genJump(o, from, to, d) {
  let x = from;
  while (x < to - 450) {
    const r = Math.random(); let w;
    if (r < 0.3) {                                                   // 가시 묶음
      const n = 1 + Math.floor(Math.random() * d.maxSpikes);
      for (let i = 0; i < n; i++) addSpike(o, x + i * SIZE, GROUND - SIZE, 1);
      w = n * SIZE;
    } else if (r < 0.55) {                                           // 올라갔다 내려오는 언덕
      addSolid(o, x, GROUND - 40, 120, 40);
      addSolid(o, x + 120, GROUND - 80, 200, 80);
      addSolid(o, x + 320, GROUND - 40, 120, 40);
      if (d.speed > 300 && Math.random() < 0.5) addSpike(o, x + 200, GROUND - 120, 1);
      w = 440;
    } else if (r < 0.8) {                                            // 가시가 있는 긴 발판
      addSolid(o, x, GROUND - 40, 400, 40);
      addSpike(o, x + 220, GROUND - 80, 1);
      w = 400;
    } else {                                                         // 낮은 블록
      addSolid(o, x, GROUND - 40, 80, 40);
      w = 80;
    }
    x += w + d.speed * 0.75 + rnd(0, d.speed * 0.5);
  }
}

// 비행 구간: 기둥 통로 / 이어진 동굴 / 위아래 가시 복도 / 떠 있는 블록들
function genFly(o, from, to, d, st) {
  const gap = d.gap, lo = gap / 2 + 20, hi = GROUND - gap / 2 - 20;
  const shift = (m) => { st.center = Math.max(lo, Math.min(hi, st.center + rnd(-m, m))); };
  const col = (cx, w, g) => {                    // 위/아래 블록 한 쌍 (사이가 통로)
    const c = st.center;
    addSolid(o, cx, 0, w, c - g / 2);
    addSolid(o, cx, c + g / 2, w, GROUND - (c + g / 2));
  };
  let x = from;
  while (x < to - 500) {
    const r = Math.random(); let w = 0;
    if (r < 0.3) {                               // 기둥 통로
      for (let i = 0; i < 3; i++) { shift(120); col(x + w, 60, gap); w += 60 + d.speed * 0.9; }
    } else if (r < 0.6) {                        // 이어진 동굴 (계단처럼 오르내림)
      for (let i = 0; i < 6; i++) { shift(50); col(x + w, 130, gap + 30); w += 130; }
    } else if (r < 0.8) {                        // 가시 복도
      for (let i = 0; i < 4; i++) {
        const cx = x + i * 240;
        if (i % 2 === 0) { addSpike(o, cx, GROUND - SIZE, 1); addSpike(o, cx + SIZE, GROUND - SIZE, 1); }
        else { addSpike(o, cx, 0, -1); addSpike(o, cx + SIZE, 0, -1); }
      }
      w = 960;
    } else {                                     // 떠 있는 블록
      for (let i = 0; i < 5; i++) addSolid(o, x + i * 220, rnd(60, GROUND - 120), 80, 60);
      w = 1100;
    }
    x += w + d.speed * 0.6;
  }
}

// ---------- 게임 업데이트 ----------
function update(dt) {
  const g = game;
  g.time += dt;
  if (g.flash > 0) g.flash -= dt;
  if (g.banner) { g.banner.t -= dt; if (g.banner.t <= 0) g.banner = null; }
  updateParticles(dt);

  if (g.dead) { g.deadTimer += dt; if (g.deadTimer > 0.7) gameOver(); return; }

  movePlayer(dt);
  if (g.dead) return;

  const p = g.player;
  while (g.evIdx < g.events.length && p.x + SIZE >= g.events[g.evIdx].x) triggerEvent(g.events[g.evIdx++]);

  for (const o of g.obs) {                       // 가시 충돌
    if (o.t !== 'spike' || !isNear(o, p)) continue;
    if (spikeHit(p, o)) { crash(); return; }
  }
  if (p.x + SIZE >= g.length) gameClear();
}

const isNear = (o, p) => o.x < p.x + SIZE + 20 && o.x + o.w > p.x - 20;

// 네온 라인(모드 전환) / 포털(맵 이동) 접촉 처리
function triggerEvent(e) {
  const g = game;
  if (e.kind === 'gate') {
    g.pmode = e.mode;
    g.player.rot = 0;
    g.banner = { text: e.mode === 'fly' ? '비행 모드!' : '점프 모드!', t: 1.4 };
    g.flash = 0.25;
  } else {
    g.theme = e.theme;
    g.banner = { text: '맵 이동: ' + THEMES[e.theme].name, t: 1.8 };
    g.flash = 0.6;
  }
}

// ---------- 캐릭터 이동 (점프/비행 + 블록 위 착지) ----------
function movePlayer(dt) {
  const g = game, p = g.player;
  p.x += g.speed * dt;                           // 자동 전진

  // 1) 가로 충돌: 블록 옆에 부딪히면 죽음 (12px 이하 턱은 자동으로 올라섬)
  for (const o of g.obs) {
    if (o.t !== 'solid' || !isNear(o, p) || !overlap(p, o)) continue;
    if (p.y + SIZE - o.y <= 12) { p.y = o.y - SIZE; p.vy = 0; }
    else { crash(); return; }
  }

  // 2) 세로 속도: 모드에 따라 점프 또는 비행
  if (g.pmode === 'jump') jumpMove(p, dt); else flyMove(p, dt);
  p.y += p.vy * dt;
  p.onGround = false;

  // 3) 세로 충돌: 내려오며 닿으면 착지, 올라가다 닿으면 머리 부딪힘(죽지 않음)
  for (const o of g.obs) {
    if (o.t !== 'solid' || !isNear(o, p) || !overlap(p, o)) continue;
    if (p.vy >= 0) { p.y = o.y - SIZE; p.vy = 0; p.onGround = true; }
    else { p.y = o.y + o.h; p.vy = 0; }
  }
  if (p.y >= GROUND - SIZE) { p.y = GROUND - SIZE; p.vy = 0; p.onGround = true; }
  if (p.y < 0) { p.y = 0; p.vy = 0; }

  // 4) 회전 모양
  if (g.pmode === 'jump') {
    if (p.onGround) p.rot = Math.round(p.rot / (Math.PI / 2)) * (Math.PI / 2);
    else p.rot += (Math.PI / 2) / 0.65 * dt;
  } else p.rot = p.vy * 0.002;
}

// 점프: Space를 누르면 점프, 누른 채면 착지 즉시 다시 점프
function jumpMove(p, dt) {
  if (spaceHeld && p.onGround) p.vy = -JUMP_V;
  p.vy += JUMP_G * dt;
}

// 비행: Space를 누르면 상승, 떼면 하강
function flyMove(p, dt) {
  p.vy += (spaceHeld ? -1300 : 900) * dt;
  p.vy = Math.max(-380, Math.min(420, p.vy));
}

// ---------- 충돌 판정 ----------
function overlap(p, o) {
  return p.x + 2 < o.x + o.w && p.x + SIZE - 2 > o.x && p.y < o.y + o.h && p.y + SIZE > o.y;
}
function spikeHit(p, o) {                        // 가시는 실제보다 작은 판정 상자 사용
  const a = { x: p.x + 5, y: p.y + 5, w: SIZE - 10, h: SIZE - 10 };
  const b = { x: o.x + 11, y: o.dir === 1 ? o.y + 16 : o.y, w: o.w - 22, h: o.h - 16 };
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function crash() {
  const p = game.player;
  game.dead = true;
  for (let i = 0; i < 24; i++) {
    const ang = Math.random() * Math.PI * 2, sp = 100 + Math.random() * 300;
    game.particles.push({ x: p.x + SIZE / 2, y: p.y + SIZE / 2, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: 0.7 });
  }
}
function updateParticles(dt) {
  for (const q of game.particles) { q.x += q.vx * dt; q.y += q.vy * dt; q.vy += 900 * dt; q.life -= dt; }
  game.particles = game.particles.filter((q) => q.life > 0);
}

// ---------- 게임 오버 / 클리어 / 메인 메뉴 ----------
function gameOver() {
  const pct = Math.min(99, Math.floor((game.player.x / game.length) * 100));
  $('over-text').textContent = '진행도 ' + pct + '%';
  showScreen('gameover');
}
function gameClear() {
  $('clear-text').textContent = '결승선에 도착했어요! (' + game.time.toFixed(1) + '초)';
  showScreen('clear');
}
function goToMenu() { game = null; spaceHeld = false; showScreen('menu'); }

// ---------- 화면 렌더링 ----------
function render(ts) {
  const cam = game ? game.player.x - PLAYER_SCREEN_X : ts * 0.15;
  const th = THEMES[game ? game.theme : 0];
  drawBackground(cam, th);
  drawGround(cam, th);
  if (!game) return;
  drawFinishLine(cam);
  for (const e of game.events) {
    const sx = e.x - cam;
    if (sx < -60 || sx > W + 60) continue;
    if (e.kind === 'gate') drawGate(e, sx); else drawPortal(sx);
  }
  for (const o of game.obs) {
    const sx = o.x - cam;
    if (sx > W || sx + o.w < 0) continue;
    if (o.t === 'solid') drawSolid(o, sx, th); else drawSpike(o, sx);
  }
  if (!game.dead) drawPlayer();
  drawParticles(cam);
  if (game.flash > 0) { ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.8, game.flash * 1.3) + ')'; ctx.fillRect(0, 0, W, H); }
  drawHUD(th);
}

// 배경: 테마 종류(kind)에 따라 다른 도형을 그림
function drawBackground(cam, th) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, th.top); g.addColorStop(1, th.bot);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const mod = (a, b) => ((a % b) + b) % b;

  if (th.kind === 'city') {
    ctx.fillStyle = th.far;
    for (let i = -1; i < 8; i++) { const h = 120 + ((i + 20) * 53) % 140; ctx.fillRect(i * 220 - mod(cam * 0.25, 220), GROUND - h, 140, h); }
    ctx.fillStyle = th.near;
    for (let i = -1; i < 12; i++) { const h = 40 + ((i + 20) * 37) % 70; ctx.fillRect(i * 130 - mod(cam * 0.5, 130), GROUND - h, 70, h); }
  } else if (th.kind === 'hills') {
    ctx.fillStyle = 'rgba(255,230,150,0.55)'; ctx.beginPath(); ctx.arc(600, 150, 60, 0, 7); ctx.fill();   // 노을 해
    [[0.2, 300, 150, th.far], [0.45, 200, 90, th.near]].forEach(([sp, w, h, c]) => {
      ctx.fillStyle = c;
      for (let i = -1; i < 6; i++) {
        const x = i * w - mod(cam * sp, w);
        ctx.beginPath(); ctx.moveTo(x, GROUND); ctx.lineTo(x + w / 2, GROUND - h); ctx.lineTo(x + w, GROUND); ctx.fill();
      }
    });
  } else if (th.kind === 'space') {
    ctx.fillStyle = th.far;
    for (let i = 0; i < 50; i++) ctx.fillRect(mod(i * 197 - cam * (0.04 + (i % 3) * 0.04), W), (i * 53) % GROUND, 2, 2);
    ctx.fillStyle = th.near; ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(mod(900 - cam * 0.08, 1100) - 150, 140, 70, 0, 7); ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    [[0.2, 90, 40, th.far], [0.45, 130, 24, th.near]].forEach(([sp, w, tw, c]) => {
      ctx.fillStyle = c;
      for (let i = -1; i < 10; i++) ctx.fillRect(i * w - mod(cam * sp, w), 0, tw, GROUND);   // 나무 기둥
    });
  }
}

function drawGround(cam, th) {
  ctx.fillStyle = th.ground; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = th.line; ctx.fillRect(0, GROUND, W, 4);
  ctx.globalAlpha = 0.35;
  for (let x = -(cam % 80 + 80) % 80; x < W; x += 80) ctx.fillRect(x, GROUND + 20, 40, 4);
  ctx.globalAlpha = 1;
}

function drawFinishLine(cam) {
  const sx = game.length - cam;
  if (sx > W || sx < -40) return;
  for (let y = 0; y < GROUND; y += 20)
    for (let i = 0; i < 2; i++) { ctx.fillStyle = ((y / 20 + i) % 2 === 0) ? '#fff' : '#111'; ctx.fillRect(sx + i * 20, y, 20, 20); }
}

// 밟을 수 있는 블록: 테마색 + 밝은 테두리
function drawSolid(o, sx, th) {
  ctx.fillStyle = th.solid; ctx.fillRect(sx, o.y, o.w, o.h);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  if (o.y > 0) ctx.fillRect(sx, o.y, o.w, 4);                          // 윗면 하이라이트
  if (o.y + o.h < GROUND) ctx.fillRect(sx, o.y + o.h - 4, o.w, 4);     // 아랫면 하이라이트
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'; ctx.lineWidth = 2; ctx.strokeRect(sx + 1, o.y + 1, o.w - 2, o.h - 2);
}

function drawSpike(o, sx) {
  ctx.fillStyle = '#ff4d6d'; ctx.beginPath();
  if (o.dir === 1) { ctx.moveTo(sx, o.y + o.h); ctx.lineTo(sx + o.w / 2, o.y); ctx.lineTo(sx + o.w, o.y + o.h); }
  else { ctx.moveTo(sx, o.y); ctx.lineTo(sx + o.w / 2, o.y + o.h); ctx.lineTo(sx + o.w, o.y); }
  ctx.closePath(); ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
}

// 네온 라인: 지나가면 점프 ↔ 비행 모드 전환
function drawGate(e, sx) {
  const c = e.mode === 'fly' ? '#39e6ff' : '#ff5cf0';
  ctx.save(); ctx.shadowColor = c; ctx.shadowBlur = 18; ctx.fillStyle = c; ctx.fillRect(sx - 3, 0, 6, GROUND); ctx.restore();
  ctx.fillStyle = c; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(e.mode === 'fly' ? '비행 ▶' : '점프 ▶', sx, 24);
}

// 포털: 지나가면 새로운 맵으로 이동
function drawPortal(sx) {
  const pulse = 8 + 5 * Math.sin(game.time * 6);
  ctx.save(); ctx.translate(sx, GROUND / 2);
  ctx.shadowColor = '#b26bff'; ctx.shadowBlur = 22;
  ctx.fillStyle = 'rgba(178,107,255,0.28)'; ctx.strokeStyle = '#d9a8ff'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.ellipse(0, 0, 26, GROUND / 2 - 6, 0, 0, 7); ctx.fill(); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.ellipse(0, 0, pulse, GROUND / 2 - 40, 0, 0, 7); ctx.stroke();
  ctx.restore();
}

// 캐릭터: 노란 네모 + 눈 (비행 모드에서는 누르는 동안 불꽃)
function drawPlayer() {
  const p = game.player;
  ctx.save(); ctx.translate(PLAYER_SCREEN_X + SIZE / 2, p.y + SIZE / 2); ctx.rotate(p.rot);
  if (game.pmode === 'fly' && spaceHeld) {
    ctx.fillStyle = '#ff9f43'; ctx.beginPath(); ctx.moveTo(-SIZE / 2, -8); ctx.lineTo(-SIZE / 2 - 18 - Math.random() * 8, 0); ctx.lineTo(-SIZE / 2, 8); ctx.fill();
  }
  ctx.fillStyle = '#ffd84a'; ctx.fillRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
  ctx.strokeStyle = '#1a1a2e'; ctx.lineWidth = 3; ctx.strokeRect(-SIZE / 2, -SIZE / 2, SIZE, SIZE);
  ctx.fillStyle = '#1a1a2e'; ctx.fillRect(2, -8, 8, 10); ctx.fillRect(-12, -8, 8, 10);
  ctx.restore();
}

function drawParticles(cam) {
  ctx.fillStyle = '#ffd84a';
  for (const q of game.particles) ctx.fillRect(q.x - cam - 4, q.y - 4, 8, 8);
}

// HUD: 진행도 바(네온 라인 위치 표시), 현재 모드, 맵 이름, 안내 문구
function drawHUD(th) {
  const g = game, ratio = Math.min(1, g.player.x / g.length);
  ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.fillRect(100, 16, W - 200, 10);
  ctx.fillStyle = '#5cf2e0'; ctx.fillRect(100, 16, (W - 200) * ratio, 10);
  ctx.fillStyle = '#fff';
  for (const e of g.events) if (e.kind === 'gate') ctx.fillRect(100 + (W - 200) * e.x / g.length - 1, 12, 2, 18);
  ctx.font = '14px sans-serif'; ctx.textAlign = 'left';
  ctx.fillText(g.pmode === 'jump' ? '■ 점프 모드' : '■ 비행 모드', 12, 26);
  ctx.textAlign = 'right'; ctx.fillText(th.name + '  ' + Math.floor(ratio * 100) + '%', W - 12, 26);
  ctx.textAlign = 'center';
  if (g.time < 3.5) { ctx.font = '18px sans-serif'; ctx.fillText('Space: 점프(누르고 있으면 계속 점프) / 비행 구간에서는 누르면 상승', W / 2, 70); }
  if (g.banner) {
    ctx.globalAlpha = Math.min(1, g.banner.t * 2);
    ctx.font = 'bold 34px sans-serif'; ctx.lineWidth = 5; ctx.strokeStyle = '#1a1a2e';
    ctx.strokeText(g.banner.text, W / 2, 130); ctx.fillStyle = '#ffd84a'; ctx.fillText(g.banner.text, W / 2, 130);
    ctx.globalAlpha = 1;
  }
}

// ---------- 메인 루프 ----------
function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 1 / 30);
  lastTime = ts;
  if (game && state === 'game') update(dt);
  render(ts);
  requestAnimationFrame(loop);
}

init();
