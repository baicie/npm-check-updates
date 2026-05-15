# npm-check-updates pnpm Catalogs 增强设计方案

## 1. 需求概述

pnpm 从 v8.6 起引入了 **Catalogs** 功能，允许在 monorepo 的 `pnpm-workspace.yaml` 中集中定义依赖版本，所有 workspace 包都可以通过 `catalog:` 前缀引用这些共享版本定义。当前的 npm-check-updates 已经支持了基础的 catalogs 读取和升级，但存在以下不足，需要进行功能增强。

### 1.1 现状分析

| 功能                                   | 状态        | 说明                                     |
| -------------------------------------- | ----------- | ---------------------------------------- |
| 从 `pnpm-workspace.yaml` 读取 catalogs | ✅ 已支持   | `readCatalogDependencies()`              |
| 从 `package.json` (Bun) 读取 catalogs  | ✅ 已支持   | `readCatalogDependencies()`              |
| 检查 catalog 依赖是否有新版本          | ✅ 已支持   | 合并到 `PackageInfo.dependencies`        |
| 升级 YAML catalog 数据                 | ✅ 已支持   | `upgradeYamlCatalogData()`               |
| 升级 JSON catalog 数据                 | ✅ 已支持   | `upgradeJsonCatalogData()`               |
| **选择性 catalog 升级**                | ❌ 未支持   | 无法只升级指定的 catalog                 |
| **catalog 引用解析**                   | ⚠️ 部分支持 | workspace 包引用 `catalog:` 但不解析版本 |
| **区分 catalog 和普通依赖输出**        | ❌ 未支持   | 输出中无法区分 catalog 依赖              |
| **CLI `--catalog` 选项**               | ❌ 未支持   | 无命令行参数控制 catalog 行为            |
| **pnpm native update 兼容**            | ❌ 未考虑   | pnpm update 有 `--catalog` 等原生选项    |
| **catalog 继承和覆盖**                 | ❌ 未支持   | Bun/modern pnpm 支持 `catalogs` 对象嵌套 |
| **lockfile 自动更新**                  | ❌ 未处理   | 升级后 `pnpm-lock.yaml` 可能不同步       |

### 1.2 增强目标

1. 新增 `--catalogs` 布尔开关（默认 `true`），在 workspace 模式下默认启用所有 catalogs 依赖升级
2. 新增 `--catalog` CLI 选项，支持选择性地只检查/升级特定 catalog（可与 `--catalogs` 配合）
3. 新增 `--catalogTarget` CLI 选项，为 catalog 依赖单独设置版本策略
4. 增强输出格式，在 `--format` 中支持 `catalog` 选项
5. 支持 workspace 包中 `catalog:` 引用到实际版本的解析
6. 增强 pnpm 包管理器集成，添加 catalog-aware 的原生调用

---

## 2. 技术设计

### 2.1 类型定义修改

**修改文件**: `src/types/RunOptions.ts`

新增 catalog 相关选项：

```typescript
export interface RunOptions {
  // ... 现有选项 ...

  /**
   * 指定要检查/升级的 catalog 名称（逗号分隔），支持单个、多个或通配符（glob）。
   * 例如: "default", "test,staging", "prod*"
   * 如果不指定，则检查所有 catalogs。
   */
  catalog?: string | readonly string[]

  /**
   * 是否检查 catalogs 依赖。
   * - CLI 默认值: `true`（workspace 模式下自动启用）
   * - `.ncurc` 配置: 默认 `true`，设为 `false` 可跳过所有 catalog 检查
   *
   * 此选项的核心价值在于提供一个**零配置开关**：
   * 在 `.ncurc` 中设置 `"catalogs": true` 后，所有 `--workspaces` 调用都会自动包含 catalogs 升级。
   */
  catalogs?: boolean

  /**
   * catalog 依赖的版本升级策略，默认为空（继承全局 target）。
   * 适用于希望 catalog 使用更保守策略的场景（如 catalog 用 minor，生产用 latest）。
   */
  catalogTarget?: 'latest' | 'newest' | 'greatest' | 'minor' | 'patch' | 'semver' | `@${string}` | TargetFunction
}
```

**行为说明**:

