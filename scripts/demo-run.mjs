import { spawn } from 'node:child_process';

const isWindows = process.platform === 'win32';
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';
const children = [];

function run(args, label) {
  const child = spawn(pnpm, args, {
    stdio: 'inherit',
    env: process.env,
    windowsHide: false
  });
  child.on('exit', (code, signal) => {
    if (code && !stopping) {
      console.error(`[demo] ${label} exited with code ${code}`);
      stop(code);
    } else if (signal && !stopping) {
      console.error(`[demo] ${label} stopped by ${signal}`);
      stop(1);
    }
  });
  children.push(child);
  return child;
}

let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;

  for (const child of children) {
    try { child.kill('SIGTERM'); } catch {}
  }

  const exitTimer = setTimeout(() => process.exit(code), 1500);
  exitTimer.unref();
}

async function waitForApi(maxAttempts = 30) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch('http://localhost:4000/api/v1/health');
      if (response.ok) return true;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

async function main() {
  console.log('\nMnemonics local demo');
  console.log('1. Preparing PostgreSQL + pgvector and seeding demo memories...');
  const setup = spawn(pnpm, ['demo:prepare'], { stdio: 'inherit', env: process.env });
  const setupCode = await new Promise(resolve => setup.on('exit', resolve));

  if (setupCode !== 0) {
    console.error('[demo] demo:prepare failed');
    process.exit(Number(setupCode) || 1);
  }

  console.log('2. Starting API...');
  run(['demo:api'], 'API');

  const ready = await waitForApi();
  if (!ready) {
    console.error('[demo] API did not become ready on http://localhost:4000');
    stop(1);
    return;
  }

  console.log('3. Starting web dashboard...');
  run(['demo:web'], 'Web');

  console.log('\nDemo ready:');
  console.log('  Dashboard: http://localhost:3000');
  console.log('  Account:   demo@mnemonics.local');
  console.log('  Password:  DemoPass123!');
  console.log('  Flow:      Lưu nhanh → Ready → Tìm kiếm → Ý liên quan');
  console.log('\nPress Ctrl+C to stop the API and web server.\n');
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

main().catch(error => {
  console.error('[demo] failed:', error);
  stop(1);
});
