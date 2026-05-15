# pinVersions 颜色输出增强设计

## 1. 需求概述

为 `pinVersions` 功能添加颜色标记，让用户在 CLI 输出中能够直观识别哪些包是被固定版本的。

### 当前输出示例

```
lodash       4.17.20  →  4.17.21
axios        0.27.1   →  0.27.2
react        18.2.0   →  18.2.0   (up-to-date)
```

### 目标输出示例

```
lodash       4.17.20  →  4.17.21  (pinned)  ← 黄色高亮
axios        0.27.1   →  0.27.2   (pinned)  ← 黄色高亮
react        18.2.0   →  18.2.0   (up-to-date)
```

---

## 2. 颜色方案设计

### 2.1 颜色选择

| 状态         | 颜色                  | 说明                            | 示例                                       |
| ------------ | --------------------- | ------------------------------- | ------------------------------------------ |
| `pinned`     | **黄色** `yellow`     | 包被 pinVersions 固定到指定版本 | `┃ lodash ┃ 4.17.20 → 4.17.21 (pinned) ┃`  |
| `up-to-date` | **绿色** `green`      | 包已是最新版本                  | `┃ react ┃ 18.2.0 → 18.2.0 (up-to-date) ┃` |
| `upgrade`    | **红色** `red`        | 包有可用升级                    | `┃ axios ┃ 0.27.1 → 0.27.2 ┃`              |
| `downgrade`  | **红色** `red` (闪烁) | 包需要降级（罕见）              | `┃ foo ┃ 2.0.0 → 1.0.0 ┃`                  |

**选择黄色的理由**：

- 黄色在 CLI 中表示 "注意"/"警告" 级别，适合表示 "被固定" 这种需要用户注意的特殊状态
- 与现有的 `up-to-date` (绿色)、`upgrade` (红色/白色) 区分开
- 在暗色/亮色终端中都有良好的可读性

### 2.2 显示格式

建议在输出中添加 `(pinned)` 标记：

```
[name] [current] → [upgraded] (pinned)
```

当使用 `--format lines` 时：

```
name@version pinned
```

---

## 3. 技术实现方案

### 3.1 方案 A：扩展 `upgradeDependencies` 返回值（推荐）

**修改文件**：`src/lib/upgradeDependencies.ts`

**当前实现**：

```typescript
export function upgradeDependencies(
  currentDependencies: Index<VersionSpec>,
  latestVersions: Index<string>,
  options: Options,
): Index<VersionSpec> {
  const upgraded = { ...currentDependencies }

  for (const dep of Object.keys(latestVersions)) {
    if (options.upgrade && !dep.startsWith('npm:')) {
      upgraded[dep] = latestVersions[dep]
    }
  }

  return upgraded
}
```

**增强实现**：

```typescript
export interface UpgradeResult {
  currentVersion: VersionSpec
  upgradedVersion: VersionSpec | undefined
  isPinned: boolean
}

export function upgradeDependencies(
  currentDependencies: Index<VersionSpec>,
  latestVersions: Index<string>,
  options: Options,
): Index<UpgradeResult> {
  const upgraded: Index<UpgradeResult> = {}

  for (const dep of Object.keys(latestVersions)) {
    const currentVersion = currentDependencies[dep]
    const upgradedVersion = latestVersions[dep]
    const isPinned = options.pinVersions?.[dep] !== undefined

    if (isPinned || options.upgrade) {
      upgraded[dep] = {
        currentVersion,
        upgradedVersion,
        isPinned,
      }
    }
  }

  return upgraded
}
```

### 3.2 方案 B：在 `filterResults` 前标记

**修改文件**：`src/lib/upgradePackageDefinitions.ts`

```typescript
export async function upgradePackageDefinitions(
  currentDependencies: Index<VersionSpec>,
  options: Options,
): Promise<UpgradePackageDefinitionsResult> {
  const latestVersionResults = await queryVersions(currentDependencies, options)

  let latestVersions = keyValueBy(latestVersionResults, (dep, result) =>
    result?.version ? { [dep]: result.version } : null,
  )

  // 应用 pinVersions
  if (options.pinVersions) {
    for (const [packageName, pinnedVersion] of Object.entries(options.pinVersions)) {
      if (packageName in latestVersions) {
        latestVersions[packageName] = pinnedVersion
      }
    }
  }

  // 收集被固定的包名集合
  const pinnedPackages = new Set(Object.keys(options.pinVersions || {}))

  const upgradedDependencies = upgradeDependencies(currentDependencies, latestVersions, {
    ...options,
    pinnedPackages, // 新增参数
  })

  // ... 后续逻辑
}
```

