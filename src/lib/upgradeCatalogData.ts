import fs from 'fs/promises'
import yaml from 'js-yaml'
import path from 'path'
import { Index } from '../types/IndexType'
import { VersionSpec } from '../types/VersionSpec'

/**
 * Upgrade catalog dependencies in a YAML file (e.g., pnpm-workspace.yaml).
 * Preserves the overall YAML structure and formatting.
 */
async function upgradeYamlCatalogData(
  filePath: string,
  catalogName: string | undefined,
  current: Index<VersionSpec>,
  upgraded: Index<VersionSpec>,
): Promise<string> {
  const fileContent = await fs.readFile(filePath, 'utf-8')

  const yamlData = yaml.load(fileContent) as {
    packages?: string[]
    catalog?: Index<string>
    catalogs?: Index<Index<string>>
  }

  /**
   *
   */
  const applyUpgrade = (catalog: Index<string> | undefined): Index<string> | undefined => {
    if (!catalog) return undefined
    const updated = { ...catalog }
    for (const [dep, newVersion] of Object.entries(upgraded)) {
      if (dep in updated) {
        updated[dep] = newVersion
      }
    }
    return updated
  }

  const catalogsToUpdate: { name: string; data: Index<string> }[] = []

  if (catalogName) {
    if (yamlData.catalogs?.[catalogName]) {
      catalogsToUpdate.push({ name: catalogName, data: yamlData.catalogs[catalogName] })
    }
    if (!yamlData.catalogs && yamlData.catalog && catalogName === 'default') {
      catalogsToUpdate.push({ name: 'default', data: yamlData.catalog })
    }
  } else {
    if (yamlData.catalog) {
      catalogsToUpdate.push({ name: 'default', data: yamlData.catalog })
    }
    if (yamlData.catalogs) {
      for (const [name, data] of Object.entries(yamlData.catalogs)) {
        catalogsToUpdate.push({ name, data })
      }
    }
  }

  for (const { data } of catalogsToUpdate) {
    const updated = applyUpgrade(data)
    if (updated) {
      Object.assign(data, updated)
    }
  }

  return yaml.dump(yamlData, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  })
}

/**
 * Upgrade catalog dependencies in a JSON file (e.g., package.json for Bun).
 */
async function upgradeJsonCatalogData(
  filePath: string,
  catalogName: string | undefined,
  current: Index<VersionSpec>,
  upgraded: Index<VersionSpec>,
): Promise<string> {
  const fileContent = await fs.readFile(filePath, 'utf-8')
  const pkg = JSON.parse(fileContent)

  /**
   *
   */
  const applyUpgrade = (catalog: Index<string> | undefined): Index<string> | undefined => {
    if (!catalog) return undefined
    const updated = { ...catalog }
    for (const [dep, newVersion] of Object.entries(upgraded)) {
      if (dep in updated) {
        updated[dep] = newVersion
      }
    }
    return updated
  }

  if (!catalogName || catalogName === 'default') {
    if (pkg.catalog) pkg.catalog = applyUpgrade(pkg.catalog)
    if (pkg.workspaces?.catalog) {
      pkg.workspaces.catalog = applyUpgrade(pkg.workspaces.catalog)
    }
  }

  if (pkg.catalogs) {
    const catalogNames = catalogName ? [catalogName] : Object.keys(pkg.catalogs)
    for (const name of catalogNames) {
      if (pkg.catalogs[name]) {
        pkg.catalogs[name] = applyUpgrade(pkg.catalogs[name])
      }
    }
  }

  if (pkg.workspaces?.catalogs) {
    const catalogNames = catalogName ? [catalogName] : Object.keys(pkg.workspaces.catalogs)
    for (const name of catalogNames) {
      if (pkg.workspaces.catalogs[name]) {
        pkg.workspaces.catalogs[name] = applyUpgrade(pkg.workspaces.catalogs[name])
      }
    }
  }

  return JSON.stringify(pkg, null, 2)
}

/**
 * Upgrade catalog dependencies in either YAML or JSON catalog files.
 * Supports pnpm-workspace.yaml (pnpm) and package.json (Bun) catalog formats.
 */
export async function upgradeCatalogData(
  filePath: string,
  catalogName: string | undefined,
  current: Index<VersionSpec>,
  upgraded: Index<VersionSpec>,
): Promise<string> {
  const fileExtension = path.extname(filePath)

  if (fileExtension === '.yaml' || fileExtension === '.yml') {
    return upgradeYamlCatalogData(filePath, catalogName, current, upgraded)
  } else if (fileExtension === '.json') {
    return upgradeJsonCatalogData(filePath, catalogName, current, upgraded)
  } else {
    throw new Error(`Unsupported catalog file type: ${filePath}`)
  }
}

export default upgradeCatalogData
