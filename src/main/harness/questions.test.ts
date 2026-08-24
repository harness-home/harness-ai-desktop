import { describe, expect, it } from 'vitest'
import { normalizeQuestions } from './questions'

describe('normalizeQuestions', () => {
  it('returns an empty list for non-array payloads', () => {
    expect(normalizeQuestions(undefined)).toEqual([])
    expect(normalizeQuestions(null)).toEqual([])
    expect(normalizeQuestions({ id: 'q1' })).toEqual([])
  })

  it('passes a plain question through', () => {
    const items = normalizeQuestions([
      { id: 'q1', question: 'Which one?', options: [{ label: 'A' }, { label: 'B', description: 'the other' }] },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.id).toBe('q1')
    expect(items[0]?.options).toHaveLength(2)
  })

  it('keeps a known intent', () => {
    const items = normalizeQuestions([
      {
        id: 'q1',
        question: 'Approve this plan?',
        detail: '# Plan\n- step',
        options: [{ label: 'Approve' }, { label: 'Revise' }],
        intent: { kind: 'plan-review', approve: 'Approve' },
      },
    ])
    expect(items[0]?.intent).toEqual({ kind: 'plan-review', approve: 'Approve' })
  })

  it('drops an unknown intent but keeps the question', () => {
    const items = normalizeQuestions([
      {
        id: 'q1',
        question: 'Pick one',
        options: [{ label: 'A' }],
        intent: { kind: 'some-future-intent', extra: 1 },
      },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.intent).toBeUndefined()
    expect(items[0]?.options).toHaveLength(1)
  })

  it('drops a malformed intent of a known kind rather than the question', () => {
    // `approve` missing: the tag is known but the payload cannot be honoured.
    const items = normalizeQuestions([
      { id: 'q1', question: 'Pick one', intent: { kind: 'plan-review' } },
    ])
    expect(items).toHaveLength(1)
    expect(items[0]?.intent).toBeUndefined()
  })

  it('drops items that are unrenderable even without their intent', () => {
    const items = normalizeQuestions([
      { question: 'no id here', intent: { kind: 'plan-review', approve: 'Yes' } },
      { id: 'q2', question: 'kept' },
    ])
    expect(items.map((i) => i.id)).toEqual(['q2'])
  })
})
