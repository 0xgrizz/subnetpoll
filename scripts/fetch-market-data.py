#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
import math
import re
import ssl
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import certifi
except Exception:
    certifi = None


ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / "exports"
TAOSTATS_SUBNETS_URL = "https://taostats.io/subnets"
TAOSTATS_QUERY_KEY = ["dtaoSubnetPools", {"order": "market_cap_desc"}]
RAO_PER_TAO = 1_000_000_000
NEXT_FLIGHT_RE = re.compile(r"self\.__next_f\.push\((.*?)\)</script>", re.S)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def finite(value: float | None, fallback: float = 0.0) -> float:
    if value is None or not math.isfinite(value):
        return fallback
    return value


def to_float(value: Any, fallback: float | None = 0.0) -> float | None:
    if value is None or value == "":
        return fallback
    try:
        number = float(value)
    except Exception:
        return fallback
    if not math.isfinite(number):
        return fallback
    return number


def to_int(value: Any, fallback: int | None = None) -> int | None:
    number = to_float(value, None)
    if number is None:
        return fallback
    return int(number)


def to_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def to_tao(value: Any, fallback: float = 0.0) -> float:
    number = to_float(value, None)
    if number is None:
        return fallback
    return number / RAO_PER_TAO


def rounded(value: float | None, digits: int = 12) -> float | None:
    if value is None or not math.isfinite(value):
        return None
    return round(value, digits)


def fetch_html(url: str) -> str:
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; ThumbsFlow/1.0; +https://thumbsflow.io)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    request = urllib.request.Request(url, headers=headers)
    context = None
    if certifi is not None:
        context = ssl.create_default_context(cafile=certifi.where())

    with urllib.request.urlopen(request, timeout=60, context=context) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_next_flight(html: str) -> str:
    chunks: list[str] = []
    for match in NEXT_FLIGHT_RE.finditer(html):
        try:
            payload = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(payload, list) and len(payload) > 1 and isinstance(payload[1], str):
            chunks.append(payload[1])

    if not chunks:
        raise RuntimeError("Taostats page did not include a readable Next.js data stream")
    return "".join(chunks)


def slice_json_object(text: str, start: int) -> str:
    depth = 0
    in_string = False
    escaped = False

    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]

    raise RuntimeError("Could not find the end of the Taostats query payload")


def extract_query_payload(flight: str) -> dict[str, Any]:
    query_key = json.dumps(TAOSTATS_QUERY_KEY, separators=(",", ":"))
    needle = f'"queryKey":{query_key}'
    query_index = flight.find(needle)
    if query_index < 0:
        raise RuntimeError(f"Could not find Taostats query key {query_key}")

    start = flight.rfind('{"dehydratedAt"', 0, query_index)
    if start < 0:
        raise RuntimeError("Could not find the start of the Taostats query payload")

    return json.loads(slice_json_object(flight, start))


def fetch_taostats_pools() -> list[dict[str, Any]]:
    html = fetch_html(TAOSTATS_SUBNETS_URL)
    flight = extract_next_flight(html)
    query = extract_query_payload(flight)
    rows = query.get("state", {}).get("data", {}).get("data")
    if not isinstance(rows, list):
        raise RuntimeError("Taostats query payload did not contain subnet pool rows")
    return [row for row in rows if isinstance(row, dict)]


def build_market_item(row: dict[str, Any]) -> dict[str, Any]:
    netuid = int(row["netuid"])
    incentive_burn = finite(to_float(row.get("incentive_burn"), 0.0), 0.0) * 100

    return {
        "netuid": netuid,
        "name": to_str(row.get("subnet_name") or row.get("name")),
        "symbol": to_str(row.get("symbol")),
        "taoFlow": round(to_tao(row.get("net_flow_30_days")), 12),
        "taoFlowBlock": to_int(row.get("block_number")),
        "burnEmissionPct": round(incentive_burn, 6),
        "ownerEmission": None,
        "totalNeuronEmission": rounded(to_float(row.get("emission"), None), 12),
        "subnetEmission": rounded(to_float(row.get("projected_emission"), None), 12),
        "burnCost": round(to_tao(row.get("neuron_registration_cost")), 12),
        "taoIn": round(to_tao(row.get("total_tao")), 12),
        "alphaIn": round(to_tao(row.get("alpha_in_pool")), 12),
        "alphaOut": round(to_tao(row.get("alpha_staked")), 12),
        "movingPrice": rounded(to_float(row.get("price") or row.get("last_price"), None), 12),
        "subnetVolume": round(to_tao(row.get("tao_volume_24_hr")), 12),
    }


def write_outputs(payload: dict[str, Any]) -> None:
    EXPORTS.mkdir(exist_ok=True)

    js = "window.SUBNET_MARKET_DATA = "
    js += json.dumps(payload, ensure_ascii=True, indent=2)
    js += ";\n"
    (ROOT / "market-data.js").write_text(js, encoding="utf-8")

    latest_json = EXPORTS / "subnet-market-data-latest.json"
    latest_json.write_text(json.dumps(payload, ensure_ascii=True, indent=2) + "\n", encoding="utf-8")

    csv_path = EXPORTS / "subnet-market-data-latest.csv"
    fields = [
        "netuid",
        "name",
        "symbol",
        "taoFlow",
        "taoFlowBlock",
        "burnEmissionPct",
        "ownerEmission",
        "totalNeuronEmission",
        "subnetEmission",
        "burnCost",
        "taoIn",
        "alphaIn",
        "alphaOut",
        "movingPrice",
        "subnetVolume",
    ]
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(payload["items"])


def main() -> None:
    rows = fetch_taostats_pools()
    items = [
        build_market_item(row)
        for row in rows
        if to_int(row.get("netuid")) is not None and int(row["netuid"]) > 0
    ]
    items.sort(key=lambda item: item["netuid"])

    flow_blocks = [item["taoFlowBlock"] for item in items if item["taoFlowBlock"] is not None]
    burn_values = [item["burnEmissionPct"] for item in items if item["burnEmissionPct"] is not None]
    positive_flow = sum(1 for item in items if item["taoFlow"] > 0)
    negative_flow = sum(1 for item in items if item["taoFlow"] < 0)

    payload = {
        "updatedAt": utc_now(),
        "network": "finney",
        "source": {
            "method": "taostats-public-subnets-page",
            "url": TAOSTATS_SUBNETS_URL,
            "queryKey": "dtaoSubnetPools",
            "taoFlowField": "net_flow_30_days",
            "taoFlowTimeframe": "1 month",
            "taoFlowTableLabel": "Flow 1M",
            "taoFlowUnit": "TAO",
            "conversion": "rao values divided by 1e9",
            "burnEmissionPct": "Taostats incentive_burn displayed as a percentage",
        },
        "summary": {
            "subnets": len(items),
            "flowBlock": max(flow_blocks) if flow_blocks else None,
            "positiveFlow": positive_flow,
            "negativeFlow": negative_flow,
            "flatFlow": len(items) - positive_flow - negative_flow,
            "netFlow": round(sum(item["taoFlow"] for item in items), 12),
            "averageBurnEmissionPct": round(sum(burn_values) / len(burn_values), 6)
            if burn_values
            else 0,
            "maxBurnEmissionPct": round(max(burn_values), 6) if burn_values else 0,
        },
        "items": items,
    }
    write_outputs(payload)
    print(
        f"Wrote {len(items)} Taostats Flow 1M rows at block "
        f"{payload['summary']['flowBlock']} to market-data.js"
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"fetch-market-data failed: {exc}", file=sys.stderr)
        raise
