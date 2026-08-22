# docker panel - mode architecture

## overview

docker panel supports two distinct operation modes:

• **personal mode** (default) - simple self-hosted docker container management
• **hosting business mode** - full-featured hosting control panel with customer management, billing, and white-label options

the mode is selected during initial setup and controls which features are available throughout the application.

## mode selection & initialization

### first-time setup

when the panel is first accessed, users see the **setup wizard**:

```
Step 1: Mode Selection
├─ Personal Mode (default, recommended)
│   └─ Simple Docker app management for self-hosters
└─ Hosting Business Mode
    └─ Full-featured hosting control panel

Step 2: Create Admin Account
├─ Display Name
├─ Email
├─ Password
└─ Mode confirmation (from Step 1)
```

database: the selected mode is stored in `setup_config.mode` and `user_profiles.mode_at_signup`.

### after setup

subsequent logins display the panel based on the configured mode. settings may allow mode switching (future enhancement).

## personal mode features

**focused on individual self-hosters and hobby projects**

### core features
- docker app creation and management
- port mapping and environment variables
- volume/mount configuration
- start/stop/restart controls
- logs streaming (paginated)
- basic container status monitoring
- simple admin account management
- basic settings and configuration

### hidden features
- customer account management
- plans and pricing
- billing integration
- white-label options
- team/staff roles
- resource quotas (per-customer)
- audit logs (business context)
- advanced multi-user rbac

### ui/ux
- minimal, focused navigation
- "docker panel" branding
- simple dashboard with app list
- single-user perspective
- settings are personal, not organizational

## hosting business mode features

**full hosting control panel for managing multiple customers**

### core features (from personal mode)
- all personal mode features
- docker infrastructure abstraction

### business-specific features
- customer account creation and management
- plans and pricing tiers
- resource quotas per customer
- billing integration hooks (placeholder)
- white-label and branding customization
- team and staff role management
- audit logs for compliance
- advanced rbac (admin, staff, customer)
- customer onboarding workflows
- dashboard with business analytics

### ui/ux
- expanded navigation with business features
- customizable branding
- multi-user and team management
- customer management interface
- advanced settings and configurations

## feature gates implementation

### architecture

feature availability is controlled via the `featureGates` utility in `lib/types.ts`:

```typescript
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
```

### usage in components

```tsx
import { useConfig } from '../lib/types';
import { featureGates } from '../lib/types';

export const SettingsPage = () => {
  const { mode } = useConfig();
  
  if (!featureGates.canViewAuditLogs(mode)) {
    return <p>This feature is only available in Hosting Business Mode</p>;
  }
  
  return <AuditLogsSection />;
};
```

### usage in backend routes

```typescript
// In server/index.ts
app.get('/api/customers', verifyAuth, async (req, res) => {
  const config = await getSetupConfig();
  
  if (!config || config.mode !== 'business') {
    return res.status(403).json({ error: 'Not available in Personal Mode' });
  }
  
  // Return customers...
});
```

## database schema - mode segregation

### shared tables (all modes)
- `user_profiles` - user account info and roles
- `docker_apps` - docker applications and containers
- `app_logs` - application logs
- `setup_config` - mode and initialization state

### business mode tables (todo)
- `customers` - customer accounts
- `plans` - pricing plans
- `resource_quotas` - per-customer resource limits
- `billing_events` - billing transactions
- `audit_logs` - operational audit trail
- `team_members` - staff and administrators
- `branding_config` - white-label settings

### multi-tenancy consideration

in personal mode, all `docker_apps` belong to a single admin user.

in business mode (future), `docker_apps` can be scoped to customers:
```sql
ALTER TABLE docker_apps ADD COLUMN customer_id UUID REFERENCES customers(id);
```

## environment variable configuration

### development setup

create `.env.local` based on `.env.local.example`:

