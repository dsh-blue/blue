# @dsh-blue/blue-cli

The `blue` launcher ships a tested dsh host and calibrates the `blue` profile on first use.

Install with npm, then install pnpm 11 before the first boot:

```sh
npm i -g @dsh-blue/blue-cli@rc
npm i -g pnpm@11
blue
```

The profile is managed by dsh's official pnpm workspace path. Once the profile already carries the shell's exact Blue version, ordinary starts do not invoke pnpm again. Reinstall the shell to upgrade; use `dsh plugin` for explicit profile management.

