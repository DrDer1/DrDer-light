/* DrDer-light — engine.js
   منظور خلف الكرة، طريق ذهبي، عالم متجدد حسب المرحلة.
*/
(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  if (!canvas) {
    console.error('DrDer-light: لم يتم العثور على canvas.');
    return;
  }
  const ctx = canvas.getContext('2d');

  /* ---------- ثوابت ---------- */
  const SAVE_KEY = 'drder-light-progress-v1';
  const LANES = 7;
  const CENTER_LANE = 3;
  const CRYSTAL_COUNT = 2;
  const GOLD = '#f4cf63';
  const GOLD_LIGHT = '#fff0a0';
  const BG = '#080806';

  const COLORS = {
    text: '#fff4cf',
    pathA: '#151107',
    pathB: '#100d07',
    block: '#0c0b08',
    blockSide: '#080807',
    blockTop: '#17130b',
    edge: 'rgba(203,157,56,0.28)',
    edgeBright: 'rgba(232,188,78,0.28)',
    edgeBlock: 'rgba(162,126,47,0.36)',
    edgeBlockTop: 'rgba(170,131,47,0.28)'
  };

  /* ---------- حالة اللعبة ---------- */
  let level = 1;
  let bestLevel = 1;
  let completedLevels = 0;
  let moves = 0;
  let crystals = 0;
  let elapsed = 0;        // بالثواني (float)
  let paused = false;
  let won = false;
  let message = '';
  let messageUntil = 0;
  let animationId = 0;
  let lastFrame = 0;
  let lastSecond = 0;

  let player = { lane: CENTER_LANE, z: 0, visualLane: CENTER_LANE, visualZ: 0 };
  let worldLength = 54;
  let route = [];
  let blocks = new Set();
  let crystalPositions = [];
  let portalZ = worldLength - 2;

  let pointerStart = null;
  let audioCtx = null;

  /* ---------- أدوات ---------- */
  function rand(seed) {
    const v = Math.sin(seed * 127.1 + level * 311.7) * 43758.5453;
    return v - Math.floor(v);
  }
  const keyOf = (lane, z) => lane + ':' + z;
  const routeLane = z => {
    const i = Math.max(0, Math.min(route.length - 1, Math.floor(z)));
    return route[i] ?? CENTER_LANE;
  };

  function isOpen(lane, z) {
    if (lane < 0 || lane >= LANES || z < 0 || z > worldLength) return false;
    if (z <= 1) return lane === CENTER_LANE;
    const target = routeLane(z);
    if (lane === target) return true;
    if (Math.abs(lane - target) === 1) return rand(z * 19 + lane * 7) > 0.40;
    return false;
  }
  function isBlocked(lane, z) { return blocks.has(keyOf(lane, Math.round(z))); }
  function canStand(lane, z) { return isOpen(lane, z) && !isBlocked(lane, z); }

  /* ---------- توليد العالم ---------- */
  function generateWorld() {
    worldLength = Math.min(54 + level * 4, 180);
    portalZ = worldLength - 2;

    route = [CENTER_LANE];
    blocks = new Set();
    crystalPositions = [];

    let cur = CENTER_LANE;
    for (let z = 1; z <= worldLength; z++) {
      if (z > 2 && rand(z * 3 + 11) > 0.57) {
        const change = rand(z * 5 + 17) > 0.5 ? 1 : -1;
        cur = Math.max(1, Math.min(LANES - 2, cur + change));
      }
      route[z] = cur;
    }

    for (let z = 2; z < worldLength - 1; z++) {
      const mainLane = routeLane(z);
      for (let lane = 0; lane < LANES; lane++) {
        const dist = Math.abs(lane - mainLane);
        const sideChance = rand(z * 13 + lane * 31);
        if (dist > 0 && sideChance > 0.43) blocks.add(keyOf(lane, z));
      }
      blocks.delete(keyOf(mainLane, z));
      blocks.delete(keyOf(routeLane(z - 1), z));
    }

    const z1 = Math.max(7, Math.floor(worldLength * 0.24));
    const z2 = Math.max(z1 + 7, Math.floor(worldLength * 0.58));

    crystalPositions = [
      { lane: routeLane(z1), z: z1, collected: false },
      { lane: routeLane(z2), z: z2, collected: false }
    ];
    crystalPositions.forEach(c => blocks.delete(keyOf(c.lane, c.z)));
  }

  /* ---------- حفظ / تحميل ---------- */
  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        level, bestLevel, completedLevels, savedAt: Date.now()
      }));
    } catch (_) {}
  }
  function loadProgress() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (Number.isFinite(s.level) && s.level > 0) level = Math.floor(s.level);
      if (Number.isFinite(s.bestLevel) && s.bestLevel > 0) bestLevel = Math.floor(s.bestLevel);
      if (Number.isFinite(s.completedLevels) && s.completedLevels >= 0) completedLevels = Math.floor(s.completedLevels);
    } catch (_) { level = 1; }
  }

  /* ---------- UI ---------- */
  const $ = id => document.getElementById(id);

  function updateStats() {
    const lv = $('levelValue');
    const mv = $('movesValue');
    const cr = $('crystalsValue');
    const tm = $('timeValue');
    if (lv) lv.textContent = String(level);
    if (mv) mv.textContent = String(moves);
    if (cr) cr.textContent = crystals + '/' + CRYSTAL_COUNT;
    if (tm) {
      const total = Math.floor(elapsed);
      const m = Math.floor(total / 60);
      const s = total % 60;
      tm.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    const nb = $('nextButton');
    if (nb) nb.disabled = !won;
    const pb = $('pauseButton');
    if (pb) pb.textContent = paused ? '▶' : 'Ⅱ';
  }

  function say(text, duration = 1800) {
    message = text;
    messageUntil = performance.now() + duration;
  }

  /* ---------- صوت ---------- */
  function playMoveSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioCtx) audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') audioCtx.resume();

      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 520;
      gain.gain.setValueAtTime(0.035, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.07);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.07);
    } catch (_) {}
  }

  /* ---------- Canvas + DPR ---------- */
  function syncCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const tw = Math.round(w * ratio);
    const th = Math.round(h * ratio);
    if (canvas.width !== tw || canvas.height !== th) {
      canvas.width = tw;
      canvas.height = th;
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { w, h };
  }

  /* ---------- إسقاط ---------- */
  function project(lane, z, lift = 0, dims) {
    const { w, h } = dims;
    const horizon = h * 0.265;
    const distance = z - player.visualZ;
    const persp = 1 / (1 + Math.max(0, distance) * 0.075);
    const scale = Math.max(0.075, Math.min(2.05, persp));
    const laneW = w * 0.19 * scale;
    const x = w * 0.5 + (lane - player.visualLane) * laneW;
    const y = horizon + h * 0.79 * scale - lift * scale;
    return { x, y, scale, laneW, horizon };
  }

  function poly(points, fill, stroke, lw) {
    if (!points || points.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  /* ---------- رسم ---------- */
  function drawSky(w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#080807');
    g.addColorStop(0.40, '#100d05');
    g.addColorStop(0.72, '#090805');
    g.addColorStop(1, '#050505');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const horizon = h * 0.265;
    const glow = ctx.createRadialGradient(w * 0.5, horizon, 1, w * 0.5, horizon, w * 0.72);
    glow.addColorStop(0, 'rgba(200,150,35,0.12)');
    glow.addColorStop(0.55, 'rgba(120,80,15,0.035)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h * 0.8);

    ctx.strokeStyle = 'rgba(190,145,48,0.045)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      const y = horizon + i * i * h * 0.008;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(205,161,61,0.22)';
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(w * 0.5 + i * 2, horizon);
      ctx.lineTo(w * 0.5 + i * w * 0.105, h * 1.04);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(187,143,45,0.10)';
    for (let i = 1; i <= 13; i++) {
      const t = i / 13;
      const y = horizon + (h - horizon) * t * t;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
  }

  function drawTile(lane, z, dims) {
    const near = project(lane, z, 0, dims);
    const far = project(lane, z + 1, 0, dims);
    const { h } = dims;
    if (near.y < h * 0.19 || far.y > h * 1.35) return;

    const ln = near.x - near.laneW * 0.5;
    const rn = near.x + near.laneW * 0.5;
    const lf = far.x - far.laneW * 0.5;
    const rf = far.x + far.laneW * 0.5;

    const open = isOpen(lane, z);
    const blocked = isBlocked(lane, z);
    const fill = open
      ? ((z + lane) % 2 === 0 ? COLORS.pathA : COLORS.pathB)
      : COLORS.block;

    poly([[lf, far.y], [rf, far.y], [rn, near.y], [ln, near.y]], fill, COLORS.edge, 1);

    if (open) {
      ctx.strokeStyle = COLORS.edgeBright;
      ctx.lineWidth = Math.max(0.6, near.scale * 0.8);
      ctx.beginPath();
      ctx.moveTo(ln, near.y); ctx.lineTo(lf, far.y);
      ctx.moveTo(rn, near.y); ctx.lineTo(rf, far.y);
      ctx.stroke();
    }

    if (blocked && z > player.visualZ + 1) {
      const depth = Math.max(2, near.scale * h * 0.035);
      const topY = near.y - depth;
      const side = Math.max(1, near.scale * dims.w * 0.009);

      poly([[ln, topY], [rn, topY], [rn, near.y], [ln, near.y]], COLORS.blockSide, COLORS.edgeBlock, 1);
      poly([[lf, far.y], [rf, far.y], [rn, topY], [ln, topY]], COLORS.blockTop, COLORS.edgeBlockTop, 1);
      poly(
        [[rn, topY], [rn, near.y], [rn + side, near.y + side * 0.35], [rn + side, topY + side * 0.35]],
        '#0b0a07', 'rgba(170,131,47,0.20)', 0.8
      );
    }
  }

  function drawCrystal(c, dims) {
    if (c.collected) return;
    const p = project(c.lane, c.z, dims.h * 0.06, dims);
    if (p.y < dims.h * 0.20 || p.y > dims.h * 1.05) return;
    if (p.x < -dims.w * 0.15 || p.x > dims.w * 1.15) return;

    const size = Math.max(2, Math.min(22, dims.w * 0.026 * p.scale * 4));
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = size * 1.5;
    poly([[0, -size], [size * 0.62, 0], [0, size], [-size * 0.62, 0]], GOLD, GOLD_LIGHT, 1.2);
    ctx.restore();
  }

  function drawPortal(dims) {
    const p = project(routeLane(portalZ), portalZ, 0, dims);
    if (p.y < dims.h * 0.19 || p.y > dims.h * 1.25) return;
    if (p.x < -dims.w * 0.3 || p.x > dims.w * 1.3) return;

    const width = Math.max(5, p.laneW * 0.72);
    const height = width * 1.55;

    ctx.save();
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 18 * p.scale;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1, 3 * p.scale);
    ctx.beginPath();
    ctx.moveTo(p.x - width * 0.5, p.y);
    ctx.lineTo(p.x - width * 0.5, p.y - height);
    ctx.quadraticCurveTo(p.x, p.y - height * 1.22, p.x + width * 0.5, p.y - height);
    ctx.lineTo(p.x + width * 0.5, p.y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,226,130,0.65)';
    ctx.lineWidth = Math.max(0.6, p.scale);
    ctx.beginPath();
    ctx.moveTo(p.x - width * 0.34, p.y);
    ctx.lineTo(p.x - width * 0.34, p.y - height * 0.94);
    ctx.quadraticCurveTo(p.x, p.y - height * 1.11, p.x + width * 0.34, p.y - height * 0.94);
    ctx.lineTo(p.x + width * 0.34, p.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(w, h) {
    const x = w * 0.5;
    const y = h * 0.765;
    const r = Math.max(9, Math.min(w, h) * 0.036);

    const glow = ctx.createRadialGradient(x, y, 1, x, y, r * 3.8);
    glow.addColorStop(0, 'rgba(255,226,120,0.58)');
    glow.addColorStop(0.28, 'rgba(241,185,55,0.25)');
    glow.addColorStop(1, 'rgba(255,190,40,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(x, y, r * 3.8, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 1.2, r * 1.15, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const ball = ctx.createRadialGradient(x - r * 0.32, y - r * 0.38, r * 0.05, x, y, r);
    ball.addColorStop(0, '#fffbd6');
    ball.addColorStop(0.28, '#ffe88b');
    ball.addColorStop(0.64, '#e7ae32');
    ball.addColorStop(1, '#8b5812');

    ctx.save();
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 16;
    ctx.fillStyle = ball;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,245,187,0.9)';
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.restore();
  }

  function drawHUD(w) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = '600 15px sans-serif';
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 8;
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText('البلورات ' + crystals + '/' + CRYSTAL_COUNT, w * 0.5, 22);
    ctx.restore();
  }

  function drawMessage(w, h) {
    if (!message || performance.now() > messageUntil) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px sans-serif';

    const width = Math.min(w - 32, 300);
    const x = w * 0.5;
    const y = h * 0.64;

    ctx.fillStyle = 'rgba(8,7,4,0.88)';
    ctx.strokeStyle = 'rgba(220,175,67,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x - width / 2, y - 20, width, 40, 10);
    else ctx.rect(x - width / 2, y - 20, width, 40);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText(message, x, y);
    ctx.restore();
  }

  function drawOverlay(w, h) {
    if (!paused && !won) return;
    ctx.fillStyle = 'rgba(0,0,0,0.58)';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 12;
    ctx.fillStyle = GOLD_LIGHT;
    ctx.font = 'bold 26px sans-serif';
    if (won) {
      ctx.fillText('اكتملت المرحلة!', w * 0.5, h * 0.43);
      ctx.font = '16px sans-serif';
      ctx.fillText('يمكنك الانتقال إلى المرحلة التالية', w * 0.5, h * 0.50);
    } else {
      ctx.fillText('اللعبة متوقفة', w * 0.5, h * 0.48);
      ctx.font = '15px sans-serif';
      ctx.fillText('اضغط استئناف للمتابعة', w * 0.5, h * 0.55);
    }
    ctx.restore();
  }

  function render() {
    const dims = syncCanvas();
    const { w, h } = dims;
    ctx.clearRect(0, 0, w, h);
    drawSky(w, h);

    const startZ = Math.floor(player.visualZ + 19);
    const endZ = Math.max(0, Math.floor(player.visualZ - 2));

    for (let z = startZ; z >= endZ; z--) {
      for (let lane = 0; lane < LANES; lane++) drawTile(lane, z, dims);
      crystalPositions.forEach(c => { if (c.z === z) drawCrystal(c, dims); });
      if (z === portalZ) drawPortal(dims);
    }
    crystalPositions.forEach(c => {
      if (c.z < endZ || c.z > startZ) drawCrystal(c, dims);
    });
    if (portalZ < endZ || portalZ > startZ) drawPortal(dims);

    drawPlayer(w, h);
    drawHUD(w);
    drawMessage(w, h);
    drawOverlay(w, h);
  }

  /* ---------- منطق اللعبة ---------- */
  function collectCrystals() {
    crystalPositions.forEach(c => {
      if (!c.collected && c.z === player.z && c.lane === player.lane) {
        c.collected = true;
        crystals++;
        say('تم جمع البلورة الذهبية!');
      }
    });
  }

  function checkWin() {
    if (player.z >= portalZ && player.lane === routeLane(portalZ)) {
      if (crystals >= CRYSTAL_COUNT) {
        won = true;
        paused = false;
        completedLevels = Math.max(completedLevels, level);
        bestLevel = Math.max(bestLevel, level);
        saveProgress();
        say('اكتملت المرحلة بنجاح!', 3000);
        updateStats();
      } else {
        player.z = portalZ - 1;
        say('اجمع البلورتين أولًا');
      }
    }
  }

  function move(direction) {
    if (paused || won) return;
    let nl = player.lane;
    let nz = player.z;

    if (direction === 'left')  nl--;
    if (direction === 'right') nl++;
    if (direction === 'up')    nz++;
    if (direction === 'down')  nz = Math.max(0, nz - 1);

    nl = Math.max(0, Math.min(LANES - 1, nl));
    nz = Math.max(0, Math.min(worldLength, nz));

    if (nl === player.lane && nz === player.z) return;
    if (!canStand(nl, nz)) { say('الكتلة تمنع المرور'); return; }

    player.lane = nl;
    player.z = nz;
    moves++;

    playMoveSound();
    collectCrystals();
    checkWin();
    updateStats();
  }

  function restartLevel() {
    player = { lane: CENTER_LANE, z: 0, visualLane: CENTER_LANE, visualZ: 0 };
    moves = 0; crystals = 0; elapsed = 0; paused = false; won = false; message = '';
    generateWorld();
    say('المرحلة ' + level);
    updateStats();
  }

  function nextLevel() {
    if (!won) { say('أكمل المرحلة أولًا'); return; }
    level++;
    bestLevel = Math.max(bestLevel, level);
    saveProgress();
    restartLevel();
  }

  function togglePause() {
    if (won) return;
    paused = !paused;
    say(paused ? 'تم إيقاف اللعبة' : 'استأنفت اللعب');
    updateStats();
  }

  /* ---------- الإدخال ---------- */
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerStart = { x: e.clientX, y: e.clientY, time: performance.now() };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onPointerUp(e) {
    if (!pointerStart) return;
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    const dur = performance.now() - pointerStart.time;
    pointerStart = null;
    if (paused || won) return;

    const th = 22;
    if (Math.abs(dx) < th && Math.abs(dy) < th) {
      if (dur < 500) move('up');
      return;
    }
    if (Math.abs(dx) > Math.abs(dy)) move(dx < 0 ? 'left' : 'right');
    else move(dy < 0 ? 'up' : 'down');
  }
  function onKeyDown(e) {
    const map = {
      ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
      a: 'left', d: 'right', w: 'up', s: 'down'
    };
    const d = map[e.key];
    if (d) { e.preventDefault(); move(d); return; }
    if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); togglePause(); }
  }

  /* ---------- حلقة الرسم ---------- */
  function frame(time) {
    animationId = requestAnimationFrame(frame);
    if (!lastFrame) lastFrame = time;
    const delta = Math.min(0.1, (time - lastFrame) / 1000);
    lastFrame = time;

    if (!paused && !won) {
      elapsed += delta;
      player.visualLane += (player.lane - player.visualLane) * 0.18;
      player.visualZ += (player.z - player.visualZ) * 0.18;
      if (time - lastSecond >= 250) { lastSecond = time; updateStats(); }
    }
    render();
  }

  /* ---------- ربط الأزرار ---------- */
  function bindUI() {
    const map = { moveUp: 'up', moveDown: 'down', moveLeft: 'left', moveRight: 'right' };
    Object.entries(map).forEach(([id, dir]) => {
      const el = $(id);
      if (el) el.addEventListener('click', () => move(dir));
    });
    const rb = $('restartButton'); if (rb) rb.addEventListener('click', restartLevel);
    const nb = $('nextButton');    if (nb) nb.addEventListener('click', nextLevel);
    const pb = $('pauseButton');   if (pb) pb.addEventListener('click', togglePause);
  }

  /* ---------- بدء ---------- */
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => { pointerStart = null; });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('drder:move', e => {
    if (e.detail && e.detail.direction) move(e.detail.direction);
  });
  document.addEventListener('drder:restart', restartLevel);
  document.addEventListener('drder:pause', togglePause);
  document.addEventListener('drder:next', nextLevel);
  window.addEventListener('resize', () => syncCanvas());

  loadProgress();
  generateWorld();
  bindUI();
  updateStats();
  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(frame);

  /* واجهة للتفتيش */
  window.DrDerLight = {
    getGameState: () => ({
      level, moves, crystals, won, paused, bestLevel, completedLevels,
      player: { ...player }, worldLength
    })
  };
})();
