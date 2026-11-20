-- FORMA push: one row per installed device that enabled background reminders.
CREATE TABLE IF NOT EXISTS subs (
  id TEXT PRIMARY KEY,          -- random device token generated in the app
  endpoint TEXT NOT NULL,       -- push service URL
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  tz TEXT NOT NULL,             -- IANA time zone, e.g. Europe/Moscow
  config TEXT NOT NULL,         -- reminders, quiet hours, motivation, snooze minutes (JSON)
  state TEXT NOT NULL,          -- delivery bookkeeping (JSON)
  updated_at INTEGER NOT NULL
);
