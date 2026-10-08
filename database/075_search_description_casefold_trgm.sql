CREATE INDEX IF NOT EXISTS files_demand_description_lower_trgm_idx
ON files USING gin (lower(coalesce(demand_description, '')) gin_trgm_ops);

DROP INDEX IF EXISTS files_demand_description_trgm_idx;
