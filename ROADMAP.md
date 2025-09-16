# Roadmap

This document outlines planned features and improvements for the Lunar Lander project. Scope focuses on keeping the game lightweight (static, no build step) while improving playability, replayability, and tuneability.

## Near‑Term (Gameplay + UX)
- Control Panel (tuning constants)
  - UI panel to adjust: gravity, main thrust, rotation accel, angular/air damping, initial fuel, pad width/range.
  - Live updates with safe bounds and a "Reset to defaults" button. Persist choices in `localStorage`.
- Scoring System
  - Score on successful landing: higher for less fuel used and shorter time. Pad size/offset adds multipliers.
  - Track per‑level best (Easy/Normal/Hard). Simple scoreboard with reset.

## Medium‑Term (Evaluation + Balancing)
- Autopilot Simulations
  - Headless simulation mode to run N seeds and collect stats: success rate, mean time, landing velocities, remaining fuel.
  - Deterministic RNG with seed; expose `simulate(seed, config)` and return JSON.
  - Web Worker to avoid blocking the UI; progress indicator and CSV/JSON export.
- Difficulty Tuning
  - Use simulation results to tighten safety limits and terrain ranges while avoiding impossible pads.

## Stretch Ideas
- Assisted Landing Modes
  - Vertical hold (caps descent rate), lateral hold (nudges toward pad center).
- Replay & Ghosts
  - Save last run inputs/states; render a ghost for learning/comparison.
- Mobile Controls
  - On‑screen buttons/tilt controls; responsive HUD.
- Visual/Audio Polish
  - Simple SFX (thrust/impact), subtle particle effects for dust on touchdown, better pad lighting.

## Technical Notes & Milestones
- Refactor incrementally toward modules (ESM) without a bundler; keep deploy target in `docs/`.
- Add lightweight tests where it pays off:
  - Physics integration (dt scaling), `yAt(x)` continuity, landing safety checks.
  - Autopilot unit tests for burn timing given angle/altitude/velocity.
- CI: GitHub Actions for Pages deploy + basic lint/test (optional).
- Telemetry (dev only): optional console logs for key events (burn start/stop, touchdown reasons) behind a debug flag.

Contributions welcome. Please discuss significant changes in an issue before opening a PR.
