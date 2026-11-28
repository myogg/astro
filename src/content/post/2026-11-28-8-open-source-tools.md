---
title: "本周 8 款优质开源工具｜AI 代理、代码评审、本地检索、自托管记账全都有"
date: "2026-11-28 14:33"
description: "本周开源工具精选：8 个偏向 AI 代理、开发调试、本地检索、自托管服务的项目，覆盖代码审查、逆向工程、本地知识库、在线表格、私人记账、手机远程开发。"
tags: ["开源", "DevTools", "AI Agent", "自托管", "效率工具"]
---

又到本周开源工具精选，这次一共挑选 8 个偏向 AI 代理、开发调试、本地检索、自托管服务的项目，覆盖代码审查、逆向工程、本地知识库检索、在线表格、私人记账、手机远程开发，适合全栈开发者、喜欢自托管和折腾本地 AI 工作流的朋友。全部附上 GitHub 仓库链接，按需体验。

## 1. t3code｜多AI编程助手统一控制面板

仓库：https://github.com/pingdotgg/t3code

一个统一控制面板，用来管理 Claude Code、Codex 等多款 AI 编程助手。支持网页、手机远程访问，远程调度本地 AI 编码任务，不用来回切换终端和网页，适合经常同时调用多个 AI 编码工具的开发者。

类型：Web / CLI 开发面板｜依赖 Bun

## 2. rea｜Agent 驱动逆向工程工具

仓库：https://github.com/morluto/rea

基于 MCP 协议的逆向 CLI 工具，可以交给 AI Agent 去分析二进制文件、网页、.NET 程序。本地运行，把逆向的繁杂分析交给 AI 自动完成，适合安全研究、逆向爱好者。

类型：MCP Agent 工具｜npx 一键拉起

## 3. kensaku｜本地文件语义检索（支持 MCP）

仓库：https://github.com/kensaku-search/kensaku

跨平台本地文件检索引擎，自带 PDF、截图 OCR 识别，支持接入 MCP。可以直接给你的 AI Agent 提供本机文件检索能力，让大模型读取你本地文档、笔记、截图，搭建私有本地知识库。

类型：本地语义检索｜Rust 项目

## 4. univer｜开源在线表格/文档组件

仓库：https://github.com/dream-num/univer

开源类 Excel / Word 组件库，可直接嵌入自己的网站、后台系统。支持表格、富文本、多人协作，如果你想在自己的 Astro 站点或者内部后台做表格功能，它是一个轻量可二次开发的选择。

类型：前端文档组件｜pnpm 开发

## 5. ag-ui｜AI 智能体交互协议

仓库：https://github.com/ag-ui-protocol/ag-ui

一套标准化 AI Agent 交互协议，解决 Agent 任务流程不统一的问题。支持任务中途暂停、人工确认、进度可视化展示，适合自己搭建复杂自动化 Agent 工作流。

类型：Agent 交互规范 & 调试 Demo

## 6. sure｜自托管私人记账系统

仓库：https://github.com/we-promise/sure

Maybe Finance 的社区分叉版本，隐私优先的私人记账服务。支持 Docker 一键部署，数据自己掌控，没有第三方统计，适合不想把收支数据上传到商业记账平台的人。

类型：自托管记账｜提供 ghcr 镜像

## 7. open-code-review｜阿里开源 AI 代码审查工具

仓库：https://github.com/alibaba/open-code-review

基于 Git 变更做 AI 代码评审。自动读取 diff，识别代码风险、逻辑问题、边界异常，对接 Ollama 等本地大模型就能跑，适合给自己的代码仓库加上轻量 AI 评审。

类型：AI 代码评审｜Docker 可部署

## 8. dsh-Go｜DSH Android 客户端

仓库：https://github.com/ccch1mneyyy/dsh-Go

DSH 的安卓客户端，手机上远程操控 DSH 服务，随时随地提交、运行代码任务。非常适合只有手机、不方便一直守在电脑前调试任务的场景。

类型：Android 客户端｜需要编译 APK

## 简单小结

这批项目偏向「AI Agent + 本地私有化 + 远程开发」：

- 想做本地 AI 工作流：rea、kensaku、open-code-review
- 想自托管服务：sure
- 想嵌入表格文档：univer
- 手机远程开发：dsh-Go
- 统一管理 AI 编程助手：t3code
- 标准化 Agent 交互：ag-ui

提示：sure、open-code-review 提供容器镜像，其余几个大多是源码编译 / npx 启动；我之前给过对应的 docker-compose 和启动命令，感兴趣可以直接拉起来测试。
