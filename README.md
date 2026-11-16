# Instrumentation Planner

Private review copy of the Openlayer Instrumentation Planner. It is not deployed, and it is not connected to `tools.openlayer.com`.

The page asks how an AI use case is built and shows the Monitoring mode change: the code, the diagram, the safety summary, and a Word export of the answers. No keys are stored in the page or in a share link.

## Run it

```bash
npm run dev
```

Open http://localhost:3000/instrument

## Tests

`npm run test:instrument:fast` runs the offline checks.

`npm run test:instrument` also executes the Python and TypeScript snippets. Run `npm run setup:instrument-tests` once before that.
