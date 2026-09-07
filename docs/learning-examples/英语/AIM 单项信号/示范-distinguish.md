# 示范｜英语手动 AIM 单项信号：distinguish

## 这个类型应该怎么写

仅在用户明确把该词确认为需要保留的 AIM 单项信号时使用此模板。条目不应只是“英文＝中文”，只保留当前语境、识别信号和最小主动产出任务。

## 成品范例

以下只复制正文到插件创建的 `distinguish.md`；保留插件 YAML。它是合成示例，不代表已经学习、评分或排期。

```markdown
# distinguish

## Source

本文件为合成教学示例，无真实个人作答或学习记录；下列题面与示例说明供核对写法，不冒充教材、试卷或教师批改。

## Prompt

补全并解释语境：It is important to distinguish facts ___ opinions. 再用 distinguish between 写一句表达相近含义的完整句。

## Cues

- 动词语境
- 介词搭配
- 自主造句

## Core Idea

**核心义（合成示例，非用户事实）**

**distinguish** /dɪˈstɪŋɡwɪʃ/ v. 辨别、区分；使有别于；看清/听出。

核心图景：识别两个或多个对象之间有意义的差异。

## Error Boundaries



## Solution Skeleton



## Original Evidence

纯文字合成示例；无实际图片附件，不提供虚构 SHA。原有教学说明已保留在相应区块；不能当成用户已作答证据。

## Detailed Solution

**高频结构（合成示例，非用户事实）**

- distinguish A from B：区分 A 与 B
- distinguish between A and B：辨别 A 与 B
- distinguish oneself：使自己脱颖而出
- be distinguished by：以……为特征

**词形家族（合成示例，非用户事实）**

- distinction n. 区别；卓越
- distinctive adj. 独特的；有辨识度的
- distinguished adj. 杰出的；著名的
- distinguishable adj. 可区分的

**语境例句（合成示例，非用户事实）**

It is important to distinguish reliable evidence from unsupported claims.

写作迁移：When evaluating online information, students should distinguish facts from opinions.

**易混辨析（合成示例，非用户事实）**

- distinguish：强调辨认差异，常接 `from` 或 `between`。
- differ：主语本身“不同”，常见 `A differs from B`。
- tell：口语中 `tell A from B` 表示分辨。
- discriminate：可表示辨别；涉及不公平区别对待时含贬义，需看语境。

## Deep Dive



## Variant Pool

**主动产出（合成示例，非用户事实）**

1. 用 `distinguish A from B` 写一句与网络信息判断有关的句子。
2. 把例句改写成 `distinguish between...and...`。
3. 解释 `distinctive` 与 `distinguished` 的差别。
```

## 图片体例与范围

至少保留完整句子和必要上下文，不要只截单词。可上传教材例句、完形/阅读语境、个人错选与词典释义的最小片段；词典来源要注明。

## 可复制空白体例

使用 [条目通用骨架](../../%E6%A8%A1%E6%9D%BF/%E6%9D%A1%E7%9B%AE%E9%80%9A%E7%94%A8%E9%AA%A8%E6%9E%B6.md)；保留十区块，实际填写后再校验。

## 英语词汇专用 Prompt（高精度版）

使用 [六科高精度泛用Prompt](../../%E6%8F%90%E7%A4%BA%E8%AF%8D/%E5%85%AD%E7%A7%91%E9%AB%98%E7%B2%BE%E5%BA%A6%E6%B3%9B%E7%94%A8Prompt.md#%E9%80%9A%E7%94%A8%E4%B8%BB-prompt)，附本页 TASK_TYPE 对应的学科规则。

### 本范例调用卡

```text
TASK_TYPE: english_manual_aim_signal
TOPIC: distinguish
TARGET: 插件生成新身份，或用户明确指定的既有 Entity
SOURCE_LIST:
- S1: [完整例句/阅读语境；页码题号行号；保留前后文]
- S2: [我的错选、造句或批改；精确区域]
USER_STATE: [我当时理解的词义、错选原因或想表达的中文]
ALLOWED_SCOPE: 先判定 S1 中的语境义，再处理词性、结构和搭配；不罗列无关罕见义项，不虚构词典或语料频率。
```
