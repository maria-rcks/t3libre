"""Vault secrets management integration for Infra Pilot.

Provides secure storage and retrieval of secrets using HashiCorp Vault,
AWS Secrets Manager, or Azure Key Vault as backends.
"""

import json
import logging
import os
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class SecretsBackend(ABC):
    @abstractmethod
    def get_secret(self, path: str, key: Optional[str] = None) -> Any: ...
    @abstractmethod
    def set_secret(self, path: str, data: Dict) -> bool: ...
    @abstractmethod
    def delete_secret(self, path: str) -> bool: ...
    @abstractmethod
    def list_secrets(self, path: str) -> List[str]: ...


class VaultBackend(SecretsBackend):
    def __init__(
        self,
        url: Optional[str] = None,
        token: Optional[str] = None,
        role_id: Optional[str] = None,
        secret_id: Optional[str] = None,
        kubernetes_auth: bool = False,
        mount_point: str = "secret",
    ):
        self.url = url or os.environ.get("VAULT_ADDR", "http://127.0.0.1:8200")
        self.token = token or os.environ.get("VAULT_TOKEN")
        self.role_id = role_id or os.environ.get("VAULT_ROLE_ID")
        self.secret_id = secret_id or os.environ.get("VAULT_SECRET_ID")
        self.kubernetes_auth = kubernetes_auth
        self.mount_point = mount_point
        self.client = None
        self._connected = False
        self._connect()

    def _connect(self):
        try:
            import hvac

            self.client = hvac.Client(url=self.url)
            if self.token:
                self.client.token = self.token
            elif self.kubernetes_auth:
                jwt_path = "/var/run/secrets/kubernetes.io/serviceaccount/token"
                if os.path.exists(jwt_path):
                    with open(jwt_path) as f:
                        jwt = f.read().strip()
                    self.client.auth_kubernetes(
                        role=self.role_id or "infra-pilot", jwt=jwt
                    )
            elif self.role_id and self.secret_id:
                self.client.auth_approle(role_id=self.role_id, secret_id=self.secret_id)
            self._connected = self.client.is_authenticated()
        except Exception as e:
            logger.warning(f"Failed to connect to Vault: {e}")
            self._connected = False

    def check_connection(self) -> bool:
        if not self._connected:
            self._connect()
        return self._connected

    def get_secret(self, path: str, key: Optional[str] = None) -> Any:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            secret = self.client.secrets.kv.v2.read_secret_version(
                path=path, mount_point=self.mount_point
            )
            data = secret.get("data", {}).get("data", {})
            if key:
                return data.get(key)
            return data
        except Exception as e:
            logger.error(f"Failed to get secret {path}: {e}")
            raise

    def set_secret(self, path: str, data: Dict) -> bool:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            self.client.secrets.kv.v2.create_or_update_secret(
                path=path, secret=data, mount_point=self.mount_point
            )
            return True
        except Exception as e:
            logger.error(f"Failed to set secret {path}: {e}")
            return False

    def delete_secret(self, path: str) -> bool:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            self.client.secrets.kv.v2.delete_metadata_and_all_versions(
                path=path, mount_point=self.mount_point
            )
            return True
        except Exception as e:
            logger.error(f"Failed to delete secret {path}: {e}")
            return False

    def list_secrets(self, path: str) -> List[str]:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            result = self.client.secrets.kv.v2.list_secrets(
                path=path, mount_point=self.mount_point
            )
            return result.get("data", {}).get("keys", [])
        except Exception as e:
            logger.error(f"Failed to list secrets at {path}: {e}")
            return []

    def create_token(self, policies: List[str], ttl: str = "24h") -> Dict:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            result = self.client.auth_token.create(policies=policies, ttl=ttl)
            return {
                "token": result.get("auth", {}).get("client_token"),
                "policies": policies,
                "ttl": ttl,
            }
        except Exception as e:
            logger.error(f"Failed to create token: {e}")
            raise

    def renew_token(self, token: str, increment: str = "24h") -> Dict:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            result = self.client.auth_token.renew(token=token, increment=increment)
            return {"token": token, "ttl": result.get("auth", {}).get("lease_duration")}
        except Exception as e:
            logger.error(f"Failed to renew token: {e}")
            raise

    def revoke_token(self, token: str) -> bool:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            self.client.auth_token.revoke_self(token=token)
            return True
        except Exception as e:
            logger.error(f"Failed to revoke token: {e}")
            return False

    def list_policies(self) -> List[str]:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            result = self.client.sys.list_policies()
            return result.get("policies", [])
        except Exception as e:
            logger.error(f"Failed to list policies: {e}")
            return []

    def write_policy(self, name: str, policy: str) -> bool:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            self.client.sys.create_or_update_policy(name=name, policy=policy)
            return True
        except Exception as e:
            logger.error(f"Failed to write policy {name}: {e}")
            return False

    def delete_policy(self, name: str) -> bool:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            self.client.sys.delete_policy(name=name)
            return True
        except Exception as e:
            logger.error(f"Failed to delete policy {name}: {e}")
            return False

    def enable_secret_engine(
        self, engine_type: str, path: str, description: str = ""
    ) -> bool:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            self.client.sys.enable_secrets_engine(
                backend_type=engine_type, path=path, description=description
            )
            return True
        except Exception as e:
            logger.error(f"Failed to enable engine {engine_type} at {path}: {e}")
            return False

    def disable_secret_engine(self, path: str) -> bool:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            self.client.sys.disable_secrets_engine(path=path)
            return True
        except Exception as e:
            logger.error(f"Failed to disable engine at {path}: {e}")
            return False

    def generate_database_credentials(
        self, mount_point: str = "database", role: str = "infra-pilot"
    ) -> Dict:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            result = self.client.secrets.database.generate_credentials(
                mount_point=mount_point, role_name=role
            )
            return {
                "username": result.get("data", {}).get("username"),
                "password": result.get("data", {}).get("password"),
                "lease_id": result.get("lease_id"),
                "lease_duration": result.get("lease_duration"),
            }
        except Exception as e:
            logger.error(f"Failed to generate DB credentials: {e}")
            raise

    def transit_encrypt(self, mount_point: str, key_name: str, plaintext: str) -> str:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            result = self.client.secrets.transit.encrypt_data(
                mount_point=mount_point, name=key_name, plaintext=plaintext
            )
            return result.get("data", {}).get("ciphertext")
        except Exception as e:
            logger.error(f"Failed to encrypt: {e}")
            raise

    def transit_decrypt(self, mount_point: str, key_name: str, ciphertext: str) -> str:
        if not self.check_connection():
            raise RuntimeError("Not connected to Vault")
        try:
            result = self.client.secrets.transit.decrypt_data(
                mount_point=mount_point, name=key_name, ciphertext=ciphertext
            )
            return result.get("data", {}).get("plaintext")
        except Exception as e:
            logger.error(f"Failed to decrypt: {e}")
            raise


