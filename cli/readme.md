# Tutopanda CLI

The CLI orchestrates blueprint runs, stores build artefacts, and now bundles the standalone viewer so end users can run `npx tutopanda …` without cloning the repo.

## End-user install

Once published to npm (see packaging steps below) people can bootstrap everything with:

```bash
npx tutopanda install --rootFolder=~/tuto
npx tutopanda viewer:start &
npx tutopanda viewer:view --movieId movie-123
```

- `install` is an alias of `init`; it creates the storage root and drops a config under `~/.tutopanda/cli-config.json`.
- `viewer:start` launches the bundled viewer server in the foreground (Ctrl+C to stop). Keep it running in a terminal.
- `viewer:view --movieId …` opens the browser at the correct `/movies/<id>` URL (starts the server in the background if needed).
- `viewer:stop` stops the background server started by `viewer:view`.

All other commands (`generate`, `clean`, `producers:list`, etc.) behave exactly like before.

## MCP install (Claude Desktop & Claude Code)

The MCP server lets an LLM client call `generate_story`, inspect blueprints, and open the viewer without running manual CLI commands. To set it up:

1. **Initialize** the CLI (once per machine/project):
   ```bash
   tutopanda init --rootFolder=~/media/tutopanda
   ```
   This seeds `~/media/tutopanda/catalog/blueprints` while still writing the config to the default path `~/.tutopanda/cli-config.json`. If you pass `--configPath`, remember to set `TUTOPANDA_CLI_CONFIG` in your shell profile so new terminals inherit it; otherwise every CLI command automatically reads the default config, so `init` is a one-time step.
   > We recommend not specifying --configPath and using the default path, unless you think you have a good reason not to and also ready to modify your .zshrc etc. with the exported TUTOPANDA_CLI_CONFIG/

2. **Register the MCP server with your client:**

   - **Claude Desktop**  
     Open *Settings → Model Context Protocol → Add Server* and supply:
     ```
     Name: Tutopanda
     Command: tutopanda
     Arguments: mcp --defaultBlueprint=image-audio.yaml
     Working directory: (leave blank or point at your repo)
     Environment:
       TUTOPANDA_CLI_CONFIG=/home/me/media/tutopanda/cli-config.json
     ```
     The blueprint value may be an absolute path or a filename relative to `catalog/blueprints`. Add `--openViewer=false` if you don’t want the viewer to launch automatically. Claude Desktop launches this command via stdio whenever the assistant needs Tutopanda context.

   - **Claude Code (VS Code extension)**  
     Add an entry to your VS Code settings (`settings.json` or UI):
     ```json
     "claudeCode.mcpServers": [
       {
         "name": "Tutopanda",
         "command": "tutopanda",
         "args": ["mcp", "--defaultBlueprint=image-audio.yaml"],
         "env": {
           "TUTOPANDA_CLI_CONFIG": "/home/me/media/tutopanda/cli-config.json"
         }
       }
     ]
     ```
     Include `--openViewer=false` in the `args` array if you prefer headless runs. Restart the extension so it picks up the new provider.

3. **Usage** – In either client you can now ask:  
   > “Use Tutopanda to generate a 30-second story about the Roman Empire.”  
   The MCP tool handles input validation, runs `tutopanda generate`, exposes artefacts/timeline as resources, and opens the viewer (unless you pass `--openViewer=false` in the MCP command).


## Packaging for release (maintainers)

From the repo root:

```bash
pnpm package:cli
```

That script performs the full pipeline:

1. Builds the viewer and copies `viewer/dist` + `viewer/server-dist` into `cli/viewer-bundle`.
2. Builds the CLI TypeScript sources into `cli/dist`.
3. Runs `pnpm --filter @tutopanda/cli pack --pack-destination release` to produce `release/@tutopanda/cli-<version>.tgz`.

To publish to npm after packaging:

```bash
cd cli
pnpm publish --access public
```

The published tarball already contains the viewer bundle, so consumers can simply `npx tutopanda …` without any extra setup.

### Publishing to NPM
 1. You need an npm account.
      - Create one at https://www.npmjs.com/signup if you don’t already have it.
      - Run npm login (or pnpm login) locally to store your auth token.
  2. Set your package metadata.
      - In cli/package.json, make sure "name": "tutopanda" (or whatever you want the npm name to be) and "version" is bumped each
        release.
      - From the repo root, you already run pnpm package:cli to build everything.
      - Then cd cli && pnpm publish --access public uploads cli/ (including the bundled viewer) to npm under that package name.
  3. How users find it.
      - Once published, people can search npmjs.com (https://www.npmjs.com) for your package name.
      - You tell them to run npx tutopanda install … or npm install -g tutopanda; npm will download the package you published.

  If you need a private registry or organization, you’d configure publishConfig.registry and npm tokens accordingly, but for the
  public npx tutopanda experience, the default npm registry + a public package is all you need.
