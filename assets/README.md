# `/assets`

Marketing-facing media. The README and the website reference files in here, so
keep filenames stable.

## `demo.gif`

The hero animation embedded at the top of the project README. Shows a Prisma PR
that drops `users.full_name`, the application code that still reads it through
the `@map` alias, MergeBrake's `BLOCK` verdict, and the expand/contract
recipe — in about 25 seconds.

The GIF is committed so the README renders correctly on GitHub, npm, and any
mirror. **Do not edit it by hand.** Regenerate from `demo.tape`:

```bash
# One-time install:
go install github.com/charmbracelet/vhs@latest     # or: brew install vhs

# Rebuild after changes to the demo fixture or the CLI:
npm run build
vhs assets/demo.tape
```

The fixture lives at [`examples/prisma-drop-column/`](../examples/prisma-drop-column/);
it is the same example used in the unit-test suite, so the demo can never drift
from real CLI behaviour.

## `demo.tape`

VHS script that drives `demo.gif`. Charm's
[VHS](https://github.com/charmbracelet/vhs) is a declarative way to record
terminal sessions to GIF without a screen recorder, so the recording is
reproducible in CI and not pixel-dependent on the recorder's display.
