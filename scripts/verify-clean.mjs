// Run before pushing: reproduces a clean CI checkout locally.
//
// CI has no `.next` folder, so anything that only works because of generated files from an earlier local build
// (Next's route types) fails there and nowhere else. This deletes `.next` and then runs every gate in CI order,
// stopping at the first failure.
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const STEPS = ['format:check', 'lint', 'typecheck', 'test', 'build', 'size'];

rmSync('.next', { recursive: true, force: true });
process.stdout.write('verify:clean: removed .next\n');

for (const step of STEPS) {
  process.stdout.write(`\nverify:clean: npm run ${step}\n`);
  // shell: true so `npm` resolves to npm.cmd on Windows.
  const result = spawnSync('npm', ['run', step], { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    process.stderr.write(`\nverify:clean: FAILED at "${step}" (exit ${String(result.status)})\n`);
    process.exit(result.status ?? 1);
  }
}

process.stdout.write('\nverify:clean: all steps passed\n');
