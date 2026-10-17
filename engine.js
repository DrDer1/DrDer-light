/* DrDer-Light — engine.js
   متاهة حقيقية بـ Raycasting. جدران صلبة، منظور أول-شخص، كرة على الأرض.
*/
(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const SAVE_KEY = 'drder-light-save-v5';
  const CRYSTAL_COUNT = 2;

  // أبعاد المتاهة (فردية لتعمل خوارزمية DFS)
  const MAZE_W = 15;
  const MAZE_H = 51;

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

  // اللاعب (إحداثيات حقيقية في المتاهة)
  let player = { x: 1.5, y: 1.5, angle: 0 };
  let visualX = 1.5;
  let visualY = 1.5;
  let visualAngle = 0;

  let maze = [];
  let crystalsPos = [];
  let portalPos = { x: 1.5, y: 1.5 };
  let pointerStart = null;
  let audioCtx = null;

  const $ = id => document.getElementById(id);

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  /* ============ توليد متاهة DFS مضمونة الحل ============ */
  function generateMaze() {
    maze = Array.from({ length: MAZE_H }, () => Array(MAZE_W).fill(1));

    const stack = [{ x: 1, y: 1 }];
    maze[1][1] = 0;
    const dirs = [
      { dx: 0, dy: -2 }, { dx: 0, dy: 2 },
      { dx: -2, dy: 0 }, { dx: 2, dy: 0 }
    ];

    while (stack.length) {
      const cur = stack[stack.length - 1];
      const opts = dirs
        .map(d => ({ x: cur.x + d.dx, y: cur.y + d.dy }))
        .filter(p => p.x > 0 && p.x < MAZE_W - 1 && p.y > 0 && p.y < MAZE_H - 1 && maze[p.y][p.x] === 1);

      if (!opts.length) { stack.pop(); continue; }

      const nxt = opts[Math.floor(Math.random() * opts.length)];
      maze[(cur.y + nxt.y) / 2][(cur.x + nxt.x) / 2] = 0;
      maze[nxt.y][nxt.x] = 0;
      stack.push(nxt);
    }

    // فتح ممرات أفقية عشوائية لربط المسارات (كما طلبت 7 مسارات)
    for (let y = 3; y < MAZE_H - 3; y += 4) {
      for (let x = 1; x < MAZE_W - 1; x++) {
        if (Math.random() > 0.35) maze[y][x] = 0;
      }
    }

    // البداية
    player = { x: 1.5, y: 1.5, angle: 0 };
    visualX = 1.5; visualY = 1.5; visualAngle = 0;
    maze[1][1] = 0;

    // البوابة في النهاية
    portalPos = { x: MAZE_W - 1.5, y: MAZE_H - 1.5 };
    maze[MAZE_H - 2][MAZE_W - 2] = 0;

    // البلورات على ممرات مضمونة
    crystalsPos = [];
    const used = new Set(['1,1', (MAZE_W - 2) + ',' + (MAZE_H - 2)]);
    let tries = 0;
    while (crystalsPos.length < CRYSTAL_COUNT && tries < 500) {
      tries++;
      const cx = 2 + Math.floor(Math.random() * (MAZE_W - 4));
      const cy = 3 + Math.floor(Math.random() * (MAZE_H - 8));
      const k = cx + ',' + cy;
      if (maze[cy][cx] === 0 && !used.has(k)) {
        used.add(k);
        crystalsPos.push({ x: cx + 0.5, y: cy + 0.5, collected: false });
      }
    }
  }

  /* ============ حفظ / تحميل ============ */
  function saveProgress() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ level, bestTimes, savedAt: Date.now() })); } catch (_) {}
  }
  function loadProgress() {
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (Number.isFinite(s.level) && s.level >= 1) level = Math.floor(s.level);
      if (s.bestTimes && typeof s.bestTimes === 'object') bestTimes = s.bestTimes;
    } catch (_) { level = 1; bestTimes = {}; }
  }

  /* ============ UI ============ */
  function formatTime(sec) {
    const t = Math.max(0, Math.floor(sec));
    return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');
  }
  function updateStats() {
    const lv = $('levelValue'), cr = $('crystalsValue'), tm = $('timeValue');
    const bt = $('bestValue'), nb = $('nextButton'), pb = $('pauseButton');
    if (lv) lv.textContent = String(level);
    if (cr) cr.textContent = crystals + '/' + CRYSTAL_COUNT;
    if (tm) tm.textContent = formatTime(elapsed);
    if (bt) { const b = bestTimes[String(level)]; bt.textContent = b ? formatTime(b) : '--:--'; }
    if (nb) nb.disabled = !won;
    if (pb) pb.textContent = paused ? '▶' : 'Ⅱ';
  }
  function say(text, dur = 1500) { message = text; messageUntil = performance.now() + dur; }

  /* ============ صوت ============ */
  function tone(freq, dur, vol) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine'; osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + dur);
    } catch (_) {}
  }
  const sound = {
    move: () => tone(520, 0.05, 0.025),
    crystal: () => { tone(880, 0.10, 0.05); setTimeout(() => tone(1320, 0.14, 0.04), 70); },
    win: () => { tone(660, 0.14, 0.06); setTimeout(() => tone(990, 0.14, 0.06), 90); setTimeout(() => tone(1320, 0.22, 0.055), 200); },
    block: () => tone(180, 0.08, 0.03)
  };

  /* ============ Canvas ============ */
  function syncCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { w, h };
  }

  /* ============ Raycasting Render ============ */
  function render(time) {
    const dims = syncCanvas();
    const { w, h } = dims;

    // سقف وأرضية
    const sky = ctx.createLinearGradient(0, 0, 0, h * 0.5);
    sky.addColorStop(0, '#020202');
    sky.addColorStop(1, '#0a0805');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h * 0.5);

    const floor = ctx.createLinearGradient(0, h * 0.5, 0, h);
    floor.addColorStop(0, '#0a0805');
    floor.addColorStop(1, '#020202');
    ctx.fillStyle = floor;
    ctx.fillRect(0, h * 0.5, w, h * 0.5);

    // Raycasting
    const fov = Math.PI / 3;
    const numRays = Math.min(w, 300);
    const rayStep = w / numRays;

    for (let i = 0; i < numRays; i++) {
      const screenX = i * rayStep;
      const rayAngle = visualAngle - fov / 2 + (i / numRays) * fov;
      const sin = Math.sin(rayAngle), cos = Math.cos(rayAngle);

      let rayX = visualX, rayY = visualY;
      let hit = false, side = 0, distance = 0;
      const step = 0.04, maxDist = 25;

      while (!hit && distance < maxDist) {
        rayX += cos * step;
        rayY += sin * step;
        distance += step;
        const mx = Math.floor(rayX), my = Math.floor(rayY);
        if (mx < 0 || mx >= MAZE_W || my < 0 || my >= MAZE_H) { hit = true; break; }
        if (maze[my][mx] === 1) { hit = true; side = Math.abs(cos) > Math.abs(sin) ? 0 : 1; }
      }
      if (!hit) continue;

      const corrected = distance * Math.cos(rayAngle - visualAngle);
      const wallH = (h / corrected) * 0.85;

      // جدار أسود واضح: الجانب الأفقي أغمق قليلاً
      ctx.fillStyle = side === 0 ? '#0a0a0a' : '#050505';
      const top = (h - wallH) / 2;
      ctx.fillRect(screenX, top, rayStep + 1, wallH);

      // حافة ذهبية رفيعة أعلى الجدار
      ctx.fillStyle = 'rgba(233,184,63,0.25)';
      ctx.fillRect(screenX, top, rayStep + 1, Math.max(1, wallH * 0.015));
    }

    // رسم البلورات
    crystalsPos.forEach(c => {
      if (c.collected) return;
      const dx = c.x - visualX, dy = c.y - visualY;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist > 14) return;
      let diff = Math.atan2(dy, dx) - visualAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < fov / 2) {
        const sx = w / 2 + (diff / (fov / 2)) * (w / 2);
        const size = Math.max(4, 45 / dist);
        ctx.save();
        ctx.shadowColor = GOLD; ctx.shadowBlur = 18;
        ctx.fillStyle = GOLD;
        ctx.beginPath(); ctx.arc(sx, h / 2, size, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    });

    // رسم البوابة
    const pdx = portalPos.x - visualX, pdy = portalPos.y - visualY;
    const pdist = Math.sqrt(pdx*pdx + pdy*pdy);
    if (pdist < 16) {
      let diff = Math.atan2(pdy, pdx) - visualAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < fov / 2) {
        const sx = w / 2 + (diff / (fov / 2)) * (w / 2);
        const size = Math.max(6, 70 / pdist);
        ctx.save();
        ctx.shadowColor = GOLD; ctx.shadowBlur = 22;
        ctx.strokeStyle = GOLD;
        ctx.lineWidth = Math.max(2, 5 / pdist * 4);
        ctx.beginPath();
        ctx.ellipse(sx, h / 2, size * 0.5, size, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    drawHUD(w, h);
    drawMessage(w, h);
    drawOverlay(w, h);
  }

  function drawHUD(w, h) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '600 15px sans-serif';
    ctx.shadowColor = GOLD; ctx.shadowBlur = 8;
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText('البلورات ' + crystals + '/' + CRYSTAL_COUNT, w * 0.5, 22);
    ctx.restore();
  }

  function drawMessage(w, h) {
    if (!message || performance.now() > messageUntil) return;
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = 'bold 14px sans-serif';
    const width = Math.min(w - 40, 320);
    ctx.fillStyle = 'rgba(8,7,4,0.9)';
    ctx.strokeStyle = 'rgba(220,175,67,0.65)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(w/2 - width/2, h*0.66 - 20, width, 40, 10);
    else ctx.rect(w/2 - width/2, h*0.66 - 20, width, 40);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText(message, w/2, h*0.66);
    ctx.restore();
  }

  function drawOverlay(w, h) {
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = GOLD; ctx.shadowBlur = 14; ctx.fillStyle = GOLD_LIGHT;
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('اللعبة متوقفة', w/2, h*0.48);
      ctx.font = '14px sans-serif'; ctx.fillStyle = '#fff4cf';
      ctx.fillText('اضغط زر التشغيل للاستئناف', w/2, h*0.55);
      ctx.restore();
    }
    if (success) {
      ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = GOLD; ctx.shadowBlur = 20; ctx.fillStyle = GOLD_LIGHT;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('اكتملت المرحلة!', w/2, h*0.30);
      ctx.shadowBlur = 8; ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#fff4cf';
      ctx.fillText('المرحلة ' + level, w/2, h*0.42);
      ctx.font = '15px sans-serif';
      ctx.fillText('الوقت: ' + formatTime(elapsed), w/2, h*0.50);
      const best = bestTimes[String(level)];
      if (best && Math.abs(best - elapsed) < 0.5) {
        ctx.fillStyle = GOLD_LIGHT; ctx.font = 'bold 14px sans-serif';
        ctx.fillText('★ رقم قياسي جديد!', w/2, h*0.57);
      }
      ctx.fillStyle = '#fff4cf'; ctx.font = '14px sans-serif';
      ctx.fillText('اضغط «المرحلة التالية» للمتابعة', w/2, h*0.66);
      ctx.restore();
    }
  }

  /* ============ منطق الحركة ============ */
  function canMove(nx, ny) {
    const margin = 0.2;
    if (nx < margin || nx > MAZE_W - margin || ny < margin || ny > MAZE_H - margin) return false;
    const mx = Math.floor(nx), my = Math.floor(ny);
    if (mx < 0 || mx >= MAZE_W || my < 0 || my >= MAZE_H) return false;
    return maze[my][mx] === 0;
  }

  function move(direction) {
    if (paused || won) return;
    const speed = 0.3;
    let dx = 0, dy = 0;

    if (direction === 'up') { dx = Math.cos(visualAngle) * speed; dy = Math.sin(visualAngle) * speed; }
    else if (direction === 'down') { dx = -Math.cos(visualAngle) * speed; dy = -Math.sin(visualAngle) * speed; }
    else if (direction === 'left') { visualAngle -= 0.15; return; }
    else if (direction === 'right') { visualAngle += 0.15; return; }
    else return;

    if (canMove(visualX + dx, visualY + dy)) {
      visualX += dx; visualY += dy;
      player.x = visualX; player.y = visualY; player.angle = visualAngle;
      moves++;
      sound.move();
      checkCollect();
      checkWin();
      updateStats();
    } else {
      sound.block();
      say('جدار أسود يسد الطريق');
    }
  }

  function checkCollect() {
    crystalsPos.forEach(c => {
      if (c.collected) return;
      const dx = c.x - player.x, dy = c.y - player.y;
      if (Math.sqrt(dx*dx + dy*dy) < 0.7) {
        c.collected = true; crystals++;
        sound.crystal(); say('تم جمع البلورة الذهبية!');
        updateStats();
      }
    });
  }

  function checkWin() {
    if (crystals < CRYSTAL_COUNT) return;
    const dx = portalPos.x - player.x, dy = portalPos.y - player.y;
    if (Math.sqrt(dx*dx + dy*dy) < 1.0) finishLevel();
  }

  function finishLevel() {
    won = true; paused = false; success = true;
    const key = String(level);
    if (!bestTimes[key] || elapsed < bestTimes[key]) bestTimes[key] = Math.round(elapsed * 10) / 10;
    saveProgress(); sound.win(); updateStats();
  }

  /* ============ إعادة / تالي / إيقاف ============ */
  function restartLevel() {
    if (won && !confirm('سيتم فقدان نتيجة المرحلة الحالية. متابعة؟')) return;
    moves = 0; crystals = 0; elapsed = 0; paused = false; won = false; success = false; message = '';
    generateMaze(); say('المرحلة ' + level); updateStats();
  }

  function nextLevel() {
    if (!won) { say('أكمل المرحلة أولًا'); return; }
    level++; saveProgress();
    moves = 0; crystals = 0; elapsed = 0; paused = false; won = false; success = false; message = '';
    generateMaze(); say('المرحلة ' + level); updateStats();
  }

  function togglePause() {
    if (won) return;
    paused = !paused;
    say(paused ? 'تم إيقاف اللعبة' : 'استأنفت اللعب', 1100);
    updateStats();
  }

  /* ============ الإدخال ============ */
  function onPointerDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointerStart = { x: e.clientX, y: e.clientY, time: performance.now(), id: e.pointerId };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onPointerUp(e) {
    if (!pointerStart || pointerStart.id !== e.pointerId) return;
    const dx = e.clientX - pointerStart.x, dy = e.clientY - pointerStart.y;
    const dur = performance.now() - pointerStart.time;
    pointerStart = null;
    if (paused || won) return;

    const absX = Math.abs(dx), absY = Math.abs(dy), SWIPE = 24;
    if (absX < SWIPE && absY < SWIPE) { if (dur < 400) move('up'); return; }
    if (absX > absY) move(dx > 0 ? 'right' : 'left');
    else move(dy < 0 ? 'up' : 'down');
  }
  function onKeyDown(e) {
    const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down' };
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
      if (time - lastTick >= 250) { lastTick = time; updateStats(); }
    }
    render(time);
  }

  function bindUI() {
    const rb = $('restartButton'), nb = $('nextButton'), pb = $('pauseButton');
    if (rb) rb.addEventListener('click', restartLevel);
    if (nb) nb.addEventListener('click', nextLevel);
    if (pb) pb.addEventListener('click', togglePause);
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

  loadProgress();
  generateMaze();
  bindUI();
  updateStats();
  syncCanvas();

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
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
})();