class AWSSecretsManagerBackend(SecretsBackend):
    def __init__(self, region: str = "us-east-1", profile: Optional[str] = None):
        self.region = region
        self.profile = profile
        self.client = None
        self._connect()

    def _connect(self):
        try:
            import boto3

            session = (
                boto3.Session(profile_name=self.profile, region_name=self.region)
                if self.profile
                else boto3.Session(region_name=self.region)
            )
            self.client = session.client("secretsmanager")
        except Exception as e:
            logger.warning(f"Failed to connect to AWS Secrets Manager: {e}")

    def get_secret(self, path: str, key: Optional[str] = None) -> Any:
        if not self.client:
            raise RuntimeError("Not connected to AWS Secrets Manager")
        try:
            response = self.client.get_secret_value(SecretId=path)
            secret = response.get("SecretString") or response.get("SecretBinary")
            if isinstance(secret, bytes):
                secret = secret.decode("utf-8")
            data = json.loads(secret) if secret else {}
            if key:
                return data.get(key)
            return data
        except Exception as e:
            logger.error(f"Failed to get secret {path}: {e}")
            raise

    def set_secret(self, path: str, data: Dict) -> bool:
        if not self.client:
            raise RuntimeError("Not connected to AWS Secrets Manager")
        try:
            self.client.create_secret(Name=path, SecretString=json.dumps(data))
            return True
        except self.client.exceptions.ResourceExistsException:
            self.client.update_secret(SecretId=path, SecretString=json.dumps(data))
            return True
        except Exception as e:
            logger.error(f"Failed to set secret {path}: {e}")
            return False

    def delete_secret(self, path: str) -> bool:
        if not self.client:
            raise RuntimeError("Not connected to AWS Secrets Manager")
        try:
            self.client.delete_secret(SecretId=path, ForceDeleteWithoutRecovery=True)
            return True
        except Exception as e:
            logger.error(f"Failed to delete secret {path}: {e}")
            return False

    def list_secrets(self, path: str = "") -> List[str]:
        if not self.client:
            raise RuntimeError("Not connected to AWS Secrets Manager")
        try:
            secrets = []
            paginator = self.client.get_paginator("list_secrets")
            for page in paginator.paginate():
                for secret in page.get("SecretList", []):
                    secrets.append(secret.get("Name"))
            return secrets
        except Exception as e:
            logger.error(f"Failed to list secrets: {e}")
            return []

    def rotate_secret(
        self,
        secret_id: str,
        rotation_lambda_arn: str,
        rotation_days: int = 30,
        rotation_rules: Optional[Dict] = None,
    ) -> Dict:
        if not self.client:
            raise RuntimeError("Not connected to AWS Secrets Manager")
        try:
            rules = rotation_rules or {"AutomaticallyAfterDays": rotation_days}
            self.client.rotate_secret(
                SecretId=secret_id,
                RotationRules=rules,
                RotationLambdaARN=rotation_lambda_arn,
            )
            return {
                "secret_id": secret_id,
                "rotation_enabled": True,
                "interval_days": rotation_days,
            }
        except Exception as e:
            logger.error(f"Failed to rotate secret: {e}")
            raise

    def get_secret_value(
        self,
        secret_id: str,
        version_id: Optional[str] = None,
        version_stage: Optional[str] = None,
    ) -> Dict:
        if not self.client:
            raise RuntimeError("Not connected to AWS Secrets Manager")
        try:
            kwargs = {"SecretId": secret_id}
            if version_id:
                kwargs["VersionId"] = version_id
            if version_stage:
                kwargs["VersionStage"] = version_stage
            response = self.client.get_secret_value(**kwargs)
            return {
                "arn": response.get("ARN"),
                "name": response.get("Name"),
                "version_id": response.get("VersionId"),
                "version_stages": response.get("VersionStages", []),
                "created": str(response.get("CreatedDate")),
                "secret_string": response.get("SecretString"),
            }
        except Exception as e:
            logger.error(f"Failed to get secret value: {e}")
            raise

    def restore_secret(self, secret_id: str) -> bool:
        if not self.client:
            raise RuntimeError("Not connected to AWS Secrets Manager")
        try:
            self.client.restore_secret(SecretId=secret_id)
            return True
        except Exception as e:
            logger.error(f"Failed to restore secret: {e}")
            return False


