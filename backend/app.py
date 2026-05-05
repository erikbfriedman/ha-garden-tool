"""
Garden Tool FastAPI backend.

Serves the frontend and provides:
  - Project CRUD (server-side file storage)
  - AI art proxy (to Anthropic API)
  - Irrigation network analysis
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from .irrigation import analyze_network

logger = logging.getLogger("garden-tool")
logging.basicConfig(level=logging.INFO)

# ── Paths ────────────────────────────────────────────────────────────────────

BASE_DIR = Path(__file__).parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
# HA add-on uses /data/projects; fall back to local ./projects
PROJECTS_DIR = Path(os.environ.get("PROJECTS_DIR", BASE_DIR.parent / "projects"))
PROJECTS_DIR.mkdir(parents=True, exist_ok=True)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")

# ── App ──────────────────────────────────────────────────────────────────────

app = FastAPI(title="Garden Tool", version="2.0.0")


# ── Project API ──────────────────────────────────────────────────────────────

@app.get("/api/projects")
async def list_projects() -> list[str]:
    """List all saved project names (without extension)."""
    return sorted(p.stem for p in PROJECTS_DIR.glob("*.gdn"))


@app.get("/api/projects/{name}")
async def load_project(name: str) -> Any:
    """Load a project by name and return its JSON."""
    path = PROJECTS_DIR / f"{name}.gdn"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    return json.loads(path.read_text(encoding="utf-8"))


@app.post("/api/projects/{name}", status_code=200)
async def save_project(name: str, request: Request) -> dict:
    """Save (create or overwrite) a project."""
    body = await request.body()
    try:
        data = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")
    path = PROJECTS_DIR / f"{name}.gdn"
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    logger.info("Saved project '%s' (%d bytes)", name, len(body))
    return {"ok": True, "name": name}


@app.delete("/api/projects/{name}", status_code=200)
async def delete_project(name: str) -> dict:
    """Delete a project."""
    path = PROJECTS_DIR / f"{name}.gdn"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    path.unlink()
    logger.info("Deleted project '%s'", name)
    return {"ok": True}


@app.get("/api/projects/{name}/export")
async def export_project(name: str) -> FileResponse:
    """Download a project .gdn file to the browser."""
    path = PROJECTS_DIR / f"{name}.gdn"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Project '{name}' not found")
    return FileResponse(
        path=path,
        media_type="application/json",
        filename=f"{name}.gdn",
    )


# ── Irrigation Analysis ───────────────────────────────────────────────────────

@app.post("/api/irrigation/analyze")
async def analyze_irrigation(request: Request) -> Any:
    """Run flow/pressure analysis on the irrigation network."""
    body = await request.json()
    faucets = body.get("faucets", [])
    pipes = body.get("pipes", [])
    w_items = body.get("wItems", body.get("w_items", []))
    return analyze_network(faucets, pipes, w_items)


# ── AI Art Proxy ──────────────────────────────────────────────────────────────

@app.post("/api/ai/art")
async def ai_art_proxy(request: Request) -> Any:
    """Proxy Anthropic API calls for AI art generation."""
    if not ANTHROPIC_API_KEY:
        raise HTTPException(
            status_code=503,
            detail="ANTHROPIC_API_KEY not configured. Set it in the add-on options.",
        )
    body = await request.body()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.anthropic.com/v1/messages",
            content=body,
            headers={
                "Content-Type": "application/json",
                "x-api-key": ANTHROPIC_API_KEY,
                "anthropic-version": "2023-06-01",
            },
        )
    return Response(content=resp.content, media_type="application/json",
                    status_code=resp.status_code)


# ── Static Frontend ───────────────────────────────────────────────────────────

if FRONTEND_DIR.exists():
    class NoCacheJSMiddleware(BaseHTTPMiddleware):
        """Add no-cache headers to JS/CSS responses so edits are always picked up."""
        async def dispatch(self, request, call_next):
            response = await call_next(request)
            path = request.url.path
            if path.endswith(('.js', '.css', '.html')):
                response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate'
                response.headers['Pragma'] = 'no-cache'
            return response

    app.add_middleware(NoCacheJSMiddleware)
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
else:
    @app.get("/")
    async def root() -> dict:
        return {"message": "Frontend not found. Place files in ../frontend/"}
