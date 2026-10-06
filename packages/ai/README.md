# @mnemonics/ai

Provider surface for every AI feature in Mnemonics.

This package owns the four provider interfaces and their concrete
implementations:

| Concern        | Interface                | Primary (Gemini)                       | Local fallback     |
|----------------|--------------------------|----------------------------------------|--------------------|
| Text generation| `TextProvider`           | Gemini free tier                        | Ollama → heuristic |
| Embeddings     | `EmbeddingProvider`      | Gemini `gemini-embedding-001` (1024-d)  | Ollama `bge-m3`    |
| OCR            | `OcrProvider`            | OCR.Space free tier                     | Tesseract local    |
| Visual         | `VisualProvider`         | CLIP local (transformers.js)            | —                  |

All callers (job handlers, REST routes, the Spaces suggester) talk
to `createAiService()` and the interfaces, never to a concrete
provider. The DI container is constructed once at boot.

**OpenAI is not a provider.** There is no `openai` implementation and
no `OPENAI_API_KEY`; a ChatGPT key cannot be selected by accident.
`AI_FREE_ONLY=true` remains as a guard so a future paid provider
cannot be enabled without a code change.

Embeddings from both real providers are **exactly 1024-d** because
they share the `item_embeddings.embedding` column (`vector(1024)`,
migration 017). A local model of a different width is rejected rather
than padded — see `providers/embeddings/ollama.ts`.

See:
- `docs/free-ai-setup.md` — how to obtain Gemini + OCR.Space keys
- `docs/ai-architecture.md` — provider contract + fallback policy
