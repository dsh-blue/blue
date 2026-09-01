# @dsh-blue/blue-conversation

Harness-native, renderer-independent conversation projection used by Blue frontend models. It registers the `blueConversation` session projection and preserves append-origin human transcript history across replay, resume, streaming, tools, images, failures, and interruption. A safe prompt retraction removes the complete retracted turn and suppresses late events for that turn.

After registration it publishes the effect-scoped `blueConversationReady` load-order signal, allowing consumers to take their first resumed-session snapshot only after projection replay exists. Unloading the plugin removes both the projection and the signal.

This is a domain package: it contains no TUI, terminal, React, DOM, Agent, or Session-facing frontend code.
