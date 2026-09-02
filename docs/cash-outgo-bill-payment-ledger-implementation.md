# Cash Outgo Bill and Payment Ledger Implementation Report

## 1. Problem Statement

The current software handles simple payment cases well:

- One standalone S.O. has one bill preparation date, one bill sent date, one payment date, and one actual payment amount.
- One staged S.O. can hold payment fields on each stage when stage payment is enabled.
- Advance payment is stored as a separate nested object under the S.O.
- Returned bills are tracked as return/resubmission cycles inside the same payment row.

The difficult real-world cases are more flexible than this model:

- One bill may cover multiple stages.
- One bill may cover a previous unpaid stage and the current stage together.
- One bill may clear an amount that was partially paid earlier.
- One bill may be only GST, balance amount, penalty correction, or wrong deduction recovery.
- The number of bills may exceed the number of stages.
- These cases can happen in staged S.O.s and also in standalone S.O.s.
- A shortclosed S.O. may still have a bill under process or a valid payment due.

The current stage-centric model cannot represent these cases without forcing false data into stage rows. The software needs a bill/payment ledger that can link financial claims to one or more work/stage references while still preserving the existing S.O./stage workflow.

## 2. Current Codebase Behavior

Relevant current model:

- `supply_orders` table stores payment fields directly on each S.O.: `bill_preparation_date`, `bill_sent_for_payment_date`, `bill_return_cycles`, `payment_date`, `payment_mode`, `actual_payment_capital`, `actual_payment_revenue`, `bill_amount_capital`, `bill_amount_revenue`.
- Staged payments are stored in `supply_orders.stage_deliveries` JSON rows with the same kind of bill/payment fields.
- Advance payment is stored in `supply_orders.advance_payment_detail` JSON.
- Cash outgo reports aggregate from these direct S.O./stage/advance payment fields.
- Cash Out Go Plan currently creates one row per effective payment unit: standalone S.O., stage row, or advance payment row.

Current strengths:

- It supports ordinary S.O. payment.
- It supports per-stage payment.
- It supports advance payment.
- It supports bill return/resubmission cycles.
- It already distinguishes planned bill amount from actual payment amount.

Current limitations:

- A bill cannot be linked to multiple stages.
- A stage cannot have multiple bills without overloading the same stage payment fields.
- A standalone S.O. cannot have more than one bill/payment cycle except through returned-bill cycles.
- Partial payment cannot be cleanly represented as multiple payments against the same bill.
- GST/balance/recovery/penalty-correction bills cannot be represented without pretending they are a stage or overwriting the original S.O. payment.
- Cash outgo cannot show "bill count" accurately when bills exceed stages.
- Dashboards cannot distinguish "stage complete but no bill", "bill under process", "bill partially paid", and "balance/recovery bill pending" as separate facts.

Important shortclosure rule:

- Shortclosure should stop future unearned/unsubmitted expected cash outgo.
- Shortclosure should not exclude already prepared bills, already submitted bills, returned/resubmitted bills, partial-payment balances, or actual payments.

## 3. Recommended Conceptual Model

Add a new bill/payment ledger below S.O.

The S.O. and stage records should continue to describe contract/work progress:

- S.O. value
- S.O. date
- D.P. date
- stage count
- stage delivery dates
- stage completion/material receipt/job completion
- shortclosure/cancellation

The new ledger should describe financial claims and payments:

- Bill raised/prepared
- Bill sent to payment authority
- Bill returned and resubmitted
- Bill amount and deductions
- Payment authority status
- Actual payment received/cleared
- Balance still payable
- Links to one or more stages, advance payment, or general S.O.

This gives the software two separate truths:

- Work truth: what was ordered, delivered, completed, shortclosed, cancelled.
- Money truth: what has been billed, returned, paid, withheld, deducted, or still pending.

## 3A. Agreed User-Facing Model

The user should not be forced into a complicated accounting screen. The software should expose the feature in familiar office language:

