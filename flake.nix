{
  description = "mc-dev-meta: Development-time workspace binder for the nerima-games Minecraft-clone rebuild: clones the 15 game repositories into repos/ and binds them into one pnpm workspace, with a committed manifest pinning each revision. Never published.";

  inputs = {
    # nixos-unstable, not nixpkgs-unstable: it advances only after the NixOS
    # release tests pass, so it is less likely to land a broken build.
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs =
    { nixpkgs, ... }:
    let
      # Only what is actually exercised: x86_64-linux by CI, aarch64-darwin by
      # the maintainer. Declaring a platform nothing builds makes
      # `nix flake check --all-systems` fail rather than skip it.
      systems = [
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = pkgsFor system;
        in
        {
          # Node 22 matches the `engines` field and the CI runner. pnpm comes
          # from corepack rather than nixpkgs so that the version is decided by
          # the `packageManager` field in package.json — one source of truth
          # instead of two that can drift.
          #
          # oxlint is the opposite case: it is NOT a package.json devDependency.
          # It used to be, pinned to `^0.12.0`, which does not implement
          # `no-restricted-imports` at all (see README.md / docs/workflow.md for
          # where that mattered). A single Nix-pinned oxlint replaces every
          # repository independently drifting on its own npm-resolved version.
          default = pkgs.mkShell {
            packages = [
              pkgs.nodejs_22
              pkgs.corepack_22
              pkgs.typescript-language-server
              pkgs.oxlint
            ];

            shellHook = ''
              corepack enable --install-directory "$PWD/.corepack" 2>/dev/null || true
              export PATH="$PWD/.corepack:$PATH"
            '';
          };
        }
      );
    };
}
