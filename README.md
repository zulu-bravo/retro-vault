# RetroVault

A team retrospective feedback application built on **Veeva Vault CRM** using MDL for data modeling and X-Pages for the UI.

## Features

- **Dashboard** - Retro boards grouped by team
- **Board View** - Three feedback columns (Went Well, Didn't Go Well, Ideas) with voting and action items
- **Insights** - Recurring blockers, action completion rates, and team sentiment analytics
- **Manual Theme Tagging** - Categorize feedback with themes (tooling, process, communication, scope, staffing, quality, morale, other)
- **User Switching** - Select active Vault user via dropdown

## Technology

| Layer | Technology |
|-------|-----------|
| Data Model | Veeva Vault MDL (Metadata Definition Language) |
| UI | X-Pages with DataService JavaScript library |
| Design | Vault UI design system patterns |
| Users | Built-in `user__sys` Vault system users |

## Project Structure

```
retro-vault/
├── mdl/                        # Vault object & picklist definitions
│   ├── 00_picklists.mdl        # 4 picklists (deploy first)
│   ├── 01_team.mdl
│   ├── 02_retro_board.mdl
│   ├── 03_feedback_item.mdl
│   ├── 04_action_item.mdl
│   └── 05_vote.mdl
├── xpages/                     # X-Pages UI
│   ├── index.html              # Dashboard
│   ├── board.html              # Board view
│   ├── insights.html           # Analytics
│   ├── create-board.html       # New board form
│   ├── css/vault-theme.css     # Vault UI theme
│   └── js/                     # Page logic
│       ├── data-service.js     # DataService wrapper
│       ├── app.js              # Shared state & utilities
│       ├── components.js       # Reusable UI components
│       ├── dashboard.js
│       ├── board.js
│       ├── insights.js
│       └── create-board.js
└── seed/
    └── seed-data.html          # Seed data page
```

## Deployment

### 1. Deploy MDL (in order)

Execute each MDL file via the Vault API MDL endpoint in numbered order:

```
POST https://myvault.veevavault.com/api/mdl/execute
```

### 2. Deploy X-Pages

Upload the `xpages/` folder contents as X-Pages custom report packages in Vault CRM.

### 3. Seed Data

Open `seed/seed-data.html` and click **Run Seed** to populate test data (3 teams, 4 boards, 24 feedback items, 10 action items, and votes).

## Data Model

- **team__c** - Team name
- **retro_board__c** - Board with facilitator (user__sys), team, date, status
- **feedback_item__c** - Feedback with category, content, theme, vote count
- **action_item__c** - Action with owner (user__sys), status, due date
- **vote__c** - Soft-deletable votes (one per user per feedback item)
