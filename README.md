# IOM Regatta Manager

Desktop app for running and scoring IOM regattas (Electron + React).

## Requirements

- Windows 10/11
- Node.js 20.x or newer
- npm 10.x or newer

## Project Root

Run all commands from the repository folder.

## Install Dependencies

```cmd
npm install
```

## Run in Development

```cmd
npm start
```

If `npm start` fails because old build artifacts are missing/corrupt, run:

```cmd
npm run build:dll
npm start
```

## Build / Package for Windows

Standard build command:

```cmd
npm run package
```

This creates installers and unpacked app inside:

- `release\\build`
- `release\\build\\win-unpacked`

## Build as Administrator (CMD)

If you want an elevated build every time, use:

```cmd
scripts\\package-admin.cmd
```

What this script does:

1. Requests Administrator rights (UAC prompt) if not already elevated.
2. Runs `npm install`.
3. Removes old `release\\build` output.
4. Runs `npm run package`.

## Build Outputs

After a successful package run, check:

- Installer: `release\\build\\IOM Regatta Manager Setup <version>.exe`
- Unpacked app folder: `release\\build\\win-unpacked`

If you also see old files like `Scoring App Setup ...`, they are leftovers from previous naming/builds. Delete `release\\build` and package again.

## Useful Commands

- `npm test` or `npm run test:unit`: run unit tests
- `npm run lint`: lint source files
- `npm run lint:fix`: auto-fix lint issues

## Troubleshooting

- `Missing script: start`: make sure you are in the project root (folder with this `README.md` and `package.json`).
- Packaging errors on native modules: run `npm install` again, then `npm run package`.
- Permission issues writing build files: use `scripts\\package-admin.cmd`.

## Problem reports

Help > Report a Problem… sends the user's report (with the event's data,
history, error log and a screenshot) to the report service in
`report-worker/`, which e-mails it to the developer. Builds need the service
key: put it in a `.report-key` file in the repository folder (git-ignored),
or set `IOM_REPORT_KEY`; the release workflow reads the `IOM_REPORT_KEY` repo
secret. A build without the key keeps reports on the computer.

## Data folder

The installed app keeps its database, backups and error log in
`%APPDATA%\IOM Regatta Manager` (macOS: `~/Library/Application Support/IOM
Regatta Manager`). A computer that already has results in the folder older
builds used (`electron-react-boilerplate`) keeps using it.
