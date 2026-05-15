import fs from 'fs/promises'
import yaml from 'js-yaml'
import path from 'path'
import picomatch from 'picomatch'
import { Index } from '../types/IndexType'
import { Options } from '../types/Options'
import { VersionSpec } from '../types/VersionSpec'

type PnpmWorkspacesCatalog =
  | string[]
  | {
      packages?: string[]
      catalog?: Index<VersionSpec>
      catalogs?: Index<Index<VersionSpec>>
    }

/**
 * Read catalog definitions from pnpm-workspace.yaml.
 */
async function readPnpmWorkspaceCatalogs(pnpmWorkspacePath: string): Promise<Index<Index<VersionSpec>>> {
  try {
    const content = await fs.readFile(pnpmWorkspacePath, 'utf-8')
    const data = yaml.load(content) as PnpmWorkspacesCatalog

    const result: Index<Index<VersionSpec>> = {}

    if (!Array.isArray(data)) {
      // Singular "catalog:" ->归入 'default' catalog
      if (data.catalog) {
        result['default'] = data.catalog
      }
      // Named catalogs ("catalogs:")
      if (data.catalogs) {
        for (const [catalogName, deps] of Object.entries(data.catalogs)) {
          result[catalogName] = deps
        }
      }
    }

    return result
  } catch {
    return {}
  }
}

/**
 * Read catalog definitions from package.json (Bun format or modern pnpm).
 */
async function readPackageJsonCatalogs(pkgPath: string): Promise<Index<Index<VersionSpec>>> {
  try {
    const content = await fs.readFile(pkgPath, 'utf-8')
    const pkg = JSON.parse(content)
    const result: Index<Index<VersionSpec>> = {}

    // Top-level catalog/catalogs
    if (pkg.catalog) {
      result['default'] = pkg.catalog
    }
    if (pkg.catalogs) {
      for (const [catalogName, deps] of Object.entries(pkg.catalogs)) {
        result[catalogName] = deps as Index<VersionSpec>
      }
    }

    // Workspaces object catalog/catalogs (Bun format)
    if (pkg.workspaces && !Array.isArray(pkg.workspaces)) {
      if (pkg.workspaces.catalog) {
        result['default'] = {
          ...(result['default'] || {}),
          ...pkg.workspaces.catalog,
        }
      }
      if (pkg.workspaces.catalogs) {
        for (const [catalogName, deps] of Object.entries(pkg.workspaces.catalogs)) {
          result[catalogName] = {
            ...(result[catalogName] || {}),
            ...(deps as Index<VersionSpec>),
          }
        }
      }
    }

    return result
  } catch {
    return {}
  }
}

/**
 * Read all catalog definitions from pnpm-workspace.yaml or package.json.
 * Supports both pnpm-workspace.yaml and package.json (Bun/modern pnpm) formats.
 *
 * @param options Application options
 * @param pkgPath package.json path (used to locate pnpm-workspace.yaml)
 * @returns Map of catalog name to dependencies
 */
export async function readCatalogDependencies(options: Options, pkgPath: string): Promise<Index<Index<VersionSpec>>> {
  const result: Index<Index<VersionSpec>> = {}

  // pnpm: read from pnpm-workspace.yaml
  if (options.packageManager === 'pnpm') {
    const pnpmWorkspacePath = path.join(path.dirname(pkgPath), 'pnpm-workspace.yaml')
    const pnpmCatalogs = await readPnpmWorkspaceCatalogs(pnpmWorkspacePath)
    Object.assign(result, pnpmCatalogs)
  }

  // Bun and modern pnpm: read from package.json
  const pkgJsonCatalogs = await readPackageJsonCatalogs(pkgPath)
  for (const [catalogName, deps] of Object.entries(pkgJsonCatalogs)) {
    if (result[catalogName]) {
      // pnpm-workspace.yaml takes precedence
      result[catalogName] = { ...deps, ...result[catalogName] }
    } else {
      result[catalogName] = deps
    }
  }

  return result
}

/**
 * Filter catalogs by name using --catalog option.
 *
 * @param catalogs All catalogs
 * @param catalogFilter --catalog option value
 * @returns Filtered catalogs
 */
export function filterCatalogsByName(
  catalogs: Index<Index<VersionSpec>>,
  catalogFilter?: string | readonly string[],
): Index<Index<VersionSpec>> {
  if (!catalogFilter || (Array.isArray(catalogFilter) && catalogFilter.length === 0)) {
    return catalogs
  }

  const filters = Array.isArray(catalogFilter) ? catalogFilter : [catalogFilter]

  return Object.fromEntries(
    Object.entries(catalogs).filter(([catalogName]) =>
      filters.some(f => catalogName === f || picomatch.isMatch(catalogName, f)),
    ),
  )
}
