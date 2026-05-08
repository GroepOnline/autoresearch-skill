export interface ArConfig {
  type: "config";
  schema_version?: number;
  name: string;
  metric?: string;
  direction?: "lower" | "higher";
  unit?: string;
  min_effect_size_pct?: number;
  noise_floor_pct?: number;
  max_runs?: number;
  max_minutes?: number;
  created_at?: string;
  segment?: number;
  // Legacy fields used by earlier extension drafts.
  metricName?: string;
  metricUnit?: string;
  bestDirection?: "lower" | "higher";
}

export interface ArResult {
  type?: "result";
  run: number;
  commit?: string;
  metric: string | number;
  value?: number;
  median?: number;
  samples?: number[];
  status?: "measured" | "keep" | "discard" | "crash";
  description?: string;
  timestamp?: string | number;
  segment?: number;
  metrics?: Record<string, number>;
}

export interface ArDecision {
  type: "decision";
  run: number;
  action: "keep" | "discard" | "baseline" | "stop";
  reason: string;
  timestamp?: string;
}

export interface NormalizedResult {
  run: number;
  metricName: string;
  value: number;
  status: "measured" | "keep" | "discard" | "crash";
  description: string;
  timestamp?: string | number;
  segment?: number;
  commit?: string;
  metrics?: Record<string, number>;
}

export interface ArState {
  config: ArConfig | null;
  results: NormalizedResult[];
  decisions: ArDecision[];
  parseErrors: string[];
  runCount: number;
  keptCount: number;
  discardedCount: number;
  crashedCount: number;
  bestMetric: number | null;
  bestRun: number | null;
  baselineMetric: number | null;
  currentSegment: number;
  isPaused: boolean;
  hasIdeas: boolean;
}

export interface StartBudgets {
  maxRuns: number;
  maxMinutes: number;
}
