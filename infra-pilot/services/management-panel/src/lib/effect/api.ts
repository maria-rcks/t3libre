import { Effect } from 'effect';
import axios from 'axios';
import { apiClient } from '../api';
import type {
  SetupStatus, DockerApp, UserProfile, AppConfig, Customer,
  ServerPreset, ServerMetric, AccessLog, ConfigVersion, MaintenanceWindow,
  BackupJob, BackupStatusEntry, AlertConfig, AlertHistoryEntry, HealthCheck,
  ScheduledTask, GitDeployment, Database, BillingInfo, Transaction,
  BillingRates, CostEstimate, Modpack, ModpackInstallation,
  ServerCloneRequest, ServerRoleAssignment, ServerSnapshot,
  AutopilotRecommendation, ServerWorkspace, ServerBillingLedger,
  ActivityEvent, DashboardDefinition, ReportDesign, ReportSchedule,
  ReportDelivery, ReportTemplate, KPISummary, MRRPoint, ARRBreakdown,
  ChurnAnalysis, LTVSegment, CACMetrics, AcquisitionChannel,
  RevenueBreakdown, RevenueForecast, CohortRow, DependencyGraph,
  ImpactAnalysis, CostBreakdown, CostTrendPoint, UnitEconomics, Budget,
  SavingsRecommendation, CostForecast, GeoEvent, HeatmapDataPoint,
  RegionAggregation, TopCity, TimelapseFrame, GeoFilterOptions,
  KBArticle, KBCategory,
} from '../types';
import { ApiError, NetworkError, AuthError, NotFoundError, ValidationError, type DomainError } from './errors';

const toDomainError = (error: unknown): DomainError => {
  if (error instanceof ApiError || error instanceof AuthError || error instanceof NotFoundError || error instanceof ValidationError) {
    return error;
  }
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 401) return new AuthError();
    if (error.response?.status === 404) return new NotFoundError();
    if (error.response?.status && error.response?.status >= 400) {
      return new ApiError(error.message, error.response.status);
    }
    return new NetworkError(error.message, error);
  }
  if (error instanceof Error) return new ApiError(error.message);
  return new NetworkError('Unknown error', error);
};

export const effectify = <A>(fn: () => Promise<A>): Effect.Effect<A, DomainError, never> =>
  Effect.tryPromise({
    try: fn,
    catch: toDomainError,
  });

export const effectifyWithInput = <P extends any[], A>(
  fn: (...args: P) => Promise<A>
): (...args: P) => Effect.Effect<A, DomainError, never> =>
  (...args: P) => Effect.tryPromise({
    try: () => fn(...args),
    catch: toDomainError,
  });

