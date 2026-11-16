# Ayrton Senna — an unofficial fan tribute

A single-page, scroll-driven tribute to Ayrton Senna (1960–1994): his story from São Paulo to Imola, the numbers behind three World Championships, hold-to-drive laps of five great races, and the legacy of the Instituto Ayrton Senna.

**Unofficial.** Not affiliated with, endorsed by or connected to the Senna family, Senna Brands, the Instituto Ayrton Senna, Formula 1, the FIA, any racing team, or Netflix.

## Run locally

```bash
python3 serve.py 4174
```

Then open http://localhost:4174. It is a static site (HTML, CSS, ES modules) using GSAP + ScrollTrigger, Lenis and Three.js from CDNs with pinned versions. Add `?rm=1` to preview the reduced-motion layout.

## Content and credits

- All graphics (3D helmet, cars, circuit outlines, shaders, illustrations) are original and procedural. Circuit maps are stylised and not to scale. No team logos, sponsor marks or the trademarked helmet design are reproduced.
- Photographs come from Wikimedia Commons under Creative Commons licences; each credit is listed in the site footer and in `assets/photos/photos.json`. Images were resized for the web.
- Facts were checked against Formula1.com, McLaren, Motor Sport, senna.com and the Instituto Ayrton Senna annual report.

## Structure

- `index.html`, `css/style.css`, `js/main.js` — page, styles, scroll orchestration
- `js/hero-scene.js`, `js/helmet-scene.js` — Three.js hero (particle car, 3D helmet)
- `js/shaders.js` — rain, speed-line and flow backgrounds
- `js/circuits.js`, `js/lap-drive.js` — circuit outlines and hold-to-drive laps
- `js/story.js` — the life-story sequence
- `js/depth-photo.js` — 2.5D depth effect on photographs
- `dev/` — standalone test pages for each module
