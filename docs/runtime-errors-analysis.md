# npm-check-updates 运行时错误问题分析

## 问题概述

在 Node.js v24.14.1 环境下，使用 rolldown 构建的 npm-check-updates 运行时出现 `TypeError: (0 , xxx.default) is not a function` 错误。

## 问题 1：p-map ESM 模块导入失败

### 错误信息

```
TypeError: (0 , ce.default) is not a function
    at so (/Users/liuzhiwei/Desktop/workspace/git-code/npm-check-updates/dist/cjs/chunks/src.cjs:351:90)
```

### 根本原因

1. **ESM-only 包问题**：`p-map` 是 ESM-only 包（`"type": "module"`），不提供 CommonJS 导出
2. **rolldown 打包问题**：rolldown 在打包 CJS 输出时，将 `p-map` 打包进 bundle，但由于 ESM/CJS 互操作性问题，`import pMap from 'p-map'` 导入的是一个模块对象而非函数
3. **打包后代码**：bundled 代码使用 `(0, pMap.default)` 调用函数，但由于 `.default` 不存在或不是函数，导致报错

### 解决方案

创建 shim 文件 `src/lib/p-map-shim.ts`，在运行时处理 ESM/CJS 互操作：

```typescript
const pMap: PMapFunction =
  typeof pMapModule === 'function' ? (pMapModule as PMapFunction) : (pMapModule as { default: PMapFunction }).default
```

修改所有导入 `p-map` 的文件使用 shim：

```typescript
// 之前
import pMap from 'p-map'

// 之后
import pMap from './p-map-shim'
```

---

## 问题 2：camelcase 模块导入问题（已修复）

### 错误信息

```
TypeError: object is not a function
    at /Users/liuzhiwei/Desktop/workspace/git-code/npm-check-updates/dist/cjs/chunks/src.cjs:3604
```

### 根本原因

1. **camelcase v9.0.0**：这是一个 ESM 模块，包导出的是 `default` 函数
2. **TypeScript 导入**：`import camelCase from 'camelcase'` 导致类型推断为模块对象而非函数
3. **Rolldown 打包**：打包后调用 `camelcase.default(key)`，但如果 rolldown 处理不当，可能导致 `.default` 为 `undefined`

### 解决方案

在 `src/package-managers/npm.ts` 中修复导入：

```typescript
import camelCase from 'camelcase'

const camelCaseFn = typeof camelCase === 'function' ? camelCase : (camelCase as any).default
```

---

## 问题 3：rollup-plugin-node-externals 兼容性问题

### 问题描述

尝试使用 `rollup-plugin-node-externals` 自动处理外部依赖时，出现新的构建错误：

```
[MISSING_EXPORT] Error: "toPath" is not exported by "node_modules/.pnpm/unicorn-magic@0.3.0/node_modules/unicorn-magic/default.js"
```

### 根本原因

1. **依赖树问题**：`rollup-plugin-node-externals` 在处理依赖时会触发更深层的模块解析
2. **版本冲突**：某些传递依赖（unicorn-magic）的导出方式与 rolldown 不兼容

### 解决方案

放弃使用 `rollup-plugin-node-externals`，保持原有的 `external` 配置

---

## 技术背景

### Node.js ESM/CJS 互操作

| 包类型 | CommonJS                 | ESM               |
| ------ | ------------------------ | ----------------- |
| CJS 包 | `require()` 返回模块对象 | 需要包装          |
| ESM 包 | `require()` 返回模块对象 | `import` 直接获取 |

### rolldown 与其他打包工具的差异

| 特性     | rolldown                  | webpack/rollup         |
| -------- | ------------------------- | ---------------------- |
| ESM 处理 | 严格遵循 ESM 规范         | 有更好的默认互操作     |
| CJS 输出 | 可能导致 ESM 模块导入问题 | 通常更稳定             |
| 外部依赖 | 需要手动处理 ESM-only 包  | `externals` 配置更完善 |

---

## 修复文件清单

| 文件                                         | 修复内容                      |
| -------------------------------------------- | ----------------------------- |
| `src/lib/p-map-shim.ts`                      | 新增，解决 p-map ESM 导入问题 |
| `src/lib/queryVersions.ts`                   | 使用 p-map-shim               |
| `src/lib/getPeerDependenciesFromRegistry.ts` | 使用 p-map-shim               |
| `src/package-managers/npm.ts`                | 修复 camelcase 导入           |

---

## 验证方法

```bash
# 构建
npm run build

# 测试 CLI
node dist/cjs/cli.cjs --help

# 测试功能
ncu --jsonUpgraded
```
