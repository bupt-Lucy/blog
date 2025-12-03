---
title: 2-ai项目-启动+最小闭环+多轮记忆链路
tags: [langchain4j,agent]
categories: [项目实战]
poster:
  topic: 标题上方的小字
  headline: 大标题
  caption: 标题下方的小字
  color: 标题颜色
date: 2025-12-02 19:00:03
description: 反复沉淀版
cover:
banner:
sticky:
mermaid:
katex:
mathjax:
topic:
author:
references:
comments:
indexing:
breadcrumb:
leftbar:
rightbar:
h1:
type: tech
---
### 项目简介
#### 项目定位
- AI 恋爱大师应用（后续修改）：围绕情感问题的多轮对话助手
- 超级智能体 YuManus：基于 ReAct 的自主规划与工具调用
- 工具与 MCP 服务：搜索、文件、PDF、图片检索等
#### 技术栈总览
- 基础框架：Java 21 + Spring Boot 3
- AI 框架：Spring AI（主线）
- 模型接入：DashScope（通义/百炼）云模型；Ollama 本地模型作为可选
- RAG / 向量化：PgVector
- 工程化能力：Advisor 链、多轮记忆、结构化输出、SSE、Tool Calling、MCP、Agent
### 环境准备
- jdk版本问题
- pgVector本地数据库
- Dashcode Key 配置
### 启动成功与最小闭环验证
1. 启动过程
- 启动命令：IDEA Run
- 观察点：profile 是否是 local、datasource 是否成功、模型是否鉴权成功

2. 关键日志解读
- profile is active: local → 配置文件正确加载
- Calling EmbeddingModel for document id = ...
  - 说明 DashScope key 生效
  - RAG 初始化阶段在向量化
- Tomcat started on port 8123 ... /api
  - 服务启动成功
  - 基础访问路径：http://localhost:8123/api

3. Swagger 入口与调用
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202512031318436.png%}
- 找到接口：GET /ai/love_app/chat/sync
- 参数含义
  - message
  - chatId（多轮主键）
- 第一次调用（最小闭环）
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202512031319934.png%}
4. 多轮记忆实验
- 第 2 轮要求复述
- chatId 不变 → 模型记住
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202512031320099.png%}

### 源码解析
#### 最短调用链
- Controller
  - GET /love_app/chat/sync
  - 只负责转发 message/chatId

- Service / App 层
  - LoveApp.doChat(message, chatId)
#### doChat
```java
public String doChat(String message, String chatId) { 
  ChatResponse chatResponse = chatClient 
    .prompt() 
    .user(message) 
    .advisors(spec -> spec.param(ChatMemory.CONVERSATION_ID, chatId)) 
    .call() 
    .chatResponse(); 
  String content = chatResponse.getResult().getOutput().getText(); 
  log.info("content: {}", content); return content; }
```
- prompt()：创建请求构建器
- user(message)：本轮输入
- advisors(param CONVERSATION_ID, chatId)
  - 把 chatId 传给记忆 Advisor
  - beforeCall load 历史
  - afterCall save 回写
- call()：发给 LLM
- chatResponse()：解析输出

#### ChatClient初始化
```java
private final ChatClient chatClient; 
private static final String SYSTEM_PROMPT = 
"扮演深耕恋爱心理领域的专家。开场向用户表明身份，告知用户可倾诉恋爱难题。" 
+ "围绕单身、恋爱、已婚三种状态提问：单身状态询问社交圈拓展及追求心仪对象的困扰；" 
+ "恋爱状态询问沟通、习惯差异引发的矛盾；已婚状态询问家庭责任与亲属关系处理的问题。" 
+ "引导用户详述事情经过、对方反应及自身想法，以便给出专属解决方案。"; 
/** * 初始化 ChatClient * * 
 * @param dashscopeChatModel */ 
public LoveApp(ChatModel dashscopeChatModel) { 
  // 初始化基于文件的对话记忆 
  // String fileDir = System.getProperty("user.dir") + "/tmp/chat-memory"; 
  // ChatMemory chatMemory = new FileBasedChatMemory(fileDir); 
  // 初始化基于内存的对话记忆 
  MessageWindowChatMemory chatMemory = 
    MessageWindowChatMemory.builder() 
      .chatMemoryRepository(new InMemoryChatMemoryRepository()) 
      .maxMessages(20) 
      .build(); 
      chatClient = ChatClient.builder(dashscopeChatModel) 
        .defaultSystem(SYSTEM_PROMPT) 
        .defaultAdvisors( 
          MessageChatMemoryAdvisor.builder(chatMemory).build(), 
          // 自定义日志 Advisor，可按需开启 
          new MyLoggerAdvisor(), 
          // 自定义推理增强 Advisor，可按需开启 
          new ReReadingAdvisor() 
          ) 
          .build(); }
```
- ChatModel 注入
  - LoveApp(ChatModel dashscopeChatModel)
  - Spring AI Alibaba 自动注入 DashScopeChatModel

- SYSTEM_PROMPT
  - 现在是恋爱心理专家的角色 prompt
  - 换皮阶段只需要换这里

- ChatMemory 选择
  - InMemoryChatMemoryRepository
  - MessageWindowChatMemory(maxMessages=20)
  - 优点：简单、快速
  -  缺点：重启丢历史
  - 预留：FileBasedChatMemory（后面可切持久化）

- defaultAdvisors
  - MessageChatMemoryAdvisor：记忆核心
  - MyLoggerAdvisor：可观测性（打印 prompt/response）