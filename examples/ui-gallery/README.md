# UI gallery example

An opt-in Blue plugin that places a static showcase of the public
`@dsh-blue/blue-ui` builders in the `right` pane lane. Content, rich document,
chart, layout, and pattern demos sit behind a tab strip, and the pane degrades
to the bottom lane when the viewport is narrow. The rich group includes a
Markdown table, Mermaid DAG, line/point plots, grouped/stacked/normalized bars,
a sparkline, and a heatmap.

```sh
dsh plugin --profile blue-dev add @dsh-blue-example/ui-gallery
```

The package ships its own one-row `cordis.patch.yml`, so adding it activates
the plugin. Uninstalling it removes the pane with its Cordis Fiber.
