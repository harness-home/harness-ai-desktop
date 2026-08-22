// Interactive-acceptance driver (docs/acceptance.md section 2, automated).
// Requires a running shell instance on loopback and a DeepSeek API key.
//
//   node scripts/acceptance.mjs setup            # DSKEY env var -> credential store
//   node scripts/acceptance.mjs run <workspace>  # model session + in-workspace tool
//   node scripts/acceptance.mjs approval <workspace>  # out-of-workspace write -> approval
//   node scripts/acceptance.mjs resume <sessionId>    # after an app restart
//
// The API key is read from the DSKEY env var only; it is never printed or
// written by this script.
const BASE = process.env.HARNESS_BASE ?? 'http://127.0.0.1:43110'

const [phase, arg] = process.argv.slice(2)

async function call(method, payload) {
  const res = await fetch(`${BASE}/api/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', method, rpcId: `acc-${method}-${Date.now()}`, payload }),
  })
  const json = await res.json()
  if (json.result?.ok !== true) throw new Error(`${method} failed: ${JSON.stringify(json.result?.error).slice(0, 300)}`)
  return json.result.value
}

async function respond(rpcId, value) {
  const res = await fetch(`${BASE}/api/respond`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'client-response', rpcId, result: { ok: true, value } }),
  })
  return res.json()
}

/** Auto-allow approvals for one session over the mux WebSocket. */
function autoApprove(sessionId, log) {
  const ws = new WebSocket(`${BASE.replace('http', 'ws')}/api/events.mux`)
  const approvals = []
  ws.addEventListener('message', (event) => {
    let frame
    try { frame = JSON.parse(String(event.data)) } catch { return }
    const payload = frame.payload ?? frame
    if (payload.type === 'approval/requested' && payload.sessionId === sessionId) {
      log(`approval requested: tool=${payload.toolName} reason=${payload.reason ?? ''}`)
      approvals.push(payload.toolName)
      void respond(frame.rpcId, { sessionId, approvalId: payload.approvalId, outcome: 'allowed-once' })
    }
    if (payload.type === 'approval/resolved' && payload.sessionId === sessionId) {
      log(`approval resolved: ${payload.outcome}`)
    }
  })
  return { approvals, close: () => { try { ws.close() } catch { /* already closed */ } } }
}

async function waitIdle(sessionId, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  await new Promise(r => setTimeout(r, 5000))
  while (Date.now() < deadline) {
    const list = await call('session.list', {})
    const item = (list.items ?? []).find(i => i.sessionId === sessionId)
    if (item !== undefined && item.running === false) return true
    await new Promise(r => setTimeout(r, 3000))
  }
  return false
}

async function lastAssistant(sessionId) {
  const history = await call('session.history', { sessionId })
  const events = history.events.map(w => w.event)
  const messages = events.filter(e => e.type === 'assistant/message')
  return { total: events.length, last: JSON.stringify(messages.at(-1)?.data?.message?.content ?? []) }
}

async function promptAndWait(sessionId, text, timeoutMs) {
  const approver = autoApprove(sessionId, m => console.log(`  ${m}`))
  await call('session.prompt', { sessionId, mode: 'queue', content: [{ type: 'text', text }] })
  const idle = await waitIdle(sessionId, timeoutMs)
  approver.close()
  return { idle, approvals: approver.approvals }
}

function fail(message) {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

if (phase === 'setup') {
  if (!process.env.DSKEY) fail('DSKEY env var missing')
  await call('credentials.set', { ref: 'DEEPSEEK_API_KEY', value: process.env.DSKEY })
  const view = await call('credentials.describe', { refs: ['DEEPSEEK_API_KEY'] })
  if (view.credentials?.DEEPSEEK_API_KEY?.configured !== true) fail('credential did not persist')
  console.log('PASS: credential configured')
} else if (phase === 'run') {
  if (!arg) fail('usage: run <workspace-dir>')
  const { sessionId } = await call('session.create', { cwd: arg })
  console.log('sessionId:', sessionId)
  const { idle } = await promptAndWait(sessionId,
    'Use the shell to run: echo harness-acceptance > proof.txt  (in the current workspace). Then reply with exactly: DONE', 240_000)
  if (!idle) fail('session never went idle')
  const { total, last } = await lastAssistant(sessionId)
  if (!last.includes('DONE')) fail(`assistant did not reply DONE: ${last.slice(0, 200)}`)
  console.log(`PASS: model session + tool run (${total} events); verify ${arg}\\proof.txt exists, then optionally run:`)
  console.log(`  node scripts/acceptance.mjs resume ${sessionId}   (after restarting the app)`)
} else if (phase === 'approval') {
  if (!arg) fail('usage: approval <workspace-dir>')
  const { sessionId } = await call('session.create', { cwd: arg })
  console.log('sessionId:', sessionId)
  const { idle, approvals } = await promptAndWait(sessionId,
    'Use the shell to write the single word approved into the file $env:USERPROFILE\\harness-approval-test.txt (note: that path is OUTSIDE this workspace). Do not ask for confirmation in chat; just run the command. Then reply with exactly: DONE', 300_000)
  if (!idle) fail('session never went idle')
  if (approvals.length === 0) fail('no approval was requested')
  const { last } = await lastAssistant(sessionId)
  if (!last.includes('DONE')) fail(`assistant did not reply DONE: ${last.slice(0, 200)}`)
  console.log('PASS: approval requested, auto-allowed, command ran; clean up %USERPROFILE%\\harness-approval-test.txt')
} else if (phase === 'resume') {
  if (!arg) fail('usage: resume <sessionId>')
  const before = await lastAssistant(arg)
  console.log(`history intact: ${before.total} events`)
  const { idle } = await promptAndWait(arg, 'Reply with exactly: RESUMED', 180_000)
  if (!idle) fail('session never went idle')
  const after = await lastAssistant(arg)
  if (!after.last.includes('RESUMED')) fail('model did not reply RESUMED')
  console.log(`PASS: resumed session answered after restart (${after.total} events)`)
} else {
  fail(`unknown phase ${String(phase)}; use setup | run | approval | resume`)
}
