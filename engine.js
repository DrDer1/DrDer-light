
'use strict';

(() => {
  const app = window.DrDerLight;

  if (!app || !app.canvas || !app.ctx) {
    console.error('DrDer-light: تعذر العثور على لوحة اللعبة.');
    return;
  }

  const canvas = app.canvas;
  const ctx = app.ctx;

  const SAVE_KEY = 'drder-light-progress-v1';
  const CRYSTAL_COUNT = 2;
  const LANES = 7;
  const CENTER_LANE = 3;
  const COLORS = {
    background: '#050505',
    gold: '#e9b83f',
    glow: '#ffdf79',
    path: '#17130b',
    pathEdge: '#70501b',
    block: '#111111',
    blockEdge: '#352a16',
    text: '#fff4cf'
  };

  let level = 1;
  let bestLevel = 1;
  let completedLevels = 0;
  let moves = 0;
  let collected = 0;
  let elapsed = 0;
  let won = false;
  let paused = false;
  let message = '';
  let messageUntil = 0;
  let animationId = 0;
  let lastFrame = 0;
  let worldLength = 36;
  let player = { lane: CENTER_LANE, z: 0 };
  let route = [];
  let crystals = [];
  let portalZ = 36;
  let touchStart = null;
  let lastTouchMove = 0;
  let audioContext = null;

  function randomInt(max) {
    return Math.floor(Math.random() * max);
  }

  function readSave() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');

      if (Number.isInteger(saved.level) && saved.level > 0) {
        level = saved.level;
      }
      if (Number.isInteger(saved.bestLevel) && saved.bestLevel > 0) {
        bestLevel = saved.bestLevel;
      }
      if (Number.isInteger(saved.completedLevels) && saved.completedLevels >= 0) {
        completedLevels = saved.completedLevels;
      }
    } catch (error) {
      console.warn('DrDer-light: تعذر قراءة التقدم المحفوظ.', error);
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        level,
        bestLevel,
        completedLevels,
        savedAt: Date.now()
      }));
    } catch (error) {
      console.warn('DrDer-light: تعذر حفظ التقدم.', error);
    }
  }

  function showMessage(text, duration = 1300) {
    message = text;
    messageUntil = performance.now() + duration;
  }

  function updateStats() {
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

  /*
   * Generate a continuous forward route.
   * The route bends gradually instead of ending in a visible square.
   */
  function generateWorld() {
    worldLength = Math.min(36 + level * 3, 180);
    portalZ = worldLength;
    route = new Array(worldLength + 1);
    route[0] = CENTER_LANE;

    let lane = CENTER_LANE;
    let direction = 0;

    for (let z = 1; z <= worldLength; z++) {
      if (Math.random() < Math.min(0.20 + level * 0.002, 0.34)) {
        direction = randomInt(3) - 1;
      }

      lane += direction;
      lane = Math.max(1, Math.min(LANES - 2, lane));

      if (Math.random() < 0.12) {
        direction = 0;
      }

      route[z] = lane;
    }

    player = { lane: route[0], z: 0 };
    moves = 0;
    collected = 0;
    elapsed = 0;
    won = false;
    paused = false;

    placeCrystals();
    showMessage(`المرحلة ${level}`, 1600);
    updateStats();
  }

  function routeLane(z) {
    z = Math.max(0, Math.min(worldLength, Math.round(z)));
    return route[z] ?? CENTER_LANE;
  }

  function isOpen(lane, z) {
    if (z < 0 || z > worldLength || lane < 0 || lane >= LANES) {
      return false;
    }

    const mainLane = routeLane(z);

    if (lane === mainLane) return true;

    /*
     * Side paths connect to the main route.
     * The outer edge remains mostly blocked.
     */
    if (Math.abs(lane - mainLane) === 1) {
      const seed = Math.abs(Math.sin(z * 12.9898 + lane * 78.233)) % 1;
      return seed > 0.34;
    }

    return false;
  }

  function placeCrystals() {
    crystals = [];

    const positions = [];
    const first = Math.max(5, Math.floor(worldLength * 0.28));
    const second = Math.max(first + 5, Math.floor(worldLength * 0.66));

    positions.push(first, Math.min(second, worldLength - 4));

    positions.forEach((z, index) => {
      crystals.push({
        lane: routeLane(z),
        z,
        taken: false,
        phase: index * 1.7
      });
    });
  }

  /*
   * Perspective projection:
   * distant objects converge near the horizon;
   * nearby objects grow toward the bottom of the screen.
   */
  function project(lane, z, lift = 0) {
    const w = canvas.width;
    const h = canvas.height;
    const distance = z - player.z;
    const horizon = h * 0.27;
    const depth = 1 / (1 + Math.max(-0.65, distance) * 0.105);
    const perspective = Math.max(0.12, Math.min(2.7, depth));
    const laneWidth = w * 0.115 * perspective;
    const x = w / 2 + (lane - player.lane) * laneWidth;
    const y = horizon + (h * 0.76) * perspective - lift * perspective;

    return { x, y, scale: perspective, laneWidth };
  }

  function polygon(points, fill, stroke, lineWidth = 1) {
    ctx.beginPath();
    points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
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

  function drawSky(time) {
    const w = canvas.width;
    const h = canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, 0, h);

    gradient.addColorStop(0, '#030303');
    gradient.addColorStop(0.45, '#100d07');
    gradient.addColorStop(1, '#050505');

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    const glow = ctx.createRadialGradient(
      w / 2, h * 0.3, 2,
      w / 2, h * 0.3, w * 0.58
    );

    glow.addColorStop(0, 'rgba(190,130,25,0.13)');
    glow.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 1;

    for (let i = -5; i <= 5; i++) {
      const topX = w / 2 + i * w * 0.045;
      const bottomX = w / 2 + i * w * 0.35;

      ctx.beginPath();
      ctx.moveTo(topX, h * 0.27);
      ctx.lineTo(bottomX, h);
      ctx.stroke();
    }

    for (let i = 0; i < 10; i++) {
      const progress = ((i / 10) + (time * 0.00008) % 0.1) % 1;
      const y = h * 0.27 + progress * progress * h * 0.75;

      ctx.globalAlpha = 0.04 + progress * 0.15;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    ctx.restore();
  }

  function drawTile(lane, z, time) {
    const near = project(lane, z);
    const far = project(lane, z + 1);
    const leftNear = project(lane - 0.5, z);
    const rightNear = project(lane + 0.5, z);
    const leftFar = project(lane - 0.5, z + 1);
    const rightFar = project(lane + 0.5, z + 1);

    if (near.y < canvas.height * 0.24 ||
        far.y > canvas.height * 1.5) return;

    const open = isOpen(lane, z);

    if (open) {
      polygon([
        { x: leftFar.x, y: far.y },
        { x: rightFar.x, y: far.y },
        { x: rightNear.x, y: near.y },
        { x: leftNear.x, y: near.y }
      ], COLORS.path, COLORS.pathEdge, Math.max(0.5, near.scale));

      const pulse = 0.25 + (Math.sin(time / 280 + z) + 1) * 0.12;

      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = COLORS.glow;
      ctx.shadowColor = COLORS.gold;
      ctx.shadowBlur = 8 * near.scale;
      ctx.lineWidth = Math.max(0.7, near.scale * 1.2);

      ctx.beginPath();
      ctx.moveTo(leftNear.x, near.y);
      ctx.lineTo(leftFar.x, far.y);
      ctx.moveTo(rightNear.x, near.y);
      ctx.lineTo(rightFar.x, far.y);
      ctx.stroke();
      ctx.restore();
    } else {
      const height = Math.max(5, 38 * near.scale);
      const topY = near.y - height;

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
        { x: rightFar.x, y: far.y - height * 0.35 },
        { x: leftFar.x, y: far.y - height * 0.35 }
      ], COLORS.block, COLORS.blockEdge, Math.max(0.5, near.scale));

      ctx.save();
      ctx.strokeStyle = 'rgba(233,184,63,0.25)';
      ctx.lineWidth = Math.max(0.5, near.scale);
      ctx.beginPath();
      ctx.moveTo(leftNear.x, topY);
      ctx.lineTo(rightNear.x, topY);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCrystal(crystal, time) {
    if (crystal.taken) return;

    const p = project(crystal.lane, crystal.z, 23);
    if (p.y < canvas.height * 0.25 || p.y > canvas.height * 1.15) return;

    const bob = Math.sin(time / 220 + crystal.phase) * 3 * p.scale;
    const size = Math.max(2, 9 * p.scale);

    ctx.save();
    ctx.shadowColor = COLORS.glow;
    ctx.shadowBlur = 18 * p.scale;

    polygon([
      { x: p.x, y: p.y - size * 1.7 + bob },
      { x: p.x + size * 0.7, y: p.y - size * 0.35 + bob },
      { x: p.x, y: p.y + size + bob },
      { x: p.x - size * 0.7, y: p.y - size * 0.35 + bob }
    ], '#f7ce58', '#fff1b0', Math.max(0.6, p.scale));

    ctx.restore();
  }

  function drawPortal(time) {
    const p = project(routeLane(portalZ), portalZ, 8);
    if (p.y < canvas.height * 0.24 || p.y > canvas.height * 1.2) return;

    const size = Math.max(3, 20 * p.scale);
    const pulse = 1 + Math.sin(time / 210) * 0.08;

    ctx.save();
    ctx.translate(p.x, p.y - size);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = COLORS.glow;
    ctx.shadowBlur = 22 * p.scale;
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = Math.max(1.5, 4 * p.scale);

    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.55, size, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#fff2b0';
    ctx.lineWidth = Math.max(0.7, 1.5 * p.scale);
    ctx.beginPath();
    ctx.ellipse(0, 0, size * 0.33, size * 0.75, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawPlayer(time) {
    const x = canvas.width / 2;
    const y = canvas.height * 0.79;
    const radius = Math.max(9, Math.min(canvas.width, canvas.height) * 0.035);
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

    ctx.shadowColor = COLORS.glow;
    ctx.shadowBlur = 24;
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

  function drawHUD() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillStyle = COLORS.glow;
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = 7;
    ctx.fillText(`البلورات ${collected}/${CRYSTAL_COUNT}`, canvas.width / 2, 26);
    ctx.restore();
  }

  function drawOverlay() {
    if (!paused && !won) return;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.glow;
    ctx.font = 'bold 22px system-ui, sans-serif';

    ctx.fillText(
      won ? 'اكتملت المرحلة!' : 'اللعبة متوقفة',
      canvas.width / 2,
      canvas.height / 2 - 6
    );

    ctx.fillStyle = COLORS.text;
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(
      won ? 'اضغط «المرحلة التالية» للمتابعة' : 'اضغط زر التشغيل للاستئناف',
      canvas.width / 2,
      canvas.height / 2 + 25
    );

    ctx.restore();
  }

  function drawMessage(time) {
    if (!message || time > messageUntil || won || paused) return;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillStyle = COLORS.glow;
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = 8;
    ctx.fillText(message, canvas.width / 2, 52);
    ctx.restore();
  }

  function drawScene(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSky(time);

    /*
     * Draw distant rows first so nearby objects cover them naturally.
     */
    const startZ = Math.max(0, player.z - 2);
    const endZ = Math.min(worldLength, player.z + 17);

    for (let z = endZ; z >= startZ; z--) {
      for (let lane = 0; lane < LANES; lane++) {
        drawTile(lane, z, time);
      }

      for (const crystal of crystals) {
        if (crystal.z === z) drawCrystal(crystal, time);
      }

      if (portalZ === z) drawPortal(time);
    }

    drawPlayer(time);
    drawHUD();
    drawOverlay();
    drawMessage(time);
  }

  function playMoveSound() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!audioContext) audioContext = new AudioCtx();
      if (audioContext.state === 'suspended') audioContext.resume();

      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();

      oscillator.type = 'sine';
      oscillator.frequency.value = 520;
      gain.gain.setValueAtTime(0.035, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.07);

      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.07);
    } catch (_) {
      // Sound is optional; movement must work even if audio is unavailable.
    }
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
        showMessage('جمعت بلورة ذهبية!');
      }
    }

    if (player.z >= portalZ && player.lane === routeLane(portalZ)) {
      if (collected >= CRYSTAL_COUNT) {
        won = true;
        completedLevels = Math.max(completedLevels, level);
        bestLevel = Math.max(bestLevel, level + 1);
        saveProgress();
        showMessage('أحسنت! وصلت إلى البوابة', 5000);
      } else {
        player.z = Math.max(0, portalZ - 1);
        showMessage('اجمع البلورتين أولًا');
      }
    }

    updateStats();
  }

  function move(direction) {
    if (paused || won) return;

    let nextLane = player.lane;
    let nextZ = player.z;

    switch (direction) {
      case 'up':
        nextZ++;
        break;
      case 'down':
        nextZ--;
        break;
      case 'left':
        nextLane--;
        break;
      case 'right':
        nextLane++;
        break;
      default:
        return;
    }

    nextLane = Math.max(0, Math.min(LANES - 1, nextLane));
    nextZ = Math.max(0, Math.min(portalZ, nextZ));

    if (nextLane === player.lane && nextZ === player.z) return;

    if (!isOpen(nextLane, nextZ)) {
      showMessage('كتلة سوداء تسد الطريق');
      return;
    }

    player.lane = nextLane;
    player.z = nextZ;
    moves++;

    playMoveSound();
    checkCollection();
    updateStats();
  }

  function restartLevel() {
    generateWorld();
    saveProgress();
    updateStats();
  }

  function nextLevel() {
    if (!won) {
      showMessage('أكمل المرحلة واجمع البلورتين أولًا');
      return;
    }

    level++;
    bestLevel = Math.max(bestLevel, level);
    saveProgress();
    generateWorld();
    showMessage(`بدأت المرحلة ${level}`);
    updateStats();
  }

  function togglePause() {
    if (won) return;

    paused = !paused;
    showMessage(paused ? 'تم إيقاف اللعبة' : 'استأنفت اللعب');
    updateStats();
  }

  /*
   * Touch controls:
   * swipe up/down to move forward/backward,
   * swipe left/right to change lane.
   */
  function getTouchPoint(event) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  canvas.style.touchAction = 'none';

  canvas.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    touchStart = {
      ...getTouchPoint(event),
      id: event.pointerId,
      time: performance.now()
    };

    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (_) {}
  });

  canvas.addEventListener('pointerup', event => {
    if (!touchStart || touchStart.id !== event.pointerId) return;

    const end = getTouchPoint(event);
    const dx = end.x - touchStart.x;
    const dy = end.y - touchStart.y;
    const distance = Math.hypot(dx, dy);

    if (distance < 22) {
      /*
       * A short tap uses the side of the screen for steering.
       * The middle area moves forward.
       */
      const ratio = end.x / Math.max(1, canvas.clientWidth);

      if (ratio < 0.34) move('left');
      else if (ratio > 0.66) move('right');
      else move('up');
    } else if (Math.abs(dx) > Math.abs(dy)) {
      move(dx < 0 ? 'left' : 'right');
    } else {
      move(dy < 0 ? 'up' : 'down');
    }

    touchStart = null;
    lastTouchMove = performance.now();
  });

  canvas.addEventListener('pointercancel', () => {
    touchStart = null;
  });

  document.addEventListener('drder:move', event => {
    const direction = event.detail && event.detail.direction;
    move(direction);
  });

  document.addEventListener('drder:restart', restartLevel);
  document.addEventListener('drder:pause', togglePause);
  document.addEventListener('drder:next', nextLevel);

  document.addEventListener('keydown', event => {
    const keyMap = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      s: 'down',
      a: 'left',
      d: 'right'
    };

    const direction = keyMap[event.key];

    if (direction) {
      event.preventDefault();
      move(direction);
    }
  });

  function loop(time) {
    if (!lastFrame) lastFrame = time;

    const delta = Math.min(time - lastFrame, 100);
    lastFrame = time;

    if (!paused && !won) elapsed += delta;

    drawScene(time);
    updateStats();

    animationId = requestAnimationFrame(loop);
  }

  readSave();
  generateWorld();

  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(loop);

  app.getGameState = () => ({
    level,
    moves,
    collected,
    crystals: CRYSTAL_COUNT,
    won,
    paused,
    bestLevel,
    completedLevels,
    player: { ...player },
    worldLength
  });
})();