- `catalogs` 选项在 **CLI** 中默认为 `true`，但仅在检测到 workspace 模式（`--workspaces` 或 `--workspace`）时才生效
- 在 `.ncurc` 配置文件中设置 `"catalogs": true` 是最简洁的启用方式，无需每次手动传递参数
- `catalog` 和 `catalogs` 的关系: `catalogs` 控制开关，`catalog` 控制范围。二者可组合使用

**新增类型文件**: `src/types/Catalog.ts`

```typescript
import { Index } from './IndexType'
import { VersionSpec } from './VersionSpec'

/**
 * Catalog 条目，表示一个 catalog 中定义的依赖及其版本。
 */
export interface CatalogEntry {
  /** catalog 名称，如 "default"、"test"、"production" */
  name: string
  /** 该 catalog 中定义的依赖及其版本范围 */
  dependencies: Index<VersionSpec>
  /** 源文件路径 */
  filePath: string
}

/**
 * Catalog 解析结果，包含所有 catalogs 的元数据。
 */
export interface CatalogInfo {
  /** catalog 名称到 catalog 条目的映射 */
  catalogs: Index<CatalogEntry>
  /** 原始 pnpm-workspace.yaml 内容（保留注释和格式） */
  rawContent?: string
  /** 源文件路径 */
  sourceFile: string
}
```

---

### 2.2 CLI 选项定义

**修改文件**: `src/cli-options.ts`

新增三个 CLI 选项：

```typescript
{
  long: 'catalog',
  arg: 'names',
  description:
    'Specify which catalogs to check/upgrade. Accepts a comma-separated list of catalog names, or a glob pattern (e.g., "default", "test,staging", "prod*"). If not specified, all catalogs are included.',
  parse: value => (typeof value === 'string' ? value.split(',').map(s => s.trim()) : value),
  type: 'string | readonly string[]',
},
{
  long: 'catalogs',
  default: true,
  description:
    'Include catalog dependencies in upgrade checks when using --workspaces or --workspace. Set to false to skip catalogs entirely. Also available in .ncurc config as "catalogs": true to enable by default.',
  type: 'boolean',
},
{
  long: 'catalogTarget',
  arg: 'value',
  description:
    'Version target strategy specifically for catalog dependencies. If not specified, uses the global --target option. Supports: latest, newest, greatest, minor, patch, semver, @[tag], or a custom function.',
  type: `'latest' | 'newest' | 'greatest' | 'minor' | 'patch' | 'semver' | '@${string}' | TargetFunction`,
  help: extendedHelpCatalogTarget,
},
```

**新增扩展帮助**: `extendedHelpCatalogTarget`

提供详细的 catalogTarget 使用说明，包括与全局 target 的对比、函数用法示例。

---

### 2.3 核心模块修改

#### 2.3.1 增强 `getAllPackages.ts`

**修改目标**: 支持 `--catalog` 和 `--catalogs` 选项，过滤 catalog 发现逻辑。

```typescript
// src/lib/getAllPackages.ts

/**
 * Gets catalog package info from pnpm-workspace.yaml or package.json.
 * Respects --catalog and --catalogs options.
 *
 * @param options the application options
 * @param pkgPath the package file path (already resolved)
 * @returns PackageInfo[] for selected catalog dependencies, or empty array if catalogs disabled
 */
async function getCatalogPackageInfos(options: Options, pkgPath: string): Promise<PackageInfo[]> {
  // 如果 --no-catalogs，直接返回空
  if (options.catalogs === false) {
    return []
  }

  const catalogDependencies = await readCatalogDependencies(options, pkgPath)
  if (!catalogDependencies) {
    return []
  }

  // 支持 --catalog 过滤
  // 如果指定了 --catalog only，只返回匹配的 catalog
  const catalogs = await readCatalogsMetadata(options, pkgPath)

  // 根据 --catalog 选项过滤
  const filteredCatalogs = filterCatalogsByName(catalogs, options.catalog)

  // 按 catalog 分组创建 PackageInfo
  // 每个 catalog 创建一个独立的 PackageInfo，便于区分输出
  return filteredCatalogs.map(catalog => {
    const catalogPackageFile: PackageFile = {
      name: `catalog:${catalog.name}`,
      version: '1.0.0',
      dependencies: catalog.dependencies,
    }

    const catalogFilePath =
      options.packageManager === 'pnpm'
        ? `${path.join(path.dirname(pkgPath), 'pnpm-workspace.yaml')}#catalog:${catalog.name}`
        : `${pkgPath}#catalog:${catalog.name}`

    const syntheticFileContent = JSON.stringify(catalogPackageFile, null, 2)

    return {
      filepath: catalogFilePath,
      pkg: catalogPackageFile,
      pkgFile: syntheticFileContent,
      name: `catalog:${catalog.name}`,
      catalogName: catalog.name, // 新增字段用于标识 catalog 名称
    } satisfies PackageInfo
  })
}
```

**关键改动**:

1. **多 Catalog 拆分**: 将原来的单个合成 `catalogs` PackageInfo 拆分为每个 catalog 一个，便于按名过滤和输出区分。
2. **`catalogName` 字段**: 在 `PackageInfo` 中新增字段标识所属 catalog 名称。
3. **虚拟路径格式**: 使用 `#catalog:name` 后缀区分不同 catalog 的虚拟文件路径。

