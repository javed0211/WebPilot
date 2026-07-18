import * as fs from 'fs';
import * as path from 'path';
import { findCliInstallRoot } from '../../cli/ProjectContext';
import { expandEnvMap, loadAdoConfig, resolveAdoPat } from './AdoConfig';
import { AdoConfig, AdoMcpLaunchSpec } from './types';

const MCP_PACKAGE = '@azure-devops/mcp';
const MCP_ENTRY = path.join('dist', 'index.js');

/**
 * Resolves the pinned `@azure-devops/mcp` entry from the WebPilot install root
 * (or from Node's module resolution when running from source).
 */
export function resolveBundledMcpEntry(installRoot = findCliInstallRoot()): string {
  const fromInstall = path.join(installRoot, 'node_modules', MCP_PACKAGE, MCP_ENTRY);
  if (fs.existsSync(fromInstall)) return fromInstall;

  try {
    const pkgJson = require.resolve(`${MCP_PACKAGE}/package.json`);
    const entry = path.join(path.dirname(pkgJson), MCP_ENTRY);
    if (fs.existsSync(entry)) return entry;
  } catch {
    // fall through
  }

  throw new Error(
    `Unable to locate ${MCP_PACKAGE}. Reinstall @qubiqlabs/webpilot (it pins ${MCP_PACKAGE}).`
  );
}

/**
 * Builds the stdio spawn spec for the official Azure DevOps MCP server.
 * Consumers enable `ado:` in webpilot.yaml; they do not need Cursor mcp.json.
 * Does not require a PAT to be present (auth is validated at connect time).
 */
export function buildAdoMcpLaunchSpec(config: AdoConfig = loadAdoConfig()): AdoMcpLaunchSpec {
  if (!config.enabled) {
    throw new Error(
      'Azure DevOps integration is disabled. Set ado.enabled: true in resources/config/webpilot.yaml.'
    );
  }
  if (!config.organization?.trim()) {
    throw new Error('ado.organization is required (or set AZURE_DEVOPS_ORG).');
  }
  if (!config.project?.trim()) {
    throw new Error('ado.project is required (or set AZURE_DEVOPS_PROJECT).');
  }

  const cfg = config;
  const domains = cfg.domains ?? ['core', 'work-items', 'test-plans'];
  const authFlag = cfg.auth === 'azcli' ? 'azcli' : 'envvar';

  const env: Record<string, string> = {
    ...expandEnvMap(cfg.env),
  };

  if (cfg.auth !== 'azcli') {
    const pat = resolveAdoPat();
    if (pat) env.ADO_MCP_AUTH_TOKEN = pat;
  }

  if (cfg.command) {
    return {
      command: cfg.command,
      args: cfg.args ?? [],
      env,
      timeoutMs: cfg.timeoutMs ?? 90_000,
      organization: cfg.organization!,
      project: cfg.project!,
      auth: cfg.auth ?? 'pat',
    };
  }

  const entry = resolveBundledMcpEntry();
  const args = [entry, cfg.organization!, '--authentication', authFlag, '-d', ...domains];
  if (cfg.tenant) {
    args.push('--tenant', cfg.tenant);
  }

  return {
    command: process.execPath,
    args,
    env,
    timeoutMs: cfg.timeoutMs ?? 90_000,
    organization: cfg.organization!,
    project: cfg.project!,
    auth: cfg.auth ?? 'pat',
  };
}
