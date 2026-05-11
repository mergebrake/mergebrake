# VHS tape for the README demo GIF.
#
# Rebuild:
#   1. Install VHS once:  go install github.com/charmbracelet/vhs@latest
#                         (or:  brew install vhs)
#   2. Build the CLI:     npm run build
#   3. Render the gif:    vhs assets/demo.tape
#
# Output lands at assets/demo.gif (~150 KB, 60 frames, ~25 seconds).
# The script runs against examples/prisma-drop-column, which is a
# self-contained Prisma + Postgres fixture committed in this repo.

Output assets/demo.gif

Set Shell "bash"
Set FontSize 13
Set Width 1100
Set Height 680
Set Theme "Catppuccin Mocha"
Set TypingSpeed 40ms
Set Padding 18

# --- Setup: move into the demo project ---
Type "cd examples/prisma-drop-column"
Enter
Sleep 600ms

# --- The PR: a Prisma migration drops a column ---
Type "cat prisma/migrations/20260511_drop_full_name/migration.sql"
Enter
Sleep 2200ms

# --- The hidden risk: app code still reads it through the @map alias ---
Type "rg 'fullName|full_name' src"
Enter
Sleep 2500ms

# --- Run MergeBrake ---
Type "npx mergebrake scan 'prisma/migrations/**/migration.sql' \\"
Enter
Type "  --commits commits.txt"
Enter
Sleep 5500ms

# --- Leave the result on screen for sharing ---
Sleep 3000ms
