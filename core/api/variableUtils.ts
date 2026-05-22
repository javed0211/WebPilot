export function interpolateString(str: string, variables: Record<string, unknown>): string {
  return str.replace(/{{(\w+)}}/g, (_, name) => {
    if (variables[name] !== undefined && variables[name] !== null) {
      return String(variables[name]);
    }
    return `{{${name}}}`;
  });
}

export function deepInterpolate<T>(obj: T, variables: Record<string, unknown>): T {
  if (typeof obj === 'string') {
    return interpolateString(obj, variables) as T;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepInterpolate(item, variables)) as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(obj as object)) {
      result[key] = deepInterpolate((obj as Record<string, unknown>)[key], variables);
    }
    return result as T;
  }
  return obj;
}

export function getNestedProperty(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, part) => {
    if (acc !== null && typeof acc === 'object' && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}
