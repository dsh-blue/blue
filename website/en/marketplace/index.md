# Plugin marketplace

::: info Under construction
The Blue ecosystem plugin marketplace will be implemented as a separate repository (listing, indexing, and card display); it is currently in the planning stage. This page is a placeholder and will go live together with the marketplace.
:::

## What this will be

A marketplace for **Blue downstream developers'** ecosystem plugins: status, dock, command, and notification plugins built through the stable [seams and public API](/en/plugins/seams) can be published to npm, listed here, and installed by other users in one line.

Each card will look roughly like this:

```
┌─────────────────────────────────────┐
│ my-plugin-clock              v0.1.0 │
│ status-bar clock + /now command     │
│ ★ 12 · status bar / commands        │
│ dsh plugin add my-scope/my-pkg      │
└─────────────────────────────────────┘
```

## Until it opens

- To develop a plugin: start with [Writing your first plugin](/en/plugins/); the seam catalog is the [Seam reference](/en/plugins/seams);
- To inspect the current composition: see the Blue bundle's 28 owned rows in [Built-in plugins](/en/plugins/builtins);
- Watch the [GitHub repository](https://github.com/dsh-blue/blue) for the marketplace announcement.