export const apiClientEffect = {
  getSetupStatus: (): Effect.Effect<SetupStatus, DomainError, never> =>
    effectify(() => apiClient.getSetupStatus()),

  listApps: (): Effect.Effect<DockerApp[], DomainError, never> =>
    effectify(() => apiClient.listApps()),

  getApp: (appId: string): Effect.Effect<DockerApp, DomainError, never> =>
    effectify(() => apiClient.getApp(appId)),

  createApp: (app: Partial<DockerApp>): Effect.Effect<DockerApp, DomainError, never> =>
    effectify(() => apiClient.createApp(app)),

  updateApp: (appId: string, updates: Partial<DockerApp>): Effect.Effect<DockerApp, DomainError, never> =>
    effectify(() => apiClient.updateApp(appId, updates)),

  deleteApp: (appId: string): Effect.Effect<void, DomainError, never> =>
    effectify(() => apiClient.deleteApp(appId)),

  startApp: (appId: string): Effect.Effect<DockerApp, DomainError, never> =>
    effectify(() => apiClient.startApp(appId)),

  stopApp: (appId: string): Effect.Effect<DockerApp, DomainError, never> =>
    effectify(() => apiClient.stopApp(appId)),

  restartApp: (appId: string): Effect.Effect<DockerApp, DomainError, never> =>
    effectify(() => apiClient.restartApp(appId)),

  getUser: (): Effect.Effect<UserProfile, DomainError, never> =>
    effectify(() => apiClient.getUser()),

  getConfig: (): Effect.Effect<AppConfig, DomainError, never> =>
    effectify(() => apiClient.getConfig()),

  getCustomers: (): Effect.Effect<Customer[], DomainError, never> =>
    effectify(() => apiClient.getCustomers()),

  createCustomer: (customer: Partial<Customer>): Effect.Effect<Customer, DomainError, never> =>
    effectify(() => apiClient.createCustomer(customer)),

  updateCustomer: (customerId: string, updates: Partial<Customer>): Effect.Effect<any, DomainError, never> =>
    effectify(() => apiClient.updateCustomer(customerId, updates)),

  deleteCustomer: (customerId: string): Effect.Effect<any, DomainError, never> =>
    effectify(() => apiClient.deleteCustomer(customerId)),

  listPresets: (): Effect.Effect<ServerPreset[], DomainError, never> =>
    effectify(() => apiClient.listPresets()),

  getServerMetrics: (appId: string, range?: string): Effect.Effect<ServerMetric[], DomainError, never> =>
    effectify(() => apiClient.getServerMetrics(appId, range)),

  getAccessLogs: (limit?: number, offset?: number): Effect.Effect<AccessLog[], DomainError, never> =>
    effectify(() => apiClient.getAccessLogs(limit, offset)),

  getConfigVersions: (appId: string): Effect.Effect<ConfigVersion[], DomainError, never> =>
    effectify(() => apiClient.getConfigVersions(appId)),

  getMaintenanceWindows: (): Effect.Effect<MaintenanceWindow[], DomainError, never> =>
    effectify(() => apiClient.getMaintenanceWindows()),

  createMaintenanceWindow: (window: Partial<MaintenanceWindow>): Effect.Effect<MaintenanceWindow, DomainError, never> =>
    effectify(() => apiClient.createMaintenanceWindow(window)),

  getBackupJobs: (): Effect.Effect<BackupJob[], DomainError, never> =>
    effectify(() => apiClient.getBackupJobs()),

  getAlertConfigs: (): Effect.Effect<AlertConfig[], DomainError, never> =>
    effectify(() => apiClient.getAlertConfigs()),

  getAlertHistory: (): Effect.Effect<AlertHistoryEntry[], DomainError, never> =>
    effectify(() => apiClient.getAlertHistory()),

  getHealthChecks: (appId?: string): Effect.Effect<HealthCheck[], DomainError, never> =>
    effectify(() => apiClient.getHealthChecks(appId)),

  getScheduledTasks: (): Effect.Effect<ScheduledTask[], DomainError, never> =>
    effectify(() => apiClient.getScheduledTasks()),

  getDeployments: (): Effect.Effect<GitDeployment[], DomainError, never> =>
    effectify(() => apiClient.getDeployments()),

  getDatabases: (): Effect.Effect<Database[], DomainError, never> =>
    effectify(() => apiClient.getDatabases()),

  getBalance: (): Effect.Effect<BillingInfo, DomainError, never> =>
    effectify(() => apiClient.getBalance()),

  getTransactions: (): Effect.Effect<Transaction[], DomainError, never> =>
    effectify(() => apiClient.getTransactions()),

  getBillingRates: (): Effect.Effect<BillingRates, DomainError, never> =>
    effectify(() => apiClient.getBillingRates()),

  getCostEstimate: (cpu: number, ram: number, storage: number): Effect.Effect<CostEstimate, DomainError, never> =>
    effectify(() => apiClient.getCostEstimate(cpu, ram, storage)),

  searchModpacks: (query: string, platform?: string): Effect.Effect<Modpack[], DomainError, never> =>
    effectify(() => apiClient.searchModpacks(query, platform)),

  cloneServer: (appId: string, request: ServerCloneRequest): Effect.Effect<DockerApp, DomainError, never> =>
    effectify(() => apiClient.cloneServer(appId, request)),

  listServerSnapshots: (appId: string): Effect.Effect<ServerSnapshot[], DomainError, never> =>
    effectify(() => apiClient.listServerSnapshots(appId)),

  createServerSnapshot: (appId: string, snapshot: { name: string; schedule: 'manual' | 'automatic' }): Effect.Effect<ServerSnapshot, DomainError, never> =>
    effectify(() => apiClient.createServerSnapshot(appId, snapshot)),

  listServerRoles: (appId: string): Effect.Effect<ServerRoleAssignment[], DomainError, never> =>
    effectify(() => apiClient.listServerRoles(appId)),

  getAutopilotRecommendations: (appId: string): Effect.Effect<AutopilotRecommendation[], DomainError, never> =>
    effectify(() => apiClient.getAutopilotRecommendations(appId)),

  listWorkspaces: (): Effect.Effect<ServerWorkspace[], DomainError, never> =>
    effectify(() => apiClient.listWorkspaces()),

  createWorkspace: (workspace: { name: string; appIds: string[] }): Effect.Effect<ServerWorkspace, DomainError, never> =>
    effectify(() => apiClient.createWorkspace(workspace)),

  getServerBilling: (appId: string): Effect.Effect<ServerBillingLedger, DomainError, never> =>
    effectify(() => apiClient.getServerBilling(appId)),

  installServerPlugin: (appId: string, pluginId: string): Effect.Effect<{ success: boolean; pluginId: string }, DomainError, never> =>
    effectify(() => apiClient.installServerPlugin(appId, pluginId)),

  restoreServerSnapshot: (appId: string, snapshotId: string): Effect.Effect<ServerSnapshot, DomainError, never> =>
    effectify(() => apiClient.restoreServerSnapshot(appId, snapshotId)),

  upsertServerRole: (appId: string, role: Partial<ServerRoleAssignment>): Effect.Effect<ServerRoleAssignment, DomainError, never> =>
    effectify(() => apiClient.upsertServerRole(appId, role)),

  getActivityFeed: (params: {
    limit?: number; offset?: number; type?: string;
    userId?: string; from?: string; to?: string;
  }): Effect.Effect<{ events: ActivityEvent[]; total: number }, DomainError, never> =>
    effectify(() => apiClient.getActivityFeed(params)),

  listDashboards: (): Effect.Effect<DashboardDefinition[], DomainError, never> =>
    effectify(() => apiClient.listDashboards()),

  health: (): Effect.Effect<{ status: string }, DomainError, never> =>
    effectify(() => apiClient.health()),

  seedDemo: (): Effect.Effect<any, DomainError, never> =>
    effectify(() => apiClient.seedDemo()),

  get: (url: string, params?: any): Effect.Effect<any, DomainError, never> =>
    effectify(() => apiClient.get(url, params)),

  post: (url: string, data?: any): Effect.Effect<any, DomainError, never> =>
    effectify(() => apiClient.post(url, data)),

  put: (url: string, data?: any): Effect.Effect<any, DomainError, never> =>
    effectify(() => apiClient.put(url, data)),

  delete: (url: string): Effect.Effect<void, DomainError, never> =>
    effectify(() => apiClient.delete(url)),
};
