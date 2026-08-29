# `@dsh-blue/blue-lark`

This optional Interaction compatibility adapter exists because dsh-lark currently exposes no stable Cordis frontend service. It uses the public Harness `webServer.port` property to call `http://127.0.0.1:<port>/dsh-lark/settings`, registers `/lark [status|retry]` through official `commands`, and publishes renderer-neutral `blueNotifications`.

This validation-only package keeps its own `0.1.0-rc.2` version outside the
product release set. Its Blue peers use the explicit preview window
`>=0.1.1-rc.1 <0.1.2`; a prerelease caret rooted on `0.1.0` does not admit the
`0.1.1` product line and breaks independent packed installs.

GET reads only `revision`, redacted credential availability, and runtime state. Retry POST sends only `expectedRevision`, which triggers dsh-lark's official reconciliation path. The adapter never stores a settings snapshot, secret, credential reference, or domain runtime. DELETE is deliberately not exposed.

Operation ids deduplicate concurrent/replayed commands, are bounded to 100 entries, and own one replaceable notification. Retention eviction aborts in-flight work and identity-checks its continuation so a reused operation id cannot be disturbed. Caller abort and Fiber unload abort active requests; late settlements cannot publish. Without `webServer` or the route, the command returns a plain availability error while the domain plugin remains independent.

Deletion condition: remove the HTTP compatibility client when dsh-lark publishes a stable renderer-neutral service/event for runtime description and reconciliation.

Packed acceptance: `script/blue-plugin-fixture.mjs packages/lark --install` executes seven shared runtime scenarios plus command/notification/retry and route-absent/abort/unload scenarios. Run the same 9/9 contract with `--harness-line <previous-version>` for compatibility; the 2026-08-23 baseline passed on Harness `0.1.1-rc.2` and `0.1.1-rc.1`.
