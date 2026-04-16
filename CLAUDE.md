# RetroVault - Claude Code Context

This file is automatically loaded by Claude Code at session start.
It preserves project context across sessions. **Keep it current** — after
substantive code/schema/Vault changes, update this file in the same turn so
the next session walks in with accurate state.

## Project

RetroVault is a team retrospective feedback application built as a **Veeva Vault Custom Page**. It was migrated from an earlier X-Pages implementation.

- **Data model**: Veeva Vault MDL (`mdl/` folder)
- **Client**: React 18 + esbuild + `@veeva/vault` npm package (`client/` folder)
- **Server**: Java `PageController` using the Vault Java SDK (`server/` folder)
- **Design**: Vault CRM Web design system tokens; CSS in `client/styles/retrovault.css`. Tokens sourced from the Vault CRM (Web) Figma file via the Figma Dev Mode MCP. Primary blue is `#1453b8`, font is Roboto 12px base.

Working branch: `insights-release-sentiment` (active). `main` is the integration branch.

Repo: `zulu-bravo/retro-vault` on GitHub.

## Branches in flight

- `main` — integration branch. Merged features so far: Vault CRM design reskin, 3-column board, retro_ object prefix, drag/drop, action assignees, card grouping, group renaming, action item refinements, dashboard open-action count, refresh button, kudos column, two-tab native Vault split (Boards / Insights).
- `kudos-board` — Kudos column. Merged into main; tweaks (column order, no gold card highlight) pushed.
- `feature-insights-tab` — Two-tab Vault split (Boards + Insights as separate native Vault tabs). Merged into main as `004232a`.
- `insights-release-sentiment` — current branch. Removes the old three-panel Insights and replaces it with a single multi-line release-sentiment chart (one line per team, X-axis = releases Z→A, Y-axis = vote-weighted Went Well share).

## Deployment status

The app is **deployed and working** on `align-veeva-productvaultcrm.veevavault.com`:

- MDL data model created
- Client distribution `Clientdistribution.retrovault__c` uploaded — now ships **two entries** (`dist/boards.js`, `dist/insights.js`) registered as two separate `Pageclientcode` bindings in `distribution-manifest.json`
- `RetroVaultPageController` packaged and deployed via the Vault Java SDK Maven plugin
- **Two Vault Pages**: `Page.retrovault__c` (Boards) and `Page.retrovault_insights__c` (Insights). Both bind to the same controller; each has its own `page_client_code` so its own JS bundle loads
- **Two Vault Tabs**: `Tab.retrovault__c` (label "Boards", order 100) and `Tab.retrovault_insights__c` (label "Insights", order 101)
- Boards URL: `https://align-veeva-productvaultcrm.veevavault.com/ui/#custom/page/retrovault`
- Insights URL: `https://align-veeva-productvaultcrm.veevavault.com/ui/#custom/page/retrovault-insights` (note the dash — `url_path_name` cannot contain underscores)

**Seed data** present on the live Vault: 3 teams (Align, Campaign Manager, Network — IDs `VLQ000000001001-003`), 15 retro boards (3 teams × 5 releases: `26R1.0` active + `25R3.5` / `25R3.4` / `25R3.2` / `25R3.0` closed), ~90 feedback items, ~45 action items, ~6 kudos on active boards. Users used as facilitators/authors: Neal Mundy (`1121601`), Zied Belkhodja (`31435884`), Fernando Pingitore (`31435872`).

## Architecture decisions (important context)

- **User references use `user__sys`** (Vault system users), not a custom user object.
- **CRM Vault SDK restriction: `user__sys` cannot be queried from the Java SDK.** Workarounds in use:
  - Display names are pulled via dotted VQL on join (`facilitator__cr.name__v`, `author__cr.name__v`, `owner__cr.name__v`, `assignee__cr.name__v`, `kudos_recipient__cr.name__v`). The `userName(row, prefix)` helper in `vault.js` reads these joined values.
  - For listing/searching users (in `UserTypeAhead`) the client calls the Vault REST `/v25.1/objects/users` directly via `vaultApiClient.fetch()` — bypasses the SDK entirely. Results are cached in `_usersCache`.
  - For the current user's name, the same REST endpoint (`/v25.1/objects/users/me`) is hit on init in `loadCurrentUserName()`.
