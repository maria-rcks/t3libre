import { createContext, useContext } from 'react';

export type SetupMode = 'personal' | 'business';

export interface SetupStatus {
  initialized: boolean;
  mode: SetupMode | null;
}

export interface DockerApp {
  id: string;
  user_id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'restarting' | 'error';
  container_id?: string;
  ports?: Array<{ hostPort: number; containerPort: number; protocol: string }>;
  environment_vars?: Record<string, string>;
  volumes?: Array<{ hostPath: string; containerPath: string }>;
  restart_policy?: string;
  memory_limit?: string;
  cpu_shares?: number;
  description?: string;
  labels?: Record<string, string>;
  javaVersion?: string;
  created_at: string;
  updated_at: string;
  started_at?: string;
}

export interface UserProfile {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  role: 'admin' | 'user';
  mode_at_signup: SetupMode;
}

export interface AppConfig {
  mode: SetupMode;
}

export interface Customer {
  id: string;
  owner_user_id: string;
  name: string;
  email?: string;
  created_at?: string;
  updated_at?: string;
}

// Feature gates based on mode
export const featureGates = {
  isPersonal: (mode: SetupMode) => mode === 'personal',
  isBusiness: (mode: SetupMode) => mode === 'business',
  
  // Personal mode features (always available)
  canManageLocalApps: (mode: SetupMode) => true,
  canViewLogs: (mode: SetupMode) => true,
  canConfigureEnv: (mode: SetupMode) => true,
  
  // Business mode features
  canManageCustomers: (mode: SetupMode) => mode === 'business',
  canManagePlans: (mode: SetupMode) => mode === 'business',
  canViewBilling: (mode: SetupMode) => mode === 'business',
  canWhitelabel: (mode: SetupMode) => mode === 'business',
  canManageTeam: (mode: SetupMode) => mode === 'business',
  canViewAuditLogs: (mode: SetupMode) => mode === 'business',
  canConfigureHosting: (mode: SetupMode) => mode === 'business',
};

// Config context for global access to mode
export const ConfigContext = createContext<{ mode: SetupMode; loading: boolean }>({
  mode: 'personal',
  loading: true,
});

export const useConfig = () => {
  const context = useContext(ConfigContext);
  if (!context) {
    throw new Error('useConfig must be used within ConfigProvider');
  }
  return context;
};


export interface ServerPreset {
  id: string;
  name: string;
  description: string;
  image: string;
  startupCommand: string;
  resources: {
    ram: string;
    cpu: number;
    disk: string;
  };
  ports: Array<{ hostPort: number; containerPort: number; protocol: 'tcp' | 'udp' }>;
  environmentVars: Record<string, string>;
  javaVersion?: string;
}

export const JAVA_VERSIONS = ['8', '11', '17', '21'] as const;

// ============================================================================
// Phase 4 Types
// ============================================================================

export interface ServerMetric {
  id: number;
  app_id: string;
  tps: number | null;
  player_count: number;
  memory_used_mb: number;
  memory_total_mb: number;
  cpu_percent: number;
  world_size_mb: number;
  lag_spike: boolean;
  recorded_at: string;
}

export interface AccessLog {
  id: number;
  user_id: string;
  action: string;
  source_ip: string;
  status: 'success' | 'failed' | 'pending';
  details: string;
  created_at: string;
}

export interface ConfigVersion {
  id: number;
  app_id: string;
  version: number;
  config_snapshot: Record<string, any>;
  created_by: string;
  change_summary: string;
  created_at: string;
}

export interface MaintenanceWindow {
  id: string;
  user_id: string;
  title: string;
  description: string;
  app_id: string;
  starts_at: string;
  ends_at: string;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  created_at: string;
}

export interface BackupJob {
  id: string;
  user_id: string;
  app_id: string;
  name: string;
  schedule_type: 'manual' | 'hourly' | 'daily' | 'weekly';
  retention_count: number;
  next_run: string;
  last_run: string;
  status: 'active' | 'paused' | 'archived';
  created_at: string;
}

