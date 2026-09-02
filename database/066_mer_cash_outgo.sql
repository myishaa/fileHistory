create table if not exists mer_cash_outgo (
  financial_year text not null,
  month_key text not null,
  capital numeric not null default 0,
  revenue numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (financial_year, month_key),
  constraint mer_cash_outgo_month_key_format check (month_key ~ '^[0-9]{4}-[0-9]{2}$')
);
