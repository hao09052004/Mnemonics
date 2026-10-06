// Maps the BE `items.kind` enum (`link | text | image | screenshot`)
// onto the six visual variants the Figma reference renders
// (`note | article | highlight | image | screenshot | document`).
//
// `document` has no BE match, so any card rendered with that label is
// intentionally shown as a disabled stub. `highlight` is a subtype of
// `link` that the renderer chooses via the `isHighlight(item)` helper
// inside MemoryCard based on whether `selectedText` is present.

export type MemoryLabel =
  | 'note'
  | 'article'
  | 'highlight'
  | 'image'
  | 'screenshot'
  | 'document';

const KIND_TO_LABEL: Record<string, MemoryLabel> = {
  link: 'article',
  text: 'note',
  image: 'image',
  screenshot: 'screenshot',
};

const LABEL_TO_KINDS: Record<MemoryLabel, string[]> = {
  note: ['text'],
  article: ['link'],
  highlight: ['link'],
  image: ['image'],
  screenshot: ['screenshot'],
  document: [], // no BE match — disabled card
};

export function kindToLabel(kind: string): MemoryLabel {
  return KIND_TO_LABEL[kind] ?? 'note';
}

export function labelToKinds(label: MemoryLabel): string[] {
  return LABEL_TO_KINDS[label];
}

export function normalizeKind(kind: string): MemoryLabel {
  if (KIND_TO_LABEL[kind]) return KIND_TO_LABEL[kind];
  if (kind === 'document') return 'document';
  return 'note';
}