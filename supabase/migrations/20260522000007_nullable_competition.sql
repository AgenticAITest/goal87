-- api_competition_id and api_season are set via the pull-fixtures flow, not at tournament creation
ALTER TABLE tournaments ALTER COLUMN api_competition_id DROP NOT NULL;
ALTER TABLE tournaments ALTER COLUMN api_season         DROP NOT NULL;
