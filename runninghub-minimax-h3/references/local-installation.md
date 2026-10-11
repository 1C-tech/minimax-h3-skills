# 独立本机服务：安装与密钥管理

## 要求与启动

- Node.js 20 或更新版本。服务使用 Node 内置模块，不需要安装 npm 包。
- 从本仓库的 `runninghub-minimax-h3/` 目录运行命令。
- 启动执行器：

  ```text
  node service/cli.mjs start
  ```

- 首次启动会创建数据目录 `~/.runninghub-h3-service/`，并两次隐藏提示输入至少12位的 vault passphrase。后续启动使用同一 passphrase 解锁密钥。服务监听 `127.0.0.1:4317`；关闭终端会停止执行器。
- 可用 `RH_H3_HOME` 改数据目录、`RH_H3_PORT` 改本机端口。执行服务和 skill CLI 的终端必须使用同样的设置。只有在无人值守时才设置 `RH_H3_VAULT_PASSPHRASE`；环境变量可能被同一用户运行的其他进程读取。
- `state.json` 保存密钥密文、任务输入和状态；API Key 使用 AES-256-GCM 加密，密钥从 passphrase 和本地随机 salt 通过 scrypt 派生。`service.token` 用于本机 CLI 鉴权。两个文件均留在本机数据目录，不要提交到 Git 或分享给他人。

## 消费级 Key 池

服务启动后，在另一个终端导入密钥。Key 不作为命令行参数，输入时不会回显：

```text
node service/cli.mjs key add --account-group personal-main
node service/cli.mjs key list
node service/cli.mjs key probe rhkey_ID
node service/cli.mjs key enable rhkey_ID
node service/cli.mjs key disable rhkey_ID
node service/cli.mjs job list
```

只导入 RunningHub 国际站消费级 32 位十六进制 API Key。新 Key 默认禁用；`probe` 读取账户状态，只有 `apiType` 报告为 `NORMAL` 才会标记为消费级，随后需显式 `enable`。同一个 RunningHub 账户下的多个 Key 必须用同一 `--account-group` 值；不同账户使用不同值。账本对每个账户组只同时提交一个任务，执行器全局最多处理四个活动任务。该本地限制不代表 RunningHub 账户的实际并发额度。

可通过 `key list` 查看启用状态、账户组、指纹和经验证的账户状态摘要。服务不会提供显示或导出原始 API Key 的命令。密钥只绑定导入时的账户组；若归属录错，先禁用该 Key，再用正确账户组重新导入并完成验证。

需要指定某个 Key 时，在 manifest 顶层加入 `"keyId": "rhkey_实际ID"`；服务会绑定并保留这个选择，不会静默换用其他 Key。省略时由执行器挑选空闲 Key。`job list` 可查看所有账本任务、远端 taskId 和实际 Key/账户组绑定，在 journal 丢失时用于找回任务。

## 素材与任务

准备请求要求每项参考素材是本机文件路径。图片支持 JPG、JPEG、PNG、WebP；音频支持 MP3、WAV、FLAC；视频支持 MP4、AVI、MOV、MKV。每个文件最大30 MB，音频额外限制20 MB。素材只在 `generate` 后上传；准备阶段会检查文件并读取 RunningHub 公开 H3 应用 schema。

执行器仅访问 `https://www.runninghub.ai` 的消费级 AI App 接口：账户状态、资源上传、AI App 提交和任务输出查询。提交任务不调用工作流执行端点，也不切换到其他服务商。

服务退出时，正在上传的任务可安全回到队列，因为上传本身不会启动视频生成；退出时已处于 `submitting` 的任务在下次启动后进入 `submission_unknown`。此状态保留账户并发槽，直到查明 RunningHub 是否接收：找到远端任务时通过 `job attach-task` 接回原任务查询；确认无任务后运行 `job resolve-not-accepted`，并输入完整确认语句释放本地槽。这个命令只关闭原账本项，不会再次提交。服务不会盲目重试提交。输出 URL 若含签名凭据不会回传；使用任务 ID 在 RunningHub 账户界面取回结果。本服务不代为下载媒体文件。

## 官方接口参考

- [RunningHub Get Account Information](https://www.runninghub.ai/runninghub-api-doc-en/api-425761030)：本服务用此消费级账户状态接口验证 Key 类型并读取可用账户摘要。
- [RunningHub Upload Resource](https://www.runninghub.ai/runninghub-api-doc-en/api-425761099)：官方上传文档列出图像、音频、视频格式与单文件大小限制。
- [RunningHub AI Application integration example](https://www.runninghub.ai/runninghub-api-doc-en/doc-8287470)：介绍 AI App `nodeInfoList` 提交与任务输出查询的接口流程。