```
# Supabase
VITE_SUPABASE_URL=http://localhost:54321
VITE_SUPABASE_ANON_KEY=<your-anon-key>

# API Backend
VITE_API_URL=http://localhost:3001

# Docker
DOCKER_HOST=unix:///var/run/docker.sock
```

### production configuration

suggested environment variables:

```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=<production-key>
VITE_API_URL=https://api.yourdomain.com
DOCKER_HOST=tcp://docker-daemon:2375
NODE_ENV=production
```

## data flow: setup initialization

```
User arrives at /
    ↓
checkSetupStatus() → setup_config table
    ↓
If NOT initialized:
├─ Show Setup Wizard
├─ Collect mode + admin credentials
└─ POST /api/setup/init
    ├─ Create auth.users entry (Supabase Auth)
    ├─ Create user_profiles row (admin user)
    └─ Create setup_config row (mode)
        ↓
        Return session JWT
    ↓
Store token in localStorage
Set ConfigContext.mode
Redirect to Dashboard

If initialized:
├─ Check localStorage for session token
├─ Set ConfigContext.mode from setup_config
└─ Render Dashboard with feature gates
```

## data flow: feature access

```
Component renders
    ↓
useConfig() → { mode, loading }
    ↓
featureGates.someFeature(mode)
    ↓
If gate is false:
├─ Hide/disable feature
└─ Show "Not available in [mode]" message

If gate is true:
├─ Render feature
└─ API call proceeds if authorized
```

## migration path: personal → business (future)

if a user wants to upgrade personal mode to business mode:

• **admin flag in ui**: "upgrade to business mode" button (disabled/hidden in first release)
• **data migration**: run migration script to:
   - create business mode tables
   - map existing admin user to a staff member
   - create default plan for existing docker_apps
   - initial audit log entries
• **mode flag update**: `update setup_config set mode = 'business'`
• **redirect**: refresh ui to show new business features

implementation deferred to phase 2.

## testing the modes

### personal mode test scenario
• start fresh setup
• select "personal mode"
• create admin account
• create a docker app
• verify business features are hidden
• verify docker app crud works

### business mode test scenario
• start fresh setup
• select "hosting business mode"
• create admin account
• verify business feature placeholders appear (todo)
• verify docker app crud still works

## security considerations

### row-level security (rls)

all tables use supabase rls policies to ensure:
- users can only see their own docker_apps
- users can only see their own user_profile
- in business mode (future): customers see only their owned resources

### authentication

- supabase auth handles user authentication (email + password)
- jwt token stored in localstorage
- token passed in `authorization: bearer <token>` header
- backend validates token on every api call

### mode-based access control

- feature gates prevent unauthorized ui rendering
- backend api routes check mode before returning data
- business features return 403 forbidden if mode is personal

## roadmap

### phase 1 (current)
- personal mode fully functional
- setup wizard with mode selection
- docker app crud
- basic logs and controls
- feature gate framework

### phase 2 (business mode mvp)
- customer management ui
- plans and pricing configuration
- billing integration hooks
- audit logging
- team/staff management

### phase 3 (advanced business)
- white-label branding
- advanced rbac
- multi-region deployment
- advanced analytics dashboard

## faq

**q: can i switch from personal to business mode later?**
a: yes (planned for phase 2). your docker_apps and user data will be preserved.

**q: does personal mode limit me to one server?**
a: no. personal mode supports unlimited docker_apps on one (or multiple) servers. it's just a single-user panel without business/customer management.

**q: where is the business mode code?**
a: business mode tables and routes are stubbed in the database schema. routes return `{ error: 'not available in personal mode' }` for now. full implementation is phase 2.

**q: how does authentication work?**
a: supabase auth (email/password) creates the user account. a jwt is issued and stored locally. the api validates the token on each request.

**q: can i make my own custom feature gates?**
a: yes. add new gates to `lib/types.ts` featuregates object. use them in components with `featureGates.yourNewGate(mode)`.
