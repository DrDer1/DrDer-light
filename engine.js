/* DrDer-Light — engine.js
   متاهة واقعية بمنظور خلف الكرة.
   توليد إجرائي مضمون الحل، جدران سوداء واضحة، مسار ذهبي متعرج.
*/
(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const SAVE_KEY = 'drder-light-save-v4';
  const LANES = 7;
  const CRYSTAL_COUNT = 2;
  const MOVE_COOLDOWN = 110;

  const GOLD = '#f4cf63';
  const GOLD_LIGHT = '#fff0a0';

  let level = 1;
  let bestTimes = {};
  let moves = 0;
  let crystals = 0;
  let elapsed = 0;
  let paused = false;
  let won = false;
  let success = false;
  let message = '';
  let messageUntil = 0;
  let animationId = 0;
  let lastFrame = 0;
  let lastTick = 0;
  let lastMoveTime = 0;

  let player = { lane: 3, row: 0, vLane: 3, vRow: 0 };
  let worldLength = 45;
  let map = [];
  let crystalsPos = [];
  let portal = { row: 0, lane: 3 };
  let pointerStart = null;
  let audioCtx = null;

  const $ = id => document.getElementById(id);

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  function generateWorld() {
    worldLength = Math.min(180, 45 + level * 3);
    const rng = makeRng(level * 977 + 12345);

    map = Array.from({ length: worldLength }, () => Array(LANES).fill(1));

    let lane = 3;
    const path = [];
    map[0][3] = 0;
    path.push({ lane: 3, row: 0 });

    for (let row = 1; row < worldLength; row++) {
      const shift = rng();
      if (shift < 0.22 && lane > 1) lane--;
      else if (shift < 0.44 && lane < LANES - 2) lane++;
      map[row][lane] = 0;
      path.push({ lane, row });
    }

    for (let row = 1; row < worldLength - 1; row++) {
      const mainLane = path[row].lane;
      for (let l = 1; l < LANES - 1; l++) {
        if (l === mainLane) continue;
        if (rng() > 0.55) map[row][l] = 0;
      }
      const prev = path[row - 1].lane;
      if (prev !== mainLane) {
        const minL = Math.min(prev, mainLane);
        const maxL = Math.max(prev, mainLane);
        for (let l = minL; l <= maxL; l++) map[row][l] = 0;
      }
    }

    map[0][3] = 0;
    map[1][3] = 0;

    const portalRow = worldLength - 1;
    const portalLane = path[portalRow].lane;
    portal = { row: portalRow, lane: portalLane };
    map[portalRow][portalLane] = 0;
    map[portalRow - 1][portalLane] = 0;

    crystalsPos = [];
    const z1 = Math.max(6, Math.floor(worldLength * 0.30));
    const z2 = Math.max(z1 + 8, Math.floor(worldLength * 0.68));
    [z1, z2].forEach(z => {
      const l = path[z].lane;
      map[z][l] = 0;
      crystalsPos.push({ lane: l, row: z, collected: false });
    });

    player = { lane: 3, row: 0, vLane: 3, vRow: 0 };
  }

  function isOpen(lane, row) {
    if (lane < 0 || lane >= LANES) return false;
    if (row < 0 || row >= worldLength) return false;
    return map[row][lane] === 0;
  }

  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ level, bestTimes, savedAt: Date.now() }));
    } catch (_) {}
  }

  function loadProgress() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (Number.isFinite(s.level) && s.level >= 1) level = Math.floor(s.level);
      if (s.bestTimes && typeof s.bestTimes === 'object') bestTimes = s.bestTimes;
    } catch (_) { level = 1; bestTimes = {}; }
  }

  function formatTime(sec) {
    const t = Math.max(0, Math.floor(sec));
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' +
           String(t % 60).padStart(2, '0');
  }

  function updateStats() {
    const lv = $('levelValue');
    const cr = $('crystalsValue');
    const tm = $('timeValue');
    const bt = $('bestValue');
    const nb = $('nextButton');
    const pb = $('pauseButton');
    if (lv) lv.textContent = String(level);
    if (cr) cr.textContent = crystals + '/' + CRYSTAL_COUNT;
    if (tm) tm.textContent = formatTime(elapsed);
    if (bt) {
      const b = bestTimes[String(level)];
      bt.textContent = b ? formatTime(b) : '--:--';
    }
    if (nb) nb.disabled = !won;
    if (pb) pb.textContent = paused ? '▶' : 'Ⅱ';
  }

  function say(text, duration = 1500) {
    message = text;
    messageUntil = performance.now() + duration;
  }

  function tone(freq, dur, vol) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + dur);
    } catch (_) {}
  }

  const sound = {
    move: () => tone(520, 0.05, 0.025),
    crystal: () => { tone(880, 0.10, 0.05); setTimeout(() => tone(1320, 0.14, 0.04), 70); },
    win: () => { tone(660, 0.14, 0.06); setTimeout(() => tone(990, 0.14, 0.06), 90); setTimeout(() => tone(1320, 0.22, 0.055), 200); },
    block: () => tone(180, 0.08, 0.03)
  };

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

  function project(lane, row, lift, dims) {
    const { w, h } = dims;
    const horizon = h * 0.28;
    const dist = row - player.vRow;
    const clamped = Math.max(-1, dist);
    const persp = 1 / (1 + Math.max(0, clamped) * 0.10);
    const scale = Math.max(0.06, Math.min(2.2, persp));
    const laneW = w * 0.155 * scale;
    const x = w * 0.5 + (lane - player.vLane) * laneW;
    const y = horizon + h * 0.82 * scale - (lift || 0) * scale;
    return { x, y, scale, laneW, horizon };
  }

  function poly(pts, fill, stroke, lw) {
    if (!pts || pts.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  function drawSky(w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#030202');
    g.addColorStop(0.35, '#0d0a05');
    g.addColorStop(0.7, '#060504');
    g.addColorStop(1, '#020202');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const horizon = h * 0.28;
    const glow = ctx.createRadialGradient(w * 0.5, horizon, 1, w * 0.5, horizon, w * 0.65);
    glow.addColorStop(0, 'rgba(230,175,45,0.16)');
    glow.addColorStop(0.5, 'rgba(140,95,20,0.05)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h * 0.75);
  }

  function drawTile(lane, row, dims) {
    const near = project(lane, row, 0, dims);
    const far = project(lane, row + 1, 0, dims);
    const { h } = dims;
    if (near.y < h * 0.18 || far.y > h * 1.6) return;

    const ln = near.x - near.laneW * 0.5;
    const rn = near.x + near.laneW * 0.5;
    const lf = far.x - far.laneW * 0.5;
    const rf = far.x + far.laneW * 0.5;

    const open = isOpen(lane, row);

    if (open) {
      const fill = (lane + row) % 2 === 0 ? '#1c1709' : '#141009';
      poly([[lf, far.y], [rf, far.y], [rn, near.y], [ln, near.y]], fill, 'rgba(220,175,60,0.30)', 1);
      ctx.strokeStyle = 'rgba(255,220,130,0.45)';
      ctx.lineWidth = Math.max(0.5, near.scale * 0.9);
      ctx.beginPath();
      ctx.moveTo(ln, near.y); ctx.lineTo(lf, far.y);
      ctx.moveTo(rn, near.y); ctx.lineTo(rf, far.y);
      ctx.stroke();
    } else {
      const depth = Math.max(8, near.scale * h * 0.10);
      const farDepth = depth * (far.scale / Math.max(0.05, near.scale));
      const topY = near.y - depth;
      const farTopY = far.y - farDepth;

      poly([[lf, farTopY], [rf, farTopY], [rn, topY], [ln, topY]], '#0f0d08', 'rgba(255,210,100,0.42)', 1.1);
      poly([[ln, topY], [rn, topY], [rn, near.y], [ln, near.y]], '#020202', 'rgba(200,160,60,0.55)', 1);

      ctx.save();
      ctx.strokeStyle = 'rgba(255,220,120,0.55)';
      ctx.lineWidth = Math.max(0.7, near.scale * 1.2);
      ctx.beginPath();
      ctx.moveTo(ln, topY); ctx.lineTo(rn, topY);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCrystal(c, dims, time) {
    if (c.collected) return;
    const p = project(c.lane, c.row, dims.h * 0.06, dims);
    if (p.y < dims.h * 0.18 || p.y > dims.h * 1.15) return;
    if (p.x < -dims.w * 0.15 || p.x > dims.w * 1.15) return;

    const bob = Math.sin(time / 220) * 3 * p.scale;
    const size = Math.max(4, Math.min(24, dims.w * 0.028 * p.scale * 4));

    ctx.save();
    ctx.translate(p.x, p.y + bob);
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = size * 1.8;
    poly([
      [0, -size * 1.3],
      [size * 0.62, -size * 0.15],
      [0, size * 0.95],
      [-size * 0.62, -size * 0.15]
    ], GOLD, GOLD_LIGHT, 1.2);
    poly([
      [0, -size * 1.3],
      [size * 0.62, -size * 0.15],
      [0, size * 0.15]
    ], '#ffe98a', null, 0);
    ctx.restore();
  }

  function drawPortal(dims, time) {
    const p = project(portal.lane, portal.row, 0, dims);
    if (p.y < dims.h * 0.18 || p.y > dims.h * 1.25) return;
    if (p.x < -dims.w * 0.3 || p.x > dims.w * 1.3) return;

    const width = Math.max(6, p.laneW * 0.75);
    const height = width * 1.55;
    const pulse = 1 + Math.sin(time / 210) * 0.06;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 22 * p.scale;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1.2, 3 * p.scale);
    ctx.beginPath();
    ctx.moveTo(-width * 0.5, 0);
    ctx.lineTo(-width * 0.5, -height);
    ctx.quadraticCurveTo(0, -height * 1.22, width * 0.5, -height);
    ctx.lineTo(width * 0.5, 0);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,226,130,0.7)';
    ctx.lineWidth = Math.max(0.6, p.scale);
    ctx.beginPath();
    ctx.moveTo(-width * 0.34, 0);
    ctx.lineTo(-width * 0.34, -height * 0.94);
    ctx.quadraticCurveTo(0, -height * 1.11, width * 0.34, -height * 0.94);
    ctx.lineTo(width * 0.34, 0);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(w, h) {
    const x = w * 0.5;
    const y = h * 0.80;
    const r = Math.max(10, Math.min(w, h) * 0.04);

    const glow = ctx.createRadialGradient(x, y, 1, x, y, r * 4);
    glow.addColorStop(0, 'rgba(255,226,120,0.55)');
    glow.addColorStop(0.3, 'rgba(241,185,55,0.22)');
    glow.addColorStop(1, 'rgba(255,190,40,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 1.15, r * 1.2, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const ball = ctx.createRadialGradient(x - r * 0.32, y - r * 0.38, r * 0.05, x, y, r);
    ball.addColorStop(0, '#fffbd6');
    ball.addColorStop(0.28, '#ffe88b');
    ball.addColorStop(0.64, '#e7ae32');
    ball.addColorStop(1, '#8b5812');

    ctx.save();
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 18;
    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,245,187,0.9)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  }

  function drawMessage(w, h) {
    if (!message || performance.now() > messageUntil) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px system-ui, sans-serif';
    const width = Math.min(w - 40, 320);
    const x = w * 0.5;
    const y = h * 0.66;
    ctx.fillStyle = 'rgba(8,7,4,0.9)';
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
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.68)';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 14;
      ctx.fillStyle = GOLD_LIGHT;
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.fillText('اللعبة متوقفة', w * 0.5, h * 0.48);
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillStyle = '#fff4cf';
      ctx.fillText('اضغط زر التشغيل للاستئناف', w * 0.5, h * 0.55);
      ctx.restore();
    }

    if (success) {
      ctx.fillStyle = 'rgba(0,0,0,0.82)';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 20;
      ctx.fillStyle = GOLD_LIGHT;
      ctx.font = 'bold 28px system-ui, sans-serif';
      ctx.fillText('اكتملت المرحلة!', w * 0.5, h * 0.30);
      ctx.shadowBlur = 8;
      ctx.font = 'bold 16px system-ui, sans-serif';
      ctx.fillStyle = '#fff4cf';
      ctx.fillText('المرحلة ' + level, w * 0.5, h * 0.42);
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('الوقت: ' + formatTime(elapsed), w * 0.5, h * 0.50);
      const best = bestTimes[String(level)];
      if (best && Math.abs(best - elapsed) < 0.5) {
        ctx.fillStyle = GOLD_LIGHT;
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText('★ رقم قياسي جديد!', w * 0.5, h * 0.57);
      }
      ctx.fillStyle = '#fff4cf';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText('اضغط «المرحلة التالية» للمتابعة', w * 0.5, h * 0.66);
      ctx.restore();
    }
  }

  function render(time) {
    const dims = syncCanvas();
    const { w, h } = dims;

    ctx.clearRect(0, 0, w, h);
    drawSky(w, h);

    const startRow = Math.floor(player.vRow + 22);
    const endRow = Math.max(0, Math.floor(player.vRow - 2));

    for (let row = startRow; row >= endRow; row--) {
      for (let lane = 0; lane < LANES; lane++) {
        drawTile(lane, row, dims);
      }
      crystalsPos.forEach(c => { if (c.row === row) drawCrystal(c, dims, time); });
      if (row === portal.row) drawPortal(dims, time);
    }

    crystalsPos.forEach(c => {
      if (c.row < endRow || c.row > startRow) drawCrystal(c, dims, time);
    });
    if (portal.row < endRow || portal.row > startRow) drawPortal(dims, time);

    drawPlayer(w, h);
    drawMessage(w, h);
    drawOverlay(w, h);
  }

  function collectCrystals() {
    crystalsPos.forEach(c => {
      if (!c.collected && c.row === player.row && c.lane === player.lane) {
        c.collected = true;
        crystals++;
        sound.crystal();
        say('تم جمع البلورة الذهبية!');
        updateStats();
      }
    });
  }

  function checkWin() {
    if (player.row === portal.row && player.lane === portal.lane) {
      if (crystals >= CRYSTAL_COUNT) {
        finishLevel();
      } else {
        player.row = Math.max(0, portal.row - 1);
        say('اجمع البلورتين أولًا');
      }
    }
  }

  function finishLevel() {
    won = true;
    paused = false;
    success = true;
    const key = String(level);
    const prev = bestTimes[key];
    if (!prev || elapsed < prev) bestTimes[key] = Math.round(elapsed * 10) / 10;
    saveProgress();
    sound.win();
    updateStats();
  }

  function move(direction) {
    if (paused || won) return;
    const now = performance.now();
    if (now - lastMoveTime < MOVE_COOLDOWN) return;
    lastMoveTime = now;

    let nl = player.lane;
    let nr = player.row;

    if (direction === 'left') nl--;
    else if (direction === 'right') nl++;
    else if (direction === 'up') nr++;
    else if (direction === 'down') nr = Math.max(0, nr - 1);
    else return;

    nl = Math.max(0, Math.min(LANES - 1, nl));
    nr = Math.max(0, Math.min(worldLength - 1, nr));

    if (nl === player.lane && nr === player.row) return;

    if (!isOpen(nl, nr)) {
      sound.block();
      say('جدار أسود يسد الطريق');
      return;
    }

    player.lane = nl;
    player.row = nr;
    moves++;
    sound.move();
    collectCrystals();
    checkWin();
    updateStats();
  }

  function restartLevel() {
    if (won && !confirm('سيتم فقدان نتيجة المرحلة الحالية. متابعة؟')) return;
    moves = 0;
    crystals = 0;
    elapsed = 0;
    paused = false;
    won = false;
    success = false;
    message = '';
    generateWorld();
    say('المرحلة ' + level);
    updateStats();
  }

  function nextLevel() {
    if (!won) { say('أكمل المرحلة أولًا'); return; }
    level++;
    saveProgress();
    moves = 0;
    crystals = 0;
    elapsed = 0;
    paused = false;
    won = false;
    success = false;
    message = '';
    generateWorld();
    say('المرحلة ' + level);
    updateStats();
  }

  function togglePause() {
    if (won) return;
    paused = !paused;
    say(paused ? 'تم إيقاف اللعبة' : 'استأنفت اللعب', 1100);
    updateStats();
  }

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerStart = { x: e.clientX, y: e.clientY, time: performance.now(), id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function onPointerUp(e) {
    if (!pointerStart || pointerStart.id !== e.pointerId) return;
    const dx = e.clientX - pointerStart.x;
    const dy = e.clientY - pointerStart.y;
    const dur = performance.now() - pointerStart.time;
    pointerStart = null;
    if (paused || won) return;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);
    const SWIPE = 24;

    if (absX < SWIPE && absY < SWIPE) {
      if (dur < 400) move('up');
      return;
    }

    if (absX > absY) {
      move(dx < 0 ? 'left' : 'right');
    } else {
      move(dy < 0 ? 'up' : 'down');
    }
  }

  function onKeyDown(e) {
    const map = {
      ArrowLeft: 'left', ArrowRight: 'right',
      ArrowUp: 'up', ArrowDown: 'down',
      a: 'left', d: 'right', w: 'up', s: 'down'
    };
    const d = map[e.key];
    if (d) { e.preventDefault(); move(d); return; }
    if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); togglePause(); }
  }

  function frame(time) {
    animationId = requestAnimationFrame(frame);
    if (!lastFrame) lastFrame = time;
    const delta = Math.min(0.1, (time - lastFrame) / 1000);
    lastFrame = time;

    if (!paused && !won) {
      elapsed += delta;
      const lerp = 1 - Math.pow(0.0005, delta);
      player.vLane += (player.lane - player.vLane) * lerp;
      player.vRow += (player.row - player.vRow) * lerp;
      if (time - lastTick >= 250) { lastTick = time; updateStats(); }
    }

    render(time);
  }

  function bindUI() {
    const rb = $('restartButton');
    const nb = $('nextButton');
    const pb = $('pauseButton');
    const cap = $('caption');
    if (rb) rb.addEventListener('click', restartLevel);
    if (nb) nb.addEventListener('click', nextLevel);
    if (pb) pb.addEventListener('click', togglePause);
    if (cap) setTimeout(() => cap.classList.add('hidden'), 6000);
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => { pointerStart = null; });
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('drder:move', e => { if (e.detail && e.detail.direction) move(e.detail.direction); });
  document.addEventListener('drder:restart', restartLevel);
  document.addEventListener('drder:pause', togglePause);
  document.addEventListener('drder:next', nextLevel);
  window.addEventListener('resize', () => syncCanvas());
  window.addEventListener('orientationchange', () => setTimeout(syncCanvas, 100));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && !paused && !won) togglePause();
  });

  loadProgress();
  generateWorld();
  bindUI();
  updateStats();
  syncCanvas();

  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(frame);

  window.DrDerLight = {
    getGameState: () => ({
      level, moves, crystals, won, paused,
      elapsed: Math.round(elapsed * 10) / 10,
      player: { lane: player.lane, row: player.row },
      worldLength
    })
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
})();
