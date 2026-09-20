CREATE TABLE jobs (
  id UUID PRIMARY KEY,
  status TEXT NOT NULL CHECK (
    status IN ('PENDENTE', 'PROCESSANDO', 'CONCLUÍDO', 'ERRO')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,

  source_bucket TEXT NOT NULL,
  source_object_key TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (
    source_type IN ('video', 'audio')
  ),
  source_format TEXT NOT NULL,
  target_format TEXT NOT NULL,

  result_bucket TEXT,
  result_object_key TEXT,

  notify_email TEXT NOT NULL,

  processing_token UUID,
  lease_expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT jobs_completed_result_check CHECK (
    status <> 'CONCLUÍDO'
    OR (
      result_bucket IS NOT NULL
      AND result_object_key IS NOT NULL
      AND completed_at IS NOT NULL
    )
  ),

  CONSTRAINT jobs_processing_lease_check CHECK (
    status <> 'PROCESSANDO'
    OR (
      processing_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
    )
  )
);

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY,
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE RESTRICT,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,

  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'PUBLISHING', 'PUBLISHED')
  ),
  processing_token UUID,
  lease_expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,

  CONSTRAINT outbox_events_unique_job_event UNIQUE (job_id, event_type),

  CONSTRAINT outbox_events_published_at_check CHECK (
    status <> 'PUBLISHED'
    OR published_at IS NOT NULL
  ),

  CONSTRAINT outbox_events_processing_lease_check CHECK (
    status <> 'PUBLISHING'
    OR (
      processing_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
    )
  )
);

CREATE TABLE notifications (
  job_id UUID PRIMARY KEY REFERENCES jobs(id) ON DELETE RESTRICT,

  status TEXT NOT NULL CHECK (
    status IN ('PENDING', 'SENDING', 'SENT')
  ),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,

  notification_token UUID,
  lease_expires_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,

  CONSTRAINT notifications_sent_at_check CHECK (
    status <> 'SENT'
    OR sent_at IS NOT NULL
  ),

  CONSTRAINT notifications_sending_lease_check CHECK (
    status <> 'SENDING'
    OR (
      notification_token IS NOT NULL
      AND lease_expires_at IS NOT NULL
    )
  )
);

CREATE INDEX jobs_status_lease_expires_at_idx
  ON jobs (status, lease_expires_at);

CREATE INDEX outbox_events_status_lease_expires_at_idx
  ON outbox_events (status, lease_expires_at);

CREATE INDEX notifications_status_lease_expires_at_idx
  ON notifications (status, lease_expires_at);