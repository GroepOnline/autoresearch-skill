#!/usr/bin/env python3
"""Deterministic helpers for autoresearch JSONL, metrics, decisions, and dashboards."""

from __future__ import annotations

import argparse
import itertools
import json
import math
import re
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable, Literal, Mapping, Sequence

Direction = Literal["lower", "higher"]
Action = Literal["baseline", "keep", "discard", "stop"]
Outcome = Literal[
    "conclusive",
    "threshold_only",
    "baseline",
    "noisy",
    "insufficient_samples",
    "not_significant",
    "below_threshold",
    "guardrail_failed",
    "simplification",
    "invalid",
    "stopped",
]

POLICY_VERSION = 3
_EXACT_PERMUTATION_LIMIT = 20_000
_MONTE_CARLO_PERMUTATIONS = 10_000

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
class SampleStats:
    """Distribution summary used by the statistical decision model."""

    count: int
    median: float
    mean: float
    stdev: float
    cv_pct: float
    minimum: float
    maximum: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "count": self.count,
            "median": self.median,
            "mean": self.mean,
            "stdev": self.stdev,
            "cv_pct": self.cv_pct if math.isfinite(self.cv_pct) else None,
            "min": self.minimum,
            "max": self.maximum,
        }


@dataclass(frozen=True)
class Significance:
    """Result of the permutation test on the primary metric difference."""

    method: str
    p_value: float
    alpha: float
    significant: bool

    def as_dict(self) -> dict[str, Any]:
        return {
            "method": self.method,
            "p_value": self.p_value,
            "alpha": self.alpha,
            "significant": self.significant,
        }


@dataclass(frozen=True)
class GuardrailResult:
    """Outcome of one secondary metric that must not regress unreasonably."""

    name: str
    direction: Direction
    passed: bool
    observed_pct: float | None
    tolerance_pct: float

    def as_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "direction": self.direction,
            "passed": self.passed,
            "observed_pct": self.observed_pct,
            "tolerance_pct": self.tolerance_pct,
        }


@dataclass(frozen=True)
class StopCondition:
    stopped: bool
    reason: str | None = None


@dataclass(frozen=True)
class DecisionPolicy:
    """Versioned knobs of the sample-aware decision model (v3)."""

    min_effect_size_pct: float = 3.0
    noise_floor_pct: float = 0.0
    alpha: float = 0.05
    min_samples: int = 3
    require_significance: bool = True
    policy_version: int = POLICY_VERSION

    def as_dict(self) -> dict[str, Any]:
        return {
            "policy_version": self.policy_version,
            "min_effect_size_pct": self.min_effect_size_pct,
            "noise_floor_pct": self.noise_floor_pct,
            "alpha": self.alpha,
            "min_samples": self.min_samples,
            "require_significance": self.require_significance,
        }


