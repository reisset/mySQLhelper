# Roadmap — research-backed future work

Ideas evaluated during the v3.14.0 SQL-accuracy research pass (July 2026),
kept here so they don't get lost. Ordered by expected impact.

## 1. Agentic probe loop (highest ceiling — build this next if error rate needs another cut)

Let the model run small read-only exploration queries *before* committing to a
final answer — the way a human analyst works: peek at distinct values, check a
join's cardinality, confirm a date format, then write the real query.

- Research: RAISE ([arxiv 2506.01273](https://arxiv.org/pdf/2506.01273)),
  ReFoRCE ([arxiv 2502.00675](https://arxiv.org/pdf/2502.00675)),
  APEX-SQL ([arxiv 2602.16720](https://arxiv.org/pdf/2602.16720)).
  Agentic exploration is the strongest known technique for the "model is blind
  to the data" problem — beyond what static value annotations (v3.14.0) fix.
- Safety: every probe goes through the existing `validate_sql()` boundary and
  read-only connections; nothing new is exposed.
- Design sketch: multi-turn backend flow around `/chat_stream` — model emits a
  probe request, backend executes and feeds results back, bounded at N probes
  (3–5), then the final answer streams. UI shows probes as collapsible
  "investigation steps" in the conversation.
- Cost: significant backend + streaming-UX work; requires tool-calling or a
  structured probe protocol per provider (LM Studio + Ollama). Expect further
  token-consumption increase (tokens buy accuracy — same trade as v3.14.0).

## 2. SQL-specialized model support (zero/low code)

Fine-tuned small models beat much larger general models at text-to-SQL:
Arctic-Text2SQL-R1-7B outscores GPT-4o on six benchmarks
([arxiv 2505.20315](https://arxiv.org/pdf/2505.20315); GGUF:
[mradermacher/Arctic-Text2SQL-R1-7B-GGUF](https://huggingface.co/mradermacher/Arctic-Text2SQL-R1-7B-GGUF)).
Already noted in README "Choosing a model".

Possible follow-up: a **dual-model mode** — general chat model for
conversation/explanations, SQL specialist invoked only for query generation
and correction rounds. Both providers can serve multiple models. Adds config
surface; only worth it if single-model results plateau.

## 3. Empty-result verification (deliberately parked — forensic caveat)

The literature (MAC-SQL) treats an empty result set as a refinement signal and
regenerates the query. **Parked on purpose:** in forensics, "no rows" is often
the correct, evidentially meaningful answer ("no deleted messages after date
X"), and auto-"correcting" it risks fabricating results. If ever built, it
must be a *verification* round (model confirms or revises, UI badges
"verified empty"), never a silent retry.

## 4. Rejected: self-consistency / candidate voting

Generate N candidate queries, execute all, majority-vote the result. Proven
accuracy gains, but N× generation latency on a local 27B model is unacceptable
interactive UX. Revisit only if local inference gets dramatically faster.

## Evaluated and ruled out (July 2026)

- **Vanna.ai**: requires per-database training data (question–SQL pairs in a
  vector store) — incompatible with "upload an arbitrary .db and start asking".
- **LangChain / LlamaIndex SQL agents**: same techniques as above, huge
  dependency tree for a lightweight pipx app.
- **Swapping the execution layer** (e.g. shelling out to sqlite3.exe):
  Python's `sqlite3` *is* SQLite; generation, not execution, is the
  bottleneck.
