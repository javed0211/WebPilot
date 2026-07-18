import axios, { AxiosInstance } from 'axios';
import { loadAdoConfig, orgUrl, resolveAdoPat } from './AdoConfig';
import { AdoConfig } from './types';

/**
 * Minimal Azure DevOps REST client for operations MCP cannot perform
 * (notably Test Run / result outcome write-back and automation field patches).
 */
export class AdoRestClient {
  private readonly http: AxiosInstance;
  public readonly organization: string;
  public readonly project: string;

  public constructor(config: AdoConfig = loadAdoConfig()) {
    if (!config.organization || !config.project) {
      throw new Error('ado.organization and ado.project are required for REST calls.');
    }
    this.organization = config.organization;
    this.project = config.project;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (config.auth !== 'azcli') {
      const pat = resolveAdoPat();
      if (!pat) {
        throw new Error('ADO PAT required for REST calls. Set AZURE_DEVOPS_EXT_PAT or ADO_MCP_AUTH_TOKEN.');
      }
      headers.Authorization = `Basic ${Buffer.from(`:${pat}`).toString('base64')}`;
    } else {
      throw new Error(
        'ado.auth: azcli is supported for MCP only. Use auth: pat (with AZURE_DEVOPS_EXT_PAT) for result publishing.'
      );
    }

    this.http = axios.create({
      baseURL: `${orgUrl(this.organization)}/${encodeURIComponent(this.project)}/_apis`,
      headers,
      timeout: config.timeoutMs ?? 90_000,
      params: { 'api-version': '7.1' },
    });
  }

  public async patchWorkItem(
    id: number,
    patch: Array<{ op: string; path: string; value: unknown }>
  ): Promise<unknown> {
    const res = await this.http.patch(`/wit/workitems/${id}`, patch, {
      headers: { 'Content-Type': 'application/json-patch+json' },
      params: { 'api-version': '7.1' },
    });
    return res.data;
  }

  public async createTestRun(body: {
    name: string;
    plan?: { id: number };
    pointIds?: number[];
    automated?: boolean;
    state?: string;
  }): Promise<{ id: number; [key: string]: unknown }> {
    const res = await this.http.post('/test/runs', body, {
      params: { 'api-version': '7.1' },
    });
    return res.data;
  }

  public async addTestResults(
    runId: number,
    results: Array<Record<string, unknown>>
  ): Promise<unknown> {
    const res = await this.http.post(`/test/Runs/${runId}/results`, results, {
      params: { 'api-version': '7.1' },
    });
    return res.data;
  }

  public async updateTestRun(
    runId: number,
    body: { state?: string; comment?: string }
  ): Promise<unknown> {
    const res = await this.http.patch(`/test/runs/${runId}`, body, {
      params: { 'api-version': '7.1' },
    });
    return res.data;
  }

  public async getPoints(planId: number, suiteId: number): Promise<Array<{ id: number; testCase: { id: string } }>> {
    const res = await this.http.get(`/test/Plans/${planId}/Suites/${suiteId}/points`, {
      params: { 'api-version': '7.1' },
    });
    return (res.data?.value ?? []) as Array<{ id: number; testCase: { id: string } }>;
  }
}
