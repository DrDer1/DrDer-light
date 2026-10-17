/* DrDer-Light — engine.js
   منظور خلف الكرة، طريق ذهبي، توليد إجرائي مضمون القابلية للحل.
*/
(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  if (!canvas) {
    console.error('DrDer-Light: canvas not found.');
    return;
  }
  const ctx = canvas.getContext('2d');

  /* ============ ثوابت ============ */
  const SAVE_KEY = 'drder-light-save-v2';
  const LANES = 7;
  const CENTER_LANE = 3;
  const CRYSTAL_COUNT = 2;
  const MAX_LENGTH = 180;
  const MIN_LENGTH = 45;

  const GOLD = '#f4cf63';
  const GOLD_LIGHT = '#fff0a0';

  const COLORS = {
    text: '#fff4cf',
    pathA: '#161207',
    pathB: '#0f0c07',
    pathEdge: 'rgba(203,157,56,0.30)',
    pathEdgeBright: 'rgba(232,188,78,0.32)',
    block: '#080807',
    blockTop: '#1a160c',
    blockSide: '#0a0906',
    blockEdge: 'rgba(162,126,47,0.40)',
    blockEdgeTop: 'rgba(180,140,52,0.32)',
    blockShadow: 'rgba(0,0,0,0.55)'
  };

  /* ============ حالة اللعبة ============ */
  let level = 1;
  let bestLevel = 1;
  let bestTimes = {};
  let moves = 0;
  let crystals = 0;
  let elapsed = 0;
  let paused = false;
  let won = false;
  let showSuccessScreen = false;
  let message = '';
  let messageUntil = 0;
  let animationId = 0;
  let lastFrame = 0;
  let lastSecondTick = 0;

  let player = {
    lane: CENTER_LANE,
    z: 0,
    visualLane: CENTER_LANE,
    visualZ: 0
  };

  let worldLength = MIN_LENGTH;
  let route = [];
  let blocks = new Set();
  let crystalPositions = [];
  let portalZ = 0;
  let portalLane = CENTER_LANE;

  let pointerStart = null;
  let lastMoveTime = 0;
  const MOVE_COOLDOWN = 90;

  let audioCtx = null;
  let soundMuted = false;

  /* ============ أدوات ============ */
  const $ = (id) => document.getElementById(id);

  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  const keyOf = (lane, z) => lane + ':' + z;

  function routeLane(z) {
    const i = Math.max(0, Math.min(route.length - 1, Math.floor(z)));
    return route[i] ?? CENTER_LANE;
  }

  function isOpen(lane, z) {
    if (lane < 0 || lane >= LANES) return false;
    if (z < 0 || z > worldLength) return false;
    return !blocks.has(keyOf(lane, Math.round(z)));
  }

  function canStand(lane, z) {
    return isOpen(lane, z);
  }

  /* ============ التوليد الإجرائي ============ */
  function generateWorld() {
    worldLength = Math.min(MAX_LENGTH, MIN_LENGTH + level * 3);
    const rng = makeRng(level * 9973 + 12345);

    route = new Array(worldLength + 1);
    route[0] = CENTER_LANE;

    let current = CENTER_LANE;
    let direction = 0;

    for (let z = 1; z <= worldLength; z++) {
      if (z > 2 && rng() > 0.58) {
        direction = rng() > 0.5 ? 1 : -1;
      }
      current += direction;
      current = Math.max(1, Math.min(LANES - 2, current));
      if (rng() > 0.82) direction = 0;
      route[z] = current;
    }

    blocks = new Set();

    for (let z = 2; z < worldLength - 1; z++) {
      const mainLane = routeLane(z);
      const prevLane = routeLane(z - 1);
      const nextLane = routeLane(z + 1);

      for (let lane = 0; lane < LANES; lane++) {
        if (lane === mainLane) continue;
        if (lane === prevLane) continue;
        if (lane === nextLane) continue;

        const r = rng();
        if (r > 0.42) {
          blocks.add(keyOf(lane, z));
        }
      }
    }

    portalZ = worldLength - 1;
    portalLane = routeLane(portalZ);

    for (let lane = 0; lane < LANES; lane++) {
      blocks.delete(keyOf(lane, 0));
      blocks.delete(keyOf(lane, 1));
    }
    blocks.delete(keyOf(portalLane, portalZ));
    blocks.delete(keyOf(routeLane(portalZ - 1), portalZ - 1));

    placeCrystals(rng);
  }

  function placeCrystals(rng) {
    crystalPositions = [];

    const z1 = Math.max(8, Math.floor(worldLength * 0.30));
    const z2 = Math.max(z1 + 10, Math.floor(worldLength * 0.68));

    const lane1 = routeLane(z1);
    const lane2 = routeLane(z2);

    crystalPositions.push({
      lane: lane1,
      z: z1,
      collected: false,
      phase: rng() * Math.PI * 2
    });
    crystalPositions.push({
      lane: lane2,
      z: z2,
      collected: false,
      phase: rng() * Math.PI * 2
    });

    crystalPositions.forEach(c => {
      blocks.delete(keyOf(c.lane, c.z));
      blocks.delete(keyOf(c.lane, c.z - 1));
      blocks.delete(keyOf(c.lane, c.z + 1));
    });
  }

  /* ============ حفظ / تحميل ============ */
  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        level,
        bestLevel,
        bestTimes,
        savedAt: Date.now()
      }));
    } catch (_) {}
  }

  function loadProgress() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (Number.isFinite(s.level) && s.level >= 1) level = Math.floor(s.level);
      if (Number.isFinite(s.bestLevel) && s.bestLevel >= 1) bestLevel = Math.floor(s.bestLevel);
      if (s.bestTimes && typeof s.bestTimes === 'object') bestTimes = s.bestTimes;
    } catch (_) {
      level = 1;
      bestLevel = 1;
      bestTimes = {};
    }
  }

  /* ============ UI ============ */
  function formatTime(sec) {
    const total = Math.max(0, Math.floor(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
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
      const bt2 = bestTimes[String(level)];
      bt.textContent = bt2 ? formatTime(bt2) : '--:--';
    }
    if (nb) nb.disabled = !won;
    if (pb) pb.textContent = paused ? '▶' : 'Ⅱ';
  }

  function say(text, duration = 1600) {
    message = text;
    messageUntil = performance.now() + duration;
  }

  /* ============ صوت ============ */
  function tone(freq, dur, vol) {
    if (soundMuted) return;
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
    move: () => tone(520, 0.06, 0.030),
    crystal: () => { tone(880, 0.10, 0.050); setTimeout(() => tone(1320, 0.14, 0.040), 70); },
    win: () => { tone(660, 0.14, 0.060); setTimeout(() => tone(990, 0.14, 0.060), 90); setTimeout(() => tone(1320, 0.22, 0.055), 200); },
    block: () => tone(180, 0.09, 0.035)
  };

  /* ============ Canvas / DPR ============ */
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

  /* ============ إسقاط المنظور ============ */
  function project(lane, z, lift, dims) {
    const { w, h } = dims;
    const horizon = h * 0.28;

    const distance = z - player.visualZ;
    const clamped = Math.max(-0.8, distance);

    const persp = 1 / (1 + Math.max(0, clamped) * 0.072);
    const scale = Math.max(0.08, Math.min(2.2, persp));

    const laneW = w * 0.175 * scale;
    const x = w * 0.5 + (lane - player.visualLane) * laneW;
    const y = horizon + h * 0.78 * scale - (lift || 0) * scale;

    return { x, y, scale, laneW, horizon };
  }

  function poly(points, fill, stroke, lw) {
    if (!points || points.length < 3) return;
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 1; ctx.stroke(); }
  }

  /* ============ رسم المشهد ============ */
  function drawSky(w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#050404');
    g.addColorStop(0.35, '#0f0c06');
    g.addColorStop(0.7, '#080704');
    g.addColorStop(1, '#030303');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const horizon = h * 0.28;
    const glow = ctx.createRadialGradient(w * 0.5, horizon, 1, w * 0.5, horizon, w * 0.7);
    glow.addColorStop(0, 'rgba(230,175,45,0.18)');
    glow.addColorStop(0.4, 'rgba(140,95,20,0.06)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h * 0.75);

    ctx.strokeStyle = 'rgba(205,161,61,0.20)';
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(w * 0.5 + i * 3, horizon);
      ctx.lineTo(w * 0.5 + i * w * 0.11, h * 1.05);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(190,145,48,0.07)';
    for (let i = 1; i <= 11; i++) {
      const t = i / 11;
      const y = horizon + (h - horizon) * t * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function drawTile(lane, z, dims) {
    const near = project(lane, z, 0, dims);
    const far = project(lane, z + 1, 0, dims);
    const { h, w } = dims;

    if (near.y < h * 0.20 || far.y > h * 1.5) return;

    const ln = near.x - near.laneW * 0.5;
    const rn = near.x + near.laneW * 0.5;
    const lf = far.x - far.laneW * 0.5;
    const rf = far.x + far.laneW * 0.5;

    const open = isOpen(lane, z);
    const isMain = lane === routeLane(z);
    const fill = open
      ? (isMain ? COLORS.pathA : COLORS.pathB)
      : COLORS.block;

    poly([[lf, far.y], [rf, far.y], [rn, near.y], [ln, near.y]], fill, COLORS.pathEdge, 1);

    if (open) {
      ctx.strokeStyle = COLORS.pathEdgeBright;
      ctx.lineWidth = Math.max(0.5, near.scale * 0.9);
      ctx.beginPath();
      ctx.moveTo(ln, near.y);
      ctx.lineTo(lf, far.y);
      ctx.moveTo(rn, near.y);
      ctx.lineTo(rf, far.y);
      ctx.stroke();
    }

    if (!open) {
      const depth = Math.max(3, near.scale * h * 0.045);
      const topY = near.y - depth;

      poly([[ln, topY], [rn, topY], [rn, near.y], [ln, near.y]],
        COLORS.blockSide, COLORS.blockEdge, 1);

      poly([[lf, far.y], [rf, far.y], [rn, topY], [ln, topY]],
        COLORS.blockTop, COLORS.blockEdgeTop, 1);

      ctx.save();
      ctx.strokeStyle = 'rgba(233,184,63,0.22)';
      ctx.lineWidth = Math.max(0.6, near.scale);
      ctx.beginPath();
      ctx.moveTo(ln, topY);
      ctx.lineTo(rn, topY);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCrystal(c, dims, time) {
    if (c.collected) return;
    const p = project(c.lane, c.z, dims.h * 0.05, dims);
    if (p.y < dims.h * 0.19 || p.y > dims.h * 1.1) return;
    if (p.x < -dims.w * 0.15 || p.x > dims.w * 1.15) return;

    const bob = Math.sin(time / 220 + c.phase) * 3 * p.scale;
    const size = Math.max(3, Math.min(22, dims.w * 0.024 * p.scale * 4));

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
    const p = project(portalLane, portalZ, 0, dims);
    if (p.y < dims.h * 0.19 || p.y > dims.h * 1.25) return;
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
    const y = h * 0.78;
    const r = Math.max(10, Math.min(w, h) * 0.038);

    const glow = ctx.createRadialGradient(x, y, 1, x, y, r * 4);
    glow.addColorStop(0, 'rgba(255,226,120,0.55)');
    glow.addColorStop(0.3, 'rgba(241,185,55,0.22)');
    glow.addColorStop(1, 'rgba(255,190,40,0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, r * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.beginPath();
    ctx.ellipse(x, y + r * 1.15, r * 1.2, r * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    const ball = ctx.createRadialGradient(
      x - r * 0.32, y - r * 0.38, r * 0.05,
      x, y, r
    );
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
    if (ctx.roundRect) {
      ctx.roundRect(x - width / 2, y - 20, width, 40, 10);
    } else {
      ctx.rect(x - width / 2, y - 20, width, 40);
    }
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText(message, x, y);
    ctx.restore();
  }

  function drawOverlay(w, h) {
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
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
      ctx.fillStyle = COLORS.text;
      ctx.fillText('اضغط زر التشغيل للاستئناف', w * 0.5, h * 0.55);
      ctx.restore();
    }

    if (showSuccessScreen) {
      ctx.fillStyle = 'rgba(0,0,0,0.78)';
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
      ctx.fillStyle = COLORS.text;
      ctx.fillText('المرحلة ' + level, w * 0.5, h * 0.42);

      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('الوقت: ' + formatTime(elapsed), w * 0.5, h * 0.50);

      const best = bestTimes[String(level)];
      if (best && Math.abs(best - elapsed) < 0.5) {
        ctx.fillStyle = GOLD_LIGHT;
        ctx.font = 'bold 14px system-ui, sans-serif';
        ctx.fillText('★ رقم قياسي جديد!', w * 0.5, h * 0.57);
      }

      ctx.fillStyle = COLORS.text;
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

    const startZ = Math.floor(player.visualZ + 20);
    const endZ = Math.max(0, Math.floor(player.visualZ - 2));

    for (let z = startZ; z >= endZ; z--) {
      for (let lane = 0; lane < LANES; lane++) {
        drawTile(lane, z, dims);
      }
      crystalPositions.forEach(c => {
        if (c.z === z) drawCrystal(c, dims, time);
      });
      if (z === portalZ) drawPortal(dims, time);
    }

    crystalPositions.forEach(c => {
      if (c.z < endZ || c.z > startZ) drawCrystal(c, dims, time);
    });
    if (portalZ < endZ || portalZ > startZ) drawPortal(dims, time);

    drawPlayer(w, h);
    drawMessage(w, h);
    drawOverlay(w, h);
  }

  /* ============ منطق اللعبة ============ */
  function collectCrystals() {
    crystalPositions.forEach(c => {
      if (!c.collected && c.z === player.z && c.lane === player.lane) {
        c.collected = true;
        crystals++;
        sound.crystal();
        say('تم جمع البلورة الذهبية!');
        updateStats();
      }
    });
  }

  function checkWin() {
    if (player.z >= portalZ && player.lane === portalLane) {
      if (crystals >= CRYSTAL_COUNT) {
        finishLevel();
      } else {
        player.z = Math.max(0, portalZ - 1);
        say('اجمع البلورتين أولًا');
      }
    }
  }

  function finishLevel() {
    won = true;
    paused = false;
    showSuccessScreen = true;

    bestLevel = Math.max(bestLevel, level + 1);

    const key = String(level);
    const prev = bestTimes[key];
    if (!prev || elapsed < prev) {
      bestTimes[key] = Math.round(elapsed * 10) / 10;
    }

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
    let nz = player.z;

    if (direction === 'left') nl--;
    else if (direction === 'right') nl++;
    else if (direction === 'up') nz++;
    else if (direction === 'down') nz = Math.max(0, nz - 1);
    else return;

    nl = Math.max(0, Math.min(LANES - 1, nl));
    nz = Math.max(0, Math.min(worldLength, nz));

    if (nl === player.lane && nz === player.z) return;

    if (!canStand(nl, nz)) {
      sound.block();
      say('كتلة سوداء تسد الطريق');
      return;
    }

    player.lane = nl;
    player.z = nz;
    moves++;

    sound.move();
    collectCrystals();
    checkWin();
    updateStats();
  }

  function restartLevel() {
    if (won && !confirm('سيتم فقدان نتيجة المرحلة الحالية. هل تريد المتابعة؟')) {
      return;
    }

    player = {
      lane: CENTER_LANE,
      z: 0,
      visualLane: CENTER_LANE,
      visualZ: 0
    };
    moves = 0;
    crystals = 0;
    elapsed = 0;
    paused = false;
    won = false;
    showSuccessScreen = false;
    message = '';

    generateWorld();
    say('المرحلة ' + level);
    updateStats();
  }

  function nextLevel() {
    if (!won) {
      say('أكمل المرحلة أولًا');
      return;
    }

    level++;
    bestLevel = Math.max(bestLevel, level);
    saveProgress();

    player = {
      lane: CENTER_LANE,
      z: 0,
      visualLane: CENTER_LANE,
      visualZ: 0
    };
    moves = 0;
    crystals = 0;
    elapsed = 0;
    paused = false;
    won = false;
    showSuccessScreen = false;
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

  /* ============ الإدخال (لمس + لوحة مفاتيح) ============ */
  const SWIPE_MIN = 24;

  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerStart = {
      x: e.clientX,
      y: e.clientY,
      time: performance.now(),
      id: e.pointerId
    };
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

    if (absX < SWIPE_MIN && absY < SWIPE_MIN) {
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
    const dir = map[e.key];
    if (dir) {
      e.preventDefault();
      move(dir);
      return;
    }
    if (e.key === 'Escape' || e.key === ' ') {
      e.preventDefault();
      togglePause();
    }
  }

  /* ============ حلقة الرسم ============ */
  function frame(time) {
    animationId = requestAnimationFrame(frame);

    if (!lastFrame) lastFrame = time;
    const delta = Math.min(0.1, (time - lastFrame) / 1000);
    lastFrame = time;

    if (!paused && !won) {
      elapsed += delta;

      const lerpFactor = 1 - Math.pow(0.001, delta);
      player.visualLane += (player.lane - player.visualLane) * lerpFactor;
      player.visualZ += (player.z - player.visualZ) * lerpFactor;

      if (time - lastSecondTick >= 250) {
        lastSecondTick = time;
        updateStats();
      }
    }

    render(time);
  }

  /* ============ ربط الأزرار ============ */
  function bindUI() {
    const rb = $('restartButton');
    const nb = $('nextButton');
    const pb = $('pauseButton');
    const cap = $('caption');

    if (rb) rb.addEventListener('click', restartLevel);
    if (nb) nb.addEventListener('click', nextLevel);
    if (pb) pb.addEventListener('click', togglePause);

    if (cap) {
      setTimeout(() => cap.classList.add('hidden'), 6000);
    }
  }

  /* ============ تشغيل ============ */
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
      level, moves, crystals, won, paused, bestLevel,
      elapsed: Math.round(elapsed * 10) / 10,
      player: { lane: player.lane, z: player.z },
      worldLength
    })
  };

  /* تسجيل Service Worker */
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js')
        .catch(err => console.warn('SW registration failed', err));
    });
  }
})();
