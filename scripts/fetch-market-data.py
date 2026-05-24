#!/usr/bin/env python3

from __future__ import annotations

import csv
import json
import math
import os
import signal
import sys
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:
    import certifi

    os.environ.setdefault("SSL_CERT_FILE", certifi.where())
except Exception:
    pass

import bittensor as bt


ROOT = Path(__file__).resolve().parents[1]
EXPORTS = ROOT / "exports"
DEFAULT_ENDPOINTS = [
    os.environ.get("BITTENSOR_ENDPOINT", "").strip(),
    "finney",
    "wss://bittensor-finney.api.onfinality.io/public-ws",
]


class ChainTimeout(TimeoutError):
    pass


@contextmanager
def deadline(seconds: int):
    previous_handler = signal.getsignal(signal.SIGALRM)

    def handle_timeout(_signum: int, _frame: Any) -> None:
        raise ChainTimeout(f"chain call exceeded {seconds}s")

    signal.signal(signal.SIGALRM, handle_timeout)
    signal.alarm(seconds)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous_handler)


def call_with_deadline(label: str, seconds: int, callback: Any) -> Any:
    with deadline(seconds):
        start = time.time()
        value = callback()
        print(f"{label} in {time.time() - start:.1f}s", file=sys.stderr)
        return value


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def finite(value: float | None, fallback: float = 0.0) -> float:
    if value is None or not math.isfinite(value):
        return fallback
    return value


def to_float(value: Any, fallback: float = 0.0) -> float:
    if value is None:
        return fallback
    try:
        return finite(float(value), fallback)
    except Exception:
        tao = getattr(value, "tao", None)
        if tao is None:
            return fallback
        try:
            return finite(float(tao), fallback)
        except Exception:
            return fallback


def to_str(value: Any) -> str:
    if value is None:
        return ""
    return str(value)


def flow_record(value: Any) -> tuple[int | None, float]:
    if isinstance(value, tuple) and len(value) >= 2:
        block, balance = value[0], value[1]
        try:
            block_number = int(block)
        except Exception:
            block_number = None
        return block_number, to_float(balance)
    return None, to_float(value)