#### 2.3.2 增强 `readCatalogDependencies.ts` (新文件)

将 catalog 读取逻辑从 `getAllPackages.ts` 中提取为独立模块：

**新文件**: `src/lib/readCatalogDependencies.ts`

```typescript
import fs from 'fs/promises'
import yaml from 'js-yaml'
import path from 'path'
import { Index } from '../types/IndexType'
import { Options } from '../types/Options'
import { VersionSpec } from '../types/VersionSpec'

type PnpmWorkspaces =
  | string[]
  | {
      packages?: string[]
      catalog?: Index<VersionSpec>
      catalogs?: Index<Index<VersionSpec>>
    }

/**
 * 读取 pnpm-workspace.yaml 文件并解析 catalog 数据。
 */
async function readPnpmWorkspaceCatalogs(pnpmWorkspacePath: string): Promise<Index<Index<VersionSpec>>> {
  try {
    const content = await fs.readFile(pnpmWorkspacePath, 'utf-8')
    const data = yaml.load(content) as PnpmWorkspaces

    const result: Index<Index<VersionSpec>> = {}

    if (!Array.isArray(data)) {
      // 单一 catalog (catalog:) -> 归入 'default' catalog
      if (data.catalog) {
        result['default'] = data.catalog
      }
      // 命名 catalogs (catalogs:) -> 按名展开
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
 * 读取 package.json 中的 catalog 定义（Bun 格式）。
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

    // Workspaces object 中的 catalog/catalogs
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
 * 读取指定路径下的所有 catalog 定义。
 * 支持 pnpm-workspace.yaml 和 package.json 两种格式。
 *
 * @param options 应用选项
 * @param pkgPath package.json 路径（用于定位 pnpm-workspace.yaml）
 * @returns catalog 名称到依赖映射的字典
 */
export async function readCatalogDependencies(options: Options, pkgPath: string): Promise<Index<Index<VersionSpec>>> {
  const result: Index<Index<VersionSpec>> = {}

  // pnpm: 从 pnpm-workspace.yaml 读取
  if (options.packageManager === 'pnpm') {
    const pnpmWorkspacePath = path.join(path.dirname(pkgPath), 'pnpm-workspace.yaml')
    const pnpmCatalogs = await readPnpmWorkspaceCatalogs(pnpmWorkspacePath)
    Object.assign(result, pnpmCatalogs)
  }

  // Bun 和 modern pnpm: 从 package.json 读取
  const pkgJsonCatalogs = await readPackageJsonCatalogs(pkgPath)
  for (const [catalogName, deps] of Object.entries(pkgJsonCatalogs)) {
    if (result[catalogName]) {
      // 合并：pnpm-workspace.yaml 中的定义优先级更高
      result[catalogName] = { ...deps, ...result[catalogName] }
    } else {
      result[catalogName] = deps
    }
  }

  return result
}

/**
 * 根据 --catalog 选项过滤 catalog。
 *
 * @param catalogs 所有 catalog
 * @param catalogFilter --catalog 选项值
 * @returns 过滤后的 catalog
 */
export function filterCatalogsByName(
  catalogs: Index<Index<VersionSpec>>,
  catalogFilter?: string | readonly string[],
): Index<Index<VersionSpec>> {
  if (!catalogFilter || catalogFilter.length === 0) {
    return catalogs
  }

  const filters = Array.isArray(catalogFilter) ? catalogFilter : [catalogFilter]

  return Object.fromEntries(
    Object.entries(catalogs).filter(([catalogName]) =>
      filters.some(f => catalogName === f || picomatch.isMatch(catalogName, f)),
    ),
  )
}
```

