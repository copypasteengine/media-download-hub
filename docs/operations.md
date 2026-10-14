# 部署、升级与迁移

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