class AzureKeyVaultBackend(SecretsBackend):
    def __init__(
        self,
        vault_url: Optional[str] = None,
        tenant_id: Optional[str] = None,
        client_id: Optional[str] = None,
        client_secret: Optional[str] = None,
    ):
        self.vault_url = vault_url or os.environ.get("AZURE_KEY_VAULT_URL")
        self.tenant_id = tenant_id or os.environ.get("AZURE_TENANT_ID")
        self.client_id = client_id or os.environ.get("AZURE_CLIENT_ID")
        self.client_secret = client_secret or os.environ.get("AZURE_CLIENT_SECRET")
        self.client = None
        self._connect()

    def _connect(self):
        try:
            from azure.identity import ClientSecretCredential, DefaultAzureCredential
            from azure.keyvault.secrets import SecretClient

            if self.client_id and self.client_secret:
                credential = ClientSecretCredential(
                    tenant_id=self.tenant_id,
                    client_id=self.client_id,
                    client_secret=self.client_secret,
                )
            else:
                credential = DefaultAzureCredential()
            self.client = SecretClient(vault_url=self.vault_url, credential=credential)
        except Exception as e:
            logger.warning(f"Failed to connect to Azure Key Vault: {e}")

    def get_secret(self, path: str, key: Optional[str] = None) -> Any:
        if not self.client:
            raise RuntimeError("Not connected to Azure Key Vault")
        try:
            secret = self.client.get_secret(path)
            value = secret.value
            if key:
                try:
                    data = json.loads(value)
                    return data.get(key)
                except:
                    return None
            return value
        except Exception as e:
            logger.error(f"Failed to get secret {path}: {e}")
            raise

    def set_secret(self, path: str, data: Dict) -> bool:
        if not self.client:
            raise RuntimeError("Not connected to Azure Key Vault")
        try:
            self.client.set_secret(path, json.dumps(data))
            return True
        except Exception as e:
            logger.error(f"Failed to set secret {path}: {e}")
            return False

    def delete_secret(self, path: str) -> bool:
        if not self.client:
            raise RuntimeError("Not connected to Azure Key Vault")
        try:
            poller = self.client.begin_delete_secret(path)
            poller.wait()
            return True
        except Exception as e:
            logger.error(f"Failed to delete secret {path}: {e}")
            return False

    def list_secrets(self, path: str = "") -> List[str]:
        if not self.client:
            raise RuntimeError("Not connected to Azure Key Vault")
        try:
            return [s.name for s in self.client.list_properties_of_secrets()]
        except Exception as e:
            logger.error(f"Failed to list secrets: {e}")
            return []

    def backup_secret(self, secret_name: str) -> bytes:
        if not self.client:
            raise RuntimeError("Not connected to Azure Key Vault")
        try:
            result = self.client.backup_secret(secret_name)
            return result
        except Exception as e:
            logger.error(f"Failed to backup secret: {e}")
            raise

    def restore_secret(self, backup: bytes) -> str:
        if not self.client:
            raise RuntimeError("Not connected to Azure Key Vault")
        try:
            result = self.client.restore_secret_backup(backup)
            return result.name
        except Exception as e:
            logger.error(f"Failed to restore secret: {e}")
            raise

    def purge_deleted_secret(self, secret_name: str) -> bool:
        if not self.client:
            raise RuntimeError("Not connected to Azure Key Vault")
        try:
            self.client.purge_deleted_secret(secret_name)
            return True
        except Exception as e:
            logger.error(f"Failed to purge secret: {e}")
            return False


