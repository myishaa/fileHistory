# FileHistory Record Keeper

A local browser-based office file record management app built with React, TanStack Router/Start, Vite, and Tailwind CSS.

The app is designed for tracking physical office files across divisions, with add/edit workflows, detailed search filters, division settings, financial year settings, and locally saved records.

## Run The App

Install dependencies:

```bash
npm install
```

Start development server:

```bash
npm run dev
```

Build:

```bash
npm run build
```

Note: the build may show a Wrangler permission warning about writing logs to `~/Library/Preferences/.wrangler`. The app build still succeeds when the command exits with code `0`.

## Data Storage

Data is saved in PostgreSQL through the Express backend in [backend](backend).

Before deploying, run every SQL file in [database](database) against the production database in
number order. The seed migration creates an initial admin account only when it does not already
exist.

Initial admin login after a fresh seed:

- Username: `ovais`
- Password: `ovais123`

Change this password immediately after the first production login, or create a new admin and remove
the seed account after confirming the new login works.

## Deployment Notes

Backend production environment:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
FRONTEND_ORIGIN=https://your-frontend-domain.example
SESSION_COOKIE_SAMESITE=lax
```

Use `SESSION_COOKIE_SAMESITE=none` only when the frontend and backend are deployed on different
sites and both are served over HTTPS.

Frontend production environment:

```env
VITE_API_BASE_URL=https://your-backend-domain.example
```

Production checklist:

- Change the seeded admin password before real use.
- Keep at least one active admin user; the backend blocks deleting or downgrading the last one.
- Enable scheduled PostgreSQL backups with the database provider.
- Lock `FRONTEND_ORIGIN` to the real frontend domain, plus any deliberate staging domain.

## Main Screens

### Dashboard

File: [src/routes/index.tsx](src/routes/index.tsx)

Shows overall record statistics, recent files, incomplete files, and division-wise summaries.

### Add File / Edit File

File: [src/routes/add.tsx](src/routes/add.tsx)

Used for both:

- adding a new file
- editing an existing file from Search using `/add?fileId=...`

Important behavior:

- All file fields are optional.
- Existing filled values are locked when editing.
- Each block has an unlock button so filled values can be edited block-by-block.
- Empty fields remain editable.
- Delete file is available only while editing and requires the deletion password.
- Year is locked from Settings.
- Unique code is auto-generated for new files.

### Search Files

File: [src/routes/search.tsx](src/routes/search.tsx)

Search supports:

- free text search
- year with typeable suggestions
- division with typeable suggestions
- IMMS
- indentor
- value range
- description
- firm
- high value, AD, R&QA, refloat, CNC, TCEC, tender live, DP extension
- S.O. number
- GeM S.O. number
- D.P. date period
- free date search

Clicking a search result opens that file in the Add/Edit page.

Search results show:

- IMMS
- Division
- Indentor
- Description
- Value
- Current status
- S.O. date
- D.P. date
- Remark-1
- Remark-2

The Search results table is horizontally scrollable inside its card when needed.

### Settings

File: [src/routes/settings.tsx](src/routes/settings.tsx)

Settings contains:

- Divisions management
- Financial year
- Theme mode
- Theme color tint
- Deletion password
- Date format and locale display fields

Divisions can be added/edited/deleted with:

- division name
- division code
- allocated capital
- allocated revenue

Deleting a division requires the deletion password.

## Important App Logic

### Unique Code Generation

Implemented in [src/routes/add.tsx](src/routes/add.tsx).

New files auto-generate unique code in this format:

```text
YY + DivisionCode + 3-digit serial
```

Example:

```text
2617001
```

Meaning:

- `26`: financial year `2026`
- `17`: division code
- `001`: first saved file for that division and year prefix

The serial number is calculated from existing saved files with the same prefix.

### Value Handling

In Add/Edit File:

- Value has Capital/Revenue checkboxes.
- Only one can be selected at a time.
- The value input accepts numbers and decimal points only.
- S.O. value mirrors the main Capital/Revenue selection.
- S.O. value also accepts numbers and decimal points only.

Saved fields remain:

- `valueCapital`
- `valueRevenue`
- `soValueCapital`
- `soValueRevenue`

### TCEC Rules

When `TCEC = No`:

- TCEC-related fields are disabled and cleared.
- High value related fields are disabled.
- AD is forced to `No`.
- AD-related fields are disabled.
- CNC-related fields are disabled.
- Pre-TCEC, Post-TCEC, and Refloat Post-TCEC fields are disabled.

When `TCEC = No` and Mode is not `PBM`:

- IFA fields are disabled and cleared.

### Delete Password

Implemented in [src/lib/delete-password.ts](src/lib/delete-password.ts).

The deletion password is saved in Settings and is required before deleting:

- a file
- a division

Important: this is not strong security because it is stored in browser localStorage. It protects against accidental deletion in this local app, but a real backend should handle authentication and permissions later.

### Theme System

Theme settings are stored in `ofms.settings.v1`.

Supported modes:

- White theme
- Dark theme

Supported color tints:

- Plain white / black
- Yellow tinted
- Green tinted
- Blue tinted
- Pink tinted
- Lavender tinted

Theme classes are applied in [src/routes/__root.tsx](src/routes/__root.tsx), and CSS variables are defined in [src/styles.css](src/styles.css).

## Key Files

- [src/lib/files-store.ts](src/lib/files-store.ts): localStorage store, data types, settings, divisions, files
- [src/lib/delete-password.ts](src/lib/delete-password.ts): delete password prompt helper
- [src/routes/add.tsx](src/routes/add.tsx): add/edit file form and business rules
- [src/routes/search.tsx](src/routes/search.tsx): filters, result table, search logic
- [src/routes/settings.tsx](src/routes/settings.tsx): divisions and app settings
- [src/components/top-bar.tsx](src/components/top-bar.tsx): top navigation and theme toggle
- [src/styles.css](src/styles.css): theme tokens and global styles

## Future Database Plan

The current app can later be connected to a backend database.

Likely migration path:

1. Keep the same `FileRecord`, `Division`, and `AppSettings` shapes.
2. Replace localStorage functions in `files-store.ts` with API calls.
3. Store files/divisions/settings in SQL tables.
4. Move deletion password/authentication to the backend.
5. Add barcode scanning by searching `uniqueCode`.

## Barcode Plan

The unique code should be used as the barcode value.

Example barcode value:

```text
2617001
```

When scanned, a scanner usually types that code into an input. The app can then find the file where:

```text
file.uniqueCode === scannedCode
```

and open:

```text
/add?fileId=<matching-file-id>
```
