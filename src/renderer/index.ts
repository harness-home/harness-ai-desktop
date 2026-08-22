import { resolveLocale, t } from '../shared/i18n'

const locale = resolveLocale(undefined, navigator.languages)

document.documentElement.lang = locale
document.title = t(locale, 'shell.placeholder.title')

const title = document.getElementById('title')
const status = document.getElementById('status')
if (title) title.textContent = t(locale, 'shell.placeholder.title')
if (status) status.textContent = t(locale, 'shell.placeholder.status')
