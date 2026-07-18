import { AdoMcpService } from './AdoMcpService';
import { loadAdoConfig } from './AdoConfig';
import { AdoConfig } from './types';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  for (const key of ['testPlans', 'value', 'testSuites', 'testCases', 'suites', 'plans']) {
    if (Array.isArray(rec[key])) return rec[key] as unknown[];
  }
  return [];
}

function extractId(payload: unknown): number | undefined {
  const rec = asRecord(payload);
  const id = rec.id ?? rec.Id ?? asRecord(rec.testPlan).id ?? asRecord(rec.workItem).id;
  const n = Number(id);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export interface CreateTestPlanOptions {
  name: string;
  iteration: string;
  description?: string;
  areaPath?: string;
  startDate?: string;
  endDate?: string;
  dryRun?: boolean;
}

export interface CreateTestSuiteOptions {
  planId: number;
  parentSuiteId: number;
  name: string;
  dryRun?: boolean;
}

export interface CreateTestCaseOptions {
  title: string;
  steps?: string;
  priority?: number;
  areaPath?: string;
  iterationPath?: string;
  testsWorkItemId?: number;
  planId?: number;
  suiteId?: number;
  dryRun?: boolean;
}

export class AdoTestPlanService {
  public constructor(private readonly config: AdoConfig = loadAdoConfig()) {}

  public async listTestPlans(filterActivePlans = true): Promise<unknown[]> {
    const svc = new AdoMcpService(this.config);
    return svc.withClient(async (mcp) => {
      const tool = mcp.resolveTool(
        ['testplan_list_test_plans', 'list_test_plans', 'mcp_ado_testplan_list_test_plans'],
        'project'
      );
      const payload = await mcp.callTool(tool, {
        project: mcp.launch.project,
        filterActivePlans,
        includePlanDetails: true,
      });
      return asArray(payload);
    });
  }

  public async createTestPlan(options: CreateTestPlanOptions): Promise<{ id?: number; raw: unknown; dryRun: boolean }> {
    if (options.dryRun) {
      return {
        dryRun: true,
        raw: {
          project: this.config.project,
          name: options.name,
          iteration: options.iteration,
          areaPath: options.areaPath,
          description: options.description,
        },
      };
    }
    const svc = new AdoMcpService(this.config);
    return svc.withClient(async (mcp) => {
      const tool = mcp.resolveTool(
        ['testplan_create_test_plan', 'create_test_plan', 'mcp_ado_testplan_create_test_plan'],
        'name'
      );
      const args: Record<string, unknown> = {
        project: mcp.launch.project,
        name: options.name,
        iteration: options.iteration,
      };
      if (options.description) args.description = options.description;
      if (options.areaPath) args.areaPath = options.areaPath;
      if (options.startDate) args.startDate = options.startDate;
      if (options.endDate) args.endDate = options.endDate;
      const raw = await mcp.callTool(tool, args);
      return { id: extractId(raw), raw, dryRun: false };
    });
  }

  public async listTestSuites(planId: number): Promise<unknown[]> {
    const svc = new AdoMcpService(this.config);
    return svc.withClient(async (mcp) => {
      const tool = mcp.resolveTool(
        ['testplan_list_test_suites', 'list_test_suites', 'mcp_ado_testplan_list_test_suites'],
        'planId'
      );
      const payload = await mcp.callTool(tool, {
        project: mcp.launch.project,
        planId,
      });
      return asArray(payload);
    });
  }

  public async createTestSuite(options: CreateTestSuiteOptions): Promise<{ id?: number; raw: unknown; dryRun: boolean }> {
    if (options.dryRun) {
      return {
        dryRun: true,
        raw: {
          project: this.config.project,
          planId: options.planId,
          parentSuiteId: options.parentSuiteId,
          name: options.name,
        },
      };
    }
    const svc = new AdoMcpService(this.config);
    return svc.withClient(async (mcp) => {
      const tool = mcp.resolveTool(
        ['testplan_create_test_suite', 'create_test_suite', 'mcp_ado_testplan_create_test_suite'],
        'name'
      );
      const raw = await mcp.callTool(tool, {
        project: mcp.launch.project,
        planId: options.planId,
        parentSuiteId: options.parentSuiteId,
        name: options.name,
      });
      return { id: extractId(raw), raw, dryRun: false };
    });
  }

  public async listTestCases(planId: number, suiteId: number): Promise<unknown[]> {
    const svc = new AdoMcpService(this.config);
    return svc.withClient(async (mcp) => {
      const tool = mcp.resolveTool(
        ['testplan_list_test_cases', 'list_test_cases', 'mcp_ado_testplan_list_test_cases'],
        'suiteId'
      );
      const payload = await mcp.callTool(tool, {
        project: mcp.launch.project,
        planId,
        suiteId,
      });
      return asArray(payload);
    });
  }

  public async createTestCase(
    options: CreateTestCaseOptions
  ): Promise<{ id?: number; raw: unknown; dryRun: boolean }> {
    if (options.dryRun) {
      return {
        dryRun: true,
        raw: {
          project: this.config.project,
          title: options.title,
          steps: options.steps,
          planId: options.planId,
          suiteId: options.suiteId,
          testsWorkItemId: options.testsWorkItemId,
        },
      };
    }
    const svc = new AdoMcpService(this.config);
    return svc.withClient(async (mcp) => {
      const tool = mcp.resolveTool(
        ['testplan_create_test_case', 'create_test_case', 'mcp_ado_testplan_create_test_case'],
        'title'
      );
      const args: Record<string, unknown> = {
        project: mcp.launch.project,
        title: options.title,
      };
      if (options.steps) args.steps = options.steps;
      if (options.priority !== undefined) args.priority = options.priority;
      if (options.areaPath) args.areaPath = options.areaPath;
      if (options.iterationPath) args.iterationPath = options.iterationPath;
      if (options.testsWorkItemId) args.testsWorkItemId = options.testsWorkItemId;

      const raw = await mcp.callTool(tool, args);
      const id = extractId(raw);

      if (id && options.planId && options.suiteId) {
        const addTool = mcp.resolveTool(
          [
            'testplan_add_test_cases_to_suite',
            'add_test_cases_to_suite',
            'mcp_ado_testplan_add_test_cases_to_suite',
          ],
          'suiteId'
        );
        await mcp.callTool(addTool, {
          project: mcp.launch.project,
          planId: options.planId,
          suiteId: options.suiteId,
          testCaseIds: String(id),
        });
      }

      return { id, raw, dryRun: false };
    });
  }

  /**
   * Smoke-test MCP connectivity: connect, list tools, optionally list plans.
   */
  public async status(): Promise<{
    organization: string;
    project: string;
    auth: string;
    toolCount: number;
    tools: string[];
    planCount?: number;
  }> {
    const svc = new AdoMcpService(this.config);
    return svc.withClient(async (mcp) => {
      const tools = mcp.listTools().map((t) => t.name);
      let planCount: number | undefined;
      try {
        const plans = await this.listPlansWithClient(mcp);
        planCount = plans.length;
      } catch {
        planCount = undefined;
      }
      return {
        organization: mcp.launch.organization,
        project: mcp.launch.project,
        auth: mcp.launch.auth,
        toolCount: tools.length,
        tools: tools.filter((n) => /testplan|wit_|core_/i.test(n)).slice(0, 40),
        planCount,
      };
    });
  }

  private async listPlansWithClient(mcp: AdoMcpService): Promise<unknown[]> {
    const tool = mcp.resolveTool(
      ['testplan_list_test_plans', 'list_test_plans', 'mcp_ado_testplan_list_test_plans'],
      'project'
    );
    const payload = await mcp.callTool(tool, {
      project: mcp.launch.project,
      filterActivePlans: true,
      includePlanDetails: false,
    });
    return asArray(payload);
  }
}
