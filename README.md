# Autoresearch Skill

Autonomous experiment loop: try ideas, keep what works, discard what doesn't, never stop.

## Features

- **JSONL State Protocol** — crash-safe experiment logging
- **Data Integrity** — atomic writes, validation, backups
- **Dashboard** — auto-generated progress view
- **Multi-Model Strategy** — optimal model per phase:
  - DeepSeek V4 Flash → fast experiments
  - FW-GLM-5.1 → reasoning & hypothesis generation
  - GPT-5.4 → crash debugging
  - Kimi K2.6 → orchestration (long context)

## Usage

```bash
# In agent config, add as skill:
skills:
  - path: GroepChef/autoresearch-skill
```

## Compatibility

- Pi Coding Agent
- OpenCode
- Factory/Droid

## License

MIT
