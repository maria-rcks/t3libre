{
  cacert,
  fetchPnpmDeps,
  git,
  installShellFiles,
  lib,
  makeWrapper,
  nodejs,
  pkg-config,
  pnpm,
  pnpmConfigHook,
  pnpmDepsHash,
  python3,
  src,
  stdenv,
  version,
}:

let
  pnpmWorkspaces = [
    "@t3tools/scripts..."
    "@t3tools/web..."
    "t3..."
  ];
  webIconSourceDirectory = if lib.hasInfix "-nightly." version then "nightly" else "prod";
  webIconSourcePrefix = if webIconSourceDirectory == "nightly" then "nightly" else "t3-black";
in
stdenv.mkDerivation (finalAttrs: {
  pname = "t3code";
  inherit
    pnpmWorkspaces
    src
    version
    ;

  pnpmDeps = fetchPnpmDeps {
    inherit (finalAttrs)
      pname
      pnpmWorkspaces
      src
      version
      ;
    fetcherVersion = 4;
    hash = pnpmDepsHash;
    inherit pnpm;
  };

  nativeBuildInputs = [
    installShellFiles
    makeWrapper
    nodejs
    pkg-config
    pnpm
    pnpmConfigHook
    python3
  ];

  buildPhase = ''
    runHook preBuild

    export SSL_CERT_FILE="${cacert}/etc/ssl/certs/ca-bundle.crt"
    ./node_modules/.bin/vp run --filter t3 build

    icon_source="assets/${webIconSourceDirectory}/${webIconSourcePrefix}-web"
    client_target="apps/server/dist/client"
    cp "$icon_source-favicon.ico" "$client_target/favicon.ico"
    cp "$icon_source-favicon-16x16.png" "$client_target/favicon-16x16.png"
    cp "$icon_source-favicon-32x32.png" "$client_target/favicon-32x32.png"
    cp "$icon_source-apple-touch-180.png" "$client_target/apple-touch-icon.png"

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall

    pnpm --offline \
      --config.inject-workspace-packages=true \
      --filter t3 \
      deploy --prod "$out/lib/t3code"

    mkdir -p "$out/bin"
    makeWrapper "${nodejs}/bin/node" "$out/bin/t3" \
      --add-flags "$out/lib/t3code/dist/bin.mjs" \
      --prefix PATH : "${lib.makeBinPath [ git ]}"

    "$out/bin/t3" --completions bash >t3.bash
    "$out/bin/t3" --completions fish >t3.fish
    "$out/bin/t3" --completions zsh >t3.zsh
    installShellCompletion --bash t3.bash --fish t3.fish --zsh t3.zsh

    runHook postInstall
  '';

  doInstallCheck = true;
  installCheckPhase = ''
    runHook preInstallCheck

    test -f "$out/lib/t3code/dist/client/index.html"
    test "$("$out/bin/t3" --version)" = "t3 v${version}"
    "$out/bin/t3" --help >/dev/null

    runHook postInstallCheck
  '';

  meta = {
    description = "Minimal web GUI for coding agents";
    homepage = "https://github.com/pingdotgg/t3code";
    license = lib.licenses.mit;
    mainProgram = "t3";
    platforms = lib.platforms.linux ++ lib.platforms.darwin;
  };
})