@dataclass(frozen=True)
class Decision:
    action: Action
    reason: str
    improvement_pct: float | None = None
    policy_version: int = POLICY_VERSION
    outcome: Outcome = "conclusive"
    evidence: dict[str, Any] | None = None
    guardrails: tuple[GuardrailResult, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "action": self.action,
            "reason": self.reason,
            "policy_version": self.policy_version,
            "outcome": self.outcome,
        }
        if self.improvement_pct is not None:
            data["improvement_pct"] = self.improvement_pct
        if self.evidence is not None:
            data["evidence"] = self.evidence
        if self.guardrails:
            data["guardrails"] = [guardrail.as_dict() for guardrail in self.guardrails]
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
    guardrails: Sequence[Mapping[str, Any]] = (),
) -> Decision:
    """Return a bounded keep/discard/stop decision for a single value pair.

    This is the threshold-only compatibility path. When repeated samples are
    available, prefer :func:`decide_with_samples`, which adds a permutation
    significance test, a noise gate, and stop-policy integration. Guardrails
    are honored here as well — a scalar keep may not violate a supplied
    secondary metric.
    """
    if direction not in ("lower", "higher"):
        raise ValueError("direction must be 'lower' or 'higher'")
    if not 0 <= min_effect_size_pct <= 100:
        raise ValueError("min_effect_size_pct must be in [0, 100]")
    if not 0 <= noise_floor_pct <= 100:
        raise ValueError("noise_floor_pct must be in [0, 100]")
    if not math.isfinite(candidate):
        return Decision("discard", "candidate metric is not finite", outcome="invalid")
    if not tests_passed:
        return Decision("discard", "correctness checks failed", outcome="invalid")
    if noisy:
        return Decision("stop", "benchmark noise exceeds configured floor", outcome="noisy")
    guardrail_results, guardrail_failures = _evaluate_guardrails(guardrails)
    if guardrail_failures:
        return Decision(
            "discard",
            "guardrail regression: " + "; ".join(guardrail_failures),
            outcome="guardrail_failed",
            guardrails=tuple(guardrail_results),
        )
    if best is None:
        return Decision("baseline", "first valid measurement becomes baseline", 0.0, outcome="baseline")
    if not math.isfinite(best):
        raise ValueError("best must be finite when provided")

    threshold = max(min_effect_size_pct, noise_floor_pct)
    if best == 0:
        improved = candidate < best if direction == "lower" else candidate > best
        return Decision(
            "keep" if improved else "discard",
            "zero best value requires strict absolute improvement",
            None,
            outcome="conclusive" if improved else "below_threshold",
            guardrails=tuple(guardrail_results),
        )

    improvement = ((best - candidate) / abs(best) * 100.0) if direction == "lower" else ((candidate - best) / abs(best) * 100.0)
    if improvement >= threshold:
        return Decision(
            "keep",
            f"improved {improvement:.2f}% over current best (threshold {threshold:.2f}%)",
            improvement,
            outcome="conclusive",
            guardrails=tuple(guardrail_results),
        )
    return Decision(
        "discard",
        f"improvement {improvement:.2f}% is below threshold {threshold:.2f}% or worse than best",
        improvement,
        outcome="below_threshold",
        guardrails=tuple(guardrail_results),
    )


def compute_stats(values: Iterable[float]) -> SampleStats:
    """Compute the median-based distribution summary used for decisions."""
    samples = [float(value) for value in values]
    if not samples:
        raise ValueError("compute_stats requires at least one sample")
    if any(not math.isfinite(value) for value in samples):
        raise ValueError("compute_stats requires finite samples")

    count = len(samples)
    mean = float(statistics.fmean(samples))
    stdev = float(statistics.stdev(samples)) if count >= 2 else 0.0
    # A zero mean with nonzero spread is the noisiest case, not a clean one:
    # report an unbounded CV so the noise gate can never pass it.
    if count >= 2:
        if mean != 0:
            cv_pct = stdev / abs(mean) * 100.0
        elif stdev > 0:
            cv_pct = math.inf
        else:
            cv_pct = 0.0
    else:
        cv_pct = 0.0
    return SampleStats(
        count=count,
        median=float(statistics.median(samples)),
        mean=mean,
        stdev=stdev,
        cv_pct=cv_pct,
        minimum=min(samples),
        maximum=max(samples),
    )


def _oriented_mean_diff(candidate: Sequence[float], best: Sequence[float], direction: Direction) -> float:
    """Positive values mean the candidate is better than the best.

    The permutation statistic uses the mean difference, not the median: with
    repeated (constant) samples the median difference is insensitive to any
    minority of relabelings, so a clear improvement scored p=0.5. The mean
    retains group separation under every relabeling; medians still drive the
    reported effect size.
    """
    diff = float(statistics.fmean(candidate)) - float(statistics.fmean(best))
    return diff if direction == "higher" else -diff


def _fnv1a32(data: bytes) -> int:
    """FNV-1a 32-bit hash — identical to the TypeScript hashString over ASCII."""
    value = 2166136261
    for byte in data:
        value ^= byte
        value = (value * 16777619) & 0xFFFFFFFF
    return value


