# Lunar Lander

Retro-inspired lunar lander written in vanilla JS + Canvas. Fly, rotate, and land safely on the highlighted pad. Includes difficulty levels and a simple HUD.

## Live Demo
Once GitHub Pages is enabled (Settings → Pages → Deploy from branch → `main` + folder `docs/`), the game will be available at:

- https://EvilSpudBoy.github.io/lunar-lander/

## Controls
- Arrow Left/Right (or A/D): rotate
- Arrow Up (or W): thrust
- P: pause/resume
- R: restart
- Level selector (top bar): Easy, Normal, Hard

## Run Locally
Option 0 (no server):
- Open `docs/index.html` directly in your browser.

Option 1 (serve repo root, open `/docs`):
- `python3 -m http.server 8000` then open `http://localhost:8000/docs/`

Option 2 (serve only the site folder):
- `cd docs && python3 -m http.server 8000` then open `http://localhost:8000/`

Note: A server isn’t required for this project, but using one can help with consistent paths and testing in devtools.

## Features
- Time-based physics with rotation/thrust, fuel consumption, and soft damping
- Procedural terrain with a flat landing plateau and visual pad markers
- Difficulty presets:
  - Easy: wide centered pad, lots of fuel
  - Normal: mid-map pad, standard fuel
  - Hard: smaller pad anywhere across the map, less fuel

## Contributing
See AGENTS.md for project structure, style, and PR guidelines.
