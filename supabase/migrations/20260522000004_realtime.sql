-- Enable full-row broadcasting so Realtime subscriptions on the frontend
-- receive complete before/after row data (not just changed columns).
-- Required for the live score banner and settlement notifications.

ALTER TABLE matches     REPLICA IDENTITY FULL;
ALTER TABLE settlements REPLICA IDENTITY FULL;

-- Add both tables to the default Supabase Realtime publication.
-- The publication already exists in every Supabase project.
ALTER PUBLICATION supabase_realtime ADD TABLE matches;
ALTER PUBLICATION supabase_realtime ADD TABLE settlements;
