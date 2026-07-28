# Digital / public-web rulebook

## Vocabulary
| Step language | Prefer |
|---------------|--------|
| Cookie / consent / Accept | Accept all / Accept cookies / OneTrust `#onetrust-accept-btn-handler` |
| Destination / search box | combobox / searchbox / textbox with visible label or placeholder |
| Nav menu / Platform / Solutions | role=link or menuitem; **hover** to expand, then verify submenu |
| Search button | role=button name=Search (not language selectors) |
| Date picker / check-in / check-out | calendar gridcells / aria-label dates |

## Rules
- Prefer semantic roles over brittle CSS.
- For mega-menus: hover the parent, then assert submenu; do not skip hover via raw evaluate unless no hover target exists.
- Date flows: open picker → select check-in → select check-out → Search; do not call done early.
- Overlay dismiss is optional when the banner is absent.
