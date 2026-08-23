// Evaluate an expression inside the running app's renderer over CDP.
// Launch the app with --remote-debugging-port=9222 first. Diagnostic tool:
// the shell window is the only place several UI defects reproduce (the
// external browser sees a different focus/pointer environment).
//
//   node scripts/app-eval.mjs "document.title"
//   node scripts/app-eval.mjs --file probe.js
import { readFileSync } from 'node:fs'
import WebSocket from 'ws'

const port = process.env.CDP_PORT ?? '9222'
const args = process.argv.slice(2)
const expression = args[0] === '--file' ? readFileSync(args[1], 'utf8') : args.join(' ')

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
if (page === undefined) {
  console.error('no page target; is the app running with --remote-debugging-port?')
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })

const result = await new Promise((resolve, reject) => {
  const id = 1
  const timer = setTimeout(() => reject(new Error('CDP evaluate timed out')), 30_000)
  ws.on('message', (raw) => {
    const message = JSON.parse(String(raw))
    if (message.id !== id) return
    clearTimeout(timer)
    resolve(message.result)
  })
  ws.send(JSON.stringify({
    id,
    method: 'Runtime.evaluate',
    params: { expression, awaitPromise: true, returnByValue: true, userGesture: true },
  }))
})
ws.close()

if (result.exceptionDetails !== undefined) {
  console.error('EXCEPTION:', result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  process.exit(1)
}
const value = result.result?.value
console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 1))
