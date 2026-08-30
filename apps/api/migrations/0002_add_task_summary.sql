-- 0002: give every run a short, one-line summary of the task.
-- Forward only. To change something further, add 0003, never edit this file or 0001.
--
-- Deliberately NOT the full task/prompt text -- see the callout under the runs table in
-- docs/data-model.md: the full prompt can carry secrets and customer data this dashboard has no
-- reason to hold. NOT NULL with a default of '' rather than nullable, matching the style of
-- every other "always present" column on this table -- a run written before this migration
-- existed would fall back to an empty string instead of a null the rest of the codebase would
-- have to special-case.

ALTER TABLE runs ADD COLUMN task_summary TEXT NOT NULL DEFAULT '';
