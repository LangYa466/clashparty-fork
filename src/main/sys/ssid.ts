import { exec } from 'child_process'
import { promisify } from 'util'
import { ipcMain, net } from 'electron'
import {
  getAppConfig,
  getControledMihomoConfig,
  patchAppConfig,
  patchControledMihomoConfig
} from '../config'
import { patchMihomoConfig } from '../core/mihomoApi'
import { mainWindow } from '../window'
import { getDefaultDevice } from '../core/manager'
import { updateTrayIcon } from '../resolve/tray'

export async function getCurrentSSID(): Promise<string | undefined> {
  if (process.platform === 'win32') {
    try {
      return await getSSIDByNetsh()
    } catch {
      return undefined
    }
  }
  if (process.platform === 'linux') {
    try {
      return await getSSIDByIwconfig()
    } catch {
      return undefined
    }
  }
  if (process.platform === 'darwin') {
    try {
      return await getSSIDByAirport()
    } catch {
      return await getSSIDByNetworksetup()
    }
  }
  return undefined
}

let lastSSID: string | undefined
let ssidCheckInterval: NodeJS.Timeout | null = null
// 记录是否处于「命中 pause SSID 而暂停」的状态，以及暂停前用户选择的模式，
// 否则离开 pause SSID 时无法区分该恢复成什么模式
let pausedBySSID = false
let modeBeforePause: OutboundMode | undefined

export async function checkSSID(): Promise<void> {
  try {
    const {
      pauseSSID = [],
      disableDnsOnPauseSSID = false,
      controlDns,
      controlDnsBeforePause
    } = await getAppConfig()
    if (pauseSSID.length === 0) return
    const currentSSID = await getCurrentSSID()
    if (currentSSID === lastSSID) return
    lastSSID = currentSSID
    const { mode: currentMode } = await getControledMihomoConfig()
    if (currentSSID && pauseSSID.includes(currentSSID)) {
      // 在两个 pause SSID 之间切换时已经处于暂停态，再走一遍会用「已被关掉的 false」
      // 覆盖 controlDnsBeforePause，导致用户的 DNS 接管开关永久丢失
      if (pausedBySSID) return
      pausedBySSID = true
      // direct 不作为「暂停前模式」记录，否则退出暂停后会一直停留在 direct
      modeBeforePause = currentMode && currentMode !== 'direct' ? currentMode : undefined
      if (disableDnsOnPauseSSID && controlDnsBeforePause === undefined) {
        // 保存当前 DNS 状态到 appConfig，然后关闭 DNS 接管
        await patchAppConfig({ controlDnsBeforePause: controlDns, controlDns: false })
      }
      await patchControledMihomoConfig({ mode: 'direct' })
      await patchMihomoConfig({ mode: 'direct' })
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      mainWindow?.webContents.send('appConfigUpdated')
      ipcMain.emit('updateTrayMenu')
      await updateTrayIcon()
    } else {
      // 只有当前确实是 direct（由暂停造成，或上次退出时残留）才需要恢复；
      // 否则会把用户自己选的 global 无条件改回 rule
      if (currentMode !== 'direct') {
        pausedBySSID = false
        modeBeforePause = undefined
        return
      }
      const restoreMode = modeBeforePause ?? 'rule'
      pausedBySSID = false
      modeBeforePause = undefined
      // DNS 恢复逻辑已移至 patchControledMihomoConfig，会在模式从 direct 切换到 rule/global 时自动触发
      await patchControledMihomoConfig({ mode: restoreMode })
      await patchMihomoConfig({ mode: restoreMode })
      mainWindow?.webContents.send('controledMihomoConfigUpdated')
      mainWindow?.webContents.send('appConfigUpdated')
      ipcMain.emit('updateTrayMenu')
      await updateTrayIcon()
    }
  } catch {
    // ignore
  }
}

export async function startSSIDCheck(): Promise<void> {
  if (ssidCheckInterval) {
    clearInterval(ssidCheckInterval)
  }
  await checkSSID()
  ssidCheckInterval = setInterval(checkSSID, 30000)
}

export function stopSSIDCheck(): void {
  if (ssidCheckInterval) {
    clearInterval(ssidCheckInterval)
    ssidCheckInterval = null
  }
}

async function getSSIDByAirport(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise(
    '/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I'
  )
  if (stdout.trim().startsWith('WARNING')) {
    throw new Error('airport cannot be used')
  }
  for (const line of stdout.split('\n')) {
    if (line.trim().startsWith('SSID')) {
      return line.split(': ')[1].trim()
    }
  }
  return undefined
}

async function getSSIDByNetworksetup(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  if (net.isOnline()) {
    const service = await getDefaultDevice()
    // networksetup -listpreferredwirelessnetworks 输出的是按优先级排序的「已保存网络」，
    // 首项并不是当前连接的网络，拿它冒充当前 SSID 会误判暂停；ipconfig getsummary 才反映当前连接
    const { stdout } = await execPromise(`ipconfig getsummary ${service}`)
    for (const line of stdout.split('\n')) {
      const matched = line.match(/^\s*SSID(?:_STR)?\s*:\s*(.+)$/)
      if (matched) {
        const ssid = matched[1].trim()
        if (ssid) return ssid
      }
    }
  }
  return undefined
}

async function getSSIDByNetsh(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise('netsh wlan show interfaces')
  for (const line of stdout.split('\n')) {
    if (line.trim().startsWith('SSID')) {
      return line.split(': ')[1].trim()
    }
  }
  return undefined
}

async function getSSIDByIwconfig(): Promise<string | undefined> {
  const execPromise = promisify(exec)
  const { stdout } = await execPromise(
    `iwconfig 2>/dev/null | grep 'ESSID' | awk -F'"' '{print $2}'`
  )
  if (stdout.trim() !== '') {
    return stdout.trim()
  }
  return undefined
}