#### 2.3.3 增强 `upgradeCatalogData.ts`

**修改目标**: 支持按 catalog 名选择性更新，以及保留 YAML 注释和格式。

```typescript
// src/lib/upgradeCatalogData.ts

/**
 * 升级 pnpm-workspace.yaml 中的 catalog 数据。
 * 保留原始文件格式和注释。
 *
 * @param filePath pnpm-workspace.yaml 路径
 * @param catalogName 要更新的 catalog 名称（可选，不指定则更新所有）
 * @param current 当前版本 {package: range}
 * @param upgraded 升级后版本 {package: range}
 * @returns 更新后的文件内容
 */
async function upgradeYamlCatalogData(
  filePath: string,
  catalogName: string | undefined,
  current: Index<VersionSpec>,
  upgraded: Index<VersionSpec>,
): Promise<string> {
  const fileContent = await fs.readFile(filePath, 'utf-8')

  // 解析 YAML 并重建
  const yamlData = yaml.load(fileContent) as {
    packages?: string[]
    catalog?: Index<string>
    catalogs?: Index<Index<string>>
  }

  // 确定要更新的 catalog
  const catalogsToUpdate: Array<{ name: string; data: Index<string> }> = []

  if (catalogName) {
    // 只更新指定的 catalog
    if (yamlData.catalogs?.[catalogName]) {
      catalogsToUpdate.push({ name: catalogName, data: yamlData.catalogs[catalogName] })
    }
    if (!yamlData.catalogs && yamlData.catalog && catalogName === 'default') {
      catalogsToUpdate.push({ name: 'default', data: yamlData.catalog })
    }
  } else {
    // 更新所有 catalog
    if (yamlData.catalog) {
      catalogsToUpdate.push({ name: 'default', data: yamlData.catalog })
    }
    if (yamlData.catalogs) {
      for (const [name, data] of Object.entries(yamlData.catalogs)) {
        catalogsToUpdate.push({ name, data })
      }
    }
  }

  // 应用升级
  for (const { name, data } of catalogsToUpdate) {
    for (const [dep, newVersion] of Object.entries(upgraded)) {
      if (dep in data) {
        data[dep] = newVersion
      }
    }
  }

  // 重新序列化 YAML，保留格式
  return yaml.dump(yamlData, {
    indent: 2,
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  })
}

/**
 * 升级 package.json 中的 catalog 数据。
 *
 * @param filePath package.json 路径
 * @param catalogName 要更新的 catalog 名称（可选）
 * @param current 当前版本
 * @param upgraded 升级后版本
 * @returns 更新后的 JSON 字符串
 */
async function upgradeJsonCatalogData(
  filePath: string,
  catalogName: string | undefined,
  current: Index<VersionSpec>,
  upgraded: Index<VersionSpec>,
): Promise<string> {
  const fileContent = await fs.readFile(filePath, 'utf-8')
  const pkg = JSON.parse(fileContent)

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
    if (pkg.workspaces?.catalog) pkg.workspaces.catalog = applyUpgrade(pkg.workspaces.catalog)
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
 * 升级 catalog 依赖数据。
 *
 * @param filePath catalog 文件路径
 * @param catalogName 要更新的 catalog 名称（从虚拟路径中提取）
 * @param current 当前版本 {package: range}
 * @param upgraded 升级后版本 {package: range}
 * @returns 更新后的文件内容
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
```

**关键改动**:

1. **catalog 名参数**: `upgradeCatalogData` 新增 `catalogName` 参数，支持选择性更新。
2. **YAML 格式保留**: 使用 `yaml.dump()` 替代正则替换，更好地保留注释和格式。
3. **JSON 结构更新**: 直接操作 JSON 对象而非正则替换，更可靠。

