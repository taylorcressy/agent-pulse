# Release builds

Electron-builder emits installers under `release/`. Use a native runner for each platform:

```sh
pnpm dist:desktop --publish never
```

Targets are Linux AppImage and tar.gz, macOS DMG and ZIP, and Windows NSIS and portable. The Linux tarball provides the Gentoo-friendly portable path. Extract it and run `agentpulse` in a graphical session. Linux runtime compatibility has local evidence on Gentoo x64 with glibc 2.43. Older glibc targets and other architecture combinations require native smoke tests.

The manually dispatched GitHub workflow builds unsigned artifacts and generates SHA-256 checksums. The owner must explicitly authorize CI execution. Before public release, configure macOS signing and notarization and Windows publisher signing. Verify installation and removal on each claimed platform, verify checksums and dependency notices, and complete project-name clearance. Keep these release gates open until evidence exists.
