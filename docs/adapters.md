# Adapter Roadmap

Adapters answer one question: **how can YouBrowser observe this target honestly?**

They do not own business rules or qualitative rubrics.

| Kind | Observation boundary | Candidate evidence | Status |
| --- | --- | --- | --- |
| `web` | Real browser page/context | DOM, navigation response, console/page errors, geometry, screenshots | implemented |
| `http` | HTTP exchange | status, headers, body, JSON paths, timing | implemented |
| `file` | File artifact | existence, size, text/JSON content, SHA-256 | implemented |
| `json` | Structured data | schema, paths, values, invariants | planned |
| `image` | Raster/vector artifact | dimensions, alpha, perceptual observations | planned |
| `command` | Process execution | exit code, stdout/stderr, duration | implemented |
| `repo` | Source repository | diff, build, tests, package surfaces, generated artifacts | planned |
| `crawl` | Resource collection | discovered URLs/records, coverage, provenance | planned |
| `perf` | Single target performance | navigation/resource/web-vital metrics | planned |
| `load` | Concurrent execution | throughput, latency distribution, error rate | planned |
| `research` | Research artifact bundle | sources, dataset metadata, code, tables, citations | planned |
| `content` | Publishable content | structure, links, claims, metadata, rendering | planned |

## Promotion rule

A planned adapter becomes implemented only when it has:

1. a typed target contract;
2. bounded scenario semantics;
3. explicit observations;
4. evidence retention;
5. deterministic failure/blocking behavior;
6. protocol tests;
7. at least one real consumer.

Do not add an adapter solely to make the roadmap look complete.
