import { resolveLocale, t } from '../shared/i18n'
import '../shared/shell-api'

const locale = resolveLocale(undefined, navigator.languages)
const params = new URLSearchParams(location.search)
const failed = params.get('state') === 'failed'

document.documentElement.lang = locale
document.title = t(locale, 'shell.placeholder.title')

function set(id: string, text: string): void {
  const element = document.getElementById(id)
  if (element !== null) element.textContent = text
}

set('title', t(locale, 'shell.placeholder.title'))

if (failed) {
  set('status', t(locale, 'shell.failed.hint'))
  const detail = params.get('detail') ?? ''
  const pre = document.getElementById('detail')
  if (pre !== null && detail !== '') {
    pre.textContent = detail
    pre.hidden = false
  }
  const actions = document.getElementById('actions')
  if (actions !== null) actions.style.display = 'flex'
  set('retry', t(locale, 'shell.failed.retry'))
  set('open-logs', t(locale, 'shell.failed.openLogs'))
  set('quit', t(locale, 'shell.failed.quit'))
  document.getElementById('retry')?.addEventListener('click', () => window.harnessShell?.recovery.retry())
  document.getElementById('open-logs')?.addEventListener('click', () => window.harnessShell?.recovery.openLogs())
  document.getElementById('quit')?.addEventListener('click', () => window.harnessShell?.recovery.quit())
} else {
  set('status', t(locale, 'shell.placeholder.status'))
}
