import { release } from '@baicie/release'

release({
  repo: 'baicie',
  packages: ['@baicie/ncu'],
  toTag: (pkg, version) => `${pkg}@${version}`,
  logChangelog: _pkg => {},
  generateChangelog: _pkg => {},
  getPkgDir: () => '.', // 指定根目录
})
