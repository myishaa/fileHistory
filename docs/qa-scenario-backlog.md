# QA scenario backlog

This backlog is for batch-wise QA. Seed only a small batch, run anomaly checks, stop on new anomalies, discuss/fix/accept, then continue.

## Batch 1 — clean baseline workflows

- Goods & Services with IR: complete clean flow from demand to payment.
- Contract/AMC/MPC/O&M/CARS/CAPSI job-completion flow.
- Stage delivery with sequential non-overlapping stages.
- Multiple S.O. file with one live S.O. and one cancelled S.O.
- Shortclosed S.O. with genuine pending payment.

## Batch 2 — payment edge cases

- Normal bill returned, resubmitted, paid.
- Normal bill returned and still pending.
- Supplementary bill submitted, returned, resubmitted, paid.
- Advance payment with returned/resubmitted/paid cycle.
- Online/offline payment segregation.

## Batch 3 — stage edge cases

- Paid stage then increase stage count; remaining balance redistributes across unpaid stages.
- Paid stage then reduce stage count; paid stage protection should block/remind.
- Stage D.P. overlap; suspected anomaly should appear and be acceptable if intentional.
- Revised D.P. on one stage without shifting later existing stages.
- Stage payment plus advance payment.

## Batch 4 — division and access scenarios

- Division merge with active files.
- Division merge with closed/cancelled files.
- Division split/transfer by indentor.
- Division split after S.O. placed.
- Editor access after merge/split.
- Viewer/universal viewer behavior after merge/split.
- Historical reports after division change.

## Batch 5 — settings/custom master data

- Custom file type added and used in Add/Search/Dashboard/Reports.
- Custom mode, firm type, marker, indentor, division.
- Value threshold changes.
- Demand Processing presets and day ranges.
- MMG summary field customization.
- Table field presets by admin and user.

## Batch 6 — reports/export/filter reliability

- All global filters: All files, All active files, Active + current FY closed, specific FY.
- File Year subfilter and initiation date ranges, including empty future range.
- Cash Outgo expanded/collapsed export.
- PDF/Excel export parity and numeric amount cells.
- Demand Processing negative results excluded from averages.
- Search focus from every clicker to correct file/S.O./stage/payment row.

## Batch 7 — archive/governance/security

- File/archive restore/permanent delete.
- Firm/archive restore and editor delete restriction.
- Indentor/archive restore.
- User/archive restore.
- IP access notify/restrict/archive/delete.
- Anomaly accept for file, universal accept, reject, revoke, clear history.

## Batch 8 — stress and display

- Long demand descriptions.
- Long firm/division names.
- 500+ file performance.
- Browser refresh on Add/Search/Reports.
- Session expiry/refresh.
- Quick Entry active/closed/cancelled files.
