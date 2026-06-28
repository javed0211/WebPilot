export type FlakeCategory =
  | 'selector'
  | 'wait'
  | 'network'
  | 'modal'
  | 'environment'
  | 'data'
  | 'assertion'
  | 'unknown';

export type FailureSource = 'playwright' | 'browser-use' | 'webpilot' | 'unknown';

export interface FailureSignal {
  kind:
    | 'retry_count'
    | 'timeout_location'
    | 'selector_confidence'
    | 'network_latency'
    | 'console_error'
    | 'failed_request'
    | 'modal_interference'
    | 'page_load_timing'
    | 'element_detached'
    | 'actionability_failure'
    | 'raw_error';
  value: string | number | boolean;
  detail?: string;
  source: FailureSource;
}

export interface FlakeEvidenceLink {
  label: string;
  href?: string;
}

export interface FlakeAnalysis {
  category: FlakeCategory;
  confidence: number;
  likelyCause: string;
  recommendation: string;
  signals: FailureSignal[];
  evidence: FlakeEvidenceLink[];
  source: FailureSource;
}

export interface FlakeAnalysisInput {
  slug: string;
  status: string;
  failureContext?: string;
  executionSteps?: { action: string; selector?: string | null; url?: string | null; description: string }[];
  runtimeInsights?: { type?: string; message?: string }[];
  artifacts?: { video?: string; trace?: string; screenshots?: string[] };
  retryCount?: number;
}
