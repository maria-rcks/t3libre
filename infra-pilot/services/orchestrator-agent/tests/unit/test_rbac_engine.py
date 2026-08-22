"""Tests for the multi-tenant RBAC engine."""

import uuid

import pytest
from rbac.engine import AccessDeniedError, RBACEngine
from rbac.models import BUILT_IN_ROLES, Organization, Permission, Project, Role, Team


@pytest.fixture
def engine():
    return RBACEngine()


@pytest.fixture
def org(engine):
    o = Organization(id=str(uuid.uuid4()), name="test-org", owner_user_id="user-1")
    engine.create_org(o)
    return o


@pytest.fixture
def project(engine, org):
    p = Project(id=str(uuid.uuid4()), org_id=org.id, name="test-project")
    engine.create_project(p)
    return p


class TestOrganizationManagement:
    def test_create_org(self, engine):
        o = Organization(id="o1", name="my-org", owner_user_id="alice")
        engine.create_org(o)
        assert engine.get_org("o1") is o
        assert engine.has_permission("alice", Permission.ORG_MANAGE, org_id="o1")

    def test_delete_org(self, engine):
        o = Organization(id="o2", name="temp", owner_user_id="bob")
        engine.create_org(o)
        assert engine.delete_org("o2") is True
        assert engine.get_org("o2") is None

    def test_list_orgs_for_user(self, engine):
        o1 = Organization(id="o3", name="org-a", owner_user_id="alice")
        o2 = Organization(id="o4", name="org-b", owner_user_id="alice")
        engine.create_org(o1)
        engine.create_org(o2)
        orgs = engine.list_orgs_for_user("alice")
        assert len(orgs) == 2


class TestProjectManagement:
    def test_create_project(self, engine, org):
        p = Project(id="p1", org_id=org.id, name="infra")
        engine.create_project(p)
        assert engine.get_project("p1") is p

    def test_delete_project(self, engine, org):
        p = Project(id="p2", org_id=org.id, name="temp")
        engine.create_project(p)
        assert engine.delete_project("p2") is True
        assert engine.get_project("p2") is None

    def test_list_projects(self, engine, org):
        for i in range(3):
            engine.create_project(Project(id=f"p{i}", org_id=org.id, name=f"proj-{i}"))
        assert len(engine.list_projects(org.id)) == 3


class TestPermissionChecks:
    def test_owner_has_all_permissions(self, engine, org):
        assert engine.has_permission(
            "user-1", Permission.INSTANCE_CREATE, org_id=org.id
        )
        assert engine.has_permission("user-1", Permission.ORG_DELETE, org_id=org.id)
        assert engine.has_permission("user-1", Permission.BILLING_MANAGE, org_id=org.id)

    def test_require_permission_passes(self, engine, org):
        engine.require_permission("user-1", Permission.INSTANCE_READ, org_id=org.id)

    def test_require_permission_fails(self, engine, org):
        with pytest.raises(AccessDeniedError):
            engine.require_permission(
                "unknown", Permission.INSTANCE_READ, org_id=org.id
            )

    def test_scoped_to_org(self, engine):
        o1 = Organization(id="scope1", name="scope-org", owner_user_id="alice")
        o2 = Organization(id="scope2", name="other-org", owner_user_id="bob")
        engine.create_org(o1)
        engine.create_org(o2)
        assert engine.has_permission("alice", Permission.INSTANCE_READ, org_id="scope1")
        assert not engine.has_permission(
            "alice", Permission.INSTANCE_READ, org_id="scope2"
        )


class TestTeamAndAssignment:
    def test_team_creation(self, engine, org, project):
        team = Team(
            id="t1",
            org_id=org.id,
            project_id=project.id,
            name="devs",
            role_name="developer",
        )
        engine.create_team(team)
        engine.add_user_to_team("t1", "charlie")
        assert "charlie" in team.member_ids
        assert engine.has_permission(
            "charlie", Permission.INSTANCE_START, org_id=org.id, project_id=project.id
        )

    def test_remove_from_team(self, engine, org, project):
        team = Team(
            id="t2",
            org_id=org.id,
            project_id=project.id,
            name="temps",
            role_name="viewer",
        )
        engine.create_team(team)
        engine.add_user_to_team("t2", "dave")
        assert engine.has_permission(
            "dave", Permission.INSTANCE_READ, org_id=org.id, project_id=project.id
        )
        engine.remove_user_from_team("t2", "dave")
        assert "dave" not in team.member_ids

    def test_assign_role_directly(self, engine, org):
        engine.assign_role("eve", org.id, "billing")
        assert engine.has_permission("eve", Permission.BILLING_READ, org_id=org.id)
        assert not engine.has_permission(
            "eve", Permission.INSTANCE_CREATE, org_id=org.id
        )

    def test_remove_membership(self, engine, org):
        engine.assign_role("frank", org.id, "viewer")
        assert engine.has_permission("frank", Permission.INSTANCE_READ, org_id=org.id)
        engine.remove_membership("frank", org.id)
        assert not engine.has_permission(
            "frank", Permission.INSTANCE_READ, org_id=org.id
        )


