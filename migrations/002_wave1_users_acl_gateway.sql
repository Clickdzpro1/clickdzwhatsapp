-- Wave 1 migration — multi-WhatsApp accounts, users, ACL, gateway keys.
-- Idempotent (uses IF NOT EXISTS everywhere). Run with `migrations/run.js`.

-- ============================================
-- USERS (multi-user per tenant)
-- ============================================
-- Until now each "tenant" was a single human; team features (assign a
-- WhatsApp number to a specific operator) require users. Each SaaS tenant
-- (a row in `tenants`) now owns 1..N users; we keep the tenant JWT carrying
-- user_id going forward so server code can filter by user.

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(20) DEFAULT 'agent' CHECK (role IN ('owner', 'admin', 'agent', 'viewer')),
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_users_updated_at') THEN
    CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW
      EXECUTE FUNCTION update_updated_at();
  END IF;
END$$;

-- Backfill: each existing tenant becomes a single owner user that owns
-- the same email as the tenant. Safe to run multiple times.
INSERT INTO users (tenant_id, email, password_hash, name, role)
SELECT t.id, t.email, '', COALESCE(t.business_name, t.name), 'owner'
FROM tenants t
WHERE t.email IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM users u WHERE u.tenant_id = t.id AND u.email = t.email
  );

-- ============================================
-- TENANT GATEWAY KEYS
-- ============================================
-- Stores the API key Clickdzpro1's whatsapp-gateway (Railway) issued for
-- each SaaS tenant. Either the SaaS uses a single global tenant on the
-- gateway (Wave 1 default = "clickdz-work") with one row here, OR one row
-- per tenant if we choose to fully isolate. Today we ship the single-row
-- form because it's cut-overable without changes elsewhere.

CREATE TABLE IF NOT EXISTS tenant_gateway_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  gateway_label VARCHAR(100) NOT NULL DEFAULT 'wweb-gateway',
  gateway_tenant_external_id VARCHAR(100),  -- id the gateway returned, if known
  api_key_encrypted TEXT NOT NULL,
  api_key_last4 VARCHAR(4),
  base_url TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_tgk_label ON tenant_gateway_keys(gateway_label);

-- ============================================
-- WHATSAPP INSTANCES (the per-number workspace)
-- ============================================
-- 1 tenant ↔ N WhatsApp numbers. Each row mirrors one gateway instance:
-- holds the gateway-assigned id and a friendly name; UI renders this list.

CREATE TABLE IF NOT EXISTS whatsapp_instances (
  id UUID PRIMARY KEY,                                       -- gateway id (ten_...)
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- who created it
  name VARCHAR(120) NOT NULL,
  phone_number VARCHAR(32),
  engine VARCHAR(20) DEFAULT 'wweb' CHECK (engine IN ('wweb', 'baileys', 'cloud')),
  status VARCHAR(20) DEFAULT 'created' CHECK (status IN ('created', 'connecting', 'qr', 'connected', 'disconnected', 'logged_out')),
  last_qr TEXT,
  last_qr_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  warmup_until TIMESTAMPTZ,
  webhook_url TEXT,
  webhook_secret VARCHAR(80),
  settings JSONB DEFAULT '{}'::jsonb,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_instances_tenant_status ON whatsapp_instances(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_instances_owner ON whatsapp_instances(owner_user_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_instances_updated_at') THEN
    CREATE TRIGGER trg_instances_updated_at BEFORE UPDATE ON whatsapp_instances FOR EACH ROW
      EXECUTE FUNCTION update_updated_at();
  END IF;
END$$;

-- ============================================
-- WHATSAPP INSTANCE ACL
-- ============================================
-- Per-user visibility beyond the owner. The owner always has access;
-- `role` maps to what they can do on that instance. Used as the join
-- table in /api/whatsapp/v2/instances so a junior agent cannot see a
-- number that belongs to another team member.

CREATE TABLE IF NOT EXISTS whatsapp_instance_acl (
  tenant_id UUID NOT NULL,
  instance_id UUID NOT NULL,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'agent' CHECK (role IN ('admin', 'agent', 'viewer')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (instance_id, user_id),
  FOREIGN KEY (tenant_id, instance_id)
    REFERENCES whatsapp_instances(tenant_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_acl_user ON whatsapp_instance_acl(user_id);

-- ============================================
-- WHATSAPP EVENTS (local mirror from the gateway WS feed)
-- ============================================
-- The Wave 1 plan streams gateway events over WebSocket and we mirror them
-- locally so the React dashboard can SSR-time-list them and the queue can
-- survive a brief client disconnect.

CREATE TABLE IF NOT EXISTS whatsapp_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  instance_id UUID,
  event VARCHAR(40) NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_tenant_time ON whatsapp_events(tenant_id, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_instance_time ON whatsapp_events(instance_id, received_at DESC);

-- Auto-prune older than 14 days. Guarded by an index so it stays cheap.
-- (Wave 4 might replace with a TTL on the table; for now a daily cron is
-- enough — left out of this migration.)
