# 15. Grounded Root-Cause Reporting

## Goal

Every root-cause claim must cite **event-level evidence** from the execution ledger. If causality cannot be supported, report `insufficient_evidence` — never an uncited narrative.

## User Problem

Report AI analysis today is free-form markdown (`aiAnalysis?: string`) fed truncated prose. “A trace exists” is treated as if it proved an API failure. QE leads cannot trust diagnoses for release gates.

## Product Scope

Depends on [12 Execution Event Ledger](./12-execution-event-ledger.md) and complements [11 Evidence-First Reports](./11-evidence-first-reports.md).

### Configuration

```yaml
features:
  groundedRootCause: true

evidence:
  failOnInvalidCitation: true   # never ship findings that fail CitationValidator
```

Env overrides:

- `WEBPILOT_GROUNDED_ROOT_CAUSE=0|1`
- `WEBPILOT_FAIL_ON_INVALID_CITATION=0|1`

When `groundedRootCause` is on, report generation runs `RootCauseAnalyzer` instead of free-form per-test `aiAnalysis`. Legacy markdown is still written via `RootCauseAnalyzer.toMarkdown()` for existing report consumers.

### Target contract

```typescript
interface RootCauseAnalysis {
  schemaVersion: 1;
  status: 'grounded' | 'insufficient_evidence';
  summary: string;
  findings: Array<{
    findingId: string;
    claim: string;
    claimType: RootCauseClaimType;
    confidence: number;
    causeEventIds: string[];
    supportingEventIds: string[];
    contradictoryEventIds?: string[];
  }>;
  missingEvidence?: string[];
}
```

### CitationValidator rules

Reject a finding when:

- Event ID does not exist in the run bundle
- Event belongs to another run
- Cause timestamp is after the claimed effect
- Event kind cannot support the claim type
- Cited payload was redacted beyond usefulness

Invalid LLM / proposed output is dropped. If nothing valid remains → `insufficient_evidence`.

## Implementation Status

- [x] Event ledger + network/console capture foundation
- [x] `RootCauseAnalyzer` + `CitationValidator`
- [x] Replace/extend `aiAnalysis` with structured `rootCauseAnalysis` (markdown compat retained)
- [x] Report HTML shows grounded status + cited event IDs
- [x] CI config: `evidence.failOnInvalidCitation` (default true)
- [ ] Deep citation deep-links in React report-ui

## Critical Files

- `src/core/execution_report/RootCauseTypes.ts`
- `src/core/execution_report/RootCauseAnalyzer.ts`
- `src/core/execution_report/CitationValidator.ts`
- `src/core/ExecutionReportService.ts`
- `src/core/lifecycle/FeatureFlags.ts`

## Tests

```bash
npm run test:grounded-root-cause
```

## Exit Criteria

1. “Checkout failed because POST /orders returned 500” cites the network event ID — **covered**
2. Missing network capture → `insufficient_evidence` with `missingEvidence` — **covered**
3. No finding ships without passing CitationValidator — **covered**
4. Legacy `aiAnalysis` remains as rendered compatibility text during migration — **covered** (`toMarkdown`)
