// 统一入口：先跑 Node 几何单元测试，再跑 Playwright 端到端测试
import { spawn } from 'node:child_process';

const suites = ['tests/geometry.test.mjs', 'tests/e2e.test.mjs'];

for (const suite of suites) {
  console.log(`\n=== ${suite} ===`);
  const proc = spawn(process.execPath, ['--test', suite], { stdio: 'inherit' });
  const code = await new Promise((resolve) => proc.on('exit', resolve));
  if (code !== 0) process.exit(code);
}
console.log('\n全部测试通过');
