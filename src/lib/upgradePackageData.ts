import fs from 'fs/promises'
import path from 'path'
import { Index } from '../types/IndexType'
import { Options } from '../types/Options'
import { PackageFile } from '../types/PackageFile'
import { VersionSpec } from '../types/VersionSpec'
import resolveDepSections from './resolveDepSections'
import upgradeCatalogData from './upgradeCatalogData'

/**
 *
 */
function escapeRegexp(s: string) {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
}

/**
 *
 */
function extractCatalogName(virtualPath: string): string | undefined {
  const match = virtualPath.match(/#catalog:([^#]+)/)
  return match ? match[1] : undefined
}

/**
 *
 */
async function upgradePackageData(
  pkgData: string,
  current: Index<VersionSpec>,
  upgraded: Index<VersionSpec>,
  options: Options,
  pkgFile?: string,
) {
  if (pkgFile) {
    const fileName = path.basename(pkgFile)
    const fileExtension = path.extname(pkgFile)

    const catalogName = extractCatalogName(pkgFile)

    if (catalogName !== undefined) {
      const actualFilePath = pkgFile.replace(/#catalog:[^#]+/, '')
      return upgradeCatalogData(actualFilePath, catalogName, current, upgraded)
    }

    if (
      fileName === 'pnpm-workspace.yaml' ||
      (fileName.includes('catalog') && (fileExtension === '.yaml' || fileExtension === '.yml'))
    ) {
      return upgradeCatalogData(pkgFile, undefined, current, upgraded)
    }

    if (fileExtension === '.json') {
      const parsed = JSON.parse(pkgData)
      const hasTopLevelCatalogs = parsed.catalog || parsed.catalogs
      const hasWorkspacesCatalogs =
        parsed.workspaces &&
        !Array.isArray(parsed.workspaces) &&
        (parsed.workspaces.catalog || parsed.workspaces.catalogs)

      if (hasTopLevelCatalogs || hasWorkspacesCatalogs) {
        return upgradeCatalogData(pkgFile, undefined, current, upgraded)
      }
    }
  }

  const depSections = [...resolveDepSections(options.dep), 'overrides']
  const sectionRegExp = new RegExp(`"(${depSections.join(`|`)})"s*:[^}]*`, 'g')
  let newPkgData = pkgData.replace(sectionRegExp, section => {
    return Object.entries(upgraded).reduce((updatedSection, [dep]) => {
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