- Normal bill
- Combined stage bill
- Supplementary bill
- Returned/resubmitted bill
- Partial payment/balance pending

The internal model may be a ledger, but the user-facing flow should feel like entering bills against an S.O.

### 3A.1 Combined Stage Bills

When a single bill is sent for multiple stages, the user should be able to select those stages together.

The software must support two entry modes:

- Combined total mode
- Stage-wise detail mode

In combined total mode:

- The user selects multiple stages.
- The user enters one total bill amount.
- The user enters one total paid amount when payment is received.
- The software does not split the bill amount or paid amount back into individual stages.
- Any unpaid amount remains attached to the combined bill/stage group.
- In future bills, this unpaid balance can be carried forward as a previous unpaid component.

In stage-wise detail mode:

- The user selects one or more stages.
- The user can enter bill amount per stage.
- The user can enter paid amount per stage.
- The software can show exact stage-wise paid/pending information.
- Any unpaid amount can be carried forward stage-wise.

This dual mode is important because both real-world workflows exist. Sometimes the office only knows the total bill/payment. Sometimes the user has exact stage-wise breakup.

### 3A.2 Carry Forward of Unpaid Amounts

If a combined bill is paid for less than the billed amount, the unpaid amount should not be forcibly allocated to individual stages unless stage-wise detail was entered.

Example:

- Stage 1 expected: 10 lakh
- Stage 2 expected: 15 lakh
- Combined bill: 25 lakh
- Payment received: 20 lakh
- Balance pending: 5 lakh

In combined total mode, the 5 lakh remains attached to the combined bill. Later, when Stage 3 bill is being prepared, the software should offer:

- Current Stage 3 amount
- Previous unpaid balance from Stage 1 + Stage 2 combined bill

The user can then send one new bill that contains both components.

### 3A.3 Supplementary Bills Anytime

Supplementary bills must be allowed any time during S.O. execution, apart from normal stage payment.

A supplementary bill may be created when:

- no current stage bill is being sent
- a stage is already paid
- a stage is partially paid
- a previous combined bill has unpaid balance
- GST was unpaid earlier
- payment authority made a wrong deduction
- penalty was wrongly deducted
- S.O. is still running
- S.O. is shortclosed but payment/balance is still valid

The supplementary bill may be linked to:

- full S.O.
- one stage
- multiple stages
- previous combined bill
- no specific stage, only the S.O.

Supplementary bill reasons should include:

- Previous unpaid balance
- GST unpaid
- Wrong deduction recovery
- Penalty refund/recovery
- Rate difference
- Balance payment
- Other adjustment

### 3A.4 Additional Information User Must Enter

The additional user-entered information should be limited and practical.

For every new bill:

- Bill type: normal, combined stage, supplementary, advance.
- Bill number/reference, if available.
- Bill preparation date.
- Bill sent for payment date.
- Amount entry mode: combined total or stage-wise detail.
- Bill amount.
- Payment date and actual paid amount, when paid.
- Returned/resubmitted details, if returned.
- Remarks, if needed.

Only for combined stage bills:

- Stages included in the bill.
- Whether previous unpaid balance is included.

Only for stage-wise detail mode:

- Stage-wise bill amount.
- Stage-wise actual paid amount.
- Stage-wise unpaid/deducted amount reason, if any.

Only for supplementary bills:

- Supplementary reason.
- Previous bill/balance reference, if available.
- Linked stage(s), if applicable.

The software should calculate:

- expected amount suggestion
- total bill amount from stage-wise rows
- actual paid total from stage-wise rows
- unpaid balance
- carry-forward balance
- report status

### 3A.5 Report and Dashboard Principle

Cash Outgo and dashboard status must not depend only on S.O./stage payment fields after this feature is added.

The rule should be:

- S.O./stage data drives delivery/work progress and unbilled forecast.
- Bill rows drive bill prepared, bill submitted, returned bill, partial payment, payment pending, and actual cash outgo.
- Shortclosure stops future unbilled forecast only.
- Shortclosure does not remove already prepared/submitted/returned/resubmitted/partially paid/supplementary/paid bills.

