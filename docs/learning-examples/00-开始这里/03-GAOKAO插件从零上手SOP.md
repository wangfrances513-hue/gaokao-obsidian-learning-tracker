# GAOKAO 插件从零上手 SOP

Learning Examples 仅承载示例、指南和六科 Prompt，不承载真实学习记录。公开示例不附带插件安装或学习数据。社区插件按 Vault 安装；正式学习使用你自己的 Personal Learning，先核对该 Vault 的实际安装与启用状态。无需为了阅读示例安装插件，安装文件存在也不等于完成原生运行验收。

## 当前版本与安装更新

文档口径：R1–R5 v0.2；发布版本：`0.1.0-rc.1-gaokao.2`。下载 [最新版安装包](https://github.com/wangfrances513-hue/gaokao-obsidian-learning-tracker/releases/latest)。源码 ZIP 不是可安装插件包；同一发布页的 main.js、manifest.json、styles.css 必须成套使用。

目标 Vault 已有插件时，先备份该插件目录的三个文件与 data.json，再在确认的目标 Vault 停用插件，替换三个文件并重新启用；保留 data.json，不能复制其他 Vault 的数据。新安装把三个文件放入 `<目标 Vault>/.obsidian/plugins/obsidian-spaced-repetition/`，再在该 Vault 的社区插件设置启用 Spaced Repetition。不要关闭身份不明的其他 Vault 窗口。

按 `⌘P` 打开命令面板（非 macOS 使用对应快捷键）。常用命令：

|命令|用途|
|---|---|
|GAOKAO: Open Today|打开到期、最低建议和推荐学习|
|GAOKAO: Create subject learning note|按六科 18 个现有模板创建 Entity|
|GAOKAO: Capture image evidence|单次捕获一张本地 JPEG/PNG 并创建/复用受管附件|
|GAOKAO: Record study/practice/verification|选择完成本轮，或仅记录普通历史事件|
|GAOKAO: Show recent learning events|核对当前 Entity 的历史|
|GAOKAO: Validate current note|校验身份与 schema；不替代正文结构检查|

空白标签页通常只有 Today、创建和图片入口；Validate 需要 Markdown，记录和历史命令需要有效 GAOKAO Entity。看不到命令时先确认当前 Vault 和插件启用状态。

## 材料准备与十个标准区块

用插件选择学科、模板和标题。模板决定实体类型与默认目录，不能仅改文件夹。`knowledge_point` 自身就是知识点；`problem_case` 的图片捕获必须关联同科唯一有效的已有知识点。不要新造 ID 体系，保留插件生成的 YAML、gaokao_id、关联及 review tag；整理旧笔记保留既有 sr-* 和历史。

正文依次保留十个二级标题：Source、Prompt、Cues、Core Idea、Error Boundaries、Solution Skeleton、Original Evidence、Detailed Solution、Deep Dive、Variant Pool。每个只出现一次；只有一个一级标题，与文件名去掉 .md 完全相同。一级标题后首个区块前只能有空行；学科细分用区块内加粗标签，不能添加中文二级或三级标题。

Source 放真实来源定位；Prompt 写可独立作答且无答案的题面或具体重建任务；Cues 用 3–5 行短关键词，每行以 `- ` 开头，不超过 80 字符，无答案、嵌图或 HTML。其余区块没有依据时留空，不能删除固定标题，也不能用假题号、假错因或占位句冒充就绪。

文字、照片、截图、多图和混合输入都可交给通用 Prompt 整理；先核对本次指定附件，不能误用旧图片。插件的单次图片捕获仍只接收一张 JPEG/PNG，最大 25 MiB。多图先明确同题/多题关系，不声称插件支持自动批量入库。

完整原图与每张图实际 SHA-256 只放 Original Evidence：使用插件返回的 Vault 相对路径 `![[路径]]`，不用别名、宽度或锚点；Source 可用无 `!` 的普通链接。Prompt 默认只放无答案文字，含答案/批改的图片不能展开。纯文字不编造图片与 SHA。保留收件原件路径和字节，不自动移入归档目录。

材料创建和 AI 补写正文不会自动完成 R1，不生成学习事件、用户评分或排期。关闭随后打开的完成对话框即可保留材料而不提交本轮。

## R1–R5：实际行动后完成本轮

|当前轮次|实际行动|本次完成事件|默认下一轮|
|---|---|---|---|
|R1|确认材料已关联、准确 Entity/学科、可读来源及原件保留；不表示掌握|study|R2|
|R2|先看 Identity、Source、无答案 Prompt，实际尝试重建，再记录|review|R3|
|R3|先看 Identity、Source、3–5 个 Cues，实际尝试回忆，再记录|review|R4|
|R4|完成一题陌生同构题，记录真实题目和作答位置|practice|R5|
|R5|现实验证并核对结果，如实选择实际模式|verification|R5|

从 Today 进入当前行动；也可在目标笔记运行 Record，选择“完成本轮（评分可不选）”。R2/R3 先完成展示前确认，尝试后再点底栏“完成本轮”，核对结果对话框后提交。其他语义区块默认折叠，尝试后可手动展开；展示不重写 Markdown。R4/R5 从 Today 到结果入口，不默认打开原 Entity 答案。

每次成功完成仅追加一条上述类型的事件，R1/R4/R5 不额外追加 review。提交前取消/关闭产生 0 条完成事件；提交后等待结果，不连续点击。Round 由事件链推导，完成后即使进入下一轮，也须尊重原 scheduler 的 due date，不能手改日期让它立即到期。

R4/R5 的证据必须发生在本周期建立之后、提交之前，尚未入账，不能跨 Entity、跨轮次/周期重复消费。旧的已入账活动不能再拿来抵扣完成本轮。

R5 Mixed 是实际混合考试：确认整卷限时，作答前未得到对应模型提示；Isolated 是专项验证，确认实际满足专项条件。两者都要实际作答并核对结果；失败也可如实记录，进入 R5 不代表通过。只有明确选择 Isolated 的单题速度验证时，才接受事后单题时长。R1–R4 没有新的计时路径。

## 可选评分、普通历史与排期

|当前轮次|未评分 / Again / Hard|Good / Easy|
|---|---|---|
|R1|R2|R2|
|R2|R3|快进 R5|
|R3|R4|快进 R5|
|R4|R5|R5|
|R5|保持 R5|保持 R5|

未评分不保存用户 rating，也不代表答对。scheduler 内部使用 Good fallback 计算排期，不能冒充用户选择 Good。Again/Hard 如实保存为学习历史；后续无评级完成不抹掉最近一次明确的 Again/Hard。关注实际尝试、明确状态与事件；前期轮次不以时长为主要目标，不新增 mastery/confidence/timer 等字段。

“仅记录普通历史事件”只追加普通 study/practice/verification 历史，不推进 Round，也不替代“完成本轮”的排期提交。一次活动不要先记普通事件再拿来完成 R4/R5。普通非 GAOKAO 整笔记复习沿用既有逻辑。不要为同一次 Round 完成再额外补一次整笔记评分。

排期仍由现有 whole-note scheduler 单独写入 sr-due、sr-interval、sr-ease；Today、Prompt 和 AI 都不维护第二套日期。不要编辑 data.json 或手工拼接 Learning Events。

## Today 的日常使用

运行 Open Today，先核对 Round、最近明确状态、下一行动和待核对提示。到期项来自持久化 scheduler 日期，逾期优先；默认最低建议取前三项，但其余到期项仍保留，不被科目权重隐藏。未排期的有效条目可以进入推荐学习，默认最多三项；无需先伪造一次评分才能出现。未到期已排期项不冒充新推荐。

完成、修订材料或重新索引后可点击 Today 的“刷新”重新核对；没有目标条目时检查身份唯一、review tag、忽略路径、scheduler 就绪及排期收据。Today 不显示普遍时长估计，也不按时长排序；它是行动入口，不是第二个调度器。

## 常见阻断与恢复

- 标题外正文/图片、未知或重复标题、Cues 不合规：按十区块重排；Validate 通过仍须单独检查 R2/R3 结构。
- 来源为空、链接不可读、图片签名/SHA/规范路径不符：核对本次材料与原件，不改扩展名绕过检查。
- gaokao_id 重复、目标学科/路径变化：停止该条提交，核对唯一 Entity，不能创建替代 ID 掩盖问题。
- scheduler 写入失败：不能当作完成；Event 保存失败而 scheduler 已落地时，按 pending/补记提示核对同一次提交。不要删 pending 或重新评分。
- 恢复入口只在能区分 before/after 时继续原候选或补记固定事件；before=after、外部变化等不明确状态应保留待核对，不手改 data.json。
- 换窗格或内容改变后展示确认可能失效，重新准备当前轮次；怀疑重复时只读查看历史。

当前自动化和结构检查不等于完整原生验收；已完成的消融报告总体仍为 INCONCLUSIVE。原生首帧、异步图像、真实进程恢复仍有未验证边界。保留完整实现，不采用 P/A/I/E 删减变体。

## 示例与 Prompt

先读 [00-示范库主页](00-%E7%A4%BA%E8%8C%83%E5%BA%93%E4%B8%BB%E9%A1%B5.md)。使用 [六科高精度泛用Prompt](../%E6%8F%90%E7%A4%BA%E8%AF%8D/%E5%85%AD%E7%A7%91%E9%AB%98%E7%B2%BE%E5%BA%A6%E6%B3%9B%E7%94%A8Prompt.md) 的同一份主 Prompt，再选一行真实模板映射和对应学科约束；示例正文与 [条目通用骨架](../%E6%A8%A1%E6%9D%BF/%E6%9D%A1%E7%9B%AE%E9%80%9A%E7%94%A8%E9%AA%A8%E6%9E%B6.md) 使用同一十区块。合成示例不代表你已经完成、评分或排期，不复制示例身份/数据。