def _mulberry32(seed: int) -> Callable[[], float]:
    """mulberry32 PRNG — bit-identical to the TypeScript implementation."""
    state = seed & 0xFFFFFFFF

    def rand() -> float:
        nonlocal state
        state = (state + 0x6D2B79F5) & 0xFFFFFFFF
        t = state
        t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & 0xFFFFFFFF)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return rand


def _shuffle(values: list[float], rand: Callable[[], float]) -> None:
    """Fisher-Yates shuffle matching the TypeScript draw order exactly."""
    for index in range(len(values) - 1, 0, -1):
        swap = int(rand() * (index + 1))
        values[index], values[swap] = values[swap], values[index]


def permutation_test_mean(
    candidate: Sequence[float],
    best: Sequence[float],
    *,
    direction: Direction,
    alpha: float = 0.05,
    exact_limit: int = _EXACT_PERMUTATION_LIMIT,
    monte_carlo_permutations: int = _MONTE_CARLO_PERMUTATIONS,
) -> Significance:
    """One-sided permutation test for a positive shift in location.

    The pooled samples are randomly relabeled; the p-value is the fraction of
    relabelings whose oriented mean difference is at least the observed one.
    The mean statistic (unlike the median) retains separation under constant
    groups. Exact enumeration is used while the number of relabelings stays
    small, with a deterministic Monte Carlo fallback that shares the
    TypeScript implementation's FNV-1a/mulberry32 random stream.
    """
    candidate_samples = [float(value) for value in candidate]
    best_samples = [float(value) for value in best]
    if not candidate_samples or not best_samples:
        raise ValueError("permutation test requires samples on both sides")
    if any(not math.isfinite(value) for value in candidate_samples + best_samples):
        raise ValueError("permutation test requires finite samples")
    if direction not in ("lower", "higher"):
        raise ValueError("direction must be 'lower' or 'higher'")

    pooled = candidate_samples + best_samples
    candidate_count = len(candidate_samples)
    total_count = len(pooled)
    observed = _oriented_mean_diff(candidate_samples, best_samples, direction)

    combinations = math.comb(total_count, candidate_count)
    if combinations <= exact_limit:
        at_least = 0
        total = 0
        for indices in itertools.combinations(range(total_count), candidate_count):
            selected = set(indices)
            group = [pooled[index] for index in indices]
            complement = [pooled[index] for index in range(total_count) if index not in selected]
            if _oriented_mean_diff(group, complement, direction) >= observed:
                at_least += 1
            total += 1
        p_value = at_least / total
        method = f"exact_permutation_mean({candidate_count}v{len(best_samples)}, n={total})"
    else:
        # Same fingerprint string the TypeScript side feeds its FNV-1a hash —
        # both streams then draw the identical shuffle sequence.
        fingerprint = (
            f"{direction}|{','.join(f'{value:.12f}' for value in candidate_samples)}"
            f"|{','.join(f'{value:.12f}' for value in best_samples)}"
        ).encode("utf-8")
        rand = _mulberry32(_fnv1a32(fingerprint))
        at_least = 0
        for _ in range(monte_carlo_permutations):
            shuffled = pooled.copy()
            _shuffle(shuffled, rand)
            if _oriented_mean_diff(shuffled[:candidate_count], shuffled[candidate_count:], direction) >= observed:
                at_least += 1
        p_value = (at_least + 1) / (monte_carlo_permutations + 1)
        method = f"monte_carlo_permutation_mean({candidate_count}v{len(best_samples)}, n={monte_carlo_permutations})"

    return Significance(method=method, p_value=p_value, alpha=alpha, significant=p_value < alpha)


# Kept as an alias: the statistic is now the oriented mean difference.
permutation_test_median = permutation_test_mean


