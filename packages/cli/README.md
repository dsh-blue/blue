# @dsh-blue/blue-cli

The `blue` launcher ships a tested dsh host and calibrates the `blue` profile on first use.

Install with npm, then install pnpm 11 before the first boot:

```sh
npm i -g @dsh-blue/blue-cli@rc
npm i -g pnpm@11
blue
```

The profile is managed by dsh's official pnpm workspace path. Once the profile already carries the shell's exact Blue version, ordinary starts do not invoke pnpm again. Reinstall the shell to upgrade; use `dsh plugin` for explicit profile management.

The shell also carries Blue's own creative mode: at every boot it syncs a Blue-targeted `cordis` preset (Blue plugin and composition authoring guidance, host-half runtime inspection) over the nested host's shipped copy. The id and the picker name stay `cordis` / 创造模式, so selecting 创造模式 in Blue always means Blue's version. This touches only the shell's own nested dsh install — another dsh installation on the same machine (for example the Web UI's) keeps the upstream creative mode untouched. If the nested host is not writable (a root-owned global prefix), that boot warns once and falls back to the shipped creative mode.
