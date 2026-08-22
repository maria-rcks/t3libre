-- Enable necessary extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Setup Configuration
CREATE TABLE IF NOT EXISTS setup_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  mode VARCHAR(50) NOT NULL DEFAULT 'personal' CHECK (mode IN ('personal', 'business')),
  initialized BOOLEAN NOT NULL DEFAULT FALSE,
  admin_user_id UUID,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_user_id) REFERENCES auth.users (id) ON DELETE SET NULL
);

-- User Profiles
CREATE TABLE IF NOT EXISTS user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name VARCHAR(255),
  avatar_url VARCHAR(1000),
  role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  mode_at_signup VARCHAR(50) DEFAULT 'personal',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Docker Apps
CREATE TABLE IF NOT EXISTS docker_apps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  image VARCHAR(500) NOT NULL,
  status VARCHAR(50) DEFAULT 'stopped' CHECK (status IN ('running', 'stopped', 'restarting', 'error')),
  container_id VARCHAR(255),
  ports JSONB, -- [{hostPort: 8080, containerPort: 8000, protocol: 'tcp'}, ...]
  environment_vars JSONB, -- {KEY: value, ...}
  volumes JSONB, -- [{hostPath: '/data', containerPath: '/app/data'}, ...]
  restart_policy VARCHAR(50) DEFAULT 'no' CHECK (restart_policy IN ('no', 'always', 'unless-stopped', 'on-failure')),
  memory_limit VARCHAR(50), -- e.g., '512m', '1g'
  cpu_shares INT,
  description TEXT,
  labels JSONB, -- {tier: 'production', team: 'web', ...}
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_user_id ON docker_apps (user_id);
CREATE INDEX IF NOT EXISTS idx_status ON docker_apps (status);

-- App Logs (optional: for log streaming)
CREATE TABLE IF NOT EXISTS app_logs (
  id BIGSERIAL PRIMARY KEY,
  app_id UUID NOT NULL REFERENCES docker_apps(id) ON DELETE CASCADE,
  level VARCHAR(20) DEFAULT 'info' CHECK (level IN ('debug', 'info', 'warn', 'error')),
  message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_app_id_created ON app_logs (app_id, created_at DESC);

-- Pterodactyl Configuration (for optional remote panel support)
CREATE TABLE IF NOT EXISTS pterodactyl_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  api_key VARCHAR(255) NOT NULL,
  panel_url VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id)
);

-- Shared Configuration (for setup wizard settings, feature flags, etc.)
CREATE TABLE IF NOT EXISTS shared_config (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(255) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- RLS Policies
ALTER TABLE docker_apps ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pterodactyl_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

-- MVP Customers table (Business Mode)
CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Customers RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view their own customers" ON customers
FOR SELECT USING (auth.uid() = owner_user_id);
CREATE POLICY "Users can insert their own customers" ON customers
FOR INSERT WITH CHECK (auth.uid() = owner_user_id);
CREATE POLICY "Users can update their own customers" ON customers
FOR UPDATE USING (auth.uid() = owner_user_id);
CREATE POLICY "Users can delete their own customers" ON customers
FOR DELETE USING (auth.uid() = owner_user_id);

-- Docker Apps RLS
CREATE POLICY "Users can view their own apps" ON docker_apps
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own apps" ON docker_apps
FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own apps" ON docker_apps
FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own apps" ON docker_apps
FOR DELETE USING (auth.uid() = user_id);

-- App Logs RLS
CREATE POLICY "Users can view logs for their apps" ON app_logs
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM docker_apps
    WHERE docker_apps.id = app_logs.app_id
    AND docker_apps.user_id = auth.uid()
  )
);

-- Pterodactyl Config RLS
CREATE POLICY "Users can view their own pterodactyl config" ON pterodactyl_config
FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own pterodactyl config" ON pterodactyl_config
FOR UPDATE USING (auth.uid() = user_id);

-- User Profiles RLS
CREATE POLICY "Users can view their own profile" ON user_profiles
FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update their own profile" ON user_profiles
FOR UPDATE USING (auth.uid() = id);

-- ============================================================================
-- Phase 4: Management Panel Tables
-- ============================================================================

