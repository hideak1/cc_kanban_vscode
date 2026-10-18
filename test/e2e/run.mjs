import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runTests } from '@vscode/test-electron';

const installed = ['Code', 'Electron']
  .map((bin) => `/Applications/Visual Studio Code.app/Contents/MacOS/${bin}`)
  .find((p) => existsSync(p));

const userDataDir = mkdtempSync(join(tmpdir(), 'ck-e2e-'));

await runTests({
  ...(installed ? { vscodeExecutablePath: installed } : {}),
  extensionDevelopmentPath: resolve('.'),
  extensionTestsPath: resolve('test/e2e/suite.cjs'),
  launchArgs: ['--disable-extensions', `--user-data-dir=${userDataDir}`, '--skip-welcome', '--skip-release-notes'],
});
