# 前端素材重建

日常部署直接使用 `vendor/web` 的静态构建产物，不需要重建 Svelte。

如需从对应源码重建，在 `vendor/cobalt-source` 按其 README 安装 pnpm 9.6.0 与依赖，再以 `WEB_DEFAULT_API=https://nmd-api.invalid/` 构建 web。将 web 的静态 build 内容复制到 `vendor/web`，并将生成 JavaScript 中的 `https://nmd-api.invalid/` 替换为 `__NMD_API_ORIGIN__`。不要使用真实服务器 IP 或凭据作为构建参数。

`app/web.mjs` 会在响应 JavaScript 时将占位符替换为访问者当前 origin 的 `/api/`。访问 9070 的 API 与下载通道同源；9071 保留兼容 API。`app/public-routing.mjs` 处理 Cobalt 生成的绝对下载 URL。

源码来自 `a636575b09de1fc55d9b8cd98cac88f5f2f16b42`；前端许可证仍为原 CC-BY-NC-SA-4.0。界面定制、发布或商业使用前请遵守上游关于许可及品牌的说明。
