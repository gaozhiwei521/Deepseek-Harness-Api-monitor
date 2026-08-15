# dsh-api-balance — API 余额检测插件

在 DSH「设置」面板新增 **API 余额** 模块：实时查询已配置供应商（DeepSeek）的账户余额与可用状态，支持手动刷新。**API Key 只存在于后端**，浏览器只会拿到余额数据。

## 安装位置

- 源码（本目录）：`E:\deepseekwork1\dsh-api-balance\`
- 安装副本：`C:\Users\<用户名>\.dsh\profiles\node_modules\dsh-api-balance\`
- 装载补丁：`C:\Users\<用户名>\.dsh\profiles\web\cordis.patch.yml`（末尾 `api-balance` 行）

## 工作原理

| 层 | 实现 |
|---|---|
| 后端 `lib/index.js` | 注册 `GET /dsh-balance/query` 路由（`webServer.register`，前缀 `/dsh-balance`）。通过 `credentials.resolve()` 读取 `DEEPSEEK_API_KEY`（与聊天共用一个 Key），调用 `{baseURL}/user/balance`。baseURL / apiKeyEnv 跟随「设置 → 模型」里 `llm-deepseek` 配置段的覆盖。 |
| 前端 `lib/client.js` | 以 `__ModuleLoader__.load` 注册 `settings.section` 槽位（id=`api-balance`，order=100，label=「API 余额」），展示总余额 / 充值 / 赠送 / 已消耗(估算) / 可用状态，刷新按钮 + 上次更新时间。样式全部使用全局 `--dsw-alias-*` 主题令牌，与暗色主题一致。 |

## 重新安装（DSH 升级后插件可能丢失）

```powershell
# 1) 重装包
Copy-Item 'E:\deepseekwork1\dsh-api-balance\package.json' "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-api-balance\" -Force
Copy-Item 'E:\deepseekwork1\dsh-api-balance\lib' "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-api-balance\lib" -Recurse -Force

# 2) 确认 cordis.patch.yml 末尾有 api-balance 行（升级若覆盖则重新追加）
# 3) 重启 DSH（退出「DSH 对话」再打开；或杀掉后端进程由桌面壳看门狗自动拉起）
```

## 卸载

1. 从 `cordis.patch.yml` 删除 `api-balance` 的 `insert` 块（备份在 `cordis.patch.yml.bak-20260815`）。
2. 删除 `~\.dsh\profiles\node_modules\dsh-api-balance\`。
3. 重启 DSH。

## 测试

```powershell
node 'E:\deepseekwork1\dsh-api-balance\test\unit.test.mjs'        # 后端逻辑（10 项）
node 'E:\deepseekwork1\dsh-api-balance\test\client-load.test.cjs' # 前端模块结构
```

## 已知说明

- 「已消耗」为估算值：`充值 + 赠送 − 当前总余额`（下限 0），精确账单以供应商为准。
- 默认读取 `DEEPSEEK_API_KEY`；若模型设置在「设置 → 模型」中改过 Key 引用或 baseURL，插件自动跟随。
- 仅支持 DeepSeek 官方账户余额接口；其他供应商的余额接口暂未接入。
