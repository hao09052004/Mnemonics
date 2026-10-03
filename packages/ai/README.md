# @mnemonics/ai

Provider surface for every AI feature in Mnemonics.

This package owns the four provider interfaces and their concrete
implementations:

| Concern        | Interface                | Default (AI_FREE_ONLY=true)            | Optional legacy |
|----------------|--------------------------|-----------------------------------------|-----------------|
| Text generation| `TextProvider`           | Gemini free tier                        | `heuristic`     |
| Embeddings     | `EmbeddingProvider`      | Gemini `gemini-embedding-001` (1536-d)  | OpenAI          |
| OCR            | `OcrProvider`            | OCR.Space free tier                     | Tesseract local |
| Visual         | `VisualProvider`         | CLIP local (transformers.js)            | —               |

All callers (job handlers, REST routes, the Spaces suggester) talk
to `createAiService()` and the interfaces, never to a concrete
provider. The DI container is constructed once at boot.

`AI_FREE_ONLY=true` is enforced at construction time: a config that
selects `openai` for embeddings or any non-local visual provider
throws immediately. There is no way to call a paid provider under
free mode without a code change.

See:
- `docs/free-ai-setup.md` — how to obtain Gemini + OCR.Space keys
- `docs/ai-architecture.md` — provider contract + fallback policy
