import { release } from '@baicie/release'

release({
  repo: 'baicie',
  packages: ['ncu'],
  toTag: (pkg, version) => `${pkg}@${version}`,
  logChangelog: _pkg => {},
  generateChangelog: _pkg => {},
  getPkgDir: () => '.', // 指定根目录
})
