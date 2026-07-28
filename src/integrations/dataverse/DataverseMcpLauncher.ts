import * as fs from 'fs';
import * as path from 'path';
import { findCliInstallRoot } from '../../cli/ProjectContext';
import { expandEnvMap, loadDataverseConfig } from './DataverseConfig';
import { DataverseConfig, DataverseMcpLaunchSpec } from './types';

const MCP_PACKAGE = '@microsoft/dataverse';
const MCP_ENTRY = path.join('bin', 'dataverse.js');

/**
 * Resolves the pinned `@microsoft/dataverse` CLI entry from the WebPilot install root.
 */
export function resolveBundledDataverseEntry(installRoot = findCliInstallRoot()): string {
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
 * Builds the stdio spawn spec for the official Dataverse MCP server.
 * Equivalent to: `npx @microsoft/dataverse mcp <environmentUrl> [--preview]`
 * Auth uses Dataverse CLI profiles (`dataverse auth create`) — not Cursor mcp.json.
 */
export function buildDataverseMcpLaunchSpec(
  config: DataverseConfig = loadDataverseConfig()
): DataverseMcpLaunchSpec {
  if (!config.enabled) {
    throw new Error(
      'Dataverse integration is disabled. Set dataverse.enabled: true in resources/config/webpilot.yaml.'
    );
  }
  if (!config.environmentUrl?.trim()) {
    throw new Error('dataverse.environmentUrl is required (or set DATAVERSE_URL).');
  }

  const env: Record<string, string> = {
    ...expandEnvMap(config.env),
  };

  if (config.command) {
    return {
      command: config.command,
      args: config.args ?? [],
      env,
      timeoutMs: config.timeoutMs ?? 120_000,
      environmentUrl: config.environmentUrl!,
      preview: Boolean(config.preview),
    };
  }

  const entry = resolveBundledDataverseEntry();
  const args = [entry, 'mcp', config.environmentUrl!];
  if (config.preview) args.push('--preview');

  return {
    command: process.execPath,
    args,
    env,
    timeoutMs: config.timeoutMs ?? 120_000,
    environmentUrl: config.environmentUrl!,
    preview: Boolean(config.preview),
  };
}

/**
 * Spawn args for one-shot `mcp --validate` (not a long-lived MCP session).
 */
export function buildDataverseValidateArgs(
  config: DataverseConfig = loadDataverseConfig()
): { command: string; args: string[]; env: Record<string, string>; timeoutMs: number } {
  const launch = buildDataverseMcpLaunchSpec(config);
  // launch.args = [entry, 'mcp', url, ...] → insert --validate after mcp
  const args = [...launch.args];
  const mcpIdx = args.findIndex((a) => a === 'mcp');
  if (mcpIdx >= 0) {
    args.splice(mcpIdx + 1, 0, '--validate');
  } else {
    args.push('--validate');
  }
  return {
    command: launch.command,
    args,
    env: launch.env,
    timeoutMs: launch.timeoutMs,
  };
}
