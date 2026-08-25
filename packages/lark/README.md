# `@dsh-blue/blue-lark`

Optional renderer-neutral compatibility adapter for `@sugarforever/dsh-lark`. It registers `/lark [status|retry]` through the official Harness command service and publishes operation-scoped Blue notifications.

The adapter calls the public loopback `/dsh-lark/settings` route, retains no settings or credentials, and never offers credential deletion. When the route or web server is absent, the Lark domain plugin remains active and the command returns a plain availability message.
