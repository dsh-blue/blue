# `@dsh-blue/blue-harness-adapter`

Narrow F2 compatibility adapters between documented Harness capabilities and Blue's renderer-neutral runtime. Session, projection, action, model, question/approval, and locale bridges are independent and return structured absent, abort, or stale results. No adapter exposes a raw Harness Agent or Session object.

The `./locale` adapter binds Harness's `locale.preference` setting to one frontend-tree `blueLocale` service. With no explicit preference it follows `LC_ALL`, `LC_MESSAGES`, `LANG`, then `Intl`; Chinese variants map to Simplified Chinese and unsupported locales fall back to English.
