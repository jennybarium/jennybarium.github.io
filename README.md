# NODE — personal index

A single-page personal diary/portfolio: a live, force-directed node graph (D3 v7) as the front door, a hidden slide-out menu, a minimal audio player, and a journal-log stream pulled from `diary.json`. Pure HTML/CSS/vanilla JS — no build step, no server.

## Files

```
index.html      structure
style.css       cyberpunk-terminal styling
script.js       graph, nav, modal, diary stream, player
topics.json     every topic node — edit this to change the site
diary.json      journal log entries
assets/audio/   drop your mp3 here
```

## Customizing content

Everything on the page is generated from **topics.json**. Each entry looks like:

```json
{
  "name": "My music & covers",
  "slug": "music",
  "show": true,
  "category": "creative",
  "content": "<p>HTML or plain text for the detail panel.</p>"
}
```

- `show: false` instantly removes the topic from the graph **and** the hidden menu — nothing to delete, just flip the flag.
- `category` drives node color and grouping. Built-in categories: `creative` (magenta), `systems` (blue), `science` (amber), `personal` (green). Anything else falls back to cyan. Add new categories by adding a color to `CATEGORY_COLORS` at the top of `script.js`.
- `content` accepts HTML, so you can drop in `<img>` tags, links, or the included `.gallery-grid` / `.gallery-item` classes for a quick image grid — just replace the placeholder divs with real `<img>` tags:

```html
<div class="gallery-grid">
  <div class="gallery-item"><img src="assets/img/photo1.jpg" alt="..."></div>
</div>
```

Add `img.gallery-item, .gallery-item img { width:100%; height:100%; object-fit:cover; }` to `style.css` if you switch to real images.

## Updating the diary

Edit **diary.json** — an array of `{ "date": "YYYY-MM-DD", "title": "...", "text": "..." }`. Entries are sorted newest-first automatically; no need to reorder them yourself.

## Swapping the audio track

1. Put your mp3 in `assets/audio/` (any filename).
2. In `index.html`, update the `<source>` tag inside `#audio`:
   ```html
   <source src="assets/audio/your-track.mp3" type="audio/mpeg">
   ```
3. Optionally edit the placeholder title text `#trackTitle` in `index.html`, or set it from `script.js` after load.

## Running locally

Just open `index.html` in a browser. If your browser blocks `fetch()` on `file://` URLs (some do, for JSON), run a tiny local server instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploying to GitHub Pages

1. Push this folder to a GitHub repo (root, or a `/docs` folder — your choice).
2. Repo → **Settings → Pages** → Source: deploy from branch → pick `main` and the folder you used.
3. Wait a minute, then visit the URL GitHub gives you.

No build step, no dependencies to install — D3 loads from a CDN (`https://d3js.org/d3.v7.min.js`) and Google Fonts loads `JetBrains Mono` / `Space Mono`. Both are fetched once and cached by the browser, so the page keeps working offline after the first load (aside from the fonts/D3 needing that first fetch — vendor them locally into an `/assets` folder if you need a fully offline first load too).

## Notes on the graph

- The center "hub" node is just a visual anchor — it isn't a real topic and isn't clickable.
- Nodes drift gently on their own and are gently pushed by the mouse/finger — this is `d3-force` re-heating itself on an interval plus a small custom repulsion force in `script.js` (`renderGraph`).
- Drag any node to pin it in place while dragging; it releases back into the simulation on drop.
- Scroll/pinch to zoom, drag empty space to pan.

## Accessibility

- Nodes are keyboard-focusable (`tabindex`) and open with Enter/Space.
- The hidden menu and content panel both close on `Escape` and trap focus visually within a clear border.
- Respects `prefers-reduced-motion` by killing animation durations sitewide.
