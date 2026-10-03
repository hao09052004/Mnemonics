/**
 * "No folders required." — visualises the actual processing pipeline
 * (Capture → Processing → Tags → Embedding → Ready) that the API
 * already implements. No invented stages.
 */
export function AIPipelineSection() {
  const steps: { title: string; body: string; tone: 'muted' | 'warm' | 'brand' | 'ink' }[] = [
    {
      title: 'Capture',
      body: 'Anything you save — page, highlight, image, screenshot — is forwarded to the API as a memory with a stable id.',
      tone: 'muted'
    },
    {
      title: 'Processing',
      body: 'OCR runs on images and screenshots. The pipeline waits for it before generating tags or embeddings.',
      tone: 'warm'
    },
    {
      title: 'Tags',
      body: 'A small language model picks 1–5 tags from your existing tag set, falling back to new ones when needed.',
      tone: 'brand'
    },
    {
      title: 'Embedding',
      body: 'A vector embedding is computed for the memory so semantic search can find it by meaning.',
      tone: 'ink'
    },
    {
      title: 'Ready',
      body: 'The memory flips to ready. It now shows up in lists, tag filters, semantic search and related-memory rails.',
      tone: 'brand'
    }
  ];

  return (
    <section className="section">
      <div className="container">
        <div style={{ maxWidth: 720 }}>
          <div className="eyebrow">Understand</div>
          <h2 className="display h2" style={{ marginTop: 14 }}>
            No folders required.
          </h2>
          <p className="lead" style={{ marginTop: 18 }}>
            Mnemonics quietly processes what you save — extracting text, picking tags,
            embedding for search. By the time you go looking for it, the memory is ready.
          </p>
        </div>

        <ol
          style={{
            marginTop: 48,
            listStyle: 'none',
            padding: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 20,
            counterReset: 'step'
          }}
        >
          {steps.map((s, i) => (
            <li
              key={s.title}
              style={{
                position: 'relative',
                padding: '22px 22px 24px',
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 18
              }}
            >
              <div
                aria-hidden
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 36,
                  color: 'var(--muted-soft)',
                  lineHeight: 1
                }}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div style={{ marginTop: 12, fontSize: 17, fontWeight: 700, fontFamily: 'var(--font-display)' }}>
                {s.title}
              </div>
              <p style={{ marginTop: 8, fontSize: 14, color: 'var(--muted)', lineHeight: 1.55 }}>{s.body}</p>
              <Pip tone={s.tone} />
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Pip({ tone }: { tone: 'muted' | 'warm' | 'brand' | 'ink' }) {
  const colors = {
    muted: 'var(--muted-soft)',
    warm: 'var(--warm)',
    brand: 'var(--brand)',
    ink: 'var(--ink)'
  } as const;
  return (
    <span
      aria-hidden
      style={{
        position: 'absolute',
        right: 16,
        bottom: 16,
        width: 10,
        height: 10,
        borderRadius: 999,
        background: colors[tone]
      }}
    />
  );
}