export interface BackupStatusEntry {
  id: number;
  backup_job_id: string;
  status: 'running' | 'success' | 'failed';
  size_mb: number;
  error_message: string;
  started_at: string;
  completed_at: string;
}

export interface AlertConfig {
  id: string;
  user_id: string;
  metric_type: string;
  operator: 'gt' | 'lt' | 'gte' | 'lte' | 'eq';
  threshold: number;
  enabled: boolean;
  notify_email: boolean;
  created_at: string;
}

export interface AlertHistoryEntry {
  id: number;
  alert_config_id: string;
  metric_type: string;
  metric_value: number;
  threshold: number;
  operator: string;
  triggered_at: string;
  acknowledged: boolean;
}

export interface ScheduledTask {
  id: string;
  name: string;
  description?: string;
  taskType: 'restart' | 'command' | 'backup' | 'custom';
  targetAppId?: string;
  cronExpression: string;
  command?: string;
  enabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'failed' | 'running';
  nextRunAt?: string;
  createdAt: string;
}

export interface BillingInfo {
  balance: number;
  totalSpent: number;
  totalToppedUp: number;
}

export interface Transaction {
  id: string;
  amount: number;
  description: string;
  type: 'topup' | 'charge' | 'refund' | 'bonus';
  balanceAfter: number;
  timestamp: string;
}

export interface BillingRates {
  cpuPerCoreHour: number;
  ramPerGbHour: number;
  storagePerGbHour: number;
  backupPerGb: number;
}

export interface CostEstimate {
  hourly: number;
  daily: number;
  monthly: number;
}

export interface HealthCheck {
  id: number;
  app_id: string;
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  response_time_ms: number;
  details: Record<string, any>;
  checked_at: string;
}

// ============================================================================
// Config Editor Types
// ============================================================================

export interface ConfigFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  isDirectory: boolean;
}

export interface ConfigFileContent {
  content: string;
  path: string;
  language: 'yaml' | 'json' | 'properties' | 'text';
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export interface Modpack {
  id: string;
  name: string;
  platform: 'curseforge' | 'modrinth';
  summary: string;
  downloads: number;
  iconUrl?: string;
  minecraftVersions: string[];
  loaders: string[];
  url: string;
}

export interface ModpackInstallation {
  id: string;
  modpackId: string;
  appId: string;
  status: 'pending' | 'downloading' | 'installing' | 'completed' | 'failed';
  progress: number;
  error?: string;
  createdAt: string;
}

export interface Database {
  id: string;
  name: string;
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  appId?: string;
  status: 'running' | 'stopped' | 'creating';
  createdAt: string;
}

export interface GitDeployment {
  id: string;
  name: string;
  repoUrl: string;
  repo: string;
  branch: string;
  containerId?: string;
  targetDir: string;
  installCommand?: string;
  restartCommand?: string;
  enabled: boolean;
  webhookSecret: string;
  createdAt: string;
  history: DeploymentEvent[];
}

export interface DeploymentEvent {
  deploymentId: string;
  status: 'success' | 'failed' | 'timeout';
  commits: number;
  timestamp: string;
  error?: string;
}

// ============================================================================
// Knowledge Base Types
// ============================================================================

export interface KBArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  author: string;
  authorName?: string;
  created_at: string;
  updated_at: string;
  published: boolean;
  resourceLinks?: string[];
}

export interface KBCategory {
  id: string;
  name: string;
  parentId?: string;
  description?: string;
  articleCount?: number;
}

// ============================================================================
// Activity Feed Types
// ============================================================================

export type ActivityEventType =
  | 'app:create' | 'app:update' | 'app:delete'
  | 'app:start' | 'app:stop' | 'app:restart'
  | 'backup:create' | 'backup:update' | 'backup:delete'
  | 'config:update' | 'deployment' | 'alert'
  | 'maintenance' | 'user:login' | 'user:logout'
  | 'database:create' | 'database:delete'
  | 'knowledge_base:create' | 'knowledge_base:update' | 'knowledge_base:delete';

