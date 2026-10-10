---
name: runninghub-minimax-h3
description: 使用 RunningHub 国际站消费级 AI App 2084320751339032577，根据用户原文 MiniMax H3 提示词和最多六图、三音频、一视频选择参数并生成视频。支持预览参数、查询状态与恢复收集；由本机 Manju 服务管理凭据和账本。
---

# RunningHub MiniMax H3

固定国际站消费级 AI App，不切换应用或执行工作流。用户请求生成即授权一次提交；仅要求建议参数时不提交。未知费用保留未知，不等于免费或只扣币。

## Codex 入口
使用 scripts/h3.mjs，仅访问本机 Manju 服务，不读取 API Key。先读取服务 /api/health 确認对应数据目录和执行器。服务器需安装本 skill 对应 H3 接口；不要用旧分镜接口替代。

准备 JSON manifest：
- prompt 或 promptFile：原文提示词，不能自动改写剧情。
- projectId 可选；缺省建立专用生成项目。
- references 按图片、音频、视频各自编号顺序列出，每项提供 path 或已有 assetId、kind、role。role 可为 reference / first-frame / last-frame / character / scene / motion / voice / sound / music。
- parameters 可覆盖 durationSeconds、aspectRatio、megapixels、steps、promptOptimization、highestConsistency、interpolation、loraStrength、zipOnly。
若引用编号缺失、意图冲突，不猜测丢弃素材。首尾帧用途通过提示词描述，通用槽不保证硬性帧锁定。

命令：
```text
node scripts/h3.mjs prepare --manifest INPUT.json --journal NEW.json --base http://127.0.0.1:4317
node scripts/h3.mjs generate --journal SAME.json
node scripts/h3.mjs status --journal SAME.json
node scripts/h3.mjs resume --journal SAME.json
```

参数预览输出实际选值。生成只提交一次；保留 journal。generate 的通信失败恢复使用同一 journal 和 operationId，服务器幂等处理；resume/status 不会提交远端任务。等候每次不超过60秒，查询原任务，不无限阻塞。submission_unknown 必须核对原任务，不能重生成。下载失败交给现有服务恢复收集；不得创建新任务替代。

参数策略、输入槽详见 references/app-parameters.md。原素材导入项目后再上传，不能绕过本机 vault、任务意图与账本。输出实际视频路径、尺寸、时长、音轨和费用；播放/看帧/听音后才能说明质量，不能把成功状态当作风格或剧情验收。

## 项目助手入口
使用 generate_h3_video({input:{prompt,references,parameters},expectedRevision})；素材必须是刚读取项目内的真实 ID。每个新的用户请求调用一次；查询用 inspect_results / inspect_media。重放由工具调用身份去重，不自行创建不同操作再次提交。


本机已安装服务的地址与恢复记录见 references/local-installation.md。
