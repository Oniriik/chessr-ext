import { Client, ClientChannel } from 'ssh2'

export interface SSHConfig {
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: Buffer
}

export function createSSHConnection(config: SSHConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client()

    conn.on('ready', () => {
      console.log('[SSH] Connection established')
      resolve(conn)
    })

    conn.on('error', (err) => {
      console.error('[SSH] Connection error:', err)
      reject(err)
    })

    conn.connect({
      host: config.host,
      port: config.port || 22,
      username: config.username,
      password: config.password,
      privateKey: config.privateKey,
      readyTimeout: 10000,
    })
  })
}

export function executeCommand(conn: Client, command: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    conn.exec(command, (err, stream) => {
      if (err) {
        reject(err)
        return
      }

      stream.on('close', (code: number) => {
        resolve({ stdout, stderr, code })
      })

      stream.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      stream.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
    })
  })
}

export function createShell(conn: Client): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    conn.shell((err, stream) => {
      if (err) {
        reject(err)
        return
      }
      resolve(stream)
    })
  })
}
