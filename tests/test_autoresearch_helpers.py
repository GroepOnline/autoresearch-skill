import json
import tempfile
import unittest
from pathlib import Path

import scripts.autoresearch as ar


class MetricParsingTests(unittest.TestCase):
    def test_parses_metric_lines_with_attrs_and_scientific_notation(self):
        metrics = ar.parse_metric_lines(
            "noise\nMETRIC latency_ms=12.4 direction=lower samples=7\nMETRIC score=1.2e3 direction=higher\n"
        )

        self.assertEqual([metric.name for metric in metrics], ["latency_ms", "score"])
        self.assertEqual(metrics[0].value, 12.4)
        self.assertEqual(metrics[0].attrs["direction"], "lower")
        self.assertEqual(metrics[1].value, 1200.0)

    def test_ignores_fake_placeholder_metric(self):
        metrics = ar.parse_metric_lines("METRIC <name>=<value>\n")
        self.assertEqual(metrics, [])


class DecisionTests(unittest.TestCase):
    def test_first_valid_measurement_becomes_baseline(self):
        decision = ar.decide(direction="lower", candidate=100.0, best=None)
        self.assertEqual(decision.action, "baseline")

    def test_compares_against_current_best_not_original_baseline(self):
        # A candidate that beats a hypothetical baseline of 100 but not current best 80 is discarded.
        decision = ar.decide(direction="lower", candidate=90.0, best=80.0, min_effect_size_pct=3.0)
        self.assertEqual(decision.action, "discard")
        self.assertLess(decision.improvement_pct, 0)

    def test_keeps_only_meaningful_improvement(self):
        decision = ar.decide(direction="higher", candidate=106.0, best=100.0, min_effect_size_pct=3.0)
        self.assertEqual(decision.action, "keep")

    def test_stops_on_noisy_benchmark(self):
        decision = ar.decide(direction="lower", candidate=70.0, best=100.0, noisy=True)
        self.assertEqual(decision.action, "stop")

    def test_discards_when_tests_fail_even_if_metric_improves(self):
        decision = ar.decide(direction="lower", candidate=50.0, best=100.0, tests_passed=False)
        self.assertEqual(decision.action, "discard")


