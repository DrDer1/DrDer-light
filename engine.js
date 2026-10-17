/* DrDer-Light — engine.js
   متاهة حقيقية بـ Raycasting (Wolfenstein-style)
   جدران سوداء واضحة، منظور أول-شخص، توليد مضمون الحل.
*/
(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  /* ============ ثوابت ============ */
  const SAVE_KEY = 'drder-light-save-v3';
  const CRYSTAL_COUNT = 2;

  // أبعاد المتاهة (عرض 7 مسارات كما طلبت + جدران محيطة)
  const MAZE_W = 15; // 7 مسارات + جدران + فجوات
  const MAZE_H = 60; // طول المتاهة (يزيد مع المرحلة)

  const GOLD = '#f4cf63';
  const GOLD_LIGHT = '#fff0a0';

  /* ============ حالة اللعبة ============ */
  let level = 1;
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

  // اللاعب (إحداثيات حقيقية في المتاهة)
  let player = { x: 1.5, y: 1.5, angle: 0 };
  let visualX = 1.5;
  let visualY = 1.5;
  let visualAngle = 0;

  // خريطة المتاهة (0 = ممر، 1 = جدار)
  let maze = [];

  // عناصر
  let crystalPositions = [];
  let portalPos = { x: 1, y: 1 };

  let pointerStart = null;
  let audioCtx = null;

  /* ============ توليد المتاهة ============ */
  function generateMaze() {
    // 1) ابدأ بكل الخلايا جدراناً
    maze = Array.from({ length: MAZE_H }, () =>
      Array(MAZE_W).fill(1)
    );

    // 2) Recursive Backtracking (DFS) — مضمون الحل
    const stack = [{ x: 1, y: 1 }];
    maze[1][1] = 0;

    const dirs = [
      { dx: 0, dy: -2 }, { dx: 0, dy: 2 },
      { dx: -2, dy: 0 }, { dx: 2, dy: 0 }
    ];

    while (stack.length) {
      const cur = stack[stack.length - 1];
      const options = dirs
        .map(d => ({ x: cur.x + d.dx, y: cur.y + d.dy }))
        .filter(p =>
          p.x > 0 && p.x < MAZE_W - 1 &&
          p.y > 0 && p.y < MAZE_H - 1 &&
          maze[p.y][p.x] === 1
        );

      if (options.length === 0) {
        stack.pop();
        continue;
      }

      const next = options[Math.floor(Math.random() * options.length)];
      // افتح الجدار بين الخليتين
      maze[(cur.y + next.y) / 2][(cur.x + next.x) / 2] = 0;
      maze[next.y][next.x] = 0;
      stack.push(next);
    }

    // 3) تأكد من وجود ممر أفقي عريض (7 مسارات) في بعض الصفوف
    //    ليتنقل اللاعب بحرية
    for (let y = 3; y < MAZE_H - 3; y += 6) {
      for (let x = 1; x < MAZE_W - 1; x++) {
        if (Math.random() > 0.3) maze[y][x] = 0;
      }
    }

    // 4) نقطة البداية
    player = { x: 1.5, y: 1.5, angle: 0 };
    visualX = 1.5;
    visualY = 1.5;
    visualAngle = 0;
    maze[1][1] = 0;

    // 5) البوابة (آخر المتاهة)
    portalPos = { x: MAZE_W - 2.5, y: MAZE_H - 2.5 };
    maze[MAZE_H - 2][MAZE_W - 2] = 0;

    // 6) البلورات على ممرات مضمونة
    crystalPositions = [];
    const used = new Set(['1,1']);

    for (let i = 0; i < CRYSTAL_COUNT; i++) {
      let attempts = 0;
      while (attempts < 200) {
        const cx = 2 + Math.floor(Math.random() * (MAZE_W - 4));
        const cy = 5 + Math.floor(Math.random() * (MAZE_H - 15));
        const key = cx + ',' + cy;
        if (maze[cy][cx] === 0 && !used.has(key)) {
          used.add(key);
          crystalPositions.push({
            x: cx + 0.5, y: cy + 0.5,
            collected: false
          });
          break;
        }
        attempts++;
      }
    }
  }

  /* ============ حفظ / تحميل ============ */
  function saveProgress() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        level, bestTimes, savedAt: Date.now()
      }));
    } catch (_) {}
  }

  function loadProgress() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (Number.isFinite(s.level) && s.level >= 1) level = Math.floor(s.level);
      if (s.bestTimes && typeof s.bestTimes === 'object') bestTimes = s.bestTimes;
    } catch (_) { level = 1; bestTimes = {}; }
  }

  /* ============ UI ============ */
  const $ = id => document.getElementById(id);

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

  function say(text, duration = 1600) {
    message = text;
    messageUntil = performance.now() + duration;
  }

  /* ============ صوت ============ */
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

  /* ============ Raycasting Rendering ============ */
  function syncCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { w, h };
  }

  function render(time) {
    const dims = syncCanvas();
    const { w, h } = dims;

    // خلفية (سقف وأرضية)
    const skyGrad = ctx.createLinearGradient(0, 0, 0, h * 0.5);
    skyGrad.addColorStop(0, '#030303');
    skyGrad.addColorStop(1, '#0a0805');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, w, h * 0.5);

    const floorGrad = ctx.createLinearGradient(0, h * 0.5, 0, h);
    floorGrad.addColorStop(0, '#0a0805');
    floorGrad.addColorStop(1, '#030303');
    ctx.fillStyle = floorGrad;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);

    // Raycasting
    const fov = Math.PI / 3; // 60 درجة
    const numRays = Math.min(w, 320); // تقليل العدد للأداء
    const rayStep = w / numRays;

    const px = visualX;
    const py = visualY;
    const pa = visualAngle;

    for (let i = 0; i < numRays; i++) {
      const screenX = i * rayStep;
      const rayAngle = pa - fov / 2 + (i / numRays) * fov;

      // DDA raycast
      const sin = Math.sin(rayAngle);
      const cos = Math.cos(rayAngle);

      let rayX = px;
      let rayY = py;
      let hit = false;
      let side = 0;
      let distance = 0;

      const stepSize = 0.05;
      const maxDist = 20;

      while (!hit && distance < maxDist) {
        rayX += cos * stepSize;
        rayY += sin * stepSize;
        distance += stepSize;

        const mapX = Math.floor(rayX);
        const mapY = Math.floor(rayY);

        if (mapX < 0 || mapX >= MAZE_W || mapY < 0 || mapY >= MAZE_H) {
          hit = true;
          break;
        }

        if (maze[mapY][mapX] === 1) {
          hit = true;
          // تحديد الاتجاه (أفقي/عمودي) للتظليل
          side = Math.abs(cos) > Math.abs(sin) ? 0 : 1;
        }
      }

      if (!hit) continue;

      // تصحيح fisheye
      const correctedDist = distance * Math.cos(rayAngle - pa);
      const wallHeight = (h / correctedDist) * 0.8;

      // لون الجدار: أسود مع تظليل حسب الاتجاه
      const shade = side === 0 ? '#0a0a0a' : '#050505';
      ctx.fillStyle = shade;

      const wallTop = (h - wallHeight) / 2;
      ctx.fillRect(screenX, wallTop, rayStep + 1, wallHeight);

      // خط ذهبي رفيع على الحافة العلوية للجدار (لإبراز الشكل)
      ctx.fillStyle = 'rgba(233,184,63,0.15)';
      ctx.fillRect(screenX, wallTop, rayStep + 1, Math.max(1, wallHeight * 0.02));
    }

    // رسم البلورات (بسيط: دوائر ذهبية في منتصف الشاشة إذا كانت قريبة)
    crystalPositions.forEach(c => {
      if (c.collected) return;
      const dx = c.x - px;
      const dy = c.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > 12) return;

      const angleToCrystal = Math.atan2(dy, dx);
      let diff = angleToCrystal - pa;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (Math.abs(diff) < fov / 2) {
        const screenX = w / 2 + (diff / (fov / 2)) * (w / 2);
        const size = Math.max(4, 40 / dist);
        const screenY = h / 2;

        ctx.save();
        ctx.shadowColor = GOLD;
        ctx.shadowBlur = 15;
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.arc(screenX, screenY, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    });

    // رسم البوابة
    if (portalPos) {
      const dx = portalPos.x - px;
      const dy = portalPos.y - py;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 15) {
        const angleToPortal = Math.atan2(dy, dx);
        let diff = angleToPortal - pa;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;

        if (Math.abs(diff) < fov / 2) {
          const screenX = w / 2 + (diff / (fov / 2)) * (w / 2);
          const size = Math.max(6, 60 / dist);

          ctx.save();
          ctx.shadowColor = GOLD;
          ctx.shadowBlur = 20;
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = Math.max(2, 4 / dist * 5);
          ctx.beginPath();
          ctx.ellipse(screenX, h / 2, size * 0.5, size, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // HUD
    drawHUD(w, h);
    drawMessage(w, h);
    drawOverlay(w, h);
  }

  function drawHUD(w, h) {
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
    const width = Math.min(w - 40, 320);
    ctx.fillStyle = 'rgba(8,7,4,0.9)';
    ctx.strokeStyle = 'rgba(220,175,67,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(w/2 - width/2, h*0.66 - 20, width, 40, 10);
    else ctx.rect(w/2 - width/2, h*0.66 - 20, width, 40);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText(message, w/2, h*0.66);
    ctx.restore();
  }

  function drawOverlay(w, h) {
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 14;
      ctx.fillStyle = GOLD_LIGHT;
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('اللعبة متوقفة', w/2, h*0.48);
      ctx.font = '14px sans-serif';
      ctx.fillStyle = '#fff4cf';
      ctx.fillText('اضغط زر التشغيل للاستئناف', w/2, h*0.55);
      ctx.restore();
    }

    if (showSuccessScreen) {
      ctx.fillStyle = 'rgba(0,0,0,0.8)';
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = GOLD;
      ctx.shadowBlur = 20;
      ctx.fillStyle = GOLD_LIGHT;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('اكتملت المرحلة!', w/2, h*0.30);
      ctx.shadowBlur = 8;
      ctx.font = 'bold 16px sans-serif';
      ctx.fillStyle = '#fff4cf';
      ctx.fillText('المرحلة ' + level, w/2, h*0.42);
      ctx.font = '15px sans-serif';
      ctx.fillText('الوقت: ' + formatTime(elapsed), w/2, h*0.50);
      ctx.font = '14px sans-serif';
      ctx.fillText('اضغط «المرحلة التالية» للمتابعة', w/2, h*0.66);
      ctx.restore();
    }
  }

  /* ============ منطق الحركة ============ */
  function tryMove(newX, newY) {
    const margin = 0.25;
    if (newX < margin || newX > MAZE_W - margin ||
        newY < margin || newY > MAZE_H - margin) return false;
    const mapX = Math.floor(newX);
    const mapY = Math.floor(newY);
    if (mapX < 0 || mapX >= MAZE_W || mapY < 0 || mapY >= MAZE_H) return false;
    return maze[mapY][mapX] === 0;
  }

  function move(direction) {
    if (paused || won) return;

    const speed = 0.35;
    let dx = 0, dy = 0;

    if (direction === 'up') {
      dx = Math.cos(visualAngle) * speed;
      dy = Math.sin(visualAngle) * speed;
    } else if (direction === 'down') {
      dx = -Math.cos(visualAngle) * speed;
      dy = -Math.sin(visualAngle) * speed;
    } else if (direction === 'left') {
      visualAngle -= 0.15;
      return;
    } else if (direction === 'right') {
      visualAngle += 0.15;
      return;
    }

    const newX = visualX + dx;
    const newY = visualY + dy;

    if (tryMove(newX, newY)) {
      visualX = newX;
      visualY = newY;
      player.x = newX;
      player.y = newY;
      moves++;
      sound.move();
      checkCollect();
      checkWin();
      updateStats();
    } else {
      sound.block();
    }
  }

  function checkCollect() {
    crystalPositions.forEach(c => {
      if (c.collected) return;
      const dx = c.x - player.x;
      const dy = c.y - player.y;
      if (Math.sqrt(dx*dx + dy*dy) < 0.8) {
        c.collected = true;
        crystals++;
        sound.crystal();
        say('تم جمع البلورة الذهبية!');
        updateStats();
      }
    });
  }

  function checkWin() {
    if (crystals < CRYSTAL_COUNT) return;
    const dx = portalPos.x - player.x;
    const dy = portalPos.y - player.y;
    if (Math.sqrt(dx*dx + dy*dy) < 1.2) {
      finishLevel();
    }
  }

  function finishLevel() {
    won = true;
    paused = false;
    showSuccessScreen = true;
    const key = String(level);
    const prev = bestTimes[key];
    if (!prev || elapsed < prev) bestTimes[key] = Math.round(elapsed * 10) / 10;
    saveProgress();
    sound.win();
    updateStats();
  }

  /* ============ إعادة / تالي / إيقاف ============ */
  function restartLevel() {
    player = { x: 1.5, y: 1.5, angle: 0 };
    visualX = 1.5;
    visualY = 1.5;
    visualAngle = 0;
    moves = 0;
    crystals = 0;
    elapsed = 0;
    paused = false;
    won = false;
    showSuccessScreen = false;
    message = '';
    generateMaze();
    say('المرحلة ' + level);
    updateStats();
  }

  function nextLevel() {
    if (!won) { say('أكمل المرحلة أولًا'); return; }
    level++;
    saveProgress();
    restartLevel();
    say('المرحلة ' + level);
  }

  function togglePause() {
    if (won) return;
    paused = !paused;
    say(paused ? 'تم إيقاف اللعبة' : 'استأنفت اللعب', 1100);
    updateStats();
  }

  /* ============ الإدخال (سحب) ============ */
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

    if (absX < 24 && absY < 24) {
      if (dur < 400) move('up');
      return;
    }

    if (absX > absY) {
      // سحب أفقي: دوران
      move(dx > 0 ? 'right' : 'left');
    } else {
      // سحب عمودي: تقدم/تراجع
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

  /* ============ حلقة الرسم ============ */
  function frame(time) {
    animationId = requestAnimationFrame(frame);
    if (!lastFrame) lastFrame = time;
    const delta = Math.min(0.1, (time - lastFrame) / 1000);
    lastFrame = time;

    if (!paused && !won) {
      elapsed += delta;
      const lerp = 1 - Math.pow(0.001, delta);
      player.x += (visualX - player.x) * lerp;
      player.y += (visualY - player.y) * lerp;
      if (time % 250 < 20) updateStats();
    }

    render(time);
  }

  /* ============ ربط الأزرار ============ */
  function bindUI() {
    const rb = $('restartButton');
    const nb = $('nextButton');
    const pb = $('pauseButton');
    if (rb) rb.addEventListener('click', restartLevel);
    if (nb) nb.addEventListener('click', nextLevel);
    if (pb) pb.addEventListener('click', togglePause);
  }

  /* ============ تشغيل ============ */
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', () => { pointerStart = null; });
  document.addEventListener('keydown', onKeyDown);
  window.addEventListener('resize', () => syncCanvas());

  loadProgress();
  generateMaze();
  bindUI();
  updateStats();

  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(frame);

  window.DrDerLight = {
    getGameState: () => ({
      level, moves, crystals, won, paused,
      elapsed: Math.round(elapsed * 10) / 10,
      player: { x: player.x, y: player.y, angle: player.angle },
      mazeSize: { w: MAZE_W, h: MAZE_H }
    })
  };

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }
})();
