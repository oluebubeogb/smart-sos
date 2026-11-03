-- Soft-delete (trash) + failed-request detail on partner activity
ALTER TABLE partner_activity ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE partner_activity ADD COLUMN IF NOT EXISTS detail text;
ALTER TABLE partner_keys ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE partner_keys ADD COLUMN IF NOT EXISTS enabled_before_delete boolean NULL;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE admins ADD COLUMN IF NOT EXISTS trash_meta jsonb NULL;
CREATE INDEX IF NOT EXISTS partner_keys_deleted ON partner_keys(deleted_at);
CREATE INDEX IF NOT EXISTS admins_deleted ON admins(deleted_at);