def evaluate_stop_policy(
    *,
    consecutive_discards: int = 0,
    runs_since_improvement: int = 0,
    max_consecutive_discards: int = 5,
    max_runs_without_improvement: int = 10,
    remaining_runs: float | None = None,
    remaining_minutes: float | None = None,
) -> StopCondition:
    """Decide whether the loop budget or exploration signals require a stop."""
    if remaining_runs is not None and remaining_runs <= 0:
        return StopCondition(True, "run budget exhausted")
    if remaining_minutes is not None and remaining_minutes <= 0:
        return StopCondition(True, "time budget exhausted")
    if max_consecutive_discards > 0 and consecutive_discards >= max_consecutive_discards:
        return StopCondition(True, f"{consecutive_discards} consecutive discards (limit {max_consecutive_discards})")
    if max_runs_without_improvement > 0 and runs_since_improvement >= max_runs_without_improvement:
        return StopCondition(
            True,
            f"plateau — {runs_since_improvement} runs without improvement (limit {max_runs_without_improvement})",
        )
    return StopCondition(False)


def history_from_events(events: Iterable[Mapping[str, Any]]) -> dict[str, int]:
    """Derive consecutive-discard and plateau counters from JSONL decisions."""
    decisions = [event for event in events if event.get("type") == "decision"]

    consecutive_discards = 0
    for decision in reversed(decisions):
        if decision.get("action") == "discard":
            consecutive_discards += 1
        else:
            break

    runs_since_improvement = 0
    for decision in reversed(decisions):
        action = decision.get("action")
        if action in ("keep", "baseline"):
            break
        if action == "discard":
            runs_since_improvement += 1

    return {
        "consecutive_discards": consecutive_discards,
        "runs_since_improvement": runs_since_improvement,
        "decision_count": len(decisions),
    }


def _evaluate_guardrails(guardrails: Sequence[Mapping[str, Any]]) -> tuple[list[GuardrailResult], list[str]]:
    results: list[GuardrailResult] = []
    failures: list[str] = []
    for raw in guardrails:
        name = str(raw.get("name", "guardrail"))
        guardrail_direction = raw.get("direction", "lower")
        try:
            tolerance = float(raw.get("tolerance_pct", 2.0))
        except (TypeError, ValueError):
            tolerance = 2.0
        candidate_value = raw.get("candidate")
        best_value = raw.get("best")

        if guardrail_direction not in ("lower", "higher") or not _is_number(candidate_value) or not _is_number(best_value):
            results.append(GuardrailResult(name, "lower", False, None, tolerance))
            failures.append(f"{name}: invalid guardrail input")
            continue

        candidate_number = float(candidate_value)
        best_number = float(best_value)
        if best_number == 0:
            worse = candidate_number > 0 if guardrail_direction == "lower" else candidate_number < 0
            observed = float("inf") if worse else 0.0
        elif guardrail_direction == "lower":
            observed = (candidate_number - best_number) / abs(best_number) * 100.0
        else:
            observed = (best_number - candidate_number) / abs(best_number) * 100.0

        passed = observed <= tolerance
        finite_observed = observed if math.isfinite(observed) else None
        results.append(GuardrailResult(name, guardrail_direction, passed, finite_observed, tolerance))
        if not passed:
            rendered = "inf" if finite_observed is None else f"{observed:.2f}%"
            failures.append(f"{name} regressed {rendered} (tolerance {tolerance:.2f}%)")
    return results, failures


def _relative_improvement(*, direction: Direction, candidate_median: float, best_median: float) -> float | None:
    if best_median == 0:
        return None
    if direction == "lower":
        return (best_median - candidate_median) / abs(best_median) * 100.0
    return (candidate_median - best_median) / abs(best_median) * 100.0


def _assert_policy_bounds(
    direction: Direction,
    alpha: float,
    min_samples: int,
    min_effect_size_pct: float,
    noise_floor_pct: float,
) -> None:
    if direction not in ("lower", "higher"):
        raise ValueError("direction must be 'lower' or 'higher'")
    if not 0 < alpha <= 1:
        raise ValueError("alpha must be in (0, 1]")
    if min_samples < 2:
        raise ValueError("min_samples must be at least 2")
    if not 0 <= min_effect_size_pct <= 100:
        raise ValueError("min_effect_size_pct must be in [0, 100]")
    if not 0 <= noise_floor_pct <= 100:
        raise ValueError("noise_floor_pct must be in [0, 100]")


