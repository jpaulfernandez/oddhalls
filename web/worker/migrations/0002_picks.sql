-- Friends' picks (plan 72): one send per device per book; the Worker never updates or deletes a row.
-- asset_ids holds the JSON array of asset ids as text, in the order the friend picked them.
CREATE TABLE picks (
  book_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  asset_ids TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  sent_at TEXT NOT NULL,
  PRIMARY KEY (book_id, device_id)
);