export interface ActivityEvent {
  id: string;
  type: ActivityEventType;
  userId: string;
  userName?: string;
  description: string;
  metadata?: Record<string, any>;
  timestamp: string;
  severity: 'info' | 'warning' | 'error';
}

// ============================================================================
// Dashboard Builder Types
// ============================================================================

export type PanelType = 'time-series' | 'stat' | 'log-list' | 'alert-list';

export interface PanelDataSource {
  type: 'metrics' | 'logs' | 'alerts' | 'backups' | 'apps';
  query?: string;
  aggregation?: string;
  period?: string;
}

export interface DashboardPanel {
  id: string;
  type: PanelType;
  title: string;
  dataSource: PanelDataSource;
  position: { x: number; y: number; w: number; h: number };
  config: Record<string, any>;
}

export interface DashboardDefinition {
  id: string;
  name: string;
  description?: string;
  panels: DashboardPanel[];
  layout: { columns: number; rowHeight: number };
  refreshInterval: number;
  starred: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// AI Config Advisor Types
// ============================================================================

export interface ConfigAdviceSuggestion {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  recommendation: string;
  file?: string;
  line?: number;
  currentValue?: string;
  suggestedValue?: string;
  autoFixable: boolean;
  fixCommand?: string;
}

export interface ConfigAdviceResult {
  appId: string;
  analyzedAt: string;
  total: number;
  critical: number;
  warning: number;
  info: number;
  suggestions: ConfigAdviceSuggestion[];
}

// ============================================================================
// Plugin Marketplace Types
// ============================================================================

export interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  downloads: number;
  iconUrl?: string;
  readmeUrl?: string;
  homepage?: string;
  createdAt: string;
  updatedAt: string;
  installed: boolean;
  installedVersion?: string;
  installedAt?: string;
  appId?: string;
}

export interface PluginPublishData {
  name: string;
  description: string;
  version: string;
  author: string;
  category: string;
  tags: string[];
  iconUrl?: string;
  homepage?: string;
}

// ============================================================================
// Collaborative Terminal Types
// ============================================================================

export interface TerminalSession {
  id: string;
  appId: string;
  createdBy: string;
  createdAt: string;
  users: TerminalUser[];
}

export interface TerminalUser {
  id: string;
  displayName: string;
  cursor?: { row: number; col: number };
  joinedAt: string;
}

// ============================================================================
// Change Approval Types
// ============================================================================

export interface ChangeRequest {
  id: string;
  userId: string;
  userName: string;
  appId: string;
  action: string;
  reason: string;
  details: string;
  status: 'pending' | 'approved' | 'rejected' | 'emergency';
  reviewerId?: string;
  reviewerName?: string;
  rejectReason?: string;
  createdAt: string;
  reviewedAt?: string;
  expiresAt: string;
  isBreakGlass: boolean;
}

export interface ChangeRequestInput {
  appId: string;
  action: string;
  reason: string;
  details: string;
  isBreakGlass?: boolean;
}


// ============================================================================
// Server Operations Feature Types
// ============================================================================

export interface ServerCloneRequest {
  name: string;
  includeFiles?: boolean;
  includeBackups?: boolean;
}

export interface ServerPermissionSet {
  start: boolean;
  stop: boolean;
  console: boolean;
  files: boolean;
  backups: boolean;
  deployments: boolean;
}

export interface ServerRoleAssignment {
  id: string;
  appId: string;
  principal: string;
  role: 'owner' | 'admin' | 'operator' | 'viewer' | 'custom';
  permissions: ServerPermissionSet;
  createdAt: string;
}

export interface ServerSnapshot {
  id: string;
  appId: string;
  name: string;
  schedule: 'manual' | 'automatic';
  status: 'ready' | 'creating' | 'restoring' | 'failed';
  sizeMb: number;
  createdAt: string;
  restoredAt?: string;
}

export interface AutopilotRecommendation {
  id: string;
  appId: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  recommendation: string;
  confidence: number;
  createdAt: string;
}

