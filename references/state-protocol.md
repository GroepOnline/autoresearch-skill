# State Protocol

`autoresearch.jsonl` is the append-only source of truth. Generated files such as `AUTORESEARCH_STATE.json` and `autoresearch-dashboard.md` must be rebuilt from JSONL and must not be treated as canonical.

## File rules

- First non-empty line must be a `config` event.
- Every line must be valid JSON.
- Do not silently ignore malformed lines. Report them and stop before continuing the loop.
- Append new events; do not rewrite history except for explicit repair after user review.
- Use a temp file next to the target file for atomic replacement when rebuilding snapshots.

## Event schema

### Config

```json
{"type":"config","schema_version":1,"name":"optimize-parser","metric":"latency_ms","direction":"lower","unit":"ms","min_effect_size_pct":3,"noise_floor_pct":2,"max_runs":30,"max_minutes":60,"created_at":"2026-05-06T12:00:00Z"}
```

Required fields:

- `type`: `config`
- `schema_version`: `1`
- `name`: experiment name
- `metric`: primary metric name
- `direction`: `lower` or `higher`
- `created_at`: ISO-8601 timestamp

Recommended fields:

- `unit`
- `min_effect_size_pct`
- `noise_floor_pct`
- `max_runs`
- `max_minutes`
- `files_in_scope`
- `off_limits`

### Result

```json
{"type":"result","run":2,"commit":"abc1234","metric":"latency_ms","value":12.4,"samples":[12.8,12.1,12.3,12.4,12.5],"median":12.4,"status":"measured","timestamp":"2026-05-06T12:04:00Z","description":"remove redundant cache key generation"}
```

Required fields:

- `type`: `result`
- `run`: positive integer
- `metric`: metric name
- `value` or `median`: numeric value
- `timestamp`: ISO-8601 timestamp

### Decision

```json
{"type":"decision","run":2,"action":"keep","reason":"median improved 8.2 pct over best and tests passed","timestamp":"2026-05-06T12:05:00Z"}
```

Required fields:

- `type`: `decision`
- `run`: result run number
- `action`: `keep`, `discard`, `baseline`, or `stop`
- `reason`: short explanation
- `timestamp`: ISO-8601 timestamp

## Snapshot

`AUTORESEARCH_STATE.json` is a generated cache with:

- active config
- baseline run/value
- best run/value
- counts by action
- latest errors
- resume instruction

Regenerate it after every accepted JSONL append.
