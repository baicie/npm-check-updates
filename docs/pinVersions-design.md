# npm-check-updates 新增 `pinVersions` 配置项设计方案

## 1. 需求概述

用户希望新增一个配置属性，允许将指定包固定到特定版本，而非通过 `target` 自动选择版本。

### 使用场景

- 企业内部要求某些包必须使用指定版本（如安全合规要求）
- 临时锁定某个包到特定版本进行调试
- CI/CD 环境中需要强制使用特定版本

### 示例配置

```json
{
  "upgrade": true,
  "deep": true,
  "ignore": ["test"],
  "pinVersions": {
    "lodash": "4.17.21",
    "axios": "0.27.2",
    "@types/node": "18.0.0"
  }
}
```

---

## 2. 技术设计

### 2.1 类型定义修改

**修改文件**: `src/types/RunOptions.ts`

新增 `pinVersions` 选项到 `RunOptions` 接口：

```typescript
/** 用于 pinVersions 配置的类型别名 */
type VersionString = string

/**
 * 用于存储包名到目标版本的键值对
 * 键: 包名称（支持带作用域的包名，如 @types/node）
 * 值: 目标版本（必须是具体版本号，如 1.0.0，不支持范围）
 */
export type PinVersions = Index<VersionString>
```

在 `RunOptions` 接口中添加：

```typescript
/** 将指定包固定到特定版本，绕过 target 策略 */
pinVersions?: PinVersions
```

**修改文件**: `src/types/Options.ts`

`Options` 类型继承自 `RunOptions`，自动获得 `pinVersions` 支持，无需额外修改。

**修改文件**: `src/types/RcOptions.ts`

`RcOptions` 也继承自 `RunOptions`，配置文件支持此选项：

```typescript
export type RcOptions = Omit<RunOptions, Nonsensical> & {
  $schema?: string
  format?: string | string[]
}
```

---

### 2.2 CLI 选项定义

**修改文件**: `src/cli-options.ts`

在 `cliOptions` 数组中添加新选项：

```typescript
{
  long: 'pinVersions',
  arg: 'json',
  description:
    'Pin packages to specific versions, bypassing target strategy. Accepts a JSON object mapping package names to versions.',
  type: 'Index<string>',
  parse: value => {
    // 支持 JSON 字符串格式: --pinVersions '{"lodash":"4.17.21"}'
    if (typeof value === 'string') {
      try {
        return JSON.parse(value)
      } catch {
        throw new Error('pinVersions must be a valid JSON object')
      }
    }
    return value
  },
},
```

**注意**: CLI 仅支持 JSON 字符串格式。对于函数式配置，推荐使用 `.ncurc.js` 文件。

---

### 2.3 核心逻辑修改

#### 2.3.1 修改 `upgradePackageDefinitions.ts`

**修改文件**: `src/lib/upgradePackageDefinitions.ts`

在查询版本后、应用 `filterResults` 之前，检查 `pinVersions` 配置：

```typescript
export async function upgradePackageDefinitions(
  currentDependencies: Index<VersionSpec>,
  options: Options,
): Promise<UpgradePackageDefinitionsResult> {
  const latestVersionResults = await queryVersions(currentDependencies, options)

  // 处理 pinVersions 配置
  // 如果某个包在 pinVersions 中定义，直接使用指定的版本替换 latestVersions
  let latestVersions = keyValueBy(latestVersionResults, (dep, result) =>
    result?.version
      ? { [dep]: result.version }
      : null,
  )

  // 应用 pinVersions 配置
  if (options.pinVersions) {
    for (const [packageName, pinnedVersion] of Object.entries(options.pinVersions)) {
      if (packageName in latestVersions) {
        latestVersions[packageName] = pinnedVersion
      }
    }
  }

  // 后续逻辑保持不变...
  const filteredLatestVersions = keyValueBy(latestVersions, (dep, result) =>
    (!options.filterResults ||
      options.filterResults(dep, {
        currentVersion: currentDependencies[dep],
        currentVersionSemver: parseRange(currentDependencies[dep]),
        upgradedVersion: result,
        upgradedVersionSemver: parse(result),
      }))
      ? { [dep]: result }
      : null,
  )
  // ...
}
```

#### 2.3.2 修改 `upgradeDependencies.ts`

