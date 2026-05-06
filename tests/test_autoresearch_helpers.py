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


if __name__ == "__main__":
    unittest.main()
