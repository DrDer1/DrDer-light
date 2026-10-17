
'use strict';

(() => {
  const app = window.DrDerLight;
  if (!app || !app.canvas || !app.ctx) {
    console.error('DrDer-light: Canvas غير متاح.');
    return;
  }

  const canvas = app.canvas;
  const ctx = app.ctx;

  const SAVE_KEY = 'drder-light-progress-v1';
  const CRYSTAL_COUNT = 2;
  const LANES = 7;
  const CENTER_LANE = 3;

  const COLORS = {
    gold: '#e9b83f',
    light: '#ffdf79',
    text: '#fff4cf',
    path: '#17130b',
    edge: '#70501b',
    block: '#101010'
  };

  let level = 1;
  let bestLevel = 1;
  let completedLevels = 0;
  let moves = 0;
  let collected = 0;
  let elapsed = 0;
  let won = false;
  let paused = false;

  let worldLength = 45;
  let player = { lane: CENTER_LANE, z: 0 };
  let route = [];
  let crystals = [];
  let portalZ = 45;

  let message = '';
  let messageUntil = 0;
  let lastFrame = 0;
  let animationId = 0;
  let touchStart = null;
  let audioContext = null;

  // أبعاد الرسم المنطقية بوحدات CSS، لا بوحدات البكسل الفعلية.
  function dimensions() {
    const rect = canvas.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height)
    };
  }

  function syncCanvas() {
    const { width, height } = dimensions();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const targetWidth = Math.round(width * ratio);
    const targetHeight = Math.round(height * ratio);

    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function rand(max) {
    return Math.floor(Math.random() * max);
  }

  function loadProgress() {
    try {
      const data = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (Number.isInteger(data.level) && data.level > 0) level = data.level;
      if (Number.isInteger(data.bestLevel) && data.bestLevel > 0) {
        bestLevel = data.bestLevel;
      }
      if (Number.isInteger(data.completedLevels) && data.completedLevels >= 0) {
        completedLevels = data.completedLevels;
      }
    } catch (_) {}
  }

  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        level,
        bestLevel,
        completedLevels,
        savedAt: Date.now()
      }));
    } catch (_) {}
  }

  function say(text, duration = 1400) {
    message = text;
    messageUntil = performance.now() + duration;
  }

  function stats() {
    if (typeof app.updateStats === 'function') {
      app.updateStats({
        level,
        moves,
        collected,
        crystals: CRYSTAL_COUNT,
        time: Math.floor(elapsed / 1000),
        won,
        paused,
        bestLevel,
        completedLevels
      });
    }
  }

  function generateWorld() {
    worldLength = Math.min(45 + level * 3, 180);
    portalZ = worldLength;

    route = new Array(worldLength + 1);
    route[0] = CENTER_LANE;

    let lane = CENTER_LANE;
    let direction = 0;

    for (let z = 1; z <= worldLength; z++) {
      if (Math.random() < Math.min(0.24 + level * 0.002, 0.38)) {
        direction = rand(3) - 1;
      }

      lane += direction;
      lane = Math.max(1, Math.min(LANES - 2, lane));

      if (Math.random() < 0.15) direction = 0;
      route[z] = lane;
    }

    player = { lane: route[0], z: 0 };
    moves = 0;
    collected = 0;
    elapsed = 0;
    won = false;
    paused = false;

    placeCrystals();
    say(`المرحلة ${level}`, 1800);
    stats();
  }

  function routeLane(z) {
    const index = Math.max(0, Math.min(worldLength, Math.round(z)));
    return route[index] ?? CENTER_LANE;
  }

  function isOpen(lane, z) {
    if (z < 0 || z > worldLength || lane < 0 || lane >= LANES) {
      return false;
    }

    const main = routeLane(z);
    if (lane === main) return true;

    // ممرات جانبية متصلة بالطريق الرئيسي.
    if (Math.abs(lane - main) === 1) {
      const value = Math.abs(Math.sin(z * 12.9898 + lane * 78.233)) % 1;
      return value > 0.34;
    }

    return false;
  }

  function placeCrystals() {
    crystals = [];

    const first = Math.max(5, Math.floor(worldLength * 0.28));
    const second = Math.min(
      worldLength - 4,
      Math.max(first + 5, Math.floor(worldLength * 0.66))
    );

    [first, second].forEach((z, i) => {
      crystals.push({
        lane: routeLane(z),
        z,
        taken: false,
        phase: i * 1.7
      });
    });
  }

  /*
   * إسقاط منظور خلف الكرة.
   * نستخدم الإحداثيات المنطقية حتى لا يتضخم الرسم على شاشات الهاتف.
   */
  function project(lane, z, lift = 0) {
    const { width: w, height: h } = dimensions();

    const horizon = h * 0.28;
    const distance = z - player.z;

    // تثبيت أقرب وأبعد عمق لتجنّب قيم ضخمة أو انعكاس المشهد.
    const denominator = Math.max(0.55, 1 + distance * 0.105);
    const scale = Math.max(0.12, Math.min(1.65, 1 / denominator));

    const laneWidth = w * 0.145 * scale;
    const x = w / 2 + (lane - player.lane) * laneWidth;
    const y = horizon + h * 0.69 * scale - lift * scale;

    return { x, y, scale, laneWidth };
  }

  function polygon(points, fill, stroke, lineWidth = 1) {
    ctx.beginPath();

    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });

    ctx.closePath();

    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }

    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function drawSky(time, w, h) {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, '#030303');
    gradient.addColorStop(0.45, '#100d07');
    gradient.addColorStop(1, '#050505');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(
      w / 2, h * 0.28, 1,
      w / 2, h * 0.28, w * 0.65
    );

    glow.addColorStop(0, 'rgba(190,130,25,0.15)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.strokeStyle = 'rgba(233,184,63,0.15)';
    ctx.lineWidth = 1;

    for (let i = -5; i <= 5; i++) {
      ctx.beginPath();
      ctx.moveTo(w / 2 + i * w * 0.035, h * 0.28);
      ctx.lineTo(w / 2 + i * w * 0.33, h);
      ctx.stroke();
    }

    for (let i = 0; i < 9; i++) {
      const progress = (i / 9 + (time * 0.00007) % 1) % 1;
      const y = h * 0.28 + progress * progress * h * 0.72;

      ctx.globalAlpha = 0.04 + progress * 0.10;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawTile(lane, z, time, w, h) {
    const near = project(lane, z);
    const far = project(lane, z + 1);

    const leftNear = project(lane - 0.5, z);
    const rightNear = project(lane + 0.5, z);
    const leftFar = project(lane - 0.5, z + 1);
    const rightFar = project(lane + 0.5, z + 1);

    if (near.y < h * 0.20 || far.y > h * 1.5) return;

    if (isOpen(lane, z)) {
      polygon([
        { x: leftFar.x, y: far.y },
        { x: rightFar.x, y: far.y },
        { x: rightNear.x, y: near.y },
        { x: leftNear.x, y: near.y }
      ], COLORS.path, COLORS.edge, Math.max(0.5, near.scale));

      const pulse = 0.25 + (Math.sin(time / 280 + z) + 1) * 0.12;

      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = COLORS.light;
      ctx.shadowColor = COLORS.gold;
      ctx.shadowBlur = 8 * near.scale;
      ctx.lineWidth = Math.max(0.6, near.scale);

      ctx.beginPath();
      ctx.moveTo(leftNear.x, near.y);
      ctx.lineTo(leftFar.x, far.y);
      ctx.moveTo(rightNear.x, near.y);
      ctx.lineTo(rightFar.x, far.y);
      ctx.stroke();
      ctx.restore();
      return;
    }

    const blockHeight = Math.max(3, 38 * near.scale);
    const topY = near.y - blockHeight;

    polygon([
      { x: leftFar.x, y: far.y },
      { x: rightFar.x, y: far.y },
      { x: rightNear.x, y: near.y },
      { x: leftNear.x, y: near.y }
    ], '#080808', '#201a10', Math.max(0.5, near.scale));

    polygon([
      { x: leftNear.x, y: topY },
      { x: rightNear.x, y: topY },
      { x: rightNear.x, y: near.y },
      { x: leftNear.x, y: near.y }
    ], '#080808', '#332817', Math.max(0.5, near.scale));

    polygon([
      { x: leftNear.x, y: topY },
      { x: rightNear.x, y: topY },
      { x: rightFar.x, y: far.y - blockHeight * 0.35 },
      { x: leftFar.x, y: far.y - blockHeight * 0.35 }
    ], COLORS.block, '#352a16', Math.max(0.5, near.scale));
  }

  function drawCrystal(crystal, time, h) {
    if (crystal.taken) return;

    const p = project(crystal.lane, crystal.z, 23);
    if (p.y < h * 0.22 || p.y > h * 1.15) return;

    const bob = Math.sin(time / 220 + crystal.phase) * 3 * p.scale;
    const size = Math.max(2, 9 * p.scale);

    ctx.save();
    ctx.shadowColor = COLORS.light;
    ctx.shadowBlur = 15 * p.scale;

    polygon([
      { x: p.x, y: p.y - size * 1.7 + bob },
      { x: p.x + size * 0.7, y: p.y - size * 0.35 + bob },
      { x: p.x, y: p.y + size + bob },
      { x: p.x - size * 0.7, y: p.y - size * 0.35 + bob }
    ], '#f7ce58', '#fff1b0', Math.max(0.5, p.scale));

    ctx.restore();
  }

  function drawPortal(time, h) {
    const p = project(routeLane(portalZ), portalZ, 8);
    if (p.y < h * 0.20 || p.y > h * 1.2) return;

    const size = Math.max(3, 20 * p.scale);
    const pulse = 1 + Math.sin(time / 210) * 0.08;

    ctx.save();
    ctx.translate(p.x, p.y - size);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = COLORS.light;
    ctx.shadowBlur = 20 * p.scale;
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = Math.max(1.2, 4 * p.scale);

    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.55, size, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#fff2b0';
    ctx.lineWidth = Math.max(0.6, 1.5 * p.scale);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.33, size * 0.75, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(time, w, h) {
    const x = w / 2;
    const y = h * 0.79;
    const radius = Math.max(8, Math.min(w, h) * 0.035);
    const bob = Math.sin(time / 110) * 1.2;

    ctx.save();

    const shadow = ctx.createRadialGradient(
      x, y + radius * 0.8, 1,
      x, y + radius * 0.8, radius * 2.4
    );

    shadow.addColorStop(0, 'rgba(233,184,63,0.25)');
    shadow.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = shadow;
    ctx.beginPath();
    ctx.ellipse(x, y + radius, radius * 2.4, radius, 0, 0, Math.PI * 2);
    ctx.fill();

    const gradient = ctx.createRadialGradient(
      x - radius * 0.35, y - radius * 0.4 + bob, 1,
      x, y + bob, radius
    );

    gradient.addColorStop(0, '#fffde0');
    gradient.addColorStop(0.4, '#ffdf72');
    gradient.addColorStop(1, '#9c610e');

    ctx.shadowColor = COLORS.light;
    ctx.shadowBlur = 22;
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y + bob, radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,248,204,0.9)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(x, y + bob, radius * 0.72, Math.PI * 1.08, Math.PI * 1.85);
    ctx.stroke();

    ctx.restore();
  }

  function drawHUD(w) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = COLORS.light;
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = 7;
    ctx.fillText(`البلورات ${collected}/${CRYSTAL_COUNT}`, w / 2, 25);
    ctx.restore();
  }

  function drawOverlay(w, h) {
    if (!paused && !won) return;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, w, h);

    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.light;
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(
      won ? 'اكتملت المرحلة!' : 'اللعبة متوقفة',
      w / 2,
      h / 2 - 6
    );

    ctx.fillStyle = COLORS.text;
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(
      won ? 'اضغط «المرحلة التالية» للمتابعة' : 'اضغط زر التشغيل للاستئناف',
      w / 2,
      h / 2 + 25
    );

    ctx.restore();
  }

  function drawMessage(time, w, h) {
    if (!message || time > messageUntil || won || paused) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillStyle = COLORS.light;
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = 8;
    ctx.fillText(message, w / 2, Math.min(52, h * 0.14));
    ctx.restore();
  }

  function render(time) {
    syncCanvas();

    const { width: w, height: h } = dimensions();

    ctx.clearRect(0, 0, w, h);
    drawSky(time, w, h);

    const startZ = Math.max(0, player.z - 2);
    const endZ = Math.min(worldLength, player.z + 17);

    // ارسم الأجزاء البعيدة قبل القريبة.
    for (let z = endZ; z >= startZ; z--) {
      for (let lane = 0; lane < LANES; lane++) {
        drawTile(lane, z, time, w, h);
      }

      for (const crystal of crystals) {
        if (crystal.z === z) drawCrystal(crystal, time, h);
      }

      if (portalZ === z) drawPortal(time, h);
    }

    drawPlayer(time, w, h);
    drawHUD(w);
    drawOverlay(w, h);
    drawMessage(time, w, h);
  }

  function sound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume();

      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = 520;
      gain.gain.setValueAtTime(0.03, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(
        0.001,
        audioContext.currentTime + 0.07
      );

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.07);
    } catch (_) {}
  }

  function checkCollection() {
    for (const crystal of crystals) {
      if (
        !crystal.taken &&
        crystal.lane === player.lane &&
        crystal.z === player.z
      ) {
        crystal.taken = true;
        collected++;
        say('جمعت بلورة ذهبية!');
      }
    }

    if (player.z >= portalZ && player.lane === routeLane(portalZ)) {
      if (collected >= CRYSTAL_COUNT) {
        won = true;
        completedLevels = Math.max(completedLevels, level);
        bestLevel = Math.max(bestLevel, level + 1);
        saveProgress();
        say('أحسنت! وصلت إلى البوابة', 5000);
      } else {
        player.z = Math.max(0, portalZ - 1);
        say('اجمع البلورتين أولًا');
      }
    }

    stats();
  }

  function move(direction) {
    if (paused || won) return;

    let lane = player.lane;
    let z = player.z;

    if (direction === 'up') z++;
    else if (direction === 'down') z--;
    else if (direction === 'left') lane--;
    else if (direction === 'right') lane++;
    else return;

    lane = Math.max(0, Math.min(LANES - 1, lane));
    z = Math.max(0, Math.min(portalZ, z));

    if (lane === player.lane && z === player.z) return;

    if (!isOpen(lane, z)) {
      say('كتلة سوداء تسد الطريق');
      return;
    }

    player.lane = lane;
    player.z = z;
    moves++;

    sound();
    checkCollection();
    stats();
  }

  function restartLevel() {
    generateWorld();
    saveProgress();
    stats();
  }

  function nextLevel() {
    if (!won) {
      say('أكمل المرحلة واجمع البلورتين أولًا');
      return;
    }

    level++;
    bestLevel = Math.max(bestLevel, level);
    saveProgress();
    generateWorld();
    say(`بدأت المرحلة ${level}`);
    stats();
  }

  function togglePause() {
    if (won) return;

    paused = !paused;
    say(paused ? 'تم إيقاف اللعبة' : 'استأنفت اللعب');
    stats();
  }

  // اللمس والسحب على اللوحة مباشرة.
  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    touchStart = {
      x: event.clientX,
      y: event.clientY,
      id: event.pointerId
    };

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (_) {}
  });

  canvas.addEventListener('pointerup', event => {
    if (!touchStart || touchStart.id !== event.pointerId) return;

    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 22) {
      const rect = canvas.getBoundingClientRect();
      const ratio = (event.clientX - rect.left) / Math.max(1, rect.width);

      if (ratio < 0.34) move('left');
      else if (ratio > 0.66) move('right');
      else move('up');
    } else if (Math.abs(dx) > Math.abs(dy)) {
      move(dx < 0 ? 'left' : 'right');
    } else {
      move(dy < 0 ? 'up' : 'down');
    }

    touchStart = null;
  });

  canvas.addEventListener('pointercancel', () => {
    touchStart = null;
  });

  document.addEventListener('drder:move', event => {
    move(event.detail && event.detail.direction);
  });

  document.addEventListener('drder:restart', restartLevel);
  document.addEventListener('drder:pause', togglePause);
  document.addEventListener('drder:next', nextLevel);
  document.addEventListener('drder:resize', syncCanvas);

  document.addEventListener('keydown', event => {
    const map = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      s: 'down',
      a: 'left',
      d: 'right'
    };

    if (map[event.key]) {
      event.preventDefault();
      move(map[event.key]);
    }
  });

  function loop(time) {
    if (!lastFrame) lastFrame = time;

    const delta = Math.min(time - lastFrame, 100);
    lastFrame = time;

    if (!paused && !won) elapsed += delta;

    render(time);
    stats();

    animationId = requestAnimationFrame(loop);
  }

  loadProgress();
  generateWorld();

  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(loop);
})();