class SecretsManager:
    def __init__(
        self,
        backend: Optional[SecretsBackend] = None,
        backend_type: str = "vault",
        **backend_kwargs,
    ):
        self.backend_type = backend_type
        if backend:
            self.backend = backend
        elif backend_type == "vault":
            self.backend = VaultBackend(**backend_kwargs)
        elif backend_type == "aws":
            self.backend = AWSSecretsManagerBackend(**backend_kwargs)
        elif backend_type == "azure":
            self.backend = AzureKeyVaultBackend(**backend_kwargs)
        else:
            raise ValueError(f"Unknown backend type: {backend_type}")

    def get(self, path: str, key: Optional[str] = None) -> Any:
        return self.backend.get_secret(path, key)

    def set(self, path: str, data: Dict) -> bool:
        return self.backend.set_secret(path, data)

    def delete(self, path: str) -> bool:
        return self.backend.delete_secret(path)

    def list(self, path: str = "") -> List[str]:
        return self.backend.list_secrets(path)

    def get_db_credentials(self, role: str = "infra-pilot") -> Dict:
        if isinstance(self.backend, VaultBackend):
            return self.backend.generate_database_credentials(role=role)
        raise NotImplementedError(
            f"DB credential generation not supported for {self.backend_type}"
        )

    def encrypt(self, key_name: str, plaintext: str) -> str:
        if isinstance(self.backend, VaultBackend):
            return self.backend.transit_encrypt(key_name=key_name, plaintext=plaintext)
        raise NotImplementedError(f"Encryption not supported for {self.backend_type}")

    def decrypt(self, key_name: str, ciphertext: str) -> str:
        if isinstance(self.backend, VaultBackend):
            return self.backend.transit_decrypt(
                key_name=key_name, ciphertext=ciphertext
            )
        raise NotImplementedError(f"Decryption not supported for {self.backend_type}")


# Global secrets manager instance
_manager: Optional[SecretsManager] = None


def init_secrets_manager(backend: str = "vault", **kwargs) -> SecretsManager:
    """Initialise the global secrets manager.

    Pass a ``SecretsBackend`` instance directly as ``backend``, or use
    ``backend_type`` (via kwargs) for ``"vault"``, ``"aws"`` or ``"azure"``.
    """
    global _manager
    if isinstance(backend, SecretsBackend):
        _manager = SecretsManager(backend=backend)
    else:
        _manager = SecretsManager(backend_type=backend, **kwargs)
    return _manager


def get_secrets_manager() -> SecretsManager:
    if _manager is None:
        raise RuntimeError(
            "Secrets manager not initialized. Call init_secrets_manager() first."
        )
    return _manager
