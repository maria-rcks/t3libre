/**
 * @file API client for the management panel backend.
 * Provides typed methods for all REST endpoints.
 */

import axios, { AxiosInstance } from 'axios';
import { DockerApp, SetupStatus, UserProfile, AppConfig, Customer, ServerPreset, ServerMetric, AccessLog, ConfigVersion, MaintenanceWindow, BackupJob, BackupStatusEntry, AlertConfig, AlertHistoryEntry, HealthCheck, ScheduledTask, GitDeployment, Database, BillingInfo, Transaction, BillingRates, CostEstimate, Modpack, ModpackInstallation, ServerCloneRequest, ServerRoleAssignment, ServerSnapshot, AutopilotRecommendation, ServerWorkspace, ServerBillingLedger } from './types';

const API_URL = (import.meta as any).env?.VITE_API_URL || 'http://localhost:3001';

export type { APIClient };

/**
 * API client that wraps axios and provides typed methods for all endpoints.
 * Manages JWT token lifecycle and request configuration.
 */
class APIClient {
  private api: AxiosInstance;
  private token: string | null = null;

  constructor() {
    this.api = axios.create({
      baseURL: API_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  setToken(token: string) {
    this.token = token;
    this.api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  }

  clearToken() {
    this.token = null;
    delete this.api.defaults.headers.common['Authorization'];
  }

  // Setup endpoints
  async getSetupStatus(): Promise<SetupStatus> {
    const res = await this.api.get('/api/setup/status');
    return res.data;
  }

  async initSetup(email: string, password: string, displayName: string, mode: 'personal' | 'business') {
    const res = await this.api.post('/api/setup/init', {
      email,
      password,
      displayName,
      mode,
    });
    return res.data;
  }



  async listPresets(): Promise<ServerPreset[]> {
    const res = await this.api.get('/api/presets');
    return res.data;
  }

  // Docker app endpoints
  async listApps(): Promise<DockerApp[]> {
    const res = await this.api.get('/api/apps');
    return res.data;
  }

  async getApp(appId: string): Promise<DockerApp> {
    const res = await this.api.get(`/api/apps/${appId}`);
    return res.data;
  }

  async createApp(app: Partial<DockerApp>): Promise<DockerApp> {
    const res = await this.api.post('/api/apps', app);
    return res.data;
  }

  async updateApp(appId: string, updates: Partial<DockerApp>): Promise<DockerApp> {
    const res = await this.api.patch(`/api/apps/${appId}`, updates);
    return res.data;
  }

  async deleteApp(appId: string): Promise<void> {
    await this.api.delete(`/api/apps/${appId}`);
  }

  // Container control endpoints
  async startApp(appId: string): Promise<DockerApp> {
    const res = await this.api.post(`/api/apps/${appId}/start`);
    return res.data;
  }

  async stopApp(appId: string): Promise<DockerApp> {
    const res = await this.api.post(`/api/apps/${appId}/stop`);
    return res.data;
  }

  async restartApp(appId: string): Promise<DockerApp> {
    const res = await this.api.post(`/api/apps/${appId}/restart`);
    return res.data;
  }

  async getLogs(appId: string, limit = 50, offset = 0): Promise<Array<any>> {
    const res = await this.api.get(`/api/apps/${appId}/logs`, {
      params: { limit, offset },
    });
    return res.data;
  }

  async searchLogs(appId: string, params: { query?: string; level?: string; from?: string; to?: string; page?: number; limit?: number }): Promise<{ logs: any[]; total: number; page: number }> {
    const res = await this.api.get(`/api/apps/${appId}/logs`, {
      params: { search: params.query, level: params.level, from: params.from, to: params.to, page: params.page, limit: params.limit },
    });
    return { logs: res.data.data || [], total: res.data.total || 0, page: res.data.page || 1 };
  }



  // Server operations hub endpoints
  async cloneServer(appId: string, request: ServerCloneRequest): Promise<DockerApp> {
    const res = await this.api.post(`/api/apps/${appId}/clone`, request);
    return res.data;
  }

  async listServerRoles(appId: string): Promise<ServerRoleAssignment[]> {
    const res = await this.api.get(`/api/apps/${appId}/roles`);
    return res.data;
  }

  async upsertServerRole(appId: string, role: Partial<ServerRoleAssignment>): Promise<ServerRoleAssignment> {
    const res = await this.api.post(`/api/apps/${appId}/roles`, role);
    return res.data;
  }

  async listServerSnapshots(appId: string): Promise<ServerSnapshot[]> {
    const res = await this.api.get(`/api/apps/${appId}/snapshots`);
    return res.data;
  }

  async createServerSnapshot(appId: string, snapshot: { name: string; schedule: 'manual' | 'automatic' }): Promise<ServerSnapshot> {
    const res = await this.api.post(`/api/apps/${appId}/snapshots`, snapshot);
    return res.data;
  }

  async restoreServerSnapshot(appId: string, snapshotId: string): Promise<ServerSnapshot> {
    const res = await this.api.post(`/api/apps/${appId}/snapshots/${snapshotId}/restore`);
    return res.data;
  }

  async getAutopilotRecommendations(appId: string): Promise<AutopilotRecommendation[]> {
    const res = await this.api.get(`/api/apps/${appId}/autopilot`);
    return res.data;
  }

  async listWorkspaces(): Promise<ServerWorkspace[]> {
    const res = await this.api.get('/api/workspaces');
    return res.data;
  }

  async createWorkspace(workspace: { name: string; appIds: string[] }): Promise<ServerWorkspace> {
    const res = await this.api.post('/api/workspaces', workspace);
    return res.data;
  }

  async getServerBilling(appId: string): Promise<ServerBillingLedger> {
    const res = await this.api.get(`/api/apps/${appId}/billing`);
    return res.data;
  }

  async installServerPlugin(appId: string, pluginId: string): Promise<{ success: boolean; pluginId: string }> {
    const res = await this.api.post(`/api/apps/${appId}/plugins/${pluginId}/install`);
    return res.data;
  }

  // User endpoints
  async getUser(): Promise<UserProfile> {
    const res = await this.api.get('/api/user');
    return res.data;
  }

  // Config endpoints
  async getConfig(): Promise<AppConfig> {
    const res = await this.api.get('/api/config/mode');
    return res.data;
  }

  // Customers (Business Mode MVP)
  async getCustomers(): Promise<Customer[]> {
    const res = await this.api.get('/api/customers');
    return res.data;
  }

  async createCustomer(customer: Partial<Customer>): Promise<Customer> {
    const res = await this.api.post('/api/customers', customer);
    return res.data;
  }

  async updateCustomer(customerId: string, updates: Partial<Customer>): Promise<any> {
    const res = await this.api.patch(`/api/customers/${customerId}`, updates);
    return res.data;
  }

  async deleteCustomer(customerId: string): Promise<any> {
    const res = await this.api.delete(`/api/customers/${customerId}`);
    return res.data;
  }

  // Seed demo data (customers + apps)
  async seedDemo(): Promise<any> {
    const res = await this.api.post('/api/seed-demo');
    return res.data;
  }

  // Phase 4: Server Metrics
  async getServerMetrics(appId: string, range = '30m'): Promise<ServerMetric[]> {
    const res = await this.api.get(`/api/apps/${appId}/metrics`, { params: { range } });
    return res.data;
  }

  async getAggregatedMetrics(): Promise<any> {
    const res = await this.api.get('/api/metrics/aggregated');
    return res.data;
  }

  // Access Logs
  async getAccessLogs(limit = 50, offset = 0): Promise<AccessLog[]> {
    const res = await this.api.get('/api/logs/access', { params: { limit, offset } });
    return res.data;
  }

  // Config Versions
  async getConfigVersions(appId: string): Promise<ConfigVersion[]> {
    const res = await this.api.get(`/api/apps/${appId}/config-versions`);
    return res.data;
  }

  async createConfigVersion(appId: string, snapshot: Record<string, any>, summary: string): Promise<ConfigVersion> {
    const res = await this.api.post(`/api/apps/${appId}/config-versions`, { config_snapshot: snapshot, change_summary: summary });
    return res.data;
  }

  async rollbackConfig(appId: string, version: number): Promise<ConfigVersion> {
    const res = await this.api.post(`/api/apps/${appId}/config-versions/${version}/rollback`);
    return res.data;
  }

  // Maintenance Windows
  async getMaintenanceWindows(): Promise<MaintenanceWindow[]> {
    const res = await this.api.get('/api/maintenance-windows');
    return res.data;
  }

  async createMaintenanceWindow(window: Partial<MaintenanceWindow>): Promise<MaintenanceWindow> {
    const res = await this.api.post('/api/maintenance-windows', window);
    return res.data;
  }

  async updateMaintenanceWindow(id: string, updates: Partial<MaintenanceWindow>): Promise<MaintenanceWindow> {
    const res = await this.api.patch(`/api/maintenance-windows/${id}`, updates);
    return res.data;
  }

  // Backup Jobs
  async getBackupJobs(): Promise<BackupJob[]> {
    const res = await this.api.get('/api/backup-jobs');
    return res.data;
  }

  async createBackupJob(job: Partial<BackupJob>): Promise<BackupJob> {
    const res = await this.api.post('/api/backup-jobs', job);
    return res.data;
  }

  async updateBackupJob(id: string, updates: Partial<BackupJob>): Promise<BackupJob> {
    const res = await this.api.patch(`/api/backup-jobs/${id}`, updates);
    return res.data;
  }

  async deleteBackupJob(id: string): Promise<void> {
    await this.api.delete(`/api/backup-jobs/${id}`);
  }

  async getBackupStatus(jobId: string): Promise<BackupStatusEntry[]> {
    const res = await this.api.get(`/api/backup-jobs/${jobId}/status`);
    return res.data;
  }

  // Alert Configs
  async getAlertConfigs(): Promise<AlertConfig[]> {
    const res = await this.api.get('/api/alert-configs');
    return res.data;
  }

  async createAlertConfig(config: Partial<AlertConfig>): Promise<AlertConfig> {
    const res = await this.api.post('/api/alert-configs', config);
    return res.data;
  }

  async updateAlertConfig(id: string, updates: Partial<AlertConfig>): Promise<AlertConfig> {
    const res = await this.api.patch(`/api/alert-configs/${id}`, updates);
    return res.data;
  }

  async deleteAlertConfig(id: string): Promise<void> {
    await this.api.delete(`/api/alert-configs/${id}`);
  }

  async getAlertHistory(): Promise<AlertHistoryEntry[]> {
    const res = await this.api.get('/api/alert-history');
    return res.data;
  }

  async acknowledgeAlert(id: number): Promise<void> {
    await this.api.post(`/api/alert-history/${id}/acknowledge`);
  }

  // Health Checks
  async getHealthChecks(appId?: string): Promise<HealthCheck[]> {
    const params = appId ? { app_id: appId } : {};
    const res = await this.api.get('/api/health-checks', { params });
    return res.data;
  }

  async getReports(startDate?: string, endDate?: string): Promise<any> {
    const params: any = {};
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    const res = await this.api.get('/api/reports', { params });
    return res.data;
  }

  async exportReport(format: 'pdf' | 'csv', startDate?: string, endDate?: string): Promise<Blob> {
    const params: any = { format };
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    const res = await this.api.get('/api/reports/export', { params, responseType: 'blob' });
    return res.data;
  }

  // Scheduled Tasks
  async getScheduledTasks(): Promise<ScheduledTask[]> {
    const res = await this.api.get('/api/scheduled-tasks');
    return res.data;
  }

  async createScheduledTask(task: Partial<ScheduledTask>): Promise<ScheduledTask> {
    const res = await this.api.post('/api/scheduled-tasks', task);
    return res.data;
  }

  async updateScheduledTask(id: string, updates: Partial<ScheduledTask>): Promise<ScheduledTask> {
    const res = await this.api.patch(`/api/scheduled-tasks/${id}`, updates);
    return res.data;
  }

  async deleteScheduledTask(id: string): Promise<void> {
    await this.api.delete(`/api/scheduled-tasks/${id}`);
  }

  async toggleScheduledTask(id: string): Promise<ScheduledTask> {
    const res = await this.api.post(`/api/scheduled-tasks/${id}/toggle`);
    return res.data;
  }

  // Discord token validation
  async validateDiscordToken(token: string): Promise<{valid: boolean; botName?: string; guildCount?: number; error?: string}> {
    const res = await this.api.post('/api/validate/discord-token', { token });
    return res.data;
  }

  // Config file management
  async listConfigFiles(appId: string, path?: string): Promise<{files: any[]; currentPath: string}> {
    const params: any = {};
    if (path) params.path = path;
    const res = await this.api.get(`/api/apps/${appId}/config`, { params });
    return res.data;
  }

  async readConfigFile(appId: string, filePath: string): Promise<{content: string; path: string; language: string}> {
    const res = await this.api.get(`/api/apps/${appId}/config/read`, { params: { file: filePath } });
    return res.data;
  }

  async writeConfigFile(appId: string, filePath: string, content: string): Promise<{success: boolean; backupPath: string}> {
    const res = await this.api.post(`/api/apps/${appId}/config/write`, { path: filePath, content });
    return res.data;
  }

  async validateConfigFile(appId: string, filePath: string): Promise<{valid: boolean; errors: string[]}> {
    const res = await this.api.get(`/api/apps/${appId}/config/validate`, { params: { file: filePath } });
    return res.data;
  }

  // Git Deployments
  async getDeployments(): Promise<GitDeployment[]> {
    const res = await this.api.get('/api/deployments');
    return res.data;
  }

  async createDeployment(deployment: Partial<GitDeployment>): Promise<GitDeployment> {
    const res = await this.api.post('/api/deployments', deployment);
    return res.data;
  }

  async deleteDeployment(id: string): Promise<void> {
    await this.api.delete(`/api/deployments/${id}`);
  }

  async toggleDeployment(id: string): Promise<GitDeployment> {
    const res = await this.api.patch(`/api/deployments/${id}/toggle`);
    return res.data;
  }

  async getDeploymentHistory(id: string): Promise<{history: any[]}> {
    const res = await this.api.get(`/api/deployments/${id}/history`);
    return res.data;
  }

  // Database endpoints
  async getDatabases(): Promise<Database[]> {
    const res = await this.api.get('/api/databases');
    return res.data;
  }

  async createDatabase(name: string, appId?: string): Promise<Database> {
    const res = await this.api.post('/api/databases', { name, appId });
    return res.data;
  }

  async getDatabase(id: string): Promise<Database> {
    const res = await this.api.get(`/api/databases/${id}`);
    return res.data;
  }

  async deleteDatabase(id: string): Promise<void> {
    await this.api.delete(`/api/databases/${id}`);
  }

  // Billing endpoints
  async getBalance(): Promise<BillingInfo> {
    const res = await this.api.get('/api/billing/balance');
    return res.data;
  }

  async topUp(amount: number): Promise<BillingInfo> {
    const res = await this.api.post('/api/billing/topup', { amount });
    return res.data;
  }

  async getTransactions(): Promise<Transaction[]> {
    const res = await this.api.get('/api/billing/transactions');
    return res.data;
  }

  async getCostEstimate(cpu: number, ram: number, storage: number): Promise<CostEstimate> {
    const res = await this.api.get('/api/billing/cost-estimate', { params: { cpu, ram, storage } });
    return res.data;
  }

  async getBillingRates(): Promise<BillingRates> {
    const res = await this.api.get('/api/billing/rates');
    return res.data;
  }

  // Real-time metrics
  async getRealtimeMetrics(appId?: string): Promise<any> {
    const params = appId ? { appId } : {};
    const res = await this.api.get('/api/metrics/realtime', { params });
    return res.data;
  }

  async getMetricsHistory(appId?: string, period = '1h', resolution = '5m'): Promise<any> {
    const params: any = { period, resolution };
    if (appId) params.appId = appId;
    const res = await this.api.get('/api/metrics/history', { params });
    return res.data;
  }

  async configureMetricsSource(config: { type: string; url: string; apiKey?: string }): Promise<any> {
    const res = await this.api.post('/api/metrics/stream/config', config);
    return res.data;
  }

  async getGrafanaUrl(): Promise<{ url: string | null }> {
    const res = await this.api.get('/api/metrics/grafana-url');
    return res.data;
  }

  // Modpack endpoints
  async searchModpacks(query: string, platform?: string): Promise<Modpack[]> {
    const params: any = { query };
    if (platform) params.platform = platform;
    const res = await this.api.get('/api/modpacks/search', { params });
    return res.data.results || [];
  }

  async installModpack(appId: string, modpackId: string, platform: string): Promise<ModpackInstallation> {
    const res = await this.api.post(`/api/apps/${appId}/modpacks/install`, { modpackId, platform });
    return res.data;
  }

  async getModpackInstallationStatus(appId: string): Promise<ModpackInstallation[]> {
    const res = await this.api.get(`/api/apps/${appId}/modpacks/status`);
    return res.data;
  }

  // Knowledge Base API
  async listArticles(): Promise<import('./types').KBArticle[]> {
    const res = await this.api.get('/api/kb/articles');
    return res.data;
  }

  async getArticle(id: string): Promise<import('./types').KBArticle> {
    const res = await this.api.get(`/api/kb/articles/${id}`);
    return res.data;
  }

  async createArticle(data: Partial<import('./types').KBArticle>): Promise<import('./types').KBArticle> {
    const res = await this.api.post('/api/kb/articles', data);
    return res.data;
  }

  async updateArticle(id: string, data: Partial<import('./types').KBArticle>): Promise<import('./types').KBArticle> {
    const res = await this.api.put(`/api/kb/articles/${id}`, data);
    return res.data;
  }

  async deleteArticle(id: string): Promise<void> {
    await this.api.delete(`/api/kb/articles/${id}`);
  }

  async searchArticles(query: string): Promise<import('./types').KBArticle[]> {
    const res = await this.api.get('/api/kb/search', { params: { q: query } });
    return res.data;
  }

  async getCategories(): Promise<import('./types').KBCategory[]> {
    const res = await this.api.get('/api/kb/categories');
    return res.data;
  }

  async createCategory(data: Partial<import('./types').KBCategory>): Promise<import('./types').KBCategory> {
    const res = await this.api.post('/api/kb/categories', data);
    return res.data;
  }

  async deleteCategory(id: string): Promise<void> {
    await this.api.delete(`/api/kb/categories/${id}`);
  }

  // Activity Feed API
  async getActivityFeed(params: { limit?: number; offset?: number; type?: string; userId?: string; from?: string; to?: string }): Promise<{ events: import('./types').ActivityEvent[]; total: number }> {
    const res = await this.api.get('/api/activity', { params });
    return res.data;
  }

  async getActivityDetail(id: string): Promise<import('./types').ActivityEvent> {
    const res = await this.api.get(`/api/activity/${id}`);
    return res.data;
  }

  async exportActivity(params: { format?: 'csv' | 'json'; type?: string; userId?: string; from?: string; to?: string }): Promise<Blob> {
    const res = await this.api.get('/api/activity/export', { params, responseType: 'blob' });
    return res.data;
  }

  // Dashboard Builder API
  async listDashboards(): Promise<import('./types').DashboardDefinition[]> {
    const res = await this.api.get('/api/dashboards');
    return res.data;
  }

  async getDashboard(id: string): Promise<import('./types').DashboardDefinition> {
    const res = await this.api.get(`/api/dashboards/${id}`);
    return res.data;
  }

  async createDashboard(data: Partial<import('./types').DashboardDefinition>): Promise<import('./types').DashboardDefinition> {
    const res = await this.api.post('/api/dashboards', data);
    return res.data;
  }

  async updateDashboard(id: string, data: Partial<import('./types').DashboardDefinition>): Promise<import('./types').DashboardDefinition> {
    const res = await this.api.put(`/api/dashboards/${id}`, data);
    return res.data;
  }

  async deleteDashboard(id: string): Promise<void> {
    await this.api.delete(`/api/dashboards/${id}`);
  }

  async getDashboardData(id: string, params?: { period?: string }): Promise<any> {
    const res = await this.api.get(`/api/dashboards/${id}/data`, { params });
    return res.data;
  }

  // AI Config Advisor
  async getConfigAdvice(appId: string): Promise<any> {
    const res = await this.api.get(`/api/config/${appId}/advice`);
    return res.data;
  }

  async applyConfigAdvice(appId: string, suggestionId: string): Promise<any> {
    const res = await this.api.post(`/api/config/${appId}/advice/${suggestionId}/apply`);
    return res.data;
  }

  // Plugin Marketplace
  async listPlugins(appId?: string): Promise<any[]> {
    const params: any = {};
    if (appId) params.appId = appId;
    const res = await this.api.get('/api/plugins', { params });
    return res.data;
  }

  async getPlugin(id: string, appId?: string): Promise<any> {
    const params: any = {};
    if (appId) params.appId = appId;
    const res = await this.api.get(`/api/plugins/${id}`, { params });
    return res.data;
  }

  async installPlugin(id: string, appId: string): Promise<any> {
    const res = await this.api.post(`/api/plugins/${id}/install`, { appId });
    return res.data;
  }

  async uninstallPlugin(id: string, appId: string): Promise<any> {
    const res = await this.api.post(`/api/plugins/${id}/uninstall`, { appId });
    return res.data;
  }

  async publishPlugin(data: any): Promise<any> {
    const res = await this.api.post('/api/plugins', data);
    return res.data;
  }

  // Collaborative Terminal
  async createTerminalSession(appId: string): Promise<any> {
    const res = await this.api.post('/api/terminal/sessions', { appId });
    return res.data;
  }

  async getTerminalSession(sessionId: string): Promise<any> {
    const res = await this.api.get(`/api/terminal/sessions/${sessionId}`);
    return res.data;
  }

  // Change Approval Workflow
  async createChangeRequest(data: any): Promise<any> {
    const res = await this.api.post('/api/change-requests', data);
    return res.data;
  }

  async listChangeRequests(filter?: { status?: string; appId?: string }): Promise<any[]> {
    const params: any = {};
    if (filter?.status) params.status = filter.status;
    if (filter?.appId) params.appId = filter.appId;
    const res = await this.api.get('/api/change-requests', { params });
    return res.data;
  }

  async approveChangeRequest(id: string): Promise<any> {
    const res = await this.api.post(`/api/change-requests/${id}/approve`);
    return res.data;
  }

  async rejectChangeRequest(id: string, reason: string): Promise<any> {
    const res = await this.api.post(`/api/change-requests/${id}/reject`, { reason });
    return res.data;
  }

  // Health check
  async health(): Promise<{ status: string }> {
    const res = await this.api.get('/health');
    return res.data;
  }

  // Custom Report Builder API
  async listReportDesigns(): Promise<import('./types').ReportDesign[]> {
    const res = await this.api.get('/api/v3/reports/designs');
    return res.data;
  }

  async getReportDesign(id: string): Promise<import('./types').ReportDesign> {
    const res = await this.api.get(`/api/v3/reports/designs/${id}`);
    return res.data;
  }

  async createReportDesign(data: Partial<import('./types').ReportDesign>): Promise<import('./types').ReportDesign> {
    const res = await this.api.post('/api/v3/reports/designs', data);
    return res.data;
  }

  async updateReportDesign(id: string, data: Partial<import('./types').ReportDesign>): Promise<import('./types').ReportDesign> {
    const res = await this.api.put(`/api/v3/reports/designs/${id}`, data);
    return res.data;
  }

  async deleteReportDesign(id: string): Promise<void> {
    await this.api.delete(`/api/v3/reports/designs/${id}`);
  }

  async generateReportNow(designId: string, channels?: import('./types').DeliveryChannel[], format?: string): Promise<any> {
    const res = await this.api.post('/api/v3/reports/generate', { design_id: designId, channels, format });
    return res.data;
  }

  async listReportSchedules(): Promise<import('./types').ReportSchedule[]> {
    const res = await this.api.get('/api/v3/reports/schedules');
    return res.data;
  }

  async createReportSchedule(data: Partial<import('./types').ReportSchedule>): Promise<import('./types').ReportSchedule> {
    const res = await this.api.post('/api/v3/reports/schedules', data);
    return res.data;
  }

  async deleteReportSchedule(id: string): Promise<void> {
    await this.api.delete(`/api/v3/reports/schedules/${id}`);
  }

  async listReportDeliveries(designId?: string): Promise<import('./types').ReportDelivery[]> {
    const params: any = {};
    if (designId) params.design_id = designId;
    const res = await this.api.get('/api/v3/reports/deliveries', { params });
    return res.data;
  }

  async getReportTemplates(): Promise<import('./types').ReportTemplate[]> {
    const res = await this.api.get('/api/v3/reports/templates');
    return res.data;
  }

  // BI Dashboard API
  async getKpiSummary(): Promise<import('./types').KPISummary> {
    const res = await this.api.get('/api/v3/bi/kpi-summary');
    return res.data;
  }

  async getMRR(): Promise<import('./types').MRRPoint[]> {
    const res = await this.api.get('/api/v3/bi/mrr');
    return res.data;
  }

  async getARR(): Promise<import('./types').ARRBreakdown> {
    const res = await this.api.get('/api/v3/bi/arr');
    return res.data;
  }

  async getChurnAnalysis(): Promise<import('./types').ChurnAnalysis> {
    const res = await this.api.get('/api/v3/bi/churn');
    return res.data;
  }

  async getLTVSegments(): Promise<import('./types').LTVSegment[]> {
    const res = await this.api.get('/api/v3/bi/ltv');
    return res.data;
  }

  async getCACMetrics(): Promise<import('./types').CACMetrics> {
    const res = await this.api.get('/api/v3/bi/cac');
    return res.data;
  }

  async getAcquisitionChannels(): Promise<import('./types').AcquisitionChannel[]> {
    const res = await this.api.get('/api/v3/bi/acquisition');
    return res.data;
  }

  async getRevenueBreakdown(): Promise<import('./types').RevenueBreakdown> {
    const res = await this.api.get('/api/v3/bi/revenue-breakdown');
    return res.data;
  }

  async getRevenueForecasts(): Promise<import('./types').RevenueForecast> {
    const res = await this.api.get('/api/v3/bi/forecasts');
    return res.data;
  }

  async getCohortData(): Promise<import('./types').CohortRow[]> {
    const res = await this.api.get('/api/v3/bi/cohorts');
    return res.data;
  }

  // Dependency Graph API
  async getDependencyGraph(): Promise<import('./types').DependencyGraph> {
    const res = await this.api.get('/api/v3/dependencies/graph');
    return res.data;
  }

  async getServiceDependencies(serviceId: string): Promise<import('./types').DependencyGraph> {
    const res = await this.api.get(`/api/v3/dependencies/service/${serviceId}`);
    return res.data;
  }

  async getImpactAnalysis(serviceId: string): Promise<import('./types').ImpactAnalysis> {
    const res = await this.api.get(`/api/v3/dependencies/impact?service_id=${serviceId}`);
    return res.data;
  }

  async discoverDependencies(): Promise<import('./types').DependencyGraph> {
    const res = await this.api.post('/api/v3/dependencies/discover');
    return res.data;
  }

  async getDependencyChanges(): Promise<any[]> {
    const res = await this.api.get('/api/v3/dependencies/changes');
    return res.data;
  }

  // Cost & Usage Analytics API
  async getCostBreakdown(): Promise<import('./types').CostBreakdown> {
    const res = await this.api.get('/api/v3/cost/breakdown');
    return res.data;
  }

  async getCostTrends(): Promise<import('./types').CostTrendPoint[]> {
    const res = await this.api.get('/api/v3/cost/trends');
    return res.data;
  }

  async getUnitEconomics(): Promise<import('./types').UnitEconomics> {
    const res = await this.api.get('/api/v3/cost/unit-economics');
    return res.data;
  }

  async getBudgets(): Promise<import('./types').Budget[]> {
    const res = await this.api.get('/api/v3/cost/budgets');
    return res.data;
  }

  async createBudget(data: Partial<import('./types').Budget>): Promise<import('./types').Budget> {
    const res = await this.api.post('/api/v3/cost/budgets', data);
    return res.data;
  }

  async getSavingsRecommendations(): Promise<import('./types').SavingsRecommendation[]> {
    const res = await this.api.get('/api/v3/cost/recommendations');
    return res.data;
  }

  async getCostForecast(): Promise<import('./types').CostForecast> {
    const res = await this.api.get('/api/v3/cost/forecast');
    return res.data;
  }

  // Geolocation Heatmap API
  async ingestGeoEvent(event: Partial<import('./types').GeoEvent>): Promise<any> {
    const res = await this.api.post('/api/v3/geo/ingest', event);
    return res.data;
  }

  async getHeatmapData(params?: { from?: string; to?: string; service?: string; country?: string }): Promise<import('./types').HeatmapDataPoint[]> {
    const res = await this.api.get('/api/v3/geo/heatmap', { params });
    return res.data;
  }

  async getGeoRegions(params?: { from?: string; to?: string; service?: string }): Promise<import('./types').RegionAggregation[]> {
    const res = await this.api.get('/api/v3/geo/regions', { params });
    return res.data;
  }

  async getTopCities(params?: { from?: string; to?: string; service?: string; limit?: number }): Promise<import('./types').TopCity[]> {
    const res = await this.api.get('/api/v3/geo/top-cities', { params });
    return res.data;
  }

  async getGeoTimelapse(params?: { from?: string; to?: string; interval?: string; service?: string }): Promise<import('./types').TimelapseFrame[]> {
    const res = await this.api.get('/api/v3/geo/timelapse', { params });
    return res.data;
  }

  async getGeoFilterOptions(): Promise<import('./types').GeoFilterOptions> {
    const res = await this.api.get('/api/v3/geo/filter-options');
    return res.data;
  }

  // === v3 Networking API Methods ===

  // SD-WAN Controller
  async getSDWANStatus(): Promise<any> {
    const res = await this.api.get('/api/v1/networking/sdwan/status');
    return res.data;
  }
  async listSDWANApps(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/sdwan/apps');
    return res.data;
  }
  async createSDWANApp(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/sdwan/apps', data);
    return res.data;
  }
  async updateSDWANApp(id: string, data: any): Promise<any> {
    const res = await this.api.put(`/api/v1/networking/sdwan/apps/${id}`, data);
    return res.data;
  }
  async deleteSDWANApp(id: string): Promise<void> {
    await this.api.delete(`/api/v1/networking/sdwan/apps/${id}`);
  }
  async toggleSDWANApp(id: string): Promise<any> {
    const res = await this.api.post(`/api/v1/networking/sdwan/apps/${id}/toggle`);
    return res.data;
  }
  async getSDWANMetrics(): Promise<any> {
    const res = await this.api.get('/api/v1/networking/sdwan/metrics');
    return res.data;
  }

  // VPN as a Service
  async listVPNConfigs(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/vpn/configs');
    return res.data;
  }
  async createVPNConfig(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/vpn/configs', data);
    return res.data;
  }
  async updateVPNConfig(id: string, data: any): Promise<any> {
    const res = await this.api.put(`/api/v1/networking/vpn/configs/${id}`, data);
    return res.data;
  }
  async deleteVPNConfig(id: string): Promise<void> {
    await this.api.delete(`/api/v1/networking/vpn/configs/${id}`);
  }
  async getVPNStatus(): Promise<any> {
    const res = await this.api.get('/api/v1/networking/vpn/status');
    return res.data;
  }
  async getVPNLogs(): Promise<any> {
    const res = await this.api.get('/api/v1/networking/vpn/logs');
    return res.data;
  }

  // DNS Management
  async listDNSZones(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/dns/zones');
    return res.data;
  }
  async createDNSZone(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/dns/zones', data);
    return res.data;
  }
  async deleteDNSZone(id: string): Promise<void> {
    await this.api.delete(`/api/v1/networking/dns/zones/${id}`);
  }
  async listDNSRecords(zoneId: string): Promise<any[]> {
    const res = await this.api.get(`/api/v1/networking/dns/zones/${zoneId}/records`);
    return res.data;
  }
  async createDNSRecord(zoneId: string, data: any): Promise<any> {
    const res = await this.api.post(`/api/v1/networking/dns/zones/${zoneId}/records`, data);
    return res.data;
  }
  async updateDNSRecord(zoneId: string, recordId: string, data: any): Promise<any> {
    const res = await this.api.put(`/api/v1/networking/dns/zones/${zoneId}/records/${recordId}`, data);
    return res.data;
  }
  async deleteDNSRecord(zoneId: string, recordId: string): Promise<void> {
    await this.api.delete(`/api/v1/networking/dns/zones/${zoneId}/records/${recordId}`);
  }

  // BGP Route Manager
  async listBGPSessions(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/bgp/sessions');
    return res.data;
  }
  async createBGPSession(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/bgp/sessions', data);
    return res.data;
  }
  async deleteBGPSession(id: string): Promise<void> {
    await this.api.delete(`/api/v1/networking/bgp/sessions/${id}`);
  }
  async getBGPRoutes(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/bgp/routes');
    return res.data;
  }
  async getBGPStatus(): Promise<any> {
    const res = await this.api.get('/api/v1/networking/bgp/status');
    return res.data;
  }

  // Reverse Proxy Catalog
  async listProxyRules(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/proxy/rules');
    return res.data;
  }
  async createProxyRule(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/proxy/rules', data);
    return res.data;
  }
  async updateProxyRule(id: string, data: any): Promise<any> {
    const res = await this.api.put(`/api/v1/networking/proxy/rules/${id}`, data);
    return res.data;
  }
  async deleteProxyRule(id: string): Promise<void> {
    await this.api.delete(`/api/v1/networking/proxy/rules/${id}`);
  }
  async toggleProxyRule(id: string): Promise<any> {
    const res = await this.api.post(`/api/v1/networking/proxy/rules/${id}/toggle`);
    return res.data;
  }

  // Network Segmentation
  async listSegments(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/segments');
    return res.data;
  }
  async createSegment(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/segments', data);
    return res.data;
  }
  async updateSegment(id: string, data: any): Promise<any> {
    const res = await this.api.put(`/api/v1/networking/segments/${id}`, data);
    return res.data;
  }
  async deleteSegment(id: string): Promise<void> {
    await this.api.delete(`/api/v1/networking/segments/${id}`);
  }
  async listSegmentPolicies(segmentId: string): Promise<any[]> {
    const res = await this.api.get(`/api/v1/networking/segments/${segmentId}/policies`);
    return res.data;
  }
  async createSegmentPolicy(segmentId: string, data: any): Promise<any> {
    const res = await this.api.post(`/api/v1/networking/segments/${segmentId}/policies`, data);
    return res.data;
  }

  // Packet Capture Studio
  async listCaptures(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/captures');
    return res.data;
  }
  async startCapture(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/captures', data);
    return res.data;
  }
  async stopCapture(id: string): Promise<any> {
    const res = await this.api.post(`/api/v1/networking/captures/${id}/stop`);
    return res.data;
  }
  async getCaptureStatus(id: string): Promise<any> {
    const res = await this.api.get(`/api/v1/networking/captures/${id}`);
    return res.data;
  }
  async getCapturePackets(id: string, offset?: number, limit?: number): Promise<any> {
    const params: any = {};
    if (offset !== undefined) params.offset = offset;
    if (limit !== undefined) params.limit = limit;
    const res = await this.api.get(`/api/v1/networking/captures/${id}/packets`, { params });
    return res.data;
  }

  // DNS Filtering & DHCP
  async getDNSFilterStatus(): Promise<any> {
    const res = await this.api.get('/api/v1/networking/dnsfilter/status');
    return res.data;
  }
  async listDNSFilters(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/dnsfilter/rules');
    return res.data;
  }
  async createDNSFilter(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/dnsfilter/rules', data);
    return res.data;
  }
  async deleteDNSFilter(id: string): Promise<void> {
    await this.api.delete(`/api/v1/networking/dnsfilter/rules/${id}`);
  }
  async toggleDNSFilter(id: string): Promise<any> {
    const res = await this.api.post(`/api/v1/networking/dnsfilter/rules/${id}/toggle`);
    return res.data;
  }
  async getDHCPLeases(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/dhcp/leases');
    return res.data;
  }

  // Network Cost Analyzer
  async getNetworkCosts(): Promise<any> {
    const res = await this.api.get('/api/v1/networking/costs');
    return res.data;
  }
  async getNetworkCostTrends(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/costs/trends');
    return res.data;
  }
  async getBandwidthUsage(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/costs/bandwidth');
    return res.data;
  }
  async getCostSavings(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/costs/savings');
    return res.data;
  }
  async setCostBudget(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/costs/budget', data);
    return res.data;
  }

  // 5G/LTE Cellular Integration
  async listCellularNetworks(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/cellular/networks');
    return res.data;
  }
  async registerCellularNetwork(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/networking/cellular/networks', data);
    return res.data;
  }
  async deleteCellularNetwork(id: string): Promise<void> {
    await this.api.delete(`/api/v1/networking/cellular/networks/${id}`);
  }
  async getCellularStatus(): Promise<any> {
    const res = await this.api.get('/api/v1/networking/cellular/status');
    return res.data;
  }
  async getCellularMetrics(): Promise<any> {
    const res = await this.api.get('/api/v1/networking/cellular/metrics');
    return res.data;
  }
  async getCellularSIMs(): Promise<any[]> {
    const res = await this.api.get('/api/v1/networking/cellular/sims');
    return res.data;
  }
  async activateSIM(id: string): Promise<any> {
    const res = await this.api.post(`/api/v1/networking/cellular/sims/${id}/activate`);
    return res.data;
  }
  async deactivateSIM(id: string): Promise<any> {
    const res = await this.api.post(`/api/v1/networking/cellular/sims/${id}/deactivate`);
    return res.data;
  }

  // Generic HTTP helpers for v3 features
  async get(url: string, params?: any): Promise<any> {
    const res = await this.api.get(url, { params });
    return res.data;
  }
  async post(url: string, data?: any): Promise<any> {
    const res = await this.api.post(url, data);
    return res.data;
  }
  async put(url: string, data?: any): Promise<any> {
    const res = await this.api.put(url, data);
    return res.data;
  }
  async delete(url: string): Promise<void> {
    await this.api.delete(url);
  }

  // === v3 Frontend Feature API Methods ===

  // Topology 3D
  async getTopologyNodes(): Promise<any[]> {
    return this.get('/api/v3/topology/nodes');
  }
  async getTopologyEdges(): Promise<any[]> {
    return this.get('/api/v3/topology/edges');
  }

  // Geolocation Heatmap
  async getHeatmapData(params?: any): Promise<any> {
    return this.get('/api/v3/geo/heatmap', params);
  }
  async getGeoRegions(params?: any): Promise<any[]> {
    return this.get('/api/v3/geo/regions', params);
  }
  async getTopCities(params?: any): Promise<any[]> {
    return this.get('/api/v3/geo/cities', params);
  }
  async getGeoFilterOptions(): Promise<any> {
    return this.get('/api/v3/geo/filters');
  }
  async getGeoTimelapse(params?: any): Promise<any[]> {
    return this.get('/api/v3/geo/timelapse', params);
  }

  // Cost Analytics
  async getCostBreakdown(): Promise<any> {
    return this.get('/api/v3/costs/breakdown');
  }
  async getCostTrends(): Promise<any[]> {
    return this.get('/api/v3/costs/trends');
  }
  async getUnitEconomics(): Promise<any> {
    return this.get('/api/v3/costs/unit-economics');
  }
  async getBudgets(): Promise<any[]> {
    return this.get('/api/v3/costs/budgets');
  }
  async getSavingsRecommendations(): Promise<any[]> {
    return this.get('/api/v3/costs/savings');
  }
  async getCostForecast(): Promise<any[]> {
    return this.get('/api/v3/costs/forecast');
  }
  async createBudget(data: any): Promise<any> {
    return this.post('/api/v3/costs/budgets', data);
  }

  // BI Dashboard
  async getKpiSummary(): Promise<any> {
    return this.get('/api/v3/bi/kpi-summary');
  }
  async getMRR(): Promise<any[]> {
    return this.get('/api/v3/bi/mrr');
  }
  async getARR(): Promise<any> {
    return this.get('/api/v3/bi/arr');
  }
  async getChurnAnalysis(): Promise<any> {
    return this.get('/api/v3/bi/churn');
  }
  async getLTVSegments(): Promise<any[]> {
    return this.get('/api/v3/bi/ltv');
  }
  async getCACMetrics(): Promise<any> {
    return this.get('/api/v3/bi/cac');
  }
  async getAcquisitionChannels(): Promise<any[]> {
    return this.get('/api/v3/bi/acquisition');
  }
  async getRevenueBreakdown(): Promise<any[]> {
    return this.get('/api/v3/bi/revenue');
  }
  async getRevenueForecasts(): Promise<any[]> {
    return this.get('/api/v3/bi/forecasts');
  }
  async getCohortData(): Promise<any[]> {
    return this.get('/api/v3/bi/cohorts');
  }

  // Dependency Graph
  async getDependencyGraph(): Promise<any> {
    return this.get('/api/v3/dependencies/graph');
  }
  async getImpactAnalysis(nodeId: string): Promise<any[]> {
    return this.get(`/api/v3/dependencies/impact/${nodeId}`);
  }
  async discoverDependencies(): Promise<any> {
    return this.post('/api/v3/dependencies/discover');
  }

  // Custom Report Builder
  async listReportDesigns(): Promise<any[]> {
    return this.get('/api/v3/reports/designs');
  }
  async createReportDesign(data: any): Promise<any> {
    return this.post('/api/v3/reports/designs', data);
  }
  async updateReportDesign(id: string, data: any): Promise<any> {
    return this.put(`/api/v3/reports/designs/${id}`, data);
  }
  async deleteReportDesign(id: string): Promise<void> {
    return this.delete(`/api/v3/reports/designs/${id}`);
  }
  async generateReportNow(designId: string, channels?: string[]): Promise<any> {
    return this.post(`/api/v3/reports/designs/${designId}/generate`, { channels });
  }
  async listReportSchedules(): Promise<any[]> {
    return this.get('/api/v3/reports/schedules');
  }
  async createReportSchedule(data: any): Promise<any> {
    return this.post('/api/v3/reports/schedules', data);
  }
  async deleteReportSchedule(id: string): Promise<void> {
    return this.delete(`/api/v3/reports/schedules/${id}`);
  }
  async listReportDeliveries(): Promise<any[]> {
    return this.get('/api/v3/reports/deliveries');
  }
  async getReportTemplates(): Promise<any[]> {
    return this.get('/api/v3/reports/templates');
  }

  // === v3 Marketplace API Methods ===

  // Resource Trading Platform
  async getResourceTrades(filters?: any): Promise<any[]> {
    const params: any = {};
    if (filters) Object.assign(params, filters);
    const res = await this.api.get('/api/v1/marketplace/trades', { params });
    return res.data;
  }
  async createResourceTrade(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/trades', data);
    return res.data;
  }
  async acceptResourceTrade(id: string): Promise<any> {
    const res = await this.api.post(`/api/v1/marketplace/trades/${id}/accept`);
    return res.data;
  }
  async cancelResourceTrade(id: string): Promise<void> {
    await this.api.delete(`/api/v1/marketplace/trades/${id}`);
  }
  async getResourceTradeHistory(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/trades/history');
    return res.data;
  }

  // One-Click App Marketplace
  async listMarketplaceApps(category?: string): Promise<any[]> {
    const params: any = {};
    if (category) params.category = category;
    const res = await this.api.get('/api/v1/marketplace/apps', { params });
    return res.data;
  }
  async getMarketplaceApp(id: string): Promise<any> {
    const res = await this.api.get(`/api/v1/marketplace/apps/${id}`);
    return res.data;
  }
  async installMarketplaceApp(id: string, targetServerId?: string): Promise<any> {
    const res = await this.api.post(`/api/v1/marketplace/apps/${id}/install`, { target_server_id: targetServerId });
    return res.data;
  }
  async uninstallMarketplaceApp(installationId: string): Promise<void> {
    await this.api.delete(`/api/v1/marketplace/apps/installations/${installationId}`);
  }
  async listInstallations(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/apps/installations');
    return res.data;
  }
  async getAppCategories(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/apps/categories');
    return res.data;
  }

  // Pay-Per-Use Billing
  async getPPUMetrics(): Promise<any> {
    const res = await this.api.get('/api/v1/marketplace/ppu/metrics');
    return res.data;
  }
  async getPPUUsage(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/ppu/usage');
    return res.data;
  }
  async setPPUBudget(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/ppu/budget', data);
    return res.data;
  }
  async listPPUPlans(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/ppu/plans');
    return res.data;
  }

  // Reseller / White-Label
  async listResellers(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/resellers');
    return res.data;
  }
  async createReseller(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/resellers', data);
    return res.data;
  }
  async updateReseller(id: string, data: any): Promise<any> {
    const res = await this.api.put(`/api/v1/marketplace/resellers/${id}`, data);
    return res.data;
  }
  async deleteReseller(id: string): Promise<void> {
    await this.api.delete(`/api/v1/marketplace/resellers/${id}`);
  }
  async getResellerAnalytics(id: string): Promise<any> {
    const res = await this.api.get(`/api/v1/marketplace/resellers/${id}/analytics`);
    return res.data;
  }
  async getWhiteLabelSettings(): Promise<any> {
    const res = await this.api.get('/api/v1/marketplace/whitelabel');
    return res.data;
  }
  async updateWhiteLabelSettings(data: any): Promise<any> {
    const res = await this.api.put('/api/v1/marketplace/whitelabel', data);
    return res.data;
  }

  // SLA Management & Credits
  async listSLAs(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/slas');
    return res.data;
  }
  async createSLA(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/slas', data);
    return res.data;
  }
  async updateSLA(id: string, data: any): Promise<any> {
    const res = await this.api.put(`/api/v1/marketplace/slas/${id}`, data);
    return res.data;
  }
  async deleteSLA(id: string): Promise<void> {
    await this.api.delete(`/api/v1/marketplace/slas/${id}`);
  }
  async getSLAStatus(id: string): Promise<any> {
    const res = await this.api.get(`/api/v1/marketplace/slas/${id}/status`);
    return res.data;
  }
  async listCredits(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/credits');
    return res.data;
  }
  async issueCredit(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/credits', data);
    return res.data;
  }

  // Crypto Payment Gateway
  async getCryptoWallets(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/crypto/wallets');
    return res.data;
  }
  async createCryptoWallet(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/crypto/wallets', data);
    return res.data;
  }
  async getCryptoTransactions(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/crypto/transactions');
    return res.data;
  }
  async createCryptoPayment(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/crypto/payments', data);
    return res.data;
  }
  async getCryptoRates(): Promise<any> {
    const res = await this.api.get('/api/v1/marketplace/crypto/rates');
    return res.data;
  }

  // Subscription Plan Builder
  async listSubscriptionPlans(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/plans');
    return res.data;
  }
  async createSubscriptionPlan(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/plans', data);
    return res.data;
  }
  async updateSubscriptionPlan(id: string, data: any): Promise<any> {
    const res = await this.api.put(`/api/v1/marketplace/plans/${id}`, data);
    return res.data;
  }
  async deleteSubscriptionPlan(id: string): Promise<void> {
    await this.api.delete(`/api/v1/marketplace/plans/${id}`);
  }
  async getActiveSubscriptions(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/plans/subscriptions');
    return res.data;
  }

  // Usage-Based Recommendations
  async getRecommendations(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/recommendations');
    return res.data;
  }
  async getRecommendationSummary(): Promise<any> {
    const res = await this.api.get('/api/v1/marketplace/recommendations/summary');
    return res.data;
  }
  async implementRecommendation(id: string): Promise<any> {
    const res = await this.api.post(`/api/v1/marketplace/recommendations/${id}/implement`);
    return res.data;
  }
  async dismissRecommendation(id: string): Promise<void> {
    await this.api.post(`/api/v1/marketplace/recommendations/${id}/dismiss`);
  }

  // Invoice & Tax Automation
  async getTaxRates(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/tax/rates');
    return res.data;
  }
  async addTaxRate(data: any): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/tax/rates', data);
    return res.data;
  }
  async getTaxInvoices(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/tax/invoices');
    return res.data;
  }
  async generateTaxInvoice(): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/tax/invoices/generate');
    return res.data;
  }
  async markInvoicePaid(id: string): Promise<any> {
    const res = await this.api.post(`/api/v1/marketplace/tax/invoices/${id}/pay`);
    return res.data;
  }
  async getTaxSummary(): Promise<any> {
    const res = await this.api.get('/api/v1/marketplace/tax/summary');
    return res.data;
  }
  async fileTaxReport(): Promise<any> {
    const res = await this.api.post('/api/v1/marketplace/tax/file');
    return res.data;
  }

  // Loyalty & Reward System
  async getLoyaltyStatus(): Promise<any> {
    const res = await this.api.get('/api/v1/marketplace/loyalty/status');
    return res.data;
  }
  async getLoyaltyBadges(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/loyalty/badges');
    return res.data;
  }
  async getLoyaltyRewards(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/loyalty/rewards');
    return res.data;
  }
  async redeemReward(rewardId: string): Promise<any> {
    const res = await this.api.post(`/api/v1/marketplace/loyalty/rewards/${rewardId}/redeem`);
    return res.data;
  }
  async getLeaderboard(): Promise<any[]> {
    const res = await this.api.get('/api/v1/marketplace/loyalty/leaderboard');
    return res.data;
  }

  // i18n endpoints
  async getTranslations(): Promise<any> {
    const res = await this.api.get('/api/i18n/translations');
    return res.data;
  }

  async submitTranslation(data: { locale: string; key: string; value: string }): Promise<any> {
    const res = await this.api.post('/api/i18n/translations', data);
    return res.data;
  }

  // Theme Studio endpoints
  async listThemes(): Promise<any[]> {
    const res = await this.api.get('/api/themes');
    return res.data;
  }

  async getTheme(id: string): Promise<any> {
    const res = await this.api.get(`/api/themes/${id}`);
    return res.data;
  }

  async saveTheme(data: { name: string; config: any }): Promise<any> {
    const res = await this.api.post('/api/themes', data);
    return res.data;
  }

  async deleteTheme(id: string): Promise<void> {
    await this.api.delete(`/api/themes/${id}`);
  }

  async publishTheme(id: string): Promise<any> {
    const res = await this.api.post(`/api/themes/${id}/publish`);
    return res.data;
  }

  // Bulk Operations endpoints
  async bulkAction(action: string, ids: string[], params: any): Promise<any> {
    const res = await this.api.post('/api/bulk/execute', { action, ids, params });
    return res.data;
  }

  async getBulkActionStatus(batchId: string): Promise<any> {
    const res = await this.api.get(`/api/bulk/${batchId}`);
    return res.data;
  }

  async undoBulkAction(batchId: string): Promise<any> {
    const res = await this.api.post(`/api/bulk/${batchId}/undo`);
    return res.data;
  }
}

export const apiClient = new APIClient();
