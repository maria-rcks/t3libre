"""RBAC engine — the decision point for every permission check.

Provides both in-memory and database-backed storage for
organizations, projects, teams, and role assignments.
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional, Set

from .models import (
    BUILT_IN_ROLES,
    Membership,
    Organization,
    Permission,
    Project,
    Role,
    Team,
)

logger = logging.getLogger(__name__)


class AccessDeniedError(PermissionError):
    """Raised when a user lacks the required permission."""


class RBACEngine:
    """Evaluates permissions against org/project/team membership."""

    def __init__(self):
        self._orgs: Dict[str, Organization] = {}
        self._projects: Dict[str, Project] = {}
        self._teams: Dict[str, Team] = {}
        self._memberships: List[Membership] = []
        self._roles: Dict[str, Role] = {}

        self._seed_builtin_roles()

    def _seed_builtin_roles(self) -> None:
        """Initialize ``self._roles`` with the built-in Role instances."""
        for name, perms in BUILT_IN_ROLES.items():
            self._roles[name] = Role(
                name=name,
                permissions=perms,
                is_builtin=True,
                description=f"Built-in {name} role",
            )

    # ------------------------------------------------------------------
    # Organization CRUD
    # ------------------------------------------------------------------
    def create_org(self, org: Organization) -> Organization:
        self._orgs[org.id] = org
        # Auto-assign owner role
        self._memberships.append(
            Membership(
                user_id=org.owner_user_id,
                org_id=org.id,
                role_name="owner",
                granted_by="system",
            )
        )
        return org

    def get_org(self, org_id: str) -> Optional[Organization]:
        return self._orgs.get(org_id)

    def delete_org(self, org_id: str) -> bool:
        self._orgs.pop(org_id, None)
        self._projects = {k: v for k, v in self._projects.items() if v.org_id != org_id}
        self._memberships = [m for m in self._memberships if m.org_id != org_id]
        return True

    def list_orgs_for_user(self, user_id: str) -> List[Organization]:
        org_ids = {m.org_id for m in self._memberships if m.user_id == user_id}
        return [self._orgs[oid] for oid in org_ids if oid in self._orgs]

    # ------------------------------------------------------------------
    # Project CRUD
    # ------------------------------------------------------------------
    def create_project(self, project: Project) -> Project:
        self._projects[project.id] = project
        return project

    def get_project(self, project_id: str) -> Optional[Project]:
        return self._projects.get(project_id)

    def delete_project(self, project_id: str) -> bool:
        project = self._projects.pop(project_id, None)
        if project:
            self._teams = {
                k: v for k, v in self._teams.items() if v.project_id != project_id
            }
        return project is not None

    def list_projects(self, org_id: str) -> List[Project]:
        return [
            p for p in self._projects.values() if p.org_id == org_id and p.is_active
        ]

    # ------------------------------------------------------------------
    # Team CRUD
    # ------------------------------------------------------------------
    def create_team(self, team: Team) -> Team:
        self._teams[team.id] = team
        return team

    def add_user_to_team(self, team_id: str, user_id: str) -> bool:
        team = self._teams.get(team_id)
        if not team:
            return False
        if user_id not in team.member_ids:
            team.member_ids.append(user_id)
            self._memberships.append(
                Membership(
                    user_id=user_id,
                    org_id=team.org_id,
                    project_id=team.project_id,
                    role_name=team.role_name,
                    granted_by="system",
                )
            )
        return True

    def remove_user_from_team(self, team_id: str, user_id: str) -> bool:
        team = self._teams.get(team_id)
        if not team:
            return False
        team.member_ids = [uid for uid in team.member_ids if uid != user_id]
        self._memberships = [
            m
            for m in self._memberships
            if not (m.user_id == user_id and m.project_id == team.project_id)
        ]
        return True

    # ------------------------------------------------------------------
    # Permission checks
    # ------------------------------------------------------------------
    def has_permission(
        self,
        user_id: str,
        permission: Permission,
        org_id: str = "",
        project_id: str = "",
    ) -> bool:
        """Check if a user has a specific permission."""
        return permission in self._resolve_permissions(user_id, org_id, project_id)

    def require_permission(
        self,
        user_id: str,
        permission: Permission,
        org_id: str = "",
        project_id: str = "",
    ) -> None:
        """Raise AccessDeniedError if the user lacks the permission."""
        if not self.has_permission(user_id, permission, org_id, project_id):
            raise AccessDeniedError(
                f"User {user_id} lacks permission '{permission.value}' "
                f"(org={org_id}, project={project_id})"
            )

    def _resolve_permissions(
        self, user_id: str, org_id: str, project_id: str
    ) -> Set[Permission]:
        """Collect all permissions for a user from all their roles."""
        perms: Set[Permission] = set()

        for membership in self._memberships:
            if membership.user_id != user_id:
                continue
            if org_id and membership.org_id != org_id:
                continue
            if project_id:
                if membership.project_id and membership.project_id != project_id:
                    continue
            elif membership.project_id:
                continue

            role = self._roles.get(membership.role_name)
            if role:
                perms.update(role.permissions)

        return perms

    # ------------------------------------------------------------------
    # Custom roles
    # ------------------------------------------------------------------
    def create_role(self, role: Role) -> Role:
        self._roles[role.name] = role
        return role

    def get_role(self, name: str) -> Optional[Role]:
        return self._roles.get(name)

    def list_roles(self) -> List[Role]:
        """Return all roles (built-in and custom) in stable name order."""
        return [self._roles[name] for name in sorted(self._roles)]

    def delete_role(self, name: str) -> bool:
        if name in BUILT_IN_ROLES:
            return False
        return self._roles.pop(name, None) is not None

    def assign_role(
        self,
        user_id: str,
        org_id: str,
        role_name: str,
        project_id: str = "",
        granted_by: str = "",
    ) -> Membership:
        membership = Membership(
            user_id=user_id,
            org_id=org_id,
            project_id=project_id,
            role_name=role_name,
            granted_by=granted_by,
        )
        self._memberships.append(membership)
        return membership

    def remove_membership(
        self, user_id: str, org_id: str, project_id: str = ""
    ) -> bool:
        before = len(self._memberships)
        self._memberships = [
            m
            for m in self._memberships
            if not (
                m.user_id == user_id
                and m.org_id == org_id
                and (not project_id or m.project_id == project_id)
            )
        ]
        return len(self._memberships) < before

    # ------------------------------------------------------------------
    # Utility
    # ------------------------------------------------------------------
    def list_members(self, org_id: str, project_id: str = "") -> List[Membership]:
        return [
            m
            for m in self._memberships
            if m.org_id == org_id and (not project_id or m.project_id == project_id)
        ]

    def to_dict(self) -> dict:
        """Export state for persistence/debugging."""
        return {
            "orgs": {k: v.__dict__ for k, v in self._orgs.items()},
            "projects": {k: v.__dict__ for k, v in self._projects.items()},
            "teams": {k: v.__dict__ for k, v in self._teams.items()},
            "memberships": [m.__dict__ for m in self._memberships],
        }

    def restore(self, state: dict) -> None:
        """Replace in-memory state with persisted state (startup load).

        Re-seeds built-in roles, then applies persisted custom roles,
        organizations and memberships. Expects plain dicts produced by
        ``rbac_store.load_rbac_state``.
        """
        self._orgs = {
            o["id"]: Organization(
                id=o["id"],
                name=o["name"],
                owner_user_id=o["owner_user_id"],
                created_at=o.get("created_at") or datetime.now(),
                updated_at=o.get("updated_at") or datetime.now(),
                settings=o.get("settings") or {},
                is_active=o.get("is_active", True),
            )
            for o in state.get("orgs", [])
        }
        self._roles = {}
        self._seed_builtin_roles()
        for r in state.get("roles", []):
            permissions: Set[Permission] = set()
            for permission_name in r.get("permissions", []):
                try:
                    permissions.add(Permission(permission_name))
                except ValueError:
                    logger.warning(
                        "Ignoring unknown permission %r on role %r",
                        permission_name,
                        r.get("name"),
                    )
            self._roles[r["name"]] = Role(
                name=r["name"],
                permissions=permissions,
                is_builtin=bool(r.get("is_builtin", False)),
                description=r.get("description", ""),
            )
        self._memberships = [
            Membership(
                user_id=m["user_id"],
                org_id=m["org_id"],
                project_id=m.get("project_id", ""),
                role_name=m["role_name"],
                granted_by=m.get("granted_by", ""),
                granted_at=m.get("granted_at") or datetime.now(),
                expires_at=m.get("expires_at"),
            )
            for m in state.get("memberships", [])
        ]
