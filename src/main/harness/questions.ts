import { remoteQuestionItemSchema, type RemoteQuestionItem } from '@harness-ai/contracts'

// Normalization for the runtime's `question/requested` payload before it is
// forwarded over the device link.
//
// The payload is runtime-shaped and wider than the contract: it may carry
// presentation intents this build does not know (upstream tags them so more can
// be added). The server validates every link frame, so one unknown intent would
// otherwise reject the whole frame and the phone would never see the question
// at all. Degrading to the generic option list is always correct — an intent
// changes presentation only, never the answer encoding.

/**
 * Project runtime question items onto the contract shape, dropping only what
 * cannot be represented. Returns the items that survived, in order.
 */
export function normalizeQuestions(raw: unknown): RemoteQuestionItem[] {
  if (!Array.isArray(raw)) return []
  const items: RemoteQuestionItem[] = []
  for (const candidate of raw) {
    const direct = remoteQuestionItemSchema.safeParse(candidate)
    if (direct.success) {
      items.push(direct.data)
      continue
    }
    // Retry without the intent: an unrecognized tag costs presentation, not
    // the question. Anything still invalid is genuinely unrenderable.
    if (candidate !== null && typeof candidate === 'object' && 'intent' in candidate) {
      const { intent: _intent, ...rest } = candidate as Record<string, unknown>
      const stripped = remoteQuestionItemSchema.safeParse(rest)
      if (stripped.success) {
        items.push(stripped.data)
        continue
      }
    }
  }
  return items
}
