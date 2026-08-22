"""Initial schema

Baseline captured from the previous startup-time DDL in integration.py.

All statements deliberately use IF NOT EXISTS so the migration can be
adopted on databases that already received the old bootstrap DDL. New
migrations must NOT use IF NOT EXISTS — they run exactly once on top of
this baseline.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-08-11
"""

from alembic import op

revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Core application tables ──────────────────────────────────────────
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS player_economy (
            uuid VARCHAR(255) PRIMARY KEY,
            balance DOUBLE PRECISION DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS economy_transactions (
            id SERIAL PRIMARY KEY,
            uuid VARCHAR(255) NOT NULL,
            amount DOUBLE PRECISION NOT NULL,
            type VARCHAR(50) NOT NULL,
            description TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS vps_statistics (
            id BIGSERIAL PRIMARY KEY,
            container_id VARCHAR(255) NOT NULL,
            cpu_usage DOUBLE PRECISION,
            memory_usage DOUBLE PRECISION,
            memory_used BIGINT,
            memory_total BIGINT,
            network_rx BIGINT,
            network_tx BIGINT,
            disk_usage DOUBLE PRECISION,
            status VARCHAR(50),
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_vps_stats_container ON vps_statistics(container_id);"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_vps_stats_ts ON vps_statistics(timestamp);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS vps_peak_statistics (
            container_id VARCHAR(255) PRIMARY KEY,
            peak_cpu DOUBLE PRECISION DEFAULT 0,
            peak_memory DOUBLE PRECISION DEFAULT 0,
            peak_network BIGINT DEFAULT 0,
            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS vps_containers (
            container_id VARCHAR(255) PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            container_name VARCHAR(255),
            ssh_command TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "ALTER TABLE vps_containers ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb;"
    )
    op.execute(
        "ALTER TABLE vps_containers ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'running';"
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_vps_user ON vps_containers(user_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS health_checks (
            id SERIAL PRIMARY KEY,
            container_id VARCHAR(255) NOT NULL,
            check_type VARCHAR(50) NOT NULL,
            target VARCHAR(255),
            interval_seconds INT DEFAULT 60,
            last_check TIMESTAMP,
            last_status VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_hc_container ON health_checks(container_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS health_check_results (
            id BIGSERIAL PRIMARY KEY,
            check_id INT NOT NULL,
            status VARCHAR(50) NOT NULL,
            response_time_ms INT,
            error_message TEXT,
            checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_hcr_check ON health_check_results(check_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS backup_rotation (
            id SERIAL PRIMARY KEY,
            container_id VARCHAR(255) NOT NULL,
            image_id VARCHAR(255),
            name VARCHAR(255),
            retention_type VARCHAR(20),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_backup_container ON backup_rotation(container_id);"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS snapshots (
            id SERIAL PRIMARY KEY,
            container_id VARCHAR(255) NOT NULL,
            name VARCHAR(255),
            image_id VARCHAR(255),
            snapshot_type VARCHAR(20) DEFAULT 'manual',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_snap_container ON snapshots(container_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS dns_records (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            type VARCHAR(10) DEFAULT 'A',
            value VARCHAR(255) NOT NULL,
            ttl INT DEFAULT 300,
            zone VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_dns_name ON dns_records(name);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS ssl_certificates (
            id SERIAL PRIMARY KEY,
            domain VARCHAR(255) NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            expires_at TIMESTAMP,
            issued_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_ssl_domain ON ssl_certificates(domain);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS resource_quotas (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            resource_type VARCHAR(50) NOT NULL,
            soft_limit BIGINT,
            hard_limit BIGINT,
            usage BIGINT DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (user_id, resource_type)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS load_balancer_pools (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            algorithm VARCHAR(50) DEFAULT 'round_robin',
            health_check_type VARCHAR(50) DEFAULT 'tcp',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS lb_pool_members (
            id SERIAL PRIMARY KEY,
            pool_id INT NOT NULL REFERENCES load_balancer_pools(id) ON DELETE CASCADE,
            container_id VARCHAR(255) NOT NULL,
            host VARCHAR(255),
            port INT,
            weight INT DEFAULT 1,
            enabled BOOLEAN DEFAULT TRUE,
            UNIQUE (pool_id, container_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS recovery_playbooks (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            steps JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS recovery_executions (
            id SERIAL PRIMARY KEY,
            playbook_id INT NOT NULL REFERENCES recovery_playbooks(id) ON DELETE CASCADE,
            container_id VARCHAR(255) NOT NULL,
            status VARCHAR(50) DEFAULT 'pending',
            current_step INT DEFAULT 0,
            error_message TEXT,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_recovery_container ON recovery_executions(container_id);"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS templates (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            version INT DEFAULT 1,
            config JSONB,
            created_by VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (name, version)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            task_type VARCHAR(50) NOT NULL,
            target_app_id VARCHAR(255),
            target_container_id VARCHAR(255),
            cron_expression VARCHAR(100) NOT NULL,
            command TEXT,
            enabled BOOLEAN DEFAULT TRUE,
            created_by VARCHAR(255),
            last_run_at TIMESTAMP,
            last_run_status VARCHAR(50),
            next_run_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS dr_plans (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            plan_type VARCHAR(50) NOT NULL,
            status VARCHAR(50) DEFAULT 'ready',
            config JSONB,
            rto_actual_seconds INT,
            rpo_actual_seconds INT,
            last_drill TIMESTAMP,
            last_drill_status VARCHAR(50),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS dr_drills (
            id SERIAL PRIMARY KEY,
            plan_id INT NOT NULL REFERENCES dr_plans(id) ON DELETE CASCADE,
            status VARCHAR(50) DEFAULT 'pending',
            steps JSONB,
            current_step INT DEFAULT 0,
            rto_achieved INT,
            rpo_achieved INT,
            error_message TEXT,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_drill_plan ON dr_drills(plan_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS runbooks (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            description TEXT,
            steps JSONB,
            gates JSONB,
            rollback JSONB,
            trigger_type VARCHAR(50) DEFAULT 'manual',
            trigger_config JSONB,
            enabled BOOLEAN DEFAULT TRUE,
            created_by VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS runbook_executions (
            id SERIAL PRIMARY KEY,
            runbook_id INT NOT NULL REFERENCES runbooks(id) ON DELETE CASCADE,
            status VARCHAR(50) DEFAULT 'pending',
            current_step INT DEFAULT 0,
            step_results JSONB,
            triggered_by VARCHAR(255),
            error_message TEXT,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_runbook_exec ON runbook_executions(runbook_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS synthetic_checks (
            id SERIAL PRIMARY KEY,
            check_type VARCHAR(20) NOT NULL,
            target VARCHAR(500) NOT NULL,
            interval_minutes INT DEFAULT 5,
            probe_location VARCHAR(100),
            config JSONB,
            enabled BOOLEAN DEFAULT TRUE,
            last_status VARCHAR(50),
            last_checked_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_sc_type ON synthetic_checks(check_type);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_sc_enabled ON synthetic_checks(enabled);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS synthetic_check_results (
            id BIGSERIAL PRIMARY KEY,
            check_id INT NOT NULL REFERENCES synthetic_checks(id) ON DELETE CASCADE,
            probe_location VARCHAR(100),
            status VARCHAR(50) NOT NULL,
            response_time_ms INT,
            status_code INT,
            error_message TEXT,
            checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_scr_check ON synthetic_check_results(check_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_scr_ts ON synthetic_check_results(checked_at);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scan_results (
            id SERIAL PRIMARY KEY,
            image_name VARCHAR(500) NOT NULL,
            scanner VARCHAR(50) DEFAULT 'trivy',
            status VARCHAR(50) DEFAULT 'pending',
            summary JSONB,
            vulnerabilities JSONB,
            auto_remediation_pr VARCHAR(500),
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_scan_image ON scan_results(image_name);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_scan_status ON scan_results(status);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scan_policies (
            id SERIAL PRIMARY KEY,
            severity VARCHAR(50) NOT NULL UNIQUE,
            action VARCHAR(50) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS scan_allowlist (
            id SERIAL PRIMARY KEY,
            cve_id VARCHAR(50) NOT NULL UNIQUE,
            reason TEXT,
            added_by VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS alerts (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            container_id VARCHAR(255),
            alert_type VARCHAR(50) NOT NULL,
            threshold DOUBLE PRECISION,
            channel VARCHAR(50) DEFAULT 'dm',
            enabled BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_alert_user ON alerts(user_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS k8s_clusters (
            name VARCHAR(255) PRIMARY KEY,
            status VARCHAR(50) DEFAULT 'starting',
            node_count INT DEFAULT 1,
            type VARCHAR(50) DEFAULT 'k3s',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS edge_nodes (
            name VARCHAR(255) PRIMARY KEY,
            location VARCHAR(255) NOT NULL,
            status VARCHAR(50) DEFAULT 'registered',
            last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS faas_functions (
            name VARCHAR(255) PRIMARY KEY,
            repo VARCHAR(512) NOT NULL,
            status VARCHAR(50) DEFAULT 'active',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS cloud_pricing_cache (
            id SERIAL PRIMARY KEY,
            provider VARCHAR(50) NOT NULL,
            instance_type VARCHAR(100) NOT NULL,
            price_monthly DECIMAL(10,2) NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (provider, instance_type)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS optimization_recommendations (
            id VARCHAR(50) PRIMARY KEY,
            vps_id VARCHAR(255) NOT NULL,
            analysis JSONB,
            status VARCHAR(20) DEFAULT 'pending',
            applied_by VARCHAR(255),
            applied_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_opt_vps ON optimization_recommendations(vps_id);"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_opt_status ON optimization_recommendations(status);"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS threat_incidents (
            id VARCHAR(50) PRIMARY KEY,
            vps_id VARCHAR(255) NOT NULL,
            anomaly_score DOUBLE PRECISION DEFAULT 0,
            alerts JSONB,
            stats JSONB,
            status VARCHAR(20) DEFAULT 'open',
            detected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_threat_vps ON threat_incidents(vps_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_threat_status ON threat_incidents(status);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS capacity_forecasts (
            id VARCHAR(50) PRIMARY KEY,
            vps_id VARCHAR(255) NOT NULL,
            forecast JSONB,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_forecast_vps ON capacity_forecasts(vps_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS gitops_sync_state (
            id VARCHAR(50) PRIMARY KEY,
            vps_id VARCHAR(255) NOT NULL,
            config_snapshot JSONB,
            version_id VARCHAR(50),
            sync_type VARCHAR(20) DEFAULT 'sync',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_gitops_vps ON gitops_sync_state(vps_id);")

    # ── RBAC tables (multi-tenant organizations, projects, teams, roles) ──
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS organizations (
            id VARCHAR(36) PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            owner_user_id VARCHAR(255) NOT NULL,
            settings JSONB,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_org_owner ON organizations(owner_user_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS projects (
            id VARCHAR(36) PRIMARY KEY,
            org_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            description TEXT,
            labels JSONB,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_project_org ON projects(org_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS teams (
            id VARCHAR(36) PRIMARY KEY,
            org_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            project_id VARCHAR(36) NOT NULL,
            name VARCHAR(255) NOT NULL,
            role_name VARCHAR(50) DEFAULT 'viewer',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_team_project ON teams(project_id);")
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS team_members (
            team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
            user_id VARCHAR(255) NOT NULL,
            PRIMARY KEY (team_id, user_id)
        )
        """
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS role_assignments (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR(255) NOT NULL,
            org_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
            project_id VARCHAR(36),
            role_name VARCHAR(50) NOT NULL,
            granted_by VARCHAR(255),
            expires_at TIMESTAMP,
            granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    op.execute("CREATE INDEX IF NOT EXISTS idx_role_user ON role_assignments(user_id);")
    op.execute("CREATE INDEX IF NOT EXISTS idx_role_org ON role_assignments(org_id);")
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_role_assignment "
        "ON role_assignments (user_id, org_id, project_id) NULLS NOT DISTINCT;"
    )
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS roles (
            name VARCHAR(50) PRIMARY KEY,
            permissions JSONB NOT NULL,
            is_builtin BOOLEAN DEFAULT FALSE,
            description TEXT
        )
        """
    )


def downgrade() -> None:
    """Drop all tables created by the baseline migration.

    Intentionally destructive — only ever run against a disposable
    database (e.g. CI or local development).
    """
    # Foreign keys first, then their parents.
    for table in (
        "team_members",
        "teams",
        "role_assignments",
        "projects",
        "organizations",
        "roles",
        "lb_pool_members",
        "load_balancer_pools",
        "recovery_executions",
        "recovery_playbooks",
        "dr_drills",
        "dr_plans",
        "runbook_executions",
        "runbooks",
        "synthetic_check_results",
        "synthetic_checks",
        "scan_results",
        "scan_policies",
        "scan_allowlist",
        "gitops_sync_state",
        "capacity_forecasts",
        "threat_incidents",
        "optimization_recommendations",
        "cloud_pricing_cache",
        "faas_functions",
        "edge_nodes",
        "k8s_clusters",
        "alerts",
        "templates",
        "scheduled_tasks",
        "resource_quotas",
        "ssl_certificates",
        "dns_records",
        "snapshots",
        "backup_rotation",
        "health_check_results",
        "health_checks",
        "vps_peak_statistics",
        "vps_statistics",
        "vps_containers",
        "economy_transactions",
        "player_economy",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table} CASCADE;")
