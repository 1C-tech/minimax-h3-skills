---
name: runninghub-minimax-h3
description: 使用独立本机服务和 RunningHub 国际站消费级 AI App 2084320751339032577，根据用户原文 MiniMax H3 提示词与最多六图、三音频、一视频选择参数、提交视频生成，并查询和恢复同一任务。
---

# RunningHub MiniMax H3

固定使用 RunningHub 国际站消费级 AI App `2084320751339032577`。不切换应用、不调用工作流执行接口、不读取或回显 API Key。用户请求生成即授权一次提交；仅要求预览参数时不提交。费用未知时保留为 `null`，不能称为免费。

## 独立本机服务

本 skill 自带 `service/`：服务自己管理消费级 Key 池、加密 vault、任务账本和执行器。它不依赖其他项目。先按 [本机安装与密钥管理](references/local-installation.md) 启动服务并配置消费级 Key。

服务只绑定 loopback。`scripts/h3.mjs` 只通过本机鉴权 API 操作服务，不接触 RunningHub Key。准备阶段读取固定应用的公开 schema 并在账本中保存操作；不会上传素材或提交生成。用户确认生成后才排队、上传输入素材并提交。服务通过同一 Key 查询任务结果。

## 输入 manifest

```json
{
  "prompt": "原始 H3 提示词，包含与参考素材编号一致的 <Picture 1> 等标签",
  "references": [
    {"path": "./reference.png", "kind": "image", "role": "first-frame"}
  ],
  "parameters": {"durationSeconds": 10, "aspectRatio": "16:9"}
}
```

- 提示词可用 `prompt` 或 `promptFile` 提供，保留用户原文，不自动改写剧情。
- `references` 每项需要本机 `path`、`kind`（`image`/`audio`/`video`）和可选 `role`。不支持其他服务的 `assetId`。
- `keyId` 可选；仅当用户指定某个 Key 或需要区分并发任务时填写。省略时执行器选择任一空闲且已启用的消费级 Key。
- 最多六张图片、三段音频、一段视频。支持格式与大小上限见安装说明。不要因标签缺失而静默丢弃素材。
- `role` 可为 `reference`、`first-frame`、`last-frame`、`character`、`scene`、`motion`、`voice`、`sound`、`music`。非通用角色需在原提示词中明确对应标签。通用参考槽不保证严格首尾帧锁定。
- 参数可选：`durationSeconds`（5–15 的整数，缺省从提示词识别秒数，否则10）、`aspectRatio`（缺省按首帧图片尺寸选最接近的支持比例；没有首帧时16:9）、`megapixels`、`steps`、`promptOptimization`、`highestConsistency`、`interpolation`、`loraStrength`、`zipOnly`。

## 命令

先在一个终端启动执行器：

```text
node service/cli.mjs start
```

在另一个终端预览、提交和查看：

```text
node scripts/h3.mjs prepare --manifest INPUT.json --journal NEW.json
node scripts/h3.mjs generate --journal SAME.json
node scripts/h3.mjs status --journal SAME.json
node scripts/h3.mjs resume --journal SAME.json
```

`prepare` 会固定操作 ID 并写入本机 journal。网络重试须使用相同 journal 和操作 ID。`generate` 只把同一账本任务排队，重复调用不会新建或再次提交任务；`status` 和 `resume` 只读取该任务状态，不提交任务。结果状态、任务 ID和服务收到的费用字段会显示在查询结果中；远端没有提供费用时保持未知。若下载 URL 含有 RunningHub 签名凭据，服务会隐藏该链接，使用任务 ID 在 RunningHub 账户界面查看结果。

服务在发起远端任务前先持久化 `submitting` 意图。若进程在提交期间退出或响应不明确，任务会成为 `submission_unknown`，不会自动重发。先到 RunningHub 账户确认是否已有任务；若找到任务，使用 `node service/cli.mjs job attach-task JOB_ID RUNNINGHUB_TASK_ID` 将原任务接回本地轮询。确认没有远端任务后，可用 `node service/cli.mjs job resolve-not-accepted JOB_ID` 释放该本地并发槽；该命令只关闭原账本项，不会重提任务。未核实前不要另建任务。

输入参数映射见 [H3 应用参数](references/app-parameters.md)。成功状态不代表画面或音频质量验收；需要打开结果并检查画面、时长和音轨后再作质量描述。

## 多段生成经验

- 用户明确选定并保留的成片，按 job ID 冻结；后续段落不得覆盖或自动重跑。除非用户要求多个版本，每个后续段落单独创建一个 journal 和一个生成任务。
- 多任务并发时遵循用户对 Key 的要求。若用户要求不同 Key，提交前确认有足够的、已验证且账户组互异的消费级 Key；在每份 manifest 填入所需 `keyId`。提交后从任务状态核对实际 Key/账户组绑定。一个账户组的本地并发上限为1；容量不够时不要悄悄复用。
- 用前段尾帧作后段连续性参考时，保留原片，并明确说明参考图只是构图/连续性锚点；通用图片槽不保证严格首帧锁定。提示词还应写明后段开场状态和交给下一段的视觉接点。
- 生成后按可访问的输出验收实际时长、画幅、分辨率、帧率和音轨；抽查开头、中段、结尾及转场。音轨存在不代表对白清晰或情绪到位，涉及声音质量时需要实际试听再作判断。请求时长是目标值，报告时优先使用文件元数据中的实际时长。
- 费用分别报告远端回传的消费级账户币数和钱包金额；未返回的费用继续记为未知，不推断免费或只扣平台币。恢复任务用原 journal 的 `status`/`resume`，不新建任务替代。
