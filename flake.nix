{
  description = "T3 Code package and development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    {
      self,
      nixpkgs,
    }:
    let
      serverPackage = builtins.fromJSON (builtins.readFile ./apps/server/package.json);
      supportedSystems = [
        "aarch64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      mkPnpm =
        {
          pkgs,
          nodejsPackage ? pkgs.nodejs_24,
        }:
        pkgs.callPackage ./nix/pnpm.nix {
          nodejs = nodejsPackage;
        };

      mkPackage =
        {
          system,
          pkgs ? import nixpkgs { inherit system; },
          nodejsPackage ? pkgs.nodejs_24,
          pnpmPackage ? mkPnpm {
            inherit pkgs nodejsPackage;
          },
          pnpmDepsHash ? "sha256-/ldiZ9Y4Leys08HohTxNp5mdxYMs9Wi+dRV4tAtQWzA=",
          src ? self,
          version ? serverPackage.version,
        }:
        pkgs.callPackage ./nix/package.nix {
          inherit
            pnpmDepsHash
            src
            version
            ;
          nodejs = nodejsPackage;
          pnpm = pnpmPackage;
        };

      mkDevShell =
        {
          system,
          pkgs ? import nixpkgs { inherit system; },
          nodejsPackage ? pkgs.nodejs_24,
          pnpmPackage ? mkPnpm {
            inherit pkgs nodejsPackage;
          },
          extraPackages ? [ ],
          extraShellHook ? "",
        }:
        pkgs.mkShell {
          packages = [
            nodejsPackage
            pnpmPackage
            pkgs.git
            pkgs.gnumake
            pkgs.pkg-config
            pkgs.python3
            pkgs.stdenv.cc
          ]
          ++ extraPackages;

          shellHook = ''
            project_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
            export PATH="$project_root/node_modules/.bin:$PATH"
            unset project_root
          ''
          + extraShellHook;
        };
    in
    {
      lib = {
        inherit
          mkDevShell
          mkPackage
          mkPnpm
          supportedSystems
          ;
      };

      overlays.default = final: _previous: {
        t3code = self.lib.mkPackage {
          pkgs = final;
          system = final.stdenv.hostPlatform.system;
        };
      };

      packages = forAllSystems (system: {
        default = self.packages.${system}.t3code;
        t3code = self.lib.mkPackage { inherit system; };
      });

      apps = forAllSystems (system: {
        default = self.apps.${system}.t3code;
        t3code = {
          type = "app";
          program = "${self.packages.${system}.t3code}/bin/t3";
          meta.description = "Run T3 Code";
        };
      });

      devShells = forAllSystems (system: {
        default = self.lib.mkDevShell { inherit system; };
      });

      checks = forAllSystems (system: {
        package = self.packages.${system}.t3code;
      });

      formatter = forAllSystems (system: nixpkgs.legacyPackages.${system}.nixfmt);
    };
}
