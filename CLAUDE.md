# RetroVault - Claude Code Context

This file is automatically loaded by Claude Code at session start.
It preserves project context across sessions.

## Project

RetroVault is a team retrospective feedback application built as a **Veeva Vault Custom Page**. It was migrated from an earlier X-Pages implementation.

- **Data model**: Veeva Vault MDL (`mdl/` folder)
- **Client**: React 18 + esbuild + `@veeva/vault` npm package (`client/` folder)
- **Server**: Java `PageController` using the Vault Java SDK (`server/` folder)
- **Design**: Vault UI design system (see `client/styles/retrovault.css`)

Working branch: `main`

Repo: `zulu-bravo/retro-vault` on GitHub.

## Deployment status

The app is **deployed and working** on `align-veeva-productvaultcrm.veevavault.com`:

- MDL data model created
- Client distribution `Clientdistribution.retrovault__c` uploaded
- `RetroVaultPageController` packaged and deployed via the Vault Java SDK Maven plugin
- `Page.retrovault__c` and `Tab.retrovault__c` exist
- Accessible at `https://align-veeva-productvaultcrm.veevavault.com/ui/#custom/page/retrovault`

## Architecture decisions (important context)

- **User references use `user__sys`** (Vault system users), not a custom user object. No seeded users.
- **Team object is minimal** - just `name__v`, no squad_type picklist
- **Theme field is `theme__c`** on `feedback_item__c`. The *picklist* it references is named `ai_theme__c` — don't confuse the field API name with the picklist name. The picklist has 8 values: tooling, process, communication, scope, staffing, quality, morale, other. (The MDL file under `mdl/03_feedback_item.mdl` calls it `ai_theme__c` and is out of sync with the deployed Vault.)
- **Vote uniqueness** is enforced in application logic (PageController), not MDL
- **Real deletes** are used for votes (removed `active__c` soft-delete flag when migrating from X-Pages)
- **`vote_count__c` is denormalized** on `feedback_item__c` to avoid aggregation queries
- **Client-server event contract**: 4 generic events (query, create, update, delete) with object whitelist in Java controller
- **React uses state-based routing**, not React Router (Custom Pages are SPAs on a single URL)
- **CSS registered via `distribution-manifest.json`** `stylesheets[]` for Shadow DOM injection (not imported in JS)
- **`sendEvent` wraps controller responses** as `{ data: <controller payload> }`. The `vault.js` client unwraps via the `unwrap()` helper — don't drop it.
- **PageController does not use `withQueryDescribe()`**. It parses the SELECT clause manually and looks up each field's `ValueType` from a hardcoded map (`fieldType()` in the controller). When you add new fields to the schema, update that map.

## Data Model

```
retro_team__c
  name__v (String, required)

retro_board__c
  name__v (String, required)
  facilitator__c -> user__sys (required)
  team__c -> retro_team__c (required)    ← field name unchanged after object rename
  release_tag__c (String)
  features__c (String, max_length 1500)
  board_date__c (Date, required)
  status__c (Picklist: board_status__c, required)

retro_feedback__c
  name__v (String) - summary
  retro_board__c -> retro_board__c (required)
  author__c -> user__sys (required)
  category__c (Picklist: feedback_category__c, required)
  content__c (String, max_length 1500)
  theme__c (Picklist: ai_theme__c)      ← field is theme__c, picklist is ai_theme__c
  feature__c (String, max_length 200)
  vote_count__c (Number)

retro_action__c
  name__v (String, required) - title
  retro_board__c -> retro_board__c (required)
  owner__c -> user__sys
  status__c (Picklist: action_status__c, required)
  due_date__c (Date)
  completed_at__c (DateTime)

retro_vote__c
  name__v (String) - composite key feedbackId_voterId
  feedback_item__c -> retro_feedback__c (required)  ← field name unchanged after rename
  voter__c -> user__sys (required)
```

## Picklists

- `feedback_category__c`: went_well, didnt_go_well, ideas
- `board_status__c`: active, closed
- `action_status__c`: open, in_progress, done
- `ai_theme__c`: tooling, process, communication, scope, staffing, quality, morale, other

## Build & Deploy commands

