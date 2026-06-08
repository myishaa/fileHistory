# Report Rules

This file explains the main report rules in simple language. These rules are the business logic of the app. Later, when a database/backend is added, these same rules can be converted into backend queries.

## General Rules

- A file can belong to one division.
- The Reports page can show all accessible divisions or one selected division.
- When a division is selected, reports should only use files from that division.
- If "All accessible divisions" is selected, reports should use all files the active user can access.
- Supply order data can come from multiple S.O. rows.
- Older files may still have single S.O. fields directly on the file. The app converts those older fields into one S.O. row for reporting.
- Cancelled S.O. rows should not be counted as active delivery rows.

## Date Rules

- Dates are stored as `yyyy-mm-dd`.
- "Today" means the current local date.
- A date before today is expired/overdue.
- A date equal to today is due today.
- A date after today is upcoming/valid.
- If Revised DP is filled, Revised DP is used as the delivery due date.
- If Revised DP is not filled, original DP date is used as the delivery due date.

## Delivery Status Rules

Delivery status is used by Status, Search, and delivery-related filters.

### Delivery Status

- Delivery is considered delivered when `materialReceiptDate` is filled.
- Delivery is considered pending when `materialReceiptDate` is empty.
- A pending delivery is overdue when the delivery due date is before today.
- A pending delivery is due today when the delivery due date is today.
- A pending delivery is upcoming when the delivery due date is after today.
- A delivered row is late when `materialReceiptDate` is after the delivery due date.
- A delivered row is on time when `materialReceiptDate` is equal to or before the delivery due date.

### Delivery Buttons

The Status page has delivery buttons:

- Overdue
- Delivered
- Pending

Clicking a delivery button opens the Search Files page with that category already filtered.

### Delivery Table Columns

The delivery table shows:

- File No.
- File
- Division
- Indentor
- Firm
- S.O. No.
- DP date
- Material receipt date
- Status
- Timing
- Days

### Delivery Days Text

- If pending and overdue, show how many days overdue.
- If pending and due today, show "Due today".
- If pending and upcoming, show how many days remaining.
- If delivered late, show how many days late.
- If delivered early, show how many days early.
- If delivered exactly on the due date, show "On due date".
- If DP date is missing or invalid, show "DP date missing".

## Status Summary Report

Status Summary is the original report view.

It counts files across milestones such as:

- Scrutiny
- High Value
- Pre-TCEC
- AD
- R&QA
- Controlling
- IFA
- CFA
- Bidding
- Post-TCEC
- CNC
- Supply Order
- Delivery Period
- Bank Guarantee
- Delivery
- Payment

### Common Milestone Logic

- A milestone is completed when its completion date/field is filled.
- A milestone is in process when the file is currently at that milestone.
- A milestone is pending when the file is currently at that milestone but the required review/completion field is not filled.
- Some milestones apply only when their Yes/No flag is set to Yes.
- A file is eligible for a milestone only after the previous applicable milestone is complete.

### Supply Order Rules

- Supply Order is placed when S.O. date is filled.
- A live supply order is one with S.O. date filled, material receipt date empty, and S.O. not cancelled.

### Delivery Period Rules

- Delivery Period is valid when original DP date is after today, Revised DP is empty, and material receipt date is empty.
- Delivery Period is expired when DP/Revised DP date is before today and material receipt date is empty.
- Delivery Period is extended when Revised DP is filled, Revised DP is after today, and material receipt date is empty.

### Bank Guarantee Rules

- Bank Guarantee applies when BG is Yes.
- BG is received when BG validity date is filled.
- BG is pending when BG applies and BG validity date is not filled.

### Bidding Rules

- Bidding is live when tender live is Yes.
- Bid opening is overdue when bid is not opened and bid opening date/refloat bid opening date is before today.
- Bidding is completed when bidding stage over is Yes.

### Payment Rules

- Payment is completed when payment date is filled.
- Payment is pending when the file has reached payment stage but payment date is not filled.

## Expected Cash Outgo Monthly

- Expected Cash Outgo is shown under Reports.
- Each active S.O. row contributes separately.
- Cancelled S.O. rows are ignored.
- The value comes from S.O. value Capital and S.O. value Revenue.
- The base date is `materialReceiptDate` if it is filled.
- If `materialReceiptDate` is empty, the base date is `dpDate`.
- The expected cash outgo date is base date plus 10 days.
- The report groups rows by the month of the expected cash outgo date.
- The report shows monthly Capital, Revenue, and Total.
- PDF and Excel export should use the same monthly rows.

## Analytics Rules

- The first analytics panels show overall division-level rankings based on the current dashboard division selection.
- From "Top 20 firms by S.O. value" onward, Analytics has a separate Division filter.
- If the Analytics Division filter is set to All divisions, those panels use the current dashboard file set.
- If a specific division is selected in the Analytics Division filter, those panels use files from that selected division.
- The Analytics Division filter affects panels like top firms, top indentors, milestone clearing, monthly inflow, bidding mode mix, file value thresholds, risk load, and payment pending.

## Current Code Structure

The important report rules are already mostly kept in helper functions instead of being written directly inside JSX.

Examples in `src/routes/reports.tsx`:

- `getDeliveryPeriodDate`
- `isDeliveryCompleted`
- `isDeliveryDue`
- `isDeliveryPeriodValid`
- `isDeliveryPeriodExpired`
- `isDeliveryPeriodExtended`
- `isSupplyOrderPlaced`
- `fileSupplyOrders`

This is good because the UI displays the result, while helper functions calculate the rules.

## Important Future Cleanup

Some similar rules also exist in Dashboard and Search files. Before connecting a large database/backend, shared business rules should be moved into common files, for example:

- `src/lib/report-rules.ts`
- `src/lib/delivery-rules.ts`
- `src/lib/milestone-rules.ts`

That way Dashboard, Search, Reports, and the future backend can all follow the same rule definitions.

## Backend Migration Notes

When a database is added:

- The meaning of the rules should stay the same.
- Heavy filtering, grouping, sorting, counting, and pagination should move to backend/database queries.
- The frontend should request data like "give me overdue deliveries" instead of loading all files and filtering in the browser.
- PDF/Excel export for very large data should eventually be generated by the backend.
- The frontend can still keep display helpers for labels, badges, selected boxes, and table layout.