### 3.3 方案 C：通过 Options 传递信息

在 `Options` 接口中添加 `pinnedPackages?: Set<string>` 字段，并在调用链中传递。

**修改文件**：

- `src/types/Options.ts`
- `src/lib/upgradePackageDefinitions.ts`
- `src/lib/upgradeDependencies.ts`
- `src/lib/printUpgrades.ts` / `src/lib/logging.ts`

**优势**：最清晰的职责分离，不破坏现有类型结构。

**劣势**：需要修改多个文件的函数签名。

---

## 4. 推荐的实现路径

### 4.1 类型定义

**修改文件**：`src/types/Options.ts`

```typescript
export interface Options extends RunOptions {
  // ... 现有字段

  /** 内部使用：被固定版本的包名集合 */
  pinnedPackages?: Set<string>
}
```

### 4.2 核心逻辑修改

**修改文件**：`src/lib/upgradePackageDefinitions.ts`

```typescript
export async function upgradePackageDefinitions(
  currentDependencies: Index<VersionSpec>,
  options: Options,
): Promise<UpgradePackageDefinitionsResult> {
  const latestVersionResults = await queryVersions(currentDependencies, options)

  let latestVersions = keyValueBy(latestVersionResults, (dep, result) =>
    result?.version ? { [dep]: result.version } : null,
  )

  // 应用 pinVersions
  const pinnedPackages = new Set(Object.keys(options.pinVersions || {}))
  if (options.pinVersions) {
    for (const [packageName, pinnedVersion] of Object.entries(options.pinVersions)) {
      if (packageName in latestVersions) {
        latestVersions[packageName] = pinnedVersion
      }
    }
  }

  // 传递 pinnedPackages 到 upgradeDependencies
  const upgradedDependencies = upgradeDependencies(currentDependencies, latestVersions, {
    ...options,
    pinnedPackages,
  })

  // ... 后续逻辑保持不变
}
```

### 4.3 升级结果数据结构

**修改文件**：`src/types/UpgradeResult.ts`（新建）或 `src/types/VersionSpec.ts`

```typescript
export interface UpgradeResult {
  /** 当前版本 */
  currentVersion: VersionSpec
  /** 升级后版本（undefined 表示无需升级） */
  upgradedVersion: VersionSpec | undefined
  /** 是否被 pinVersions 固定 */
  isPinned: boolean
}

export type UpgradeResults = Index<UpgradeResult>
```

### 4.4 输出格式化

**修改文件**：`src/lib/logging.ts`（或 `printUpgrades.ts`）

```typescript
function formatUpgradeLine(dep: string, current: string, upgraded: string | undefined, options: Options): string {
  const color = options.color ? chalk : { ...chalk, reset: '' }

  if (!upgraded) {
    return color.green(`${dep.padEnd(20)} ${current} → ${current}  (up-to-date)`)
  }

  let suffix = ''
  if (options.pinnedPackages?.has(dep)) {
    suffix = '  (pinned)'
  }

  return `${color.yellow(dep.padEnd(20))} ${current} → ${upgraded}${suffix}`
}
```

### 4.5 支持 `--format` 选项

**修改文件**：`src/lib/logging.ts`

在 `format` 函数的 `lines` 和 `dep` 格式中处理 `pinned` 标记：

```typescript
case 'lines':
  return Object.keys(upgradedDependencies)
    .map(dep => {
      const result = upgradedDependencies[dep]
      const current = currentDependencies[dep]
      const upgraded = result?.upgradedVersion
      let line = result ? `${dep}@${current}` : `${dep}@${upgraded}`

      if (result?.isPinned) {
        line += ' pinned'
      }

      return line
    })
    .join('\n')
```

---

## 5. 配置文件支持

### 5.1 JSON 配置

```json
{
  "upgrade": true,
  "pinVersions": {
    "lodash": "4.17.21",
    "axios": "0.27.2"
  },
  "format": ["lines", "group"]
}
```

### 5.2 JS 配置（支持函数）

```javascript
module.exports = {
  upgrade: true,
  pinVersions: {
    lodash: process.env.LODASH_VERSION || '4.17.21',
  },
}
```

---

## 6. 测试用例

