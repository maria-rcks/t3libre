# syntax=docker/dockerfile:1
# T3 Code server image. See packaging/docker/README.md.

ARG T3_VERSION

# The release's Node bundle: the server's JS, the web client, and its native
# addons. Build from a local archive instead with
# `--build-context bundle=<extracted t3-<version>-linux-<arch>-node directory>`.
FROM cgr.dev/chainguard/wolfi-base AS download
ARG T3_VERSION
ARG TARGETARCH
RUN set -eu; \
    test -n "$T3_VERSION" || { echo "Pass --build-arg T3_VERSION=<version>." >&2; exit 1; }; \
    apk add --no-cache curl; \
    arch=$([ "$TARGETARCH" = arm64 ] && echo arm64 || echo x64); \
    name="t3-${T3_VERSION}-linux-${arch}-node.tar.gz"; \
    base="https://github.com/pingdotgg/t3code/releases/download/v${T3_VERSION}"; \
    cd /tmp; \
    curl -fsSLO "$base/$name"; \
    curl -fsSLO "$base/SHA256SUMS"; \
    grep "  $name\$" SHA256SUMS | sha256sum -c -; \
    mkdir /bundle; \
    tar -xzf "$name" -C /bundle --strip-components=1

FROM scratch AS bundle
COPY --from=download /bundle/ /

# Pi runs on the image's Node from its prebuilt bundle. Keep its disk-backed
# assets and runtime externals without installing the full npm dependency graph.
FROM cgr.dev/chainguard/wolfi-base AS pi
ARG PI_VERSION=1.0.1
ARG PI_SHA256=99c2e1958ac6d4c6a36e7f1c3690ae38778bb397c63e9d611d2c09521be735c5
ARG JITI_VERSION=2.7.0
ARG JITI_SHA256=8dd0d365fb49c0e7cc42d6a00df6fb2da9056fc24492094346fc34ecdbcf28ca
ARG QUICKJS_VERSION=3.6.2
ARG QUICKJS_SHA256=f1f4349f19a2d849e33ea0ae9bec2e7062b8839f4eceb17c9051ddbaa2720982
ARG PHOTON_VERSION=0.3.4
ARG PHOTON_SHA256=5a23015c1cd2c38e3c492dd96929985247b92f52d2ff0fb948d29edca52bc50a
RUN set -eu; \
    apk add --no-cache curl; \
    cd /tmp; \
    curl -fsSL -o pi.tgz "https://registry.npmjs.org/@earendil-works/pi-coding-agent/-/pi-coding-agent-${PI_VERSION}.tgz"; \
    curl -fsSL -o jiti.tgz "https://registry.npmjs.org/jiti/-/jiti-${JITI_VERSION}.tgz"; \
    curl -fsSL -o quickjs.tgz "https://registry.npmjs.org/quickjs-wasi/-/quickjs-wasi-${QUICKJS_VERSION}.tgz"; \
    curl -fsSL -o photon.tgz "https://registry.npmjs.org/@silvia-odwyer/photon-node/-/photon-node-${PHOTON_VERSION}.tgz"; \
    echo "$PI_SHA256  pi.tgz" | sha256sum -c -; \
    echo "$JITI_SHA256  jiti.tgz" | sha256sum -c -; \
    echo "$QUICKJS_SHA256  quickjs.tgz" | sha256sum -c -; \
    echo "$PHOTON_SHA256  photon.tgz" | sha256sum -c -; \
    mkdir -p pi /pi/bin /pi/dist/core /pi/dist/modes/interactive \
        /pi/node_modules/jiti /pi/node_modules/quickjs-wasi /pi/node_modules/@silvia-odwyer/photon-node; \
    tar -xzf pi.tgz -C pi --strip-components=1; \
    mv pi/package.json pi/README.md pi/CHANGELOG.md pi/docs pi/examples /pi/; \
    mv pi/dist/bundle /pi/dist/; \
    mv pi/dist/modes/interactive/theme pi/dist/modes/interactive/assets /pi/dist/modes/interactive/; \
    mv pi/dist/core/export-html /pi/dist/core/; \
    tar -xzf jiti.tgz -C /pi/node_modules/jiti --strip-components=1; \
    tar -xzf quickjs.tgz -C /pi/node_modules/quickjs-wasi --strip-components=1; \
    tar -xzf photon.tgz -C /pi/node_modules/@silvia-odwyer/photon-node --strip-components=1; \
    ln -s ../dist/bundle/cli.js /pi/bin/pi

FROM cgr.dev/chainguard/wolfi-base
# Agents need a shell and git; curl runs the harness installers. One Node runs
# the server and Pi, and npm installs harnesses published to the npm registry.
# Stripping Node's symbols saves 14 MB.
RUN set -eu; \
    apk add --no-cache bash git curl nodejs-24 npm binutils; \
    strip /usr/bin/node; \
    apk del --no-cache binutils; \
    mkdir -p /data /workspace; \
    chown 65532:65532 /data /workspace
COPY --from=bundle / /opt/t3/
COPY --from=pi /pi /opt/pi
COPY t3 /usr/local/bin/t3
# HOME is the /data volume, so server state, harness sign-ins, and harnesses
# installed with their own installers (into ~/.local/bin and similar) or with
# `npm install -g` persist.
ENV HOME=/data \
    NPM_CONFIG_PREFIX=/data/.local \
    T3CODE_HOME=/data \
    T3CODE_HOST=0.0.0.0 \
    T3CODE_PORT=3773 \
    T3CODE_NO_BROWSER=true \
    SHELL=/bin/bash \
    PATH=/data/.local/bin:/data/.opencode/bin:/data/.grok/bin:/opt/pi/bin:/usr/local/bin:/usr/bin:/bin
USER 65532:65532
WORKDIR /workspace
EXPOSE 3773
ENTRYPOINT ["t3"]
CMD ["serve", "/workspace"]