`upgradeDependencies.ts` 是实际生成升级版本的地方，需要在这里确保 `pinVersions` 生效。由于我们在 `upgradePackageDefinitions.ts` 中已经修改了 `latestVersions`，这部分逻辑已经可以工作，但如果需要更细粒度的控制，可以在这里添加额外处理。

---

### 2.4 配置文件加载

**修改文件**: `src/lib/getNcuRc.ts`

`getNcuRc.ts` 已经支持自动加载配置文件中的所有选项，包括新增的 `pinVersions`。无需修改。

---

## 3. 实现优先级

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | 类型定义 | 在 `RunOptions.ts` 中添加 `pinVersions` 类型 |
| P0 | CLI 选项 | 在 `cli-options.ts` 中添加 CLI 参数定义 |
| P0 | 核心逻辑 | 在 `upgradePackageDefinitions.ts` 中实现版本锁定逻辑 |
| P1 | 文档更新 | 添加使用示例和说明 |
| P1 | 测试用例 | 编写单元测试覆盖新功能 |

---

## 4. 边界情况处理

### 4.1 包名不存在

如果 `pinVersions` 中指定的包名在当前 `dependencies` 中不存在，应忽略该配置，不抛出错误：

```typescript
// 仅对存在的包应用 pinVersions
if (options.pinVersions) {
  for (const [packageName, pinnedVersion] of Object.entries(options.pinVersions)) {
    if (packageName in latestVersions) {
      latestVersions[packageName] = pinnedVersion
    }
  }
}
```

### 4.2 版本格式验证

建议对 `pinVersions` 中的版本进行格式验证，但不是必须的（用户需要为结果负责）：

```typescript
// 简单的 semver 格式检查
const isValidVersion = (v: string) => /^(\d+\.)?(\d+\.)?(\d+)(-[a-zA-Z0-9.-]+)?$/.test(v)
```

### 4.3 与其他选项的优先级

| 场景 | 结果 |
|------|------|
| 同时设置 `pinVersions` 和 `target` | `pinVersions` 优先级更高，覆盖 `target` 的选择 |
| 同时设置 `pinVersions` 和 `filterResults` | 先应用 `pinVersions`，再应用 `filterResults` |
| 包在 `reject` 列表中但也在 `pinVersions` 中 | `reject` 优先，包不参与升级 |

---

## 5. 使用示例

### 5.1 `.ncurc.json` 配置文件

```json
{
  "upgrade": true,
  "pinVersions": {
    "lodash": "4.17.21",
    "axios": "0.27.2"
  }
}
```

### 5.2 `.ncurc.js` 配置文件（支持函数）

```javascript
module.exports = {
  upgrade: true,
  pinVersions: {
    // 使用函数动态决定版本
    'lodash': '4.17.21',
    // 也可以基于环境变量
    'axios': process.env.AXIOS_VERSION || '0.27.2',
  }
}
```

### 5.3 CLI 参数（JSON 格式）

```bash
ncu --pinVersions '{"lodash":"4.17.21","axios":"0.27.2"}'
```

### 5.4 代码调用

```typescript
import ncu from 'npm-check-updates'

const result = await ncu({
  packageFile: './package.json',
  pinVersions: {
    'lodash': '4.17.21',
    'axios': '0.27.2',
  }
})
```

---

## 6. 输出效果

当 `pinVersions` 生效时，输出将显示被固定的版本：

```
lodash       4.17.20  →  4.17.21  (pinned)
axios        0.27.1   →  0.27.2   (pinned)
react        18.2.0   →  18.2.0   (up-to-date)
```

建议在输出中添加 `(pinned)` 标记，区别于正常升级。这需要修改 `src/lib/logging.ts` 中的输出格式化逻辑。

---

## 7. 文件修改清单

| 文件路径 | 修改类型 | 说明 |
|----------|----------|------|
| `src/types/RunOptions.ts` | 修改 | 添加 `pinVersions` 和 `PinVersions` 类型 |
| `src/cli-options.ts` | 修改 | 添加 `--pinVersions` CLI 选项定义 |
| `src/lib/upgradePackageDefinitions.ts` | 修改 | 实现版本锁定核心逻辑 |
| `src/lib/logging.ts` | 可选修改 | 添加 `(pinned)` 输出标记 |
| `src/types/RunOptions.json` | 自动生成 | 运行 `npm run build` 自动更新 |
