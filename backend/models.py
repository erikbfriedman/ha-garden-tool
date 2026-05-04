"""Pydantic data models for the Garden Tool project format (v2)."""

from __future__ import annotations
from typing import Literal, Optional, Union
from pydantic import BaseModel, Field


# ── Primitives ──────────────────────────────────────────────────────────────

class Point(BaseModel):
    x: float
    y: float


# ── Yard Objects (structural: house, driveway, trees, etc.) ─────────────────

YardObjectType = Literal[
    "house", "garage", "shed",
    "driveway", "sidewalk", "patio", "deck", "path",
    "tree", "bush", "pool",
    "fence", "other",
]

YardObjectShape = Literal["rect", "circle", "polygon"]


class YardObjectBase(BaseModel):
    id: str
    type: YardObjectType = "other"
    name: str = ""
    color: str = "#888888"
    opacity: float = 1.0
    locked: bool = False
    notes: str = ""
    z_index: int = 0


class YardObjectRect(YardObjectBase):
    shape: Literal["rect"] = "rect"
    x: float
    y: float
    w: float
    h: float
    rotation: float = 0.0


class YardObjectCircle(YardObjectBase):
    shape: Literal["circle"] = "circle"
    x: float
    y: float
    r: float


class YardObjectPolygon(YardObjectBase):
    shape: Literal["polygon"] = "polygon"
    pts: list[Point]


YardObject = Union[YardObjectRect, YardObjectCircle, YardObjectPolygon]


# ── Garden Beds ──────────────────────────────────────────────────────────────

class LatNode(BaseModel):
    id: str
    name: str = ""
    t: float = 0.5  # 0..1 position along lattice


class Lattice(BaseModel):
    id: str
    name: str = "Lattice"
    mount: Literal["side", "center"] = "side"
    side: Literal["North", "South", "East", "West"] = "North"
    height: str = ""
    width: str = ""
    nodes: list[LatNode] = Field(default_factory=list)


class Bed(BaseModel):
    id: str
    x: float
    y: float
    w: float
    h: float
    cr: float = 0.0  # corner radius (quarter-inches)
    name: str = "Bed"
    color: str = "#2d5a1b"
    is_raised: bool = False
    height: str = ""
    location: str = ""
    locked: bool = False
    lattices: list[Lattice] = Field(default_factory=list)


# ── Plants ───────────────────────────────────────────────────────────────────

class PlantDef(BaseModel):
    id: str
    name: str
    category: str = "Vegetables"
    variety: str = ""
    color: str = "#4caf50"
    spread_in: float = 12.0
    icon_id: str = "leaf"
    can_indoor: bool = False
    indoor_wks: int = 6
    transplant_wks: int = 0
    sow_wks: int = 0
    harvest_min: int = 60
    harvest_max: int = 90
    is_vine: bool = False
    climb_type: str = "Tendril"
    is_perennial: bool = False
    notes: str = ""


class Plant(BaseModel):
    id: str
    x: float
    y: float
    name: str
    color: str = "#4caf50"
    spread_q: float = 48.0  # quarter-inches
    lib_id: str = ""
    icon_id: str = "leaf"
    parent_bed: Optional[str] = None
    lattice_id: Optional[str] = None
    node_id: Optional[str] = None
    plant_date: Optional[str] = None
    notes: str = ""
    locked: bool = False


# ── Water Items (sprinklers + drip lines) ────────────────────────────────────

class Sprinkler(BaseModel):
    id: str
    type: Literal["water"] = "water"
    spr_type: str = "Full circle"
    x: float
    y: float
    r_q: float = 48.0  # radius in quarter-inches
    arc: float = 360.0
    angle: float = 0.0
    mount: str = "low"
    edge_snap: bool = False
    parent_bed: Optional[str] = None
    icon_id: str = "full"
    flow_rate: float = 2.0
    zone: str = ""
    name: str = ""
    locked: bool = False


class DripLine(BaseModel):
    id: str
    type: Literal["water"] = "water"
    spr_type: Literal["Drip line"] = "Drip line"
    pts: list[Point]
    parent_bed: Optional[str] = None
    mount: str = "low"
    emitter_spacing: str = '6"'
    flow_rate: float = 1.0
    zone: str = ""
    name: str = ""
    locked: bool = False
    icon_id: str = "drip"


WaterItem = Union[Sprinkler, DripLine]


# ── Irrigation Network ───────────────────────────────────────────────────────

PipeMaterial = Literal["hose", "pvc", "poly", "copper"]


class Faucet(BaseModel):
    id: str
    x: float
    y: float
    name: str = "Faucet"
    max_flow_gpm: float = 5.0   # gallons per minute
    pressure_psi: float = 50.0  # static pressure at source
    elevation: float = 0.0      # feet above yard datum
    notes: str = ""
    locked: bool = False


class Pipe(BaseModel):
    id: str
    name: str = ""
    pts: list[Point]
    from_id: str = ""   # faucet id or upstream pipe id
    to_id: str = ""     # sprinkler/drip id or downstream pipe id
    diameter_in: float = 0.75   # inner diameter in inches
    material: PipeMaterial = "hose"
    notes: str = ""
    locked: bool = False


# ── Project Settings ─────────────────────────────────────────────────────────

class YardSettings(BaseModel):
    width_ft: float = 40.0
    height_ft: float = 30.0


class GardenSettings(BaseModel):
    zone: str = "6b"
    location: str = ""
    last_frost: str = ""
    first_frost: str = ""
    avg_rainfall: str = "38"
    rain_unit: str = "in/yr"
    notes: str = ""


class ProjectSettings(BaseModel):
    yard: YardSettings = Field(default_factory=YardSettings)
    garden: GardenSettings = Field(default_factory=GardenSettings)


# ── Full Project ─────────────────────────────────────────────────────────────

class Project(BaseModel):
    ver: int = 2
    settings: ProjectSettings = Field(default_factory=ProjectSettings)
    yard_objects: list[dict] = Field(default_factory=list)   # YardObject union
    beds: list[dict] = Field(default_factory=list)
    plants: list[dict] = Field(default_factory=list)
    plant_lib: list[dict] = Field(default_factory=list)
    w_items: list[dict] = Field(default_factory=list)
    faucets: list[dict] = Field(default_factory=list)
    pipes: list[dict] = Field(default_factory=list)