## 4. Proposed Data Model

### 4.1 Tables

Create `supply_order_bills`.

Suggested fields:

```sql
create table supply_order_bills (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references files(id) on delete cascade,
  supply_order_id uuid not null references supply_orders(id) on delete cascade,
  bill_no text,
  bill_type text not null default 'regular',
  bill_scope text not null default 'so',
  bill_description text,
  bill_preparation_date date,
  bill_sent_for_payment_date date,
  expected_payment_date date,
  bill_amount_capital numeric(14, 2),
  bill_amount_revenue numeric(14, 2),
  gross_amount_capital numeric(14, 2),
  gross_amount_revenue numeric(14, 2),
  deduction_capital numeric(14, 2),
  deduction_revenue numeric(14, 2),
  deduction_reason text,
  net_payable_capital numeric(14, 2),
  net_payable_revenue numeric(14, 2),
  payment_status text not null default 'draft',
  payment_authority text,
  payment_authority_reference text,
  remarks text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Create `supply_order_bill_lines`.

```sql
create table supply_order_bill_lines (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references supply_order_bills(id) on delete cascade,
  file_id uuid not null references files(id) on delete cascade,
  supply_order_id uuid not null references supply_orders(id) on delete cascade,
  line_type text not null default 'stage',
  stage_index integer,
  line_label text,
  amount_capital numeric(14, 2),
  amount_revenue numeric(14, 2),
  adjustment_kind text,
  adjustment_reason text,
  sort_order integer not null default 0
);
```

Create `supply_order_bill_payments`.

```sql
create table supply_order_bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references supply_order_bills(id) on delete cascade,
  payment_date date not null,
  payment_mode text,
  payment_reference text,
  paid_capital numeric(14, 2),
  paid_revenue numeric(14, 2),
  deduction_capital numeric(14, 2),
  deduction_revenue numeric(14, 2),
  deduction_reason text,
  remarks text,
  created_at timestamptz not null default now()
);
```

Create `supply_order_bill_return_cycles`.

```sql
create table supply_order_bill_return_cycles (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references supply_order_bills(id) on delete cascade,
  returned_date date not null,
  reason text,
  resubmitted_date date,
  remarks text,
  created_at timestamptz not null default now()
);
```

### 4.2 Controlled Values

`bill_type`:

- `regular`
- `advance`
- `stage_combined`
- `balance`
- `gst_balance`
- `deduction_recovery`
- `penalty_refund`
- `other_adjustment`

`bill_scope`:

- `so`
- `stage`
- `multi_stage`
- `advance`
- `adjustment`

`line_type`:

- `so`
- `stage`
- `advance`
- `gst`
- `deduction_recovery`
- `penalty`
- `other_adjustment`

`payment_status`, derived when possible:

- `draft`: bill entered but not prepared.
- `prepared`: bill preparation date exists, not sent.
- `submitted`: bill sent date exists, no open return, no full payment.
- `returned`: at least one open return exists.
- `resubmitted`: returned and resubmitted, not fully paid.
- `partially_paid`: at least one payment exists, balance remains.
- `paid`: paid amount covers net payable.
- `cancelled`: bill entry cancelled administratively.

Prefer deriving `payment_status` from dates and amounts. Store it only if the UI needs manual override, and even then keep a derived status column/view for reports.

## 5. How Scenarios Are Handled

### Scenario A: Standalone S.O., One Bill, One Payment

- Bill scope: `so`
- One line: `line_type = so`
- One payment row when paid
- Cash outgo uses bill sent date for pending and payment date for actual

This is equivalent to the existing model but more explicit.

### Scenario B: Staged S.O., One Bill Per Stage

- Bill scope: `stage`
- Each bill has one line with `stage_index`
- Dashboards can still show stage-wise progress
- Cash outgo groups by bill, not by stage field

### Scenario C: One Bill Covers Multiple Stages

- Bill scope: `multi_stage`
- Bill has multiple lines:
  - stage 1 balance
  - stage 2 current amount
  - stage 3 current amount, if included
- Bill amount is the sum of lines unless manually overridden
- Cash outgo counts one bill in submitted/pending, with total amount across lines
- Stage dashboard can mark each linked stage as "billed" without needing separate bill dates on every stage

### Scenario D: Previous Unpaid Stage Paid With Current Stage

- Create one multi-stage bill.
- Line 1 links previous stage with its unpaid amount.
- Line 2 links current stage with current payable amount.
- Bill status is one financial event, while stage ledger shows both stages have billed value.

### Scenario E: Partial Payment, Remaining Balance Later

- Original bill has one or more payment rows.
- If paid amount is less than net payable, status becomes `partially_paid`.
- Balance remains in "Payment Pending" reports.
- If payment authority requires a fresh balance bill, create a new bill with `bill_type = balance` and link it to the original bill through an optional `parent_bill_id` field.

Optional addition:

```sql
alter table supply_order_bills
  add column parent_bill_id uuid references supply_order_bills(id) on delete set null;
