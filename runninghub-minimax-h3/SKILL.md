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

## 多段生成经验

- 用户明确选定并保留的成片，按 asset/job ID 冻结；后续段落不得覆盖或自动重跑它。除非用户要求多个版本，每个后续段落提交一个生成任务。
- 多任务并发时遵循用户对 Key 的要求。若用户要求不同 Key，提交前确认有足够的、已验证且账户组互异的消费级 Key；提交后核对账本中的实际 Key/账户组绑定，每个账户组并发上限为 1。无法满足时不要悄悄复用同一账户并发。
- 用前段尾帧作后段连续性参考时，保留原片，并明确说明参考图只是构图/连续性锚点；通用图片槽不保证硬首帧锁定。提示词还应写明后段开场状态和交给下一段的视觉接点。
- 生成成功后做媒体验收：核对实际时长、画幅、分辨率、帧率和音轨；抽查开头、中段、结尾及转场画面。音轨存在不代表对白清晰或情绪到位，涉及声音质量时需要实际试听再作判断。请求时长是目标值，报告时使用文件元数据中的实际时长。
- 费用分别报告真实回传的消费级账户币数和钱包金额；未返回的费用继续记为未知，不推断免费或只扣平台币。收集失败用原 journal 的 status/resume 恢复，不新建任务代替。

## 项目助手入口
使用 generate_h3_video({input:{prompt,references,parameters},expectedRevision})；素材必须是刚读取项目内的真实 ID。每个新的用户请求调用一次；查询用 inspect_results / inspect_media。重放由工具调用身份去重，不自行创建不同操作再次提交。


本机已安装服务的地址与恢复记录见 references/local-installation.md。
