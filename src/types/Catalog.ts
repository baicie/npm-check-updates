import { Index } from './IndexType'
import { VersionSpec } from './VersionSpec'

/**
 * Catalog entry, representing dependencies defined in a single catalog.
 */
export interface CatalogEntry {
  /** Catalog name, e.g. "default", "test", "production" */
  name: string
  /** Dependencies and their version specs defined in this catalog */
  dependencies: Index<VersionSpec>
  /** Source file path (pnpm-workspace.yaml or package.json) */
  filePath: string
}

/**
 * Catalog metadata, containing all catalog definitions.
 */
export interface CatalogInfo {
  /** Map of catalog name to catalog entry */
  catalogs: Index<CatalogEntry>
  /** Original pnpm-workspace.yaml content (preserves comments and formatting) */
  rawContent?: string
  /** Source file path */
  sourceFile: string
}
