import glob, { type Options as GlobOptions } from 'fast-glob'
import fs from 'fs/promises'
import yaml from 'js-yaml'
import { extend } from 'lodash'
import path from 'path'
import picomatch from 'picomatch'
import untildify from 'untildify'
import { Index } from '../types/IndexType'
import { Options } from '../types/Options'
import { PackageFile } from '../types/PackageFile'
import { PackageInfo } from '../types/PackageInfo'
import { VersionSpec } from '../types/VersionSpec'
import findPackage from './findPackage'
import loadPackageInfoFromFile from './loadPackageInfoFromFile'
import programError from './programError'
import { filterCatalogsByName, readCatalogDependencies } from './readCatalogDependencies'

type PnpmWorkspaces =
  | string[]
  | { packages: string[]; catalog?: Index<VersionSpec>; catalogs?: Index<Index<VersionSpec>> }

/**
 *
 */
function getGlobOptions(options: Options): GlobOptions {
  const ignoreDirs = typeof options.ignore === 'string' ? [options.ignore] : options.ignore || []
  return {
    ignore: ['**/node_modules/**', ...ignoreDirs],
  }
}

/**
 *
 */
const readPnpmWorkspaces = async (pkgPath: string): Promise<PnpmWorkspaces | null> => {
  const pnpmWorkspacesPath = path.join(path.dirname(pkgPath), 'pnpm-workspace.yaml')
  let pnpmWorkspaceFile: string
  try {
    pnpmWorkspaceFile = await fs.readFile(pnpmWorkspacesPath, 'utf-8')
  } catch {
    return null
  }
  return yaml.load(pnpmWorkspaceFile) as PnpmWorkspaces
}

/**
 *
 */
async function getWorkspacePackageInfos(
  options: Options,
  defaultPackageFilename: string,
  rootPackageFile: string,
  cwd: string,
): Promise<[PackageInfo[], string[]]> {
  const { pkgData, pkgPath } = await findPackage({ ...options, packageFile: rootPackageFile, loglevel: 'silent' })
  const rootPkg: PackageFile = typeof pkgData === 'string' ? JSON.parse(pkgData) : pkgData

  const workspacesObject = rootPkg.workspaces || (await readPnpmWorkspaces(pkgPath || ''))
  const workspaces = Array.isArray(workspacesObject) ? workspacesObject : workspacesObject?.packages

  if (!workspaces) {
    programError(
      options,
      `workspaces property missing from package.json. --workspace${
        options.workspaces ? 's' : ''
      } only works when you specify a "workspaces" property in your package.json.`,
    )
  }

  const workspacePackageGlob: string[] = (workspaces || []).map(workspace =>
    path.join(cwd, workspace, 'package.json').replace(/\\/g, '/'),
  )
  const globOptions = getGlobOptions(options)
  const allWorkspacePackageFilepaths: string[] = glob.sync(workspacePackageGlob, globOptions)

  const allWorkspacePackageInfos: PackageInfo[] = await Promise.all(
    allWorkspacePackageFilepaths.map(async (filepath: string): Promise<PackageInfo> => {
      const info: PackageInfo = await loadPackageInfoFromFile(options, filepath)
      info.name = info.pkg.name || filepath.split('/').slice(-2)[0]
      return info
    }),
  )

  const allWorkspacePackageNames: string[] = allWorkspacePackageInfos.map(
    (packageInfo: PackageInfo): string => packageInfo.name || '',
  )

  const filterWorkspaces = options.workspaces !== true
  if (!filterWorkspaces) {
    return [allWorkspacePackageInfos, allWorkspacePackageNames]
  }

  const selectedWorkspacePackageInfos: PackageInfo[] = allWorkspacePackageInfos.filter((packageInfo: PackageInfo) =>
    options.workspace?.some((workspace: string) =>
      workspaces?.some(
        (workspacePattern: string) =>
          packageInfo.name === workspace ||
          packageInfo.filepath ===
            path.join(cwd, path.dirname(workspacePattern), workspace, defaultPackageFilename).replace(/\\/g, '/'),
      ),
    ),
  )
  return [selectedWorkspacePackageInfos, allWorkspacePackageNames]
}

