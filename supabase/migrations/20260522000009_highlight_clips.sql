CREATE TABLE highlight_clips (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id   text        NOT NULL,
  label      text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE highlight_clips ENABLE ROW LEVEL SECURITY;

CREATE POLICY "highlight_clips: active read"
  ON highlight_clips FOR SELECT
  USING (is_active());

CREATE POLICY "highlight_clips: admin write"
  ON highlight_clips FOR ALL
  USING (is_admin());
