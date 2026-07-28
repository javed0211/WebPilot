# Dynamics 365 / Dataverse UCI rulebook

Derived from how [EasyRepro](https://github.com/microsoft/EasyRepro) models the Unified Interface (`XrmApp`: Navigation, CommandBar, Grid, Entity, Lookup, Dialogs, QuickCreate, GlobalSearch, BusinessProcessFlow, Timeline, RelatedGrid, Dashboard).

Use **Dynamics product language**, not generic web jargon. Prefer `data-id`, Fluent / UCI accessible names, and logical field names over deep CSS.

## Mental model (EasyRepro → UI)

| EasyRepro area | What the user means | Where to act |
|----------------|---------------------|--------------|
| `Navigation.OpenApp` | Switch / open model-driven **app** | App launcher / waffle / app list |
| `Navigation.OpenArea` / `OpenSubArea` | Go to **Area → SubArea** (e.g. Sales → Accounts) | Left **sitemap**; change area if needed |
| `Navigation.OpenGlobalSearch` | **Relevance / global search** | Magnifying glass / Search in top bar |
| `Navigation.QuickCreate` | **+ Quick Create** for an entity | Global create (+) → entity |
| `CommandBar.ClickCommand` | Ribbon: New, Save, Delete, Refresh, Assign, … | Main **command bar**; then **More commands** |
| `Grid.Search` / `SwitchView` / `OpenRecord` | **Quick Find**, change **view**, open row | Entity list / read-only grid |
| `Entity.SetValue` / `GetValue` / `SelectTab` | Fill **form fields**, switch **tabs** | Main form body / header |
| `Entity.SelectLookup` / `Lookup.*` | **Lookup** field + results / Advanced Lookup | Combobox + lookup flyout / dialog |
| `Dialogs.*` | Confirm, Assign, Delete, Duplicate Detection, Close Opportunity | Modal dialog / inline dialog |
| `BusinessProcessFlow.*` | **BPF** stages: Next / Previous / Set Active / Switch Process | Process bar on form |
| `Timeline.*` | Notes, Posts, Phone Call, Task, Email, Appointment | Timeline / Activities wall |
| `RelatedGrid` / Related tab | **Related** entities / associated views | Related tab / related nav |
| `QuickCreate.*` | Side-panel quick create Save / Cancel | Quick create pane |
| `Dashboard.SelectDashboard` | Switch dashboard | Dashboard selector |

## Vocabulary → targeting

| Step / business language | Control | Prefer targeting |
|--------------------------|---------|------------------|
| Open app / switch app / waffle | App launcher | App launcher / WaffleOffice365; pick app by display name |
| Area / change area | Sitemap area switcher | Area control, then sub-area link by **exact label** |
| SubArea / go to Accounts / Cases / … | Sitemap sub-area | Left nav item matching entity/display name |
| Go back | Browser-like back in shell | `button[title='Go back']` or shell back control |
| Global search / Relevance Search | Top-bar search | Search node / search textbox; filter by entity when offered |
| Quick Create / + New (global) | Global create | `navTabGlobalCreate` / + menu → entity name |
| Command / New / Save / Delete / Refresh / Assign / Share | Command bar | `button[aria-label="…"]` in command bar; try **More commands** / overflow first if missing |
| More commands / ellipsis / overflow | Collapsed ribbon | `moreCommands` / “More commands” before failing |
| Quick Find / Quick search | Grid quick find | `input` aria-label **Quick Find**; `data-id` containing `quickFind` / findCriteria |
| Switch view / Saved view / System view | View selector | View selector / “Select a view”; pick view by name |
| Open record / open row N / first record | Grid row | Click primary column / row by accessible name; virtualized → scroll into view |
| Select / highlight record(s) / select all | Grid selection | Row checkbox / select-all in grid header |
| Sort by column | Grid header | Column header sort control |
| Jump bar / filter by letter | Alphabet jump bar | Jump bar letter (classic grids) |
| Form tab / Summary / Details | Form tablist | `data-id` containing `tablist-…`; click tab by label |
| Form selector / switch form | Form selector | `data-id="form-selector"` → flyout item |
| Text / number / currency field | Input | Control near field **label**; `data-id` often `{logicalname}.*` |
| Option set / choice / picklist | Combobox / listbox | Open dropdown → option by **display text** (case-sensitive) |
| Multi-select choice | Multi-value option set | Add/remove tags; do not leave flyout open |
| Two options / Yes-No / boolean | Toggle / checkbox | Visible toggle for the field label |
| Date / Date and time | Date picker | Date control; set date then time if required |
| Lookup / customer / regarding / owner | Lookup | Click field → type → wait for results → click matching **lookup item**; Index 0 = first match |
| Advanced Lookup / look up more records | Lookup dialog | “Advanced lookup” / lookup dialog: search, switch entity/view, Select/Add |
| Clear lookup / clear field | Clear | Clear (X) on control, or clear then re-set (EasyRepro often ClearValue before SetValue) |
| Header field | Form header | Header region controls (`GetHeaderValue` / `SetHeaderValue` pattern) |
| Subgrid / associated records on form | Subgrid | Subgrid by name; Add / Open row / subgrid lookup |
| Related / Related tab | Related | Related tab → related entity (e.g. Activities, Cases) |
| Timeline / Activities / Notes / Posts | Timeline | Timeline Add → Appointment / Email / Phone Call / Task / Note / Post |
| BPF / process / Next stage / Previous / Set Active | Business process | Stage advance / back / set active; fill BPF fields before Next if required |
| Switch process | Process switcher | Switch Process dialog → process title → OK |
| Assign / Assign to me / user or team | Assign dialog | Command Assign → Me vs User/Team lookup → OK |
| Delete | Delete dialog | Command Delete → confirm (OK / Delete) |
| Duplicate detection | Duplicate dialog | Save or Cancel on duplicate dialog |
| Close as Won / Close Opportunity | Opportunity dialog | Revenue, close date, description → OK |
| Confirmation / warning dialog | Modal | Confirm / Cancel / OK; close warning footers |
| Stay signed in / MFA / OTP | Entra login | Email → password → Stay signed in; OTP field `name=otc` when prompted |
| Notifications / message bar | App message bar | Close notification if it blocks interaction |
| Dashboard | Dashboard | Dashboard selector by name |

## Interaction recipes (do this order)

### Navigate Area → SubArea
1. If wrong app: open **app launcher** → select app by name.
2. If sub-area not visible: open **Change area** / area switcher → pick area (Sales, Service, …).
3. Click the **sub-area** (Accounts, Contacts, Cases, …) by visible label — do not invent deep-link URLs.

### Grid → open / search
1. Optional: **Switch view** to the named saved/system view.
2. **Quick Find**: focus → type → Enter (or search icon). Clear previous criteria when re-searching.
3. Open record by row index or primary-name match; wait for form load (`data-id` topBar / form ready).

### Command bar
1. Prefer exact command label (“New Account”, “Save”, “Delete”, “Refresh”, “Assign”).
2. If not visible: open **More commands** / overflow, then retry.
3. Nested flyouts: click parent command, then sub-command (EasyRepro `ClickCommand(name, subname)`).

### Set form values
1. Ensure correct **form tab** (Summary, Details, …).
2. Match fields by **label** or logical name; ignore `aria-hidden` / zero-size duplicates.
3. **Lookup**: open → type value → wait until results (not stuck on “Loading…”) → select item (or open Advanced Lookup).
4. **Option set**: choose by option **text**, not index, unless the step says otherwise.
5. **Save** via command bar or form Save; handle **duplicate detection** if it appears.
6. After Save, check footer status / notification for errors before continuing.

### Lookup dialog (Advanced Lookup)
1. Search criteria → optionally **Switch entity** / **Switch view**.
2. Select row(s) → **Add** / **Select**; **New** only if the step asks to create.

### Dialogs
- Always complete or dismiss blocking dialogs before the next step.
- Assign: choose Me vs User/Team, resolve lookup, confirm.
- Delete / Confirm: explicit OK; Cancel only when the step says so.

### BPF
1. Select stage if needed → set BPF fields → **Next stage** / **Set Active**.
2. **Switch process** only when asked; confirm in process switcher dialog.

### Timeline
1. Timeline **Add** → activity type.
2. Fill subject / required fields → **Save and Close** (or Add for note/post).

### Quick Create
1. Global **+** → entity → set required fields → **Save** (or Cancel).
2. Prefer quick-create pane controls, not the main form underneath.

## Hard rules
- Prefer **`data-id`** and role+name over deep CSS / absolute XPath.
- Ignore collapsed / `aria-hidden` / off-screen duplicates — use the control in the **active** pane (main form, dialog, or quick create).
- Do **not** invent entity deep-link URLs for in-app navigation; use sitemap, grid, Related, and command bar.
- Wait for UCI idle: grids virtualize, lookups load async, BPF/forms animate — retry after short wait rather than clicking random Fluent chrome.
- Field **logical names** (e.g. `customerid`, `primarycontactid`) in steps map to the control whose `data-id` / name contains that id.
- Shadow / nested hosts: interact with the visible UCI control the user named.
- Guided help / Mars overlays / message bars: dismiss if they block clicks.
- Power Apps embedded pages: only interact if the step targets them; otherwise stay on the model-driven shell.

## Anti-patterns
- Treating Quick Find as Global Search (or the reverse).
- Clicking the first `input` on the page instead of the labeled field.
- Assuming New/Save is missing instead of opening **More commands**.
- Selecting a lookup result before the result list finishes loading.
- Using classic CRM iframe ids when a modern UCI `data-id` control is visible.
