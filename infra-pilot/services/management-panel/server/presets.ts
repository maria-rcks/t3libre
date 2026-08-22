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

export const SERVER_PRESETS: ServerPreset[] = [
  {
    id: 'minecraft-vanilla',
    name: 'Minecraft Vanilla',
    description: 'Official Minecraft server for standard gameplay.',
    image: 'itzg/minecraft-server:latest',
    startupCommand: 'java -Xmx1024M -Xms1024M -jar server.jar nogui',
    resources: { ram: '2g', cpu: 2, disk: '20g' },
    ports: [{ hostPort: 25565, containerPort: 25565, protocol: 'tcp' }],
    environmentVars: { EULA: 'TRUE', TYPE: 'VANILLA' },
    javaVersion: '17',
  },
  {
    id: 'minecraft-paper',
    name: 'Minecraft Paper',
    description: 'Optimized Minecraft Paper server preset.',
    image: 'itzg/minecraft-server:latest',
    startupCommand: 'java -Xmx2048M -Xms1024M -jar paper.jar nogui',
    resources: { ram: '3g', cpu: 2, disk: '30g' },
    ports: [{ hostPort: 25565, containerPort: 25565, protocol: 'tcp' }],
    environmentVars: { EULA: 'TRUE', TYPE: 'PAPER' },
    javaVersion: '17',
  },
  {
    id: 'discord-bot',
    name: 'Discord Bot',
    description: 'Node.js runtime suitable for Discord bots.',
    image: 'node:20-alpine',
    startupCommand: 'node index.js',
    resources: { ram: '512m', cpu: 1, disk: '5g' },
    ports: [],
    environmentVars: { NODE_ENV: 'production' },
  },
  {
    id: 'teamspeak-server',
    name: 'TeamSpeak Server',
    description: 'Voice communication server preset.',
    image: 'teamspeak:latest',
    startupCommand: '/entrypoint.sh ts3server',
    resources: { ram: '1g', cpu: 1, disk: '10g' },
    ports: [
      { hostPort: 9987, containerPort: 9987, protocol: 'udp' },
      { hostPort: 10011, containerPort: 10011, protocol: 'tcp' },
      { hostPort: 30033, containerPort: 30033, protocol: 'tcp' },
    ],
    environmentVars: {},
  },
  {
    id: 'vps-basic',
    name: 'VPS Basic',
    description: 'General-purpose Ubuntu VPS baseline.',
    image: 'ubuntu:22.04',
    startupCommand: 'bash -lc "sleep infinity"',
    resources: { ram: '1g', cpu: 1, disk: '15g' },
    ports: [{ hostPort: 22, containerPort: 22, protocol: 'tcp' }],
    environmentVars: { TZ: 'UTC' },
  },
];