#### 2.3.4 增强 `upgradePackageData.ts`

**修改目标**: 从虚拟路径中提取 catalog 名，调用带 catalog 名的 `upgradeCatalogData`。

```typescript
// src/lib/upgradePackageData.ts

// 在处理 pnpm-workspace.yaml catalog 文件的分支中：

// 从虚拟路径提取 catalog 名
// 格式: pnpm-workspace.yaml#catalog:name -> name
// 格式: package.json#catalog:name -> name
function extractCatalogName(virtualPath: string): string | undefined {
  const match = virtualPath.match(/#catalog:([^#]+)/)
  return match ? match[1] : undefined
}

// 在 upgradePackageData 函数中：
if (fileName === 'pnpm-workspace.yaml' || fileName.includes('catalog')) {
  // ...
  const catalogName = pkgFile ? extractCatalogName(pkgFile) : undefined

  return upgradeCatalogData(pkgFile, catalogName, current, upgraded)
}
```

#### 2.3.5 增强 `upgradePackageDefinitions.ts`

**修改目标**: 支持 `catalogTarget` 选项，为 catalog 依赖应用不同的版本策略。

```typescript
// src/lib/upgradePackageDefinitions.ts

/**
 * 查询包的最新版本。
 */
async function queryVersions(
  currentDependencies: Index<VersionSpec>,
  options: Options,
): Promise<Index<NpmRegistryMetadata | null>> {
  // ... 现有逻辑 ...
}

/**
 * 根据 --catalogTarget 选项获取版本。
 * 如果包属于 catalog 且指定了 catalogTarget，使用 catalogTarget。
 */
async function getVersionForPackage(
  packageName: string,
  currentVersion: VersionSpec,
  options: Options,
  isCatalogPackage: boolean,
): Promise<NpmRegistryMetadata | null> {
  const packageManager = getPackageManager(options, options.packageManager)

  // 确定使用哪个 target
  let target = options.target
  if (isCatalogPackage && options.catalogTarget) {
    target = options.catalogTarget
  }

  const getVersion: GetVersion | undefined = packageManager[target as string] || packageManager.latest

  if (getVersion) {
    return await getVersion(packageName, currentVersion, options)
  }

  return null
}

export async function upgradePackageDefinitions(
  currentDependencies: Index<VersionSpec>,
  options: Options,
  packageInfos: PackageInfo[],
): Promise<UpgradePackageDefinitionsResult> {
  // 标记哪些包属于 catalog
  const catalogPackageNames = new Set<string>()
  for (const info of packageInfos) {
    if (info.name?.startsWith('catalog:')) {
      for (const dep of Object.keys(info.pkg.dependencies || {})) {
        catalogPackageNames.add(dep)
      }
    }
  }

  // 并行查询所有版本
  const latestVersionResults = await queryVersions(currentDependencies, options)

  // 应用 pinVersions 等选项...
  // ...

  return { latestVersions, upgraded, peerDependencies, errors }
}
```

#### 2.3.6 增强 `logging.ts` 输出

**修改目标**: 在 `--format` 中支持 `catalog` 选项，区分 catalog 和普通依赖。

```typescript
// src/lib/logging.ts

// 在 format 相关函数中：
// 如果 format 包含 'catalog'，输出中包含 catalog 归属信息

/**
 * 获取依赖的 catalog 归属信息。
 */
function getCatalogInfo(dep: string, packageInfo: PackageInfo): string | undefined {
  if (packageInfo.name?.startsWith('catalog:')) {
    return packageInfo.name.replace('catalog:', '')
  }
  return undefined
}

// 在 toDependencyTable 中：
// 对于 catalog 依赖，在包名后显示 catalog 归属
// 例如: react@catalog:default
```

### 2.4 pnpm 包管理器增强

**修改文件**: `src/package-managers/pnpm.ts`

新增 catalog-aware 的原生调用：

