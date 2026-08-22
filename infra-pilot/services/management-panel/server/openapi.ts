const spec: Record<string, any> = {
  openapi: '3.1.0',
  info: {
    title: 'Infra Pilot Management Panel API',
    version: '1.0.0',
    description: 'API for managing Docker apps, backups, alerts, and server infrastructure.',
  },
  servers: [{ url: '/api', description: 'API base' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: { type: 'object', properties: { error: { type: 'string' } } },
      App: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          image: { type: 'string' },
          status: { type: 'string', enum: ['running', 'stopped', 'restarting', 'error'] },
          container_id: { type: 'string' },
          ports: { type: 'array' },
          environment_vars: { type: 'object' },
          volumes: { type: 'array' },
          memory_limit: { type: 'string' },
          cpu_shares: { type: 'integer' },
          description: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      SetupStatus: {
        type: 'object',
        properties: {
          initialized: { type: 'boolean' },
          mode: { type: 'string', enum: ['personal', 'business'] },
        },
      },
      BackupJob: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          app_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          schedule_type: { type: 'string', enum: ['manual', 'hourly', 'daily', 'weekly'] },
          retention_count: { type: 'integer' },
          status: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      AlertConfig: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          metric_type: { type: 'string' },
          operator: { type: 'string', enum: ['gt', 'lt', 'gte', 'lte', 'eq'] },
          threshold: { type: 'number' },
          enabled: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      MaintenanceWindow: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          description: { type: 'string' },
          app_id: { type: 'string', format: 'uuid' },
          starts_at: { type: 'string', format: 'date-time' },
          ends_at: { type: 'string', format: 'date-time' },
          status: { type: 'string' },
        },
      },
      AuditLog: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          action: { type: 'string' },
          entity_type: { type: 'string' },
          entity_id: { type: 'string' },
          old_value: { type: 'object' },
          new_value: { type: 'object' },
          ip_address: { type: 'string' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      NotificationChannel: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          user_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['email', 'webhook', 'telegram'] },
          config: { type: 'object' },
          enabled: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      HealthCheck: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          app_id: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['healthy', 'degraded', 'down', 'unknown'] },
          response_time_ms: { type: 'number' },
          checked_at: { type: 'string', format: 'date-time' },
        },
      },
      SearchResult: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['app', 'audit', 'backup'] },
        },
      },
    },
  },
  paths: {
    '/setup/status': {
      get: {
        summary: 'Check setup initialization status',
        tags: ['Setup'],
        responses: { '200': { description: 'Setup status', content: { 'application/json': { schema: { $ref: '#/components/schemas/SetupStatus' } } } } },
      },
    },
    '/setup/init': {
      post: {
        summary: 'Initialize the panel (create admin user & select mode)',
        tags: ['Setup'],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['email', 'password', 'mode'], properties: { email: { type: 'string', format: 'email' }, password: { type: 'string', minLength: 6 }, displayName: { type: 'string' }, mode: { type: 'string', enum: ['personal', 'business'] } } } } } },
        responses: { '200': { description: 'Setup complete' }, '400': { description: 'Invalid parameters', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
      },
    },
    '/presets': {
      get: { summary: 'List server presets', tags: ['Apps'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Server presets' } } },
    },
    '/apps': {
      get: {
        summary: 'List all apps for current user',
        tags: ['Apps'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'List of apps', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/App' } } } } } },
      },
      post: {
        summary: 'Create a new Docker app',
        tags: ['Apps'],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'image'], properties: { name: { type: 'string' }, image: { type: 'string' }, ports: { type: 'array' }, environmentVars: { type: 'object' }, volumes: { type: 'array' }, memoryLimit: { type: 'string' }, cpuShares: { type: 'integer' }, description: { type: 'string' } } } } } },
        responses: { '201': { description: 'App created', content: { 'application/json': { schema: { $ref: '#/components/schemas/App' } } } }, '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } },
      },
    },
    '/apps/{appId}': {
      get: {
        summary: 'Get app details',
        tags: ['Apps'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'App details', content: { 'application/json': { schema: { $ref: '#/components/schemas/App' } } } }, '404': { description: 'App not found' } },
      },
      patch: {
        summary: 'Update app settings',
        tags: ['Apps'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'App updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/App' } } } }, '404': { description: 'App not found' } },
      },
      delete: {
        summary: 'Delete an app',
        tags: ['Apps'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'App deleted' }, '404': { description: 'App not found' } },
      },
    },
    '/apps/{appId}/start': {
      post: {
        summary: 'Start a container',
        tags: ['Apps'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Container started' }, '404': { description: 'App not found' } },
      },
    },
    '/apps/{appId}/stop': {
      post: {
        summary: 'Stop a container',
        tags: ['Apps'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Container stopped' }, '404': { description: 'App not found' } },
      },
    },
    '/apps/{appId}/restart': {
      post: {
        summary: 'Restart a container',
        tags: ['Apps'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Container restarted' }, '404': { description: 'App not found' } },
      },
    },
    '/apps/{appId}/logs': {
      get: {
        summary: 'Stream paginated logs for an app',
        tags: ['Apps'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'Log entries' } },
      },
    },
    '/apps/{appId}/metrics': {
      get: {
        summary: 'Server metrics for an app',
        tags: ['Metrics'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'range', in: 'query', schema: { type: 'string', default: '30m' } },
        ],
        responses: { '200': { description: 'Metrics data' } },
      },
    },
    '/apps/{appId}/config-versions': {
      get: {
        summary: 'Config version history',
        tags: ['Config'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Config versions' } },
      },
      post: {
        summary: 'Create config version snapshot',
        tags: ['Config'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '201': { description: 'Version created' } },
      },
    },
    '/apps/{appId}/config-versions/{version}/rollback': {
      post: {
        summary: 'Rollback to a specific config version',
        tags: ['Config'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'appId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'version', in: 'path', required: true, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Rollback applied' } },
      },
    },
    '/metrics/aggregated': {
      get: {
        summary: 'Aggregated metrics across all apps',
        tags: ['Metrics'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Aggregated metrics' } },
      },
    },
    '/logs/access': {
      get: {
        summary: 'Access logs',
        tags: ['Logs'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Access log entries' } },
      },
    },
    '/maintenance-windows': {
      get: {
        summary: 'List maintenance windows',
        tags: ['Maintenance'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Maintenance windows', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/MaintenanceWindow' } } } } } },
      },
      post: {
        summary: 'Create maintenance window',
        tags: ['Maintenance'],
        security: [{ bearerAuth: [] }],
        responses: { '201': { description: 'Maintenance window created' } },
      },
    },
    '/maintenance-windows/{id}': {
      patch: {
        summary: 'Update maintenance window',
        tags: ['Maintenance'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Maintenance window updated' }, '404': { description: 'Not found' } },
      },
    },
    '/backup-jobs': {
      get: {
        summary: 'List backup jobs',
        tags: ['Backups'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Backup jobs', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/BackupJob' } } } } } },
      },
      post: {
        summary: 'Create a backup job',
        tags: ['Backups'],
        security: [{ bearerAuth: [] }],
        responses: { '201': { description: 'Backup job created' } },
      },
    },
    '/backup-jobs/{id}': {
      patch: {
        summary: 'Update a backup job',
        tags: ['Backups'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Backup job updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        summary: 'Delete a backup job',
        tags: ['Backups'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Backup job deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/backup-jobs/{jobId}/status': {
      get: {
        summary: 'Backup status history',
        tags: ['Backups'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'jobId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Backup status entries' } },
      },
    },
    '/alert-configs': {
      get: {
        summary: 'List alert configurations',
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Alert configs', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AlertConfig' } } } } } },
      },
      post: {
        summary: 'Create alert configuration',
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        responses: { '201': { description: 'Alert config created' } },
      },
    },
    '/alert-configs/{id}': {
      patch: {
        summary: 'Update alert configuration',
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Alert config updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        summary: 'Delete alert configuration',
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Alert config deleted' } },
      },
    },
    '/alert-history': {
      get: {
        summary: 'Alert history',
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Alert history entries' } },
      },
    },
    '/alert-history/{id}/acknowledge': {
      post: {
        summary: 'Acknowledge an alert',
        tags: ['Alerts'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'Alert acknowledged' } },
      },
    },
    '/health-checks': {
      get: {
        summary: 'Health check results',
        tags: ['Health'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'app_id', in: 'query', schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Health check entries', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/HealthCheck' } } } } } },
      },
    },
    '/reports': {
      get: {
        summary: 'Generate reports',
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Report data' } },
      },
    },
    '/reports/export': {
      get: {
        summary: 'Export report (CSV or PDF)',
        tags: ['Reports'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'format', in: 'query', schema: { type: 'string', enum: ['csv', 'pdf'] } }],
        responses: { '200': { description: 'Exported file' } },
      },
    },
    '/user': {
      get: { summary: 'Get current user info', tags: ['User'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'User profile' } } },
    },
    '/config/mode': {
      get: { summary: 'Get current mode', tags: ['Config'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Current mode' } } },
    },
    '/health': {
      get: { summary: 'Health check', tags: ['Health'], responses: { '200': { description: 'Server health status' } } },
    },
    '/demo/flag': {
      get: { summary: 'Demo feature flag', tags: ['Demo'], responses: { '200': { description: 'Demo flag status' } } },
    },
    '/customers': {
      get: { summary: 'List customers (Business Mode)', tags: ['Customers'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Customers list' } } },
      post: { summary: 'Create customer (Business Mode)', tags: ['Customers'], security: [{ bearerAuth: [] }], responses: { '201': { description: 'Customer created' } } },
    },
    '/customers/{customerId}': {
      patch: { summary: 'Update customer', tags: ['Customers'], security: [{ bearerAuth: [] }], parameters: [{ name: 'customerId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Customer updated' } } },
      delete: { summary: 'Delete customer', tags: ['Customers'], security: [{ bearerAuth: [] }], parameters: [{ name: 'customerId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': { description: 'Customer deleted' } } },
    },
    '/seed-demo': {
      post: { summary: 'Seed demo data', tags: ['Demo'], security: [{ bearerAuth: [] }], responses: { '200': { description: 'Demo data seeded' } } },
    },
    '/search': {
      get: {
        summary: 'Global search across apps, audit logs, and backups',
        tags: ['Search'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } }],
        responses: { '200': { description: 'Search results', content: { 'application/json': { schema: { type: 'object', properties: { results: { type: 'array', items: { $ref: '#/components/schemas/SearchResult' } } } } } } }, '400': { description: 'Query too short' } },
      },
    },
    '/audit-log': {
      get: {
        summary: 'Paginated audit log entries',
        tags: ['Audit'],
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'user_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'entity_type', in: 'query', schema: { type: 'string' } },
          { name: 'action', in: 'query', schema: { type: 'string' } },
          { name: 'start_date', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'end_date', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'Audit log entries', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/AuditLog' } } } } } },
      },
    },
    '/notification-channels': {
      get: {
        summary: 'List notification channels',
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Notification channels', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/NotificationChannel' } } } } } },
      },
      post: {
        summary: 'Create notification channel',
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['name', 'type', 'config'], properties: { name: { type: 'string' }, type: { type: 'string', enum: ['email', 'webhook', 'telegram'] }, config: { type: 'object' } } } } } },
        responses: { '201': { description: 'Channel created' } },
      },
    },
    '/notification-channels/{id}': {
      patch: {
        summary: 'Update notification channel',
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Channel updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        summary: 'Delete notification channel',
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Channel deleted' } },
      },
    },
    '/notification-channels/{id}/test': {
      post: {
        summary: 'Send test notification',
        tags: ['Notifications'],
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { '200': { description: 'Test notification sent' } },
      },
    },
  },
};

export default spec;
