-- The migration runner supports only forward migrations. This change preserves
-- every existing notification row and only expands the accepted status values.
ALTER TABLE notifications
  DROP CONSTRAINT notifications_status_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_status_check CHECK (
    status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')
  );
