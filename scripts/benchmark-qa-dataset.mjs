import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Pool } = require("../backend/node_modules/pg");

const databaseUrl = process.env.QA_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("QA_DATABASE_URL is required. Refusing to seed a performance cohort in the application database.");
}

const pool = new Pool({ connectionString: databaseUrl });
const prefix = process.env.BENCHMARK_QA_PREFIX ?? "QA-PERF-20261027-";

async function cleanup() {
  const result = await pool.query("delete from files where unique_code like $1", [`${prefix}%`]);
  console.log(JSON.stringify({ action: "cleanup", database: new URL(databaseUrl).pathname.slice(1), prefix, deletedFiles: result.rowCount ?? 0 }));
}

async function seed() {
  await pool.query("begin");
  try {
    await pool.query("delete from files where unique_code like $1", [`${prefix}%`]);
    await pool.query(`
      insert into divisions (name, code)
      values ('ACC', 'QA-ACC'), ('CSeG', 'QA-CSEG'), ('SCPC', 'QA-SCPC')
      on conflict (name) do nothing
    `);
    await pool.query(`
      insert into financial_years (label)
      values ('2022-23'), ('2023-24'), ('2024-25'), ('2025-26'), ('2026-27')
      on conflict (label) do nothing
    `);
    await pool.query(`
      create temp table qa_perf_files (id uuid primary key, n integer not null, year text not null, scenario integer not null)
      on commit drop
    `);
    await pool.query(`
      with source as (
        select g as n, 2022 + ((g - 1) / 2000)::integer as start_year,
          ((g - 1) % 16)::integer as scenario, ((g - 1) % 5)::integer as type_index,
          ((g - 1) % 6)::integer as mode_index, ((g - 1) % 3)::integer as division_index,
          (100000 + g * 137)::numeric as amount, (2 + (g % 45))::integer as day_offset
        from generate_series(1, 10000) as g
      ), dates as (
        select *, format('%s-%s', start_year, lpad(((start_year + 1) % 100)::text, 2, '0')) as year,
          make_date(start_year, 4, 1) + day_offset as received_date
        from source
      ), inserted as (
        insert into files (
          title, division_id, officer, imms, file_date, year, unique_code, received_date,
          scrutiny_date, scrutiny_response_date, scrutiny_completion_date, imms_date, file_no,
          indentor, demand_description, value_capital, value_revenue, currency, exchange_rate, gte,
          tcec, file_type_group, mode, gem, gem_bidding_mode, high_value, ad, rqa, ifa, psb, bg,
          rfp_vetting, high_value_meeting_date, high_value_minutes_date, pre_tcec_date,
          pre_tcec_minutes_date, pre_tcec_committee_no, ad_vetting_date, rqa_approval_date,
          ifa_sent_date, ifa_final_date, cfa_sent_date, cfa_date, gem_undertaking_date,
          refloat_gem_undertaking_date, refloat_recommendation_date, rfp_vetting_initiation_date,
          rfp_vetting_approval_date, pre_bid_meeting, pre_bid_meeting_date, tender_live, bid_number,
          bid_date, bid_opening_date, bid_opened, refloat, refloat_pre_bid_meeting,
          refloat_pre_bid_meeting_date, post_tcec_date, post_tcec_minutes_date, post_tcec_committee_number,
          refloat_post_tcec_date, refloat_post_tcec_minutes_date, refloat_post_tcec_committee_no,
          refloat_bidding_date, refloat_bid_opening_date, rst, bidding_stage_over,
          refloat_bidding_stage_over, cnc_date, cnc_approval_date, no_of_so, current_milestone,
          file_closure_date, ad_sent_date, rqa_sent_date, bq_basis, shortclosure, shortclosure_date,
          demand_cancelled, demand_cancelled_date, so_cancelled, so_cancelled_date, ir, file_type
        )
        select 'QA performance coverage ' || n,
          (select id from divisions where name = (array['ACC','CSeG','SCPC'])[division_index + 1] limit 1),
          'QA performance benchmark', 'QA/PERF/' || n, received_date, year,
          '${prefix}' || lpad(n::text, 5, '0'), received_date,
          case when scenario >= 1 then received_date + 3 end,
          case when scenario >= 1 then received_date + 5 end,
          case when scenario >= 1 then received_date + 7 end,
          case when scenario >= 1 then received_date + 7 end,
          'QA/PERF/' || year || '/' || n,
          (array['QA Logistics Cell','QA Cyber Security Group','QA Reliability Test Centre'])[division_index + 1],
          'QA performance benchmark exercises workflow, filter, report, and analytics paths',
          case when n % 2 = 0 then amount end, case when n % 2 = 1 then amount end,
          'INR', 1, case when n % 10 = 0 then 'Yes' else 'No' end,
          case when n % 3 = 0 or scenario >= 4 then 'Yes' else 'No' end,
          case when type_index = 0 then 'goodsServices' else 'contract' end,
          (array['OBM','PBM','SBM','LBM','LPC','GeM'])[mode_index + 1],
          case when mode_index = 5 then 'Yes' else 'No' end,
          case when mode_index = 5 then 'GeM Bid' end,
          case when n % 10 = 0 then 'Yes' else 'No' end,
          case when n % 11 = 0 then 'Yes' else 'No' end,
          case when n % 7 = 0 then 'Yes' else 'No' end,
          case when scenario >= 2 or n % 6 = 0 then 'Yes' else 'No' end,
          case when n % 4 = 0 then 'Yes' else 'No' end,
          case when n % 5 = 0 then 'Yes' else 'No' end,
          case when n % 8 = 0 then 'Yes' else 'No' end,
          case when n % 10 = 0 then received_date + 6 end,
          case when n % 10 = 0 then received_date + 8 end,
          case when scenario >= 4 then received_date + 25 end,
          case when scenario >= 4 then received_date + 29 end,
          case when scenario >= 4 then 'QA-TCEC-' || (n % 9 + 1) end,
          case when n % 11 = 0 then received_date + 15 end,
          case when n % 7 = 0 then received_date + 18 end,
          case when scenario >= 2 then received_date + 12 end,
          case when scenario >= 2 then received_date + 14 end,
          case when scenario >= 3 then received_date + 16 end,
          case when scenario >= 3 then received_date + 20 end,
          case when n % 6 = 0 then received_date + 12 end,
          case when n % 8 = 0 then received_date + 9 end,
          case when n % 8 = 0 then received_date + 11 end,
          case when scenario >= 5 then received_date + 13 end,
          case when scenario >= 5 then received_date + 15 end,
          case when scenario >= 5 then 'Yes' else 'No' end,
          case when scenario >= 5 then received_date + 27 end,
          case when scenario >= 5 then 'Yes' else 'No' end,
          case when scenario >= 5 then 'QA-BID-' || n end,
          case when scenario >= 5 then received_date + 30 end,
          case when scenario >= 5 then received_date + 35 end,
          case when scenario >= 5 then 'Yes' else 'No' end,
          case when n % 19 = 0 and scenario >= 5 then 'Yes' else 'No' end,
          case when n % 19 = 0 and scenario >= 5 then 'Yes' else 'No' end,
          case when n % 19 = 0 and scenario >= 5 then received_date + 34 end,
          case when scenario >= 6 then received_date + 40 end,
          case when scenario >= 6 then received_date + 44 end,
          case when scenario >= 6 then 'QA-POST-TCEC-' || (n % 9 + 1) end,
          case when n % 19 = 0 and scenario >= 6 then received_date + 47 end,
          case when n % 19 = 0 and scenario >= 6 then received_date + 51 end,
          case when n % 19 = 0 and scenario >= 6 then 'QA-REFLOAT-' || (n % 9 + 1) end,
          case when n % 19 = 0 and scenario >= 5 then received_date + 48 end,
          case when n % 19 = 0 and scenario >= 5 then received_date + 53 end,
          case when n % 9 = 0 then 'Yes' else 'No' end,
          case when scenario >= 5 then 'Yes' else 'No' end,
          case when n % 19 = 0 and scenario >= 5 and n % 2 = 0 then 'Yes' else 'No' end,
          case when scenario >= 7 then received_date + 60 end,
          case when scenario >= 7 then received_date + 65 end,
          case when scenario >= 9 then 1 else 0 end,
          case scenario when 0 then 'Scrutiny' when 1 then 'Controlling' when 2 then 'IFA'
            when 3 then 'CFA' when 4 then 'Pre-TCEC' when 5 then 'Bidding' when 6 then 'Post-TCEC'
            when 7 then 'CNC' when 8 then 'Financial Sanction' when 9 then 'Supply Order'
            when 10 then 'Delivery Period' when 11 then 'Delivery' when 12 then 'IR Preparation'
            when 13 then 'IR Receipt' when 14 then 'Bill preparation' else 'Payment' end,
          case when start_year < 2026 then make_date(start_year + 1, 3, 15) end,
          case when n % 11 = 0 then received_date + 14 end,
          case when n % 7 = 0 then received_date + 17 end,
          case when type_index = 0 then 'D.P.' else 'Contract' end,
          case when n % 23 = 0 and scenario >= 9 then 'Yes' else 'No' end,
          case when n % 23 = 0 and scenario >= 9 then received_date + 200 end,
          'No', null, 'No', null,
          case when type_index > 0 then 'No' else 'Yes' end,
          (array['Goods & Services','AMC','MPC','CARS','O&M'])[type_index + 1]::text
        from dates returning id, unique_code, year
      )
      insert into qa_perf_files(id, n, year, scenario)
      select id, regexp_replace(unique_code, '^.*-', '')::integer, year,
        ((regexp_replace(unique_code, '^.*-', '')::integer - 1) % 16)::integer from inserted
    `);

    await pool.query(`
      insert into file_year_activity(file_id, financial_year, status)
      select id, year, 'active' from qa_perf_files on conflict do nothing;
      insert into file_completed_milestones(file_id, milestone, completed_at)
      select q.id, milestone.value, current_date from qa_perf_files q
      cross join lateral jsonb_array_elements_text(
        case q.scenario when 0 then '["Scrutiny"]'::jsonb
          when 1 then '["Scrutiny","Controlling"]'::jsonb
          when 2 then '["Scrutiny","Controlling","IFA"]'::jsonb
          when 3 then '["Scrutiny","Controlling","IFA","CFA"]'::jsonb
          when 4 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC"]'::jsonb
          when 5 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding"]'::jsonb
          when 6 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC"]'::jsonb
          when 7 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC","CNC"]'::jsonb
          when 8 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC","CNC","Financial Sanction"]'::jsonb
          when 9 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC","CNC","Financial Sanction","Supply Order"]'::jsonb
          when 10 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC","CNC","Financial Sanction","Supply Order","Delivery Period"]'::jsonb
          when 11 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC","CNC","Financial Sanction","Supply Order","Delivery Period","Delivery"]'::jsonb
          when 12 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC","CNC","Financial Sanction","Supply Order","Delivery Period","Delivery","IR Preparation"]'::jsonb
          when 13 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC","CNC","Financial Sanction","Supply Order","Delivery Period","Delivery","IR Preparation","IR Receipt"]'::jsonb
          when 14 then '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC","CNC","Financial Sanction","Supply Order","Delivery Period","Delivery","IR Preparation","IR Receipt","Bill preparation"]'::jsonb
          else '["Scrutiny","Controlling","IFA","CFA","Pre-TCEC","Bidding","Post-TCEC","CNC","Financial Sanction","Supply Order","Delivery Period","Delivery","IR Preparation","IR Receipt","Bill preparation","Bill sent for payment","Payment"]'::jsonb end
      ) milestone(value) on conflict do nothing;
      insert into file_remarks(file_id, section, text)
      select id, 'QA performance benchmark', 'Generated deterministic coverage record for isolated performance measurement.' from qa_perf_files;
      insert into file_markers(file_id, text, sort_order)
      select id, 'QA-PERF-BENCHMARK', 0 from qa_perf_files;
      insert into file_firms(file_id, firm_type, firm_name, city, address, email_id, firm_unique_no, contact_no, sort_order)
      select q.id, kind.firm_type, 'QA Firm ' || ((q.n + kind.sort_order) % 12 + 1),
        (array['New Delhi','Pune','Chennai','Bengaluru'])[q.n % 4 + 1], 'QA performance supplier address',
        'qa-perf-' || q.n || '-' || kind.sort_order || '@example.test',
        'QA-PERF-FIRM-' || ((q.n + kind.sort_order) % 12 + 1),
        '90000' || lpad(((q.n + kind.sort_order) % 100000)::text, 5, '0'), kind.sort_order
      from qa_perf_files q cross join (values ('bq',1),('invited',2),('bidder',3)) kind(firm_type, sort_order);
    `);

    await pool.query(`
      insert into supply_orders (
        file_id, include_in_payment_timing, current_milestone, completed_milestones,
        financial_sanction_date, so_no, gem_so_no, so_date, so_value_capital, so_value_revenue,
        dp_date, firm, firm_unique_no, firm_contact_no, firm_city, firm_type, psb_applicable,
        bg_coverage_type, dp_extension, dp_extension_count, ld, revised_dp, material_receipt_date,
        ir_preparation_date, ir_receipt_date, bill_preparation_date, bill_no, bill_sent_for_payment_date,
        payment_date, payment_mode, actual_payment_capital, actual_payment_revenue, firm_rating_values,
        bill_amount_capital, bill_amount_revenue, no_further_action, actual_job_completion_date,
        job_completion_date, bill_return_cycles, supplementary_bills, stage_delivery, stage_delivery_count,
        stage_payment, advance_payment, stage_deliveries, shortclosure, shortclosure_date
      )
      select q.id, true, case when q.scenario = 15 then 'Payment' else 'Delivery' end,
        case when q.scenario = 15 then '["Delivery","Payment"]'::jsonb else '["Delivery"]'::jsonb end,
        d.fs_date, 'QA/PERF/SO/' || q.n, case when q.n % 6 = 0 then 'QA/PERF/GEM-SO/' || q.n end,
        d.so_date, case when q.n % 2 = 0 then d.amount end, case when q.n % 2 = 1 then d.amount end,
        d.so_date + 150, 'QA Firm ' || (q.n % 12 + 1), 'QA-PERF-FIRM-' || (q.n % 12 + 1),
        '90000' || lpad((q.n % 100000)::text, 5, '0'), (array['New Delhi','Pune','Chennai','Bengaluru'])[q.n % 4 + 1],
        case when q.n % 4 = 0 then 'MSE' when q.n % 3 = 0 then 'Non-MSE' else 'Startup' end,
        'No', 'None', 'No', 0, 'No', case when q.scenario >= 11 then d.material_date + 60 end,
        case when q.scenario >= 11 then d.material_date end, case when q.scenario >= 12 then d.ir_prep_date end,
        case when q.scenario >= 13 then d.ir_receipt_date end, case when q.scenario >= 14 then d.bill_prep_date end,
        case when q.scenario >= 14 then 'QA/PERF/BILL/' || q.n end, case when q.scenario >= 14 then d.bill_sent_date end,
        case when q.scenario = 15 then d.payment_date end, case when q.scenario = 15 then 'PFMS' end,
        case when q.scenario = 15 and q.n % 2 = 0 then d.amount * .98 end,
        case when q.scenario = 15 and q.n % 2 = 1 then d.amount * .98 end, '{}',
        case when q.scenario >= 9 and q.n % 2 = 0 then d.amount / 10 end,
        case when q.scenario >= 9 and q.n % 2 = 1 then d.amount / 10 end, 'No',
        case when q.scenario >= 11 then d.material_date end, case when q.scenario >= 11 then d.material_date end,
        case when q.n % 17 = 0 then jsonb_build_array(jsonb_build_object('returnDate', (d.bill_sent_date + 4)::text, 'resubmissionDate', (d.bill_sent_date + 8)::text)) else '[]'::jsonb end,
        case when q.n % 13 = 0 and q.scenario >= 14 then jsonb_build_array(jsonb_build_object('billNo', 'QA/PERF/SUPP/' || q.n, 'billAmountCapital', (d.amount / 10)::text, 'billSentForPaymentDate', d.bill_sent_date::text)) else '[]'::jsonb end,
        case when q.n % 5 = 0 and q.scenario >= 11 then 'Yes' else 'No' end,
        case when q.n % 5 = 0 and q.scenario >= 11 then 2 end,
        case when q.n % 7 = 0 and q.scenario >= 14 then 'Yes' else 'No' end,
        case when q.n % 11 = 0 and q.scenario >= 14 then 'Yes' else 'No' end,
        case when q.n % 5 = 0 and q.scenario >= 11 then jsonb_build_array(
          jsonb_build_object('deliveryPeriodStartDate', (d.so_date + 30)::text, 'dpDate', (d.so_date + 120)::text, 'materialReceiptDate', d.material_date::text),
          jsonb_build_object('deliveryPeriodStartDate', (d.so_date + 80)::text, 'dpDate', (d.so_date + 170)::text)
        ) else '[]'::jsonb end,
        case when q.n % 23 = 0 and q.scenario >= 9 then 'Yes' else 'No' end,
        case when q.n % 23 = 0 and q.scenario >= 9 then d.so_date + 200 end
      from qa_perf_files q
      cross join lateral (
        select make_date(split_part(q.year, '-', 1)::integer, 4, 1) + (q.n % 45) as received_date,
          make_date(split_part(q.year, '-', 1)::integer, 4, 1) + (q.n % 45) + 70 as so_date,
          make_date(split_part(q.year, '-', 1)::integer, 4, 1) + (q.n % 45) + 60 as fs_date,
          make_date(split_part(q.year, '-', 1)::integer, 4, 1) + (q.n % 45) + 110 as material_date,
          make_date(split_part(q.year, '-', 1)::integer, 4, 1) + (q.n % 45) + 115 as ir_prep_date,
          make_date(split_part(q.year, '-', 1)::integer, 4, 1) + (q.n % 45) + 120 as ir_receipt_date,
          make_date(split_part(q.year, '-', 1)::integer, 4, 1) + (q.n % 45) + 125 as bill_prep_date,
          make_date(split_part(q.year, '-', 1)::integer, 4, 1) + (q.n % 45) + 130 as bill_sent_date,
          make_date(split_part(q.year, '-', 1)::integer, 4, 1) + (q.n % 45) + 140 as payment_date,
          (100000 + q.n * 137)::numeric as amount
      ) d where q.scenario >= 9;
    `);

    await pool.query("commit");
    const counts = await pool.query("select year, count(*)::integer as files from files where unique_code like $1 group by year order by year", [`${prefix}%`]);
    console.log(JSON.stringify({ action: "seed", database: new URL(databaseUrl).pathname.slice(1), prefix, totalFiles: 10000, byYear: counts.rows }, null, 2));
  } catch (error) {
    await pool.query("rollback");
    throw error;
  }
}

const action = process.argv[2] ?? "seed";
(action === "cleanup" ? cleanup() : seed())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