def _reject_invalid_measurement(candidate_samples: Sequence[float], tests_passed: bool) -> Decision | None:
    if not candidate_samples:
        return Decision("discard", "candidate has no samples", outcome="invalid")
    if any(not math.isfinite(value) for value in candidate_samples):
        return Decision("discard", "candidate samples contain non-finite values", outcome="invalid")
    if not tests_passed:
        return Decision("discard", "correctness checks failed", outcome="invalid")
    return None


def _reject_non_finite_best(best_samples: Sequence[float]) -> Decision | None:
    if any(not math.isfinite(value) for value in best_samples):
        return Decision("discard", "best samples contain non-finite values", outcome="invalid")
    return None


def _stop_from_history(history: Mapping[str, Any] | None) -> Decision | None:
    if not history:
        return None
    stop = evaluate_stop_policy(
        consecutive_discards=int(history.get("consecutive_discards", 0) or 0),
        runs_since_improvement=int(history.get("runs_since_improvement", 0) or 0),
        max_consecutive_discards=(
            int(history["max_consecutive_discards"]) if history.get("max_consecutive_discards") is not None else 5
        ),
        max_runs_without_improvement=(
            int(history["max_runs_without_improvement"])
            if history.get("max_runs_without_improvement") is not None
            else 10
        ),
        remaining_runs=history.get("remaining_runs"),
        remaining_minutes=history.get("remaining_minutes"),
    )
    if not stop.stopped:
        return None
    return Decision("stop", stop.reason or "stop policy triggered", outcome="stopped")


def _candidate_measurement_gate(
    candidate_stats: SampleStats,
    has_best: bool,
    noise_floor_pct: float,
    min_samples: int,
) -> Decision | None:
    """Candidate-only gates: noise, sample sufficiency, and baseline detection.

    A first measurement becomes the comparison point for every later run — it
    must survive the same noise and sample gates as any candidate before it may
    be persisted as best.
    """
    if noise_floor_pct > 0 and candidate_stats.cv_pct > noise_floor_pct:
        return Decision(
            "stop",
            f"benchmark noise exceeds floor — candidate CV {candidate_stats.cv_pct:.2f}% (floor {noise_floor_pct:.2f}%)",
            outcome="noisy",
            evidence={"candidate": candidate_stats.as_dict()},
        )
    if candidate_stats.count < min_samples:
        return Decision(
            "discard",
            f"insufficient samples — candidate n={candidate_stats.count} (minimum {min_samples})",
            outcome="insufficient_samples",
            evidence={"candidate": candidate_stats.as_dict()},
        )
    if not has_best:
        return Decision(
            "baseline",
            "first valid measurement becomes baseline",
            0.0,
            outcome="baseline",
            evidence={"candidate": candidate_stats.as_dict()},
        )
    return None


def _pair_measurement_gate(
    candidate_stats: SampleStats,
    best_stats: SampleStats,
    noise_floor_pct: float,
    min_samples: int,
    evidence: dict[str, Any],
) -> Decision | None:
    """Gates that need both sides: noise floor on either side, then sufficiency."""
    if noise_floor_pct > 0 and (candidate_stats.cv_pct > noise_floor_pct or best_stats.cv_pct > noise_floor_pct):
        return Decision(
            "stop",
            (
                f"benchmark noise exceeds floor — candidate CV {candidate_stats.cv_pct:.2f}% / "
                f"best CV {best_stats.cv_pct:.2f}% (floor {noise_floor_pct:.2f}%)"
            ),
            outcome="noisy",
            evidence=evidence,
        )
    if candidate_stats.count < min_samples or best_stats.count < min_samples:
        return Decision(
            "discard",
            (
                f"insufficient samples — candidate n={candidate_stats.count}, best n={best_stats.count} "
                f"(minimum {min_samples} per side)"
            ),
            outcome="insufficient_samples",
            evidence=evidence,
        )
    return None


