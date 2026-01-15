import { builtinModules } from 'node:module'
import { ModuleFormat, RolldownOptions, defineConfig } from 'rolldown'
import { dts } from 'rolldown-plugin-dts'
import { visualizer } from 'rollup-plugin-visualizer'
import pkg from './package.json'

const inputs = ['./src/index.ts', './src/bin/cli.ts']

const formats: ModuleFormat[] = []

const external = [...builtinModules, ...builtinModules.map(m => `node:${m}`), ...Object.keys(pkg.dependencies)]

const shardConfig: RolldownOptions = {
  input: inputs,
  treeshake: true,
  transform: {
    target: 'node18',
  },
  external,
}

export default defineConfig([
  {
    ...shardConfig,
    output: [
      {
        dir: './dist/esm',
        format: 'esm',
        sourcemap: true,
        entryFileNames: `[name].mjs`,
        chunkFileNames: 'chunks/[name].mjs',
        exports: 'named',
      },
    ],
    plugins: [dts({}), ...(process.env.ANALYZER ? [visualizer()] : [])],
  },
  {
    ...shardConfig,
    output: [
      {
        dir: './dist/cjs',
        format: 'cjs',
        sourcemap: true,
        entryFileNames: `[name].cjs`,
        chunkFileNames: 'chunks/[name].cjs',
        exports: 'named',
      },
    ],
    plugins: [...(process.env.ANALYZER ? [visualizer()] : [])],
  },
])