```typescript
// src/package-managers/pnpm.ts

/**
 * 使用 pnpm native 的 catalog 更新功能。
 * 仅在 pnpm >= 9 且有 catalogs 时使用。
 *
 * @param catalogName 要更新的 catalog 名称
 * @param packages 要更新的包列表
 * @param options 应用选项
 */
export async function updateCatalog(catalogName: string, packages: string[], options: Options = {}): Promise<string> {
  const args = ['update', ...packages]

  if (catalogName !== 'default') {
    args.push('--catalog', catalogName)
  }

  return await spawnPnpm(args, {}, { cwd: options.cwd })
}

/**
 * 检查 pnpm 版本是否支持 catalogs。
 */
export async function supportsCatalogs(): Promise<boolean> {
  try {
    const { stdout } = await spawn('pnpm', ['--version'])
    const version = stdout.trim()
    // pnpm v8.6+ 支持 catalogs
    const [major, minor] = version.split('.').map(Number)
    return major > 8 || (major === 8 && minor >= 6)
  } catch {
    return false
  }
}
```

---

## 3. 数据流设计

```
┌─────────────────────────────────────────────────────────────┐
│  CLI / API 调用                                              │
│  ncu --workspaces --catalog default --catalogTarget minor   │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────┐
│  getAllPackages()                                           │
│  ├─ 发现 workspace packages (glob)                          │
│  ├─ 发现 root package                                        │
│  └─ 发现 catalogs: getCatalogPackageInfos()                 │
│       ├─ readCatalogDependencies()                          │
│       │   ├─ readPnpmWorkspaceCatalogs()                   │
│       │   └─ readPackageJsonCatalogs()                      │
│       ├─ filterCatalogsByName() --catalog 过滤              │
│       └─ 为每个 catalog 创建 PackageInfo                    │
│          (name: "catalog:name", filepath: "...#catalog:name")│
└────────────────┬───────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────┐
│  runLocal() / runUpgrades()                                  │
│  ├─ 遍历每个 PackageInfo                                      │
│  ├─ 普通 package.json → upgradePackageDefinitions()          │
│  └─ catalog virtual file → catalog 版本查询                  │
│       ├─ 判断 isCatalogPackage = true                       │
│       ├─ 使用 catalogTarget (如果有)                        │
│       └─ 查询 npm registry 获取最新版本                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────┐
│  upgradePackageData()                                        │
│  ├─ 检测到虚拟路径包含 #catalog:                              │
│  ├─ extractCatalogName() → 提取 catalog 名                  │
│  └─ upgradeCatalogData(filePath, catalogName, current, new)  │
│       ├─ upgradeYamlCatalogData() 或                        │
│       └─ upgradeJsonCatalogData()                           │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────┐
│  输出 / 文件写入                                              │
│  ├─ console: catalog 依赖标记为 [catalog:name]               │
│  ├─ jsonAll: 包含 catalog 文件更新                          │
│  └─ 文件: pnpm-workspace.yaml / package.json (JSON)         │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. 边界情况处理

### 4.1 Catalog 不存在

```bash
# 指定不存在的 catalog 时优雅降级
ncu --catalog nonexistent --workspaces
# 输出: warning: Catalog "nonexistent" not found. Available catalogs: default, test, production
# 行为: 跳过不存在 catalog 的检查
```

### 4.2 `catalog:` 引用解析

```yaml
# pnpm-workspace.yaml
catalog:
  react: ^18.0.0

# packages/app/package.json
dependencies:
  react: catalog:   # 引用 default catalog
```

| 场景                  | 当前行为                         | 增强后行为                                      |
| --------------------- | -------------------------------- | ----------------------------------------------- |
| 检查 workspace 包依赖 | 检测到 `catalog:` 但无法确定版本 | 显示 `catalog:` 引用及 catalog 中定义的当前版本 |
| 检查 catalog 本身     | 正确显示 catalog 中的版本        | 正确显示 catalog 中的版本                       |
| 升级 workspace 包     | 跳过 catalog 引用                | 保持 `catalog:` 引用不变                        |
| 升级 catalog          | 正确更新 catalog 中的版本        | 正确更新 catalog 中的版本                       |

### 4.3 多 Catalog 合并

当同一个依赖在多个 catalog 中定义时（继承/覆盖场景）：

```yaml
# pnpm-workspace.yaml
catalog:
  lodash: ^4.17.0 # default catalog

