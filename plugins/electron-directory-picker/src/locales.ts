// Host-side dialog copy. Each first-party plugin owns its dictionaries (same
// shape as plugins/account-ui); this one cannot use dsh's client locale
// service because it runs in the Electron main process.

export interface PickerCopy {
  readonly pickTitle: string
  readonly networkTitle: string
  readonly networkMessage: string
  readonly networkDetail: string
  readonly readOnlyTitle: string
  readonly readOnlyMessage: string
  readonly readOnlyDetail: string
  readonly junctionTitle: string
  readonly junctionMessage: string
  readonly junctionDetail: string
  readonly useAnyway: string
  readonly chooseAnother: string
}

export const en: PickerCopy = {
  pickTitle: 'Select a workspace folder',
  networkTitle: 'Network Folder',
  networkMessage: 'This folder is on a network share.',
  networkDetail:
    'The agent runs commands and installs plugins inside the workspace, which needs local disk'
    + ' features a network share does not provide. Those operations would fail later, in ways that'
    + ' are hard to trace back to this folder.',
  readOnlyTitle: 'Folder Not Writable',
  readOnlyMessage: 'Harness AI cannot create files in this folder.',
  readOnlyDetail: 'Check the folder permissions, or pick one inside your user directory.',
  junctionTitle: 'Limited Drive',
  junctionMessage: 'This drive does not support directory links.',
  junctionDetail:
    'Drives formatted as FAT32 or exFAT, such as many USB sticks, cannot store the links the'
    + ' runtime uses to resolve modules. Ordinary conversations work; some commands and plugin'
    + ' installs may fail.',
  useAnyway: 'Use This Folder',
  chooseAnother: 'Choose Another Folder',
}

export const zh: PickerCopy = {
  pickTitle: '选择工作区文件夹',
  networkTitle: '网络位置',
  networkMessage: '这个文件夹位于网络共享上。',
  networkDetail:
    'Agent 会在工作区内执行命令并安装插件，这需要网络共享不具备的本地磁盘能力。'
    + '否则相关操作会在后续失败，而且很难追溯到这个文件夹。',
  readOnlyTitle: '文件夹不可写入',
  readOnlyMessage: 'Harness AI 无法在这个文件夹里创建文件。',
  readOnlyDetail: '请检查文件夹权限，或改选用户目录下的位置。',
  junctionTitle: '磁盘能力受限',
  junctionMessage: '这个磁盘不支持目录链接。',
  junctionDetail:
    'FAT32 / exFAT 格式的磁盘（常见于 U 盘）无法保存运行时解析模块所需的链接。'
    + '普通对话不受影响，但部分命令和插件安装可能失败。',
  useAnyway: '仍使用此文件夹',
  chooseAnother: '重新选择',
}
