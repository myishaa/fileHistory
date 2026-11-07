-- Confirmed message deletion is permanent. Remove rows soft-deleted by older versions;
-- message replies and urgent-message recipient state cascade from their parent rows.
delete from file_messages where deleted_at is not null;

do $$
begin
  if to_regclass('urgent_messages') is not null then
    execute 'delete from urgent_messages where deleted_at is not null';
  end if;
end $$;

-- Give JSON-backed rows stable IDs so a confirmed delete can target one saved row
-- without replacing unrelated unsaved edits in its containing section.
create or replace function recordkeeper_backfill_nested_row_ids(value jsonb)
returns jsonb
language plpgsql
volatile
as $$
declare
  result jsonb;
  field record;
  item record;
  next_value jsonb;
  next_array jsonb;
begin
  if jsonb_typeof(value) = 'object' then
    result := '{}'::jsonb;
    for field in select key, val from jsonb_each(value) as entry(key, val) loop
      if field.key in ('billReturnCycles', 'supplementaryBills')
         and jsonb_typeof(field.val) = 'array' then
        next_array := '[]'::jsonb;
        for item in select val from jsonb_array_elements(field.val) as entries(val) loop
          next_value := item.val;
          if jsonb_typeof(next_value) = 'object' then
            next_value := next_value || jsonb_build_object(
              'id', case
                when coalesce(next_value ->> 'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  then next_value ->> 'id'
                else gen_random_uuid()::text
              end
            );
          end if;
          next_array := next_array || jsonb_build_array(recordkeeper_backfill_nested_row_ids(next_value));
        end loop;
        result := result || jsonb_build_object(field.key, next_array);
      else
        result := result || jsonb_build_object(field.key, recordkeeper_backfill_nested_row_ids(field.val));
      end if;
    end loop;
    return result;
  elsif jsonb_typeof(value) = 'array' then
    result := '[]'::jsonb;
    for item in select val from jsonb_array_elements(value) as entries(val) loop
      result := result || jsonb_build_array(recordkeeper_backfill_nested_row_ids(item.val));
    end loop;
    return result;
  end if;
  return value;
end;
$$;

update supply_orders
set supplementary_bills = recordkeeper_backfill_nested_row_ids(
      jsonb_build_object('supplementaryBills', coalesce(supplementary_bills, '[]'::jsonb))
    ) -> 'supplementaryBills',
    bill_return_cycles = recordkeeper_backfill_nested_row_ids(
      jsonb_build_object('billReturnCycles', coalesce(bill_return_cycles, '[]'::jsonb))
    ) -> 'billReturnCycles',
    advance_payment_detail = recordkeeper_backfill_nested_row_ids(
      coalesce(advance_payment_detail, '{}'::jsonb)
    ),
    stage_deliveries = recordkeeper_backfill_nested_row_ids(
      coalesce(stage_deliveries, '[]'::jsonb)
    );

drop function recordkeeper_backfill_nested_row_ids(jsonb);