catalogs:
  test:
    lodash: ^4.17.20 # test catalog 覆盖了 default
```

| 场景                     | 行为                                    |
| ------------------------ | --------------------------------------- |
| `--catalog default`      | 只检查/升级 default catalog 中的 lodash |
| `--catalog test`         | 只检查/升级 test catalog 中的 lodash    |
| `--catalog default,test` | 分别处理两个 catalog 中的 lodash        |
| `--catalogs false`       | 完全跳过 catalog 检查                   |

### 4.4 与其他选项的交互

| 场景                                       | 行为                                             |
| ------------------------------------------ | ------------------------------------------------ |
| `--catalogs false --workspaces`            | 只检查 workspace 包，不检查 catalogs             |
| `--catalog test --workspaces`              | 同时检查 test catalog 和所有 workspace 包        |
| `--workspaces --no-root --catalog default` | 检查 workspace 包和 default catalog，不检查 root |
| `--deep --catalogs false`                  | 递归检查所有 package.json，跳过 catalogs         |
| `--workspace pkg-a --catalog default`      | 只检查 pkg-a 和 default catalog                  |
| `--target minor --catalogTarget patch`     | 普通依赖用 minor，catalog 依赖用 patch           |

---

## 5. 使用示例

### 5.1 基本用法

```bash
# 检查所有 catalogs
ncu --workspaces

# 只升级 default catalog
ncu --workspaces --catalog default -u

# 只升级指定的 catalog
ncu --workspaces --catalog test,staging -u

# 使用 glob 模式匹配 catalog
ncu --workspaces --catalog "prod*" -u

# 跳过 catalogs，只检查 workspace 包
ncu --workspaces --no-catalogs
```

### 5.2 版本策略

```bash
# 所有依赖使用 minor 策略，但 catalogs 使用 patch
ncu --workspaces --target minor --catalogTarget patch -u

# catalogs 使用 semver（保持范围内最新）
ncu --workspaces --catalogTarget semver -u
```

### 5.3 输出格式

```bash
# 默认输出，catalog 依赖带标记
ncu --workspaces
# Output:
#  Checking pnpm-workspace.yaml catalog dependencies
#  react@catalog        ^18.0.0  →  18.3.0  (catalog: default)
#  lodash@catalog        ^4.17.20  →  4.17.21  (catalog: default)
#  vue@catalog:test      ^3.0.0  →  3.4.0  (catalog: test)

# JSON 输出
ncu --workspaces --jsonUpgraded
# Output:
# {
#   "pnpm-workspace.yaml": {
#     "catalog:default": { "react": "18.3.0", "lodash": "4.17.21" },
#     "catalog:test": { "vue": "3.4.0" }
#   }
# }