def build_market_item(meta: Any, flow: Any) -> dict[str, Any]:
    emissions = [to_float(value) for value in (getattr(meta, "emission", None) or [])]
    coldkeys = [to_str(value) for value in (getattr(meta, "coldkeys", None) or [])]
    owner_coldkey = to_str(getattr(meta, "owner_coldkey", ""))
    total_neuron_emission = sum(emissions)
    owner_emission = sum(
        emission for emission, coldkey in zip(emissions, coldkeys) if coldkey == owner_coldkey
    )
    burn_emission_pct = (
        owner_emission / total_neuron_emission * 100 if total_neuron_emission > 0 else 0
    )
    flow_block, tao_flow = flow_record(flow)

    return {
        "netuid": int(getattr(meta, "netuid")),
        "name": to_str(getattr(meta, "name", "")),
        "symbol": to_str(getattr(meta, "symbol", "")),
        "taoFlow": round(tao_flow, 12),
        "taoFlowBlock": flow_block,
        "burnEmissionPct": round(burn_emission_pct, 6),
        "ownerEmission": round(owner_emission, 12),
        "totalNeuronEmission": round(total_neuron_emission, 12),
        "subnetEmission": round(to_float(getattr(meta, "subnet_emission", None)), 12),
        "burnCost": round(to_float(getattr(meta, "burn", None)), 12),
        "taoIn": round(to_float(getattr(meta, "tao_in", None)), 12),
        "alphaIn": round(to_float(getattr(meta, "alpha_in", None)), 12),
        "alphaOut": round(to_float(getattr(meta, "alpha_out", None)), 12),
        "movingPrice": round(to_float(getattr(meta, "moving_price", None)), 12),
        "subnetVolume": round(to_float(getattr(meta, "subnet_volume", None)), 12),
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
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(payload["items"])


def active_endpoints() -> list[str]:
    seen: set[str] = set()
    endpoints: list[str] = []
    for endpoint in DEFAULT_ENDPOINTS:
        if endpoint and endpoint not in seen:
            seen.add(endpoint)
            endpoints.append(endpoint)
    return endpoints


def fetch_subnet_netuids(subtensor: Any) -> list[int]:
    infos = call_with_deadline("Fetched subnet registry", 45, subtensor.get_all_subnets_info)
    return sorted(int(info.netuid) for info in infos if int(info.netuid) > 0)


def fetch_bulk_metagraphs(subtensor: Any) -> list[Any]:
    metagraphs = call_with_deadline("Fetched bulk metagraphs", 35, subtensor.get_all_metagraphs_info)
    return [meta for meta in metagraphs if int(meta.netuid) > 0]


def fetch_metagraphs_per_subnet(subtensor: Any, netuids: list[int]) -> list[Any]:
    metagraphs: list[Any] = []
    for index, netuid in enumerate(netuids, start=1):
        try:
            meta = call_with_deadline(
                f"Fetched metagraph {netuid} ({index}/{len(netuids)})",
                18,
                lambda netuid=netuid: subtensor.get_metagraph_info(netuid),
            )
            metagraphs.append(meta)
        except Exception as exc:
            print(f"Metagraph {netuid} failed once: {exc}", file=sys.stderr)
            meta = call_with_deadline(
                f"Retried metagraph {netuid}",
                24,
                lambda netuid=netuid: subtensor.get_metagraph_info(netuid),
            )
            metagraphs.append(meta)
    return metagraphs


def fetch_chain_data() -> tuple[str, dict[int, Any], list[Any], str]:
    last_error: Exception | None = None
    for endpoint in active_endpoints():
        print(f"Connecting to {endpoint}", file=sys.stderr)
        try:
            subtensor = bt.Subtensor(network=endpoint)
            flows = call_with_deadline("Fetched TAO flow", 45, subtensor.get_all_ema_tao_inflow)
            try:
                return endpoint, flows, fetch_bulk_metagraphs(subtensor), "bulk"
            except Exception as bulk_error:
                print(f"Bulk metagraph fetch failed: {bulk_error}", file=sys.stderr)
                netuids = fetch_subnet_netuids(subtensor)
                return endpoint, flows, fetch_metagraphs_per_subnet(subtensor, netuids), "per-netuid"
        except Exception as exc:
            last_error = exc
            print(f"Endpoint {endpoint} failed: {exc}", file=sys.stderr)

    raise RuntimeError(f"Unable to fetch market data: {last_error}")


def main() -> None:
    endpoint, flows, metagraphs, metagraph_fetch_mode = fetch_chain_data()
    items = [
        build_market_item(meta, flows.get(int(getattr(meta, "netuid"))))
        for meta in metagraphs
        if int(getattr(meta, "netuid")) > 0
    ]
    items.sort(key=lambda item: item["netuid"])

    flow_blocks = [item["taoFlowBlock"] for item in items if item["taoFlowBlock"] is not None]
    burn_values = [item["burnEmissionPct"] for item in items if item["totalNeuronEmission"] > 0]
    positive_flow = sum(1 for item in items if item["taoFlow"] > 0)
    negative_flow = sum(1 for item in items if item["taoFlow"] < 0)

    payload = {
        "updatedAt": utc_now(),
        "network": "finney",
        "source": {
            "method": "bittensor-sdk",
            "endpoint": endpoint,
            "taoFlowCall": "Subtensor.get_all_ema_tao_inflow",
            "metagraphCall": "Subtensor.get_all_metagraphs_info",
            "metagraphFetchMode": metagraph_fetch_mode,
            "burnEmissionPct": "owner coldkey emission share of total metagraph emission",
        },
        "summary": {
            "subnets": len(items),
            "flowBlock": max(flow_blocks) if flow_blocks else None,
            "positiveFlow": positive_flow,
            "negativeFlow": negative_flow,
            "flatFlow": len(items) - positive_flow - negative_flow,
            "averageBurnEmissionPct": round(sum(burn_values) / len(burn_values), 6)
            if burn_values
            else 0,
            "maxBurnEmissionPct": round(max(burn_values), 6) if burn_values else 0,
        },
        "items": items,
    }
    write_outputs(payload)
    print(
        f"Wrote {len(items)} market rows at block {payload['summary']['flowBlock']} "
        f"to market-data.js"
    )


if __name__ == "__main__":
    main()
