interface ConfigAdviceSuggestion {
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

interface Rule {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  category: string;
  title: string;
  description: string;
  check: (config: Record<string, any>, app: Record<string, any>, files: Record<string, string>) => ConfigAdviceSuggestion | null;
}

function generateId(): string {
  return 'adv-' + Math.random().toString(36).slice(2, 8);
}

function readFile(files: Record<string, string>, pattern: string): string | null {
  for (const [path, content] of Object.entries(files)) {
    if (path.endsWith(pattern)) return content;
    if (path.includes(pattern)) return content;
  }
  return null;
}

function extractYamlValue(content: string, key: string): string | null {
  const regex = new RegExp(`^${key}:\\s*(.+)`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function extractProperty(content: string, key: string): string | null {
  const regex = new RegExp(`^${key}\\s*[=:]\\s*(.+)`, 'm');
  const match = content.match(regex);
  return match ? match[1].trim() : null;
}

function hasProperty(content: string, key: string): boolean {
  const regex = new RegExp(`^${key}\\s*[=:]`, 'm');
  return regex.test(content);
}

function countOccurrences(content: string, substr: string): number {
  return (content.match(new RegExp(substr, 'gi')) || []).length;
}

const RULES: Rule[] = [
  // JVM Rules
  {
    id: 'jvm-heap-size',
    severity: 'warning',
    category: 'JVM',
    title: 'JVM Heap Size Not Configured',
    description: 'No -Xmx or -Xms flag found. Without heap limits, the JVM may use excessive memory.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('-Xmx') && allContent.includes('-Xms')) return null;
      return {
        id: generateId(), severity: 'warning', category: 'JVM',
        title: 'JVM Heap Size Not Configured',
        description: 'No -Xmx or -Xms flag found. Without heap limits, the JVM may use excessive memory.',
        recommendation: 'Add JVM flags: -Xmx2G -Xms1G to limit heap usage. For Minecraft servers, 2-4GB is typical.',
        autoFixable: true,
        fixCommand: 'Add JAVA_OPTS="-Xmx2G -Xms1G" to environment variables or startup script.',
      };
    },
  },
  {
    id: 'jvm-gc-type',
    severity: 'info',
    category: 'JVM',
    title: 'Garbage Collector Not Specified',
    description: 'No GC algorithm specified. Default GC may not be optimal for this workload.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('-XX:+UseG1GC') || allContent.includes('-XX:+UseZGC') || allContent.includes('-XX:+UseShenandoahGC')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'Garbage Collector Not Specified',
        description: 'No GC algorithm specified. Default GC may not be optimal for this workload.',
        recommendation: 'For server apps, use G1GC (-XX:+UseG1GC). For low-latency, consider ZGC (-XX:+UseZGC).',
        autoFixable: true,
        fixCommand: 'Add -XX:+UseG1GC to JVM flags for better throughput and predictable pause times.',
      };
    },
  },
  {
    id: 'jvm-aot-compilation',
    severity: 'info',
    category: 'JVM',
    title: 'Tiered Compilation Disabled',
    description: 'Server may benefit from enabling tiered compilation for startup performance.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('-XX:-TieredCompilation')) {
        return {
          id: generateId(), severity: 'info', category: 'JVM',
          title: 'Tiered Compilation Disabled',
          description: 'Tiered compilation is explicitly disabled which may slow startup.',
          recommendation: 'Remove -XX:-TieredCompilation unless you have specific benchmarks showing it helps.',
          autoFixable: true,
          fixCommand: 'Remove -XX:-TieredCompilation from JVM flags.',
        };
      }
      return null;
    },
  },
  {
    id: 'jvm-oom-handling',
    severity: 'warning',
    category: 'JVM',
    title: 'No OutOfMemoryError Handling',
    description: 'Server may silently crash on OOM without producing a heap dump for diagnostics.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('HeapDumpOnOutOfMemoryError') && allContent.includes('HeapDumpPath')) return null;
      const missingDump = !allContent.includes('HeapDumpOnOutOfMemoryError');
      const missingPath = !allContent.includes('HeapDumpPath');
      if (missingDump || missingPath) {
        return {
          id: generateId(), severity: 'warning', category: 'JVM',
          title: 'No OutOfMemoryError Handling',
          description: missingDump ? 'Heap dump on OOM is not enabled.' : 'Heap dump path is not configured.',
          recommendation: 'Add -XX:+HeapDumpOnOutOfMemoryError -XX:HeapDumpPath=/var/log/heapdump.hprof',
          autoFixable: true,
          fixCommand: 'Add OOM handling flags to JAVA_OPTS.',
        };
      }
      return null;
    },
  },
  {
    id: 'jvm-metaspace',
    severity: 'info',
    category: 'JVM',
    title: 'Metaspace Size Not Limited',
    description: 'Without metaspace limits, class unloading issues can cause memory leaks.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('MaxMetaspaceSize')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'Metaspace Size Not Limited',
        description: 'Without metaspace limits, class unloading issues can cause memory leaks.',
        recommendation: 'Add -XX:MaxMetaspaceSize=256M to limit class metadata memory.',
        autoFixable: true,
        fixCommand: 'Add -XX:MaxMetaspaceSize=256M to JVM flags.',
      };
    },
  },
  {
    id: 'jvm-assertions',
    severity: 'info',
    category: 'JVM',
    title: 'Assertions Enabled in Production',
    description: 'Runtime assertions (-ea) degrade performance and should be disabled in production.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('-ea') || allContent.includes('-enableassertions')) {
        return {
          id: generateId(), severity: 'info', category: 'JVM',
          title: 'Assertions Enabled in Production',
          description: 'Runtime assertions (-ea) degrade performance and should be disabled in production.',
          recommendation: 'Remove -ea from JVM flags for production environments.',
          autoFixable: true,
          fixCommand: 'Remove -ea from JVM flags.',
        };
      }
      return null;
    },
  },
  {
    id: 'jvm-verbose-gc',
    severity: 'info',
    category: 'JVM',
    title: 'GC Logging Not Enabled',
    description: 'Without GC logs, diagnosing memory issues is difficult.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('-Xlog:gc')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'GC Logging Not Enabled',
        description: 'Without GC logs, diagnosing memory issues is difficult.',
        recommendation: 'Add -Xlog:gc*:file=/var/log/gc.log:time,uptime,level,tags to enable GC logging.',
        autoFixable: true,
        fixCommand: 'Add GC logging flags to JAVA_OPTS.',
      };
    },
  },
  {
    id: 'jvm-rmi',
    severity: 'info',
    category: 'JVM',
    title: 'RMI Not Disabled',
    description: 'RMI can be a security risk if not needed. Consider disabling it.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('-Djava.rmi.server.hostname')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'RMI Not Disabled',
        description: 'RMI can be a security risk if not needed. Consider disabling it.',
        recommendation: 'If RMI is not needed, add -Djava.rmi.server.hostname=127.0.0.1 to restrict it.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  // YAML Rules
  {
    id: 'yaml-indentation',
    severity: 'warning',
    category: 'YAML',
    title: 'Inconsistent YAML Indentation',
    description: 'Mixed tabs and spaces or inconsistent indentation found in YAML files.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        const lines = content.split('\n');
        let hasTab = false, hasSpace = false;
        for (const line of lines) {
          if (line.startsWith('\t')) hasTab = true;
          if (line.startsWith(' ')) hasSpace = true;
        }
        if (hasTab && hasSpace) {
          return {
            id: generateId(), severity: 'warning', category: 'YAML',
            title: 'Inconsistent YAML Indentation',
            description: `File ${path} mixes tabs and spaces which can cause parsing errors.`,
            recommendation: 'Use 2-space indentation consistently throughout the file.',
            file: path,
            autoFixable: true,
            fixCommand: 'Convert all tabs to 2 spaces.',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-trailing-spaces',
    severity: 'info',
    category: 'YAML',
    title: 'Trailing Whitespace in YAML',
    description: 'Trailing whitespace can cause subtle parsing issues in some YAML parsers.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        if (content.split('\n').some(line => line !== line.trimEnd())) {
          return {
            id: generateId(), severity: 'info', category: 'YAML',
            title: 'Trailing Whitespace in YAML',
            description: `File ${path} has trailing whitespace on some lines.`,
            recommendation: 'Trim trailing whitespace from all lines.',
            file: path,
            autoFixable: true,
            fixCommand: 'Trim trailing whitespace.',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-long-lines',
    severity: 'info',
    category: 'YAML',
    title: 'YAML Lines Exceeding 120 Characters',
    description: 'Long lines reduce readability and can cause issues in some tools.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        const longLines = content.split('\n').filter(l => l.length > 120);
        if (longLines.length > 0) {
          return {
            id: generateId(), severity: 'info', category: 'YAML',
            title: 'YAML Lines Exceeding 120 Characters',
            description: `File ${path} has ${longLines.length} line(s) exceeding 120 characters.`,
            recommendation: 'Break long lines into multi-line values using > or | block scalars.',
            file: path,
            autoFixable: false,
            fixCommand: '',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-quoted-strings',
    severity: 'info',
    category: 'YAML',
    title: 'Unquoted Strings with Special Characters',
    description: 'Strings containing colons, brackets, or other special YAML chars should be quoted.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        for (const line of content.split('\n')) {
          const val = line.split(':').slice(1).join(':').trim();
          if (val && (val.includes(':') || val.startsWith('[') || val.startsWith('{') || val.includes(' #')) && !val.startsWith("'") && !val.startsWith('"')) {
            return {
              id: generateId(), severity: 'info', category: 'YAML',
              title: 'Unquoted Strings with Special Characters',
              description: `File ${path} has unquoted values containing special YAML characters.`,
              recommendation: 'Wrap string values containing special characters in single or double quotes.',
              file: path,
              autoFixable: true,
              fixCommand: 'Add quotes around string values with special characters.',
            };
          }
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-duplicate-keys',
    severity: 'critical',
    category: 'YAML',
    title: 'Duplicate Keys in YAML',
    description: 'Duplicate keys found which can cause silent data overwrites.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        const keys = content.match(/^(\s*)([\w.-]+):/gm);
        if (keys) {
          const seen = new Set<string>();
          for (const key of keys) {
            const trimmed = key.trim();
            if (seen.has(trimmed)) {
              return {
                id: generateId(), severity: 'critical', category: 'YAML',
                title: 'Duplicate Keys in YAML',
                description: `Duplicate key "${trimmed}" found in ${path}. Later values silently overwrite earlier ones.`,
                recommendation: 'Remove duplicate keys or merge them.',
                file: path,
                autoFixable: false,
                fixCommand: '',
              };
            }
            seen.add(trimmed);
          }
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-document-separator',
    severity: 'info',
    category: 'YAML',
    title: 'Missing YAML Document Start',
    description: 'YAML files should start with --- for unambiguous parsing.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        if (content.trim().length > 0 && !content.trim().startsWith('---')) {
          return {
            id: generateId(), severity: 'info', category: 'YAML',
            title: 'Missing YAML Document Start',
            description: `File ${path} does not start with --- separator.`,
            recommendation: 'Add --- at the start of the YAML file.',
            file: path,
            autoFixable: true,
            fixCommand: 'Add --- at the beginning of the file.',
          };
        }
      }
      return null;
    },
  },
  // Application Config Rules
  {
    id: 'app-memory-limit',
    severity: 'critical',
    category: 'Application',
    title: 'No Memory Limit Set',
    description: 'The app has no memory limit, risking host resource exhaustion.',
    check: (cfg, app, files) => {
      if (app.memory_limit && app.memory_limit !== '0') return null;
      return {
        id: generateId(), severity: 'critical', category: 'Application',
        title: 'No Memory Limit Set',
        description: 'The app has no memory limit, risking host resource exhaustion.',
        recommendation: 'Set a memory limit: 2GB for small servers, 4GB+ for production workloads.',
        autoFixable: true,
        fixCommand: 'Set memory_limit to 2048m.',
      };
    },
  },
  {
    id: 'app-cpu-shares',
    severity: 'warning',
    category: 'Application',
    title: 'CPU Shares Not Configured',
    description: 'Without CPU shares, CPU contention between containers is unmanaged.',
    check: (cfg, app, files) => {
      if (app.cpu_shares) return null;
      return {
        id: generateId(), severity: 'warning', category: 'Application',
        title: 'CPU Shares Not Configured',
        description: 'Without CPU shares, CPU contention between containers is unmanaged.',
        recommendation: 'Set cpu_shares to 1024 (default) for balanced allocation.',
        autoFixable: true,
        fixCommand: 'Set cpu_shares to 1024.',
      };
    },
  },
  {
    id: 'app-restart-policy',
    severity: 'warning',
    category: 'Application',
    title: 'No Restart Policy',
    description: 'Without a restart policy, the container will not recover from crashes.',
    check: (cfg, app, files) => {
      if (app.restart_policy && app.restart_policy !== 'no') return null;
      return {
        id: generateId(), severity: 'warning', category: 'Application',
        title: 'No Restart Policy',
        description: 'Without a restart policy, the container will not recover from crashes.',
        recommendation: 'Set restart_policy to "unless-stopped" for production.',
        autoFixable: true,
        fixCommand: 'Set restart_policy to unless-stopped.',
      };
    },
  },
  {
    id: 'app-java-version',
    severity: 'info',
    category: 'Application',
    title: 'Java Version Not Specified',
    description: 'The Java version is not explicitly set. The app may use an unexpected version.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n') + JSON.stringify(app);
      if (app.javaVersion || allContent.includes('JAVA_VERSION')) return null;
      return {
        id: generateId(), severity: 'info', category: 'Application',
        title: 'Java Version Not Specified',
        description: 'The Java version is not explicitly set.',
        recommendation: 'Set Java version based on app requirements. For Minecraft, use Java 17 or 21.',
        autoFixable: true,
        fixCommand: 'Set javaVersion to 21.',
      };
    },
  },
  {
    id: 'app-env-size',
    severity: 'info',
    category: 'Application',
    title: 'Large Number of Environment Variables',
    description: 'Excessive environment variables can slow container startup.',
    check: (cfg, app, files) => {
      const envVars = app.environment_vars || {};
      const count = Object.keys(envVars).length;
      if (count <= 30) return null;
      return {
        id: generateId(), severity: 'info', category: 'Application',
        title: 'Large Number of Environment Variables',
        description: `App has ${count} environment variables, which may slow startup.`,
        recommendation: 'Consider using a config file or .env file for non-sensitive configuration.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  {
    id: 'app-port-exposed',
    severity: 'critical',
    category: 'Application',
    title: 'No Ports Exposed',
    description: 'The app has no ports exposed, so it cannot accept network connections.',
    check: (cfg, app, files) => {
      const ports = app.ports || [];
      if (ports.length > 0) return null;
      return {
        id: generateId(), severity: 'critical', category: 'Application',
        title: 'No Ports Exposed',
        description: 'The app has no ports exposed, so it cannot accept network connections.',
        recommendation: 'Add port mappings based on the app requirements (e.g., 25565 for Minecraft).',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  {
    id: 'app-single-instance',
    severity: 'info',
    category: 'Application',
    title: 'Single Instance Warning',
    description: 'Running a single instance creates a single point of failure.',
    check: (cfg, app, files) => {
      return null;
    },
  },
  {
    id: 'app-description',
    severity: 'info',
    category: 'Application',
    title: 'App Description Missing',
    description: 'No description provided. Adding one helps with organization.',
    check: (cfg, app, files) => {
      if (app.description) return null;
      return {
        id: generateId(), severity: 'info', category: 'Application',
        title: 'App Description Missing',
        description: 'No description provided for this app.',
        recommendation: 'Add a short description explaining the purpose of this app.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  {
    id: 'app-label-tags',
    severity: 'info',
    category: 'Application',
    title: 'No Labels Configured',
    description: 'Docker labels help with organization and automation.',
    check: (cfg, app, files) => {
      const labels = app.labels || {};
      if (Object.keys(labels).length > 0) return null;
      return {
        id: generateId(), severity: 'info', category: 'Application',
        title: 'No Labels Configured',
        description: 'Docker labels help with organization and automation.',
        recommendation: 'Add labels like app=name, environment=production, managed-by=infra-pilot.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  // Properties Config Rules
  {
    id: 'props-whitespace',
    severity: 'info',
    category: 'Properties',
    title: 'Trailing Whitespace in Properties',
    description: 'Trailing whitespace in .properties files can cause subtle bugs.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        if (content.split('\n').some(line => line !== line.trimEnd() && !line.startsWith('#'))) {
          return {
            id: generateId(), severity: 'info', category: 'Properties',
            title: 'Trailing Whitespace in Properties',
            description: `File ${path} has trailing whitespace.`,
            recommendation: 'Trim trailing whitespace from property values.',
            file: path,
            autoFixable: true,
            fixCommand: 'Trim trailing whitespace.',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'props-encoding',
    severity: 'warning',
    category: 'Properties',
    title: 'Properties File Encoding',
    description: '.properties files should use ISO 8859-1 or UTF-8 with unicode escapes.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        if (/[^\x00-\x7F]/.test(content) && !content.includes('\\u')) {
          return {
            id: generateId(), severity: 'warning', category: 'Properties',
            title: 'Properties File Encoding',
            description: `File ${path} contains non-ASCII characters without unicode escapes.`,
            recommendation: 'Use \\uXXXX unicode escapes for non-ASCII characters.',
            file: path,
            autoFixable: false,
            fixCommand: '',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'props-duplicate',
    severity: 'critical',
    category: 'Properties',
    title: 'Duplicate Properties',
    description: 'Duplicate property keys found. Later values silently override earlier ones.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        const keys = content.match(/^([\w.-]+)\s*[=:]/gm);
        if (keys) {
          const seen = new Set<string>();
          for (const match of keys) {
            const key = match.split(/[=:]/)[0].trim();
            if (seen.has(key)) {
              return {
                id: generateId(), severity: 'critical', category: 'Properties',
                title: 'Duplicate Properties',
                description: `Duplicate key "${key}" in ${path}.`,
                recommendation: 'Remove duplicate property entries.',
                file: path,
                autoFixable: false,
                fixCommand: '',
              };
            }
            seen.add(key);
          }
        }
      }
      return null;
    },
  },
  {
    id: 'props-comments',
    severity: 'info',
    category: 'Properties',
    title: 'Missing File Header Comment',
    description: 'Properties files should have a header comment describing their purpose.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        if (content.trim().length > 0 && !content.trim().startsWith('#')) {
          return {
            id: generateId(), severity: 'info', category: 'Properties',
            title: 'Missing File Header Comment',
            description: `File ${path} has no descriptive header comment.`,
            recommendation: 'Add a comment at the top describing the file purpose.',
            file: path,
            autoFixable: false,
            fixCommand: '',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'props-section',
    severity: 'info',
    category: 'Properties',
    title: 'Unorganized Properties',
    description: 'Properties without section comments can be hard to navigate.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        const nonCommentLines = content.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));
        const commentLines = content.split('\n').filter(l => l.trim().startsWith('#'));
        if (nonCommentLines.length > 15 && commentLines.length < 2) {
          return {
            id: generateId(), severity: 'info', category: 'Properties',
            title: 'Unorganized Properties',
            description: `File ${path} has many properties but few section comments.`,
            recommendation: 'Add section comments (e.g., # Database Settings) to organize properties.',
            file: path,
            autoFixable: false,
            fixCommand: '',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'jvm-direct-memory',
    severity: 'info',
    category: 'JVM',
    title: 'Direct Memory Not Configured',
    description: 'Direct memory limit (-XX:MaxDirectMemorySize) not set. NIO operations may exhaust memory.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('MaxDirectMemorySize')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'Direct Memory Not Configured',
        description: 'Direct memory limit not set. NIO operations may exhaust memory.',
        recommendation: 'Add -XX:MaxDirectMemorySize=512M for apps using NIO or Netty.',
        autoFixable: true,
        fixCommand: 'Add -XX:MaxDirectMemorySize=512M.',
      };
    },
  },
  {
    id: 'jvm-code-cache',
    severity: 'info',
    category: 'JVM',
    title: 'Code Cache Not Configured',
    description: 'Default code cache may fill up, causing performance degradation.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('ReservedCodeCacheSize')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'Code Cache Not Configured',
        description: 'Default code cache may fill up, causing performance degradation.',
        recommendation: 'Set -XX:ReservedCodeCacheSize=256M for larger applications.',
        autoFixable: true,
        fixCommand: 'Add -XX:ReservedCodeCacheSize=256M.',
      };
    },
  },
  {
    id: 'jvm-printflags',
    severity: 'info',
    category: 'JVM',
    title: 'JVM Flags Final Print Disabled',
    description: 'Not printing final JVM flags makes debugging configuration issues harder.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('PrintFlagsFinal') && !allContent.includes('-XX:-PrintFlagsFinal')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'JVM Flags Final Print Disabled',
        description: 'Final JVM flag values are not printed on startup.',
        recommendation: 'Add -XX:+PrintFlagsFinal for debugging. Remove in production after tuning.',
        autoFixable: true,
        fixCommand: 'Add -XX:+PrintFlagsFinal.',
      };
    },
  },
  {
    id: 'jvm-ssi',
    severity: 'info',
    category: 'JVM',
    title: 'Stack Size Not Configured',
    description: 'Default thread stack size may be excessive for containerized environments.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('Xss') || allContent.includes('ThreadStackSize')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'Stack Size Not Configured',
        description: 'Default thread stack size (1MB) may be excessive in containers.',
        recommendation: 'Consider -Xss256k for apps with many threads.',
        autoFixable: true,
        fixCommand: 'Add -Xss256k to Java options.',
      };
    },
  },
  {
    id: 'jvm-oom-kill',
    severity: 'warning',
    category: 'JVM',
    title: 'Exit on OOM Not Configured',
    description: 'JVM may hang instead of exiting on out-of-memory errors.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('ExitOnOutOfMemoryError') || allContent.includes('CrashOnOutOfMemoryError')) return null;
      return {
        id: generateId(), severity: 'warning', category: 'JVM',
        title: 'Exit on OOM Not Configured',
        description: 'JVM may hang instead of exiting on out-of-memory errors.',
        recommendation: 'Add -XX:+ExitOnOutOfMemoryError to exit rather than hang on OOM.',
        autoFixable: true,
        fixCommand: 'Add -XX:+ExitOnOutOfMemoryError.',
      };
    },
  },
  {
    id: 'jvm-string-dedup',
    severity: 'info',
    category: 'JVM',
    title: 'String Deduplication Not Enabled',
    description: 'String deduplication can reduce memory usage in string-heavy applications.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('StringDeduplication')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'String Deduplication Not Enabled',
        description: 'String deduplication can reduce memory usage.',
        recommendation: 'Add -XX:+UseStringDeduplication with G1GC to save heap memory.',
        autoFixable: true,
        fixCommand: 'Add -XX:+UseStringDeduplication.',
      };
    },
  },
  {
    id: 'jvm-biased-locking',
    severity: 'info',
    category: 'JVM',
    title: 'Biased Locking Deprecated',
    description: 'Biased locking is deprecated in Java 15+ and may cause issues.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('BiasedLockingStartupDelay') || allContent.includes('UseBiasedLocking')) {
        return {
          id: generateId(), severity: 'info', category: 'JVM',
          title: 'Biased Locking Deprecated',
          description: 'Biased locking flags are deprecated in modern Java versions.',
          recommendation: 'Remove -XX:+UseBiasedLocking and -XX:BiasedLockingStartupDelay flags.',
          autoFixable: true,
          fixCommand: 'Remove biased locking flags.',
        };
      }
      return null;
    },
  },
  {
    id: 'jvm-aria',
    severity: 'info',
    category: 'JVM',
    title: 'AOT Compilation Not Used',
    description: 'Ahead-of-time compilation may improve startup time for some workloads.',
    check: (cfg, app, files) => {
      return null;
    },
  },
  {
    id: 'props-casing',
    severity: 'info',
    category: 'Properties',
    title: 'Inconsistent Property Key Casing',
    description: 'Property keys use inconsistent casing which can lead to confusion.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        const keys = content.match(/^([\w.-]+)\s*[=:]/gm);
        if (keys) {
          const casings = new Set<string>();
          for (const match of keys) {
            const key = match.split(/[=:]/)[0].trim();
            const lower = key.toLowerCase();
            casings.add(lower);
          }
          if (keys.length > 3 && casings.size < keys.length * 0.5) {
            return {
              id: generateId(), severity: 'info', category: 'Properties',
              title: 'Inconsistent Property Key Casing',
              description: 'Property keys use inconsistent casing.',
              recommendation: 'Standardize on lowercase dotted notation.',
              file: path,
              autoFixable: false,
              fixCommand: '',
            };
          }
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-anchor-usage',
    severity: 'info',
    category: 'YAML',
    title: 'YAML Anchors Not Used',
    description: 'Repeated values could be consolidated using YAML anchors (& and *).',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        if (content.includes('&') || content.includes('*')) continue;
        const lines = content.split('\n');
        const values: Record<string, number> = {};
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('-')) {
            const parts = trimmed.split(':');
            if (parts.length > 1) {
              const val = parts.slice(1).join(':').trim();
              if (val && val.length > 10) {
                values[val] = (values[val] || 0) + 1;
              }
            }
          }
        }
        const duplicates = Object.entries(values).filter(([_, count]) => count > 1);
        if (duplicates.length > 0) {
          return {
            id: generateId(), severity: 'info', category: 'YAML',
            title: 'YAML Anchors Not Used',
            description: `File ${path} has repeated values that could use YAML anchors.`,
            recommendation: 'Use YAML anchors (&) and references (*) to deduplicate.',
            file: path,
            autoFixable: false,
            fixCommand: '',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-block-scalar',
    severity: 'info',
    category: 'YAML',
    title: 'Long Values Should Use Block Scalars',
    description: 'Long single-line string values should use block scalars (| or >) for readability.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        for (const line of content.split('\n')) {
          const parts = line.split(':');
          const val = parts.slice(1).join(':').trim();
          if ((val.startsWith("'") || val.startsWith('"')) && val.length > 150) {
            return {
              id: generateId(), severity: 'info', category: 'YAML',
              title: 'Long Values Should Use Block Scalars',
              description: `File ${path} has long string value that would be more readable as a block scalar.`,
              recommendation: 'Use > (folded) or | (literal) block scalars for long strings.',
              file: path,
              autoFixable: false,
              fixCommand: '',
            };
          }
        }
      }
      return null;
    },
  },
  {
    id: 'props-quoted-values',
    severity: 'info',
    category: 'Properties',
    title: 'Values Containing Spaces Should Be Quoted',
    description: 'Property values with spaces need proper quoting or escaping.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        for (const line of content.split('\n')) {
          if (line.trim().startsWith('#') || line.trim() === '') continue;
          const eqIdx = line.indexOf('=');
          const colonIdx = line.indexOf(':');
          const sepIdx = eqIdx > -1 ? eqIdx : colonIdx;
          if (sepIdx === -1) continue;
          const val = line.slice(sepIdx + 1).trim();
          if (val.includes(' ') && !val.startsWith('"') && !val.startsWith("'") && !val.startsWith('\\')) {
            return {
              id: generateId(), severity: 'info', category: 'Properties',
              title: 'Values Containing Spaces Should Be Quoted',
              description: `File ${path} has unquoted values with spaces.`,
              recommendation: 'Quote property values that contain spaces.',
              file: path,
              autoFixable: true,
              fixCommand: 'Add quotes around values with spaces.',
            };
          }
        }
      }
      return null;
    },
  },
  {
    id: 'app-healthcheck',
    severity: 'warning',
    category: 'Application',
    title: 'No Healthcheck Configured',
    description: 'Without a healthcheck, Docker cannot detect if the app is actually running.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (path.endsWith('docker-compose.yml') || path.endsWith('docker-compose.yaml')) {
          if (content.includes('healthcheck') || content.includes('health_check')) return null;
        }
      }
      if (app.labels && app.labels['healthcheck']) return null;
      return {
        id: generateId(), severity: 'warning', category: 'Application',
        title: 'No Healthcheck Configured',
        description: 'Without a healthcheck, Docker cannot detect if the app is actually running.',
        recommendation: 'Add a HEALTHCHECK instruction to the Dockerfile or docker-compose.yml.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  {
    id: 'app-volumes-persist',
    severity: 'warning',
    category: 'Application',
    title: 'No Volumes Configured',
    description: 'No volumes mounted. Data will be lost when container restarts.',
    check: (cfg, app, files) => {
      const volumes = app.volumes || [];
      if (volumes.length > 0) return null;
      return {
        id: generateId(), severity: 'warning', category: 'Application',
        title: 'No Volumes Configured',
        description: 'No volumes mounted. Data will be lost when container restarts.',
        recommendation: 'Mount a volume for persistent data storage.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  {
    id: 'jvm-native-memory',
    severity: 'info',
    category: 'JVM',
    title: 'Native Memory Tracking Not Enabled',
    description: 'Native memory tracking helps diagnose off-heap memory leaks.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('NativeMemoryTracking')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'Native Memory Tracking Not Enabled',
        description: 'Native memory tracking helps diagnose off-heap memory leaks.',
        recommendation: 'Add -XX:NativeMemoryTracking=summary for diagnostic purposes.',
        autoFixable: true,
        fixCommand: 'Add -XX:NativeMemoryTracking=summary.',
      };
    },
  },
  {
    id: 'jvm-safepoint',
    severity: 'info',
    category: 'JVM',
    title: 'Safepoint Logging Not Enabled',
    description: 'Safepoint delays can cause latency issues without visibility.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('safepoint') && allContent.includes('PrintSafepointStatistics')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'Safepoint Logging Not Enabled',
        description: 'Safepoint delays can cause latency issues without visibility.',
        recommendation: 'Add -XX:+PrintSafepointStatistics -XX:PrintSafepointStatisticsCount=1.',
        autoFixable: true,
        fixCommand: 'Add safepoint logging flags.',
      };
    },
  },
  {
    id: 'jvm-usage-tracker',
    severity: 'info',
    category: 'JVM',
    title: 'JVM Usage Tracker Enabled',
    description: 'JVM usage tracker can cause unexpected behavior in containers.',
    check: (cfg, app, files) => {
      return null;
    },
  },
  {
    id: 'props-empty-values',
    severity: 'info',
    category: 'Properties',
    title: 'Empty Property Values',
    description: 'Properties with empty values may cause unexpected behavior.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        for (const line of content.split('\n')) {
          if (line.trim().startsWith('#') || line.trim() === '') continue;
          const eqIdx = line.indexOf('=');
          const colonIdx = line.indexOf(':');
          const sepIdx = eqIdx > -1 ? eqIdx : colonIdx;
          if (sepIdx > -1) {
            const val = line.slice(sepIdx + 1).trim();
            if (val === '') {
              return {
                id: generateId(), severity: 'info', category: 'Properties',
                title: 'Empty Property Values',
                description: `Property "${line.slice(0, sepIdx).trim()}" in ${path} has an empty value.`,
                recommendation: 'Either provide a value or remove the property.',
                file: path,
                autoFixable: false,
                fixCommand: '',
              };
            }
          }
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-missing-newline',
    severity: 'info',
    category: 'YAML',
    title: 'File Does Not End With Newline',
    description: 'YAML files should end with a newline character for POSIX compliance.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        if (content.length > 0 && !content.endsWith('\n')) {
          return {
            id: generateId(), severity: 'info', category: 'YAML',
            title: 'File Does Not End With Newline',
            description: `File ${path} does not end with a newline.`,
            recommendation: 'Add a trailing newline at the end of the file.',
            file: path,
            autoFixable: true,
            fixCommand: 'Add trailing newline.',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-mixed-indent',
    severity: 'warning',
    category: 'YAML',
    title: 'Inconsistent Indentation Depth',
    description: 'YAML uses inconsistent indentation depths within the same file.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        const lines = content.split('\n');
        const indents = new Set<number>();
        for (const line of lines) {
          if (line.trim() && !line.trim().startsWith('#')) {
            const indent = line.search(/\S/);
            if (indent > 0) indents.add(indent);
          }
        }
        if (indents.size > 3) {
          return {
            id: generateId(), severity: 'warning', category: 'YAML',
            title: 'Inconsistent Indentation Depth',
            description: `File ${path} has ${indents.size} different indentation levels.`,
            recommendation: 'Standardize on 2-space indentation with consistent nesting.',
            file: path,
            autoFixable: false,
            fixCommand: '',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'jvm-parallel-gc-threads',
    severity: 'info',
    category: 'JVM',
    title: 'Parallel GC Threads Not Configured',
    description: 'In containers, JVM may detect too many GC threads.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('ParallelGCThreads') || allContent.includes('ConcGCThreads')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'Parallel GC Threads Not Configured',
        description: 'JVM may detect too many GC threads in containerized environments.',
        recommendation: 'Set -XX:ParallelGCThreads=2 -XX:ConcGCThreads=2 for containerized apps.',
        autoFixable: true,
        fixCommand: 'Add ParallelGCThreads and ConcGCThreads limits.',
      };
    },
  },
  {
    id: 'app-network-mode',
    severity: 'info',
    category: 'Application',
    title: 'Network Mode Not Specified',
    description: 'Default bridge network may not provide isolation needed.',
    check: (cfg, app, files) => {
      return {
        id: generateId(), severity: 'info', category: 'Application',
        title: 'Network Mode Not Specified',
        description: 'Consider specifying network mode for better network isolation.',
        recommendation: 'Use a custom Docker network for multi-container setups.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  {
    id: 'jvm-logging-config',
    severity: 'info',
    category: 'JVM',
    title: 'JVM Logging Config Not Specified',
    description: 'Default JVM logging may not capture sufficient detail for diagnostics.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('-Djava.util.logging.config.file') || allContent.includes('log4j') || allContent.includes('logback')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'JVM Logging Config Not Specified',
        description: 'No logging framework configuration detected.',
        recommendation: 'Configure a logging framework (Logback, Log4j2) for better log management.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  {
    id: 'jvm-cms-deprecated',
    severity: 'warning',
    category: 'JVM',
    title: 'CMS GC Deprecated and Removed',
    description: 'CMS garbage collector is deprecated and was removed in JDK 14.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('UseConcMarkSweepGC')) {
        return {
          id: generateId(), severity: 'warning', category: 'JVM',
          title: 'CMS GC Deprecated and Removed',
          description: 'CMS garbage collector (-XX:+UseConcMarkSweepGC) was removed in JDK 14.',
          recommendation: 'Switch to G1GC (-XX:+UseG1GC) or ZGC (-XX:+UseZGC).',
          autoFixable: true,
          fixCommand: 'Replace -XX:+UseConcMarkSweepGC with -XX:+UseG1GC.',
        };
      }
      return null;
    },
  },
  {
    id: 'jvm-parallel-old-gc',
    severity: 'info',
    category: 'JVM',
    title: 'Using Parallel Old GC',
    description: 'ParallelOldGC is older; newer GCs may offer better latency.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('UseParallelOldGC') || allContent.includes('UseParallelGC')) {
        return {
          id: generateId(), severity: 'info', category: 'JVM',
          title: 'Using Parallel Old GC',
          description: 'Parallel GC may not provide the best latency for server applications.',
          recommendation: 'Consider G1GC for better pause time guarantees.',
          autoFixable: false,
          fixCommand: '',
        };
      }
      return null;
    },
  },
  {
    id: 'props-default-value',
    severity: 'info',
    category: 'Properties',
    title: 'Missing Comments Near Properties',
    description: 'Properties without inline comments are harder to understand.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        const lines = content.split('\n');
        let consecutiveWithoutComment = 0;
        for (const line of lines) {
          if (line.trim().startsWith('#') || line.trim() === '') {
            consecutiveWithoutComment = 0;
          } else if (line.includes('=') || line.includes(':')) {
            consecutiveWithoutComment++;
          }
        }
        if (consecutiveWithoutComment > 10) {
          return {
            id: generateId(), severity: 'info', category: 'Properties',
            title: 'Missing Comments Near Properties',
            description: `File ${path} has properties without nearby comments.`,
            recommendation: 'Add inline comments (#) explaining non-obvious property values.',
            file: path,
            autoFixable: false,
            fixCommand: '',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'jvm-redirect-stdout',
    severity: 'info',
    category: 'JVM',
    title: 'JVM Stdout/Stderr Not Redirected',
    description: 'Without redirection, all JVM output goes to container stdout which may mix logs.',
    check: (cfg, app, files) => {
      return null;
    },
  },
  {
    id: 'app-log-driver',
    severity: 'info',
    category: 'Application',
    title: 'Default Log Driver Used',
    description: 'The default json-file logging driver may use excessive disk space without rotation.',
    check: (cfg, app, files) => {
      return {
        id: generateId(), severity: 'info', category: 'Application',
        title: 'Default Log Driver Used',
        description: 'The default json-file logging driver may use excessive disk space.',
        recommendation: 'Configure log rotation or switch to journald/syslog for production.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  {
    id: 'app-readonly-fs',
    severity: 'info',
    category: 'Application',
    title: 'Read-Only Root Filesystem',
    description: 'Read-only root filesystem improves security but is not configured.',
    check: (cfg, app, files) => {
      return {
        id: generateId(), severity: 'info', category: 'Application',
        title: 'Read-Only Root Filesystem Not Configured',
        description: 'Container root filesystem is writable, which is a security concern.',
        recommendation: 'Set readonly_rootfs=true in container configuration.',
        autoFixable: false,
        fixCommand: '',
      };
    },
  },
  {
    id: 'jvm-jfr-recording',
    severity: 'info',
    category: 'JVM',
    title: 'JFR Not Configured',
    description: 'Java Flight Recorder is not enabled for continuous profiling.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('FlightRecorder') || allContent.includes('StartFlightRecording')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'JFR Not Configured',
        description: 'Java Flight Recorder not configured for continuous profiling.',
        recommendation: 'Enable JFR for continuous monitoring: -XX:StartFlightRecording=duration=60s,filename=recording.jfr',
        autoFixable: true,
        fixCommand: 'Add JFR startup recording flags.',
      };
    },
  },
  {
    id: 'props-sensistive-values',
    severity: 'info',
    category: 'Properties',
    title: 'Potential Sensitive Data in Properties',
    description: 'Property values may contain passwords or secrets in plain text.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.properties')) continue;
        const sensitiveKeys = ['password', 'secret', 'token', 'apikey', 'api_key', 'credential'];
        for (const line of content.split('\n')) {
          if (line.trim().startsWith('#')) continue;
          const lower = line.toLowerCase();
          for (const sk of sensitiveKeys) {
            if (lower.includes(sk) && !lower.includes('${') && !lower.includes('env.')) {
              return {
                id: generateId(), severity: 'info', category: 'Properties',
                title: 'Potential Sensitive Data in Properties',
                description: `File ${path} may contain plaintext secrets (contains "${sk}").`,
                recommendation: 'Use environment variables or a secrets manager instead of hardcoding secrets.',
                file: path,
                autoFixable: false,
                fixCommand: '',
              };
            }
          }
        }
      }
      return null;
    },
  },
  {
    id: 'jvm-args-gray',
    severity: 'info',
    category: 'JVM',
    title: 'Duplicate JVM Argument',
    description: 'Duplicate JVM flags were found which may cause unexpected behavior.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      const jvmFlags = allContent.match(/-XX:[+-]\w+/g);
      if (jvmFlags) {
        const seen = new Set<string>();
        for (const flag of jvmFlags) {
          if (seen.has(flag)) {
            return {
              id: generateId(), severity: 'info', category: 'JVM',
              title: 'Duplicate JVM Argument',
              description: `Duplicate JVM flag "${flag}" found.`,
              recommendation: 'Remove duplicate JVM flag.',
              autoFixable: true,
              fixCommand: `Remove duplicate ${flag}.`,
            };
          }
          seen.add(flag);
        }
      }
      return null;
    },
  },
  {
    id: 'jvm-compiler-threads',
    severity: 'info',
    category: 'JVM',
    title: 'Compiler Threads Not Configured',
    description: 'JVM may use too many compiler threads in constrained environments.',
    check: (cfg, app, files) => {
      const allContent = Object.values(files).join('\n');
      if (allContent.includes('CICompilerCount')) return null;
      return {
        id: generateId(), severity: 'info', category: 'JVM',
        title: 'Compiler Threads Not Configured',
        description: 'JVM may use too many compiler threads in containerized environments.',
        recommendation: 'Set -XX:CICompilerCount=2 for containerized applications.',
        autoFixable: true,
        fixCommand: 'Add -XX:CICompilerCount=2.',
      };
    },
  },
  {
    id: 'yaml-bool-true',
    severity: 'info',
    category: 'YAML',
    title: 'Boolean Values Should Be lowercase',
    description: 'YAML boolean values should be lowercase (true/false) for portability.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        if (/\b(True|False|YES|NO|On|Off)\b/.test(content)) {
          return {
            id: generateId(), severity: 'info', category: 'YAML',
            title: 'Boolean Values Should Be lowercase',
            description: `File ${path} uses non-standard boolean case.`,
            recommendation: 'Use lowercase true/false for YAML booleans.',
            file: path,
            autoFixable: true,
            fixCommand: 'Convert booleans to lowercase.',
          };
        }
      }
      return null;
    },
  },
  {
    id: 'yaml-null-variants',
    severity: 'info',
    category: 'YAML',
    title: 'Non-Standard Null Values',
    description: 'Use ~ or null consistently for YAML null values.',
    check: (cfg, app, files) => {
      for (const [path, content] of Object.entries(files)) {
        if (!path.endsWith('.yml') && !path.endsWith('.yaml')) continue;
        if (/\b(NULL|Null|nil|Nil|~)\b/.test(content)) {
          return {
            id: generateId(), severity: 'info', category: 'YAML',
            title: 'Non-Standard Null Values',
            description: `File ${path} uses non-standard null representations.`,
            recommendation: 'Use null or ~ consistently for null values.',
            file: path,
            autoFixable: true,
            fixCommand: 'Standardize null values to null.',
          };
        }
      }
      return null;
    },
  },
];

export function analyzeConfiguration(
  app: Record<string, any>,
  files: Record<string, string>,
  config?: Record<string, any>
): { suggestions: ConfigAdviceSuggestion[]; summary: { total: number; critical: number; warning: number; info: number } } {
  const suggestions: ConfigAdviceSuggestion[] = [];

  for (const rule of RULES) {
    try {
      const result = rule.check(config || {}, app, files);
      if (result) {
        suggestions.push(result);
      }
    } catch {
      // Skip rules that error
    }
  }

  const critical = suggestions.filter(s => s.severity === 'critical').length;
  const warning = suggestions.filter(s => s.severity === 'warning').length;
  const info = suggestions.filter(s => s.severity === 'info').length;

  return {
    suggestions,
    summary: { total: suggestions.length, critical, warning, info },
  };
}
