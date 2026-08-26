# `@dsh-blue/blue-app`

English | [中文](README.zh.md)

Blue's command-line startup provider and Agent driver for the interactive `dsh --profile blue` surface.

The `./startup` entry (`blue-startup`) declares an optional `[task]` positional and `--resume <id>`, then publishes the parsed values through `blueStartup`. Help and parse failures never start the app action.

The main entry (`blue-app`) creates or resumes the Harness Agent, but keeps the Agent and Session inside the package. Frontend plugins receive three renderer-neutral services:

- `blueSessionReader` publishes immutable current-session snapshots and accepts the basic follow-up, steer, and interrupt actions defined by `@dsh-blue/blue-api`.
- `blueSessionProjections` reads and subscribes to official current-session projection values, including direct child-session values, without exposing a Session handle.
- `blueSessionActions` owns richer interaction operations such as model and mode changes, command execution, queue projection, rewind candidates, presets, skills, tools, session details, and disposable side sessions. Interrupt requests also stop live continuable descendants of the current Agent.

Create, resume, fork, rewind, and new-session requests are serialized through one switch queue. A switch creates or resumes the replacement first, disposes the previous Agent, installs the new internal binding, and only then publishes the next reader snapshot. Failures leave the current session intact and report to stderr. A startup task is submitted as the first ordinary user message.

Model selection uses three tiers: an in-session choice, the latest durable request header, then the process default. The selected route is exposed as an immutable action result; the mutable Harness selection reference never crosses the app boundary. Optional preset composition is restored from the session record on create and resume.

The package also owns safe open-turn retraction and BTW side sessions. A side-session handle exposes only an opaque projection identity, plain-text follow-up, admitted `running`/`idle` status, and disposal.

## Model Experience

The app adds no prompt prefix. It submits user input as ordinary user messages; prompts and tools belong to the composed Harness profile.

## Launcher and Coverage

Blue ships a dedicated launcher: the standalone `blue` binary from `@dsh-blue/blue-cli`, which pins a nested, tested dsh host and calibrates the `blue` profile on first use. Booting through the generic `dsh --profile blue` launcher resolves the same immutable bundle. The bundle's whole-tree e2e and real-process smoke suites cover the assembled profile.
