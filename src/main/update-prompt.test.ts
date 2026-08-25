import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) } }))
vi.mock('./log', () => ({ log: { info: () => {}, warn: () => {}, error: () => {} } }))

const { answerForButton } = await import('./update-prompt')

// The dialog is the one link in the update path an automated run cannot press,
// so the mapping from button to answer is pinned here instead.
describe('answerForButton', () => {
  it('maps the buttons in the order they are shown', () => {
    expect(answerForButton(0)).toBe('now')
    expect(answerForButton(1)).toBe('later')
    expect(answerForButton(2)).toBe('cancel')
  })

  it('reads a dismissed dialog as cancel, never as install', () => {
    // -1 is what a closed dialog reports on some platforms; anything unknown
    // must not become "restart the user's app".
    expect(answerForButton(-1)).toBe('cancel')
    expect(answerForButton(99)).toBe('cancel')
    expect(answerForButton(Number.NaN)).toBe('cancel')
  })
})