def _guardrail_rejection(
    guardrails: Sequence[Mapping[str, Any]],
    evidence: dict[str, Any],
) -> Decision | None:
    """Attach guardrail evidence, then reject the candidate on any regression."""
    guardrail_results, guardrail_failures = _evaluate_guardrails(guardrails)
    if guardrail_results:
        evidence["guardrails"] = [guardrail.as_dict() for guardrail in guardrail_results]
    if guardrail_failures:
        return Decision(
            "discard",
            "guardrail regression: " + "; ".join(guardrail_failures),
            outcome="guardrail_failed",
            evidence=evidence,
            guardrails=tuple(guardrail_results),
        )
    return None


def _simplification_decision(
    *,
    direction: Direction,
    candidate_samples: Sequence[float],
    best_samples: Sequence[float],
    alpha: float,
    significance: Significance,
    improvement: float | None,
    simplification: Mapping[str, Any] | None,
    evidence: dict[str, Any],
) -> Decision | None:
    """Keep a statistically tied simplification, never a significantly worse one."""
    tied = (
        not significance.significant
        and simplification is not None
        and simplification.get("removes_complexity") is True
        and simplification.get("behavior_unchanged") is True
    )
    if not tied:
        return None

    worse = permutation_test_median(
        candidate_samples,
        best_samples,
        direction="higher" if direction == "lower" else "lower",
        alpha=alpha,
    ).significant
    if worse:
        return Decision(
            "discard",
            f"simplification candidate is significantly worse (reverse p < {alpha})",
            improvement,
            outcome="below_threshold",
            evidence=evidence,
        )
    return Decision(
        "keep",
        "statistically tied result kept for simplification (complexity removed, behavior unchanged)",
        improvement,
        outcome="simplification",
        evidence=evidence,
    )


def _zero_median_decision(
    *,
    direction: Direction,
    candidate_stats: SampleStats,
    best_stats: SampleStats,
    significance: Significance,
    evidence: dict[str, Any],
) -> Decision | None:
    """A zero best median leaves no relative improvement metric: require an absolute win."""
    if best_stats.median != 0:
        return None
    improved = candidate_stats.median < 0 if direction == "lower" else candidate_stats.median > 0
    if improved and significance.significant:
        return Decision(
            "keep",
            "strict absolute improvement over a zero best value",
            None,
            outcome="conclusive",
            evidence=evidence,
        )
    return Decision(
        "discard",
        "zero best value requires strict absolute improvement",
        None,
        outcome="below_threshold",
        evidence=evidence,
    )


def _threshold_decision(
    *,
    require_significance: bool,
    alpha: float,
    improvement: float,
    threshold: float,
    significance: Significance,
    evidence: dict[str, Any],
) -> Decision:
    """Significance gate first, then the minimum effect size. Always decides."""
    if require_significance and not significance.significant:
        return Decision(
            "discard",
            (
                f"improvement {improvement:.2f}% is not statistically significant "
                f"(p={significance.p_value:.4f} >= alpha={alpha})"
            ),
            improvement,
            outcome="not_significant",
            evidence=evidence,
        )
    if improvement >= threshold:
        return Decision(
            "keep",
            (
                f"improved {improvement:.2f}% over current best (threshold {threshold:.2f}%, "
                f"p={significance.p_value:.4f})"
            ),
            improvement,
            outcome="conclusive",
            evidence=evidence,
        )
    return Decision(
        "discard",
        f"improvement {improvement:.2f}% is below threshold {threshold:.2f}%",
        improvement,
        outcome="below_threshold",
        evidence=evidence,
    )


