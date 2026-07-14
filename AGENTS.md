# Rules for agents working on rulecov

- Run `npm test` (vitest) after any change under `src/` and report the result.
- Run `npm run build` before claiming a change is complete; the CLI ships from `dist/`.
- Do not commit or push unless explicitly asked.
- Keep changes minimal and focused; no drive-by refactors.
- Evidence discipline applies to you too: state what you verified and how, not just what you changed.

Yes, this file is a test target. Run `rulecov audit` on this repo and see which of these survive.
