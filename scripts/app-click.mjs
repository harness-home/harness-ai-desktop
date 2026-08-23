// Send real mouse/key input into the running app over CDP (Input domain), so
// UI defects that only reproduce with genuine user input — focus traps, inert
// containers, pointer-event blockers — can be tested without a human.
//
//   node scripts/app-click.mjs click <x> <y>
//   node scripts/app-click.mjs key Escape
import WebSocket from 'ws'

const port = process.env.CDP_PORT ?? '9222'
const [action, a, b] = process.argv.slice(2)

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const page = targets.find((t) => t.type === 'page')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject) })

let nextId = 1
function send(method, params) {
  const id = nextId++
  return new Promise((resolve) => {
    const onMessage = (raw) => {
      const message = JSON.parse(String(raw))
      if (message.id !== id) return
      ws.off('message', onMessage)
      resolve(message.result)
    }
    ws.on('message', onMessage)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

if (action === 'click') {
  const x = Number(a)
  const y = Number(b)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
  console.log(`clicked (${String(x)}, ${String(y)})`)
} else if (action === 'key') {
  // Chromium needs rawKeyDown + the native/windows virtual key codes for
  // non-text keys; a bare keyDown is ignored by most key handlers.
  const codes = { Escape: 27, Enter: 13, Tab: 9 }
  const vk = codes[a] ?? 0
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: a, code: a, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: a, code: a, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk })
  console.log(`key ${a}`)
} else if (action === 'type') {
  for (const char of a) {
    await send('Input.dispatchKeyEvent', { type: 'keyDown', text: char, key: char })
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: char })
  }
  console.log(`typed ${String(a.length)} chars`)
} else {
  console.error('usage: click <x> <y> | key <name> | type <text>')
  process.exit(1)
}
ws.close()