```

### Scenario F: GST Not Paid Earlier

- Create a `gst_balance` bill.
- Line type: `gst`.
- Link it to the relevant S.O. or stage if known.
- It appears in billing/payment pending reports independent of stage count.

### Scenario G: Penalty Wrongly Deducted

- If authority deducted wrongly, record the deduction in `supply_order_bill_payments`.
- Create recovery bill with `bill_type = deduction_recovery` or `penalty_refund`.
- Link it to the original bill through `parent_bill_id`.
- Cash outgo shows the recovery as pending until paid.

### Scenario H: S.O. Shortclosed With Bill Under Process

- S.O. shortclosure remains on the S.O.
- Existing bills remain active unless the bill itself is cancelled.
- Cash outgo includes:
  - prepared bills pending submission
  - submitted bills pending payment
  - returned bills pending resubmission
  - resubmitted bills pending payment
  - partial-payment balances
  - paid bills in actual cash outgo
- Cash outgo excludes:
  - future D.P.-based projection for unperformed/unbilled balance after shortclosure

This is the rule that should be implemented everywhere.

## 6. Backend API Design

Add bill APIs under the file/S.O. area.

Suggested endpoints:

- `GET /api/files/:fileId/bills`
- `POST /api/files/:fileId/supply-orders/:supplyOrderId/bills`
- `PATCH /api/bills/:billId`
- `DELETE /api/bills/:billId`
- `POST /api/bills/:billId/lines`
- `PATCH /api/bill-lines/:lineId`
- `DELETE /api/bill-lines/:lineId`
- `POST /api/bills/:billId/payments`
- `PATCH /api/bill-payments/:paymentId`
- `DELETE /api/bill-payments/:paymentId`
- `POST /api/bills/:billId/returns`
- `PATCH /api/bill-returns/:returnId`
- `DELETE /api/bill-returns/:returnId`

Use transactions for bill writes:

- bill header
- bill lines
- payments
- return cycles
- audit log

Validation rules:

- A bill must belong to one file and one S.O.
- Stage lines must use a valid `stage_index` for that S.O.
- Bill amount should equal line total unless the user explicitly marks an override.
- Net payable should equal gross minus deductions when values are known.
- Payment total cannot exceed net payable unless the user marks it as an adjustment/refund bill.
- A bill cannot be `paid` without at least one payment date.
- A returned bill with no resubmission date is not payment-pending; it is returned-pending.
- Shortclosure must not block editing or payment of existing bills.

## 7. Frontend UX Design

### 7.1 Add/Edit Page

Replace the single payment fields inside S.O./stage with a "Bills and Payments" ledger tab.

Keep stage rows focused on work:

- stage amount
- delivery period start
- D.P./revised D.P.
- material receipt/job completion
- IR dates

Add a new bill ledger panel:

- Bill list grouped under each S.O.
- Each bill as a compact row/card:
  - bill no
  - bill type
  - linked stages
  - prepared date
  - sent date
  - return status
  - paid date/latest payment date
  - gross, deductions, net, paid, balance
  - status badge

Bill editor should allow:

- Add standalone S.O. bill.
- Add stage bill.
- Add combined stage bill.
- Add adjustment/recovery/GST bill.
- Select one or many stage checkboxes.
- Add line amounts per selected stage.
- Add payment rows.
- Add returned bill cycles.

### 7.2 Seamless User Flow

When user clicks "Add Bill":

1. Default bill type to `regular`.
2. If staged S.O., show stage checklist with amount suggestions.
3. Allow "Include previous unpaid amount" toggle.
4. Allow "Adjustment bill" option for GST, penalty recovery, or other balance.
5. Auto-calculate total from lines.
6. Show warning if bill total exceeds remaining S.O. value, but allow with reason.
7. Save bill as a ledger entry.

When user receives payment:

1. Open bill.
2. Add payment row.
3. Enter paid amount, date, mode/reference.
4. If paid amount is lower than net payable, bill becomes `partially_paid`.
5. The unpaid balance remains in pending cash outgo.

When bill is returned:

1. Add return cycle.
2. Bill status becomes `returned`.
3. It moves from "Bills Submitted, Payment Pending" to "Pending returned bills".
4. On resubmission, it becomes `resubmitted`.
5. It returns to pending payment reports using resubmission/sent date as appropriate.

## 8. Cash Outgo Report Rules

### 8.1 Amount Sources

Forecast before bill:

- Use remaining unbilled value from S.O./stage work.
- Exclude shortclosed unperformed/unbilled balance.

Bill prepared:

- Use bill net payable amount.

Bill submitted/payment pending:

- Use bill balance amount: `net_payable - paid`.
- Include shortclosed S.O.s.
- Exclude only cancelled bills and demand/S.O. cancellations where the bill was cancelled or never valid.

Actual cash outgo:

- Use payment rows.
- Include payments for shortclosed S.O.s.
- Exclude only cancelled bill/payment rows.

Returned bills:

- Use bill amount or remaining balance depending on report:
  - returned total: current bill net/balance
  - returned pending: balance until resubmitted
  - returned paid: actual paid amount

### 8.2 Revised Report Buckets

Recommended buckets:

- Actual Cash Outgo
- Bills Submitted, Payment Pending
- Bills Prepared, Not Submitted
- Returned Bills Pending Resubmission
- Returned Bills Resubmitted, Payment Pending
- Partially Paid Bills, Balance Pending
- Delivered/Completed, Bill Not Prepared
- D.P.-based Forecast
- D.P. Expired Forecast
- Adjustment/GST/Recovery Bills Pending

The existing reports can be preserved, but their data source should move from S.O./stage fields to bill ledger views.

### 8.3 Database Views

Create a unified view for report writers:

```sql
create view v_cash_outgo_bill_rows as
select
  b.id as bill_id,
  b.file_id,
  b.supply_order_id,
  b.bill_type,
  b.bill_scope,
  b.bill_preparation_date,
  b.bill_sent_for_payment_date,
  b.expected_payment_date,
  coalesce(b.net_payable_capital, b.bill_amount_capital, 0) as payable_capital,
  coalesce(b.net_payable_revenue, b.bill_amount_revenue, 0) as payable_revenue,
  coalesce(p.paid_capital, 0) as paid_capital,
  coalesce(p.paid_revenue, 0) as paid_revenue,
  greatest(coalesce(b.net_payable_capital, b.bill_amount_capital, 0) - coalesce(p.paid_capital, 0), 0) as balance_capital,
  greatest(coalesce(b.net_payable_revenue, b.bill_amount_revenue, 0) - coalesce(p.paid_revenue, 0), 0) as balance_revenue,
  exists (
    select 1 from supply_order_bill_return_cycles r
    where r.bill_id = b.id and r.resubmitted_date is null
  ) as has_open_return,
  exists (
    select 1 from supply_order_bill_return_cycles r
    where r.bill_id = b.id and r.resubmitted_date is not null
  ) as has_resubmitted_return
