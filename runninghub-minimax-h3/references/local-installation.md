# 本机安装

2026-10-08 已安装并将审查后的代码接入 C:/Users/lu/Desktop/boss/Manju-Agent-Studio。

当前独立验收服务：http://127.0.0.1:4328，复用原项目消费级密钥池和vault，任务库在原项目 .data/h3-skill-validation。调用 prepare 时传 --base http://127.0.0.1:4328。先检查 /api/health 确认服务与执行器在线。

主服务端口4312仍是旧进程，重启后新H3接口生效；届时可以将 --base 改为 http://127.0.0.1:4312。不要启动两个执行器处理同一任务库。

已授权的小猫真实小样 journal：
C:/Users/lu/.codex/visualizations/2026/10/08/01a11a8c-0b8d-7401-b8dd-238ecd83eb18/小猫大战恶龙/剧集/EP001/制作成果/统一风格版/H3真实小样_journal.json

恢复该小样只使用同一journal进行status/resume，不能再次prepare新的journal重生成。