def decide_with_samples(
    *,
    candidate: Sequence[float],
    best: Sequence[float] | None,
    direction: Direction,
    policy: DecisionPolicy | None = None,
    min_effect_size_pct: float = 3.0,
    noise_floor_pct: float = 0.0,
    alpha: float = 0.05,
    min_samples: int = 3,
    require_significance: bool = True,
    tests_passed: bool = True,
    guardrails: Sequence[Mapping[str, Any]] = (),
    history: Mapping[str, Any] | None = None,
    simplification: Mapping[str, Any] | None = None,
) -> Decision:
    """Sample-aware keep/discard/stop decision with a full audit trail.

    Order of evaluation: input validity, correctness checks, stop policy,
    baseline detection, noise gate, sample sufficiency, guardrails, then the
    permutation significance test and the minimum effect size.
    """
    if policy is not None:
        min_effect_size_pct = policy.min_effect_size_pct
        noise_floor_pct = policy.noise_floor_pct
        alpha = policy.alpha
        min_samples = policy.min_samples
        require_significance = policy.require_significance

    _assert_policy_bounds(direction, alpha, min_samples, min_effect_size_pct, noise_floor_pct)

    candidate_samples = [float(value) for value in candidate]

    rejection = _reject_invalid_measurement(candidate_samples, tests_passed)
    if rejection is not None:
        return rejection

    rejection = _stop_from_history(history)
    if rejection is not None:
        return rejection

    candidate_stats = compute_stats(candidate_samples)
    best_samples = [float(value) for value in best] if best is not None else []

    rejection = _reject_non_finite_best(best_samples)
    if rejection is not None:
        return rejection

    rejection = _candidate_measurement_gate(candidate_stats, bool(best_samples), noise_floor_pct, min_samples)
    if rejection is not None:
        return rejection

    best_stats = compute_stats(best_samples)
    threshold = max(min_effect_size_pct, noise_floor_pct)
    evidence: dict[str, Any] = {
        "candidate": candidate_stats.as_dict(),
        "best": best_stats.as_dict(),
        "threshold_pct": threshold,
        "policy": DecisionPolicy(
            min_effect_size_pct=min_effect_size_pct,
            noise_floor_pct=noise_floor_pct,
            alpha=alpha,
            min_samples=min_samples,
            require_significance=require_significance,
        ).as_dict(),
    }

    rejection = _pair_measurement_gate(candidate_stats, best_stats, noise_floor_pct, min_samples, evidence)
    if rejection is not None:
        return rejection

    rejection = _guardrail_rejection(guardrails, evidence)
    if rejection is not None:
        return rejection

    significance = permutation_test_median(candidate_samples, best_samples, direction=direction, alpha=alpha)
    evidence["significance"] = significance.as_dict()

    improvement = _relative_improvement(
        direction=direction,
        candidate_median=candidate_stats.median,
        best_median=best_stats.median,
    )
    if improvement is not None:
        evidence["effect_size_pct"] = improvement

    if simplification is not None:
        evidence["simplification"] = {
            "removes_complexity": simplification.get("removes_complexity") is True,
            "behavior_unchanged": simplification.get("behavior_unchanged") is True,
        }

    decision = _simplification_decision(
        direction=direction,
        candidate_samples=candidate_samples,
        best_samples=best_samples,
        alpha=alpha,
        significance=significance,
        improvement=improvement,
        simplification=simplification,
        evidence=evidence,
    )
    if decision is not None:
        return decision

    decision = _zero_median_decision(
        direction=direction,
        candidate_stats=candidate_stats,
        best_stats=best_stats,
        significance=significance,
        evidence=evidence,
    )
    if decision is not None:
        return decision

    return _threshold_decision(
        require_significance=require_significance,
        alpha=alpha,
        improvement=improvement,
        threshold=threshold,
        significance=significance,
        evidence=evidence,
    )


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
    if args.samples:
        guardrails = json.loads(args.guardrails_json) if args.guardrails_json else []
        history = json.loads(args.history_json) if args.history_json else None
        if not isinstance(guardrails, list):
            raise ValueError("guardrails-json must be a JSON array")
        if history is not None and not isinstance(history, dict):
            raise ValueError("history-json must be a JSON object")
        best = args.best_samples if args.best_samples else ([args.best] if args.best is not None else None)
        decision = decide_with_samples(
            candidate=args.samples,
            best=best,
            direction=args.direction,
            min_effect_size_pct=args.min_effect_size_pct,
            noise_floor_pct=args.noise_floor_pct,
            alpha=args.alpha,
            min_samples=args.min_samples,
            tests_passed=not args.tests_failed,
            require_significance=args.require_significance,
            guardrails=guardrails,
            history=history,
        )
    else:
        if args.candidate is None:
            raise ValueError("--candidate is required when --samples is not provided")
        scalar_guardrails = json.loads(args.guardrails_json) if args.guardrails_json else []
        if not isinstance(scalar_guardrails, list):
            raise ValueError("guardrails-json must be a JSON array")
        decision = decide(
            direction=args.direction,
            candidate=args.candidate,
            best=args.best,
            min_effect_size_pct=args.min_effect_size_pct,
            noise_floor_pct=args.noise_floor_pct,
            tests_passed=not args.tests_failed,
            noisy=args.noisy,
            guardrails=scalar_guardrails,
        )
    print(json.dumps(decision.as_dict(), indent=2, sort_keys=True))
    return 0 if decision.action in ("baseline", "keep") else 1


