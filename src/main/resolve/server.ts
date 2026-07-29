import http from 'http'
import net from 'net'
import { getAppConfig, getControledMihomoConfig } from '../config'
import { proxyLogger } from '../utils/logger'
import { DEFAULT_MIHOMO_PORTS } from '../../shared/appConfig'

export let pacPort: number

const defaultPacScript = `
function FindProxyForURL(url, host) {
  return "PROXY 127.0.0.1:%mixed-port%; SOCKS5 127.0.0.1:%mixed-port%; DIRECT;";
}
`

export function findAvailablePort(startPort: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', (err) => {
      if (startPort <= 65535) {
        resolve(findAvailablePort(startPort + 1))
      } else {
        reject(err)
      }
    })
    server.on('listening', () => {
      server.close(() => {
        resolve(startPort)
      })
    })
    server.listen(startPort, '127.0.0.1')
  })
}

let pacServer: http.Server | undefined

export async function startPacServer(): Promise<void> {
  await stopPacServer()
  const { sysProxy } = await getAppConfig()
  const { mode = 'manual', host: cHost, pacScript } = sysProxy
  if (mode !== 'auto') {
    return
  }
  const host = cHost || '127.0.0.1'
  let script = pacScript || defaultPacScript
  const { 'mixed-port': port = DEFAULT_MIHOMO_PORTS.mixed } = await getControledMihomoConfig()
  script = script.replaceAll('%mixed-port%', port.toString())
  pacPort = await findAvailablePort(10000)
  const server = http.createServer(async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/x-ns-proxy-autoconfig' })
    res.end(script)
  })
  // host 由用户自由填写，findAvailablePort 只在 127.0.0.1 上探测过端口，这里绑定可能失败
  // （EADDRNOTAVAIL / ENOTFOUND）。listen 失败是异步事件，没有 'error' 监听器会直接变成主进程
  // 未捕获异常并弹错误框，所以把失败转成 reject 交给调用方处理
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener('listening', onListening)
      reject(err)
    }
    const onListening = (): void => {
      server.removeListener('error', onError)
      // 监听成功后仍保留 error 监听，防止运行期出错（如网络接口变化）再次崩溃主进程
      server.on('error', (err) => {
        proxyLogger.error('PAC server error', err).catch(() => {})
      })
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(pacPort, host)
  })
  pacServer = server
}

export async function stopPacServer(): Promise<void> {
  if (pacServer) {
    pacServer.close()
    pacServer = undefined
  }
}
