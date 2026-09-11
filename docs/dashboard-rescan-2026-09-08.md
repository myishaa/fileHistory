# Dashboard rescan - 8 September 2026

Scope: Status-1, Status-2, Status-3, Status-4, Finance, Snapshot, and Analytics, including shared Search filtering and Add/Edit focus handling.

This is a review of the current working tree, including existing uncommitted changes. Application code and business rules were not changed during this review.

## Findings

### 1. [P1] Finance calculations can use a different FY from the displayed label

- Evidence: `backend/src/routes/dashboard.ts:8130` reads the request's selected year, but the `buildDashboardSummary` call around line 8216 passes `settings: { ...settings, valueThresholdLevels }` without overriding `selectedYear`.
- `backend/src/utils/dashboard-summary.ts:364` passes `settings.selectedYear` to `getFinanceTotals`. The frontend derives its Finance labels from the session selection at `src/routes/index.tsx:1609`.
- Scenario: the session selects 2025-26 while the stored settings resolve to 2026-27. The page can say Payment in 2025-26 while payment amounts and carry-forward calculations use 2026-27. Division allocation and payment calculations can therefore use different years in the same response.
- Correction: pass the resolved request year into the summary settings. Test two sessions with different FY selections and verify payment totals, carry-forward filters, labels, and exports together.

### 2. [P2] Analytics Capital/Revenue value-band clicks lose the clicked category

- Evidence: `src/routes/index.tsx:8745` routes count, capitalCount, revenueCount, capital, revenue, and contribution cells to the same value-band filter.
- `backend/src/routes/files.ts:5809` and the corresponding S.O. threshold helper match the band without receiving the clicked metric.
- Scenario: one Capital file and one Revenue file share a Both band. Capital count displays 1, but its target is identical to the Revenue count target and can return both files. The same issue applies to individual S.O. bands.
- Reproduced by calling the current `getAnalyticsSearchTarget` function: capitalCount and revenueCount produce identical targets.
- Correction: carry the clicked category into Search and apply it to the same file/S.O. entry that matched the band. Keep the existing band classification rule.

### 3. [P2] Bidding Mode and Division Turnaround landings can include cancelled files omitted from their counters

- Evidence: `backend/src/utils/dashboard-summary.ts:335` removes demand-cancelled and all-S.O.-cancelled files before ordinary Analytics is built. `backend/src/routes/files.ts:6000` classifies `mode:` and `divisionTurnaroundSample` as inactive-history filters.
- Search's cancellation gates around lines 6074 and 7160 consequently permit those cancelled files for these targets. The target predicates themselves only check mode or the turnaround dates.
- Scenario: under All Files with matching File Year/date/category filters, a live file and an all-S.O.-cancelled file share OBM. The counter uses only the live file, but the landing can return both. Turnaround has the same discrepancy when the cancelled file has valid initiation and S.O. dates.
- Correction: preserve the selected global context while making landing cancellation eligibility match the corresponding counter. Preserving closed-file history does not require including files the counter excludes.

### 4. [P2] Snapshot No counters include blanks but their Search landings exclude them

- Evidence: `backend/src/utils/dashboard-summary.ts:711` counts `!isSnapshotAttributeYes(...)`. `backend/src/routes/files.ts:6194` routes No to `isNoSql`, defined at line 1738 as explicit equality with `no`.
- Scenario: one blank TCEC flag and one explicit No produce a Snapshot No count of 2, while Search's predicate only admits the explicit No.
- Reproduced using the current summary function and SQL generator. The PSB attribute has its own complementary SQL and is not affected by this specific issue.
- Correction: make the landing use the counter's existing complementary Yes/No semantics. Avoid changing the shared `isNoSql` globally, since other filters may intentionally mean explicit No.

### 5. [P2] Status-2 Bidding landing omits bidding applicability

