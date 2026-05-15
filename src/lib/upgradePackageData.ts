import fs from 'fs/promises'
import yaml from 'js-yaml'
import path from 'path'
import { Index } from '../types/IndexType'
import { Options } from '../types/Options'
import { PackageFile } from '../types/PackageFile'
import { VersionSpec } from '../types/VersionSpec'
import resolveDepSections from './resolveDepSections'
import upgradeCatalogData from './upgradeCatalogData'

/**
 * @returns String safe for use in `new RegExp()`
 */
function escapeRegexp(s: string) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&') // Thanks Stack Overflow!
}

/**
 * Upgrade the dependency declarations in the package data.
 *
 * @param pkgData The package.json data, as utf8 text
 * @param oldDependencies Old dependencies {package: range}
 * @param newDependencies New dependencies {package: range}
 * @param options Options object
 * @param pkgFile Optional path to the package file
 * @returns The updated package data, as utf8 text
 * @description Side Effect: prompts
 */
async function upgradePackageData(
  pkgData: string,
  current: Index<VersionSpec>,
  upgraded: Index<VersionSpec>,
  options: Options,
  pkgFile?: string,
) {
  // Check if this is a catalog file (pnpm-workspace.yaml or package.json with catalogs)
  if (pkgFile) {
    const fileName = path.basename(pkgFile)
    const fileExtension = path.extname(pkgFile)

    // Handle synthetic catalog files (package.json#catalog format)
    if (pkgFile.includes('#catalog')) {
      // This is a synthetic catalog file, we need to read and update the actual file
      const actualFilePath = pkgFile.replace('#catalog', '')
      const actualFileExtension = path.extname(actualFilePath)

      if (actualFileExtension === '.json') {
        // Bun format: update package.json catalogs and return the updated content
        return upgradeCatalogData(actualFilePath, current, upgraded)
      }
    }

    // Handle pnpm-workspace.yaml catalog files
    if (
      fileName === 'pnpm-workspace.yaml' ||
      (fileName.includes('catalog') && (fileExtension === '.yaml' || fileExtension === '.yml'))
    ) {
      // For synthetic catalog data (from getAllPackages), the current contains catalog:*
      // references and upgraded contains actual version specs.
      // We need to resolve the catalog:* refs in current to actual versions
      // from the pnpm-workspace.yaml file.
      if (pkgData.includes('"catalog-dependencies"') || pkgData.includes('"catalog:')) {
        const yamlContent = await fs.readFile(pkgFile, 'utf-8')
        const yamlData = yaml.load(yamlContent) as {
          catalog?: Index<string>
          catalogs?: Index<Index<string>>
        }

        // Build a map of all catalog refs to their actual versions
        const catalogRefMap: Index<string> = {}
        if (yamlData.catalog) {
          for (const [dep, spec] of Object.entries(yamlData.catalog)) {
            catalogRefMap[`catalog:${dep}`] = spec
          }
        }
        if (yamlData.catalogs) {
          for (const catalog of Object.values(yamlData.catalogs)) {
            for (const [dep, spec] of Object.entries(catalog)) {
              catalogRefMap[`catalog:${dep}`] = spec
            }
          }
        }

        // Resolve catalog refs in current to actual versions
        const resolvedCurrent: Index<VersionSpec> = {}
        for (const [dep, spec] of Object.entries(current)) {
          resolvedCurrent[dep] = catalogRefMap[spec] ?? spec
        }

        return upgradeCatalogData(pkgFile, resolvedCurrent, upgraded)
      }

      return upgradeCatalogData(pkgFile, current, upgraded)
    }

    // Handle package.json catalog files (check if content contains catalog/catalogs at root level or in workspaces)
    if (fileExtension === '.json') {
      const parsed = JSON.parse(pkgData)
      const hasTopLevelCatalogs = parsed.catalog || parsed.catalogs
      const hasWorkspacesCatalogs =
        parsed.workspaces &&
        !Array.isArray(parsed.workspaces) &&
        (parsed.workspaces.catalog || parsed.workspaces.catalogs)

      if (hasTopLevelCatalogs || hasWorkspacesCatalogs) {
        return upgradeCatalogData(pkgFile, current, upgraded)
      }
    }
  }

  // Always include overrides since any upgraded dependencies needed to be upgraded in overrides as well.
  // https://github.com/raineorshine/npm-check-updates/issues/1332
  const depSections = [...resolveDepSections(options.dep), 'overrides']

  // iterate through each dependency section
  const sectionRegExp = new RegExp(`"(${depSections.join(`|`)})"s*:[^}]*`, 'g')
  let newPkgData = pkgData.replace(sectionRegExp, section => {
    // replace each upgraded dependency in the section
    return Object.entries(upgraded).reduce((updatedSection, [dep]) => {
      // const expression = `"${dep}"\\s*:\\s*"(${escapeRegexp(current[dep])})"`
      const expression = `"${dep}"\\s*:\\s*("|{\\s*"."\\s*:\\s*")(${escapeRegexp(current[dep])})"`
      const regExp = new RegExp(expression, 'g')
      return updatedSection.replace(regExp, (match, child) => `"${dep}${child ? `": ${child}` : ': '}${upgraded[dep]}"`)
    }, section)
  })

  if (depSections.includes('packageManager')) {
    const pkg = JSON.parse(pkgData) as PackageFile
    if (pkg.packageManager) {
      const [name] = pkg.packageManager.split('@')
      if (upgraded[name]) {
        newPkgData = newPkgData.replace(
          /"packageManager"\s*:\s*".*?@[^"]*"/,
          `"packageManager": "${name}@${upgraded[name]}"`,
        )
      }
    }
  }

  return newPkgData
}

export default upgradePackageData
