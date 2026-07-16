import * as path from 'path';

/**
 * Site-folder page naming — prefer pages/<site>/<Brand><Route>Page.ts
 * over invented flat WwwbookingcomHomePage.ts.
 */

export function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** booking.com → booking; en.wikipedia.org → wikipedia; automationexercise.com → automationexercise */
export function siteFolderFromHost(host: string): string {
  const parts = host.toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
  if (parts.length === 0) return 'site';
  if (parts[0] === 'en' || parts[0] === 'm' || parts[0] === 'www') {
    return parts[1] || parts[0];
  }
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return parts[0];
}

export function pascalCaseToken(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

export function routeLabelFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/').filter(Boolean);
    if (segments.length === 0) return 'Home';
    let last = segments[segments.length - 1];
    // searchresults.en-gb.html → SearchResults
    last = last.replace(/\.(html?|php|aspx)$/i, '');
    last = last.replace(/\.[a-z]{2}(-[a-z]{2})?$/i, ''); // .en-gb
    last = last.replace(/^searchresults$/i, 'search results');
    const label = pascalCaseToken(last.replace(/[-_]+/g, ' '));
    if (!label || /^(Index|Default|Main)$/i.test(label)) return 'Home';
    return label;
  } catch {
    return 'Home';
  }
}

export interface InferredPageName {
  className: string;
  siteFolder: string;
  pagePath: string;
}

/** Infer curated-style page class + path from a URL (never Www* flat names). */
export function inferSitePageFromUrl(url: string): InferredPageName {
  const host = hostnameFromUrl(url) || 'site.local';
  const siteFolder = siteFolderFromHost(host);
  const brand = pascalCaseToken(siteFolder);
  const route = routeLabelFromUrl(url);
  const className = `${brand}${route}Page`;
  const pagePath = path.posix.join(
    'packages/test-framework/pages',
    siteFolder,
    `${className}.ts`
  );
  return { className, siteFolder, pagePath };
}

/** True for junk flat names from older codegen (WwwbookingcomHomePage, Enwikipediaorg…). */
export function isInventedFlatPageName(className: string): boolean {
  return /^Www[a-z0-9]+/i.test(className) || /^En[a-z0-9]+org/i.test(className);
}

export function isInventedFlatPagePath(filePath: string): boolean {
  const base = path.basename(filePath, path.extname(filePath));
  const normalized = filePath.replace(/\\/g, '/');
  // Flat under pages/ (not pages/<site>/)
  const underSiteFolder = /\/pages\/[a-z0-9_-]+\//i.test(normalized);
  if (underSiteFolder) return false;
  return isInventedFlatPageName(base);
}
