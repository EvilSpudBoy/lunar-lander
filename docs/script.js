(() => {
  'use strict';

  // Canvas setup
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const btnPause = document.getElementById('btn-pause');
  const btnRestart = document.getElementById('btn-restart');
  const btnAuto = document.getElementById('btn-auto');
  const HUD = {
    fuel: document.getElementById('fuel'),
    speed: document.getElementById('speed'),
    horiz: document.getElementById('horiz'),
    alt: document.getElementById('alt'),
    angle: document.getElementById('angle'),
  };
  const levelSelect = document.getElementById('level');
  const autopilot = { enabled: false };

  // Game constants
  const WORLD = {
    width: canvas.width,
    height: canvas.height,
  };

  const GRAVITY = 22; // px/s^2
  const MAIN_THRUST = 42; // px/s^2
  const ROT_ACC = 2.6; // rad/s^2
  const ANGULAR_DAMP = 0.995; // friction-like damping
  const AIR_DAMP = 0.0005; // small air resistance

  const FUEL_MAIN_PER_S = 26; // units/s when main thruster on
  const FUEL_ROT_PER_S = 6; // units/s when rotating

  const SAFE_LIMITS = {
    vX: 32, // px/s
    vY: 42, // px/s
    angle: 0.2, // rad (~11.5°)
  };

  // Difficulty presets
  const DIFFICULTIES = {
    easy: {
      name: 'Easy',
      fuel: 300,
      padSegments: 6, // wider pad
      padCenter: 'center', // directly below initial lander (screen center)
    },
    normal: {
      name: 'Normal',
      fuel: 100,
      padSegments: 4, // medium pad
      padRangeFrac: [0.3, 0.7], // roughly middle third
    },
    hard: {
      name: 'Hard',
      fuel: 60,
      padSegments: 2, // smaller pad
      padRangeFrac: [0.1, 0.9], // anywhere across most of the map
    },
  };
  let currentDifficulty = 'normal';

  // State
  let terrain = null;
  let lander = null;
  let gameState = 'playing'; // 'playing' | 'paused' | 'landed' | 'crashed'
  let lastTime = 0;

  const input = { left: false, right: false, thrust: false };
  const clearInput = () => { input.left = input.right = input.thrust = false; };

  // Utilities
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const radToDeg = r => (r * 180) / Math.PI;
  const fmt = n => Math.round(n);
  const angleDiff = (a, b) => {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  };

  // Terrain generation
  function makeTerrain(width, height, opts = {}) {
    const marginBottom = 40;
    const minY = height * 0.45;
    const maxY = height - marginBottom;
    const points = [];
    const segments = 22; // number of segments across width
    const step = width / segments;

    // Create rough terrain
    for (let i = 0; i <= segments; i++) {
      const x = i * step;
      const y = lerp(minY, maxY, Math.random() * 0.88);
      points.push({ x, y });
    }

    // Carve a flat landing pad on a proper plateau
    const desiredPadSegs = typeof opts.padSegments === 'number' ? opts.padSegments : (3 + Math.floor(Math.random() * 2));
    const padSegments = clamp(desiredPadSegs, 1, segments - 2);
    let padCenterIdx;
    if (typeof opts.padCenterX === 'number') {
      padCenterIdx = clamp(Math.round(opts.padCenterX / step), 1, segments - 1);
    } else if (opts.padRangeFrac && Array.isArray(opts.padRangeFrac)) {
      const [fmin, fmax] = [clamp(opts.padRangeFrac[0] || 0, 0, 1), clamp(opts.padRangeFrac[1] || 1, 0, 1)];
      const imin = Math.floor(fmin * segments);
      const imax = Math.max(imin + 1, Math.floor(fmax * segments));
      padCenterIdx = clamp(Math.floor(imin + Math.random() * (imax - imin)), 1, segments - 1);
    } else {
      padCenterIdx = Math.floor(segments * (0.35 + Math.random() * 0.3));
    }
    const padY = lerp(minY, maxY, 0.7 + Math.random() * 0.2);

    // Determine start/end indices for the plateau (inclusive for points)
    const half = Math.floor(padSegments / 2);
    let startIdx = clamp(padCenterIdx - half, 1, points.length - 2);
    let endIdx = clamp(startIdx + padSegments, startIdx + 1, points.length - 1);

    // Flatten the plateau points (endIdx - startIdx segments => endIdx - startIdx + 1 points)
    for (let i = startIdx; i <= endIdx; i++) points[i].y = padY;

    // Gently constrain immediate neighbors so there aren't towering walls
    const rise = 20;  // how much higher than pad neighbors can be
    const drop = 30;  // how much lower than pad neighbors can be
    const clampBand = (y) => clamp(y, padY - rise, padY + drop);
    if (startIdx - 1 >= 0) points[startIdx - 1].y = clampBand(points[startIdx - 1].y);
    if (endIdx + 1 < points.length) points[endIdx + 1].y = clampBand(points[endIdx + 1].y);

    // Build segments array with slopes for efficient y-at-x
    const segs = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const m = dy / dx; // slope
      segs.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y, m });
    }

    const padStartX = points[startIdx].x;
    const padEndX = points[endIdx].x;

    return {
      width,
      height,
      points,
      segments: segs,
      pad: { x1: padStartX, x2: padEndX, y: padY },
      yAt(x) {
        const xi = clamp(x, 0, width - 1);
        const idx = Math.min(Math.floor((xi / width) * segs.length), segs.length - 1);
        const s = segs[idx];
        const t = (xi - s.x1) / (s.x2 - s.x1);
        return s.y1 + s.m * (xi - s.x1);
      },
      draw(ctx) {
        // ground polygon
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(0, height);
        for (let i = 0; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.lineTo(width, height);
        ctx.closePath();

        const grd = ctx.createLinearGradient(0, minY, 0, height);
        grd.addColorStop(0, '#0d162d');
        grd.addColorStop(1, '#070b16');
        ctx.fillStyle = grd;
        ctx.fill();

        // outline
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.stroke();

        // landing pad
        ctx.strokeStyle = '#6cf1e6';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(this.pad.x1, this.pad.y);
        ctx.lineTo(this.pad.x2, this.pad.y);
        ctx.stroke();

        // pad markers
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(108,241,230,0.6)';
        for (let i = 0; i < 5; i++) {
          const t = i / 4;
          const x = lerp(this.pad.x1, this.pad.x2, t);
          ctx.beginPath();
          ctx.moveTo(x, this.pad.y);
          ctx.lineTo(x, this.pad.y + 12);
          ctx.stroke();
        }
        ctx.restore();
      },
    };
  }

  // Lander
  function makeLander(initialFuel = 100) {
    const radius = 14;
    return {
      x: WORLD.width * 0.5,
      y: 90,
      vx: (Math.random() * 2 - 1) * 8,
      vy: 2,
      angle: 0, // 0 = up
      omega: 0,
      radius,
      fuel: initialFuel,
      crashedReason: '',
      update(dt) {
        if (dt <= 0) return;

        // Controls and fuel usage
        let ax = 0;
        let ay = GRAVITY;

        const usingThrust = input.thrust && this.fuel > 0;
        if (usingThrust) {
          const tx = Math.sin(this.angle);
          const ty = -Math.cos(this.angle);
          ax += MAIN_THRUST * tx;
          ay += MAIN_THRUST * ty;
          this.fuel = Math.max(0, this.fuel - FUEL_MAIN_PER_S * dt);
        }

        const rotating = (input.left || input.right) && this.fuel > 0;
        if (rotating) this.fuel = Math.max(0, this.fuel - FUEL_ROT_PER_S * dt);
        if (input.left && this.fuel > 0) this.omega -= ROT_ACC * dt;
        if (input.right && this.fuel > 0) this.omega += ROT_ACC * dt;

        // Integrate
        this.vx += ax * dt;
        this.vy += ay * dt;
        // tiny air resistance
        this.vx *= 1 - AIR_DAMP;
        this.vy *= 1 - AIR_DAMP;

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        // Integrate angle with proper time step
        this.angle += this.omega * dt;
        // Apply angular damping in a frame-rate independent way
        const damp = Math.pow(ANGULAR_DAMP, dt * 60);
        this.omega *= damp;

        // keep angle in [-PI, PI]
        if (this.angle > Math.PI) this.angle -= Math.PI * 2;
        if (this.angle < -Math.PI) this.angle += Math.PI * 2;

        // bounds
        const m = this.radius + 2;
        if (this.x < m) { this.x = m; this.vx = Math.abs(this.vx) * 0.2; }
        if (this.x > WORLD.width - m) { this.x = WORLD.width - m; this.vx = -Math.abs(this.vx) * 0.2; }
      },
      draw(ctx) {
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);

        // Body
        ctx.beginPath();
        ctx.moveTo(0, -this.radius);
        ctx.lineTo(this.radius * 0.75, this.radius * 0.5);
        ctx.lineTo(0, this.radius * 0.6);
        ctx.lineTo(-this.radius * 0.75, this.radius * 0.5);
        ctx.closePath();
        ctx.fillStyle = '#cfd8e3';
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1.5;
        ctx.fill();
        ctx.stroke();

        // Legs
        ctx.beginPath();
        ctx.moveTo(-8, this.radius * 0.4);
        ctx.lineTo(-14, this.radius * 0.9);
        ctx.moveTo(8, this.radius * 0.4);
        ctx.lineTo(14, this.radius * 0.9);
        ctx.strokeStyle = 'rgba(255,255,255,0.7)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Flame if thrust
        if (input.thrust && lander.fuel > 0 && gameState === 'playing') {
          const t = performance.now() * 0.02;
          const len = this.radius * (0.8 + 0.25 * Math.sin(t));
          ctx.beginPath();
          ctx.moveTo(-5, this.radius * 0.6);
          ctx.lineTo(0, this.radius * 0.6 + len);
          ctx.lineTo(5, this.radius * 0.6);
          ctx.closePath();
          const grad = ctx.createLinearGradient(0, this.radius * 0.6, 0, this.radius * 0.6 + len);
          grad.addColorStop(0, '#fff7');
          grad.addColorStop(0.5, '#ffd47a');
          grad.addColorStop(1, '#ff7a7a');
          ctx.fillStyle = grad;
          ctx.fill();
        }

        ctx.restore();

        // Altitude line
        const gy = terrain.yAt(this.x);
        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.setLineDash([3, 6]);
        ctx.beginPath();
        ctx.moveTo(this.x, this.y + this.radius);
        ctx.lineTo(this.x, gy);
        ctx.stroke();
        ctx.restore();
      },
    };
  }

  // Stars background
  function drawStars(ctx, width, height) {
    const rng = (seed => () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296)(123456);
    ctx.save();
    for (let i = 0; i < 120; i++) {
      const x = rng() * width;
      const y = rng() * height * 0.6;
      const r = rng() * 1.2 + 0.2;
      ctx.fillStyle = `rgba(255,255,255,${0.5 + rng() * 0.5})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Game management
  function resetGame(randomizeTerrain = true) {
    // Ensure no controls are latched across resets
    clearInput();
    const cfg = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    if (randomizeTerrain || !terrain) {
      let terrainOpts = { padSegments: cfg.padSegments };
      if (cfg.padCenter === 'center') {
        terrainOpts.padCenterX = WORLD.width * 0.5; // directly below initial lander
      } else if (cfg.padRangeFrac) {
        terrainOpts.padRangeFrac = cfg.padRangeFrac;
      }
      terrain = makeTerrain(WORLD.width, WORLD.height, terrainOpts);
    }
    lander = makeLander(cfg.fuel);
    gameState = 'playing';
    hideOverlay();
  }

  function showOverlay(title, message, color = '#e8ecf1') {
    overlay.classList.remove('hidden');
    overlay.innerHTML = `
      <div class="panel">
        <h1 style="color:${color}">${title}</h1>
        <p>${message}</p>
        <p style="margin-top: 10px; color: #9aa6b2">Press R to restart</p>
      </div>
    `;
  }

  function hideOverlay() {
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  // Collision + landing
  function handleCollision() {
    // Bottom of lander reaches or passes terrain
    const groundY = terrain.yAt(lander.x);
    if (lander.y + lander.radius >= groundY) {
      // Pin to ground
      lander.y = groundY - lander.radius;

      const onPad = lander.x >= terrain.pad.x1 && lander.x <= terrain.pad.x2;
      const safeAngle = Math.abs(lander.angle) <= SAFE_LIMITS.angle;
      const safeVX = Math.abs(lander.vx) <= SAFE_LIMITS.vX;
      const safeVY = Math.abs(lander.vy) <= SAFE_LIMITS.vY;

      if (onPad && safeAngle && safeVX && safeVY) {
        lander.vx = 0; lander.vy = 0; lander.omega = 0;
        gameState = 'landed';
        showOverlay('Touchdown!', 'Nice landing commander. Press R to fly again.', '#8df59a');
      } else {
        gameState = 'crashed';
        const reasons = [];
        if (!onPad) reasons.push('missed pad');
        if (!safeAngle) reasons.push('bad angle');
        if (!safeVX) reasons.push('too fast (h)');
        if (!safeVY) reasons.push('too fast (v)');
        lander.crashedReason = reasons.join(', ');
        showOverlay('Crash!', `You ${lander.crashedReason}. Press R to retry.`, '#ff8181');
      }
    }
  }

  // HUD update
  function updateHUD() {
    const vy = lander.vy;
    const vx = lander.vx;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const alt = Math.max(0, terrain.yAt(lander.x) - (lander.y + lander.radius));
    HUD.fuel.textContent = `Fuel: ${fmt(lander.fuel)}%`;
    HUD.speed.textContent = `Speed: ${fmt(speed)}`;
    HUD.horiz.textContent = `H-Speed: ${fmt(vx)}`;
    HUD.alt.textContent = `Altitude: ${fmt(alt)}`;
    HUD.angle.textContent = `Angle: ${fmt(radToDeg(lander.angle))}°`;

    // Color hints for safety
    HUD.speed.style.color = speed <= Math.hypot(SAFE_LIMITS.vX, SAFE_LIMITS.vY) ? 'var(--good)' : 'var(--bad)';
    HUD.horiz.style.color = Math.abs(vx) <= SAFE_LIMITS.vX ? 'var(--good)' : 'var(--bad)';
    HUD.alt.style.color = alt < 60 ? 'var(--warn)' : 'var(--muted)';
    HUD.angle.style.color = Math.abs(lander.angle) <= SAFE_LIMITS.angle ? 'var(--good)' : 'var(--bad)';
  }

  // Main loop
  function frame(t) {
    const now = t || performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;

    // Update
    if (gameState === 'playing') {
      // If autopilot is enabled, compute controls each frame
      if (autopilot.enabled) applyAutopilot(dt);
      lander.update(dt);
      handleCollision();
    }

    // Draw
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawStars(ctx, WORLD.width, WORLD.height);
    terrain.draw(ctx);
    lander.draw(ctx);

    // HUD
    updateHUD();

    requestAnimationFrame(frame);
  }

  // Input handlers
  window.addEventListener('keydown', (e) => {
    // Ignore key events when focused on interactive controls (e.g., level selector)
    const t = e.target;
    const tag = t && t.tagName;
    const isInteractive = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable);
    if (isInteractive) return;
    if (e.repeat) return;
    if (e.code === 'KeyQ') { toggleAutopilot(); return; }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = true;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = true;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') input.thrust = true;
    if (e.code === 'KeyP') togglePause();
    if (e.code === 'KeyR') resetGame(false);
    // Prevent page scroll defaults for arrows
    if (e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => {
    const t = e.target;
    const tag = t && t.tagName;
    const isInteractive = tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable);
    if (isInteractive) return;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
    if (e.code === 'ArrowUp' || e.code === 'KeyW') input.thrust = false;
  });

  btnPause.addEventListener('click', togglePause);
  btnRestart.addEventListener('click', () => resetGame(false));
  if (btnAuto) btnAuto.addEventListener('click', toggleAutopilot);

  // Level selection
  if (levelSelect) {
    levelSelect.addEventListener('change', () => {
      currentDifficulty = levelSelect.value;
      clearInput();
      autopilot.enabled = false;
      updateAutopilotUI();
      resetGame(true);
    });
  }

  // Clear stuck inputs when tab loses focus
  window.addEventListener('blur', clearInput);
  document.addEventListener('visibilitychange', () => { if (document.hidden) clearInput(); });

  function togglePause() {
    if (gameState === 'playing') {
      gameState = 'paused';
      showOverlay('Paused', 'Press P to resume. R to restart.', '#ffd47a');
    } else if (gameState === 'paused') {
      gameState = 'playing';
      hideOverlay();
    }
  }

  function toggleAutopilot() {
    autopilot.enabled = !autopilot.enabled;
    clearInput();
    updateAutopilotUI();
  }

  function updateAutopilotUI() {
    if (btnAuto) btnAuto.textContent = `Autopilot: ${autopilot.enabled ? 'On' : 'Off'}`;
  }

  // Simple heuristic autopilot: tilt toward pad center and manage descent rate
  function applyAutopilot(dt) {
    if (!terrain || !lander || lander.fuel <= 0) return; // if no fuel, leave controls off
    const padCenter = (terrain.pad.x1 + terrain.pad.x2) * 0.5;
    const padHalf = Math.max(8, (terrain.pad.x2 - terrain.pad.x1) * 0.5);
    const ex = padCenter - lander.x; // + means pad is to the right
    const vx = lander.vx;
    const vy = lander.vy;
    const alt = Math.max(0, terrain.yAt(lander.x) - (lander.y + lander.radius));

    // Desired tilt (radians), PD on horizontal position/velocity
    const MAX_TILT = 0.6; // ~34°
    const KpX = 0.0012;   // rad per px
    const KdV = 0.0045;   // rad per (px/s)
    let desiredTilt = clamp(KpX * ex + KdV * (-vx), -MAX_TILT, MAX_TILT);

    // Reduce tilt as we get close to the pad and near the ground
    if (Math.abs(ex) < padHalf * 0.7) desiredTilt *= 0.5;
    if (alt < 60) desiredTilt = clamp(desiredTilt, -0.25, 0.25);
    if (alt < 18) desiredTilt = 0; // final flare

    // Rotate towards desired tilt
    const angErr = angleDiff(desiredTilt, lander.angle);
    input.left = false; input.right = false; // autopilot overrides manual
    const ANG_EPS = 0.02;
    if (angErr > ANG_EPS) input.right = true; // need to increase angle
    else if (angErr < -ANG_EPS) input.left = true; // need to decrease angle

    // Vertical speed target: faster high, slower low
    const vMaxFar = 36;
    const vMaxNear = 22;
    let vDes = 12 + 0.10 * alt; // px/s downward
    vDes = Math.min(vDes, Math.abs(ex) < padHalf * 0.7 ? vMaxNear : vMaxFar);
    if (alt < 60) vDes = Math.min(vDes, 18);
    if (alt < 20) vDes = Math.min(vDes, 12);

    // Thrust control: bang-bang on vertical speed error
    input.thrust = vy > vDes; // if descending too fast, burn
  }

  // Init
  function init() {
    resetGame(true);
    lastTime = performance.now();
    requestAnimationFrame(frame);
    updateAutopilotUI();
  }

  init();
})();
