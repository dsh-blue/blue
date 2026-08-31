# @dsh-blue/blue-plugin-kit

Published author CLI for Blue plugins. It creates a canonical local package and
runs the same package validator and packed-install conformance runner used by
the Blue repository, without requiring a Blue checkout.

```sh
npx @dsh-blue/blue-plugin-kit catalog --json
npx @dsh-blue/blue-plugin-kit create ./my-blue-plugin --name @acme/my-blue-plugin
npx @dsh-blue/blue-plugin-kit validate ./my-blue-plugin
npx @dsh-blue/blue-plugin-kit conformance ./my-blue-plugin
npx @dsh-blue/blue-plugin-kit conformance ./my-blue-plugin --harness-line 0.1.2-alpha.2
```

Install globally or as a project tool to use the shorter `blue-plugin` command.
`catalog --json` is the machine authority for available capability versions,
resources, limits, and quotas. `create` refuses non-empty destinations and
emits a no-build ESM baseline; adapt it after deciding capability grants.

The commands never publish, create a repository, or mutate a dsh profile.
Conformance packs with lifecycle scripts disabled, installs into a temporary
project with normal peer resolution, and verifies public entry load, Host
admission, widths 20/40/80/120, Fiber unload, and capability-absent fallback.
Blue `0.1.2-alpha.1` supports exactly Harness `0.1.2-alpha.2`; the explicit
option is a diagnostic override within that supported set, and RC lines are
rejected. It is a compatibility check, not a security sandbox.
