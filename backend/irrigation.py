"""
Irrigation network flow and pressure calculations.

Uses the Hazen-Williams equation for friction loss:
  h_f = 10.67 × L × Q^1.852 / (C^1.852 × D^4.87)

Where:
  h_f = friction head loss (ft of water)
  L   = pipe length (ft)
  Q   = flow rate (GPM)
  C   = Hazen-Williams roughness coefficient (dimensionless)
  D   = internal pipe diameter (ft)

Pressure conversion: 1 PSI = 2.3077 ft of head
"""

from __future__ import annotations
import math
from typing import Any


# Hazen-Williams roughness coefficients
HW_ROUGHNESS: dict[str, float] = {
    "hose": 130,
    "pvc": 150,
    "poly": 140,
    "copper": 140,
}

PSI_PER_FT_HEAD = 1 / 2.3077  # PSI per foot of head
FT_HEAD_PER_PSI = 2.3077      # feet of head per PSI
FT_PER_QUARTER_INCH = 1 / 48  # 1 quarter-inch = 1/48 foot


def hazen_williams_loss(
    flow_gpm: float,
    length_ft: float,
    diameter_in: float,
    material: str = "hose",
) -> float:
    """Return friction head loss in PSI for given segment."""
    if flow_gpm <= 0 or length_ft <= 0 or diameter_in <= 0:
        return 0.0
    C = HW_ROUGHNESS.get(material, 130)
    D_ft = diameter_in / 12.0
    # h_f in feet
    h_f = 10.67 * length_ft * (flow_gpm ** 1.852) / ((C ** 1.852) * (D_ft ** 4.87))
    return h_f * PSI_PER_FT_HEAD  # convert to PSI


def segment_length_ft(pts: list[dict]) -> float:
    """Calculate polyline length in feet from quarter-inch pts."""
    total = 0.0
    for i in range(1, len(pts)):
        dx = pts[i]["x"] - pts[i - 1]["x"]
        dy = pts[i]["y"] - pts[i - 1]["y"]
        total += math.hypot(dx, dy)
    return total * FT_PER_QUARTER_INCH


def analyze_network(
    faucets: list[dict],
    pipes: list[dict],
    w_items: list[dict],
) -> dict[str, Any]:
    """
    Build the irrigation graph and return analysis results.

    Returns:
      {
        "faucets": { faucet_id: { "total_flow_gpm": float, "heads": [...] } },
        "pipes":   { pipe_id: { "flow_gpm": float, "pressure_drop_psi": float,
                                "inlet_psi": float, "outlet_psi": float,
                                "status": "ok" | "warning" | "error" } },
        "heads":   { head_id: { "pressure_psi": float, "flow_gpm": float,
                                "status": "ok" | "warning" | "insufficient" } },
        "warnings": [ str, ... ],
      }
    """
    # Index objects by id
    faucet_map = {f["id"]: f for f in faucets}
    pipe_map = {p["id"]: p for p in pipes}
    head_map = {w["id"]: w for w in w_items}

    result_faucets: dict[str, Any] = {}
    result_pipes: dict[str, Any] = {}
    result_heads: dict[str, Any] = {}
    warnings: list[str] = []

    # Build from_id → [pipe_id] adjacency
    adjacency: dict[str, list[str]] = {}
    for p in pipes:
        from_id = p.get("fromId") or p.get("from_id", "")
        pid = p["id"]
        adjacency.setdefault(from_id, []).append(pid)

    def trace_from_faucet(faucet_id: str) -> None:
        """BFS/DFS from faucet through pipe network, compute pressures."""
        faucet = faucet_map[faucet_id]
        source_psi = float(faucet.get("pressurePSI") or faucet.get("pressure_psi", 50))
        max_flow = float(faucet.get("maxFlowGPM") or faucet.get("max_flow_gpm", 5))
        elevation_ft = float(faucet.get("elevation", 0))

        connected_heads: list[dict] = []
        total_flow = 0.0

        # DFS with pressure tracking
        stack: list[tuple[str, float]] = [(faucet_id, source_psi)]
        visited_pipes: set[str] = set()

        while stack:
            node_id, inlet_psi = stack.pop()
            child_pipe_ids = adjacency.get(node_id, [])

            for pipe_id in child_pipe_ids:
                if pipe_id in visited_pipes:
                    continue
                visited_pipes.add(pipe_id)

                pipe = pipe_map.get(pipe_id)
                if not pipe:
                    continue

                # Determine flow to this pipe's endpoint
                to_id = pipe.get("toId") or pipe.get("to_id", "")
                head = head_map.get(to_id)

                # Get head's rated flow
                if head:
                    head_flow = float(
                        head.get("flowRate") or head.get("flow_rate", 2.0)
                    )
                    flow_gpm = head_flow
                else:
                    flow_gpm = 1.0  # default if unresolved

                pts = [{"x": pt.get("x", 0), "y": pt.get("y", 0)}
                       for pt in (pipe.get("pts") or [])]
                length_ft = segment_length_ft(pts) if len(pts) > 1 else 1.0
                diam = float(
                    pipe.get("diameterIn") or pipe.get("diameter_in", 0.75)
                )
                material = pipe.get("material", "hose")

                loss_psi = hazen_williams_loss(flow_gpm, length_ft, diam, material)
                outlet_psi = max(0.0, inlet_psi - loss_psi)

                # Elevation adjustment (static head)
                # (elevation not tracked per pipe yet; simplified to faucet elevation)
                elevation_psi = elevation_ft * PSI_PER_FT_HEAD
                outlet_psi_adj = outlet_psi - elevation_psi

                pipe_status = (
                    "ok" if outlet_psi_adj > 20
                    else "warning" if outlet_psi_adj > 10
                    else "error"
                )

                result_pipes[pipe_id] = {
                    "flow_gpm": flow_gpm,
                    "pressure_drop_psi": round(loss_psi, 2),
                    "inlet_psi": round(inlet_psi, 2),
                    "outlet_psi": round(outlet_psi_adj, 2),
                    "status": pipe_status,
                }

                if head:
                    total_flow += flow_gpm
                    head_status = (
                        "ok" if outlet_psi_adj > 15
                        else "warning" if outlet_psi_adj > 8
                        else "insufficient"
                    )
                    result_heads[to_id] = {
                        "pressure_psi": round(outlet_psi_adj, 2),
                        "flow_gpm": flow_gpm,
                        "status": head_status,
                    }
                    connected_heads.append({
                        "id": to_id,
                        "name": head.get("name", "Head"),
                        "pressure_psi": round(outlet_psi_adj, 2),
                    })

                    if head_status == "insufficient":
                        warnings.append(
                            f"Head '{head.get('name', to_id)}' has insufficient "
                            f"pressure ({outlet_psi_adj:.1f} PSI)"
                        )
                else:
                    # Pipe continues to another pipe or junction
                    stack.append((to_id, outlet_psi_adj))

        if total_flow > max_flow:
            warnings.append(
                f"Faucet '{faucet.get('name', faucet_id)}' total flow "
                f"{total_flow:.1f} GPM exceeds capacity {max_flow:.1f} GPM"
            )

        result_faucets[faucet_id] = {
            "total_flow_gpm": round(total_flow, 2),
            "max_flow_gpm": max_flow,
            "heads": connected_heads,
            "status": "ok" if total_flow <= max_flow else "overloaded",
        }

    for faucet in faucets:
        trace_from_faucet(faucet["id"])

    return {
        "faucets": result_faucets,
        "pipes": result_pipes,
        "heads": result_heads,
        "warnings": warnings,
    }