-- Server Metrics (TPS, player count, world size, lag spikes)
CREATE TABLE IF NOT EXISTS server_metrics (
  id BIGSERIAL PRIMARY KEY,
  app_id UUID NOT NULL REFERENCES docker_apps(id) ON DELETE CASCADE,
  tps DECIMAL(5,1),
  player_count INT DEFAULT 0,
  memory_used_mb DECIMAL(10,2),
  memory_total_mb DECIMAL(10,2),
  cpu_percent DECIMAL(5,2),
  world_size_mb DECIMAL(10,2),
  lag_spike BOOLEAN DEFAULT FALSE,
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_server_metrics_app_time ON server_metrics(app_id, recorded_at DESC);

-- Access Logs (SSH login attempts, console access)
CREATE TABLE IF NOT EXISTS access_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  source_ip VARCHAR(45),
  status VARCHAR(20) DEFAULT 'success' CHECK (status IN ('success', 'failed', 'pending')),
  details TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_access_logs_user ON access_logs(user_id, created_at DESC);

-- Config Versions
CREATE TABLE IF NOT EXISTS config_versions (
  id BIGSERIAL PRIMARY KEY,
  app_id UUID NOT NULL REFERENCES docker_apps(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  config_snapshot JSONB NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  change_summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(app_id, version)
);

-- Maintenance Windows
CREATE TABLE IF NOT EXISTS maintenance_windows (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  app_id UUID REFERENCES docker_apps(id) ON DELETE CASCADE,
  starts_at TIMESTAMP WITH TIME ZONE NOT NULL,
  ends_at TIMESTAMP WITH TIME ZONE NOT NULL,
  status VARCHAR(20) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'active', 'completed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Backup Jobs
CREATE TABLE IF NOT EXISTS backup_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  app_id UUID NOT NULL REFERENCES docker_apps(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  schedule_type VARCHAR(20) DEFAULT 'manual' CHECK (schedule_type IN ('manual', 'hourly', 'daily', 'weekly')),
  retention_count INT DEFAULT 7,
  next_run TIMESTAMP WITH TIME ZONE,
  last_run TIMESTAMP WITH TIME ZONE,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Backup Status History
CREATE TABLE IF NOT EXISTS backup_status (
  id BIGSERIAL PRIMARY KEY,
  backup_job_id UUID NOT NULL REFERENCES backup_jobs(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('running', 'success', 'failed')),
  size_mb DECIMAL(10,2),
  error_message TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Alert Configurations
CREATE TABLE IF NOT EXISTS alert_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric_type VARCHAR(50) NOT NULL,
  operator VARCHAR(10) NOT NULL CHECK (operator IN ('gt', 'lt', 'gte', 'lte', 'eq')),
  threshold DECIMAL(10,2) NOT NULL,
  enabled BOOLEAN DEFAULT TRUE,
  notify_email BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Alert History
CREATE TABLE IF NOT EXISTS alert_history (
  id BIGSERIAL PRIMARY KEY,
  alert_config_id UUID REFERENCES alert_configs(id) ON DELETE CASCADE,
  metric_type VARCHAR(50) NOT NULL,
  metric_value DECIMAL(10,2) NOT NULL,
  threshold DECIMAL(10,2) NOT NULL,
  operator VARCHAR(10) NOT NULL,
  triggered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  acknowledged BOOLEAN DEFAULT FALSE
);

-- Health Checks
CREATE TABLE IF NOT EXISTS health_checks (
  id BIGSERIAL PRIMARY KEY,
  app_id UUID NOT NULL REFERENCES docker_apps(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL CHECK (status IN ('healthy', 'degraded', 'down', 'unknown')),
  response_time_ms DECIMAL(10,2),
  details JSONB,
  checked_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_health_checks_app ON health_checks(app_id, checked_at DESC);

-- Audit Trail
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id VARCHAR(255),
  old_value JSONB,
  new_value JSONB,
  ip_address VARCHAR(45),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

-- Notification Channels
CREATE TABLE IF NOT EXISTS notification_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL CHECK (type IN ('email', 'webhook', 'telegram')),
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notification_channels_user ON notification_channels(user_id);

-- ============================================================================
-- Phase 5: New Feature Tables
-- ============================================================================

-- SSH Sessions
CREATE TABLE IF NOT EXISTS ssh_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  server_id VARCHAR(255),
  server_name VARCHAR(255),
  username VARCHAR(255) DEFAULT 'root',
  jump_host VARCHAR(255),
  port INT DEFAULT 22,
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'closed', 'failed')),
  recording TEXT,
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP WITH TIME ZONE
);

-- SSH Jump Hosts
CREATE TABLE IF NOT EXISTS ssh_jump_hosts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  username VARCHAR(255) DEFAULT 'root',
  port INT DEFAULT 22,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- SSH Saved Hosts
CREATE TABLE IF NOT EXISTS ssh_saved_hosts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  host VARCHAR(255) NOT NULL,
  port INT DEFAULT 22,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- SSH Keys
CREATE TABLE IF NOT EXISTS ssh_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  public_key TEXT NOT NULL,
  fingerprint VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Server Inventory
CREATE TABLE IF NOT EXISTS server_inventory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  server_id VARCHAR(255) NOT NULL,
  server_name VARCHAR(255),
  owner VARCHAR(255),
  environment VARCHAR(50) CHECK (environment IN ('production', 'staging', 'development', 'testing')),
  region VARCHAR(100),
  provider VARCHAR(100),
  os VARCHAR(255),
  ssh_key VARCHAR(255),
  cost DECIMAL(10,2),
  tags JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(server_id)
);

-- Secrets
CREATE TABLE IF NOT EXISTS secrets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key VARCHAR(255) NOT NULL,
  value TEXT NOT NULL,
  encrypted BOOLEAN DEFAULT TRUE,
  version INT DEFAULT 1,
  rotate BOOLEAN DEFAULT FALSE,
  rotation_days INT DEFAULT 90,
  last_rotated TIMESTAMP WITH TIME ZONE,
  next_rotation TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, key)
);

-- Secret Versions
CREATE TABLE IF NOT EXISTS secret_versions (
  id BIGSERIAL PRIMARY KEY,
  secret_id UUID NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  version INT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Secret Access (RBAC)
CREATE TABLE IF NOT EXISTS secret_access (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  secret_id UUID NOT NULL REFERENCES secrets(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL,
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  granted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(secret_id, role)
);

-- Webhooks
CREATE TABLE IF NOT EXISTS webhooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  url VARCHAR(1000) NOT NULL,
  events JSONB DEFAULT '[]',
  secret VARCHAR(255),
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Webhook Delivery Logs
CREATE TABLE IF NOT EXISTS webhook_logs (
  id BIGSERIAL PRIMARY KEY,
  webhook_id UUID NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event VARCHAR(255),
  status VARCHAR(20) CHECK (status IN ('success', 'failed', 'pending')),
  response_code INT,
  response_body TEXT,
  delivered_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- API Keys
CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  key_hash VARCHAR(255) NOT NULL,
  key_prefix VARCHAR(10),
  role VARCHAR(50) DEFAULT 'user',
  expires_at TIMESTAMP WITH TIME ZONE,
  last_used_at TIMESTAMP WITH TIME ZONE,
  revoked BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Plugins
CREATE TABLE IF NOT EXISTS plugins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  source VARCHAR(1000),
  version VARCHAR(50),
  installed BOOLEAN DEFAULT TRUE,
  enabled BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, name)
);

-- Deployment Templates
CREATE TABLE IF NOT EXISTS deployment_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  type VARCHAR(50) NOT NULL,
  description TEXT,
  config JSONB NOT NULL DEFAULT '{}',
  version VARCHAR(50) DEFAULT '1.0.0',
  builtin BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Change History (for rollback/undo)
CREATE TABLE IF NOT EXISTS change_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  resource_type VARCHAR(50) NOT NULL,
  resource_id VARCHAR(255),
  action VARCHAR(50) NOT NULL,
  old_value JSONB,
  new_value JSONB,
  summary TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_change_history_resource ON change_history(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_change_history_created ON change_history(created_at DESC);

-- User Activity Timeline
CREATE TABLE IF NOT EXISTS activity_timeline (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_type VARCHAR(100) NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  ip_address VARCHAR(45),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_activity_timeline_user ON activity_timeline(user_id, created_at DESC);

-- Multi-Tenant: Organizations
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  settings JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Organization Members
CREATE TABLE IF NOT EXISTS organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role VARCHAR(50) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id)
);

-- Runbooks
CREATE TABLE IF NOT EXISTS runbooks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  steps JSONB NOT NULL DEFAULT '[]',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Runbook Executions
CREATE TABLE IF NOT EXISTS runbook_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  runbook_id UUID NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed', 'cancelled')),
  output JSONB DEFAULT '{}',
  started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Benchmark Results
CREATE TABLE IF NOT EXISTS benchmark_results (
  id BIGSERIAL PRIMARY KEY,
  server_id VARCHAR(255),
  benchmark_type VARCHAR(50),
  duration_seconds INT,
  cpu_score DECIMAL(10,2),
  memory_score DECIMAL(10,2),
  disk_score DECIMAL(10,2),
  network_score DECIMAL(10,2),
  overall_score DECIMAL(10,2),
  raw_data JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- RLS Policies for new tables
ALTER TABLE ssh_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssh_jump_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssh_saved_hosts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssh_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE server_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE secret_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE secret_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE change_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_timeline ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own SSH sessions" ON ssh_sessions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own SSH sessions" ON ssh_sessions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can view own jump hosts" ON ssh_jump_hosts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view own saved hosts" ON ssh_saved_hosts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view own SSH keys" ON ssh_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view own inventory" ON server_inventory FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own inventory" ON server_inventory FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view own secrets" ON secrets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own secrets" ON secrets FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view own webhooks" ON webhooks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own webhooks" ON webhooks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view own API keys" ON api_keys FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can manage own plugins" ON plugins FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users can view own change history" ON change_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can view own activity" ON activity_timeline FOR SELECT USING (auth.uid() = user_id);