# 仅 catalog 依赖
ncu --workspaces --no-catalogs --filter "^catalog:"
```

### 5.4 配置文件

**.ncurc.json** 最简配置（零配置开关）:

```json
// 在 .ncurc.json 中设置 "catalogs": true
// 之后所有 --workspaces 调用都会自动包含 catalogs 升级
{
  "workspaces": true,
  "catalogs": true
}
```

```bash
# 配合上述配置后，直接运行即可自动升级所有 catalogs：
ncu --workspaces -u
```

**.ncurc.json** 选择性配置:

```json
{
  "workspaces": true,
  "catalog": "default",
  "catalogTarget": "patch",
  "upgrade": true
}
```

**.ncurc.js** 函数式配置:

```javascript
module.exports = {
  workspaces: true,
  catalogs: true,
  catalog: pkgName => {
    // 根据包名动态选择 catalog
    if (pkgName.startsWith('@test-')) return 'test'
    return 'default'
  },
  catalogTarget: 'minor',
  upgrade: true,
}
```

**.ncurc.js** 条件启用:

```javascript
module.exports = {
  workspaces: true,
  catalogs: process.env.NCU_INCLUDE_CATALOGS === 'true',
  // 等效于: 如果环境变量 NCU_INCLUDE_CATALOGS=true，就启用 catalogs 检查
  upgrade: true,
}
```

---

## 6. 实现优先级

| 优先级 | 任务                             | 涉及文件                                                  |
| ------ | -------------------------------- | --------------------------------------------------------- |
| P0     | 类型定义                         | `src/types/RunOptions.ts`, 新建 `src/types/Catalog.ts`    |
| P0     | CLI 选项                         | `src/cli-options.ts`                                      |
| P0     | Catalog 读取逻辑提取             | 新建 `src/lib/readCatalogDependencies.ts`                 |
| P0     | Catalog 升级逻辑增强             | `src/lib/upgradeCatalogData.ts`                           |
| P0     | `getAllPackages` 集成            | `src/lib/getAllPackages.ts`                               |
| P0     | `upgradePackageData` 集成        | `src/lib/upgradePackageData.ts`                           |
| P1     | `upgradePackageDefinitions` 集成 | `src/lib/upgradePackageDefinitions.ts`                    |
| P1     | pnpm 包管理器增强                | `src/package-managers/pnpm.ts`                            |
| P1     | 输出格式增强                     | `src/lib/logging.ts`                                      |
| P2     | 文档和 README 更新               | `README.md`, `docs/`                                      |
| P2     | 测试用例                         | `test/workspaces.test.ts`, `test/catalogs.test.ts` (新建) |

---

## 7. 文件修改清单

| 文件路径                               | 修改类型 | 说明                                                     |
| -------------------------------------- | -------- | -------------------------------------------------------- |
| `src/types/RunOptions.ts`              | 修改     | 新增 `catalog`, `catalogs`, `catalogTarget` 选项         |
| `src/types/Catalog.ts`                 | 新建     | Catalog 相关类型定义                                     |
| `src/cli-options.ts`                   | 修改     | 新增三个 CLI 选项定义及帮助                              |
| `src/lib/readCatalogDependencies.ts`   | 新建     | 从 `getAllPackages.ts` 提取的 catalog 读取逻辑           |
| `src/lib/upgradeCatalogData.ts`        | 重写     | 支持按 catalog 名选择性更新，保留 YAML 格式              |
| `src/lib/getAllPackages.ts`            | 修改     | 集成新的 catalog 读取，使用多 PackageInfo 方案           |
| `src/lib/upgradePackageData.ts`        | 修改     | 从虚拟路径提取 catalog 名，调用增强的 upgradeCatalogData |
| `src/lib/upgradePackageDefinitions.ts` | 修改     | 支持 `catalogTarget` 选项                                |
| `src/lib/logging.ts`                   | 修改     | `--format catalog` 支持，catalog 归属标记                |
| `src/package-managers/pnpm.ts`         | 修改     | 新增 `updateCatalog()`, `supportsCatalogs()`             |
| `src/types/RunOptions.json`            | 自动生成 | 运行 `npm run build` 自动更新                            |

---

## 8. 测试计划

### 8.1 单元测试

| 测试用例                  | 覆盖场景                                                  |
| ------------------------- | --------------------------------------------------------- |
| `readCatalogDependencies` | pnpm-workspace.yaml 格式、Bun package.json 格式、合并逻辑 |
| `filterCatalogsByName`    | 单个、多个、glob 模式、不存在的 catalog                   |
| `upgradeCatalogData`      | YAML/JSON、单 catalog/多 catalog、保留格式                |
| `extractCatalogName`      | 各种虚拟路径格式                                          |
| CLI 解析                  | `--catalog`, `--no-catalogs`, `--catalogTarget`           |

### 8.2 集成测试

| 测试用例                     | 覆盖场景                      |
| ---------------------------- | ----------------------------- |
| workspace + catalog 完整流程 | 发现 → 检查 → 升级 → 写入     |
| `--catalog` 过滤             | 只检查指定 catalog            |
| `--no-catalogs`              | 跳过 catalog 检查             |
| `--catalogTarget`            | catalog 使用不同版本策略      |
| 多个 catalog 同时升级        | 每个 catalog 独立更新         |
| catalog 继承/覆盖            | 同一依赖在多个 catalog 中定义 |

### 8.3 端到端测试

```bash
# 完整端到端测试
cd test/fixture/catalog-monorepo
ncu --workspaces --catalog default --catalogTarget patch -u
# 验证 pnpm-workspace.yaml 中的 catalog 已正确更新
# 验证 pnpm-lock.yaml 一致性（可选）
```