- **Boards and Insights are two separate Vault Pages**, not inner-routed. The React app has two entry files (`boards.jsx`, `insights.jsx`) and two top-level shells (`App.jsx`, `App_Insights.jsx`). There is no NavBar component.
- **Theme field is `theme__c`** on `retro_feedback__c`. The *picklist* it references is named `ai_theme__c`. Don't confuse field name with picklist name.
- **Vote uniqueness** is enforced in application logic (PageController), not MDL.
- **Real deletes** are used for votes (no soft-delete flag).
- **`vote_count__c` is denormalized** on `retro_feedback__c` to avoid aggregation queries.
- **Client-server event contract**: 4 generic events (query, create, update, delete) with object whitelist in Java controller (`isAllowedObject` + `assertVqlWhitelisted`).
- **React uses state-based routing** within the Boards entry (no React Router); Insights is a single-view shell.
- **CSS registered via `distribution-manifest.json`** `stylesheets[]` for Shadow DOM injection (not imported in JS).
- **`sendEvent` wraps controller responses** as `{ data: <controller payload> }`. The `vault.js` client unwraps via the `unwrap()` helper.
- **PageController does not use `withQueryDescribe()`**. It parses the SELECT clause manually (no `String.split` — walk the string) and looks up each field's `ValueType` from a hardcoded map (`fieldType()` in the controller). When you add new fields to the schema, update that map if the field isn't a String.
- **All custom objects are `retro_`-prefixed** to avoid collision with CRM concepts. **Field names are not prefixed** — they're scoped by the parent object so there's no namespace conflict (e.g., `retro_board__c.team__c`, `retro_vote__c.feedback_item__c` keep their original field names).
- **Picklists return as `List<String>` from the SDK** — the controller flattens single-select picklists to a string in `readField()` so the client can compare `===` directly.
- **Date/DateTime fields require `LocalDate`/`ZonedDateTime` on `Record.setValue`** — the controller's `coerceString()` parses incoming JSON strings.

## Data Model

```
retro_team__c
  name__v (String, required)

retro_board__c
  name__v (String, required)
  facilitator__c -> user__sys (required)
  team__c -> retro_team__c (required)        ← field name unchanged after object rename
  release_tag__c (String)
  features__c (String, max_length 1500)      ← newline-separated feature list, populated on create/edit
  board_date__c (Date, required)
  status__c (Picklist: board_status__c, required)

retro_feedback__c
  name__v (String) - summary, must be unique
  retro_board__c -> retro_board__c (required)
  author__c -> user__sys (required)
  category__c (Picklist: feedback_category__c, required) ← went_well | didnt_go_well | ideas | kudos
  content__c (String, max_length 1500)
  theme__c (Picklist: ai_theme__c)           ← field is theme__c, picklist is ai_theme__c
  feature__c (String, max_length 200)
  vote_count__c (Number)
  group__c (String, max_length 50)           ← group ID for clustering related cards
  kudos_recipient__c -> user__sys            ← only set when category=kudos__c

retro_action__c
  name__v (String, required) - title, must be unique
  retro_board__c -> retro_board__c (required)
  owner__c -> user__sys                       ← creator/proposer
  assignee__c -> user__sys                    ← who's actually doing it
  status__c (Picklist: action_status__c, required)
  due_date__c (Date)
  completed_at__c (DateTime)

retro_vote__c
  name__v (String) - composite key feedbackId_voterId, must be unique
  feedback_item__c -> retro_feedback__c (required)  ← field name unchanged after rename
  voter__c -> user__sys (required)
```

## Picklists

- `feedback_category__c`: `went_well__c`, `didnt_go_well__c`, `ideas__c`, `kudos__c`
- `board_status__c`: `active__c`, `closed__c`
- `action_status__c`: `open__c` (label "Not Started"), `in_progress__c` (label "In Progress"), `done__c` (label "Done")
- `ai_theme__c`: tooling, process, communication, scope, staffing, quality, morale, other

## Vault MDL gotchas (learned the hard way)

- **`RECREATE Object` with inline `Objectfield` blocks silently drops the fields** on this CRM tenant. Returns SUCCESS but you get a shell object. **Use `ALTER Object ... add Field` instead** — that's why every object MDL file has the RECREATE shell followed by one ALTER per field.
- **Object names are renameable** via `RENAME Object X TO Y;` — non-destructive, preserves data and references. Used to rename `team__c → retro_team__c` etc.
- **No comments allowed** in MDL — neither `/* */` nor `//` work. Strip them.
- **Required attributes for `add Field`**: `active`, `required`, `list_column`. Number fields also need `min_value` and `max_value`. String fields cap at `max_length(1500)`.
- **Picklist references in fields** must be `picklist('Picklist.<name>')` with the dotted prefix.
- **`ALTER Picklist` syntax wraps the operation in parens**: `ALTER Picklist x ( add Picklistentry ... );`.
- **`url_path_name` on a Page cannot contain underscores** — use dashes (e.g., `retrovault-insights`).
- **`audit` on an Object takes a boolean** (`audit(false)`), not a string.
- **`name__v` on a custom object is a standard field** — don't try to declare it inline; just omit it.