class TestCustomRoles:
    def test_create_custom_role(self, engine):
        role = Role(
            name="custom-deployer",
            permissions={
                Permission.INSTANCE_READ,
                Permission.INSTANCE_UPDATE,
                Permission.MANIFEST_DEPLOY,
            },
        )
        engine.create_role(role)
        assert engine.get_role("custom-deployer") is role

    def test_cannot_delete_builtin(self, engine):
        assert engine.delete_role("owner") is False

    def test_custom_role_assignment(self, engine, org):
        role = Role(
            name="pci-auditor",
            permissions={
                Permission.AUDIT_READ,
                Permission.AUDIT_EXPORT,
                Permission.INSTANCE_READ,
            },
        )
        engine.create_role(role)
        engine.assign_role("grace", org.id, "pci-auditor")
        assert engine.has_permission("grace", Permission.AUDIT_READ, org_id=org.id)
        assert not engine.has_permission(
            "grace", Permission.INSTANCE_CREATE, org_id=org.id
        )


class TestBuiltInRoles:
    def test_all_builtin_roles_exist(self, engine):
        for name in BUILT_IN_ROLES:
            role = engine.get_role(name)
            assert role is not None
            assert role.is_builtin

    def test_viewer_limited(self, engine, org):
        engine.assign_role("ivy", org.id, "viewer")
        assert engine.has_permission("ivy", Permission.INSTANCE_READ, org_id=org.id)
        assert not engine.has_permission(
            "ivy", Permission.INSTANCE_CREATE, org_id=org.id
        )
        assert not engine.has_permission("ivy", Permission.ORG_MANAGE, org_id=org.id)

    def test_operator_cannot_delete_org(self, engine, org):
        engine.assign_role("kate", org.id, "operator")
        assert engine.has_permission("kate", Permission.INSTANCE_CREATE, org_id=org.id)
        assert not engine.has_permission("kate", Permission.ORG_DELETE, org_id=org.id)


class TestProjectScopingRegression:
    """A project-scoped membership must not grant org-wide access."""

    def test_project_membership_does_not_leak_org_wide(self, engine, org, project):
        engine.assign_role("zoe", org.id, "viewer", project_id=project.id)
        assert engine.has_permission(
            "zoe", Permission.INSTANCE_READ, org_id=org.id, project_id=project.id
        )
        assert not engine.has_permission("zoe", Permission.INSTANCE_READ, org_id=org.id)

    def test_org_wide_membership_still_grants_project_access(
        self, engine, org, project
    ):
        engine.assign_role("yara", org.id, "operator")
        assert engine.has_permission(
            "yara", Permission.INSTANCE_READ, org_id=org.id, project_id=project.id
        )


class TestRoleListing:
    def test_list_roles_returns_sorted_builtin_and_custom(self, engine):
        engine.create_role(
            Role(name="zeta-role", permissions={Permission.INSTANCE_READ})
        )
        names = [r.name for r in engine.list_roles()]
        assert "admin" in names
        assert "zeta-role" in names
        assert names == sorted(names)

    def test_custom_role_deletion(self, engine):
        engine.create_role(
            Role(name="tmp-role", permissions={Permission.INSTANCE_READ})
        )
        assert engine.delete_role("tmp-role") is True
        assert engine.get_role("tmp-role") is None


class TestMembersAndCascade:
    def test_list_members_filters_by_project(self, engine, org, project):
        other = Project(id="p-other", org_id=org.id, name="other")
        engine.create_project(other)
        engine.assign_role("liam", org.id, "viewer", project_id=project.id)
        engine.assign_role("mia", org.id, "viewer", project_id=other.id)
        user_ids = {m.user_id for m in engine.list_members(org.id)}
        assert {"user-1", "liam", "mia"} <= user_ids
        assert {m.user_id for m in engine.list_members(org.id, project.id)} == {"liam"}

    def test_delete_org_cascades_projects_and_memberships(self, engine, org, project):
        engine.assign_role("noah", org.id, "viewer")
        assert engine.delete_org(org.id) is True
        assert engine.get_org(org.id) is None
        assert engine.get_project(project.id) is None
        assert engine.list_members(org.id) == []

    def test_to_dict_exports_state(self, engine, org):
        state = engine.to_dict()
        assert org.id in state["orgs"]
        assert any(
            m["user_id"] == "user-1" and m["role_name"] == "owner"
            for m in state["memberships"]
        )
