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
  const autopilot = { enabled: false, burning: false };

  // Game constants
  const WORLD = {
    width: canvas.width,
    height: canvas.height,
  };

  // Base physics constants
  const BASE = {
    GRAVITY: 22,      // px/s^2
    MAIN_THRUST: 42,  // px/s^2
    ROT_ACC: 2.6,     // rad/s^2
    FUEL_MAIN_PER_S: 26,
    FUEL_ROT_PER_S: 6,
    SAFE: { vX: 32, vY: 42, angle: 0.2 },
  };
  // Active (difficulty-scaled) physics; updated on reset/level change
  const PHYS = {
    gravity: BASE.GRAVITY,
    mainThrust: BASE.MAIN_THRUST,
    rotAcc: BASE.ROT_ACC,
    fuelMainPerS: BASE.FUEL_MAIN_PER_S,
    fuelRotPerS: BASE.FUEL_ROT_PER_S,
    safe: { ...BASE.SAFE },
  };
  const ANGULAR_DAMP = 0.995; // friction-like damping
  const AIR_DAMP = 0.0005; // small air resistance

  // Autopilot tuning (varies by difficulty)
  const AUTOCFG = {
    glideAlt: 140,
    baseMargin: 22,    // px safety margin for suicide burn computation
    marginVelK: 0.3,   // additional margin proportional to current vy
    vFinalNear: 6,     // target vy close to ground
    vFinal: 10,        // target vy otherwise
  };

  // Difficulty presets
  const DIFFICULTIES = {
    easy: {
      name: 'Easy',
      fuel: 300,
      padSegments: 6, // wider pad
      padCenter: 'center', // directly below initial lander (screen center)
      physics: { gravityScale: 0.9, thrustScale: 1.15, rotScale: 1.2, fuelMainScale: 0.9, fuelRotScale: 0.9,
        safe: { vX: 44, vY: 54, angle: 0.32 } },
      auto: { glideAlt: 160, baseMargin: 20, marginVelK: 0.25, vFinalNear: 5, vFinal: 8 },
    },
    normal: {
      name: 'Normal',
      fuel: 100,
      padSegments: 4, // medium pad
      padRangeFrac: [0.3, 0.7], // roughly middle third
      physics: { gravityScale: 1.0, thrustScale: 1.05, rotScale: 1.1, fuelMainScale: 1.0, fuelRotScale: 1.0,
        safe: { vX: 38, vY: 48, angle: 0.25 } },
      auto: { glideAlt: 150, baseMargin: 26, marginVelK: 0.32, vFinalNear: 6, vFinal: 10 },
    },
    hard: {
      name: 'Hard',
      fuel: 60,
      padSegments: 2, // smaller pad
      padRangeFrac: [0.1, 0.9], // anywhere across most of the map
      physics: { gravityScale: 1.05, thrustScale: 0.98, rotScale: 1.0, fuelMainScale: 1.0, fuelRotScale: 1.0,
        safe: { vX: 28, vY: 38, angle: 0.18 } },
      auto: { glideAlt: 140, baseMargin: 30, marginVelK: 0.38, vFinalNear: 7, vFinal: 12 },
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
        let ay = PHYS.gravity;

        const usingThrust = input.thrust && this.fuel > 0;
        if (usingThrust) {
          const tx = Math.sin(this.angle);
          const ty = -Math.cos(this.angle);
          ax += PHYS.mainThrust * tx;
          ay += PHYS.mainThrust * ty;
          this.fuel = Math.max(0, this.fuel - PHYS.fuelMainPerS * dt);
        }

        const rotating = (input.left || input.right) && this.fuel > 0;
        if (rotating) this.fuel = Math.max(0, this.fuel - PHYS.fuelRotPerS * dt);
        if (input.left && this.fuel > 0) this.omega -= PHYS.rotAcc * dt;
        if (input.right && this.fuel > 0) this.omega += PHYS.rotAcc * dt;

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
  function applyDifficultyConfig(cfg) {
    const p = (cfg && cfg.physics) || {};
    // Physics scaling
    PHYS.gravity = BASE.GRAVITY * (p.gravityScale ?? 1);
    PHYS.mainThrust = BASE.MAIN_THRUST * (p.thrustScale ?? 1);
    PHYS.rotAcc = BASE.ROT_ACC * (p.rotScale ?? 1);
    PHYS.fuelMainPerS = BASE.FUEL_MAIN_PER_S * (p.fuelMainScale ?? 1);
    PHYS.fuelRotPerS = BASE.FUEL_ROT_PER_S * (p.fuelRotScale ?? 1);
    // Safety limits
    const safe = p.safe || {};
    PHYS.safe.vX = safe.vX ?? BASE.SAFE.vX;
    PHYS.safe.vY = safe.vY ?? BASE.SAFE.vY;
    PHYS.safe.angle = safe.angle ?? BASE.SAFE.angle;
    // Autopilot tuning
    const a = (cfg && cfg.auto) || {};
    AUTOCFG.glideAlt = a.glideAlt ?? AUTOCFG.glideAlt;
    AUTOCFG.baseMargin = a.baseMargin ?? AUTOCFG.baseMargin;
    AUTOCFG.marginVelK = a.marginVelK ?? AUTOCFG.marginVelK;
    AUTOCFG.vFinalNear = a.vFinalNear ?? AUTOCFG.vFinalNear;
    AUTOCFG.vFinal = a.vFinal ?? AUTOCFG.vFinal;
  }

  function resetGame(randomizeTerrain = true) {
    // Ensure no controls are latched across resets
    clearInput();
    const cfg = DIFFICULTIES[currentDifficulty] || DIFFICULTIES.normal;
    applyDifficultyConfig(cfg);
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
      const safeAngle = Math.abs(lander.angle) <= PHYS.safe.angle;
      const safeVX = Math.abs(lander.vx) <= PHYS.safe.vX;
      const safeVY = Math.abs(lander.vy) <= PHYS.safe.vY;

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
    HUD.speed.style.color = speed <= Math.hypot(PHYS.safe.vX, PHYS.safe.vY) ? 'var(--good)' : 'var(--bad)';
    HUD.horiz.style.color = Math.abs(vx) <= PHYS.safe.vX ? 'var(--good)' : 'var(--bad)';
    HUD.alt.style.color = alt < 60 ? 'var(--warn)' : 'var(--muted)';
    HUD.angle.style.color = Math.abs(lander.angle) <= PHYS.safe.angle ? 'var(--good)' : 'var(--bad)';
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
    // Glide: fade tilt as we descend to preserve vertical thrust
    const GLIDE_ALT = AUTOCFG.glideAlt;
    const tiltScale = clamp(alt / GLIDE_ALT, 0, 1);
    desiredTilt *= tiltScale;
    if (Math.abs(ex) < padHalf * 0.7) desiredTilt *= 0.6;
    if (alt < 60) desiredTilt = clamp(desiredTilt, -0.22, 0.22);
    if (alt < 22) desiredTilt = 0; // final flare to maximize vertical thrust

    // Rotate towards desired tilt
    const angErr = angleDiff(desiredTilt, lander.angle);
    input.left = false; input.right = false; // autopilot overrides manual
    const ANG_EPS = 0.02;
    if (angErr > ANG_EPS) input.right = true; // need to increase angle
    else if (angErr < -ANG_EPS) input.left = true; // need to decrease angle

    // Fuel-aware vertical control using stopping distance (suicide burn heuristic)
    const cosA = Math.cos(lander.angle);
    const a_on = PHYS.gravity - PHYS.mainThrust * Math.max(0, cosA); // vertical acceleration when thrusting
    const vFinal = alt < 18 ? AUTOCFG.vFinalNear : AUTOCFG.vFinal; // desired descent speed

    let needBurn = false;
    if (a_on < 0 && vy > vFinal) {
      // stopping distance to go from vy to vFinal under a_on
      const s_stop = (vFinal * vFinal - vy * vy) / (2 * a_on); // a_on negative => positive distance
      const margin = AUTOCFG.baseMargin + AUTOCFG.marginVelK * vy; // safety buffer grows with speed
      needBurn = s_stop + margin >= alt;
    }

    // If we are significantly tilted, prefer to align before burning unless it's urgent
    const tooTilted = Math.abs(lander.angle) > 0.35 && alt > 30;
    if (tooTilted && needBurn && a_on >= -2) {
      // Not enough vertical decel when tilted; wait a moment to level to save fuel
      needBurn = false;
    }

    // Maintain some hysteresis once burning to avoid rapid toggling
    if (autopilot.burning) {
      // Keep burning until we're under target or nearly down
      if (vy <= vFinal + 1 || alt < 8) autopilot.burning = false;
    } else {
      // Start burn if needed now, or if close to ground and too fast
      if (needBurn || (alt < 28 && vy > vFinal)) autopilot.burning = true;
    }

    input.thrust = autopilot.burning;
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
