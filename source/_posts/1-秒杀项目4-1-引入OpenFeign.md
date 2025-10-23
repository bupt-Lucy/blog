---
title: 1-秒杀项目4.1-引入OpenFeign
tags: [微服务架构,OpenFeign]
categories: [项目实战]
poster:
  topic: 标题上方的小字
  headline: 大标题
  caption: 标题下方的小字
  color: 标题颜色
date: 2025-10-22 15:26:35
description: 人参果味道很大版
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

### 实现微服务之间的架构：引入OpenFeign
- 在V4.0中，通过拆分实现了微服务架构，seckill-api和order-service实现了异步解耦。seckill-api将订单消息扔进RAbbitMQ。order-service监听队列，处理消息。但这种模式只适用于单向的，不需要立即回复的场景。如果seckill-api在执行秒杀之前，需要立刻知道用户的信用积分或者需要实时查询order-service某个订单的状态。此时，通过RAbbitMQ联系的异步方式无法满足需求，seckill-api必须能给order-service同步调用，并且能在原地等待对方的回复。
- 在V4.1中，引入Spring Cloud OpenFeign。
#### 配置
- 通过演练一个Echo测试，让seckill-api向order-service发送一条消息，order-service收到后，将消息原样返回。
##### Order-service 接听方
- 创建接听接口，新建 OrderEchoController 类
``` Java
@RestController
public class OrderEchoController {

    private static final Logger log = LoggerFactory.getLogger(OrderEchoController.class);

    // 从 Nacos 配置中心读取自己的端口号
    @Value("${server.port}")
    private String serverPort;

    // 【关键】这个 API 路径必须与 Feign 客户端的定义一致
    @GetMapping("/api/v1/order/echo/{message}")
    public String echo(@PathVariable String message) {
        log.info("收到了来自 seckill-api 的 Feign 请求: {}", message);
        return "Hello from order-service on port " + serverPort + ", I received: " + message;
    }
}
```
##### seckill-api 呼叫方
- 在 seckill-api 的 pom.xml 中，添加两个新依赖：
```XML
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-openfeign</artifactId>
</dependency>

<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-loadbalancer</artifactId>
</dependency>
```
- 修改主启动类 (SeckillApiApplication.java)，添加 @EnableFeignClients 注解来激活 Feign 功能。
- 创建Feign接口，在seckill-api项目中新建client包，创建OrderServiceClient.java接口：
``` Java
@FeignClient(name = "order-service")
public interface OrderServiceClient {

    // 【关键】这个方法签名和路径，必须与 order-service 中的 Controller 完全一致
    @GetMapping("/api/v1/order/echo/{message}")
    String echo(@PathVariable("message") String message);
}
```
- 创建测试用的TestFeignController.java，用于触发Feign调用：
``` Java
@RestController
public class TestFeignController {

    private static final Logger log = LoggerFactory.getLogger(TestFeignController.class);

    @Autowired
    private OrderServiceClient orderServiceClient;

    @GetMapping("/test-feign/{message}")
    public String testFeign(@PathVariable String message) {
        log.info("即将通过 Feign 调用 order-service...");

        // 【关键】像调用本地方法一样，调用远程服务！
        String response = orderServiceClient.echo(message);

        log.info("收到 order-service 的回复: {}", response);
        return "Feign Call OK! Response: " + response;
    }
}
```
#### 测试
##### 启动
- 本地 MySQL 正在运行。
- 确保 docker-compose.yml 中的所有中间件（Nacos, Redis, MQ...）都已启动 (docker-compose up -d)。
- 启动 order-service 和 seckill-api。
##### E2E测试
- 打开浏览器，访问 seckill-api 上我们新创建的测试接口：http://localhost:8080/test-feign/Hello_Microservice
##### 结果
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510221545696.png %}
{%Image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510221546915.png %}
- 浏览器显示：Feign Call OK! Response: Hello from order-service on port 8081, I received: Hello_Microservice
### 学学八股
#### OpenFeign
- **工作原理**
1. Spring 的动态代理：
  - 当seckill-api启动时，扫描到SeckillApplication上有@EnableFeignClient注解。
  - 扫描指定包或所有包，找到了OrderServiceClient这个接口（有注解，@FeignClient(name = "order-service")）。发现这是一个@FeignClient接口，Spring不会去寻找这个接口的实现类，而是在内存中动态地创建了一个“代理实现类”。
  - 当TestFeignController需要@Autowired一个OrderServiceClient时，Spring就会把这个在内存中动态生成的代理对象注入进去，
