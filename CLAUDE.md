# RetroVault - Claude Code Context

This file is automatically loaded by Claude Code at session start.
It preserves project context across sessions.

## Project

RetroVault is a team retrospective feedback application built as a **Veeva Vault Custom Page**. It was migrated from an earlier X-Pages implementation.

- **Data model**: Veeva Vault MDL (`mdl/` folder)
- **Client**: React 18 + esbuild + `@veeva/vault` npm package (`client/` folder)
- **Server**: Java `PageController` using the Vault Java SDK (`server/` folder)
- **Design**: Vault UI design system (see `client/styles/retrovault.css`)

Working branch: `claude/migrate-veeva-vault-o8ptR`

Repo: `zulu-bravo/retro-vault` on GitHub.

## What's done

All code is written and committed:

- `mdl/` - 6 MDL files (1 picklists + 5 objects). Deploy in numbered order.
- `client/` - React SPA with Dashboard, BoardView, Insights, CreateBoard, and SeedData pages
- `server/` - Java `RetroVaultPageController` with `onLoad` (returns userId) and `onEvent` (dispatches query/create/update/delete with an object whitelist)
- `README.md` - Full deployment instructions

## What needs to happen next

Deploy to a Vault instance:

1. Deploy MDL files in numbered order (picklists first, then objects in dependency order)
2. Build and upload the client distribution ZIP
3. Deploy the Java server code via Maven
4. Create the `Page` and `Tab` components via MDL
5. Grant view permissions
6. Access the page and click "Seed Demo Data" to populate

## Architecture decisions (important context)

- **User references use `user__sys`** (Vault system users), not a custom user object. No seeded users.
- **Team object is minimal** - just `name__v`, no squad_type picklist
- **ai_theme__c is a picklist**, not free-text. 8 values: tooling, process, communication, scope, staffing, quality, morale, other
- **Vote uniqueness** is enforced in application logic (PageController), not MDL
- **Real deletes** are used for votes (removed `active__c` soft-delete flag when migrating from X-Pages)
- **`vote_count__c` is denormalized** on `feedback_item__c` to avoid aggregation queries
- **Client-server event contract**: 4 generic events (query, create, update, delete) with object whitelist in Java controller
- **React uses state-based routing**, not React Router (Custom Pages are SPAs on a single URL)
- **CSS registered via `distribution-manifest.json`** `stylesheets[]` for Shadow DOM injection (not imported in JS)

## Data Model

```
team__c
  name__v (String, required)

retro_board__c
  name__v (String, required)
  facilitator__c -> user__sys (required)
  team__c -> team__c (required)
  release_tag__c (String)
  board_date__c (Date, required)
  status__c (Picklist: board_status__c, required)

feedback_item__c
  name__v (String) - summary
  retro_board__c -> retro_board__c (required)
  author__c -> user__sys (required)
  category__c (Picklist: feedback_category__c, required)
  content__c (String, required)
  ai_theme__c (Picklist: ai_theme__c)
  vote_count__c (Number)

action_item__c
  name__v (String, required) - title
  retro_board__c -> retro_board__c (required)
  owner__c -> user__sys
  status__c (Picklist: action_status__c, required)
  due_date__c (Date)
  completed_at__c (DateTime)

vote__c
  name__v (String) - composite key feedbackId_voterId
  feedback_item__c -> feedback_item__c (required)
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
```bash
cd server
mvn vaultjavasdk:clean vaultjavasdk:package vaultjavasdk:deploy
cd ..
```

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

## Known issues / things to verify during deployment

- The `@veeva/vault` npm package version in `client/package.json` is `26.1.0-release.1.3.5` - verify this matches what your Vault instance supports
- The Vault SDK version in `server/pom.xml` is `25.1.0` - may need to match your tenant version
- VQL syntax in `client/src/api/vault.js` was written from docs - may need tweaks based on actual object API names in your Vault
- The `user__sys` query in `fetchUsers()` filters by `status__v = 'active__v'` - verify this field name in your Vault
- The PageController uses a whitelist of objects - if new objects are added to the MDL, update `ALLOWED_OBJECTS` in `RetroVaultPageController.java`

## Tools expected in the new session

- `veeva-vault` MCP server connected (for MDL execution, record queries, etc.)
- `github` MCP server connected (for PR/issue management if needed)
- Local node, npm, java, maven installed
