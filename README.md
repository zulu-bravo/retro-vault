# RetroVault

A team retrospective feedback application built as a **Veeva Vault Custom Page**, using React on the client and a Java `PageController` on the server.

## Features

- **Dashboard** - Retro boards grouped by team
- **Board View** - Three feedback columns (Went Well, Didn't Go Well, Ideas) with voting and action items
- **Insights** - Recurring blockers, action completion rates, and team sentiment analytics
- **Manual Theme Tagging** - Categorize feedback with themes (tooling, process, communication, scope, staffing, quality, morale, other)
- **Seed Demo Data** - One-click population of sample data

## Technology

| Layer | Technology |
|-------|-----------|
| Data Model | Veeva Vault MDL |
| Client | React 18 + esbuild + `@veeva/vault` npm package |
| Server | Java `PageController` with Vault Java SDK |
| Delivery | ZIP distribution uploaded via Vault API |
| Users | Built-in `user__sys` Vault system users |

## Project Structure

```
retro-vault/
├── mdl/                                    # Vault object & picklist definitions
│   ├── 00_picklists.mdl
│   ├── 01_team.mdl
│   ├── 02_retro_board.mdl
│   ├── 03_feedback_item.mdl
│   ├── 04_action_item.mdl
│   └── 05_vote.mdl
├── client/                                 # React client code
│   ├── package.json
│   ├── esbuild.mjs                         # Bundler config
│   ├── package.mjs                         # ZIP packaging script
│   ├── distribution-manifest.json          # Custom Page manifest
│   ├── styles/
│   │   └── retrovault.css                  # Vault UI theme
│   └── src/
│       ├── index.jsx                       # definePage entry
│       ├── App.jsx                         # Router
│       ├── api/
│       │   └── vault.js                    # sendEvent wrapper (query/create/update/delete)
│       ├── components/                     # NavBar, Modal, Badge, Toast, Spinner
│       ├── pages/                          # Dashboard, BoardView, Insights, CreateBoard, SeedData
│       └── utils/
│           └── format.js                   # Date helpers
└── server/                                 # Java PageController
    ├── pom.xml
    └── src/main/java/com/veeva/vault/custom/
        └── RetroVaultPageController.java
```

## Architecture

### Client ↔ Server event contract

All data access from the React client goes through the PageController via four generic events:

| Event | Payload | Response |
|---|---|---|
| `query` | `{ vql: "SELECT id, name__v FROM team__c" }` | `{ success, records: [...] }` |
| `create` | `{ object: "feedback_item__c", fields: {...} }` | `{ success, id }` |
| `update` | `{ object: "vote__c", id, fields: {...} }` | `{ success, id }` |
| `delete` | `{ object: "vote__c", id }` | `{ success }` |

The `PageController.onLoad()` also returns the current `userId` so the client knows who is logged in.

A whitelist in the controller restricts which objects can be accessed.

## Data Model

- **`team__c`** - Team name
- **`retro_board__c`** - Board with facilitator (user__sys), team, date, status
- **`feedback_item__c`** - Feedback with category, content, theme picklist, vote count
- **`action_item__c`** - Action with owner (user__sys), status, due date
- **`vote__c`** - Real-deletable votes (one per user per feedback item)

## Deployment

### 1. Deploy MDL (in order)

```bash
for f in mdl/*.mdl; do
    curl -X POST -H "Authorization: $SESSION_ID" \
        -H "Content-Type: text/plain" \
        --data-binary @"$f" \
        https://$HOST/api/mdl/execute
done
```

### 2. Deploy Java server code

```bash
cd server
mvn vaultjavasdk:clean vaultjavasdk:package vaultjavasdk:deploy
```

### 3. Build and deploy client code

```bash
cd client
npm install
npm run build              # bundles to dist/
npm run package            # creates retrovault.zip

# Upload the distribution
curl -L https://$HOST/api/v25.1/uicode/distributions \
    -H "Authorization: $SESSION_ID" \
    -F "file=@retrovault.zip"
```

### 4. Create the Page component

```bash
curl -L https://$HOST/api/mdl/execute \
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

### 5. Create a tab (optional)

```bash
curl -L https://$HOST/api/mdl/execute \
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

### 6. Grant permissions

In **Admin > Users & Groups > Permission Sets**, grant the **View** permission on the RetroVault page to the desired permission sets.

### 7. Access the page

Navigate to `https://$HOST/ui/#custom/page/retrovault` or click the **RetroVault** tab in the Vault navigation bar.

### 8. Seed demo data

From the dashboard, click **Seed Demo Data** to populate 3 teams, 4 boards, 24 feedback items, 10 action items, and ~80 votes.

## Development

```bash
cd client
npm install
npm run build          # Rebuild after changes
npm run package        # Repackage as ZIP for upload
```

Source maps are included to make debugging easier in the browser devtools.
