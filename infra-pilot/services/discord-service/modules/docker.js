const { execFile } = require('child_process');

function docker(args, { timeout = 60000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const message = stderr.trim() || err.message;
        reject(new Error(message));
        return;
      }
      resolve(stdout.trim());
    });
    if (input !== undefined) {
      child.stdin.on('error', () => {});
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function containers() {
  const out = await docker([
    'ps', '-a', '--format', '{{.Names}}\t{{.ID}}\t{{.Image}}\t{{.Status}}',
  ]);
  if (!out) return [];
  return out.split('\n').map((line) => {
    const [Name, Id, Image, Status] = line.split('\t');
    return { Name, Id, Image, Status };
  });
}

async function inspect(nameOrId) {
  const out = await docker(['inspect', nameOrId]);
  return JSON.parse(out)[0];
}

async function stats(nameOrId) {
  const out = await docker([
    'stats', '--no-stream', '--format',
    '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.NetIO}}\t{{.BlockIO}}',
    nameOrId,
  ]);
  const [Name, CPUPerc, MemUsage, MemPerc, NetIO, BlockIO] = out ? out.split('\t') : [];
  return {
    name: Name || '',
    cpu: CPUPerc || '',
    memUsage: MemUsage || '',
    memPerc: MemPerc || '',
    netIO: NetIO || '',
    blockIO: BlockIO || '',
  };
}

async function exec(nameOrId, cmd) {
  return docker(['exec', nameOrId, 'sh', '-c', cmd], { timeout: 120000 });
}

async function execArgv(nameOrId, argv) {
  return docker(['exec', nameOrId, ...argv], { timeout: 120000 });
}

module.exports = { docker, containers, inspect, stats, exec, execArgv };