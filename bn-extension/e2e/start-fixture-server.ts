import { spawn, type ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = process.env.FIXTURE_PORT || '8765';
const baseUrl = `http://127.0.0.1:${port}`;

let serverProcess: ChildProcess | null = null;

async function isHealthy() {
  try {
    const res = await fetch(`${baseUrl}/health`);
    return res.ok;
  } catch {
    return false;
  }
}

export async function ensureFixtureServer() {
  if (await isHealthy()) return;

  serverProcess = spawn('node', ['--import', 'tsx', 'e2e/fixture-server.ts'], {
    cwd: path.join(__dirname, '..'),
    stdio: 'pipe',
    env: { ...process.env, FIXTURE_PORT: port },
  });

  for (let i = 0; i < 50; i++) {
    if (await isHealthy()) return;
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error(`Fixture server did not start on ${baseUrl}`);
}

export async function stopFixtureServer() {
  if (!serverProcess) return;
  serverProcess.kill('SIGTERM');
  serverProcess = null;
}