Set environment variables first:
```bash
export HOST=yourvault.veevavault.com
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
npm run build         # bundles to dist/
npm run package       # creates retrovault.zip

curl -L "https://$HOST/api/v25.1/uicode/distributions" \
    -H "Authorization: $SESSION_ID" \
    -F "file=@retrovault.zip"
cd ..
```

### Java server code

Requires `server/vapil-settings.json` and `server/plugin-settings.json` (both gitignored). The vapil settings file must contain `vaultDNS` and `vaultSessionId` — populate from your env vars before running:

```bash
cd server
# (one-time, or whenever SESSION_ID changes — both files are gitignored)
sed -i '' "s|\"vaultDNS\": \".*\"|\"vaultDNS\": \"$HOST\"|; s|\"vaultSessionId\": \".*\"|\"vaultSessionId\": \"$SESSION_ID\"|" vapil-settings.json

mvn vaultjavasdk:clean vaultjavasdk:package vaultjavasdk:deploy
cd ..
```

The `pom.xml` declares two Veeva-hosted repos:
- `https://repo.veevavault.com/maven` for `com.veeva.vault.sdk:vault-sdk` (the API jar)
- `https://veeva.github.io/vaultjavasdk-maven-plugin/maven` for the `vaultjavasdk-maven-plugin` itself

Plugin version `24.1.0` is the latest published. SDK version is `25.1.4-release11722`.

### Create Page component
```bash
curl -L "https://$HOST/api/mdl/execute" \
    -H "Content-Type: text/plain" \
    -H "Authorization: $SESSION_ID" \
    -d "RECREATE Page retrovault__c (
        label('RetroVault'),
        active(true),
        client_distribution('Clientdistribution.retrovault__c'),
        page_client_code('Pageclientcode.retrovault__c'),
        page_controller('Pagecontroller.com.veeva.vault.custom.RetroVaultPageController'),
        url_path_name('retrovault')
    );"
```

### Create Tab
```bash
curl -L "https://$HOST/api/mdl/execute" \
    -H "Content-Type: text/plain" \
    -H "Authorization: $SESSION_ID" \
    -d "RECREATE Tab retrovault__c (
        active(true),
        label('RetroVault'),
        order(100),
        page('Page.retrovault__c'),
        url('https://\${Vault.domain}/ui/#custom/page/\${Page.url_path_name}')
    );"
```

### Access the page
`https://$HOST/ui/#custom/page/retrovault`

## Key files

- `mdl/00_picklists.mdl` - All picklist definitions (deploy first)
- `mdl/05_vote.mdl` - Vote object (no active__c since we use real deletes)
- `client/src/index.jsx` - `definePage()` entry point
- `client/src/App.jsx` - State-based router
- `client/src/api/vault.js` - `sendEvent` wrapper with query/create/update/deleteRecord helpers
- `client/src/pages/BoardView.jsx` - Most complex page (feedback columns, voting, action items)
- `client/src/pages/SeedData.jsx` - Demo data seeder (replaces old seed/seed-data.html)
- `client/distribution-manifest.json` - Custom Page manifest with stylesheet registration
- `server/src/main/java/com/veeva/vault/custom/RetroVaultPageController.java` - onLoad + onEvent dispatch

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
- **Picklist fields require `List<String>`**, not a single string. The controller wraps single values in a list automatically.

## Known issues / things to verify during deployment

- The `@veeva/vault` npm package version in `client/package.json` is `26.1.0-release.1.3.5` - verify this matches what your Vault instance supports
- VQL syntax in `client/src/api/vault.js` was written from docs - verify each field actually exists on the deployed object via `get_object_fields` or VQL
- The PageController uses a whitelist of objects - if new objects are added to the MDL, update `isAllowedObject` AND `assertVqlWhitelisted` in `RetroVaultPageController.java`
- `mdl/03_feedback_item.mdl` calls the theme field `ai_theme__c` but the deployed Vault has it as `theme__c`. The MDL is out of sync with production.

## Tools expected in the new session

- `veeva-vault` MCP server connected (for MDL execution, record queries, etc.)
- `github` MCP server connected (for PR/issue management if needed)
- Local node, npm, java, maven installed