## Build & Deploy commands

Set environment variables first:
```bash
export HOST=align-veeva-productvaultcrm.veevavault.com
export SESSION_ID=your_session_id
```

### MDL deployment
```bash
for f in mdl/*.mdl; do
    echo "Deploying $f..."
    curl -X POST -H "Authorization: $SESSION_ID" \
        -H "Content-Type: text/plain" \
        --data-binary @"$f" \
        "https://$HOST/api/mdl/execute"
done
```

### Client build + upload
```bash
cd client
npm install
npm run build         # bundles to dist/boards.js + dist/insights.js
npm run package       # creates retrovault.zip with both entries

curl -L "https://$HOST/api/v25.1/uicode/distributions" \
    -H "Authorization: $SESSION_ID" \
    -F "file=@retrovault.zip"
cd ..
```

### Java server code

Requires `server/vapil-settings.json` and `server/plugin-settings.json` (both gitignored). The vapil settings file must contain `vaultDNS` and `vaultSessionId`:

```bash
cd server
sed -i '' "s|\"vaultDNS\": \".*\"|\"vaultDNS\": \"$HOST\"|; s|\"vaultSessionId\": \".*\"|\"vaultSessionId\": \"$SESSION_ID\"|" vapil-settings.json

mvn vaultjavasdk:clean vaultjavasdk:package vaultjavasdk:deploy
cd ..
```

The `pom.xml` declares two Veeva-hosted repos:
- `https://repo.veevavault.com/maven` for `com.veeva.vault.sdk:vault-sdk` (the API jar)
- `https://veeva.github.io/vaultjavasdk-maven-plugin/maven` for the `vaultjavasdk-maven-plugin` itself

Plugin version `24.1.0` is the latest published. SDK version is `25.1.4-release11722`.

### Create the two Vault Pages
```bash
curl -L "https://$HOST/api/mdl/execute" -H "Content-Type: text/plain" -H "Authorization: $SESSION_ID" \
    -d "RECREATE Page retrovault__c (
        label('Boards'),
        active(true),
        client_distribution('Clientdistribution.retrovault__c'),
        page_client_code('Pageclientcode.retrovault__c'),
        page_controller('Pagecontroller.com.veeva.vault.custom.RetroVaultPageController'),
        url_path_name('retrovault')
    );"

curl -L "https://$HOST/api/mdl/execute" -H "Content-Type: text/plain" -H "Authorization: $SESSION_ID" \
    -d "RECREATE Page retrovault_insights__c (
        label('Insights'),
        active(true),
        client_distribution('Clientdistribution.retrovault__c'),
        page_client_code('Pageclientcode.retrovault_insights__c'),
        page_controller('Pagecontroller.com.veeva.vault.custom.RetroVaultPageController'),
        url_path_name('retrovault-insights')
    );"
```

### Create the two Tabs
```bash
curl -L "https://$HOST/api/mdl/execute" -H "Content-Type: text/plain" -H "Authorization: $SESSION_ID" \
    -d "RECREATE Tab retrovault__c (
        active(true),
        label('Boards'),
        order(100),
        page('Page.retrovault__c'),
        url('https://\${Vault.domain}/ui/#custom/page/\${Page.url_path_name}')
    );"

curl -L "https://$HOST/api/mdl/execute" -H "Content-Type: text/plain" -H "Authorization: $SESSION_ID" \
    -d "RECREATE Tab retrovault_insights__c (
        active(true),
        label('Insights'),
        order(101),
        page('Page.retrovault_insights__c'),
        url('https://\${Vault.domain}/ui/#custom/page/\${Page.url_path_name}')
    );"
```

## Key files

