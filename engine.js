
/* DrDer-light — engine.js
   منظور خلف الكرة، طريق ذهبي واسع، وعالم متجدد حسب المرحلة.
   يعتمد على window.DrDerLight و gameCanvas الموجودين في index.html.
*/
(function () {
  'use strict';

  const app = window.DrDerLight;
  if (!app || !app.canvas || !app.ctx) {
    console.error('DrDer-light: لم يتم العثور على Canvas.');
    return;
  }

  const canvas = app.canvas;
  const ctx = app.ctx;

  const SAVE_KEY = 'drder-light-progress-v1';
  const LANES = 7;
  const CENTER_LANE = 3;
  const GOLD = '#f4cf63';
  const GOLD_LIGHT = '#fff0a0';
  const GOLD_DARK = '#8f7220';
  const BG = '#080806';

  let level = 1;
  let moves = 0;
  let crystals = 0;
  let elapsed = 0;
  let paused = false;
  let won = false;
  let animationId = 0;
  let lastFrame = 0;
  let lastSecond = 0;
  let message = '';
  let messageUntil = 0;
  let pointerStart = null;
  let touchCooldown = 0;

  let player = {
    lane: CENTER_LANE,
    z: 0,
    visualLane: CENTER_LANE,
    visualZ: 0
  };

  let worldLength = 54;
  let route = [];
  let blocks = new Set();
  let crystalPositions = [];
  let portalZ = worldLength - 2;

  function dimensions() {
    const rect = canvas.getBoundingClientRect();
    return {
      w: Math.max(1, rect.width),
      h: Math.max(1, rect.height)
    };
  }

  function syncCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    const targetWidth = Math.round(w * ratio);
    const targetHeight = Math.round(h * ratio);

    if (
      canvas.width !== targetWidth ||
      canvas.height !== targetHeight
    ) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function rand(seed) {
    let value = Math.sin(seed * 127.1 + level * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function key(lane, z) {
    return lane + ':' + z;
  }

  function routeLane(z) {
    const index = Math.max(0, Math.min(route.length - 1, Math.floor(z)));
    return route[index] ?? CENTER_LANE;
  }

  function isOpen(lane, z) {
    if (lane < 0 || lane >= LANES || z < 0 || z > worldLength) {
      return false;
    }

    if (z <= 1) return lane === CENTER_LANE;

    const target = routeLane(z);

    if (lane === target) return true;

    if (Math.abs(lane - target) === 1) {
      return rand(z * 19 + lane * 7) > 0.40;
    }

    return false;
  }

  function isBlocked(lane, z) {
    return blocks.has(key(lane, Math.round(z)));
  }

  function canStand(lane, z) {
    return isOpen(lane, z) && !isBlocked(lane, z);
  }

  function generateWorld() {
    worldLength = Math.min(54 + level * 4, 180);
    portalZ = worldLength - 2;

    route = [CENTER_LANE];
    blocks = new Set();
    crystalPositions = [];

    let currentLane = CENTER_LANE;

    for (let z = 1; z <= worldLength; z++) {
      if (z > 2 && rand(z * 3 + 11) > 0.57) {
        const change = rand(z * 5 + 17) > 0.5 ? 1 : -1;
        currentLane = Math.max(
          1,
          Math.min(LANES - 2, currentLane + change)
        );
      }

      route[z] = currentLane;
    }

    // مسار مضمون ومتصّل: كل صف يفتح المسار الرئيسي
    // وممرًا انتقاليًا عند تغير اتجاه الطريق.
    for (let z = 2; z < worldLength - 1; z++) {
      const mainLane = routeLane(z);

      for (let lane = 0; lane < LANES; lane++) {
        const distance = Math.abs(lane - mainLane);
        const sideChance = rand(z * 13 + lane * 31);

        if (distance > 0 && sideChance > 0.43) {
          blocks.add(key(lane, z));
        }
      }

      // منع سد المسار الرئيسي أو إغلاق الانتقال إليه.
      blocks.delete(key(mainLane, z));
      blocks.delete(key(routeLane(z - 1), z));
    }

    // بلورتان على مسار يمكن الوصول إليه.
    const firstCrystalZ = Math.max(7, Math.floor(worldLength * 0.24));
    const secondCrystalZ = Math.max(
      firstCrystalZ + 7,
      Math.floor(worldLength * 0.58)
    );

    crystalPositions = [
      {
        lane: routeLane(firstCrystalZ),
        z: firstCrystalZ,
        collected: false
      },
      {
        lane: routeLane(secondCrystalZ),
        z: secondCrystalZ,
        collected: false
      }
    ];

    // ضمان بقاء الممر مفتوحًا عند البلورات.
    crystalPositions.forEach(function (crystal) {
      blocks.delete(key(crystal.lane, crystal.z));
    });
  }

  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        level: level,
        bestLevel: level,
        savedAt: Date.now()
      }));
    } catch (error) {
      console.warn('DrDer-light: تعذر حفظ التقدم.', error);
    }
  }

  function loadProgress() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (Number.isFinite(saved.level) && saved.level > 0) {
        level = Math.floor(saved.level);
      }
    } catch (error) {
      level = 1;
    }
  }

  function updateStats() {
    if (typeof app.updateStats === 'function') {
      app.updateStats({
        level: level,
        moves: moves,
        crystals: crystals,
        time: elapsed,
        won: won,
        paused: paused
      });
    }

    const levelEl = document.getElementById('levelValue');
    const movesEl = document.getElementById('movesValue');
    const crystalsEl = document.getElementById('crystalsValue');
    const timeEl = document.getElementById('timeValue');

    if (levelEl) levelEl.textContent = String(level);
    if (movesEl) movesEl.textContent = String(moves);
    if (crystalsEl) crystalsEl.textContent = crystals + '/2';

    if (timeEl) {
      const mins = Math.floor(elapsed / 60);
      const secs = Math.floor(elapsed % 60);
      timeEl.textContent =
        String(mins).padStart(2, '0') + ':' +
        String(secs).padStart(2, '0');
    }

    const nextButton = document.getElementById('nextButton');
    if (nextButton) nextButton.disabled = !won;
  }

  function say(text, duration) {
    message = text;
    messageUntil = performance.now() + (duration || 1800);
  }

  // إسقاط منظور خلف الكرة.
  // جعل عرض الطريق أكبر وإظهار مساحة أوسع من المشهد.
  function project(lane, z, lift) {
    const size = dimensions();
    const w = size.w;
    const h = size.h;

    const horizon = h * 0.265;
    const distance = z - player.visualZ;

    const perspective = 1 / (1 + Math.max(0, distance) * 0.075);
    const scale = Math.max(0.075, Math.min(2.05, perspective));

    const laneWidth = w * 0.19 * scale;
    const x = w * 0.5 +
      (lane - player.visualLane) * laneWidth;

    const y = horizon + h * 0.79 * scale - (lift || 0) * scale;

    return {
      x: x,
      y: y,
      scale: scale,
      laneWidth: laneWidth,
      horizon: horizon
    };
  }

  function polygon(points, fill, stroke, lineWidth) {
    if (!points || points.length < 3) return;

    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);

    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i][0], points[i][1]);
    }

    ctx.closePath();

    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }

    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth || 1;
      ctx.stroke();
    }
  }

  function drawSky(w, h) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#080807');
    gradient.addColorStop(0.40, '#100d05');
    gradient.addColorStop(0.72, '#090805');
    gradient.addColorStop(1, '#050505');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const horizon = h * 0.265;
    const glow = ctx.createRadialGradient(
      w * 0.5, horizon, 1,
      w * 0.5, horizon, w * 0.72
    );

    glow.addColorStop(0, 'rgba(200,150,35,0.12)');
    glow.addColorStop(0.55, 'rgba(120,80,15,0.035)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h * 0.8);

    // خطوط أفقية ناعمة في المسافة.
    ctx.strokeStyle = 'rgba(190,145,48,0.045)';
    ctx.lineWidth = 1;

    for (let i = 0; i < 7; i++) {
      const y = horizon + i * i * h * 0.008;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // خطوط منظور ممتدة نحو الأفق.
    ctx.strokeStyle = 'rgba(205,161,61,0.22)';
    ctx.lineWidth = 1;

    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(w * 0.5 + i * 2, horizon);
      ctx.lineTo(w * 0.5 + i * w * 0.105, h * 1.04);
      ctx.stroke();
    }

    // شبكة الأرضية.
    ctx.strokeStyle = 'rgba(187,143,45,0.10)';

    for (let i = 1; i <= 13; i++) {
      const t = i / 13;
      const y = horizon + (h - horizon) * t * t;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
  }

  function drawTile(lane, z, w, h) {
    const near = project(lane, z, 0);
    const far = project(lane, z + 1, 0);

    if (near.y < h * 0.19 || far.y > h * 1.35) return;

    const leftNear = near.x - near.laneWidth * 0.5;
    const rightNear = near.x + near.laneWidth * 0.5;
    const leftFar = far.x - far.laneWidth * 0.5;
    const rightFar = far.x + far.laneWidth * 0.5;

    const open = isOpen(lane, z);
    const blocked = isBlocked(lane, z);

    let fill = '#0c0b08';

    if (open) {
      fill = (z + lane) % 2 === 0 ? '#151107' : '#100d07';
    }

    polygon([
      [leftFar, far.y],
      [rightFar, far.y],
      [rightNear, near.y],
      [leftNear, near.y]
    ], fill, 'rgba(203,157,56,0.28)', 1);

    if (open) {
      ctx.strokeStyle = 'rgba(232,188,78,0.28)';
      ctx.lineWidth = Math.max(0.6, near.scale * 0.8);

      ctx.beginPath();
      ctx.moveTo(leftNear, near.y);
      ctx.lineTo(leftFar, far.y);
      ctx.moveTo(rightNear, near.y);
      ctx.lineTo(rightFar, far.y);
      ctx.stroke();
    }

    if (blocked && z > player.z + 1) {
      const depth = Math.max(2, near.scale * h * 0.035);
      const topY = near.y - depth;
      const side = Math.max(1, near.scale * w * 0.009);

      // واجهة الكتلة.
      polygon([
        [leftNear, topY],
        [rightNear, topY],
        [rightNear, near.y],
        [leftNear, near.y]
      ], '#080807', 'rgba(162,126,47,0.36)', 1);

      // السطح العلوي.
      polygon([
        [leftFar, far.y],
        [rightFar, far.y],
        [rightNear, topY],
        [leftNear, topY]
      ], '#17130b', 'rgba(170,131,47,0.28)', 1);

      // جانب الكتلة لإبراز العمق.
      polygon([
        [rightNear, topY],
        [rightNear, near.y],
        [rightNear + side, near.y + side * 0.35],
        [rightNear + side, topY + side * 0.35]
      ], '#0b0a07', 'rgba(170,131,47,0.20)', 0.8);
    }
  }

  function drawCrystal(crystal, w, h) {
    if (crystal.collected) return;

    const p = project(crystal.lane, crystal.z, h * 0.06);

    if (p.y < h * 0.20 || p.y > h * 1.05) return;
    if (p.x < -w * 0.15 || p.x > w * 1.15) return;

    const size = Math.max(2, Math.min(22, w * 0.026 * p.scale * 4));

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = size * 1.5;

    polygon([
      [0, -size],
      [size * 0.62, 0],
      [0, size],
      [-size * 0.62, 0]
    ], GOLD, GOLD_LIGHT, 1.2);

    ctx.restore();
  }

  function drawPortal(w, h) {
    const p = project(routeLane(portalZ), portalZ, 0);

    if (p.y < h * 0.19 || p.y > h * 1.25) return;
    if (p.x < -w * 0.3 || p.x > w * 1.3) return;

    const width = Math.max(5, p.laneWidth * 0.72);
    const height = width * 1.55;

    ctx.save();
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 18 * p.scale;

    ctx.strokeStyle = GOLD;
    ctx.lineWidth = Math.max(1, 3 * p.scale);

    ctx.beginPath();
    ctx.moveTo(p.x - width * 0.5, p.y);
    ctx.lineTo(p.x - width * 0.5, p.y - height);
    ctx.quadraticCurveTo(
      p.x, p.y - height * 1.22,
      p.x + width * 0.5, p.y - height
    );
    ctx.lineTo(p.x + width * 0.5, p.y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,226,130,0.65)';
    ctx.lineWidth = Math.max(0.6, p.scale);

    ctx.beginPath();
    ctx.moveTo(p.x - width * 0.34, p.y);
    ctx.lineTo(p.x - width * 0.34, p.y - height * 0.94);
    ctx.quadraticCurveTo(
      p.x, p.y - height * 1.11,
      p.x + width * 0.34, p.y - height * 0.94
    );
    ctx.lineTo(p.x + width * 0.34, p.y);
    ctx.stroke();

    ctx.restore();
  }

  function drawPlayer(w, h) {
    const x = w * 0.5;
    const y = h * 0.765;
    const radius = Math.max(9, Math.min(w, h) * 0.036);

    const glow = ctx.createRadialGradient(
      x, y, 1,
      x, y, radius * 3.8
    );

    glow.addColorStop(0, 'rgba(255,226,120,0.58)');
    glow.addColorStop(0.28, 'rgba(241,185,55,0.25)');
    glow.addColorStop(1, 'rgba(255,190,40,0)');

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 3.8, 0, Math.PI * 2);
    ctx.fill();

    // ظل الكرة على الطريق.
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(
      x, y + radius * 1.2,
      radius * 1.15, radius * 0.35,
      0, 0, Math.PI * 2
    );
    ctx.fill();

    const ball = ctx.createRadialGradient(
      x - radius * 0.32,
      y - radius * 0.38,
      radius * 0.05,
      x, y, radius
    );

    ball.addColorStop(0, '#fffbd6');
    ball.addColorStop(0.28, '#ffe88b');
    ball.addColorStop(0.64, '#e7ae32');
    ball.addColorStop(1, '#8b5812');

    ctx.save();
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 16;

    ctx.fillStyle = ball;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

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
    ctx.fillText('البلورات ' + crystals + '/2', w * 0.5, 22);
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
    ctx.roundRect(x - width / 2, y - 20, width, 40, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText(message, x, y);
    ctx.restore();
  }

  function render() {
    syncCanvas();

    const size = dimensions();
    const w = size.w;
    const h = size.h;

    ctx.clearRect(0, 0, w, h);
    drawSky(w, h);

    // رسم البعيد أولًا، ثم الصفوف القريبة.
    const startZ = Math.floor(player.visualZ + 19);
    const endZ = Math.max(0, Math.floor(player.visualZ - 2));

    for (let z = startZ; z >= endZ; z--) {
      for (let lane = 0; lane < LANES; lane++) {
        drawTile(lane, z, w, h);
      }

      crystalPositions.forEach(function (crystal) {
        if (crystal.z === z) drawCrystal(crystal, w, h);
      });

      if (z === portalZ) drawPortal(w, h);
    }

    // إظهار العناصر القريبة حتى لا تختفي عند حدود المشهد.
    crystalPositions.forEach(function (crystal) {
      if (crystal.z < endZ || crystal.z > startZ) {
        drawCrystal(crystal, w, h);
      }
    });

    if (portalZ < endZ || portalZ > startZ) {
      drawPortal(w, h);
    }

    drawPlayer(w, h);
    drawHUD(w);
    drawMessage(w, h);
    drawOverlay(w, h);

    updateStats();
  }

  function collectCrystals() {
    crystalPositions.forEach(function (crystal) {
      if (
        !crystal.collected &&
        crystal.z === player.z &&
        crystal.lane === player.lane
      ) {
        crystal.collected = true;
        crystals++;
        say('تم جمع البلورة الذهبية!');
      }
    });
  }

  function checkWin() {
    if (player.z >= portalZ && player.lane === routeLane(portalZ)) {
      if (crystals >= 2) {
        won = true;
        paused = false;
        say('اكتملت المرحلة بنجاح!');
        updateStats();
      } else {
        player.z = portalZ - 1;
        say('اجمع البلورتين أولًا');
      }
    }
  }

  function move(direction) {
    if (paused || won) return;

    let nextLane = player.lane;
    let nextZ = player.z;

    if (direction === 'left') nextLane--;
    if (direction === 'right') nextLane++;
    if (direction === 'up') nextZ++;
    if (direction === 'down') nextZ = Math.max(0, nextZ - 1);

    nextLane = Math.max(0, Math.min(LANES - 1, nextLane));

    if (nextZ === player.z && nextLane === player.lane) return;

    if (!canStand(nextLane, nextZ)) {
      say('الكتلة تمنع المرور');
      return;
    }

    player.lane = nextLane;
    player.z = nextZ;
    moves++;

    collectCrystals();
    checkWin();
    updateStats();
  }

  function restartLevel() {
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
    message = '';

    generateWorld();
    updateStats();
  }

  function nextLevel() {
    if (!won) {
      say('أكمل المرحلة أولًا');
      return;
    }

    level++;
    saveProgress();
    restartLevel();
    say('المرحلة ' + level);
  }

  function togglePause() {
    if (won) return;

    paused = !paused;
    updateStats();
  }

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    pointerStart = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now()
    };

    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (_) {}
    }
  }

  function onPointerUp(event) {
    if (!pointerStart) return;

    const dx = event.clientX - pointerStart.x;
    const dy = event.clientY - pointerStart.y;
    const duration = performance.now() - pointerStart.time;

    pointerStart = null;

    if (paused || won) return;

    const threshold = 22;

    if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) {
      if (duration < 500) {
        move('up');
      }
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) {
      move(dx < 0 ? 'left' : 'right');
    } else {
      move(dy < 0 ? 'up' : 'down');
    }
  }

  function onKeyDown(event) {
    const map = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowUp: 'up',
      ArrowDown: 'down',
      a: 'left',
      d: 'right',
      w: 'up',
      s: 'down'
    };

    const direction = map[event.key];
    if (direction) {
      event.preventDefault();
      move(direction);
    }

    if (event.key === 'Escape' || event.key === ' ') {
      event.preventDefault();
      togglePause();
    }
  }

  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', function () {
    pointerStart = null;
  });

  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('drder:move', function (event) {
    if (event.detail && event.detail.direction) {
      move(event.detail.direction);
    }
  });

  document.addEventListener('drder:restart', restartLevel);
  document.addEventListener('drder:pause', togglePause);
  document.addEventListener('drder:next', nextLevel);
  document.addEventListener('drder:resize', syncCanvas);

  const restartButton = document.getElementById('restartButton');
  const nextButton = document.getElementById('nextButton');
  const pauseButton = document.getElementById('pauseButton');

  if (restartButton) {
    restartButton.addEventListener('click', restartLevel);
  }

  if (nextButton) {
    nextButton.addEventListener('click', nextLevel);
  }

  if (pauseButton) {
    pauseButton.addEventListener('click', togglePause);
  }

  function frame(time) {
    animationId = requestAnimationFrame(frame);

    if (!lastFrame) lastFrame = time;
    const delta = Math.min(0.1, (time - lastFrame) / 1000);
    lastFrame = time;

    if (!paused && !won) {
      elapsed += delta;

      // حركة سلسة للكاميرا خلف الكرة.
      player.visualLane += (player.lane - player.visualLane) * 0.18;
      player.visualZ += (player.z - player.visualZ) * 0.18;

      if (time - lastSecond >= 250) {
        lastSecond = time;
        updateStats();
      }
    }

    render();
  }

  loadProgress();
  generateWorld();
  updateStats();
  syncCanvas();
  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(frame);
})();
