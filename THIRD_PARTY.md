# 第三方组件

本工程自编排/管理代码及 Cobalt API 修改采用 AGPL-3.0-only。各第三方素材保持各自许可证。

- Cobalt API 11.7.1，来源 https://github.com/imputnet/cobalt ，源码基准 `a636575b09de1fc55d9b8cd98cac88f5f2f16b42`，AGPL-3.0。对应源码在 `vendor/cobalt-source`；API 修改在 `patches`。前端构建产物中的默认 API 地址替换为占位符，运行时按访问来源注入同源 /api/ 地址。源码使用 WEB_DEFAULT_API 构建参数；重建步骤见 docs/frontend-build.md。
- Cobalt web 11.7，CC-BY-NC-SA-4.0（不可据此宣称可商业使用）。`vendor/web` 是对应构建产物；`vendor/cobalt-source/web` 为源码。保留原站内品牌及许可。可使用仓库中的 pnpm 9.6.0 和锁文件重建前端。
- Xray-core 26.3.27，MPL-2.0，https://github.com/XTLS/Xray-core 。许可证 `vendor/xray/LICENSE`；ARM64 / AMD64 官方发布文件已核对 SHA-256，详见 `vendor/xray/checksums.json`。
- YouTube.js 18.1.0 / 17.0.1、飞书 Node SDK 1.75.0 使用其原许可证，依赖在各自 package-lock.json 中固定。
- Chromium、noVNC（主要 MPL-2.0）、websockify 等通过 Alpine 官方软件包安装，保留镜像内软件包许可证。浏览器包跟随 Alpine 3.23 软件仓库安全更新，并非永久固定某个 Chromium 版本。
- qrcode 1.5.4（MIT）、yaml 2.9.1（ISC），用于本地二维码和订阅解析，依赖版本固定在 runtime/app/package-lock.json。
- Node.js、ffmpeg 及 Cobalt 官方镜像内依赖保持各自许可证。

不要将实际 `.env`、Docker config 卷、平台 Cookie、备份解密密码、Bot 配对码或浏览器个人资料加入源代码发布包。
