import json
import logging
import os
import time
from datetime import datetime
from typing import Dict, Optional

import docker
import mysql.connector
import psutil


class ResourceMonitor:
    def __init__(self, config_path: str = "config.json"):
        self.docker_client = docker.from_env()
        self.config = self.load_config(config_path)
        self.db_connection = self.connect_to_database()
        self.containers_cache = {}

    def load_config(self, config_path: str) -> dict:
        try:
            with open(config_path, "r") as f:
                return json.load(f)
        except Exception as e:
            logging.error(f"Error loading config: {str(e)}")
            return {}

    def connect_to_database(self) -> mysql.connector.connection.MySQLConnection:
        return mysql.connector.connect(
            host=self.config["db_host"],
            user=self.config["db_user"],
            password=self.config["db_password"],
            database=self.config["db_name"],
        )

    def collect_system_stats(self) -> Dict:
        """Collect overall system statistics"""
        return {
            "cpu_percent": psutil.cpu_percent(interval=1),
            "memory": dict(psutil.virtual_memory()._asdict()),
            "disk": {
                mount.mountpoint: dict(psutil.disk_usage(mount.mountpoint)._asdict())
                for mount in psutil.disk_partitions()
                if mount.fstype
            },
            "network": dict(psutil.net_io_counters()._asdict()),
            "timestamp": datetime.now().isoformat(),
        }

    def collect_container_stats(self, container_id: str) -> Optional[Dict]:
        """Collect statistics for a specific container"""
        try:
            container = self.docker_client.containers.get(container_id)
            stats = container.stats(stream=False)

            # Calculate CPU usage
            cpu_delta = (
                stats["cpu_stats"]["cpu_usage"]["total_usage"]
                - stats["precpu_stats"]["cpu_usage"]["total_usage"]
            )
            system_delta = (
                stats["cpu_stats"]["system_cpu_usage"]
                - stats["precpu_stats"]["system_cpu_usage"]
            )
            cpu_usage = (cpu_delta / system_delta) * 100.0 if system_delta > 0 else 0.0

            # Calculate memory usage
            memory_usage = stats["memory_stats"]["usage"]
            memory_limit = stats["memory_stats"]["limit"]
            memory_percent = (memory_usage / memory_limit) * 100.0

            # Calculate network usage
            network_stats = stats["networks"]["eth0"]
            rx_bytes = network_stats["rx_bytes"]
            tx_bytes = network_stats["tx_bytes"]

            # Get disk usage
            disk_stats = container.exec_run("df -h /").output.decode()
            disk_percent = float(disk_stats.split()[11].strip("%"))

            return {
                "container_id": container_id,
                "name": container.name,
                "status": container.status,
                "cpu_usage": round(cpu_usage, 2),
                "memory_usage": round(memory_percent, 2),
                "memory_used": memory_usage,
                "memory_total": memory_limit,
                "network": {"rx_bytes": rx_bytes, "tx_bytes": tx_bytes},
                "disk_usage": disk_percent,
                "timestamp": datetime.now().isoformat(),
            }
        except Exception as e:
            logging.error(
                f"Error collecting container stats for {container_id}: {str(e)}"
            )
            return None

    def update_database(self, container_id: str, stats: Dict):
        """Update container statistics in the database"""
        try:
            cursor = self.db_connection.cursor()

            # Insert current stats
            query = """
                INSERT INTO vps_statistics 
                (container_id, cpu_usage, memory_usage, memory_used, memory_total,
                network_rx, network_tx, disk_usage, status, timestamp)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """
            values = (
                container_id,
                stats["cpu_usage"],
                stats["memory_usage"],
                stats["memory_used"],
                stats["memory_total"],
                stats["network"]["rx_bytes"],
                stats["network"]["tx_bytes"],
                stats["disk_usage"],
                stats["status"],
                stats["timestamp"],
            )
            cursor.execute(query, values)

            # Update peak statistics
            peak_query = """
                INSERT INTO vps_peak_statistics 
                (container_id, peak_cpu, peak_memory, peak_network, last_updated)
                VALUES (%s, %s, %s, %s, NOW())
                ON DUPLICATE KEY UPDATE
                peak_cpu = GREATEST(peak_cpu, VALUES(peak_cpu)),
                peak_memory = GREATEST(peak_memory, VALUES(peak_memory)),
                peak_network = GREATEST(peak_network, VALUES(peak_network)),
                last_updated = NOW()
            """
            peak_values = (
                container_id,
                stats["cpu_usage"],
                stats["memory_usage"],
                max(stats["network"]["rx_bytes"], stats["network"]["tx_bytes"]),
            )
            cursor.execute(peak_query, peak_values)

            self.db_connection.commit()
            cursor.close()
        except Exception as e:
            logging.error(f"Error updating database: {str(e)}")
            if not self.db_connection.is_connected():
                self.db_connection = self.connect_to_database()

    def cleanup_old_stats(self, days_to_keep: int = 30):
        """Clean up statistics older than specified days"""
        try:
            cursor = self.db_connection.cursor()
            cleanup_query = """
                DELETE FROM vps_statistics 
                WHERE timestamp < DATE_SUB(NOW(), INTERVAL %s DAY)
            """
            cursor.execute(cleanup_query, (days_to_keep,))
            self.db_connection.commit()
            cursor.close()
        except Exception as e:
            logging.error(f"Error cleaning up old stats: {str(e)}")

    def monitor_resources(self, interval: int = 60):
        """Main monitoring loop"""
        while True:
            try:
                # Update container cache
                containers = self.docker_client.containers.list()
                self.containers_cache = {
                    container.id: container.name for container in containers
                }

                # Collect and store stats for each container
                for container_id in self.containers_cache:
                    stats = self.collect_container_stats(container_id)
                    if stats:
                        self.update_database(container_id, stats)

                # Clean up old statistics once per day
                if datetime.now().hour == 0:
                    self.cleanup_old_stats()

                time.sleep(interval)
            except Exception as e:
                logging.error(f"Error in monitoring loop: {str(e)}")
                time.sleep(10)  # Wait before retrying

    def get_container_history(
        self, container_id: str, hours: int = 24
    ) -> Optional[Dict]:
        """Get historical statistics for a container"""
        try:
            cursor = self.db_connection.cursor(dictionary=True)
            query = """
                SELECT *
                FROM vps_statistics
                WHERE container_id = %s
                AND timestamp > DATE_SUB(NOW(), INTERVAL %s HOUR)
                ORDER BY timestamp ASC
            """
            cursor.execute(query, (container_id, hours))
            results = cursor.fetchall()
            cursor.close()
            return results
        except Exception as e:
            logging.error(f"Error getting container history: {str(e)}")
            return None


if __name__ == "__main__":
    # Configure logging
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
        handlers=[logging.FileHandler("resource_monitor.log"), logging.StreamHandler()],
    )

    monitor = ResourceMonitor()
    monitor.monitor_resources()
