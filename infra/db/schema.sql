CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key_prefix text NOT NULL,
  secret_hash text NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recipient_passports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_subject text NOT NULL,
  recipient_token text NOT NULL UNIQUE,
  profile jsonb NOT NULL DEFAULT '{}',
  provenance jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recommendation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL,
  actor_subject text,
  event_name text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}',
  payload jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS recommendation_events_correlation_idx ON recommendation_events(correlation_id);
CREATE INDEX IF NOT EXISTS recommendation_events_name_created_idx ON recommendation_events(event_name, created_at DESC);

CREATE TABLE IF NOT EXISTS bundle_telemetry_events (
  event_id text PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  session_id text NOT NULL,
  request_id text NOT NULL,
  bundle_id text,
  recipient_context_id text,
  event_name text NOT NULL CHECK (event_name IN (
    'bundle_requested',
    'bundle_candidate_generated',
    'bundle_viewed',
    'bundle_item_removed',
    'bundle_item_swapped',
    'bundle_added_to_cart',
    'bundle_checkout_started',
    'bundle_purchased'
  )),
  currency char(3) NOT NULL,
  target_budget numeric(14,2),
  hard_budget boolean,
  product_ids text[] NOT NULL DEFAULT '{}',
  total_value numeric(14,2),
  source text CHECK (source IN ('storefront','business','api','mcp')),
  attributes jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bundle_telemetry_request_idx ON bundle_telemetry_events(request_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS bundle_telemetry_bundle_idx ON bundle_telemetry_events(bundle_id, occurred_at DESC) WHERE bundle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS bundle_telemetry_name_idx ON bundle_telemetry_events(event_name, occurred_at DESC);

CREATE TABLE IF NOT EXISTS group_gift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_event_id text NOT NULL UNIQUE,
  organizer_subject text NOT NULL,
  product_gid text NOT NULL,
  target_amount numeric(14,2) NOT NULL CHECK (target_amount > 0),
  funded_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (funded_amount >= 0),
  currency char(3) NOT NULL,
  status text NOT NULL CHECK (status IN ('DRAFT','OPEN','FUNDED','FULFILLED','CANCELLED')),
  deadline timestamptz,
  revocation_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contributions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES group_gift_events(id) ON DELETE CASCADE,
  contributor_subject text,
  processor_reference text UNIQUE,
  amount numeric(14,2) NOT NULL CHECK (amount > 0),
  currency char(3) NOT NULL,
  state text NOT NULL CHECK (state IN ('PENDING','AUTHORIZED','CAPTURED','FAILED','REFUNDED','DISPUTED')),
  message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fulfillment_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_gid text NOT NULL,
  supplier text,
  carrier text,
  tracking_number text,
  state text NOT NULL,
  expected_delivery_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  raw jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS fulfillment_order_observed_idx ON fulfillment_observations(order_gid, observed_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type text NOT NULL,
  actor_id text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  decision text,
  correlation_id text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  payload_hash text
);
CREATE INDEX IF NOT EXISTS audit_events_correlation_idx ON audit_events(correlation_id);
CREATE INDEX IF NOT EXISTS audit_events_occurred_idx ON audit_events(occurred_at DESC);