```typescript
describe('pinVersions', () => {
  it('should mark pinned packages with (pinned) suffix', async () => {
    const result = await ncu({
      packageFile: 'test/fixtures/package.json',
      pinVersions: { lodash: '4.17.21' },
    })

    expect(result).toContain('(pinned)')
  })

  it('should use yellow color for pinned packages', async () => {
    const result = await ncu({
      packageFile: 'test/fixtures/package.json',
      pinVersions: { axios: '0.27.2' },
      color: true,
    })

    expect(result).toContain(chalk.yellow('(pinned)'))
  })

  it('should work with --format lines', async () => {
    const result = await ncu({
      packageFile: 'test/fixtures/package.json',
      pinVersions: { lodash: '4.17.21' },
      format: ['lines'],
      jsonUpgraded: true,
    })

    const parsed = JSON.parse(result)
    expect(parsed.lodash).toContain('pinned')
  })
})
```

---

## 7. 优先级与依赖

| 优先级 | 任务                                                   | 依赖               |
| ------ | ------------------------------------------------------ | ------------------ |
| P0     | 定义 `UpgradeResult` 类型                              | -                  |
| P0     | 修改 `upgradeDependencies` 返回 `UpgradeResult[]`      | UpgradeResult 类型 |
| P0     | 修改 `upgradePackageDefinitions` 传递 `pinnedPackages` | Options 扩展       |
| P1     | 修改 `logging.ts` 添加 `(pinned)` 标记                 | 返回类型变更       |
| P1     | 修改 `format` 函数支持 pinned 标记                     | logging.ts 修改    |
| P2     | 编写单元测试                                           | 功能实现完成       |
| P2     | 更新 README 文档                                       | 功能稳定后         |

---

## 8. 向后兼容性

- ✅ 保持 `upgradeDependencies` 的输入参数不变
- ⚠️ 输出从 `Index<VersionSpec>` 改为 `Index<UpgradeResult>`，**可能破坏现有使用**的代码
- ✅ CLI 用户无感知，仅输出增强
- ✅ 配置文件无需修改

**破坏性变更处理**：如果 `ncu` 作为库被其他项目使用，可能需要：

- 添加 `options.legacyMode` 开关
- 或在 `Options` 中定义 `upgradedDependenciesFormat` 控制输出结构

---

## 9. 备选方案：不修改核心返回值

如果不想破坏现有 API，可以只修改 `logging.ts`：

```typescript
// 在 logging.ts 中
const pinnedSet = new Set(Object.keys(options.pinVersions || {}))

// 在生成输出时，检查 dep 是否在 pinnedSet 中
if (pinnedSet.has(dep)) {
  output += color.yellow(' (pinned)')
}
```

**优点**：

- 零破坏性变更
- 实现简单

**缺点**：

- `logging.ts` 需要访问 `pinVersions` 原始配置
- 无法在 `--jsonUpgraded` 输出中体现 pinned 状态

---

## 10. 结论与建议

**推荐方案**：采用 **方案 A** + **不修改核心返回值**

即仅在 `logging.ts` 中读取 `options.pinVersions`，根据包名判断是否添加 `(pinned)` 标记。

**理由**：

1. 最小化改动，避免破坏现有 API
2. `pinVersions` 本身是配置项，logging 模块读取它合情合理
3. 快速实现，测试成本低

**实现步骤**：

1. 修改 `src/lib/logging.ts` 的 `formatUpgradeLine` 或 `print` 函数
2. 在输出行尾添加 `(pinned)` 标记
3. 使用 `chalk.yellow()` 高亮 `(pinned)` 文本
4. 在 `--format lines` 和 `--format group` 中也添加标记

---

## 11. 参考代码位置

| 功能点       | 文件                       | 行号                     |
| ------------ | -------------------------- | ------------------------ |
| 当前版本输出 | `src/lib/logging.ts`       | `formatUpgradeLine` 函数 |
| 彩色输出     | `src/lib/chalk.ts`         | `chalk` 实例             |
| 配置读取     | `src/lib/printUpgrades.ts` | `getOptions` 函数        |

---

## 12. 待办清单

- [ ] 确定最终方案（推荐：不修改核心返回值，只在 logging 层处理）
- [ ] 修改 `src/lib/logging.ts`
- [ ] 支持 `--format lines` 的 pinned 标记
- [ ] 编写测试用例
- [ ] 更新 `docs/pinVersions-design.md` 主设计文档
- [ ] 更新 README.md

---

## 附录：相关文件结构

```
src/
├── cli-options.ts          # CLI 选项定义
├── lib/
│   ├── logging.ts          # 输出格式化（修改点）
│   ├── upgradePackageDefinitions.ts  # 核心逻辑
│   ├── upgradeDependencies.ts        # 版本计算
│   └── printUpgrades.ts    # 打印升级结果
└── types/
    └── Options.ts          # 选项类型
```
