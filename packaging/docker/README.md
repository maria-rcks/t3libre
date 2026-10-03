# T3 Code container

A non-root Linux image with T3 Code, Pi, Node 24, npm, git, bash, and curl. Other harnesses can be installed from T3's provider settings or the terminal. Their downloads are stored separately from the image.

## Build

Use a release that includes the Linux `-node.tar.gz` archives and `SHA256SUMS`:

```sh
docker build --build-arg T3_VERSION=<version> -t t3 packaging/docker
```

The Dockerfile supports Linux amd64 and arm64. The release archive is verified against its published checksum. This repository does not publish a container image automatically.

For an unpublished build, extract the matching architecture's Node archive and provide its contents as a named build context:

```sh
docker build \
  --build-context bundle=/absolute/path/to/t3-<version>-linux-x64-node \
  -t t3 packaging/docker
```

Maintainers can create that archive after building the server, web client, and resource monitor:

```sh
node scripts/build-cli-archive.ts \
  --platform linux --arch x64 --version <version> --node-bundle \
  --resource-monitor-dir /path/to/resource-monitor \
  --output-dir release-cli-node
```

The resource-monitor directory must have the same platform layout as the release build. The ordinary executable archive is not a substitute for the Node archive.

## Run and pair

```sh
docker volume create t3-data
docker volume create t3-workspace
docker run -d --name t3 \
  -p 127.0.0.1:3773:3773 \
  -v t3-data:/data \
  -v t3-workspace:/workspace \
  t3
docker exec t3 t3 pair
```

Open the printed pairing URL on the Docker host. For remote access, use a secure tunnel or reverse proxy and open the pairing path on that origin. The port mapping above intentionally accepts only host-local connections. Do not disable pairing or expose an unauthenticated proxy.

The image runs as UID/GID `65532`. Bind-mounted directories must be writable by that user; named Docker volumes inherit the image's directory ownership. With rootless Podman, named volumes may need `:U` to map ownership. Do not apply `:U` to host directories without understanding that it changes their ownership.

## Persistent state and harnesses

Keep both volumes when recreating or upgrading the container:

- `/data` is `$HOME` and `T3CODE_HOME`. It contains thread history, settings, authentication, and harness installs. npm's global prefix is `/data/.local`.
- `/workspace` holds projects and their Git repositories.

Install only the harnesses you need. Follow T3's provider compatibility guidance and vendor installation instructions. `~/.local/bin`, `~/.opencode/bin`, and `~/.grok/bin` are on `PATH`. npm versions that restrict lifecycle scripts may require explicitly allowing a package's installer; review the package before doing so.

Pi ships in the image. A user-installed Pi in `/data/.local/bin` takes precedence. Cursor's SDK is included in T3's archive. A detected harness is not necessarily signed in; complete its authentication in provider settings or the terminal. Headless environments may require device-code or API-key authentication instead of a browser callback.

Back up both volumes before upgrades. Removing the container does not remove named volumes, but deleting the volumes removes history, credentials, installed harnesses, and workspaces. Do not mount a running host T3 installation's data into this container.

This is a Linux container, not a Cloudflare Worker. T3 and its harnesses need subprocesses, native addons, and persistent writable storage.
