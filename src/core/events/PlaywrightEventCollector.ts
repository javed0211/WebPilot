import type { Page, Request, Response } from 'playwright';
import type { ExecutionEventLedger } from './ExecutionEventLedger';
import { EvidenceRedactor } from './EvidenceRedactor';

export interface PlaywrightEventCollectorOptions {
  ledger: ExecutionEventLedger;
  /** Capture response status for failed / 4xx / 5xx only when 'errors'. */
  networkMode?: 'off' | 'errors' | 'metadata';
  consoleMode?: 'off' | 'errors' | 'all';
  /** Optional resolver for correlating events to the current step index. */
  currentStepIndex?: () => number | undefined;
}

/**
 * Attaches Playwright page listeners and records redacted network/console events.
 */
export class PlaywrightEventCollector {
  private readonly ledger: ExecutionEventLedger;
  private readonly networkMode: 'off' | 'errors' | 'metadata';
  private readonly consoleMode: 'off' | 'errors' | 'all';
  private readonly currentStepIndex?: () => number | undefined;
  private attached = false;
  private detachFns: Array<() => void> = [];

  constructor(options: PlaywrightEventCollectorOptions) {
    this.ledger = options.ledger;
    this.networkMode = options.networkMode ?? 'errors';
    this.consoleMode = options.consoleMode ?? 'errors';
    this.currentStepIndex = options.currentStepIndex;
  }

  public attach(page: Page): void {
    if (this.attached) return;
    this.attached = true;

    if (this.networkMode !== 'off') {
      const onRequestFailed = (request: Request) => {
        const failure = request.failure();
        this.ledger.append({
          kind: 'network',
          phase: 'execute',
          outcome: 'failed',
          stepIndex: this.currentStepIndex?.(),
          payload: {
            event: 'requestfailed',
            method: request.method(),
            url: EvidenceRedactor.redactUrl(request.url()),
            resourceType: request.resourceType(),
            errorText: failure?.errorText,
          },
        });
      };

      const onResponse = (response: Response) => {
        const status = response.status();
        const isError = status >= 400;
        if (this.networkMode === 'errors' && !isError) return;
        this.ledger.append({
          kind: 'network',
          phase: 'execute',
          outcome: isError ? 'failed' : 'info',
          stepIndex: this.currentStepIndex?.(),
          payload: {
            event: 'response',
            method: response.request().method(),
            url: EvidenceRedactor.redactUrl(response.url()),
            status,
            statusText: response.statusText(),
            resourceType: response.request().resourceType(),
          },
        });
      };

      page.on('requestfailed', onRequestFailed);
      page.on('response', onResponse);
      this.detachFns.push(() => {
        page.off('requestfailed', onRequestFailed);
        page.off('response', onResponse);
      });
    }

    if (this.consoleMode !== 'off') {
      const onConsole = (msg: { type: () => string; text: () => string }) => {
        const type = msg.type();
        if (this.consoleMode === 'errors' && type !== 'error' && type !== 'warning') return;
        this.ledger.append({
          kind: 'console',
          phase: 'execute',
          outcome: type === 'error' ? 'failed' : 'info',
          stepIndex: this.currentStepIndex?.(),
          payload: {
            event: 'console',
            level: type,
            text: msg.text(),
          },
        });
      };

      const onPageError = (err: Error) => {
        this.ledger.append({
          kind: 'page_error',
          phase: 'execute',
          outcome: 'failed',
          stepIndex: this.currentStepIndex?.(),
          payload: {
            event: 'pageerror',
            message: err.message,
            name: err.name,
          },
        });
      };

      page.on('console', onConsole as any);
      page.on('pageerror', onPageError);
      this.detachFns.push(() => {
        page.off('console', onConsole as any);
        page.off('pageerror', onPageError);
      });
    }
  }

  public detach(): void {
    for (const fn of this.detachFns) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    this.detachFns = [];
    this.attached = false;
  }
}