def cmd_stop_check(args: argparse.Namespace) -> int:
    events = load_valid_events(Path(args.file))
    history = history_from_events(events)
    stop = evaluate_stop_policy(
        consecutive_discards=history["consecutive_discards"],
        runs_since_improvement=history["runs_since_improvement"],
        max_consecutive_discards=args.max_consecutive_discards,
        max_runs_without_improvement=args.max_runs_without_improvement,
        remaining_runs=args.remaining_runs,
        remaining_minutes=args.remaining_minutes,
    )
    payload = {"stopped": stop.stopped, "reason": stop.reason}
    payload.update(history)
    print(json.dumps(payload, indent=2, sort_keys=True))
    return 0 if stop.stopped else 1


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
    decide_parser.add_argument("--candidate", type=float, help="single candidate value (legacy threshold-only path)")
    decide_parser.add_argument("--best", type=float)
    decide_parser.add_argument("--samples", type=float, nargs="*", help="repeated candidate samples for a significance test")
    decide_parser.add_argument("--best-samples", type=float, nargs="*", help="repeated best samples for a significance test")
    decide_parser.add_argument("--alpha", type=float, default=0.05, help="significance level for the permutation test")
    decide_parser.add_argument("--min-samples", type=int, default=3, help="minimum samples per side to score")
    decide_parser.add_argument("--no-significance", dest="require_significance", action="store_false",
                               help="skip the significance requirement (threshold-only keep)")
    decide_parser.add_argument("--guardrails-json", help="JSON array of guardrail objects (name, direction, tolerance_pct, candidate, best)")
    decide_parser.add_argument("--history-json", help="JSON object with consecutive_discards / runs_since_improvement / remaining budgets")
    decide_parser.add_argument("--min-effect-size-pct", type=float, default=3.0)
    decide_parser.add_argument("--noise-floor-pct", type=float, default=0.0)
    decide_parser.add_argument("--tests-failed", action="store_true")
    decide_parser.add_argument("--noisy", action="store_true")
    decide_parser.set_defaults(func=cmd_decide)

    stop_check = subcommands.add_parser("stop-check", help="derive the stop-policy state from autoresearch.jsonl (exit 0 = stop)")
    stop_check.add_argument("file")
    stop_check.add_argument("--max-consecutive-discards", type=int, default=5)
    stop_check.add_argument("--max-runs-without-improvement", type=int, default=10)
    stop_check.add_argument("--remaining-runs", type=int)
    stop_check.add_argument("--remaining-minutes", type=float)
    stop_check.set_defaults(func=cmd_stop_check)

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
