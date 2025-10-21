---
title: 1-秒杀项目4.0-拆分微服务并引入Nacos
tags: [Nacos,微服务架构]
categories: [项目实战]
poster:
  topic: 标题上方的小字
  headline: 大标题
  caption: 标题下方的小字
  color: 标题颜色
date: 2025-10-21 15:02:43
description: 新的开始版
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

### “扩展性”瓶颈：拆分微服务并引入Nacos
- 在V3.X，我的seckill-system包揽了所有工作：
  - 处理前端高并发请求（Nginx限流转发）
  - 操作Redis（高速）
  - 发送RabbitMQ（异步）
  - 消费RabbitMQ（慢速）
  - 写入MySQL数据库（慢速，I/O密集）
- 但是当系统面临超大流量时，将会面临一个“扩展性”瓶颈，这两个职责被捆绑在同一个服务中，如果MQ消息堆积，唯一的方法是启动第二个Seckill-app实例，但这也被迫复制了一份SeckillService，造成了巨大的资源浪费和管理混乱。
  - SeckillService：高频、低延迟、CPU密集型（处理Web请求，操作Redis）
  - OrderConsumerService：低频、高延迟、I/O密集型（消费MQ、写数据库）
- 在V4.0，希望系统职责分离，将单体应用拆分为seckill-api和order-service两个微服务，让他们可以独立部署、独立扩展。
  - seckill-api（秒杀网关服务）--追求响应速度:
    - 接收所有前端的HTTP请求
    - 校验请求
    - 执行极速的Redis Lua脚本
    - 发送订单消息到RabbitMQ
  - order-service（订单服务处理）--追求可靠性和数据一致性:
    - 监听RabbitMQ的seckill.order.queue队列
    - 消费订单消息
    - 执行完整的、带事务和熔断保护的数据库操作。
#### 配置
- 引入Nacos作为统一配置中心
- 实现：
  - 在 docker-compose.yml中启动nacos-server
  - 在两个微服务中都引入spring-cloud-starter-alibaba-nacos-config 和 spring-cloud-starter-bootstrap。
  - 在 bootstrap.properties 中，配置 spring.cloud.nacos.config.server-addr=localhost:8848，让应用启动时优先从 Nacos 拉取配置。
  {%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510211552908.png %}
  {%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510211553768.png %}
  - 在 Nacos UI 上创建 seckill-api.yaml 和 order-service.yaml，将所有配置（数据库、MQ、Redis、熔断器...）集中管理。
#### 代码重构
- seckill-api ：
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510211559684.png %}
  - pom.xml: 移除了 resilience4j，本来计划同样移除 data-jpa 和 mysql-connector-j，但是Redis预热需要从MySQL获取初始的库存信息，所以暂时不能移除。
  - SeckillService.java: executeSeckill 方法被极大简化，现在只负责执行 Redis Lua 脚本和发送 RabbitMQ 消息。
  - RedisPreheatService.java: 保留。做出了架构权衡，允许 seckill-api 在启动时连接 MySQL，仅用于数据预热，以避免复杂的启动时序依赖。
- order-service (后厨) 的“新生”：
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510211559894.png %}
  - pom.xml: 引入了 amqp, jpa, mysql, resilience4j, nacos 等全套依赖。
  - OrderConsumerService.java:
    - 使用 @RabbitListener 监听队列，并配置高并发消费（spring.rabbitmq.listener.simple.concurrency=10）。
    - 结合 @CircuitBreaker (外部熔断) 和 @Transactional (内部事务)，并解决了 AOP 代理问题。
    - 实现了完整的“业务异常（SeckillBusinessException）被捕获”和“系统异常（Exception）被抛出”的专业错误处理模型，熔断器相关。
- 注意，seckill-api 需将 Map 对象正确地序列化为 JSON 字符串发送出去。order-service 收到这个 JSON 字符串后，它的 Jackson2JsonMessageConverter 会成功地将其反序列化为 Map 对象，并传递给 receiveOrderMessage 方法。
### 测试
- 启动：在 IDEA 中启动 seckill-api 和 order-service 两个应用
- Nacos 验证：在 localhost:8848 上，可以看到两个服务都已注册成功，并且上报的 IP 是 host.docker.internal
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510211551227.png %}
- E2E 测试：
  1. JMeter请求 http://localhost:80（Nginx）
  2. Nginx成功转发搭配host.docker.internel:8080（seckill-api）
  3. seckill-api 日志显示
  {%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510211550031.png %}
  4. order-service日志显示
  {%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510211551264.png %}
  5. 本地数据库显示数据正确。
- 整条线路逻辑：Nginx -> seckill-api(Host) -> RabbitMQ(Docker) -> order-service(Host) -> MySQL(Host)

### 学学八股
#### 微服务架构
- 微服务是一种架构风格，将一个大型复杂应用，拆分为一组小型的、独立的服务。
- 优势：
  - 独立扩展性：可以只扩展 order-service，而不必扩展 seckill-api。
  - 技术异构性：seckill-api 可以用 Go，order-service 可以用 Java。
  - 高内聚与单一职责： 代码库更小、更专注，易于维护。
  - 团队自治： 不同的团队可以独立负责自己的服务。
- 挑战：
  - 分布式复杂性：需要解决服务间如何通信、如何发现对方的问题。
  - 运维复杂度：部署和管理 10 个服务，远比管理 1 个服务复杂。
  - 分布式事务：跨多个服务的数据一致性是个巨大难题。
  - 网络延迟：服务间调用远慢于单体应用内部的方法调用。
#### Nacos服务治理
- 服务注册：order-service 启动时，会向 Nacos（注册中心）发起一个 register 请求，告诉 Nacos：“你好，我是 order-service，我的 IP 地址是 host.docker.internal，端口是 8081。”
- 服务发现：当 seckill-api 需要调用 order-service 时，它会去问 Nacos：“你好，请告诉我 order-service 的所有可用实例列表。” Nacos 就会把 host.docker.internal:8081 这个地址返回给它。
- 心跳机制：order-service 注册成功后，会定期向 Nacos 发送“心跳包”。如果 Nacos 连续一段时间没有收到某个实例的心跳，它就会认为这个实例已宕机，并将其从服务列表中剔除，防止其他服务调用到一个“已死亡”的实例。
#### Nacos统一配置中心
- 配置集中管理： 将所有应用的配置（application.yaml）从各自的项目中抽离出来，统一存储在 Nacos 服务器上。
- 动态刷新： 当在 Nacos 网页上修改一个配置项（比如数据库密码）并点击“发布”后，Nacos 会主动通知 seckill-api 和 order-service。应用会自动拉取新配置，并在不重启的情况下让新配置生效（需要 @RefreshScope 注解配合）。
- bootstrap.properties 的作用：
  - 它是一个“引导”配置文件，其加载优先级高于 application.properties。
  - 它的唯一作用就是告诉 Spring Boot：“我的应用名是什么？我的配置中心（Nacos）在哪里？”
  - Spring Boot 会先加载它，连接上 Nacos，从 Nacos 拉取回所有“真正”的配置，然后再用这些配置来启动应用。