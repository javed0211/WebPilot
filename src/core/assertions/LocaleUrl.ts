/**
 * Booking.com and similar sites embed the visitor locale in route filenames
 * (`searchresults.en-gb.html` vs `searchresults.html` vs `searchresults.fr.html`).
 * Assertions derived from a recorded URL must not pin the recording locale, or
 * the generated spec fails on any machine with different language settings.
 */
export function stripLocaleFromUrlFragment(fragment: string): string {
  const match = fragment.match(/^(.+?)\.[a-z]{2}(?:-[a-z]{2})?\.html?$/i);
  return match ? match[1] : fragment;
}