- `mdl/00_picklists.mdl` - All picklist definitions (deploy first). Includes the `kudos__c` value on `feedback_category__c`.
- `mdl/01_team.mdl` … `mdl/05_vote.mdl` - Object MDL files. Each is `RECREATE Object` shell + N `ALTER Object add Field` (the inline pattern doesn't work — see gotchas).
- `client/distribution-manifest.json` - Two pages registered: `retrovault__c` → `dist/boards.js`, `retrovault_insights__c` → `dist/insights.js`.
- `client/esbuild.mjs` - Builds both entries (`src/boards.jsx`, `src/insights.jsx`).
- `client/src/boards.jsx` / `client/src/insights.jsx` - Two `definePage()` entry points.
- `client/src/App.jsx` - Boards-side root (Dashboard / BoardView / CreateBoard / SeedData routing).
- `client/src/App_Insights.jsx` - Insights-side root (renders only `<Insights>`).
- `client/src/api/vault.js` - `sendEvent` wrapper, `userName(row, prefix)` helper, `searchUsers()` and `loadCurrentUserName()` via `vaultApiClient.fetch`.
- `client/src/components/UserTypeAhead.jsx` - Type-ahead user picker (used for facilitator, assignee, kudos recipient).
- `client/src/pages/BoardView.jsx` - Most complex page: 4-column layout (Kudos | Went Well | To Improve | Action Items), drag-and-drop, grouping, kudos modal variant.
- `client/src/pages/Insights.jsx` - Release Sentiment chart (multi-line SVG, vote-weighted Went Well share per team per release). Renders `<Insights>` from the `insights.jsx` entry / `App_Insights.jsx` shell on the Insights tab. The earlier Recurring Blockers / Action Item Completion / Team Sentiment panels were removed — see `insights-release-sentiment` branch.
- `client/src/pages/SeedData.jsx` - Demo data seeder.
- `server/src/main/java/com/veeva/vault/custom/RetroVaultPageController.java` - onLoad + onEvent dispatch.

## Vault Java SDK constraints (learned the hard way)

The SDK enforces a sandbox at validation time. Things the controller **cannot** do:

- **No static field initializers** (`private static final Set<String> X = ...`). Inline the values into a method or use string literal comparisons.
- **No `String.split`**. Walk the string manually.
- **Cannot construct `java.lang.*` exceptions** (`IllegalArgumentException`, `RuntimeException`, etc). Throw `com.veeva.vault.sdk.api.core.RollbackException(errorCode, message)` instead.
- **Cannot catch `java.lang.Exception`**. Catch `RollbackException` (or other SDK-specific exceptions) explicitly.
- **`PageEventContext.getData(Class<T>)` requires `T extends UserDefinedModel`**. To get raw JSON data use `context.getData()` (no-arg).
- **`VaultCollections` has no varargs `asSet`**. Use `newSet()` then `add()`.
- **`JsonObject.getProperties()`** returns `Map<String, JsonProperty>`; there is no `getFieldNames()`.
- **`JsonValueType` is a parameterized interface, not an enum** — compare instances with `==` (`type == JsonValueType.STRING`), not in a `switch`.
- **`PositionalRecordId.getRecordId()`** is the way to read created record IDs (no `getRecord()`).
- **Date and DateTime fields require `LocalDate` / `ZonedDateTime`** on `Record.setValue(...)` — not strings. The controller's `coerceString()` parses incoming JSON strings before calling `setValue`.
- **Picklist fields require `List<String>`** when written. The controller wraps single values in a list automatically. When reading, single-select picklists are flattened to scalar strings.
- **`user__sys` cannot be queried via `QueryService`** on this CRM tenant — error: "Query operation is not allowed in SDK". The client uses `vaultApiClient.fetch('/v25.1/objects/users')` instead. The controller never queries user__sys directly; user names come into the client via dotted VQL joins (`facilitator__cr.name__v`).

## Known issues / things to verify during deployment

- The `@veeva/vault` npm package version in `client/package.json` is `26.1.0-release.1.3.5` — verify this matches what the target Vault instance supports.
- VQL syntax in `client/src/api/vault.js` was originally written from docs — verify each field actually exists on the deployed object via `get_object_fields` or VQL when adding new fields.
- The PageController uses a whitelist of objects — if new objects are added to the MDL, update `isAllowedObject` AND `assertVqlWhitelisted` in `RetroVaultPageController.java`.
- `name__v` on `retro_feedback__c` and `retro_action__c` enforces uniqueness — seed/create code must generate unique names (suffix with team + release if needed).
- String fields cap at `max_length(1500)` on this Vault.

## Tools expected in the new session

- `veeva-vault` MCP server connected (for MDL execution, record queries).
- `figma-desktop` MCP server (for design system reads — Figma desktop app must be running with Dev Mode MCP enabled).
- `github` MCP server connected (for PR/issue management if needed; `gh` CLI not installed locally).
- Local node, npm, java, maven installed.
