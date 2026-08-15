# dsh-api-balance — API 余额检测插件

在 DSH「设置」面板新增 **API 余额** 模块：实时查询已配置供应商（DeepSeek）的账户余额、可用状态与**真实 Token 用量**，支持手动刷新。**API Key 只存在于后端**，浏览器只会拿到余额数据。

## 快捷安装（推荐，DSH 原生插件指令）

插件已声明为 DSH bundle，一条命令即可从 GitHub 安装到 web profile：

```bash
dsh plugin --profile web add github:gaozhiwei521/Deepseek-Harness-Api-monitor
```

装完**重启 DSH**（退出「DSH 对话」再打开），在「设置 → API 余额」即可看到界面。

> ⚠️ 迁移注意：若之前用过下方的手动 Copy-Item 安装，请先移除 `cordis.patch.yml` 中的 `api-balance` insert 块，并删除 `~\.dsh\profiles\node_modules\dsh-api-balance\`，避免与 bundle 双份注册。

## 安装位置

- 源码（本目录）：`E:\deepseekwork1\dsh-api-balance\`
- GitHub：`gaozhiwei521/Deepseek-Harness-Api-monitor`
- bundle 补丁：`extensions/dsh/cordis.patch.yml`（`dsh plugin add` 自动应用）
- 手动装载补丁（旧方式）：`~\.dsh\profiles\web\cordis.patch.yml`

## 工作原理

| 层 | 实现 |
|---|---|
| 后端 `lib/index.js` | 注册两条回环路由：`GET /dsh-balance/query`（通过 `credentials.resolve()` 读取 `DEEPSEEK_API_KEY`，调用 `{baseURL}/user/balance`）和 `GET /dsh-balance/usage`（聚合本地会话日志中的真实 token 用量，60s 缓存）。baseURL / apiKeyEnv 跟随「设置 → 模型」里 `llm-deepseek` 配置段的覆盖。 |
| 前端 `lib/client.js` | 注册 `settings.section` 槽位（id=`api-balance`，label=「API 余额」）：可用额度大数字 + 可用状态徽章 + 用量卡片（累计/今日 Tokens、会话数、用量记录）。样式全部使用全局 `--dsw-alias-*` 主题令牌，与暗色主题一致。 |

## 手动安装（旧方式，DSH 升级后插件可能丢失时备用）

```powershell
# 1) 把包放到 profiles\node_modules
Copy-Item 'E:\deepseekwork1\dsh-api-balance\package.json' "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-api-balance\" -Force
Copy-Item 'E:\deepseekwork1\dsh-api-balance\lib' "$env:USERPROFILE\.dsh\profiles\node_modules\dsh-api-balance\lib" -Recurse -Force

# 2) 确认 cordis.patch.yml 末尾有 api-balance insert 块（升级若覆盖则重新追加）
# 3) 重启 DSH（退出「DSH 对话」再打开；或杀掉后端进程由桌面壳看门狗自动拉起）
```

## 卸载

```bash
dsh plugin --profile web remove dsh-api-balance
```

（旧手动安装方式：1. 删除 `cordis.patch.yml` 中 `api-balance` 的 insert 块；2. 删除 `~\.dsh\profiles\node_modules\dsh-api-balance\`；3. 重启 DSH。）

## 测试

```powershell
node 'E:\deepseekwork1\dsh-api-balance\test\unit.test.mjs'        # 后端逻辑（13 项）
node 'E:\deepseekwork1\dsh-api-balance\test\client-load.test.cjs' # 前端模块结构
```

## 已知说明

- **用量为真实数据**：DeepSeek 无公开用量 API（`/user/usage` 实测 404），因此消耗数据来自**本地会话日志**中每次调用的真实 token usage（输入/输出/缓存/推理），非估算。
- **赠送余额**：账户无赠送余额（0）时自动隐藏该项。
- 默认读取 `DEEPSEEK_API_KEY`；若模型设置在「设置 → 模型」中改过 Key 引用或 baseURL，插件自动跟随。
- 仅支持 DeepSeek 官方账户余额接口；其他供应商的余额接口暂未接入。
