# 开发与维护

本项目使用标准 Docker Compose 部署。业务配置由管理后台管理，不添加一键部署脚本、不写入真实环境的路径或凭据。

## 本地检查

使用 Node.js 22 或 24：

```sh
npm ci --ignore-scripts --prefix runtime/app
npm run check
npm test
docker compose --env-file .env.example config --quiet
docker compose --env-file .env.example --profile browser-login config --quiet
```

`npm run check` 检查 JavaScript 语法、Xray 二进制校验和以及 Compose 版本一致性。测试使用临时目录和模拟数据，不连接实际 Bot、PT 站或生产下载队列。GitHub Actions 在 Node.js 22 / 24 上运行相同检查；CI 不读取生产凭据、不部署到实际运行主机。

## 目录

| 目录 | 用途 |
| --- | --- |
| `app/` | 下载队列、机器人、平台登录态与服务运行器 |
| `manager/` | 管理 API 和中文网页 |
| `patches/` | Cobalt 平台适配 |
| `runtime/` | Node 依赖清单与 lockfile |
| `browser/` | 可选官方登录浏览器 |
| `vendor/` | 上游源码、前端产物与已验证的 Xray 二进制 |
| `tests/` | 行为测试 |
| `scripts/check.mjs` | 开发检查，不执行部署 |

保留 `vendor/`，使克隆后的工程包含当前版本所需素材。重建前端见 [frontend-build.md](docs/frontend-build.md)。升级第三方组件时更新固定版本、校验和、对应源码与 [第三方许可](THIRD_PARTY.md)。

## 提交与版本

- 只提交代码、示例配置、文档和测试；真实配置、Cookie、Token、下载文件及备份不进入 Git。
- 测试数据使用保留示例域名和虚构密钥；不要复制实际日志或截图作为测试素材。
- 发布时同步 `package.json`、`compose.yaml`、后台版本标记和 `CHANGELOG.md`。
- 修改配置结构时兼容现有配置和加密备份；存储迁移、账号绑定及任务恢复需要对应测试。
- 运行时改动先在隔离环境验证，再按 [运维说明](docs/operations.md) 更新。
