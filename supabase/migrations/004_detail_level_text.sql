-- Convert min_detail_required (integer) to detail_level (text enum)

ALTER TABLE date_settings ADD COLUMN detail_level text;

UPDATE date_settings SET detail_level = CASE
  WHEN min_detail_required = 0 THEN 'none'
  WHEN min_detail_required = 1 THEN 'single'
  WHEN min_detail_required = 2 THEN 'dual_day'
  WHEN min_detail_required >= 3 THEN 'dual'
  ELSE 'single'
END;

ALTER TABLE date_settings ALTER COLUMN detail_level SET NOT NULL;
ALTER TABLE date_settings ALTER COLUMN detail_level SET DEFAULT 'single';

ALTER TABLE date_settings ADD CONSTRAINT valid_detail_level
  CHECK (detail_level IN ('none', 'single', 'dual_day', 'dual'));

ALTER TABLE date_settings DROP COLUMN min_detail_required;
