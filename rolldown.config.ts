import { builtinModules } from 'node:module'
import { defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'
import { visualizer } from 'rollup-plugin-visualizer'
import pkg from './package.json'

const inputs = ['./src/index.ts', './src/bin/cli.ts']

export default defineConfig([
  {
    input: inputs,
    output: {
      dir: './build',
      format: 'esm',
      sourcemap: true,
      entryFileNames: `[name].js`,
      chunkFileNames: 'chunks/[name].js',
      exports: 'named',
    },
    treeshake: true,
    transform: {
      target: 'node18',
    },
    plugins: [dts({}), ...(process.env.ANALYZER ? [visualizer()] : [])],
    external: [...builtinModules, ...builtinModules.map(m => `node:${m}`), ...Object.keys(pkg.dependencies)],
  },
])