from supply_order_bills b
left join (
  select bill_id, sum(paid_capital) as paid_capital, sum(paid_revenue) as paid_revenue
  from supply_order_bill_payments
  group by bill_id
) p on p.bill_id = b.id
where b.payment_status <> 'cancelled';
```

The exact view can be tuned, but the important point is that reports should read a bill row abstraction instead of reading payment fields directly from `supply_orders` and `stage_deliveries`.

## 9. Dashboard Rules

Dashboards should count payment states by bill rows, not by S.O./stage rows.

Recommended dashboard metrics:

- Bills prepared
- Bills submitted
- Bills returned
- Returned bills pending
- Returned bills resubmitted
- Bills partially paid
- Payment pending
- Bills paid
- Adjustment bills pending
- Shortclosed S.O. with pending bill/payment

Existing milestone rows can still show:

- Bill preparation
- Bill sent for payment
- Bill returned for correction
- Payment

But their source should become the ledger:

- Bill preparation current: a due/ready bill has no preparation date.
- Bill sent current: prepared bill has no sent date.
- Bill returned current: bill has open return.
- Payment current: submitted/resubmitted bill has unpaid balance.
- Payment completed: all non-cancelled bills for the S.O./stage are paid, or the S.O. has no payable balance due to shortclosure.

## 10. Search and Drill-down

Add bill-aware filters:

- Bill status
- Bill type
- Bill date range
- Payment date range
- Shortclosed S.O. with pending bill
- Partial payment balance
- Adjustment bill pending
- Bills covering multiple stages
- Bills exceeding stage count

Search result display should show:

- File reference
- S.O. reference
- Bill reference
- Linked stages
- Bill status
- Balance amount
- Latest bill event date

This avoids the current ambiguity where clicking a cash outgo total opens a file but not the exact bill/payment row responsible for the amount.

## 11. Migration Strategy

### Phase 1: Add ledger tables

- Add new tables and read APIs.
- Keep current S.O./stage payment fields unchanged.
- Introduce a backend function that converts existing fields into virtual bill rows for reports.

### Phase 2: Backfill physical bill rows

For each existing S.O.:

- If standalone payment fields exist, create one `regular` bill.
- If stage payment is enabled, create one bill per stage that has bill/payment activity.
- If advance payment exists, create one `advance` bill.
- Convert `billReturnCycles` to `supply_order_bill_return_cycles`.
- Convert payment date and actual amount to `supply_order_bill_payments`.

Mark migrated rows:

```sql
alter table supply_order_bills add column migrated_from text;
alter table supply_order_bills add column legacy_source_key text;
```

### Phase 3: Dual-read reports

- Reports read from ledger when rows exist.
- For old files not migrated yet, reports generate virtual bill rows from legacy fields.
- Compare totals between old and new reports during QA.

### Phase 4: Ledger-first UI

- Add bill ledger UI.
- Keep legacy fields visible as read-only or hide behind compatibility mode.
- All new billing edits go to ledger.

### Phase 5: Retire legacy payment writes

- Stop writing new bill/payment fields directly into S.O./stage records.
- Keep stage/S.O. summary fields as derived cached values only if needed for performance.

## 12. Implementation Plan

### Step 1: Define shared types

Add to backend and frontend types:

- `SupplyOrderBill`
- `SupplyOrderBillLine`
- `SupplyOrderBillPayment`
- `SupplyOrderBillReturnCycle`
- `BillPaymentStatus`
- `BillType`
- `BillScope`

### Step 2: Add database migration

Create migration:

- `069_supply_order_bill_ledger.sql`

Include tables, indexes, and updated-at trigger.

Suggested indexes:

- `(file_id)`
- `(supply_order_id)`
- `(bill_sent_for_payment_date)`
- `(bill_preparation_date)`
- `(payment_status)`
- payment `(bill_id, payment_date)`
- bill lines `(supply_order_id, stage_index)`

### Step 3: Backend route layer

Add `backend/src/routes/bills.ts`.

Responsibilities:

- Load bill ledger for a file.
- Create/update/delete bill rows.
- Maintain transaction integrity.
- Validate stage links.
- Return derived totals and status.

### Step 4: Report abstraction

Add a utility:

- `backend/src/utils/bill-ledger.ts`

Functions:

- `loadBillLedgerRows(whereSql, values)`
- `deriveBillStatus(row)`
- `getBillPayableAmount(row)`
- `getBillPaidAmount(row)`
- `getBillBalanceAmount(row)`
- `buildLegacyVirtualBillRows(file)`

Then update:

- Cash outgo reports
- Cash Out Go Plan
- dashboard status counts
- search filters
- exports

### Step 5: Add/Edit UI

Add:

- `BillLedgerBlock`
- `BillEditorDialog`
- `BillLinesEditor`
- `BillPaymentsEditor`
- `BillReturnCyclesEditor`

UI must support:

- Multiple bills per S.O.
- Multiple lines per bill.
- Multiple payments per bill.
- Shortclosed S.O. with active bills.
- Adjustment bills.

### Step 6: Dashboard and search drill-down

Cash outgo totals should open exact bill rows, not just files.

Add URL focus targets:

- `bill:<billId>`
- `billStatus:submitted`
- `billType:gst_balance`

### Step 7: QA and reconciliation

Create automated tests for:

- One S.O., one bill, one payment.
- One S.O., two bills.
- Staged S.O., one bill per stage.
- Staged S.O., one bill covering two stages.
- Partial payment and balance pending.
- GST balance bill after original payment.
- Wrong penalty deduction recovery bill.
- Returned bill pending resubmission.
- Returned bill resubmitted and payment pending.
- Returned bill paid.
- Shortclosed S.O. with submitted bill pending payment.
- Shortclosed S.O. with actual payment.
- Shortclosed S.O. with no bill: excluded from future D.P. forecast.
- Cancelled S.O. with no valid bill: excluded.

Reconciliation checks:

- Sum of bill lines by S.O. should not silently exceed S.O. value.
- Sum of paid amounts should match Actual Cash Outgo.
- Sum of pending balances should match Payment Pending reports.
- Paid plus pending plus deducted should reconcile to bill net payable.

## 13. Key Business Rules

1. Shortclosure does not cancel bills.
2. S.O. cancellation does not automatically cancel bills already submitted unless user marks the bill cancelled.
3. A bill can cover any combination of stages and adjustment lines.
4. A stage can be included in more than one bill if there is unpaid balance, GST, deduction recovery, or another justified adjustment.
5. Actual cash outgo must come from payment rows only.
6. Payment pending must come from unpaid bill balance, not from stage count.
7. Future forecast must come from unbilled, unshortclosed, non-cancelled remaining work.
8. Reports must be bill-row based for billing/payment and S.O./stage based for delivery/progress.
9. Drill-down must identify the exact bill causing the count or amount.
10. Legacy S.O./stage payment fields should be migrated, not abruptly removed.

## 14. Recommended Decision

Implement the bill/payment ledger as the next major data-model upgrade.

Do not try to solve this by adding more fields to stage rows. That would keep increasing complexity and still fail for combined bills, extra bills, partial payments, GST balances, and recovery bills.

The ledger model is more work initially, but it simplifies the business logic:

- Stages answer: what work happened?
- Bills answer: what was claimed?
- Payments answer: what money moved?
- Cash outgo answers: what is paid, pending, or forecast?

This separation is the cleanest way to handle the complex cases without compromising existing dashboards and reports.