/**
 *
 */
async function getCatalogPackageInfos(options: Options, pkgPath: string): Promise<PackageInfo[]> {
  if (!pkgPath) {
    return []
  }

  if (options.catalogs === false) {
    return []
  }

  const allCatalogs = await readCatalogDependencies(options, pkgPath)
  if (Object.keys(allCatalogs).length === 0) {
    return []
  }

  const filteredCatalogs = filterCatalogsByName(allCatalogs, options.catalog)
  const catalogInfos: PackageInfo[] = []

  for (const [catalogName, dependencies] of Object.entries(filteredCatalogs)) {
    const catalogPackageFile: PackageFile = {
      name: `catalog:${catalogName}`,
      version: '1.0.0',
      dependencies,
    }

    const catalogFilePath =
      options.packageManager === 'pnpm'
        ? `${path.join(path.dirname(pkgPath), 'pnpm-workspace.yaml')}#catalog:${catalogName}`
        : `${pkgPath}#catalog:${catalogName}`

    const syntheticFileContent = JSON.stringify(catalogPackageFile, null, 2)

    catalogInfos.push({
      filepath: catalogFilePath,
      pkg: catalogPackageFile,
      pkgFile: syntheticFileContent,
      name: `catalog:${catalogName}`,
      catalogName,
    })
  }

  return catalogInfos
}

/**
 *
 */
async function getAllPackages(options: Options): Promise<[PackageInfo[], string[]]> {
  const defaultPackageFilename = options.packageFile || 'package.json'
  const cwd = options.cwd ? untildify(options.cwd) : './'
  const rootPackageFile = options.packageFile || (options.cwd ? path.join(cwd, 'package.json') : 'package.json')

  const useWorkspaces: boolean =
    options.workspaces === true || (options.workspace !== undefined && options.workspace.length !== 0)

  let packageInfos: PackageInfo[] = []

  const getBasePackageFile: boolean = !useWorkspaces || options.root === true
  if (getBasePackageFile) {
    const globPattern = rootPackageFile.replace(/\\/g, '/')
    const globOptions = getGlobOptions(options)
    const rootPackagePaths = glob.sync(globPattern, globOptions)
    const rootPackages = await Promise.all(
      rootPackagePaths.map(
        async (packagePath: string): Promise<PackageInfo> => await loadPackageInfoFromFile(options, packagePath),
      ),
    )
    packageInfos = [...packageInfos, ...rootPackages]
  }

  if (!useWorkspaces) {
    return [packageInfos, []]
  }

  const { pkgPath: workspacePkgPath } = await findPackage({
    ...options,
    packageFile: rootPackageFile,
    loglevel: 'silent',
  })

  const [workspacePackageInfos, workspaceNames]: [PackageInfo[], string[]] = await getWorkspacePackageInfos(
    options,
    defaultPackageFilename,
    rootPackageFile,
    cwd,
  )

  packageInfos = [...packageInfos, ...workspacePackageInfos]

  if (workspacePkgPath) {
    const catalogInfos = await getCatalogPackageInfos(options, workspacePkgPath)
    if (catalogInfos.length > 0) {
      packageInfos = [...packageInfos, ...catalogInfos]
    }
  }

  if (options.ignore) {
    const ignoreDirs = Array.isArray(options.ignore) ? options.ignore : [options.ignore]

    packageInfos = packageInfos.filter(packageInfo => {
      const relativePath = path.relative(cwd, packageInfo.filepath).replace(/\\/g, '/')
      const dirPath = path.dirname(relativePath).replace(/\\/g, '/')

      return !ignoreDirs.some(ignorePattern => {
        const isMatch = picomatch(ignorePattern)
        return isMatch(relativePath) || isMatch(dirPath) || isMatch(`${dirPath}/`)
      })
    })
  }

  return [packageInfos, workspaceNames]
}

export default getAllPackages
