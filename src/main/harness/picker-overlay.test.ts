import { describe, expect, it } from 'vitest'
import { directoryPickerOverlays, PICKER_BACKEND, PICKER_CLIENT_SURFACE } from './picker-overlay'

interface DisableRow { id: string; name: string; disabled: boolean }
interface InsertRow { insert: { id: string; name: string }[] }

function rows(): { disable: DisableRow; insert: InsertRow } {
  const [disable, insert] = directoryPickerOverlays('@deepseek-ai/dsh-host-directory-picker-auto')
  return { disable: disable as DisableRow, insert: insert as InsertRow }
}

describe('directoryPickerOverlays', () => {
  it('disables the composed row by the name it currently carries', () => {
    expect(rows().disable).toEqual({
      id: 'directory-picker',
      name: '@deepseek-ai/dsh-host-directory-picker-auto',
      disabled: true,
    })
  })

  it('inserts the Electron backend', () => {
    expect(rows().insert.insert.map((row) => row.name)).toContain(PICKER_BACKEND)
  })

  it('also inserts the client surface — the half that fills the picker menu', () => {
    // The regression this pins: shipping only the backend left ui-workspace's
    // directoryFlow holes empty, so the workspace chip opened an empty menu and
    // no workspace could be picked at all (0.1.0 through 0.1.2).
    expect(rows().insert.insert.map((row) => row.name)).toContain(PICKER_CLIENT_SURFACE)
  })

  it('gives every inserted row a distinct id', () => {
    const ids = rows().insert.insert.map((row) => row.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('replaces the row rather than leaving both interactions mounted', () => {
    // Two backends on the seam is a duplicate-service throw in cordis.
    const { disable, insert } = rows()
    expect(disable.disabled).toBe(true)
    expect(insert.insert.some((row) => row.name.includes('directory-picker-auto'))).toBe(false)
  })
})
