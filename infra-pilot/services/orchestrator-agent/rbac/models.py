"""Data models for the multi-tenant RBAC system."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Set


# ---------------------------------------------------------------------------
# Fine-grained permissions
# ---------------------------------------------------------------------------
class Permission(str, Enum):
    """Every discrete action that can be permitted or denied."""

    # Instance lifecycle
    INSTANCE_CREATE = "instance:create"
    INSTANCE_READ = "instance:read"
    INSTANCE_UPDATE = "instance:update"
    INSTANCE_DELETE = "instance:delete"
    INSTANCE_START = "instance:start"
    INSTANCE_STOP = "instance:stop"
    INSTANCE_RESTART = "instance:restart"

    # Snapshots & backups
    SNAPSHOT_CREATE = "snapshot:create"
    SNAPSHOT_RESTORE = "snapshot:restore"
    BACKUP_CREATE = "backup:create"
    BACKUP_RESTORE = "backup:restore"

    # Networking
    NETWORK_CREATE = "network:create"
    NETWORK_READ = "network:read"
    NETWORK_UPDATE = "network:update"
    NETWORK_DELETE = "network:delete"

    # DNS
    DNS_CREATE = "dns:create"
    DNS_UPDATE = "dns:update"
    DNS_DELETE = "dns:delete"

    # Billing & cost
    BILLING_READ = "billing:read"
    BILLING_MANAGE = "billing:manage"

    # RBAC administration
    ORG_MANAGE = "org:manage"
    ORG_DELETE = "org:delete"
    PROJECT_MANAGE = "project:manage"
    PROJECT_DELETE = "project:delete"
    ROLE_ASSIGN = "role:assign"
    MEMBER_INVITE = "member:invite"
    MEMBER_REMOVE = "member:remove"

    # Audit
    AUDIT_READ = "audit:read"
    AUDIT_EXPORT = "audit:export"

    # GitOps
    MANIFEST_DEPLOY = "manifest:deploy"
    MANIFEST_READ = "manifest:read"
    DRIFT_VIEW = "drift:view"
    DRIFT_OVERRIDE = "drift:override"


ALL_PERMISSIONS: Set[Permission] = set(Permission)


# ---------------------------------------------------------------------------
# Built-in roles
# ---------------------------------------------------------------------------
BUILT_IN_ROLES: Dict[str, Set[Permission]] = {
    "owner": set(Permission),
    "admin": set(Permission) - {Permission.ORG_DELETE},
    "operator": {
        Permission.INSTANCE_CREATE,
        Permission.INSTANCE_READ,
        Permission.INSTANCE_UPDATE,
        Permission.INSTANCE_DELETE,
        Permission.INSTANCE_START,
        Permission.INSTANCE_STOP,
        Permission.INSTANCE_RESTART,
        Permission.SNAPSHOT_CREATE,
        Permission.SNAPSHOT_RESTORE,
        Permission.BACKUP_CREATE,
        Permission.BACKUP_RESTORE,
        Permission.NETWORK_READ,
        Permission.DNS_CREATE,
        Permission.DNS_UPDATE,
        Permission.DNS_DELETE,
        Permission.MANIFEST_DEPLOY,
        Permission.MANIFEST_READ,
        Permission.DRIFT_VIEW,
    },
    "developer": {
        Permission.INSTANCE_READ,
        Permission.INSTANCE_START,
        Permission.INSTANCE_STOP,
        Permission.INSTANCE_RESTART,
        Permission.INSTANCE_UPDATE,
        Permission.SNAPSHOT_CREATE,
        Permission.SNAPSHOT_RESTORE,
        Permission.BACKUP_CREATE,
        Permission.BACKUP_RESTORE,
        Permission.NETWORK_READ,
        Permission.MANIFEST_READ,
        Permission.DRIFT_VIEW,
    },
    "viewer": {
        Permission.INSTANCE_READ,
        Permission.NETWORK_READ,
        Permission.MANIFEST_READ,
        Permission.DRIFT_VIEW,
        Permission.BILLING_READ,
        Permission.AUDIT_READ,
    },
    "billing": {
        Permission.BILLING_READ,
        Permission.BILLING_MANAGE,
        Permission.INSTANCE_READ,
        Permission.AUDIT_READ,
        Permission.AUDIT_EXPORT,
    },
}


# ---------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------
@dataclass
class Role:
    """A named set of permissions."""

    name: str
    permissions: Set[Permission]
    is_builtin: bool = False
    description: str = ""


@dataclass
class Organization:
    """Top-level tenant — owns projects, billing, and members."""

    id: str
    name: str
    owner_user_id: str
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    settings: Dict[str, Any] = field(default_factory=dict)
    is_active: bool = True


@dataclass
class Project:
    """A logical grouping of infrastructure within an organization."""

    id: str
    org_id: str
    name: str
    description: str = ""
    created_at: datetime = field(default_factory=datetime.now)
    updated_at: datetime = field(default_factory=datetime.now)
    labels: Dict[str, str] = field(default_factory=dict)
    is_active: bool = True


@dataclass
class Team:
    """A group of users with a shared role within a project."""

    id: str
    org_id: str
    project_id: str
    name: str
    role_name: str = "viewer"
    created_at: datetime = field(default_factory=datetime.now)
    member_ids: List[str] = field(default_factory=list)


@dataclass
class Membership:
    """A user's role binding within an organization or project."""

    user_id: str
    org_id: str
    project_id: str = ""
    role_name: str = "viewer"
    granted_by: str = ""
    granted_at: datetime = field(default_factory=datetime.now)
    expires_at: Optional[datetime] = None
