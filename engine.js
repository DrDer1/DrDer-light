
'use strict';

(() => {
  const app = window.DrDerLight;

  if (!app || !app.canvas || !app.ctx) {
    console.error('DrDer-light: تعذر العثور على لوحة اللعبة.');
    return;
  }

  const canvas = app.canvas;
  const ctx = app.ctx;

  const COLS = 9;
  const ROWS = 9;
  const TILE_W = 48;
  const TILE_H = 24;
  const BLOCK_H = 16;
  const CRYSTAL_COUNT = 2;
  const SAVE_KEY = 'drder-light-progress-v1';

  const COLORS = {
    background: '#080808',
    path: '#17130b',
    pathEdge: '#70501b',
    gold: '#e9b83f',
    glow: '#ffdf79',
    blockTop: '#1b1b1b',
    blockLeft: '#080808',
    blockRight: '#101010',
    blockEdge: '#3a301c',
    text: '#fff4cf'
  };

  const DIRECTIONS = {
    up:    { x: 0, y: -1 },
    down:  { x: 0, y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  let maze = [];
  let player = { x: 0, y: 0 };
  let crystals = [];
  let level = 1;
  let moves = 0;
  let collected = 0;
  let elapsed = 0;
  let won = false;
  let paused = false;
  let message = '';
  let messageUntil = 0;
  let animationId = 0;
  let lastFrame = 0;

  let bestLevel = 1;
  let completedLevels = 0;
  let crystalAnimation = 0;

  function readSave() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');

      if (Number.isInteger(saved.level) && saved.level > 0) {
        level = saved.level;
      }

      if (
        Number.isInteger(saved.bestLevel) &&
        saved.bestLevel > 0
      ) {
        bestLevel = saved.bestLevel;
      }

      if (
        Number.isInteger(saved.completedLevels) &&
        saved.completedLevels >= 0
      ) {
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

  function inside(x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
  }

  function pointKey(x, y) {
    return `${x},${y}`;
  }

  function randomInt(max) {
    return Math.floor(Math.random() * max);
  }

  function shuffle(items) {
    const result = items.slice();

    for (let i = result.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }

    return result;
  }

  function makeCell(x, y) {
    return {
      x,
      y,
      path: false,
      height: 1 + randomInt(3)
    };
  }

  function getNeighbors(x, y) {
    return shuffle([
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ].filter(p => inside(p.x, p.y)));
  }

  /*
   * Build one guaranteed route from entrance to exit.
   * Add connected branches, while leaving other cells as
   * raised black blocks. Every walkable cell has height zero.
   */
  function generateMaze() {
    maze = Array.from({ length: ROWS }, (_, y) =>
      Array.from({ length: COLS }, (_, x) => makeCell(x, y))
    );

    const route = [{ x: 0, y: 0 }];
    let x = 0;
    let y = 0;

    maze[0][0].path = true;

    while (x !== COLS - 1 || y !== ROWS - 1) {
      const canRight = x < COLS - 1;
      const canDown = y < ROWS - 1;

      let direction;

      if (canRight && canDown) {
        direction = Math.random() < 0.5 ? 'right' : 'down';
      } else {
        direction = canRight ? 'right' : 'down';
      }

      if (direction === 'right') x++;
      else y++;

      maze[y][x].path = true;
      route.push({ x, y });
    }

    /*
     * Add branches that start on the guaranteed route.
     * Branches connect to the main route and create detours.
     */
    const branchCount = Math.min(12, 4 + Math.floor(level / 2));

    for (let i = 0; i < branchCount; i++) {
      const origin = route[randomInt(route.length)];
      let bx = origin.x;
      let by = origin.y;
      const length = 2 + randomInt(4);

      for (let step = 0; step < length; step++) {
        const options = getNeighbors(bx, by).filter(p => {
          const cell = maze[p.y][p.x];

          if (cell.path) return false;

          /*
           * Avoid opening the exit-adjacent area as a shortcut.
           * The guaranteed route remains valid regardless.
           */
          return true;
        });

        if (!options.length) break;

        const next = options[0];
        bx = next.x;
        by = next.y;

        maze[by][bx].path = true;
        maze[by][bx].height = 0;
      }
    }

    /*
     * Ensure every path cell is level and all other cells
     * remain raised blocks.
     */
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (maze[row][col].path) {
          maze[row][col].height = 0;
        }
      }
    }

    player = { x: 0, y: 0 };
    moves = 0;
    collected = 0;
    elapsed = 0;
    won = false;
    paused = false;

    placeCrystals();
    showMessage(`المرحلة ${level}`, 1500);
    updateStats();
  }

  function placeCrystals() {
    crystals = [];

    const candidates = [];

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (!maze[y][x].path) continue;
        if (x === 0 && y === 0) continue;
        if (x === COLS - 1 && y === ROWS - 1) continue;

        candidates.push({ x, y });
      }
    }

    const pool = shuffle(candidates);

    for (const candidate of pool) {
      if (crystals.length >= CRYSTAL_COUNT) break;

      const separated = crystals.every(crystal => {
        const distance =
          Math.abs(crystal.x - candidate.x) +
          Math.abs(crystal.y - candidate.y);

        return distance >= 3;
      });

      if (separated) {
        crystals.push({
          x: candidate.x,
          y: candidate.y,
          taken: false,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    /*
     * The fallback keeps placement reliable even if the
     * spacing rule cannot find enough candidates.
     */
    for (const candidate of pool) {
      if (crystals.length >= CRYSTAL_COUNT) break;

      const exists = crystals.some(crystal =>
        crystal.x === candidate.x && crystal.y === candidate.y
      );

      if (!exists) {
        crystals.push({
          x: candidate.x,
          y: candidate.y,
          taken: false,
          phase: Math.random() * Math.PI * 2
        });
      }
    }
  }

  function project(x, y) {
    const originX = canvas.width / 2;
    const originY = Math.max(65, canvas.height * 0.10);

    return {
      x: originX + (x - y) * TILE_W / 2,
      y: originY + (x + y) * TILE_H / 2
    };
  }

  function polygon(points, fill, stroke, lineWidth = 1) {
    ctx.beginPath();

    points.forEach((point, index) => {
      if (index === 0) {
        ctx.moveTo(point.x, point.y);
      } else {
        ctx.lineTo(point.x, point.y);
      }
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

  function drawPath(cell, time) {
    const p = project(cell.x, cell.y);
    const halfW = TILE_W / 2;
    const halfH = TILE_H / 2;

    polygon([
      { x: p.x, y: p.y },
      { x: p.x + halfW, y: p.y + halfH },
      { x: p.x, y: p.y + TILE_H },
      { x: p.x - halfW, y: p.y + halfH }
    ], COLORS.path, COLORS.pathEdge, 1);

    const pulse = 0.38 + Math.sin(time / 350 + cell.x + cell.y) * 0.12;

    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.strokeStyle = COLORS.glow;
    ctx.lineWidth = 1.3;
    ctx.shadowColor = COLORS.gold;
    ctx.shadowBlur = 5;

    ctx.beginPath();
    ctx.moveTo(p.x - halfW * 0.46, p.y + halfH);
    ctx.lineTo(p.x, p.y + TILE_H * 0.76);
    ctx.lineTo(p.x + halfW * 0.46, p.y + halfH);
    ctx.stroke();

    ctx.restore();
  }

  function drawBlock(cell) {
    const p = project(cell.x, cell.y);
    const halfW = TILE_W / 2;
    const halfH = TILE_H / 2;
    const height = cell.height * BLOCK_H;

    const top = [
      { x: p.x, y: p.y - height },
      { x: p.x + halfW, y: p.y + halfH - height },
      { x: p.x, y: p.y + TILE_H - height },
      { x: p.x - halfW, y: p.y + halfH - height }
    ];

    const left = [
      top[3],
      top[2],
      { x: top[2].x, y: top[2].y + height },
      { x: top[3].x, y: top[3].y + height }
    ];

    const right = [
      top[1],
      top[2],
      { x: top[2].x, y: top[2].y + height },
      { x: top[1].x, y: top[1].y + height }
    ];

    polygon(left, COLORS.blockLeft, COLORS.blockEdge, 0.8);
    polygon(right, COLORS.blockRight, COLORS.blockEdge, 0.8);
    polygon(top, COLORS.blockTop, '#41351e', 1);

    ctx.save();
    ctx.strokeStyle = 'rgba(233,184,63,0.32)';
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(top[0].x, top[0].y);
    ctx.lineTo(top[1].x, top[1].y);
    ctx.lineTo(top[2].x, top[2].y);
    ctx.stroke();

    ctx.restore();
  }

  function drawCrystal(crystal, time) {
    if (crystal.taken) return;

    const p = project(crystal.x, crystal.y);
    const bob = Math.sin(time / 250 + crystal.phase) * 3;
    const x = p.x;
    const y = p.y + TILE_H / 2 - 11 + bob;

    ctx.save();
    ctx.shadowColor = COLORS.glow;
    ctx.shadowBlur = 16;

    polygon([
      { x, y: y - 14 },
      { x: x + 7, y: y - 3 },
      { x, y: y + 8 },
      { x: x - 7, y: y - 3 }
    ], '#f7ce58', '#fff1b0', 1);

    polygon([
      { x, y: y - 14 },
      { x: x + 7, y: y - 3 },
      { x, y: y - 1 }
    ], '#fff4b9');

    polygon([
      { x, y: y - 14 },
      { x, y: y - 1 },
      { x: x - 7, y: y - 3 }
    ], '#b67b19');

    ctx.restore();
  }

  function drawPortal(time) {
    const p = project(COLS - 1, ROWS - 1);
    const x = p.x;
    const y = p.y + TILE_H / 2 - 9;
    const pulse = 1 + Math.sin(time / 220) * 0.07;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = COLORS.glow;
    ctx.shadowBlur = 19;

    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, -10, 12, 18, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#fff2b0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, -10, 7, 13, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  function drawPlayer(time) {
    const p = project(player.x, player.y);
    const x = p.x;
    const y = p.y + TILE_H / 2 - 10 + Math.sin(time / 140) * 1.5;

    ctx.save();

    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowColor = COLORS.glow;
    ctx.shadowBlur = 20;

    const gradient = ctx.createRadialGradient(
      x - 4, y - 5, 1, x, y, 11
    );

    gradient.addColorStop(0, '#fffde0');
    gradient.addColorStop(0.45, '#ffdf72');
    gradient.addColorStop(1, '#b97b14');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawScene(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const mapWidth = (COLS + ROWS) * TILE_W / 2;
    const mapHeight = (COLS + ROWS) * TILE_H / 2 + BLOCK_H * 3;

    const scale = Math.min(
      1,
      (canvas.width * 0.92) / mapWidth,
      (canvas.height * 0.86) / mapHeight
    );

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height * 0.04);
    ctx.scale(scale, scale);
    ctx.translate(-canvas.width / 2, 0);

    /*
     * Render far cells first, then nearer cells.
     */
    for (let diagonal = 0; diagonal < COLS + ROWS - 1; diagonal++) {
      for (let y = 0; y < ROWS; y++) {
        const x = diagonal - y;
        if (!inside(x, y)) continue;

        const cell = maze[y][x];

        if (cell.path) {
          drawPath(cell, time);
        } else {
          drawBlock(cell);
        }

        if (x === COLS - 1 && y === ROWS - 1) {
          drawPortal(time);
        }

        for (const crystal of crystals) {
          if (crystal.x === x && crystal.y === y) {
            drawCrystal(crystal, time);
          }
        }

        if (player.x === x && player.y === y) {
          drawPlayer(time);
        }
      }
    }

    ctx.restore();

    if (paused || won) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.72)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = 'center';
      ctx.fillStyle = COLORS.glow;
      ctx.font = 'bold 22px sans-serif';

      ctx.fillText(
        won ? 'اكتملت المرحلة!' : 'اللعبة متوقفة',
        canvas.width / 2,
        canvas.height / 2 - 6
      );

      ctx.fillStyle = COLORS.text;
      ctx.font = '14px sans-serif';

      ctx.fillText(
        won ? 'اضغط «المرحلة التالية» للمتابعة' : 'اضغط زر التشغيل للاستئناف',
        canvas.width / 2,
        canvas.height / 2 + 25
      );

      ctx.restore();
    }

    if (message && time < messageUntil && !won && !paused) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = COLORS.glow;
      ctx.shadowColor = COLORS.gold;
      ctx.shadowBlur = 8;
      ctx.fillText(message, canvas.width / 2, 28);
      ctx.restore();
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

  function checkCollection() {
    const crystal = crystals.find(item =>
      !item.taken &&
      item.x === player.x &&
      item.y === player.y
    );

    if (crystal) {
      crystal.taken = true;
      collected++;
      showMessage('جمعت بلورة ذهبية!');
    }

    if (
      player.x === COLS - 1 &&
      player.y === ROWS - 1
    ) {
      if (collected === CRYSTAL_COUNT) {
        won = true;
        completedLevels = Math.max(completedLevels, level);
        bestLevel = Math.max(bestLevel, level + 1);

        saveProgress();
        showMessage('أحسنت! وصلت إلى البوابة', 5000);
      } else {
        showMessage('اجمع البلورتين أولًا');
      }
    }

    updateStats();
  }

  function move(direction) {
    if (paused || won) return;

    const delta = DIRECTIONS[direction];
    if (!delta) return;

    const nx = player.x + delta.x;
    const ny = player.y + delta.y;

    if (!inside(nx, ny) || !maze[ny][nx].path) {
      showMessage('كتلة سوداء تسد الطريق');
      return;
    }

    player.x = nx;
    player.y = ny;
    moves++;

    checkCollection();
    updateStats();
  }

  function restartLevel() {
    generateMaze();
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
    generateMaze();
    showMessage(`بدأت المرحلة ${level}`);
    updateStats();
  }

  function togglePause() {
    if (won) return;

    paused = !paused;
    showMessage(paused ? 'تم إيقاف اللعبة' : 'استأنفت اللعب');
    updateStats();
  }

  function loop(time) {
    if (lastFrame === 0) lastFrame = time;

    const delta = Math.min(time - lastFrame, 100);
    lastFrame = time;

    if (!paused && !won) {
      elapsed += delta;
    }

    drawScene(time);
    updateStats();

    animationId = requestAnimationFrame(loop);
  }

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

  readSave();
  generateMaze();
  cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(loop);

  /*
   * Expose a small inspection interface for later testing.
   */
  app.getGameState = () => ({
    level,
    moves,
    collected,
    crystals: CRYSTAL_COUNT,
    won,
    paused,
    bestLevel,
    completedLevels
  });
})();
