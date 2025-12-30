import { publish } from '@baicie/release'

publish({ defaultPackage: '@baicie/ncu', packageManager: 'pnpm', getPkgDir: () => '.' })
