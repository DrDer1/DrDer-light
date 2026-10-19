/* DrDer-Light — engine.js
   متاهة Raycasting، مفاتيح، أبواب، حفر حقيقية، أسهم خادعة، عصا تحكم مزدوجة (Dual-stick).
*/
(() => {
  'use strict';

  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const SAVE_KEY = 'drder-light-save-v12';
  const CRYSTAL_COUNT = 2;
  const MAZE_W = 21;
  const MAZE_H = 51;
  const GOLD = '#f4cf63';
  const GOLD_LIGHT = '#fff0a0';
  const RED = '#ff3333';

  let level = 1;
  let bestTimes = {};
  let moves = 0;
  let crystals = 0;
  let elapsed = 0;
  let paused = false;
  let won = false;
  let success = false;
  let dead = false;
  let deathTime = 0;
  let message = '';
  let messageUntil = 0;
  let animationId = 0;
  let lastFrame = 0;

  let player = { x: 1.5, y: 1.5, angle: 0 };
  let maze = [];
  let crystalsPos = [];
  let portalPos = { x: 1.5, y: 1.5 };
  let pits = [];
  let decoySigns = [];

  // Dual-stick controls
  let leftStickActive = false;
  let leftStickId = null;
  let leftBaseX = 0, leftBaseY = 0, leftCurX = 0, leftCurY = 0;
  
  let rightStickActive = false;
  let rightStickId = null;
  let rightBaseX = 0, rightBaseY = 0, rightCurX = 0, rightCurY = 0;

  const STICK_RADIUS = 50;
  const DEADZONE = 10;

  let moveForward = 0;
  let rotateSpeed = 0;

  let audioCtx = null;
  let walkAudio = null;
  let doorAudio = null;
  let hurtAudio = null;
  let isWalking = false;

  let depthBuffer = [];
  let numRays = 0;

  const $ = id => document.getElementById(id);

  function generateMaze() {
    maze = Array.from({ length: MAZE_H }, () => Array(MAZE_W).fill(1));
    pits = [];
    decoySigns = [];

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

    for (let y = 3; y < MAZE_H - 3; y += 4) {
      for (let x = 1; x < MAZE_W - 1; x++) {
        if (Math.random() > 0.4) maze[y][x] = 0;
      }
    }

    for (let i = 0; i < 15; i++) {
      const sx = 2 + Math.floor(Math.random() * (MAZE_W - 4));
      const sy = 3 + Math.floor(Math.random() * (MAZE_H - 10));
      const len = 2 + Math.floor(Math.random() * 4);
      const dir = Math.random() > 0.5 ? 1 : -1;
      for (let s = 0; s < len; s++) {
        const nx = sx + (Math.random() > 0.5 ? s * dir : 0);
        const ny = sy + (Math.random() > 0.5 ? 0 : s * dir);
        if (nx > 0 && nx < MAZE_W - 1 && ny > 0 && ny < MAZE_H - 1) {
          maze[ny][nx] = 0;
        }
      }
    }

    for (let i = 0; i < 15; i++) {
      const px = 3 + Math.floor(Math.random() * (MAZE_W - 6));
      const py = 5 + Math.floor(Math.random() * (MAZE_H - 10));
      if (maze[py][px] === 0 && !(px < 5 && py < 5)) {
        pits.push({ x: px + 0.5, y: py + 0.5 });
      }
    }

    for (let i = 0; i < 12; i++) {
      const sx = 3 + Math.floor(Math.random() * (MAZE_W - 6));
      const sy = 5 + Math.floor(Math.random() * (MAZE_H - 10));
      if (maze[sy][sx] === 0) {
        const walls = [];
        if (maze[sy - 1] && maze[sy - 1][sx] === 1) walls.push({ dx: 0, dy: -1, angle: Math.PI });
        if (maze[sy + 1] && maze[sy + 1][sx] === 1) walls.push({ dx: 0, dy: 1, angle: 0 });
        if (maze[sy][sx - 1] === 1) walls.push({ dx: -1, dy: 0, angle: -Math.PI / 2 });
        if (maze[sy][sx + 1] === 1) walls.push({ dx: 1, dy: 0, angle: Math.PI / 2 });
        
        if (walls.length > 0) {
          const w = walls[Math.floor(Math.random() * walls.length)];
          decoySigns.push({
            x: sx + 0.5 + w.dx * 0.45,
            y: sy + 0.5 + w.dy * 0.45,
            angle: w.angle
          });
        }
      }
    }

    maze[1][1] = 0;
    maze[1][2] = 0;
    player = { x: 1.5, y: 1.5, angle: 0 };

    portalPos = { x: MAZE_W - 2.5, y: MAZE_H - 2.5 };
    maze[MAZE_H - 2][MAZE_W - 2] = 0;

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
        crystalsPos.push({ x: cx + 0.5, y: cy + 0.5, collected: false, phase: Math.random() * Math.PI * 2 });
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
    const nb = $('nextButton'), pb = $('pauseButton');
    if (nb) nb.disabled = !won;
    if (pb) pb.textContent = paused ? 'استئناف' : 'إيقاف مؤقت';
  }

  function say(text, dur = 1500) { message = text; messageUntil = performance.now() + dur; }

  function initAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) {}
  }

  function loadAudio() {
    try {
      walkAudio = new Audio('./walk.mp3');
      walkAudio.loop = true;
      walkAudio.preload = 'auto';
      doorAudio = new Audio('./Door.mp3');
      doorAudio.preload = 'auto';
      hurtAudio = new Audio('./hurt.mp3');
      hurtAudio.preload = 'auto';
    } catch (_) {}
  }

  function startWalkSound() {
    if (isWalking || !walkAudio) return;
    isWalking = true;
    walkAudio.currentTime = 0;
    walkAudio.play().catch(() => {});
  }

  function stopWalkSound() {
    if (!isWalking || !walkAudio) return;
    isWalking = false;
    walkAudio.pause();
    walkAudio.currentTime = 0;
  }

  function playDoorSound() {
    if (!doorAudio) return;
    doorAudio.currentTime = 0;
    doorAudio.play().catch(() => {});
  }

  function playHurtSound() {
    if (hurtAudio) {
      hurtAudio.currentTime = 0;
      hurtAudio.play().catch(() => {});
    } else {
      tone(100, 0.4, 0.1);
    }
  }

  function tone(freq, dur, vol) {
    try {
      if (!audioCtx) return;
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
    crystal: () => { tone(880, 0.10, 0.05); setTimeout(() => tone(1320, 0.14, 0.04), 70); },
    win: () => { tone(660, 0.14, 0.06); setTimeout(() => tone(990, 0.14, 0.06), 90); setTimeout(() => tone(1320, 0.22, 0.055), 200); }
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

    const fov = Math.PI / 3;
    numRays = Math.min(w, 280);
    const rayStep = w / numRays;
    const dirX = Math.cos(player.angle);
    const dirY = Math.sin(player.angle);
    const camX = -dirY * 0.66;
    const camY = dirX * 0.66;

    depthBuffer = new Array(numRays).fill(Infinity);

    for (let i = 0; i < numRays; i++) {
      const screenX = i * rayStep;
      const cameraRatio = 2 * i / numRays - 1;
      const rayDirX = dirX + camX * cameraRatio;
      const rayDirY = dirY + camY * cameraRatio;

      let mapX = Math.floor(player.x);
      let mapY = Math.floor(player.y);
      const deltaDistX = Math.abs(1 / (rayDirX || 0.0001));
      const deltaDistY = Math.abs(1 / (rayDirY || 0.0001));

      let stepX, stepY, sideDistX, sideDistY;
      if (rayDirX < 0) { stepX = -1; sideDistX = (player.x - mapX) * deltaDistX; }
      else { stepX = 1; sideDistX = (mapX + 1 - player.x) * deltaDistX; }
      if (rayDirY < 0) { stepY = -1; sideDistY = (player.y - mapY) * deltaDistY; }
      else { stepY = 1; sideDistY = (mapY + 1 - player.y) * deltaDistY; }

      let hit = 0, side = 0, iterations = 0;
      while (!hit && iterations < 60) {
        iterations++;
        if (sideDistX < sideDistY) {
          sideDistX += deltaDistX; mapX += stepX; side = 0;
        } else {
          sideDistY += deltaDistY; mapY += stepY; side = 1;
        }
        if (mapX < 0 || mapX >= MAZE_W || mapY < 0 || mapY >= MAZE_H) { hit = 1; break; }
        if (maze[mapY][mapX] === 1) hit = 1;
      }

      let perpWallDist;
      if (side === 0) perpWallDist = (sideDistX - deltaDistX);
      else perpWallDist = (sideDistY - deltaDistY);
      if (perpWallDist < 0.1) perpWallDist = 0.1;

      depthBuffer[i] = perpWallDist;

      const wallH = Math.floor((h / perpWallDist) * 0.75);
      let drawStart = Math.floor(-wallH / 2 + h / 2);
      let drawEnd = Math.floor(wallH / 2 + h / 2);
      if (drawStart < 0) drawStart = 0;
      if (drawEnd > h) drawEnd = h;

      let colorR = side === 0 ? 30 : 15;
      let colorG = side === 0 ? 30 : 15;
      let colorB = side === 0 ? 30 : 15;
      const shade = Math.min(1, 2.0 / perpWallDist);
      colorR = Math.max(8, Math.floor(colorR * shade));
      colorG = Math.max(8, Math.floor(colorG * shade));
      colorB = Math.max(8, Math.floor(colorB * shade));

      ctx.fillStyle = `rgb(${colorR}, ${colorG}, ${colorB})`;
      ctx.fillRect(screenX, drawStart, rayStep + 1, drawEnd - drawStart);

      if (wallH > 5) {
        ctx.fillStyle = 'rgba(233,184,63,0.3)';
        ctx.fillRect(screenX, drawStart, rayStep + 1, Math.max(1, wallH * 0.015));
      }
    }

    pits.forEach(pit => {
      const dx = pit.x - player.x, dy = pit.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let diff = Math.atan2(dy, dx) - player.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (Math.abs(diff) < fov / 2 && dist > 0.2 && dist < 15) {
        const screenX = w / 2 + Math.tan(diff) / Math.tan(fov / 2) * (w / 2);
        if (screenX >= 0 && screenX <= w) {
          const size = Math.max(8, 60 / dist);
          const yPos = h / 2 + (h / dist) * 0.1;
          
          ctx.save();
          const pitGrad = ctx.createRadialGradient(screenX, yPos, 2, screenX, yPos, size);
          pitGrad.addColorStop(0, '#000000');
          pitGrad.addColorStop(0.7, '#050505');
          pitGrad.addColorStop(1, '#111111');
          ctx.fillStyle = pitGrad;
          ctx.beginPath();
          ctx.ellipse(screenX, yPos, size * 1.2, size * 0.5, 0, 0, Math.PI * 2);
          ctx.fill();
          
          ctx.fillStyle = '#661111';
          for (let s = -1; s <= 1; s++) {
            ctx.beginPath();
            ctx.moveTo(screenX + s * size * 0.4, yPos);
            ctx.lineTo(screenX + s * size * 0.2, yPos - size * 0.6);
            ctx.lineTo(screenX + s * size * 0.6, yPos);
            ctx.fill();
          }
          ctx.restore();
        }
      }
    });

    decoySigns.forEach(s => {
      const dx = s.x - player.x, dy = s.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let diff = Math.atan2(dy, dx) - player.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (Math.abs(diff) < fov / 2 && dist > 0.2 && dist < 12) {
        const screenX = w / 2 + Math.tan(diff) / Math.tan(fov / 2) * (w / 2);
        if (screenX >= 0 && screenX <= w) {
          const rayIndex = Math.floor((screenX / w) * numRays);
          if (rayIndex >= 0 && rayIndex < numRays && depthBuffer[rayIndex] > dist - 0.5) {
            const size = Math.max(6, 40 / dist);
            const yPos = h / 2 - size * 0.5;
            ctx.save();
            ctx.translate(screenX, yPos);
            ctx.rotate(s.angle - player.angle);
            ctx.fillStyle = 'rgba(255, 51, 51, 0.7)';
            ctx.shadowColor = RED;
            ctx.shadowBlur = 10;
            ctx.beginPath();
            ctx.moveTo(0, -size);
            ctx.lineTo(size * 0.6, 0);
            ctx.lineTo(size * 0.2, 0);
            ctx.lineTo(size * 0.2, size);
            ctx.lineTo(-size * 0.2, size);
            ctx.lineTo(-size * 0.2, 0);
            ctx.lineTo(-size * 0.6, 0);
            ctx.fill();
            ctx.restore();
          }
        }
      }
    });

    crystalsPos.forEach(c => {
      if (c.collected) return;
      const dx = c.x - player.x, dy = c.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      let diff = Math.atan2(dy, dx) - player.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (Math.abs(diff) < fov / 2 && dist > 0.2) {
        const screenX = w / 2 + Math.tan(diff) / Math.tan(fov / 2) * (w / 2);
        if (screenX < 0 || screenX > w) return;
        const size = Math.max(4, 30 / dist);
        const yPos = h / 2;
        const bob = Math.sin(time / 220 + c.phase) * 3;
        ctx.save();
        ctx.shadowColor = GOLD; ctx.shadowBlur = 18;
        ctx.translate(screenX, yPos + bob);
        ctx.fillStyle = GOLD;
        ctx.beginPath();
        ctx.arc(0, 0, size * 0.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(size * 0.4, -size * 0.15, size * 0.9, size * 0.3);
        ctx.fillRect(size * 0.9, -size * 0.15, size * 0.15, size * 0.4);
        ctx.fillRect(size * 1.1, -size * 0.15, size * 0.15, size * 0.3);
        ctx.restore();
      }
    });

    const pdx = portalPos.x - player.x, pdy = portalPos.y - player.y;
    const pdist = Math.sqrt(pdx * pdx + pdy * pdy);
    if (pdist > 0.2) {
      let diff = Math.atan2(pdy, pdx) - player.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;

      if (Math.abs(diff) < fov / 2) {
        const sx = w / 2 + Math.tan(diff) / Math.tan(fov / 2) * (w / 2);
        if (sx >= 0 && sx <= w) {
          const size = Math.max(8, 50 / pdist);
          const doorW = size * 0.8;
          const doorH = size * 1.6;
          ctx.save();
          ctx.shadowColor = GOLD; ctx.shadowBlur = 22;
          ctx.fillStyle = '#1a1508';
          ctx.beginPath();
          ctx.moveTo(sx - doorW / 2, h / 2 + doorH / 2);
          ctx.lineTo(sx - doorW / 2, h / 2 - doorH / 2);
          ctx.quadraticCurveTo(sx, h / 2 - doorH / 2 - doorW * 0.4, sx + doorW / 2, h / 2 - doorH / 2);
          ctx.lineTo(sx + doorW / 2, h / 2 + doorH / 2);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = GOLD;
          ctx.lineWidth = Math.max(2, 3 / pdist * 4);
          ctx.stroke();
          ctx.fillStyle = GOLD;
          ctx.beginPath();
          ctx.arc(sx, h / 2 - doorH * 0.1, size * 0.1, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillRect(sx - size * 0.04, h / 2 - doorH * 0.05, size * 0.08, size * 0.15);
          ctx.restore();
        }
      }
    }

    if (dead && performance.now() - deathTime < 2000) {
      const t = (performance.now() - deathTime) / 2000;
      const alpha = Math.max(0, 1 - t);
      ctx.save();
      ctx.fillStyle = `rgba(200, 0, 0, ${alpha})`;
      for (let i = 0; i < 20; i++) {
        const rx = (Math.sin(i * 12.9898 + deathTime) * 0.5 + 0.5) * w;
        const ry = (Math.sin(i * 78.233 + deathTime) * 0.5 + 0.5) * h;
        const rs = 5 + Math.sin(i * 3.7) * 15;
        ctx.beginPath();
        ctx.arc(rx, ry, Math.max(1, rs * (1 - t)), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    drawHUD(w, h);
    drawSticks();
    drawMessage(w, h);
    drawOverlay(w, h);
  }

  function drawHUD(w, h) {
    ctx.save();
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    ctx.font = '600 15px sans-serif';
    ctx.shadowColor = GOLD; ctx.shadowBlur = 8;
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText('المفاتيح ' + crystals + '/' + CRYSTAL_COUNT, w * 0.5, 22);
    ctx.font = '600 12px sans-serif';
    ctx.fillText('المرحلة ' + level, w * 0.5, 44);
    ctx.restore();
  }

  function drawSticks() {
    if (leftStickActive) {
      drawStickVisual(leftBaseX, leftBaseY, leftCurX, leftCurY);
    }
    if (rightStickActive) {
      drawStickVisual(rightBaseX, rightBaseY, rightCurX, rightCurY);
    }
  }

  function drawStickVisual(bx, by, cx, cy) {
    ctx.save();
    ctx.strokeStyle = 'rgba(233,184,63,0.3)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(bx, by, STICK_RADIUS, 0, Math.PI * 2);
    ctx.stroke();

    const grad = ctx.createRadialGradient(bx, by, 5, bx, by, STICK_RADIUS);
    grad.addColorStop(0, 'rgba(233,184,63,0.1)');
    grad.addColorStop(1, 'rgba(233,184,63,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(bx, by, STICK_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    let kx = cx, ky = cy;
    const dx = kx - bx, dy = ky - by;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > STICK_RADIUS) {
      kx = bx + (dx / dist) * STICK_RADIUS;
      ky = by + (dy / dist) * STICK_RADIUS;
    }

    ctx.shadowColor = GOLD; ctx.shadowBlur = 10;
    ctx.fillStyle = 'rgba(244,207,99,0.6)';
    ctx.beginPath();
    ctx.arc(kx, ky, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = GOLD_LIGHT;
    ctx.lineWidth = 2;
    ctx.stroke();
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
    if (ctx.roundRect) ctx.roundRect(w / 2 - width / 2, h * 0.66 - 20, width, 40, 10);
    else ctx.rect(w / 2 - width / 2, h * 0.66 - 20, width, 40);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = GOLD_LIGHT;
    ctx.fillText(message, w / 2, h * 0.66);
    ctx.restore();
  }

  function drawOverlay(w, h) {
    if (paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = GOLD; ctx.shadowBlur = 14; ctx.fillStyle = GOLD_LIGHT;
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText('اللعبة متوقفة', w / 2, h * 0.48);
      ctx.restore();
    }
    if (dead) {
      ctx.fillStyle = 'rgba(80,0,0,0.7)'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = RED; ctx.shadowBlur = 20; ctx.fillStyle = '#fff';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('لقد وقعت في الفخ!', w / 2, h * 0.45);
      ctx.font = '16px sans-serif';
      ctx.fillText('اضغط إعادة المحاولة من القائمة', w / 2, h * 0.55);
      ctx.restore();
    }
    if (success) {
      ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = GOLD; ctx.shadowBlur = 20; ctx.fillStyle = GOLD_LIGHT;
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText('اكتملت المرحلة!', w / 2, h * 0.30);
      ctx.shadowBlur = 8; ctx.font = 'bold 16px sans-serif'; ctx.fillStyle = '#fff4cf';
      ctx.fillText('المرحلة ' + level, w / 2, h * 0.42);
      ctx.font = '15px sans-serif';
      ctx.fillText('الوقت: ' + formatTime(elapsed), w / 2, h * 0.50);
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

  function updateMovement(dt) {
    if (paused || won || dead) {
      stopWalkSound();
      return;
    }

    const speed = 1.2;
    const rotSpeed = 1.2;

    let dx = 0, dy = 0;
    let moving = false;

    if (moveForward !== 0) {
      const dirX = Math.cos(player.angle);
      const dirY = Math.sin(player.angle);
      dx += dirX * moveForward * speed * dt;
      dy += dirY * moveForward * speed * dt;
      moving = true;
    }

    if (rotateSpeed !== 0) {
      player.angle += rotateSpeed * rotSpeed * dt;
    }

    if (moving) {
      if (canMove(player.x + dx, player.y + dy)) {
        player.x += dx; player.y += dy;
        moves++;
        checkCollect();
        checkWin();
        checkPits();
        startWalkSound();
      } else {
        stopWalkSound();
      }
    } else {
      stopWalkSound();
    }
  }

  function checkPits() {
    if (dead) return;
    pits.forEach(p => {
      const dx = p.x - player.x, dy = p.y - player.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.5) {
        dead = true;
        deathTime = performance.now();
        stopWalkSound();
        playHurtSound();
      }
    });
  }

  function checkCollect() {
    crystalsPos.forEach(c => {
      if (c.collected) return;
      const dx = c.x - player.x, dy = c.y - player.y;
      if (Math.sqrt(dx * dx + dy * dy) < 0.6) {
        c.collected = true; crystals++;
        sound.crystal(); say('تم جمع المفتاح الذهبي!');
      }
    });
  }

  function checkWin() {
    if (crystals < CRYSTAL_COUNT) return;
    const dx = portalPos.x - player.x, dy = portalPos.y - player.y;
    if (Math.sqrt(dx * dx + dy * dy) < 1.0) {
      playDoorSound();
      finishLevel();
    }
  }

  function finishLevel() {
    won = true; paused = false; success = true;
    stopWalkSound();
    const key = String(level);
    if (!bestTimes[key] || elapsed < bestTimes[key]) bestTimes[key] = Math.round(elapsed * 10) / 10;
    saveProgress(); sound.win(); updateStats();
  }

  function restartLevel() {
    moves = 0; crystals = 0; elapsed = 0; paused = false; won = false; success = false; dead = false; message = '';
    stopWalkSound();
    generateMaze(); say('المرحلة ' + level); updateStats();
  }

  function nextLevel() {
    if (!won) { say('أكمل المرحلة أولاً'); return; }
    level++; saveProgress();
    restartLevel();
  }

  function togglePause() {
    if (won || dead) return;
    paused = !paused;
    if (paused) stopWalkSound();
    say(paused ? 'تم إيقاف اللعبة' : 'استأنفت اللعب', 1100);
    updateStats();
  }

  // Dual-stick event handlers
  const leftArea = document.getElementById('leftJoystick');
  const rightArea = document.getElementById('rightJoystick');

  function onLeftDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    leftStickActive = true;
    leftStickId = e.pointerId;
    leftBaseX = e.clientX; leftBaseY = e.clientY;
    leftCurX = e.clientX; leftCurY = e.clientY;
    leftArea.setPointerCapture(e.pointerId);
  }

  function onLeftMove(e) {
    if (!leftStickActive || e.pointerId !== leftStickId) return;
    leftCurX = e.clientX; leftCurY = e.clientY;
    const dx = leftCurX - leftBaseX;
    const dist = Math.abs(dx);
    if (dist < DEADZONE) { rotateSpeed = 0; return; }
    const strength = Math.min(1, dist / STICK_RADIUS);
    rotateSpeed = (dx / dist) * strength;
  }

  function onLeftUp(e) {
    if (e.pointerId !== leftStickId) return;
    leftStickActive = false;
    leftStickId = null;
    rotateSpeed = 0;
  }

  function onRightDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    initAudio();
    if (!walkAudio) loadAudio();
    rightStickActive = true;
    rightStickId = e.pointerId;
    rightBaseX = e.clientX; rightBaseY = e.clientY;
    rightCurX = e.clientX; rightCurY = e.clientY;
    rightArea.setPointerCapture(e.pointerId);
  }

  function onRightMove(e) {
    if (!rightStickActive || e.pointerId !== rightStickId) return;
    rightCurX = e.clientX; rightCurY = e.clientY;
    const dy = rightCurY - rightBaseY;
    const dist = Math.abs(dy);
    if (dist < DEADZONE) { moveForward = 0; return; }
    const strength = Math.min(1, dist / STICK_RADIUS);
    moveForward = -(dy / dist) * strength;
  }

  function onRightUp(e) {
    if (e.pointerId !== rightStickId) return;
    rightStickActive = false;
    rightStickId = null;
    moveForward = 0;
    stopWalkSound();
  }

  // UI Bindings
  function bindUI() {
    const startScreen = $('startScreen');
    const gameUI = $('gameUI');
    const startBtn = $('startBtn');
    const continueBtn = $('continueBtn');
    const menuBtn = $('menuBtn');
    const dropdown = $('dropdownMenu');
    const restartBtn = $('restartButton');
    const nextBtn = $('nextButton');
    const pauseBtn = $('pauseButton');
    const exitBtn = $('exitBtn');

    // Check for saved progress
    try {
      const s = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
      if (s.level > 1) {
        continueBtn.style.display = 'block';
      }
    } catch (_) {}

    function showGame() {
      startScreen.style.display = 'none';
      gameUI.style.display = 'block';
      syncCanvas();
    }

    startBtn.addEventListener('click', () => {
      level = 1;
      bestTimes = {};
      saveProgress();
      restartLevel();
      showGame();
    });

    continueBtn.addEventListener('click', () => {
      loadProgress();
      restartLevel();
      showGame();
    });

    menuBtn.addEventListener('click', () => {
      dropdown.style.display = dropdown.style.display === 'none' ? 'flex' : 'none';
    });

    pauseBtn.addEventListener('click', () => {
      togglePause();
      dropdown.style.display = 'none';
    });

    restartBtn.addEventListener('click', () => {
      restartLevel();
      dropdown.style.display = 'none';
    });

    nextBtn.addEventListener('click', () => {
      nextLevel();
      dropdown.style.display = 'none';
    });

    exitBtn.addEventListener('click', () => {
      dropdown.style.display = 'none';
      gameUI.style.display = 'none';
      startScreen.style.display = 'flex';
    });

    leftArea.addEventListener('pointerdown', onLeftDown);
    leftArea.addEventListener('pointermove', onLeftMove);
    leftArea.addEventListener('pointerup', onLeftUp);
    leftArea.addEventListener('pointercancel', onLeftUp);

    rightArea.addEventListener('pointerdown', onRightDown);
    rightArea.addEventListener('pointermove', onRightMove);
    rightArea.addEventListener('pointerup', onRightUp);
    rightArea.addEventListener('pointercancel', onRightUp);
  }

  window.addEventListener('resize', () => syncCanvas());

  loadProgress();
  generateMaze();
  updateStats();
  bindUI();
  syncCanvas();
  initAudio();
  loadAudio();

  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(function frame(time) {
    animationId = requestAnimationFrame(frame);
    if (!lastFrame) lastFrame = time;
    const delta = Math.min(0.1, (time - lastFrame) / 1000);
    lastFrame = time;

    if (!paused && !won && !dead) {
      elapsed += delta;
      updateMovement(delta);
    }

    render(time);
  });

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').catch(() => {}));
  }
})();
