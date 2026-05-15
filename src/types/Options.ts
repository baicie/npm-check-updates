import { Cacher } from './Cacher'
import { Index } from './IndexType'
import { RunOptions } from './RunOptions'
import { VersionSpec } from './VersionSpec'

/** Internal, normalized options for all ncu behavior. Includes RunOptions that are specified in the CLI or passed to the ncu module, as well as meta information including CLI arguments, package information, and ncurc config. */
export type Options = RunOptions & {
  args?: any[]
  /** Treat pnpm-workspace catalogs as a special workspace. */
  catalogs?: boolean
  cacher?: Cacher
  cli?: boolean
  distTag?: string
  json?: boolean
  nodeEngineVersion?: VersionSpec
  packageData?: string
  /** Path to pnpm-workspace.yaml for catalogs mode progress bar display. */
  pnpmWorkspacePath?: string
  /** Internal flag: this is a catalog file being processed. Used to customize progress bar display. */
  isCatalogFile?: boolean
  peerDependencies?: Index<any>
  rcConfigPath?: string
  // A list of local workspace packages by name.
  // This is used to ignore local workspace packages when fetching new versions.
  workspacePackages?: string[]
}
