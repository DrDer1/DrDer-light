
/* DrDer-light — Isometric Maze Engine */
(() => {
  "use strict";

  const UI = window.DrDerLight;
  if (!UI) return;

  const canvas = UI.canvas;
  const ctx = UI.ctx;

  const GOLD = "#f4c64e";
  const BRIGHT = "#fff0a6";
  const DARK = "#090909";

  const DIRS = {
    up:    [0, -1],
    down:  [0, 1],
    left:  [-1, 0],
    right: [1, 0]
  };

  const TILE_W = 42;
  const TILE_H = 22;
  const BLOCK_H = 19;

  let level = 1;
  let maze = [];
  let player = { x: 1, y: 1 };
  let crystals = [];
  let portal = { x: 1, y: 1 };
  let collected = 0;
  let startedAt = 0;
  let elapsedBeforePause = 0;
  let paused = false;
  let won = false;
  let lastMove = 0;
  let animationId = 0;
  let lastFrame = 0;

  const COLS = 9;
  const ROWS = 9;

  function rand(max) {
    return Math.floor(Math.random() * max);
  }

  function key(x, y) {
    return `${x},${y}`;
  }

  function inside(x, y) {
    return x >= 0 && y >= 0 && x < COLS && y < ROWS;
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  /*
   * توليد متاهة كاملة المسارات باستخدام DFS.
   * كل خلية لها أربعة جدران، ثم تُفتح الممرات
   * مع ضمان وجود طريق بين البداية والبوابة.
   */
  function generateMaze() {
    const grid = Array.from({ length: ROWS }, () =>
      Array.from({ length: COLS }, () => ({
        walls: [true, true, true, true],
        visited: false,
        height: 0
      }))
    );

    // ترتيب الجدران: أعلى، يمين، أسفل، يسار.
    const dirs = [
      { dx: 0, dy: -1, wall: 0, opposite: 2 },
      { dx: 1, dy: 0, wall: 1, opposite: 3 },
      { dx: 0, dy: 1, wall: 2, opposite: 0 },
      { dx: -1, dy: 0, wall: 3, opposite: 1 }
    ];

    const stack = [{ x: 0, y: 0 }];
    grid[0][0].visited = true;

    while (stack.length) {
      const current = stack[stack.length - 1];
      const options = shuffle(dirs.filter(d => {
        const x = current.x + d.dx;
        const y = current.y + d.dy;
        return inside(x, y) && !grid[y][x].visited;
      }));

      if (!options.length) {
        stack.pop();
        continue;
      }

      const d = options[0];
      const nx = current.x + d.dx;
      const ny = current.y + d.dy;

      grid[current.y][current.x].walls[d.wall] = false;
      grid[ny][nx].walls[d.opposite] = false;
      grid[ny][nx].visited = true;
      stack.push({ x: nx, y: ny });
    }

    // تحويل المتاهة إلى خلايا بممرات وكتل.
    const result = grid.map((row, y) => row.map((cell, x) => {
      let height = 1 + rand(3);

      // لا نضع كتلًا مرتفعة عند البداية أو البوابة.
      if ((x === 0 && y === 0) ||
          (x === COLS - 1 && y === ROWS - 1)) {
        height = 0;
      }

      return {
        walls: cell.walls.slice(),
        height,
        path: false
      };
    }));

    // مسارات المتاهة نفسها تكون منخفضة ومضيئة.
    result.forEach(row => row.forEach(cell => {
      cell.path = true;
    }));

    return result;
  }

  function reachableFromStart(targetX, targetY) {
    const seen = new Set();
    const queue = [{ x: 0, y: 0 }];
    seen.add(key(0, 0));

    while (queue.length) {
      const p = queue.shift();
      if (p.x === targetX && p.y === targetY) return true;

      const cell = maze[p.y][p.x];

      for (let i = 0; i < 4; i++) {
        if (cell.walls[i]) continue;

        const [dx, dy] = [
          [0, -1],
          [1, 0],
          [0, 1],
          [-1, 0]
        ][i];

        const x = p.x + dx;
        const y = p.y + dy;
        if (!inside(x, y)) continue;

        // لا يمكن عبور كتلة أعلى من حد القفزة.
        if (Math.abs(cell.height - maze[y][x].height) > 1) {
          continue;
        }

        const k = key(x, y);
        if (seen.has(k)) continue;

        seen.add(k);
        queue.push({ x, y });
      }
    }

    return false;
  }

  function carveGuaranteedRoute() {
    // طريق مضمون من البداية إلى البوابة.
    let x = 0;
    let y = 0;

    while (x < COLS - 1 || y < ROWS - 1) {
      const canRight = x < COLS - 1;
      const canDown = y < ROWS - 1;

      let goRight = canRight && (!canDown || Math.random() < 0.5);

      const nx = x + (goRight ? 1 : 0);
      const ny = y + (goRight ? 0 : 1);

      if (goRight) {
        maze[y][x].walls[1] = false;
        maze[ny][nx].walls[3] = false;
      } else {
        maze[y][x].walls[2] = false;
        maze[ny][nx].walls[0] = false;
      }

      // خفض فرق الارتفاعات على المسار المضمون.
      maze[ny][nx].height = Math.min(
        maze[ny][nx].height,
        maze[y][x].height + 1
      );

      x = nx;
      y = ny;
    }
  }

  function newLevel() {
    cancelAnimationFrame(animationId);

    maze = generateMaze();
    carveGuaranteedRoute();

    player = { x: 0, y: 0 };
    portal = { x: COLS - 1, y: ROWS - 1 };

    // البلورات موضوعة على خلايا قابلة للوصول.
    const candidates = [];

    for (let y = 1; y < ROWS - 1; y++) {
      for (let x = 1; x < COLS - 1; x++) {
        if ((x + y) % 2 === 0) {
          candidates.push({ x, y, taken: false });
        }
      }
    }

    shuffle(candidates);

    crystals = [];

    for (const c of candidates) {
      if (crystals.length >= 2) break;
      if (reachableFromStart(c.x, c.y)) {
        crystals.push({
          x: c.x,
          y: c.y,
          active: true,
          phase: Math.random() * Math.PI * 2
        });
      }
    }

    // ضمان وجود بلورتين حتى في الحالات النادرة.
    while (crystals.length < 2) {
      const c = candidates.find(p =>
        !crystals.some(k => k.x === p.x && k.y === p.y)
      );
      if (!c) break;
      crystals.push({
        x: c.x,
        y: c.y,
        active: true,
        phase: Math.random() * Math.PI * 2
      });
    }

    collected = 0;
    won = false;
    paused = false;
    elapsedBeforePause = 0;
    startedAt = performance.now();
    lastMove = 0;

    UI.updateStats({
      level,
      crystals: collected,
      totalCrystals: crystals.length,
      time: "00:00",
      status: "البوابة مغلقة",
      message: "اجمع البلورات الذهبية للوصول إلى البوابة"
    });

    render(0);
    animationId = requestAnimationFrame(loop);
  }

  function canMove(x, y, nx, ny) {
    if (!inside(nx, ny)) return false;

    const dx = nx - x;
    const dy = ny - y;
    let wall;

    if (dx === 1) wall = 1;
    else if (dx === -1) wall = 3;
    else if (dy === 1) wall = 2;
    else wall = 0;

    if (maze[y][x].walls[wall]) return false;

    return Math.abs(maze[y][x].height - maze[ny][nx].height) <= 1;
  }

  function move(direction) {
    if (paused || won) return;

    const now = performance.now();
    if (now - lastMove < 105) return;
    lastMove = now;

    const d = DIRS[direction];
    if (!d) return;

    const nx = player.x + d[0];
    const ny = player.y + d[1];

    if (!canMove(player.x, player.y, nx, ny)) {
      UI.updateStats({
        message: "هذا الطريق مغلق — ابحث عن ممر آخر"
      });
      return;
    }

    player = { x: nx, y: ny };

    for (const c of crystals) {
      if (c.active && c.x === nx && c.y === ny) {
        c.active = false;
        collected++;

        UI.updateStats({
          crystals: collected,
          totalCrystals: crystals.length,
          message: "رائع! جمعت بلورة ذهبية"
        });
      }
    }

    if (nx === portal.x && ny === portal.y) {
      if (collected === crystals.length) {
        won = true;
        const seconds = Math.floor(
          (performance.now() - startedAt) / 1000
        );

        UI.updateStats({
          status: "اكتملت المرحلة",
          message: `أحسنت! أكملت المرحلة خلال ${formatTime(seconds)}`
        });
      } else {
        UI.updateStats({
          message: "اجمع كل البلورات أولًا لفتح البوابة"
        });
      }
    }

    render(performance.now());
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, "0");
    const s = (seconds % 60).toString().padStart(2, "0");
    return `${m}:${s}`;
  }

  function project(x, y, z = 0) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const tileW = Math.min(TILE_W, w / 11);
    const tileH = tileW * 0.52;

    return {
      x: w / 2 + (x - y) * tileW / 2,
      y: h * 0.45 + (x + y) * tileH / 2 - z * BLOCK_H
    };
  }

  function polygon(points, fill, stroke = null, lineWidth = 1) {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();

    ctx.fillStyle = fill;
    ctx.fill();

    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    }
  }

  function drawDiamond(x, y, rx, ry, fill, stroke = null) {
    polygon([
      { x, y: y - ry },
      { x: x + rx, y },
      { x, y: y + ry },
      { x: x - rx, y }
    ], fill, stroke, 1);
  }

  function drawFloor(x, y, time) {
    const p = project(x, y);
    const tw = Math.min(TILE_W, canvas.clientWidth / 11);
    const th = tw * 0.52;

    drawDiamond(
      p.x, p.y, tw / 2, th / 2,
      ((x + y) % 2 === 0) ? "#15130d" : "#100f0b",
      "#5d461b"
    );

    // مسار ذهبي خافت يمر عبر مركز كل خلية.
    ctx.save();
    ctx.globalAlpha = 0.32 + Math.sin(time / 550 + x + y) * 0.08;
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 8;
    drawDiamond(p.x, p.y, tw * 0.14, th * 0.14, GOLD);
    ctx.restore();
  }

  function drawBlock(x, y, height) {
    if (height <= 0) return;

    const p = project(x, y);
    const tw = Math.min(TILE_W, canvas.clientWidth / 11);
    const th = tw * 0.52;
    const z = height * BLOCK_H;

    // الواجهة الأمامية اليسرى.
    polygon([
      { x: p.x - tw / 2, y: p.y },
      { x: p.x, y: p.y + th / 2 },
      { x: p.x, y: p.y + th / 2 + z },
      { x: p.x - tw / 2, y: p.y + z }
    ], "#111111", "#332a17");

    // الواجهة الأمامية اليمنى.
    polygon([
      { x: p.x + tw / 2, y: p.y },
      { x: p.x, y: p.y + th / 2 },
      { x: p.x, y: p.y + th / 2 + z },
      { x: p.x + tw / 2, y: p.y + z }
    ], "#1b1913", "#4b3a19");

    // السطح العلوي.
    polygon([
      { x: p.x, y: p.y - th / 2 },
      { x: p.x + tw / 2, y: p.y },
      { x: p.x, y: p.y + th / 2 },
      { x: p.x - tw / 2, y: p.y }
    ], "#292316", "#b18a2c");

    ctx.save();
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 6;
    ctx.strokeStyle = "#d5a934";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x - tw / 2, p.y);
    ctx.lineTo(p.x, p.y + th / 2);
    ctx.lineTo(p.x + tw / 2, p.y);
    ctx.stroke();
    ctx.restore();
  }

  function drawCrystal(c, time) {
    if (!c.active) return;

    const p = project(c.x, c.y, maze[c.y][c.x].height + 0.8);
    const bob = Math.sin(time / 270 + c.phase) * 3;
    const r = Math.min(9, canvas.clientWidth / 40);

    ctx.save();
    ctx.translate(p.x, p.y - 8 + bob);
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 16;

    polygon([
      { x: 0, y: -r * 1.6 },
      { x: r * 0.8, y: -r * 0.3 },
      { x: r * 0.55, y: r },
      { x: 0, y: r * 1.3 },
      { x: -r * 0.55, y: r },
      { x: -r * 0.8, y: -r * 0.3 }
    ], "#f6cf57", "#fff1aa");

    polygon([
      { x: 0, y: -r * 1.6 },
      { x: r * 0.8, y: -r * 0.3 },
      { x: 0, y: r * 1.3 }
    ], "#fff0a1");

    ctx.restore();
  }

  function drawPortal(time) {
    const p = project(portal.x, portal.y, maze[portal.y][portal.x].height);

    const scale = Math.min(1, canvas.clientWidth / 340);
    const w = 19 * scale;
    const h = 27 * scale;
    const open = collected === crystals.length;

    ctx.save();
    ctx.translate(p.x, p.y - h / 2);

    ctx.shadowColor = open ? BRIGHT : GOLD;
    ctx.shadowBlur = 12 + Math.sin(time / 230) * 4;

    ctx.strokeStyle = open ? BRIGHT : "#9a7224";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-w, h / 2);
    ctx.lineTo(-w, -h / 3);
    ctx.quadraticCurveTo(-w, -h, 0, -h);
    ctx.quadraticCurveTo(w, -h, w, -h / 3);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    ctx.fillStyle = open ? "#e9bb4433" : "#5d451122";
    ctx.fill();

    ctx.restore();
  }

  function drawPlayer(time) {
    const p = project(player.x, player.y, maze[player.y][player.x].height);
    const pulse = 1 + Math.sin(time / 170) * 0.08;
    const r = Math.min(10, canvas.clientWidth / 34) * pulse;

    // ظل الكرة.
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.shadowColor = GOLD;
    ctx.shadowBlur = 10;
    drawDiamond(p.x, p.y + 4, r * 1.15, r * 0.4, "#9a6a18");
    ctx.restore();

    // الكرة نفسها.
    const gradient = ctx.createRadialGradient(
      p.x - r * 0.35, p.y - r * 0.5, 1,
      p.x, p.y, r * 1.3
    );

    gradient.addColorStop(0, "#fffde5");
    gradient.addColorStop(0.25, "#fff0a1");
    gradient.addColorStop(0.62, "#edb92f");
    gradient.addColorStop(1, "#82500b");

    ctx.save();
    ctx.shadowColor = "#ffc93c";
    ctx.shadowBlur = 19;
    ctx.beginPath();
    ctx.arc(p.x, p.y - r * 0.35, r, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "#fff4b7";
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(p.x - r * 0.25, p.y - r * 0.55, r * 0.25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawGrid(time) {
    // أرضية الشبكة.
    for (let sum = 0; sum <= COLS + ROWS - 2; sum++) {
      for (let y = 0; y < ROWS; y++) {
        const x = sum - y;
        if (!inside(x, y)) continue;
        drawFloor(x, y, time);
      }
    }

    // الكتل بترتيب العمق.
    for (let sum = 0; sum <= COLS + ROWS - 2; sum++) {
      for (let y = 0; y < ROWS; y++) {
        const x = sum - y;
        if (!inside(x, y)) continue;

        drawBlock(x, y, maze[y][x].height);

        // الجدران الخارجية.
        const cell = maze[y][x];
        const p = project(x, y);
        const tw = Math.min(TILE_W, canvas.clientWidth / 11);
        const th = tw * 0.52;

        if (cell.walls[1] && x === COLS - 1) {
          polygon([
            { x: p.x + tw / 2, y: p.y },
            { x: p.x, y: p.y + th / 2 },
            { x: p.x, y: p.y + th / 2 + 10 },
            { x: p.x + tw / 2, y: p.y + 10 }
          ], "#14120d", "#6e501b");
        }

        if (cell.walls[2] && y === ROWS - 1) {
          polygon([
            { x: p.x - tw / 2, y: p.y },
            { x: p.x, y: p.y + th / 2 },
            { x: p.x, y: p.y + th / 2 + 10 },
            { x: p.x - tw / 2, y: p.y + 10 }
          ], "#11100c", "#6e501b");
        }
      }
    }
  }

  function render(time = 0) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;

    ctx.clearRect(0, 0, w, h);

    const bg = ctx.createRadialGradient(
      w / 2, h * 0.45, 5,
      w / 2, h * 0.45, w * 0.7
    );
    bg.addColorStop(0, "#211b0c");
    bg.addColorStop(1, DARK);

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.shadowColor = "#d5a52c";
    ctx.shadowBlur = 28;
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1;
    ctx.strokeRect(12, 12, w - 24, h - 24);
    ctx.restore();

    drawGrid(time);
    drawPortal(time);

    for (const crystal of crystals) {
      drawCrystal(crystal, time);
    }

    drawPlayer(time);

    if (paused) {
      ctx.fillStyle = "#000b";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = BRIGHT;
      ctx.font = "bold 22px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("إيقاف مؤقت", w / 2, h / 2);
    }

    if (won) {
      ctx.fillStyle = "#0009";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = BRIGHT;
      ctx.font = "bold 20px system-ui";
      ctx.textAlign = "center";
      ctx.fillText("اكتملت المرحلة!", w / 2, h / 2 - 8);
      ctx.font = "13px system-ui";
      ctx.fillText("اضغط على إعادة المرحلة للعب مجددًا", w / 2, h / 2 + 20);
    }
  }

  function loop(time) {
    if (!paused && !won) {
      const seconds = Math.floor(
        (time - startedAt + elapsedBeforePause) / 1000
      );

      UI.updateStats({ time: formatTime(seconds) });
    }

    render(time);
    animationId = requestAnimationFrame(loop);
  }

  document.addEventListener("drder:move", event => {
    move(event.detail.direction);
  });

  document.addEventListener("drder:restart", () => {
    newLevel();
  });

  document.addEventListener("drder:pause", () => {
    if (won) return;

    if (!paused) {
      elapsedBeforePause += performance.now() - startedAt;
      paused = true;
      UI.updateStats({ message: "اللعبة متوقفة مؤقتًا" });
    } else {
      startedAt = performance.now();
      paused = false;
      UI.updateStats({ message: "واصل رحلتك نحو البوابة الذهبية" });
    }
  });

  document.addEventListener("drder:restart", () => {
    // إعادة المحاولة في المرحلة نفسها.
    newLevel();
  });

  // بدء اللعبة.
  newLevel();
})();
