# Editing this site's content

Nothing here requires touching `script.js`, `style.css`, or `index.html`.
Three files control everything:

- `topics.json` — every "page"/node in the graph
- `diary.json` — the sketchbook journal entries
- `media.json` — every image/audio/video file, in one place

---

## Adding or removing a topic (page)

Open `topics.json`. It's a list of objects like:

```json
{
  "name": "Rocks & Crystals",
  "slug": "rocks",
  "show": true,
  "category": "personal",
  "content": "<p>Some HTML here</p>"
}
```

- **To add a page**: copy one of these blocks, paste it into the list,
  change `name`, `slug` (must be unique, no spaces), `category`
  (`creative` / `systems` / `science` / `personal` — controls the color),
  and `content`.
- **To remove a page**: delete its block. Or, if you just want to hide it
  temporarily without deleting it, set `"show": false` — it disappears
  from the graph and menu but stays in the file.
- **Order doesn't matter.** The graph lays nodes out automatically.

---

## Adding media (images, audio, video)

### Step 1 — register the file in `media.json`

```json
{
  "labradorite-1": "assets/images/rocks/labradorite-1.jpg",
  "cover-track-1": "assets/audio/covers/track-1.mp3"
}
```

Left side = a short key you'll reuse. Right side = the real path under
`assets/`. This is the **only** place a file path is ever written.
If you move or rename a file, you only fix it here — every topic that
uses that key updates automatically.

Suggested folders (adjust to match what you actually have):
```
assets/images/<category>/...
assets/audio/<category>/...
assets/video/<category>/...
```

### Step 2 — reference the key in a topic

There are two ways to write a topic's `content`:

**A) Plain HTML string** (works today, no change needed) — use this for
text-only topics, or if you're comfortable writing `<img>` tags by hand.

**B) A list of content blocks** — easier when mixing text with media,
since you never write HTML for the media parts:

```json
{
  "name": "Rocks & Crystals",
  "slug": "rocks",
  "show": true,
  "category": "personal",
  "content": [
    { "type": "text", "html": "<p>A small physical collection.</p>" },
    { "type": "image", "key": "labradorite-1", "caption": "Found June 2026" },
    { "type": "audio", "key": "cover-track-1" },
    { "type": "video", "key": "site-demo-clip", "caption": "Quick walkthrough" }
  ]
}
```

Block types: `text`, `image`, `audio`, `video`.
Optional fields per media block: `caption`, `alt` (images only).

You can freely mix as many text/image/audio/video blocks as you want,
in any order — the panel just renders them top to bottom.

---

## Adding a diary entry

Open `diary.json`, add a block to the list:

```json
{
  "date": "2026-07-02",
  "title": "short title",
  "text": "What happened, a sentence or two."
}
```

Newest-dated entry always shows first automatically.

---

## Quick checklist when adding a new piece of content

1. Drop the file into the right `assets/...` subfolder.
2. Add one line to `media.json` (key → path).
3. Reference that key in a topic's content block (or write raw HTML if
   you prefer).
4. Save. Refresh the page — no build step, no server restart needed.