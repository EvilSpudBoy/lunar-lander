# Repository Guidelines

## Project Structure & Module Organization
- `docs/` — Deployable site for GitHub Pages.
  - `index.html` — Canvas element, HUD, and controls overlay.
  - `styles.css` — Styling for the canvas, HUD, and overlays.
  - `script.js` — Game logic: terrain (`makeTerrain`), lander (`makeLander`), input, physics, rendering, main loop (`frame`).
- Root can host repo docs (e.g., `README.md`, CI files). No build system or external assets.

## Build, Test, and Development Commands
- Run locally with a static server (examples):
  - Python: `python3 -m http.server 8000` then open `http://localhost:8000/`.
  - Node (serve-cli): `npx serve .` (if installed).
- Directly opening `index.html` in a browser works, but a local server avoids CORS issues in some setups.

## Coding Style & Naming Conventions
- Indentation: 2 spaces. Use semicolons and single quotes.
- Variables/functions: `camelCase`; constants: `UPPER_SNAKE_CASE`.
- Keep functions short and focused; prefer pure helpers. Avoid introducing frameworks.
- Physics is time-based: always scale by `dt` in integrations, and make damping frame-rate independent.
- No linter configured; match existing style in `script.js`.

## Testing Guidelines
- No automated tests yet. Use manual playtesting:
  - Rotation: left/right keys produce smooth, bounded turn rates.
  - Thrust + fuel: up key applies thrust; fuel decreases appropriately.
  - Terrain: landing pad forms a flat, reachable plateau; Y-at-X queries are continuous across segments.
  - Landing: on-pad with safe velocity/angle transitions to `landed`; otherwise `crashed` with reason.
- Tip: Use DevTools Performance to simulate low FPS and verify `dt`-scaled physics.

## Commit & Pull Request Guidelines
- Commits: imperative, concise subject (<=72 chars) + brief body explaining why and how.
- Branch naming: `feat/…`, `fix/…`, or `chore/…`.
- PRs should include:
  - Summary of change and rationale.
  - Screenshots/GIFs of gameplay if UI/feel changes.
  - Notes on testing performed and edge cases considered.

## Security & Configuration Tips
- Project runs fully client-side; no network calls. Keep it dependency-free unless strictly needed.
- If adding assets or modules, keep paths relative to repo root and document them here.
