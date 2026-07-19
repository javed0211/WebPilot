import { describe, expect, it } from 'vitest';
import { evidenceHref, isVideoPath, safePath } from './format';

describe('artifact path helpers', () => {
  it('preserves relative video paths from html/', () => {
    expect(safePath('../videos/wikipedia_complex_dom_verification.mp4')).toBe(
      '../videos/wikipedia_complex_dom_verification.mp4'
    );
  });

  it('blocks dangerous schemes', () => {
    expect(safePath('javascript:alert(1)')).toBe('#');
    expect(safePath('data:text/html,hi')).toBe('#');
  });

  it('normalizes evidence hrefs under reports/', () => {
    expect(evidenceHref('runtime/reports/data/evidence/x/x.json')).toBe('../data/evidence/x/x.json');
    expect(evidenceHref('../data/evidence/x/x.json')).toBe('../data/evidence/x/x.json');
  });

  it('detects video extensions', () => {
    expect(isVideoPath('../videos/a.webm')).toBe(true);
    expect(isVideoPath('../traces/a.zip')).toBe(false);
  });
});
