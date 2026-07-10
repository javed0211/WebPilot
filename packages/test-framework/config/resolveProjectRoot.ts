import * as fs from 'fs';
import * as path from 'path';

/**
 * Locate WebPilot project root (directory containing resources/config/environments).
 */
export function resolveWebPilotProjectRoot(start = process.cwd()): string {
  if (process.env.WEBPILOT_PROJECT_ROOT) {
    return path.resolve(process.env.WEBPILOT_PROJECT_ROOT);
  }

  let current = path.resolve(start);
  for (let depth = 0; depth < 12; depth++) {
    const envDir = path.join(current, 'resources', 'config', 'environments');
    if (fs.existsSync(envDir)) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }

  return path.resolve(start);
}
