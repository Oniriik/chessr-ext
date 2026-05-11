import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function executeCommand(
  command: string
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      maxBuffer: 1024 * 1024 * 10, // 10MB buffer for logs
    })
    return { stdout, stderr }
  } catch (error: unknown) {
    const execError = error as { stdout?: string; stderr?: string; message?: string }
    return {
      stdout: execError.stdout || '',
      stderr: execError.stderr || execError.message || 'Command execution failed',
    }
  }
}