2. 调用时：当调用OrderServiceClient.echo("Hello")时，实际上是对这个代理对象下达命令，这个代理对象内部的调用处理器会立刻被激活，并执行下列命令。
  - 解析指令：代理对象会查看调用的echo方法，并读取上面的注解：@GetMapping("/api/v1/order/echo/{message}") 和 @PathVariable String message
  - 服务发现：代理对象通过查看接口上的注解@FeignClient(name = "order-service")，发现目标服务名为order-service，它立刻向DiscoveryClient(Nacos客户端)发起查询，得到order-service的所有健康的服务实例列表和地址。
3. 负载均衡：Nacos可能返回多个实例地址，而loadbalancer这个负载均衡器会从列表中选择一个最佳的实例。
4. 构建并进行HTTP请求：代理对象现在拥有了所有信息（协议、主机、端口、路径），在底层使用一个真正的HTTP客户端，将这些信息组装成一个完整的HTTP请求，真正的通过网络发送出去。
5. 返回结果：代理对象在原地阻塞等待，直到order-service返回了HTTP响应，Feign会自动将这个JSON响应反序列化为接口方法中定义的返回类型。最后将这个结构返回给TestFeignController。
#### Nacos和服务治理
- **为什么选择Nacos？它和Zookeeper,Eureka有什么区别？**
- Eureka 已经停止积极维护，而 Zookeeper 的设计初衷是分布式协调，用作注册中心过于“笨重”。Nacos 则是为现代云原生微服务架构而生的。
  - Eureka: 遵循 AP 原则。它优先保证“可用性”。即使集群中只有一台服务器存活，它也敢于返回服务列表（尽管可能包含“已死亡”的服务）。它牺牲了短期的一致性，来换取服务注册中心的“永远可用”。
  - Zookeeper/Consul: 遵循 CP 原则。它们优先保证“一致性”。在选举“领导者”期间，整个注册中心是不可用的，它们无法容忍返回“可能错误”的数据。
  - Nacos: Nacos 是一个“墙头草”，但这是它最大的优点。它既支持 AP 模式（用于服务发现），也支持 CP 模式（用于配置中心）。它允许在高可用和强一致性之间灵活切换。
- 功能集成度：选择 Nacos 最关键的原因是，它一个组件就同时提供了‘服务注册发现中心’和‘统一配置中心’两大核心功能。如果用 Eureka，就必须再额外搭建一套 Spring Cloud Config 来管理配置，这会大大增加系统的运维复杂度。Nacos 提供了一站式的解决方案。
- **Nacos是怎么知道服务实例还活着？**
  - 客户端心跳 (Heartbeat)： order-service 在向 Nacos 注册后，其内置的 Nacos 客户端会启动一个定时器，每隔几秒钟（默认5秒）就主动向 Nacos 服务器发送一个“心跳包”，告诉 Nacos：“我还活着。”
  - 服务端剔除 (Eviction)： Nacos 服务器会持续地检查所有注册上来的服务。如果它发现某个服务实例（比如 order-service-instance-1）超过一定时间（默认15秒）没有发来心跳，Nacos 就会主观地认为这个实例已经“失联”，并将其健康状态标记为 false（不健康）。
  - 服务发现： 此时，如果 seckill-api 再来查询 order-service 的地址列表，Nacos 将不会把这个“已失联”的实例地址返回给它，从而避免了 seckill-api 调用到一个已经“死亡”的服务。
#### OpenFeign和负载均衡
- **OpenFeign、Nacos和LoadBalancer是如何联动工作的？**
  - Nacos： 负责提供 order-service 所有健康实例的完整列表（比如 [localhost:8081, localhost:8082]）。
  - LoadBalancer： 负责从这个列表中，按照一种策略（比如轮询），选择一个实例出来（比如这次选 localhost:8081）。
  - OpenFeign： 负责拿着 LoadBalancer 选出来的这个唯一地址，去发起真正的 HTTP 网络调用。
#### 架构决策
- **为什么选择RabbitMQ（异步）和OpenFeign（同步）?**
  - 使用 RabbitMQ (异步) 来处理“创建订单”：因为“秒杀下单”这个动作，不需要用户在原地等待数据库写入成功。追求的是前端的高吞吐量和快速响应，以及后端（数据库）的“削峰填谷”和可靠性。MQ 是这个场景的完美选择。
  - 使用 OpenFeign (同步) 来处理“前置校验”：比如在用户点击秒杀时，需要实时查询“用户服务”的信用积分。必须拿到“积分足够”这个同步的回复之后，才能决定是否继续执行后续的 Redis 操作。在这种“必须立即获得回复才能继续下一步”的场景下，OpenFeign 是最佳选择。
  - 对于不需要实时返回结果、且下游耗时较长的业务（如下单），我使用 MQ 异步解耦；对于需要实时返回结果、且依赖对方数据才能继续的业务（如前置校验），我使用 Feign 同步调用。