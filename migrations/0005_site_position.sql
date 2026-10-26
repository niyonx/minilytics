-- Manual order of the sites overview (drag to reorder). NULL sorts after positioned sites, by creation.
ALTER TABLE sites ADD COLUMN position INTEGER;
