# Built-in plugins

The Blue bundle inserts 31 ordinary Cordis siblings over `dsh-base`: six dsh
support rows and 25 Blue product rows. There is no group/isolate or private
service realm.

<!-- BEGIN diagram:blue-composition -->
<!-- single source 单一来源: docs/diagrams/blue-composition.mmd — edit the .mmd, then `pnpm run diagrams:sync` -->
```mermaid
flowchart TB
    BASE["dsh-base"]
    subgraph GRAPH["flat Cordis sibling graph · 35 inserted rows"]
        SUPPORT["dsh support · 6 rows<br/>subagent settings · presets · host runner<br/>workspace · session controller · title"]
        API["blue-api<br/>four direct UI registries"]
        APP["blue-conversation · blue-startup · blue-app"]
        VIEW["blue-frontend · blue-core · theme"]
        PRODUCT["transcript · status · panes · editor · interaction"]
        PLUGINS["external Cordis plugins"]
    end
    NATIVE["native dsh services"]

    BASE --> NATIVE
    NATIVE --> SUPPORT
    NATIVE --> APP
    NATIVE --> PRODUCT
    NATIVE --> PLUGINS
    API --> VIEW
    API --> PRODUCT
    API --> PLUGINS
    APP --> PRODUCT
    VIEW --> PRODUCT
```
<!-- END diagram:blue-composition -->

## Support rows

- subagent model settings and agent presets;
- dynamic Cordis host runner;
- session controller;
- all-prompts title provider.

## Blue rows

- `blue-api`: four direct UI registries;
- `blue-frontend`, `blue-core`, and dark theme;
- `blue-conversation`, startup, app/current Agent;
- banner, transcript, and official model;
- basic/cwd/git/title/context/mode status;
- activity/queue/todo/BTW/agents panes;
- attachments, paste image, editor-plus, and interaction.

External plugin rows share this service graph. Activation dependencies come
from `inject`, not YAML position. Every built-in status or pane uses the same
`blueStatus`/`bluePanes` registry available to external plugins.
