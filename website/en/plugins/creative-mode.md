# Creative mode walkthrough

The `blue-cordis` preset can hot-mount a dynamic Cordis prototype in the
current process. The prototype is still an ordinary Cordis plugin with direct
access to the current service graph.

Workflow:

1. list current service/event/tool providers with `cordis_inspect_list`;
2. query exact method schemas;
3. use `cordis_define` for a host package with
   `name / inject / apply(ctx)`;
4. activate with `cordis_run`; define a new immutable package and `update`
   when iterating;
5. pause with `cordis_stop`, remove with `cordis_undefine`;
6. after acceptance, ask for local/GitHub/npm/ephemeral before persistence.

```js
return {
  name: 'health-probe',
  inject: ['commands', 'blueOverlays'],
  apply(ctx) {
    ctx.commands.register({
      name: 'health-probe',
      description: 'Open health',
      handler() {
        ctx.blueOverlays.open({
          id: 'probe.health',
          capturing: true,
          render: () => ({ kind: 'text', content: 'healthy' }),
        })
        return { kind: 'success', text: 'opened health' }
      },
    })
  },
}
```

Dynamic `code.host` is a plain JavaScript function body: no import, require,
or TypeScript. The prototype disappears after restart. Persistence uses a
normal package.json, compiled entry, and cordis.patch.yml.