export interface ServerWorkspace {
  id: string;
  name: string;
  appIds: string[];
  memberCount: number;
  sharedBackups: boolean;
  sharedLogs: boolean;
  createdAt: string;
}

export interface ServerBillingLedger {
  appId: string;
  projectId?: string;
  currency: 'EUR' | 'USD';
  currentMonth: number;
  monthlyEstimate: number;
  lineItems: Array<{ label: string; amount: number; unit: string }>;
}

// ============================================================================
// Custom Report Builder Types
// ============================================================================

export type ReportWidgetType = 'line-chart' | 'bar-chart' | 'pie-chart' | 'area-chart' | 'data-table' | 'metric-card' | 'text-block' | 'image-block' | 'status-indicator';

export type DeliveryChannel = 'email' | 'slack' | 'discord' | 'webhook' | 'pdf';

export type ReportScheduleFrequency = 'one-time' | 'daily' | 'weekly' | 'monthly' | 'custom';

export interface ReportWidgetConfig {
  type: ReportWidgetType;
  title: string;
  dataSource: { type: string; query?: string; metric?: string; aggregation?: string; period?: string };
  position: { x: number; y: number; w: number; h: number };
  config: Record<string, any>;
}

export interface ReportDesign {
  id: string;
  name: string;
  description: string;
  widgets: ReportWidgetConfig[];
  layout: { columns: number; rowHeight: number };
  created_at: string;
  updated_at: string;
}

export interface ReportSchedule {
  id: string;
  design_id: string;
  frequency: ReportScheduleFrequency;
  cron_expression?: string;
  day_of_week?: number;
  day_of_month?: number;
  time: string;
  timezone: string;
  channels: DeliveryChannel[];
  recipients: string[];
  webhook_url?: string;
  format: 'csv' | 'excel' | 'pdf';
  enabled: boolean;
  last_run?: string;
  next_run?: string;
  created_at: string;
}

export interface ReportDelivery {
  id: string;
  schedule_id: string;
  design_id: string;
  channels: DeliveryChannel[];
  status: 'pending' | 'sent' | 'failed';
  error_message?: string;
  delivered_at: string;
  recipient_count: number;
}

export interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  widgets: ReportWidgetConfig[];
  layout: { columns: number; rowHeight: number };
}

// ============================================================================
// BI Dashboard Types
// ============================================================================

export interface MRRPoint {
  month: string;
  mrr: number;
  new_business: number;
  expansion: number;
  contraction: number;
  churn: number;
}

export interface ARRBreakdown {
  current_arr: number;
  segments: Array<{ name: string; value: number; percentage: number }>;
  growth_rate: number;
  projected_arr: number;
}

export interface ChurnAnalysis {
  monthly_rate: number;
  quarterly_rate: number;
  annual_rate: number;
  nrr: number;
  grr: number;
  trends: Array<{ month: string; rate: number; lost_revenue: number }>;
  reasons: Array<{ reason: string; count: number; revenue_impact: number }>;
}

export interface LTVSegment {
  segment: string;
  customers: number;
  avg_ltv: number;
  avg_lifetime_months: number;
  avg_revenue_per_month: number;
}

export interface CACMetrics {
  overall_cac: number;
  by_channel: Array<{ channel: string; cac: number; conversions: number; spend: number }>;
  ltv_cac_ratio: number;
  payback_months: number;
}

export interface AcquisitionChannel {
  channel: string;
  customers: number;
  percentage: number;
  cost: number;
  conversion_rate: number;
}

export interface CohortRow {
  cohort: string;
  periods: number[];
  size: number;
}

export interface RevenueBreakdown {
  categories: Array<{ name: string; revenue: number; percentage: number; growth: number }>;
  total_revenue: number;
  month_over_month: number;
}

export interface RevenueForecast {
  historical: Array<{ month: string; revenue: number }>;
  forecast: Array<{ month: string; revenue: number; lower_bound: number; upper_bound: number }>;
  confidence: number;
}

