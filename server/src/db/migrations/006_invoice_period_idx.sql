CREATE INDEX invoices_period_idx ON invoices (period_end, period_start) WHERE status <> 'cancelled';
