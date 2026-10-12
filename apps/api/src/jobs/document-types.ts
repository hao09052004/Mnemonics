/**
 * Document capture type surface — the contract every layer above the
 * `extract_document` job uses. The route, repository, and jobs all
 * re-export these names so we have a single vocabulary across the
 * stack.
 */

export type {
  DocumentMimeType,
  CaptureType
} from '@mnemonics/shared';

export {
  documentMimeTypes,
  captureTypes
} from '@mnemonics/shared';