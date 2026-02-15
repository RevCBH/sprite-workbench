# Sprite Workbench

Browser-based sprite sheet workbench for video clips.

## Milestone Order

- `M1` (current): client-only workflow. No local API server required.
- `v1`: adds optional project/workflow adapters (including server-backed flows).

## M1 Features

- Drag-and-drop video import
- Worker-backed frame extraction
- Loop detection hints
- Frame curation (enable/disable, in/out, skip)
- Chroma key controls (color, tolerance, softness, despill)
- Sprite sheet export bundle (`.zip`) containing:
  - sheet PNG
  - atlas JSON
  - Godot `SpriteFrames` `.tres`
  - export manifest JSON
- GIF export for quick preview

## Quick Start

```bash
cd sprite-workbench
npm install
npm run dev
```

Then open `http://localhost:5173/sprite-workbench.html` if your browser does not auto-open.

## Build

```bash
npm run build
npm run preview
```

## Roadmap

See `ROADMAP.md` for milestone details (`M1` and `v1`).

## License

MIT. See `LICENSE`.
