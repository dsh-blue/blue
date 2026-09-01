# `@dsh-blue-example/user-kit`

Pure renderer-neutral component kit shared by header and right-inspector. It
uses only `@dsh-blue/blue-ui` builders and `defineBlueComponent`; it has no
Cordis entry, Blue service registration, runtime state, timer, subscription,
or renderer dependency.

Callers own input data and receive deeply frozen wire nodes. Keep the package
outside Blue's release set while retaining build, coverage, pack, and
independent-install validation.
