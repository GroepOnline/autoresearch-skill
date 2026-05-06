#!/usr/bin/env python3
"""Deterministic helpers for autoresearch JSONL, metrics, decisions, and dashboards."""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Literal

Direction = Literal["lower", "higher"]
Action = Literal["baseline", "keep", "discard", "stop"]

_METRIC_RE = re.compile(
    r"^METRIC\s+"
    r"(?P<name>[A-Za-z_][A-Za-z0-9_.:-]*)="
    r"(?P<value>[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)"
    r"(?P<attrs>(?:\s+[A-Za-z_][A-Za-z0-9_.:-]*=[^\s]+)*)\s*$"
)


@dataclass(frozen=True)
class MetricLine:
    name: str
    value: float
    attrs: dict[str, str]

    def as_dict(self) -> dict[str, Any]:
        return {"name": self.name, "value": self.value, "attrs": self.attrs}


@dataclass(frozen=True)
class Decision:
    action: Action
    reason: str
    improvement_pct: float | None = None

    def as_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {"action": self.action, "reason": self.reason}
        if self.improvement_pct is not None:
            data["improvement_pct"] = self.improvement_pct
        return data


def parse_metric_lines(text: str) -> list[MetricLine]:
    """Parse benchmark output lines in `METRIC name=value key=value` format."""
    metrics: list[MetricLine] = []
    for line in text.splitlines():
        match = _METRIC_RE.match(line.strip())
        if not match:
            continue
        attrs: dict[str, str] = {}
        attr_text = match.group("attrs").strip()
        if attr_text:
            for item in attr_text.split():
                key, value = item.split("=", 1)
                attrs[key] = value
        metrics.append(MetricLine(match.group("name"), float(match.group("value")), attrs))
    return metrics


def _load_jsonl(path: Path) -> tuple[list[dict[str, Any]], list[str]]:
    events: list[dict[str, Any]] = []
    errors: list[str] = []
    if not path.exists():
        return [], [f"{path}: file does not exist"]

    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as exc:
            errors.append(f"line {number}: invalid JSON: {exc.msg}")
            continue
        if not isinstance(event, dict):
            errors.append(f"line {number}: event must be a JSON object")
            continue
        event["__line__"] = number
        events.append(event)
    return events, errors


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def _event_value(event: dict[str, Any]) -> float | None:
    value = event.get("median", event.get("value"))
    return float(value) if _is_number(value) else None


