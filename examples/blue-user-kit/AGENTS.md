# `@dsh-blue-example/user-kit`

This validation-only package is a pure user component kit. It composes only
public `@dsh-blue/blue-ui` builders through `defineBlueComponent`; it has no
Cordis entry, manifest, capability, host state, timer, subscription, or
renderer dependency. Callers own all input data and receive deeply frozen
wire nodes.

The component metadata retains its compatible executable Blue API Beta range;
the kit is Beta ecosystem evidence rather than a Stable v1 artifact.

The header and right-inspector examples must continue to consume this package
through its published root export. Keep it outside Blue's release set and
default bundle while retaining build, coverage, pack, and independent-install
validation.