- Evidence: `backend/src/utils/dashboard-summary.ts:1259` applies `isBiddingApplicableForFile` and normalizes the current milestone. `backend/src/routes/files.ts:6602` falls through to exact `current_milestone = 'Bidding'` without that applicability test.
- Scenario: an LPC file retains Bidding as its current milestone after a mode change. Status-2 excludes it, but the Bidding landing admits it. CARS, CAPSI, and GeM Comparison can expose the same discrepancy if they retain that milestone.
- Reproduced with an LPC fixture: the current counter helper returns 0; the generated landing SQL checks only cancellation and the milestone text.
- Correction: use the same bidding eligibility and milestone normalization for both paths. Do not broaden the counter's business rule.

### 6. [P2] Old results remain clickable under newly selected filters

- Evidence: `src/routes/index.tsx:1135` retains old Status-3 groups when starting a new query. At line 5829 the table remains rendered while loading whenever groups already exist. Click handlers and export descriptions use the new filter state.
- Delay Status and Pre-Bid requests around lines 1178-1205 likewise retain unkeyed previous responses while the new request runs; the Delay Status target uses the current Days value.
- Scenario: change division or initiation dates in Status-3 and click before the response arrives. The visible old count opens Search with the new filters. Changing Delay Status from 5 to 30 days has the same risk. An export can also combine old data with new filter labels.
- Correction: associate responses with their query or disable stale results and exports until the matching response arrives. Show loading/errors explicitly for the affected Analytics panels.

### 7. [P2] Status-4 Cleared and Applicable S.O. clicks use current-stage focus

- Evidence: `src/routes/search.tsx:8120` parses the milestone but ignores the Status-4 metric and always generates `:current` for order-driven milestones.
- Scenario: clicking Cleared Supply Order or Financial Sanction returns the correct file but asks Add/Edit to focus a current/pending order rather than the completed order. Applicable clicks also use current-stage focus.
- Reproduced: `status4:Supply%20Order:cleared:2026-27:all::` produces `supplyorder:current`.
- Correction: map applicable, cleared, and current to matching focus states and verify with a file containing both completed and pending orders.

### 8. [P2] Status-1 supplementary return-history focus only matches outstanding returns

- Evidence: `src/routes/search.tsx:8090` maps both `supplementaryBill:any` and `supplementaryBill:returned` to `supplementarybill:returned`.
- `src/routes/add.tsx:7370` distinguishes `anyreturned` from `returned`; the latter requires an open return and no payment date.
- Scenario: a supplementary bill was returned, resubmitted, and paid. It belongs in the return-history counter and landing, but the requested focus cannot match that bill. A file with multiple supplementary bills can focus the wrong outstanding return instead.
- Reproduced the target mapping with the current Search helper; inspected the Add/Edit predicate to confirm the difference.
- Correction: use the existing `anyreturned` focus for historical return clicks and retain `returned` for pending return clicks.

## Coverage and limits

| Area | Paths reviewed | Findings |
| --- | --- | --- |
| Status-1 | Shared summary/clicker routes, payment and supplementary return targets | 8 |
| Status-2 | Live milestone counting, division landing, global subfilters | 5 |
| Status-3 | Report query, summary mapping, Search dispatch, exports/loading | 6 |
| Status-4 | Source-file filtering, FY/value drill, metrics and focus | 7 |
| Finance | Request FY, accounting file scope, payment and supplementary liability entries, carry-forward | 1 |
| Snapshot | Attribute, mode, file-type and firm-type summary/landing paths | 3, 4 |
| Analytics | Panel requests, value-band targets, history gates, meeting summaries and loading | 2, 3, 6 |

- Division, File Year, initiation From/To, and File Category are present in the main Dashboard and Status-3 requests and in the shared landing builders inspected. Parameter propagation alone does not resolve the eligibility differences above.
- Isolated checks executed functions extracted from the current TypeScript source. SQL checks inspected the actual generated predicates; they did not execute against PostgreSQL.
- The local backend did not respond at `127.0.0.1:3000`. No live database counter comparison or browser click/focus test was completed in this review.
- No application build was needed or run because application code was unchanged. These findings are not a certification that all other counters are bug-free.
- Existing decisions about shortclosed orders, cancelled-order financial treatment, and keeping supplementary payment separate from the main Payment Completed counter were preserved.
