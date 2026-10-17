
'use strict';

(() => {
  const app = window.DrDerLight;
  if (!app || !app.canvas || !app.ctx) {
    console.error('DrDer-light: canvas interface not found.');
    return;
  }

  const canvas = app.canvas;
  const ctx = app.ctx;

  const CONFIG = {
    columns: 9,
    rows: 9,
    tileWidth: 48,
    tileHeight: 24,
    blockHeight: 16,
    crystalCount: 2,
    colors: {
      background: '#080808',
      top: '#191919',
      side: '#0d0d0d',
      edge: '#373020',
      gold: '#e9b83f',
      glow: '#ffdb70',
      path: '#a87920',
      white: '#fff4cf',
      red: '#ff6666'
    }
  };

  let maze = [];
  let player = { x: 0, y: 0 };
  let crystals = [];
  let collected = 0;
  let level = 1;
  let moves = 0;
  let won = false;
  let paused = false;
  let lastTime = 0;
  let elapsed = 0;
  let animationId = 0;
  let lastFrame = 0;
  let message = '';
  let messageUntil = 0;

  const directions = {
    up:    { x: 0, y: -1 },
    down:  { x: 0, y: 1 },
    left:  { x: -1, y: 0 },
    right: { x: 1, y: 0 }
  };

  function randomInt(max) {
    return Math.floor(Math.random() * max);
  }

  function key(x, y) {
    return `${x},${y}`;
  }

  function inside(x, y) {
    return x >= 0 && y >= 0 &&
      x < CONFIG.columns && y < CONFIG.rows;
  }

  function makeCell(x, y) {
    return {
      x,
      y,
      height: 0,
      path: false,
      visited: false
    };
  }

  function neighbors(x, y) {
    return Object.values(directions)
      .map(d => ({ x: x + d.x, y: y + d.y }))
      .filter(p => inside(p.x, p.y));
  }

  function generateMaze() {
    maze = [];

    for (let y = 0; y < CONFIG.rows; y++) {
      const row = [];
      for (let x = 0; x < CONFIG.columns; x++) {
        row.push(makeCell(x, y));
      }
      maze.push(row);
    }

    /*
     * Create a connected winding path using depth-first search.
     * Every visited cell belongs to the walkable network.
     */
    const stack = [{ x: 0, y: 0 }];
    maze[0][0].visited = true;
    maze[0][0].path = true;

    while (stack.length) {
      const current = stack[stack.length - 1];

      const options = neighbors(current.x, current.y)
        .filter(p => !maze[p.y][p.x].visited);

      if (!options.length) {
        stack.pop();
        continue;
      }

      const next = options[randomInt(options.length)];
      const cell = maze[next.y][next.x];

      cell.visited = true;
      cell.path = true;
      stack.push(next);
    }

    /*
     * Keep the main route reachable regardless of random layout.
     * The route is guaranteed to move right/down to the exit.
     */
    let x = 0;
    let y = 0;

    maze[y][x].path = true;

    while (x < CONFIG.columns - 1 || y < CONFIG.rows - 1) {
      const canRight = x < CONFIG.columns - 1;
      const canDown = y < CONFIG.rows - 1;

      if (canRight && canDown) {
        if (Math.random() < 0.5) x++;
        else y++;
      } else if (canRight) {
        x++;
      } else {
        y++;
      }

      maze[y][x].path = true;
    }

    /*
     * Assign modest heights only to non-path blocks.
     * Walkable cells remain level to keep movement predictable.
     */
    for (let row = 0; row < CONFIG.rows; row++) {
      for (let col = 0; col < CONFIG.columns; col++) {
        const cell = maze[row][col];
        cell.height = cell.path ? 0 : 1 + randomInt(3);
        cell.visited = false;
      }
    }

    player = { x: 0, y: 0 };
    maze[0][0].path = true;
    maze[0][0].height = 0;

    crystals = [];
    collected = 0;
    moves = 0;
    won = false;
    paused = false;
    elapsed = 0;
    lastTime = performance.now();

    /*
     * Place crystals only on walkable cells and away from the start
     * and exit, so they can always be collected.
     */
    const exit = { x: CONFIG.columns - 1, y: CONFIG.rows - 1 };
    const candidates = [];

    for (let row = 0; row < CONFIG.rows; row++) {
      for (let col = 0; col < CONFIG.columns; col++) {
        const cell = maze[row][col];

        if (!cell.path) continue;
        if (key(col, row) === key(0, 0)) continue;
        if (key(col, row) === key(exit.x, exit.y)) continue;

        candidates.push({ x: col, y: row });
      }
    }

    /*
     * Prefer crystals separated from each other and from the start.
     */
    while (crystals.length < CONFIG.crystalCount && candidates.length) {
      const index = randomInt(candidates.length);
      const candidate = candidates.splice(index, 1)[0];

      const separated = crystals.every(c =>
        Math.abs(c.x - candidate.x) +
        Math.abs(c.y - candidate.y) >= 3
      );

      if (separated || candidates.length === 0) {
        crystals.push({
          x: candidate.x,
          y: candidate.y,
          taken: false,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    /*
     * There are many path cells in a 9x9 board. This fallback
     * guarantees exactly two crystals if the spacing rule is restrictive.
     */
    while (crystals.length < CONFIG.crystalCount) {
      const candidate = candidates.pop();
      if (!candidate) break;

      if (!crystals.some(c => c.x === candidate.x && c.y === candidate.y)) {
        crystals.push({
          x: candidate.x,
          y: candidate.y,
          taken: false,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    showMessage(`المرحلة ${level}`, 1400);
    updateStats();
  }

  function project(x, y, z = 0) {
    const originX = canvas.width / 2;
    const originY = Math.max(82, canvas.height * 0.19);

    return {
      x: originX + (x - y) * CONFIG.tileWidth / 2,
      y: originY + (x + y) * CONFIG.tileHeight / 2 -
        z * CONFIG.blockHeight
    };
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

  function drawPath(cell, time) {
    const p = project(cell.x, cell.y);

    const w = CONFIG.tileWidth / 2;
    const h = CONFIG.tileHeight / 2;

    polygon([
      { x: p.x, y: p.y },
      { x: p.x + w, y: p.y + h },
      { x: p.x, y: p.y + h * 2 },
      { x: p.x - w, y: p.y + h }
    ], '#15120b', '#4d3a16', 1);

    ctx.save();
    ctx.globalAlpha = 0.35 + 0.13 * Math.sin(time / 380 + cell.x + cell.y);
    ctx.strokeStyle = CONFIG.colors.gold;
    ctx.lineWidth = 1.2;

    ctx.beginPath();
    ctx.moveTo(p.x - w * 0.5, p.y + h);
    ctx.lineTo(p.x, p.y + h * 1.5);
    ctx.lineTo(p.x + w * 0.5, p.y + h);
    ctx.stroke();

    ctx.restore();
  }

  function drawBlock(cell) {
    const p = project(cell.x, cell.y);
    const w = CONFIG.tileWidth / 2;
    const h = CONFIG.tileHeight / 2;
    const z = cell.height * CONFIG.blockHeight;

    const top = [
      { x: p.x, y: p.y - z },
      { x: p.x + w, y: p.y + h - z },
      { x: p.x, y: p.y + h * 2 - z },
      { x: p.x - w, y: p.y + h - z }
    ];

    const left = [
      top[3],
      top[2],
      { x: top[2].x, y: top[2].y + z },
      { x: top[3].x, y: top[3].y + z }
    ];

    const right = [
      top[1],
      top[2],
      { x: top[2].x, y: top[2].y + z },
      { x: top[1].x, y: top[1].y + z }
    ];

    polygon(left, '#080808', '#29251c', 0.8);
    polygon(right, '#101010', '#302717', 0.8);
    polygon(top, '#1b1b1b', '#3a301c', 1);

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
    const bob = Math.sin(time / 240 + crystal.phase) * 3;
    const x = p.x;
    const y = p.y + CONFIG.tileHeight / 2 - 12 + bob;

    ctx.save();
    ctx.shadowColor = CONFIG.colors.glow;
    ctx.shadowBlur = 17;

    polygon([
      { x, y: y - 13 },
      { x: x + 7, y: y - 2 },
      { x, y: y + 8 },
      { x: x - 7, y: y - 2 }
    ], '#f9d66b', '#fff1b0', 1);

    polygon([
      { x, y: y - 13 },
      { x: x + 7, y: y - 2 },
      { x, y: y - 1 }
    ], '#fff3b2');

    polygon([
      { x, y: y - 13 },
      { x, y: y - 1 },
      { x: x - 7, y: y - 2 }
    ], '#c18a24');

    ctx.restore();
  }

  function drawPortal(time) {
    const x = CONFIG.columns - 1;
    const y = CONFIG.rows - 1;
    const p = project(x, y);
    const cx = p.x;
    const cy = p.y + CONFIG.tileHeight / 2 - 8;
    const pulse = 1 + Math.sin(time / 220) * 0.08;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(pulse, pulse);

    ctx.shadowColor = CONFIG.colors.glow;
    ctx.shadowBlur = 18;

    ctx.strokeStyle = '#f6c64c';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(0, -10, 12, 18, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = '#fff0a5';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, -10, 7, 13, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();

    if (collected < CONFIG.crystalCount) {
      ctx.save();
      ctx.fillStyle = '#e7c46b';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        `${collected}/${CONFIG.crystalCount}`,
        cx,
        cy + 18
      );
      ctx.restore();
    }
  }

  function drawPlayer(time) {
    const p = project(player.x, player.y);
    const x = p.x;
    const y = p.y + CONFIG.tileHeight / 2 - 10;

    ctx.save();

    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(x, y + 10, 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.shadowColor = CONFIG.colors.glow;
    ctx.shadowBlur = 20;

    const gradient = ctx.createRadialGradient(
      x - 4, y - 5, 1, x, y, 11
    );
    gradient.addColorStop(0, '#fffbd8');
    gradient.addColorStop(0.45, '#ffdf72');
    gradient.addColorStop(1, '#b97b14');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y - Math.sin(time / 130) * 1.5, 9, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  function drawScene(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = CONFIG.colors.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = Math.min(
      1,
      (canvas.width * 0.82) / (CONFIG.columns * CONFIG.tileWidth),
      (canvas.height * 0.68) / (CONFIG.rows * CONFIG.tileHeight * 1.6)
    );

    ctx.save();
    ctx.translate(0, Math.max(8, canvas.height * 0.02));
    ctx.translate(canvas.width / 2, 0);
    ctx.scale(scale, scale);
    ctx.translate(-canvas.width / 2, 0);

    /*
     * Draw in diagonal order so nearer tiles appear in front.
     */
    for (let diagonal = 0; diagonal < CONFIG.columns + CONFIG.rows - 1; diagonal++) {
      for (let y = 0; y < CONFIG.rows; y++) {
        const x = diagonal - y;
        if (!inside(x, y)) continue;

        const cell = maze[y][x];

        if (cell.path) drawPath(cell, time);
        else drawBlock(cell);

        if (x === CONFIG.columns - 1 && y === CONFIG.rows - 1) {
          drawPortal(time);
        }

        crystals.forEach(crystal => {
          if (crystal.x === x && crystal.y === y) {
            drawCrystal(crystal, time);
          }
        });

        if (player.x === x && player.y === y) {
          drawPlayer(time);
        }
      }
    }

    ctx.restore();

    if (paused || won) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.64)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.textAlign = 'center';
      ctx.fillStyle = CONFIG.colors.glow;
      ctx.font = 'bold 24px sans-serif';
      ctx.fillText(
        won ? 'أحسنت! وصلت إلى البوابة' : 'اللعبة متوقفة',
        canvas.width / 2,
        canvas.height / 2
      );

      if (won) {
        ctx.font = '15px sans-serif';
        ctx.fillStyle = '#fff4cf';
        ctx.fillText(
          'اضغط إعادة المرحلة للعب مجددًا',
          canvas.width / 2,
          canvas.height / 2 + 30
        );
      }

      ctx.restore();
    }

    if (message && time < messageUntil) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillStyle = CONFIG.colors.glow;
      ctx.shadowColor = CONFIG.colors.gold;
      ctx.shadowBlur = 10;
      ctx.fillText(message, canvas.width / 2, 32);
      ctx.restore();
    }
  }

  function updateStats() {
    if (typeof app.updateStats === 'function') {
      app.updateStats({
        level,
        moves,
        collected,
        crystals: CONFIG.crystalCount,
        time: Math.floor(elapsed / 1000),
        won,
        paused
      });
    }

    const levelEl = document.getElementById('levelValue');
    const movesEl = document.getElementById('movesValue');
    const crystalEl = document.getElementById('crystalsValue');
    const timeEl = document.getElementById('timeValue');

    if (levelEl) levelEl.textContent = String(level);
    if (movesEl) movesEl.textContent = String(moves);
    if (crystalEl) {
      crystalEl.textContent = `${collected}/${CONFIG.crystalCount}`;
    }
    if (timeEl) {
      const seconds = Math.floor(elapsed / 1000);
      const minutes = Math.floor(seconds / 60);
      timeEl.textContent =
        `${String(minutes).padStart(2, '0')}:` +
        `${String(seconds % 60).padStart(2, '0')}`;
    }
  }

  function showMessage(text, duration = 1200) {
    message = text;
    messageUntil = performance.now() + duration;
  }

  function checkCollect() {
    const crystal = crystals.find(c =>
      !c.taken && c.x === player.x && c.y === player.y
    );

    if (crystal) {
      crystal.taken = true;
      collected++;
      showMessage('تم جمع البلورة الذهبية!');
    }

    if (
      player.x === CONFIG.columns - 1 &&
      player.y === CONFIG.rows - 1
    ) {
      if (collected >= CONFIG.crystalCount) {
        won = true;
        showMessage('اكتملت المرحلة!', 3000);
      } else {
        showMessage('اجمع البلورتين أولًا');
      }
    }

    updateStats();
  }

  function move(direction) {
    if (paused || won) return;

    const delta = directions[direction];
    if (!delta) return;

    const nx = player.x + delta.x;
    const ny = player.y + delta.y;

    if (!inside(nx, ny) || !maze[ny][nx].path) {
      showMessage('هذا الطريق مغلق');
      return;
    }

    player.x = nx;
    player.y = ny;
    moves++;

    checkCollect();
    updateStats();
  }

  function restart() {
    cancelAnimationFrame(animationId);
    generateMaze();
    lastFrame = 0;
    animationId = requestAnimationFrame(loop);
  }

  function togglePause() {
    if (won) return;

    paused = !paused;
    lastTime = performance.now();
    showMessage(paused ? 'تم إيقاف اللعبة' : 'استأنفت اللعب');
    updateStats();
  }

  function loop(time) {
    if (!lastFrame) lastFrame = time;

    const delta = Math.max(0, time - lastFrame);
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

  document.addEventListener('drder:restart', restart);
  document.addEventListener('drder:pause', togglePause);

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

    const direction = map[event.key];
    if (direction) {
      event.preventDefault();
      move(direction);
    }
  });

  generateMaze();
  animationId = requestAnimationFrame(loop);
})();
