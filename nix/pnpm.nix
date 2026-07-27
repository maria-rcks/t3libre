{
  fetchurl,
  lib,
  nodejs,
  stdenvNoCC,
}:

stdenvNoCC.mkDerivation (finalAttrs: {
  pname = "pnpm";
  version = "11.10.0";

  src = fetchurl {
    url = "https://registry.npmjs.org/pnpm/-/pnpm-${finalAttrs.version}.tgz";
    hash = "sha512-C3+LmAYAMZBMAX46QesYehbUDuuCm5XE+MsDaBdh/Eq1PdIZEVubRH9NzhoFohR2RGHn03AzkqnzL5URzoyGyA==";
  };

  nativeBuildInputs = [ nodejs ];
  buildInputs = [ nodejs ];

  preConfigure = ''
    rm -r dist/reflink.*node dist/vendor
  '';

  installPhase = ''
    runHook preInstall

    install -d "$out/bin" "$out/libexec"
    cp -R . "$out/libexec/pnpm"
    ln -s "$out/libexec/pnpm/bin/pnpm.mjs" "$out/bin/pn"
    ln -s "$out/libexec/pnpm/bin/pnpm.mjs" "$out/bin/pnpm"
    ln -s "$out/libexec/pnpm/bin/pnpx.mjs" "$out/bin/pnx"
    ln -s "$out/libexec/pnpm/bin/pnpx.mjs" "$out/bin/pnpx"

    runHook postInstall
  '';

  passthru = {
    majorVersion = lib.versions.major finalAttrs.version;
    nodejs-slim = nodejs;
  };

  meta = {
    description = "Fast, disk space efficient package manager";
    homepage = "https://pnpm.io/";
    license = lib.licenses.mit;
    mainProgram = "pnpm";
    platforms = lib.platforms.all;
  };
})
