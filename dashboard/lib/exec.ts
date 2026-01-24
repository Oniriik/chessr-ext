import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export interface ExecResult {
  stdout: string
  stderr: string
}

export async function executeCommand(command: string, timeout = 30000): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      timeout,
      maxBuffer: 1024 * 1024 * 10, // 10MB
    })
    return { stdout, stderr }
  } catch (error: any) {
    // If command fails but has output, return it
    if (error.stdout || error.stderr) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
      }
    }
    throw error
  }
}
