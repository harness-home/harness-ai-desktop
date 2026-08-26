# @harness-ai/desktop-brand

Harness AI brand occupants for the [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) web client's brand slots, plus the Harness theme (teal on a neutral canvas, light and dark).

This is the brand plugin that ships inside [harness-ai-desktop](https://github.com/harness-home/harness-ai-desktop). Published standalone so any plain dsh profile can use the theme:

```bash
dsh plugin add @harness-ai/desktop-brand
```

The package is a profile bundle layer (`dsh.bundle.patch`) with an empty host row and a browser bundle in dsh's lazy-CJS client format. It has no runtime dependencies and runs nothing at install time.

Inside harness-ai-desktop the shell mounts this row itself — do not also install it from the market there (our own catalog blocklists it for exactly that reason).

MIT © Harness AI. Part of the [harness-home](https://github.com/harness-home) workspace.
