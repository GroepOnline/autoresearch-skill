# Autoresearch Comparison Methodology

This document describes the methodology used to compare the Pi Autoresearch implementation with Factory.ai's Droid Autoresearch.

## Overview

The comparison evaluates autoresearch systems across multiple dimensions to provide a comprehensive assessment of their capabilities, trade-offs, and appropriate use cases.

## Comparison Criteria

The comparison is based on 15 weighted criteria across 4 categories:

### Core Functionality (Weight: 33)

1. **Experiment Loop** (weight: 10)
   - Autonomous experiment loop with keep/discard decisions
   - Ability to run hypotheses systematically
   - Automated decision-making based on metrics

2. **State Management** (weight: 8)
   - Crash-safe state management
   - Resume capability after interruptions
   - Reliable experiment tracking

3. **Confidence Scoring** (weight: 7)
   - Statistical confidence scoring for improvements
   - Noise floor detection
   - MAD-based or similar statistical methods

4. **Git Isolation** (weight: 8)
   - Git branch isolation for experiments
   - Clean separation of experiments
   - Easy rollback capabilities

### Safety Features (Weight: 32)

5. **Correctness Guards** (weight: 9)
   - Test validation
   - Type checking integration
   - Correctness as a hard constraint

6. **Safety Policy** (weight: 8)
   - Safety policy for destructive operations
   - Protection against dangerous commands
   - Explicit approval workflows

7. **Scope Validation** (weight: 7)
   - Files in scope validation
   - Off-limits path enforcement
   - Prevention of unauthorized modifications

### User Experience (Weight: 16)

8. **UI Integration** (weight: 6)
   - Terminal UI integration
   - Progress display
   - Real-time feedback

9. **Commands** (weight: 5)
   - Command-line interface
   - Slash commands
   - Ease of invocation

10. **Documentation** (weight: 5)
    - Comprehensive documentation
    - Examples and tutorials
    - Clear usage guidelines

### Extensibility (Weight: 18)

11. **Tool Integration** (weight: 7)
    - Integration with agent tools
    - Tool capability exposure
    - Seamless agent workflow

12. **Custom Metrics** (weight: 6)
    - Support for custom metrics
    - Multi-objective optimization
    - Flexible metric definitions

13. **Plugin System** (weight: 5)
    - Plugin/skill system
    - Extension capabilities
    - Community contributions

### Performance (Weight: 13)

14. **Throughput** (weight: 7)
    - Experiment throughput (experiments per hour)
    - Efficiency of experiment execution
    - Minimization of overhead

15. **Resource Efficiency** (weight: 6)
    - Resource efficiency
    - Memory and CPU usage
    - Minimal overhead

## Scoring Methodology

Each criterion is scored on a scale of 0-1:

- **Binary features**: 1.0 if present, 0.0 if absent
- **Performance metrics**:
  - "high" = 1.0
  - "medium" = 0.7
  - "low" = 0.4

The weighted score is calculated as:

```
weighted_score = feature_score × criterion_weight
```

The overall score is the sum of all weighted scores divided by the maximum possible score:

```
overall_score = (sum of weighted scores) / (sum of weights)
overall_percentage = overall_score × 100
```

## System Implementations

### Pi Autoresearch

- **Platform**: Pi Coding Agent
- **Language**: TypeScript
- **Integration**: Native Pi extension
- **State Format**: JSONL with TypeScript types
- **UI**: Rich Pi TUI integration
- **Safety**: Comprehensive safety policy with scope validation

### Droid Autoresearch (Factory.ai)

- **Platform**: Factory.ai Droid CLI
- **Language**: Python helper script
- **Integration**: Droid skill
- **State Format**: JSONL with Python helper
- **UI**: Terminal output only
- **Safety**: Relies on Droid's built-in safety features

## Running the Comparison

To run the comparison benchmark:

```bash
npm run benchmark:comparison
```

This will output:

- Overall scores for each system
- Detailed comparison table
- Feature analysis (advantages and ties)
- Recommendations for when to use each system
- Summary metrics in METRIC format for programmatic parsing

## Interpreting Results

### Overall Score

The overall score (0-100%) indicates how well each system meets the evaluation criteria. A higher score suggests better coverage of autoresearch capabilities.

### Feature Analysis

The feature analysis identifies:

- **Advantages**: Areas where one system outperforms the other
- **Ties**: Areas where both systems perform equally

### Recommendations

The recommendations section provides guidance on when to choose each system based on:

- Platform compatibility
- Technical preferences
- Specific feature requirements
- Resource constraints

## Limitations

This comparison has several limitations:

1. **Subjective weighting**: The weights assigned to criteria are based on general autoresearch requirements but may not match all use cases.

2. **Binary scoring**: Some features are scored as binary (present/absent) when in reality there may be gradations of quality or completeness.

3. **Platform-specific**: The comparison assumes you have access to both platforms (Pi and Factory.ai), which may not be the case.

4. **Static analysis**: The comparison is based on feature analysis rather than empirical performance measurements.

5. **Evolving systems**: Both systems are actively developed, so the comparison may become outdated over time.

## Future Improvements

Potential improvements to the comparison methodology:

1. **Empirical benchmarks**: Add actual performance benchmarks measuring experiment throughput, memory usage, and latency.

2. **User studies**: Incorporate user feedback on usability and effectiveness.

3. **Customizable weights**: Allow users to adjust criterion weights based on their specific requirements.

4. **More systems**: Expand to include other autoresearch implementations (e.g., Karpathy's original, other agent frameworks).

5. **Dynamic feature assessment**: Implement more nuanced scoring for features with varying levels of implementation quality.

## Contributing

To suggest improvements to the comparison methodology or to add additional autoresearch systems for comparison, please submit an issue or pull request to the repository.

## References

- [Pi Autoresearch Documentation](../README.md)
- [Factory.ai Droid Documentation](https://docs.factory.ai/)
- [Factory.ai Autoresearch Skill](https://github.com/Factory-AI/factory-plugins/tree/master/plugins/autoresearch)
- [Karpathy's Autoresearch](https://github.com/karpathy/autoresearch)
