# HA Garden Tool

A canvas-based garden planner with yard structure drawing, irrigation network layout, and flow-rate calculations. Deployable as a standalone Home Assistant add-on.

## Features

- **Yard objects** – draw house, garage, shed, driveway, sidewalk, patio, deck, path, trees, bushes, pool, fence (rect / circle / polygon per type)
- **Garden beds** – rectangular raised beds with optional lattice for climbing plants
- **Plants** – instance-based planting from a built-in or custom library; spread circles, vine support
- **Irrigation** – place faucets, draw pipe routes (polyline), connect to sprinklers or drip lines; Hazen-Williams flow/pressure analysis
- **Layers panel** – toggle visibility of yard objects, beds, plants, irrigation
- **Undo / Redo** – 30-step history
- **Server-side saves** – projects stored as `.gdn` JSON files on the backend; project picker dialog
- **AI plant art** – optional Anthropic API integration for generated plant icons (key set in HA add-on config)
- **Dark garden theme** – canvas + sidebar UI

---

## Project Structure

```
HA Garden Tool/
├── backend/
│   ├── app.py              FastAPI: static files + REST API + AI proxy
│   ├── models.py           Pydantic v2 data models
│   ├── irrigation.py       Hazen-Williams flow calculation engine
│   └── requirements.txt
├── frontend/
│   ├── index.html          HTML shell + CSS
│   └── src/
│       ├── main.js         Bootstrap & event wiring
│       ├── constants.js    FT, IN, type lists, defaults
│       ├── utils.js        Math helpers, unit conversion
│       ├── icons.js        SVG icon paths
│       ├── state.js        Singleton store + undo/redo
│       ├── viewport.js     Canvas zoom/pan
│       ├── renderer.js     All canvas drawing (single draw() call)
│       ├── hitTest.js      Click hit-testing for all object types
│       ├── tools.js        Tool state machine + mouse/keyboard handlers
│       ├── ui.js           Sidebar cards, explorer, settings
│       ├── library.js      Plant library view + default plant definitions
│       ├── files.js        New/Open/Save/SaveAs/Export via backend API
│       └── flowCalc.js     Irrigation analysis UI (calls backend)
├── addon/
│   ├── config.yaml         HA add-on manifest
│   ├── Dockerfile
│   └── run.sh
└── README.md
```

---

## Local Development

### Prerequisites

- Python 3.11+
- A modern browser (Chrome, Firefox, Edge)

### Install & run

```bash
cd backend
pip install -r requirements.txt
uvicorn app:app --reload --port 8099
```

Open **http://localhost:8099** in your browser.

Projects are saved to `./projects/` relative to the repo root (created automatically).

### Optional: AI plant art

Set `ANTHROPIC_API_KEY` in your environment before starting the server:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
uvicorn app:app --reload --port 8099
```

---

## Home Assistant Add-on

### Installation

1. Copy the `HA Garden Tool/` folder to your HA `addons/` directory (local add-ons).
2. In HA → **Settings → Add-ons → Add-on Store → ⋮ → Check for updates**.
3. The **Garden Tool** add-on will appear under Local add-ons — click **Install**.
4. Optionally set `anthropic_api_key` in the add-on configuration panel.
5. Click **Start**.
6. Open the add-on Web UI (ingress or direct on port 8099).

Projects are stored in HA persistent storage at `/data/projects/` and survive restarts and updates.

### Add-on configuration options

| Option | Default | Description |
|--------|---------|-------------|
| `port` | `8099` | TCP port for the web server |
| `anthropic_api_key` | *(empty)* | Key for AI plant art generation (optional) |

---

## Coordinate System

All spatial values are in **quarter-inches** (qin):

| Unit | qin |
|------|-----|
| 1 foot | 48 |
| 1 inch | 4 |

The default yard is 40 ft × 30 ft = 1920 × 1440 qin.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/projects` | List saved project names |
| `GET` | `/api/projects/{name}` | Load project JSON |
| `POST` | `/api/projects/{name}` | Save / overwrite project JSON |
| `DELETE` | `/api/projects/{name}` | Delete project file |
| `GET` | `/api/projects/{name}/export` | Download `.gdn` file |
| `POST` | `/api/ai/art` | Proxy to Anthropic image API |
| `POST` | `/api/irrigation/analyze` | Run Hazen-Williams flow analysis |

### Project file format (v2)

```json
{
  "ver": 2,
  "settings": {
    "yard":   { "widthFt": 40, "heightFt": 30 },
    "garden": { "zone": "6b", "lastFrost": "2025-04-15", ... }
  },
  "yardObjects": [...],
  "beds": [...],
  "plants": [...],
  "plantLib": [...],
  "wItems": [...],
  "faucets": [...],
  "pipes": [...]
}
```

v1 files (missing `yardObjects`, `faucets`, `pipes`) load without error — missing arrays default to `[]`.

---

## Irrigation Flow Calculation

The backend uses the **Hazen-Williams** equation:

```
h_f = 10.67 × L × Q^1.852 / (C^1.852 × D^4.87)
```

where:
- `L` = pipe length (ft)
- `Q` = flow rate (GPM)
- `D` = inner diameter (ft)
- `C` = roughness coefficient (hose=130, pvc=150, poly=140, copper=140)

The analysis builds an adjacency graph from faucets → pipes → heads and performs a DFS for each path, accumulating pressure loss. Results are color-coded:

| Color | Meaning |
|-------|---------|
| Blue | OK — adequate pressure |
| Yellow | Low — reduced flow |
| Red | Insufficient — pressure too low |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Ctrl+Z` | Undo |
| `Ctrl+Y` / `Ctrl+Shift+Z` | Redo |
| `Ctrl+S` | Save |
| `Ctrl+Shift+S` | Save As |
| `Ctrl+N` | New project |
| `Ctrl+O` | Open project |
| `Escape` | Cancel drawing / deselect |
| `Tab` | Duplicate selected object |
| `Delete` / `Backspace` | Delete selected object |
| `Scroll` | Zoom (on canvas) |
| `Shift+Scroll` | Zoom (alternative) |
| `Right-drag` | Pan |
