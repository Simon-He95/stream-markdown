Shiki-render microbenchmark

This page compares two strategies for rendering highlighted code lines:

- innerHTML: build an HTML string for each code block and set `.innerHTML`.
- DOM API: build DOM nodes with `createElement`/`textContent` and append via `DocumentFragment`.

How to run

1. Open `packages/stream-markdown/bench/benchmark.html` in a desktop browser (Chrome/Edge recommended).
   - You can open via file://, or serve via a simple HTTP server (python3 -m http.server) from the repo root and navigate to the file.
2. Adjust the parameters (Containers, Lines per container, Tokens per line, Token content length).
3. Click `Create containers` then run `Run innerHTML` or `Run DOM API` to compare.

Metrics

- The page uses PerformanceObserver for the `longtask` entry type (if supported) to count long tasks that indicate main-thread blocking.
- It also reports run duration in ms for the synchronous construction loop.

Notes

- This benchmark is synthetic: it simulates the DOM and token workload but doesn't import the library code. It's intended to help reason about DOM vs innerHTML costs before/after applying your changes.
- For more realistic testing, integrate the library render paths into a small app and collect traces with DevTools Performance.