class JsonlValidationTests(unittest.TestCase):
    def test_validates_and_summarizes_protocol_events(self):
        events = [
            {
                "type": "config",
                "schema_version": 1,
                "name": "optimize-parser",
                "metric": "latency_ms",
                "direction": "lower",
                "created_at": "2026-05-06T12:00:00Z",
            },
            {
                "type": "result",
                "run": 1,
                "metric": "latency_ms",
                "median": 100.0,
                "samples": [101, 100, 99],
                "timestamp": "2026-05-06T12:01:00Z",
            },
            {
                "type": "decision",
                "run": 1,
                "action": "baseline",
                "reason": "baseline measurement",
                "timestamp": "2026-05-06T12:02:00Z",
            },
            {
                "type": "result",
                "run": 2,
                "metric": "latency_ms",
                "median": 92.0,
                "timestamp": "2026-05-06T12:03:00Z",
            },
            {
                "type": "decision",
                "run": 2,
                "action": "keep",
                "reason": "improved over best",
                "timestamp": "2026-05-06T12:04:00Z",
            },
        ]

        self.assertEqual(ar.validate_events(events), [])
        summary = ar.summarize(events)
        self.assertEqual(summary["baseline_value"], 100.0)
        self.assertEqual(summary["best_run"], 2)
        self.assertEqual(summary["best_value"], 92.0)

    def test_rejects_malformed_jsonl_and_decision_without_result(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "autoresearch.jsonl"
            path.write_text(
                "{bad json}\n"
                + json.dumps(
                    {
                        "type": "config",
                        "schema_version": 1,
                        "name": "x",
                        "metric": "score",
                        "direction": "higher",
                        "created_at": "2026-05-06T12:00:00Z",
                    }
                )
                + "\n"
                + json.dumps(
                    {
                        "type": "decision",
                        "run": 99,
                        "action": "keep",
                        "reason": "no result",
                        "timestamp": "2026-05-06T12:01:00Z",
                    }
                )
                + "\n",
                encoding="utf-8",
            )

            events, errors = ar._load_jsonl(path)
            errors.extend(ar.validate_events(events))
            self.assertTrue(any("invalid JSON" in error for error in errors))
            self.assertTrue(any("no preceding result" in error for error in errors))

    def test_renders_dashboard(self):
        events = [
            {
                "type": "config",
                "schema_version": 1,
                "name": "karpathy-style-tight-loop",
                "metric": "tok_per_s",
                "direction": "higher",
                "created_at": "2026-05-06T12:00:00Z",
            },
            {"type": "result", "run": 1, "metric": "tok_per_s", "value": 10.0, "timestamp": "t"},
            {"type": "decision", "run": 1, "action": "baseline", "reason": "baseline", "timestamp": "t"},
        ]

        dashboard = ar.render_dashboard(events)
        self.assertIn("# Autoresearch Dashboard", dashboard)
        self.assertIn("karpathy-style-tight-loop", dashboard)
        self.assertIn("| 1 | 10.0 | baseline | baseline |", dashboard)


class SampleStatsTests(unittest.TestCase):
    def test_compute_stats_summarizes_distribution(self):
        stats = ar.compute_stats([98, 99, 100, 100, 101, 101, 102])
        self.assertEqual(stats.count, 7)
        self.assertEqual(stats.median, 100.0)
        self.assertEqual(stats.minimum, 98.0)
        self.assertEqual(stats.maximum, 102.0)
        self.assertAlmostEqual(stats.mean, 100.142857, places=5)
        self.assertGreater(stats.cv_pct, 0.0)

    def test_compute_stats_rejects_empty_and_non_finite(self):
        with self.assertRaises(ValueError):
            ar.compute_stats([])
        with self.assertRaises(ValueError):
            ar.compute_stats([1.0, float("nan")])


class PermutationTests(unittest.TestCase):
    def test_separated_samples_are_significant(self):
        significance = ar.permutation_test_median(
            [100, 101, 99, 102, 98, 100, 101],
            [120, 121, 119, 122, 118, 120, 121],
            direction="lower",
            alpha=0.05,
        )
        self.assertTrue(significance.significant)
        self.assertLess(significance.p_value, 0.05)
        self.assertIn("exact_permutation_median", significance.method)

    def test_overlapping_samples_are_not_significant(self):
        significance = ar.permutation_test_median(
            [100, 102, 98, 101, 99, 100, 101],
            [100, 99, 101, 100, 102, 98, 100],
            direction="lower",
            alpha=0.05,
        )
        self.assertFalse(significance.significant)
        self.assertGreaterEqual(significance.p_value, 0.05)

    def test_permutation_test_is_deterministic(self):
        first = ar.permutation_test_median([1, 2, 3, 4], [5, 6, 7, 8], direction="lower")
        second = ar.permutation_test_median([1, 2, 3, 4], [5, 6, 7, 8], direction="lower")
        self.assertEqual(first.p_value, second.p_value)


class SampleAwareDecisionTests(unittest.TestCase):
    def test_full_evidence_is_attached_to_the_decision(self):
        decision = ar.decide_with_samples(
            candidate=[100, 101, 99, 102, 98, 100, 101],
            best=[120, 121, 119, 122, 118, 120, 121],
            direction="lower",
        )
        self.assertEqual(decision.action, "keep")
        self.assertEqual(decision.outcome, "conclusive")
        self.assertEqual(decision.policy_version, ar.POLICY_VERSION)
        self.assertEqual(decision.evidence["candidate"]["count"], 7)
        self.assertEqual(decision.evidence["best"]["median"], 120.0)
        self.assertTrue(decision.evidence["significance"]["significant"])
        self.assertAlmostEqual(decision.improvement_pct, 16.6667, places=3)

    def test_insufficient_samples_are_rejected(self):
        decision = ar.decide_with_samples(
            candidate=[100, 101],
            best=[120, 121, 119, 122],
            direction="lower",
            min_samples=3,
        )
        self.assertEqual(decision.action, "discard")
        self.assertEqual(decision.outcome, "insufficient_samples")

    def test_noise_gate_stops_instead_of_scoring(self):
        decision = ar.decide_with_samples(
            candidate=[10, 80, 30, 120, 5, 90],
            best=[50, 55, 45, 60, 52, 48],
            direction="lower",
            noise_floor_pct=10.0,
        )
        self.assertEqual(decision.action, "stop")
        self.assertEqual(decision.outcome, "noisy")

    def test_guardrail_regression_discards_primary_improvement(self):
        decision = ar.decide_with_samples(
            candidate=[100, 101, 99, 102, 98, 100, 101],
            best=[120, 121, 119, 122, 118, 120, 121],
            direction="lower",
            guardrails=[{"name": "memory_mb", "direction": "lower", "tolerance_pct": 2.0, "candidate": 110, "best": 100}],
        )
        self.assertEqual(decision.action, "discard")
        self.assertEqual(decision.outcome, "guardrail_failed")
        self.assertFalse(decision.guardrails[0].passed)

    def test_history_plateau_stops_before_scoring(self):
        decision = ar.decide_with_samples(
            candidate=[100, 101, 99, 102, 98, 100, 101],
            best=[120, 121, 119, 122, 118, 120, 121],
            direction="lower",
            history={"runs_since_improvement": 10, "max_runs_without_improvement": 10},
        )
        self.assertEqual(decision.action, "stop")
        self.assertEqual(decision.outcome, "stopped")


class StopPolicyTests(unittest.TestCase):
    def test_stop_policy_budgets_and_limits(self):
        self.assertTrue(ar.evaluate_stop_policy(remaining_runs=0).stopped)
        self.assertTrue(ar.evaluate_stop_policy(remaining_minutes=0).stopped)
        self.assertTrue(ar.evaluate_stop_policy(consecutive_discards=5).stopped)
        self.assertTrue(ar.evaluate_stop_policy(runs_since_improvement=10).stopped)
        self.assertFalse(ar.evaluate_stop_policy(consecutive_discards=4, runs_since_improvement=9).stopped)

    def test_history_from_events_counts_trailing_discards(self):
        events = [
            {"type": "config"},
            {"type": "decision", "action": "baseline"},
            {"type": "decision", "action": "keep"},
            {"type": "decision", "action": "discard"},
            {"type": "decision", "action": "discard"},
        ]
        history = ar.history_from_events(events)
        self.assertEqual(history["consecutive_discards"], 2)
        self.assertEqual(history["runs_since_improvement"], 2)
        self.assertEqual(history["decision_count"], 4)


class DecisionFixtureTests(unittest.TestCase):
    def test_golden_decision_cases_match_python_and_typescript(self):
        fixtures_path = Path(__file__).parent / "fixtures" / "decision-cases.json"
        cases = json.loads(fixtures_path.read_text(encoding="utf-8"))
        for case in cases:
            with self.subTest(case=case["name"]):
                decision = ar.decide_with_samples(
                    candidate=case["candidateSamples"],
                    best=case.get("bestSamples"),
                    direction=case["direction"],
                    policy=ar.DecisionPolicy(**case.get("policy", {})),
                    guardrails=case.get("guardrails", []),
                    history=case.get("history"),
                    simplification=case.get("simplification"),
                )
                self.assertEqual(decision.action, case["expectedAction"])
                self.assertEqual(decision.outcome, case["expectedOutcome"])


if __name__ == "__main__":
    unittest.main()