def validate_events(events: list[dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    if not events:
        return ["JSONL contains no events"]

    if events[0].get("type") != "config":
        errors.append("first non-empty event must be a config event")

    seen_results: set[int] = set()
    seen_config = False
    for event in events:
        line = event.get("__line__", "?")
        event_type = event.get("type")

        if event_type == "config":
            seen_config = True
            if event.get("schema_version") != 1:
                errors.append(f"line {line}: config.schema_version must be 1")
            for field in ("name", "metric", "direction", "created_at"):
                if field not in event:
                    errors.append(f"line {line}: config.{field} is required")
            if event.get("direction") not in ("lower", "higher"):
                errors.append(f"line {line}: config.direction must be lower or higher")
            continue

        if not seen_config:
            errors.append(f"line {line}: non-config event before config")

        if event_type == "result":
            run = event.get("run")
            if not isinstance(run, int) or run <= 0:
                errors.append(f"line {line}: result.run must be a positive integer")
            else:
                if run in seen_results:
                    errors.append(f"line {line}: duplicate result.run {run}")
                seen_results.add(run)
            if not isinstance(event.get("metric"), str) or not event.get("metric"):
                errors.append(f"line {line}: result.metric is required")
            if _event_value(event) is None:
                errors.append(f"line {line}: result.value or result.median must be a finite number")
            if "samples" in event:
                samples = event["samples"]
                if not isinstance(samples, list) or not samples or any(not _is_number(sample) for sample in samples):
                    errors.append(f"line {line}: result.samples must be a non-empty numeric list")
            if "timestamp" not in event:
                errors.append(f"line {line}: result.timestamp is required")
            continue

        if event_type == "decision":
            run = event.get("run")
            if not isinstance(run, int) or run <= 0:
                errors.append(f"line {line}: decision.run must be a positive integer")
            elif run not in seen_results:
                errors.append(f"line {line}: decision.run {run} has no preceding result")
            if event.get("action") not in ("keep", "discard", "baseline", "stop"):
                errors.append(f"line {line}: decision.action is invalid")
            if not isinstance(event.get("reason"), str) or not event.get("reason"):
                errors.append(f"line {line}: decision.reason is required")
            if "timestamp" not in event:
                errors.append(f"line {line}: decision.timestamp is required")
            continue

        errors.append(f"line {line}: unknown event type {event_type!r}")

    return errors


def load_valid_events(path: Path) -> list[dict[str, Any]]:
    events, errors = _load_jsonl(path)
    errors.extend(validate_events(events))
    if errors:
        raise ValueError("\n".join(errors))
    return events


def median(values: Iterable[float]) -> float:
    values_list = list(values)
    if not values_list:
        raise ValueError("median requires at least one value")
    return float(statistics.median(values_list))


def decide(
    *,
    direction: Direction,
    candidate: float,
    best: float | None,
    min_effect_size_pct: float = 3.0,
    noise_floor_pct: float = 0.0,
    tests_passed: bool = True,
    noisy: bool = False,
) -> Decision:
    """Return a bounded keep/discard/stop decision against the current best."""
    if direction not in ("lower", "higher"):
        raise ValueError("direction must be 'lower' or 'higher'")
    if not math.isfinite(candidate):
        return Decision("discard", "candidate metric is not finite")
    if not tests_passed:
        return Decision("discard", "correctness checks failed")
    if noisy:
        return Decision("stop", "benchmark noise exceeds configured floor")
    if best is None:
        return Decision("baseline", "first valid measurement becomes baseline", 0.0)
    if not math.isfinite(best):
        raise ValueError("best must be finite when provided")

    threshold = max(min_effect_size_pct, noise_floor_pct)
    if best == 0:
        improved = candidate < best if direction == "lower" else candidate > best
        return Decision("keep" if improved else "discard", "zero best value requires strict absolute improvement", None)

    improvement = ((best - candidate) / abs(best) * 100.0) if direction == "lower" else ((candidate - best) / abs(best) * 100.0)
    if improvement >= threshold:
        return Decision("keep", f"improved {improvement:.2f}% over current best (threshold {threshold:.2f}%)", improvement)
    return Decision("discard", f"improvement {improvement:.2f}% is below threshold {threshold:.2f}% or worse than best", improvement)


def summarize(events: list[dict[str, Any]]) -> dict[str, Any]:
    config = next(event for event in events if event.get("type") == "config")
    direction_value: Direction = config["direction"]
    results = [event for event in events if event.get("type") == "result"]
    decisions = [event for event in events if event.get("type") == "decision"]
    by_run = {event["run"]: event for event in results}

    baseline_run: int | None = None
    best_run: int | None = None
    best_value: float | None = None
    action_counts = {"baseline": 0, "keep": 0, "discard": 0, "stop": 0}

    for decision_event in decisions:
        action_counts[decision_event["action"]] += 1
        result = by_run.get(decision_event["run"])
        if not result:
            continue
        value = _event_value(result)
        if value is None:
            continue
        if decision_event["action"] == "baseline" and baseline_run is None:
            baseline_run = result["run"]
        if decision_event["action"] not in ("baseline", "keep"):
            continue
        if best_value is None or (direction_value == "lower" and value < best_value) or (direction_value == "higher" and value > best_value):
            best_value = value
            best_run = result["run"]

    if results and baseline_run is None:
        baseline_run = results[0]["run"]
        if best_value is None:
            best_value = _event_value(results[0])
            best_run = results[0]["run"]

    baseline_value = _event_value(by_run[baseline_run]) if baseline_run in by_run else None
    return {
        "config": {key: value for key, value in config.items() if key != "__line__"},
        "runs": len(results),
        "decisions": action_counts,
        "baseline_run": baseline_run,
        "baseline_value": baseline_value,
        "best_run": best_run,
        "best_value": best_value,
    }


def render_dashboard(events: list[dict[str, Any]]) -> str:
    summary = summarize(events)
    config = summary["config"]
    result_by_run = {event["run"]: event for event in events if event.get("type") == "result"}
    decisions = [event for event in events if event.get("type") == "decision"]
    action_by_run = {event["run"]: event for event in decisions}

    lines = [
        "# Autoresearch Dashboard",
        "",
        f"- Name: {config['name']}",
        f"- Metric: {config['metric']} ({config['direction']})",
        f"- Runs: {summary['runs']}",
        f"- Baseline: run {summary['baseline_run']} = {summary['baseline_value']}",
        f"- Best: run {summary['best_run']} = {summary['best_value']}",
        "",
        "| Run | Value | Action | Reason |",
        "| ---: | ---: | --- | --- |",
    ]

    for run in sorted(result_by_run):
        result = result_by_run[run]
        decision_event = action_by_run.get(run, {})
        value = _event_value(result)
        lines.append(
            f"| {run} | {value} | {decision_event.get('action', 'measured')} | {decision_event.get('reason', '')} |"
        )

    return "\n".join(lines) + "\n"


def cmd_parse_metrics(args: argparse.Namespace) -> int:
    text = Path(args.file).read_text(encoding="utf-8") if args.file != "-" else sys.stdin.read()
    metrics = parse_metric_lines(text)
    if args.metric:
        metrics = [metric for metric in metrics if metric.name == args.metric]
    print(json.dumps([metric.as_dict() for metric in metrics], indent=2, sort_keys=True))
    return 0 if metrics else 1


def cmd_validate(args: argparse.Namespace) -> int:
    events, errors = _load_jsonl(Path(args.file))
    errors.extend(validate_events(events))
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"OK: {len(events)} events")
    return 0


def cmd_decide(args: argparse.Namespace) -> int:
    decision = decide(
        direction=args.direction,
        candidate=args.candidate,
        best=args.best,
        min_effect_size_pct=args.min_effect_size_pct,
        noise_floor_pct=args.noise_floor_pct,
        tests_passed=not args.tests_failed,
        noisy=args.noisy,
    )
    print(json.dumps(decision.as_dict(), indent=2, sort_keys=True))
    return 0 if decision.action in ("baseline", "keep") else 1


def cmd_dashboard(args: argparse.Namespace) -> int:
    events = load_valid_events(Path(args.file))
    markdown = render_dashboard(events)
    if args.output:
        Path(args.output).write_text(markdown, encoding="utf-8")
    else:
        print(markdown, end="")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subcommands = parser.add_subparsers(dest="command", required=True)

    parse_metrics = subcommands.add_parser("parse-metrics", help="parse METRIC lines from a file or stdin")
    parse_metrics.add_argument("file")
    parse_metrics.add_argument("--metric")
    parse_metrics.set_defaults(func=cmd_parse_metrics)

    validate = subcommands.add_parser("validate", help="validate autoresearch.jsonl")
    validate.add_argument("file")
    validate.set_defaults(func=cmd_validate)

    decide_parser = subcommands.add_parser("decide", help="decide baseline/keep/discard/stop for a candidate metric")
    decide_parser.add_argument("--direction", choices=("lower", "higher"), required=True)
    decide_parser.add_argument("--candidate", type=float, required=True)
    decide_parser.add_argument("--best", type=float)
    decide_parser.add_argument("--min-effect-size-pct", type=float, default=3.0)
    decide_parser.add_argument("--noise-floor-pct", type=float, default=0.0)
    decide_parser.add_argument("--tests-failed", action="store_true")
    decide_parser.add_argument("--noisy", action="store_true")
    decide_parser.set_defaults(func=cmd_decide)

    dashboard = subcommands.add_parser("dashboard", help="render a markdown dashboard from autoresearch.jsonl")
    dashboard.add_argument("file")
    dashboard.add_argument("--output")
    dashboard.set_defaults(func=cmd_dashboard)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return int(args.func(args))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
