/** Copy dictionaries for the Account settings section (fixed fallback en-US). */
export const en = {
  nav: 'Account',
  loggedOut: 'Not signed in. Signing in enables cloud sync later; everything local works without it.',
  loggedInPrefix: 'Signed in as ',
  offlineSuffix: ' (server unreachable — local features are unaffected)',
  email: 'Email',
  password: 'Password',
  signIn: 'Sign in',
  signUp: 'Create account',
  signOut: 'Sign out',
  busy: 'Working…',
  bridgeUnavailable: 'Account bridge is unavailable in this composition.',
  'error.invalid_credentials': 'Wrong email or password.',
  'error.email_taken': 'An account with this email already exists.',
  'error.server_unreachable': 'Cannot reach the account server.',
  'error.secure_storage_unavailable': 'System secure storage is unavailable; signing in is disabled.',
  'error.generic': 'The request failed. See the shell log for details.',
}
export type AccountKey = keyof typeof en

export const zh: Record<AccountKey, string> = {
  nav: '账号',
  loggedOut: '未登录。登录用于后续的云同步；不登录不影响任何本地功能。',
  loggedInPrefix: '已登录：',
  offlineSuffix: '（服务器暂不可达——本地功能不受影响）',
  email: '邮箱',
  password: '密码',
  signIn: '登录',
  signUp: '注册',
  signOut: '退出登录',
  busy: '处理中……',
  bridgeUnavailable: '当前组合未提供账号桥接。',
  'error.invalid_credentials': '邮箱或密码不正确。',
  'error.email_taken': '该邮箱已注册。',
  'error.server_unreachable': '无法连接账号服务器。',
  'error.secure_storage_unavailable': '系统安全存储不可用，无法登录。',
  'error.generic': '请求失败，详见壳日志。',
}
