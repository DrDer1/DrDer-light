/* DrDer-Light — engine.js
   متاهة حقيقية بـ Raycasting مع تصحيح زوايا Canvas.
*/
(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const SAVE_KEY = 'drder-light-save-v6';
  const CRYSTAL_COUNT = 2;
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

  // اللاعب
  let player = { x: 1.5, y: 1.5, angle: 0 }; // angle = 0 يعني النظر للأسفل (جنوباً)
  let maze = [];
  let crystalsPos = [];
  let portalPos = { x: 1.5, y: 1.5 };
  let pointerStart = null;
  let audioCtx = null;

  const $ = id => document.getElementById(id);

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

    // فتح ممرات أفقية لإنشاء 7 مسارات
    for (let y = 3; y < MAZE_H - 3; y += 4) {
      for (let x = 1; x < MAZE_W - 1; x++) {
        if (Math.random() > 0.35) maze[y][x] = 0;
      }
    }

    // البداية: الكرة تنظر للأسفل (جنوباً)
    player = { x: 1.5, y: 1.5, angle: 0 };
    maze[1][1] = 0;

    // البوابة
    portalPos = { x: MAZE_W - 2.5, y: MAZE_H - 2.5 };
    maze[MAZE_H - 2][MAZE_W - 2] = 0;

    // البلورات
    crystalsPos = [];
    const used = new Set(['1,1']);
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

  function syncCanvas() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * ratio);
    canvas.height = Math.round(h * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { w, h };
  }

  function render(time) {
    const dims = syncCanvas();
    const { w, h } = dims;

    // السماء والأرضية
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
    const numRays = Math.min(w, 280);
    const rayStep = w / numRays;
    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);

    // مستوى الكاميرا
    const camX = -dirY * 0.66;
    const camY = dirX * 0.66;

    for (let i = 0; i < numRays; i++) {
      const screenX = i * rayStep;
      // نسبة من -1 إلى 1
      const cameraRatio = 2 * i / numRays - 1;

      const rayDirX = dirX + camX * cameraRatio;
      const rayDirY = dirY + camY * cameraRatio;

      // DDA
      let mapX = Math.floor(player.x);
      let mapY = Math.floor(player.y);

      const deltaDistX = Math.abs(1 / (rayDirX || 0.0001));
      const deltaDistY = Math.abs(1 / (rayDirY || 0.0001));

      let stepX, stepY, sideDistX, sideDistY;
      if (rayDirX < 0) { stepX = -1; sideDistX = (player.x - mapX) * deltaDistX; }
      else { stepX = 1; sideDistX = (mapX + 1 - player.x) * deltaDistX; }

      if (rayDirY < 0) { stepY = -1; sideDistY = (player.y - mapY) * deltaDistY; }
      else { stepY = 1; sideDistY = (mapY + 1 - player.y) * deltaDistY; }

      let hit = 0, side = 0;
      let iterations = 0;
      while (!hit && iterations < 50) {
        iterations++;
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX;
          mapX += stepX;
          side = 0;
        } else {
          sideDistY += deltaDistY;
          mapY += stepY;
          side = 1;
        }
        if (mapX < 0 || mapX >= MAZE_W || mapY < 0 || mapY >= MAZE_H) { hit = 1; break; }
        if (maze[mapY][mapX] === 1) hit = 1;
      }

      let perpWallDist;
      if (side === 0) perpWallDist = (sideDistX - deltaDistX);
      else perpWallDist = (sideDistY - deltaDistY);
      if (perpWallDist < 0.01) perpWallDist = 0.01;

      const wallH = Math.floor((h / perpWallDist) * 0.75);
      let drawStart = Math.floor(-wallH / 2 + h / 2);
      let drawEnd = Math.floor(wallH / 2 + h / 2);
      if (drawStart < 0) drawStart = 0;
      if (drawEnd > h) drawEnd = h;

      // ألوان الجدران: رمادي داكن جداً (أسود تقريباً) مع تظليل
      let color;
      if (side === 0) color = `rgb(15, 15, 15)`;
      else color = `rgb(8, 8, 8)`;

      // إضاءة حسب المسافة (اختياري)
      const shade = Math.min(1, 3 / perpWallDist);
      const r = Math.floor(10 * shade);
      const g = Math.floor(10 * shade);
      const b = Math.floor(10 * shade);
      
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(screenX, drawStart, rayStep + 1, drawEnd - drawStart);

      // خط ذهبي رفيع على حافة الجدار العلوية
      if (wallH > 5) {
        ctx.fillStyle = 'rgba(233,184,63,0.15)';
        ctx.fillRect(screenX, drawStart, rayStep + 1, Math.max(1, wallH * 0.01));
      }
    }

    // رسم البلورات
    crystalsPos.forEach(c => {
      if (c.collected) return;
      const dx = c.x - player.x, dy = c.y - player.y;
      const dist = Math.sqrt(dx*dx + dy*dy);

      // الزاوية النسبية للكرة
      const angleToCrystal = Math.atan2(dy, dx);
      let diff = angleToCrystal - player.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (Math.abs(diff) < fov / 2 && dist > 0.2) {
        const screenX = w / 2 + Math.tan(diff) / Math.tan(fov / 2) * (w / 2);
        if (screenX < 0 || screenX > w) return;
        const size = Math.max(2, 30 / dist);
        const yPos = h / 2; // في الأفق
        ctx.save();
        ctx.shadowColor = GOLD; ctx.shadowBlur = 18;
        ctx.fillStyle = GOLD;
        ctx.beginPath(); ctx.arc(screenX, yPos, size, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    });

    // رسم البوابة
    const pdx = portalPos.x - player.x, pdy = portalPos.y - player.y;
    const pdist = Math.sqrt(pdx*pdx + pdy*pdy);
    if (pdist > 0.2) {
      let diff = Math.atan2(pdy, pdx) - player.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      
      if (Math.abs(diff) < fov / 2) {
        const sx = w / 2 + Math.tan(diff) / Math.tan(fov / 2) * (w / 2);
        if (sx >= 0 && sx <= w) {
          const size = Math.max(4, 50 / pdist);
          ctx.save();
          ctx.shadowColor = GOLD; ctx.shadowBlur = 22;
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = Math.max(2, 4 / pdist * 4);
          ctx.beginPath();
          ctx.ellipse(sx, h / 2, size * 0.5, size, 0, 0, Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
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

  function canMove(nx, ny) {
    const margin = 0.2;
    if (nx < margin || nx > MAZE_W - margin || ny < margin || ny > MAZE_H - margin) return false;
    const mx = Math.floor(nx), my = Math.floor(ny);
    if (mx < 0 || mx >= MAZE_W || my < 0 || my >= MAZE_H) return false;
    return maze[my][mx] === 0;
  }

  function move(direction) {
    if (paused || won) return;
    const speed = 0.25;
    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);

    let dx = 0, dy = 0;
    if (direction === 'up') { dx = dirX * speed; dy = dirY * speed; }
    else if (direction === 'down') { dx = -dirX * speed; dy = -dirY * speed; }
    else if (direction === 'left') { player.angle -= 0.15; return; }
    else if (direction === 'right') { player.angle += 0.15; return; }
    else return;

    if (canMove(player.x + dx, player.y + dy)) {
      player.x += dx; player.y += dy;
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
      if (Math.sqrt(dx*dx + dy*dy) < 0.6) {
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

  function restartLevel() {
    if (won && !confirm('سيتم فقدان نتيجة المرحلة الحالية. متابعة؟')) return;
    moves = 0; crystals = 0; elapsed = 0; paused = false; won = false; success = false; message = '';
    generateMaze(); say('المرحلة ' + level); updateStats();
  }

  function nextLevel() {
    if (!won) { say('أكمل المرحلة أولاً'); return; }
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

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
})();
