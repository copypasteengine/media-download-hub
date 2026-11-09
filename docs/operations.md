# 部署、升级与迁移

1.6.2 的审查范围、修复与验证记录见 [项目审查](review-1.6.2.md)。升级应统一重建 manager、queue、telegram、feishu、web、proxy，避免应用服务混用旧镜像；Cobalt 和 Telegram Bot API 保留各自版本号。

B 站短链接兼容修复（Cobalt `11.7.1-3`）：B23 最近会跳转到 `/zh-Hans/video/...` 等带语言前缀的地址，旧解析器无法匹配而返回 `error.api.fetch.fail`。新版统一转换为标准视频路径，保留分 P 和账号画质权限。更新代码后，空闲时执行 `docker compose up -d --no-deps --build cobalt`；已失败的任务需在后台手动重试。此修复无需重新导入有效的 Cookie。

1.6.4 在网络视频入库前无损重封装 MKV／WebM。HTTP 流输出无法回写容器时长和随机访问索引，部分媒体服务器因此无法解析编码或生成转码画质列表。新步骤不重新编码，仍保留最高画质和原有音视频流；额外暂存占用约一份文件大小，在同一目标盘完成后原子替换。空间不足、磁盘掉线、取消或封装失败均不会发布成品。Telegram 附件仍保留原文件。已有文件不会随升级自动改写，需要单独备份、修复并重新扫描媒体库。任务 `sourceBytes` 记录重封装前的下载字节数，`bytes` 与 `total` 记录最终文件大小。

1.6.3 修复部分 YouTube 音轨拒绝分段请求、导致合并输出空文件或截断文件的问题。匿名解析默认使用 VisionOS 播放接口（客户端参数参考 yt-dlp 2026.08.19），避免旧 Android VR / iOS 通道只返回开头可读的音轨；账号限制内容仍保留原登录态解析路线。Cobalt 镜像更新为 `media-download-hub-cobalt:11.7.1-2`，遇到 403 会逐级缩小分段，并校验每段的范围和实际字节数。合并启用 FFmpeg 严格错误处理，只有进程成功退出才正常结束 HTTP 响应，防止将可播放的开头误当成完整文件。YouTube VP9/AV1 若仍返回空流，或经验证的合并通道中途断开，会额外尝试一次 H.264 版本；不会重试用户取消、磁盘写入错误等情况，实际分辨率继续显示在任务中。此版本需要同时重建 Cobalt 和应用镜像。

## 首次部署

克隆仓库，在工程目录复制 `.env.example` 为 `.env`，设置已存在的 `MEDIA_ROOT` 与 `STATE_ROOT` 以及监听地址。再执行：

```sh
docker compose config --quiet
docker compose up -d --build
docker compose ps
```

打开管理后台创建管理员；平台登录、代理、分类映射和机器人绑定在网页完成。详情见 [README](../README.md)。私有仓库仅限制代码访问，不等于管理后台访问控制。

## 更新

1. 空闲时通过「备份与安全」导出加密备份，把备份口令另存于密码管理器。媒体文件另行备份。
2. 记录当前提交：`git rev-parse HEAD`。保留 `.env`、配置卷和状态目录。
3. 拉取代码并检查 Compose：

   ```sh
   git pull --ff-only
   docker compose config --quiet
   docker compose up -d --build
   docker compose ps
   ```

4. 在后台核对磁盘、登录态、机器人绑定与队列，再用自己的测试链接验证下载。运行中的下载在重建容器后可能从头重试。

代码回退可切换到之前记录的提交后重新构建。若新版升级了数据结构，仅回退镜像不一定足够；结合版本说明使用兼容版本的加密备份恢复。不要使用 `docker compose down -v`，不要删除媒体目录或配置卷。

## 换设备

在新设备克隆工程，重新设置宿主机存储路径并启动。创建管理员后导入加密备份，检查分类映射、入口和登录态，确认媒体盘后才开始任务。迁移结束前只让一台设备运行同一个 Bot。

仓库不包含实际账号和运行数据，单独克隆代码不会恢复你的 Cookie、任务和绑定。加密备份也不包含媒体文件或当前后台密码。

## 排查

```sh
docker compose ps
docker compose logs --tail=100 manager
docker compose logs --tail=100 queue proxy telegram feishu
```

分享日志前删除链接参数、用户信息和凭据。代理仅用于项目内服务；节点检测耗时不是带宽测速。若磁盘未挂载或标识不符，先恢复磁盘与映射，避免把下载写入系统盘。

## 从旧名称升级（NAS Media Downloader → Media Download Hub）

名称从 1.3.0 起调整，新安装默认使用 `media-download-hub`。**已有部署在拉取新版前，必须把 `.env` 的 `COMPOSE_PROJECT_NAME` 设置为原项目名**；旧版默认是：

```dotenv
COMPOSE_PROJECT_NAME=nas-media-downloader
```

否则 Compose 会创建另一套容器和空配置卷，看起来像账号和设置丢失，还可能与旧端口冲突。先用 `docker compose ls` 核对原项目名，保持它不变即可复用原有配置卷；不要同时运行两套机器人。镜像名称和界面名称可以改变，不影响存储卷内容。

为兼容已有加密备份，文件内部的 `nas-media-downloader/1` 格式标识暂时保留。这是兼容协议标记，不限制运行设备；新下载的备份文件名使用 `media-download-hub-backup-`。

1.3.0 增强了下载完成文件的恢复校验。旧版若恰好在文件发布时中断、尚未记为完成，新版会因缺少完整身份信息重新下载并避让原文件名，不覆盖原文件；已完成任务不受影响。

## 1.5.0 Telegram 大文件与保存位置选择

升级前创建 `${STATE_ROOT}/telegram-api`（或 `.env` 显式设置已有 `TELEGRAM_CACHE_ROOT`），目录必须在你计划的缓存磁盘。Compose 新增内部 `telegram-api` 服务，未填写应用凭据时保持等待，不影响云 Bot。升级保留原账号、绑定、任务和分类。随后在后台填写 API ID / API Hash 并开启大文件开关；不要同时启动旧 Bot 实例。每次转发附件会询问保存分类，链接下载沿用原交互。具体限制见 [Telegram 视频](telegram-video.md)。