export interface KPISummary {
  mrr: number;
  mrr_growth: number;
  arr: number;
  ltv: number;
  cac: number;
  ltv_cac_ratio: number;
  churn_rate: number;
  nrr: number;
  grr: number;
  active_customers: number;
  new_customers_this_month: number;
  expansion_revenue: number;
  contraction_revenue: number;
}

// ============================================================================
// Dependency Graph Types
// ============================================================================

export type EdgeType = 'http' | 'grpc' | 'database' | 'message_queue' | 'file_system';

export interface DependencyNode {
  id: string;
  name: string;
  type: 'service' | 'database' | 'queue' | 'cache' | 'storage' | 'external';
  status: 'healthy' | 'degraded' | 'down' | 'unknown';
  metrics: {
    latency_ms: number;
    error_rate: number;
    requests_per_min: number;
  };
  tags: string[];
  version: string;
}

export interface DependencyEdge {
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
  latency_ms: number;
  label: string;
}

export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
  generated_at: string;
}

export interface ImpactAnalysis {
  service_id: string;
  service_name: string;
  downstream_services: string[];
  downstream_count: number;
  critical_paths: Array<{ path: string[]; total_latency: number }>;
  blast_radius: number;
}

// ============================================================================
// Cost & Usage Analytics Types
// ============================================================================

export interface CostBreakdown {
  total_cost: number;
  month_over_month: number;
  by_service: Array<{ service: string; cost: number; percentage: number }>;
  by_environment: Array<{ environment: string; cost: number; percentage: number }>;
  by_team: Array<{ team: string; cost: number; percentage: number }>;
  by_provider: Array<{ provider: string; cost: number; percentage: number }>;
  by_region: Array<{ region: string; cost: number; percentage: number }>;
}

export interface CostTrendPoint {
  date: string;
  cost: number;
  compute: number;
  storage: number;
  network: number;
  database: number;
  other: number;
}

export interface UnitEconomics {
  cost_per_request: number;
  cost_per_gb_storage: number;
  cost_per_active_user: number;
  cost_per_api_call: number;
  by_service: Array<{ service: string; cost_per_request: number; cost_per_user: number }>;
}

export interface Budget {
  id: string;
  name: string;
  scope: string;
  amount: number;
  spent: number;
  period: 'monthly' | 'quarterly' | 'annual';
  start_date: string;
  end_date?: string;
  alert_threshold: number;
  status: 'active' | 'exceeded' | 'at_risk' | 'archived';
}

export interface SavingsRecommendation {
  id: string;
  title: string;
  description: string;
  potential_savings: number;
  effort: 'low' | 'medium' | 'high';
  category: string;
  action: string;
}

export interface CostForecast {
  historical: Array<{ month: string; actual: number }>;
  projected: Array<{ month: string; forecast: number; lower: number; upper: number }>;
  next_month_estimate: number;
  confidence: number;
}

// ============================================================================
// Geolocation Heatmap Types
// ============================================================================

export interface GeoEvent {
  id: string;
  latitude: number;
  longitude: number;
  city: string;
  region: string;
  country: string;
  country_code: string;
  service: string;
  response_time_ms: number;
  error: boolean;
  user_agent: string;
  user_id?: string;
  timestamp: string;
}

export interface HeatmapDataPoint {
  latitude: number;
  longitude: number;
  weight: number;
  count: number;
  avg_response_time: number;
  error_rate: number;
}

export interface RegionAggregation {
  region: string;
  country: string;
  country_code: string;
  total_requests: number;
  active_users: number;
  avg_response_time: number;
  error_rate: number;
  latitude: number;
  longitude: number;
}

export interface TopCity {
  city: string;
  region: string;
  country: string;
  country_code: string;
  total_requests: number;
  active_users: number;
  avg_response_time: number;
  error_rate: number;
  latitude: number;
  longitude: number;
}

export interface TimelapseFrame {
  timestamp: string;
  points: HeatmapDataPoint[];
}

export interface GeoFilterOptions {
  countries: Array<{ code: string; name: string }>;
  services: string[];
  date_range: { min: string; max: string };
  response_time_range: { min: number; max: number };
  error_rates: Array<{ value: number; label: string }>;
}
