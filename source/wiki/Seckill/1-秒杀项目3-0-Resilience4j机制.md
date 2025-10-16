---
wiki: Seckill # 这是项目id，对应 /data/wiki/hexo-stellar.yml
title: 1-秒杀项目3.0-Resilience4j机制
tags: [熔断,降级,高弹性]
categories: [项目实战]
poster:
  topic: 标题上方的小字
  headline: 大标题
  caption: 标题下方的小字
  color: 标题颜色
date: 2025-10-16 13:15:26
description: 火力全开版
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

### 服务保护：引入Resilience4j
- 在V2.X系列中，通过Redis Sentinel 和RabbitMQ，构建了一个高可用的系统。但当系统依赖的下游服务（如MYSQL）出现故障时，它会不断地、执着地去尝试连接，最终可能因为大量线程被阻塞而自身崩溃。
- 在V3.0中，希望为系统用注入“弹性”，在面对下游故障时，能够智能“熔断”“降级”和“自动恢复”，从而避免雪崩效应。为了达到这个目标，引入Resilience4j。
#### 配置方案
- **集成 Resilience4j 依赖**
1. 在pom.xml中添加Spring Cloud 版本管理。因为Resilience4j的Spring Boot Starter是通过Spring Cloud 来管理的。
``` XML
<dependencyManagement>
    <dependencies>
        <dependency>
            <groupId>org.springframework.cloud</groupId>
            <artifactId>spring-cloud-dependencies</artifactId>
            <version>2021.0.8</version>
            <type>pom</type>
            <scope>import</scope>
        </dependency>
    </dependencies>
</dependencyManagement>
```
2. 在 pom.xml 中添加 Resilience4j Starter 依赖
``` XML
<dependencies>
    <dependency>
        <groupId>org.springframework.cloud</groupId>
        <artifactId>spring-cloud-starter-circuitbreaker-resilience4j</artifactId>
    </dependency>

    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-aop</artifactId>
    </dependency>
</dependencies>
```
- **配置熔断器规则**
- 在 application.properties 文件中，为“数据库写入”这个操作，定义一套详细的熔断规则。
``` Properties
# ================= Resilience4j Circuit Breaker Configuration =================
# 配置一个名为 dbWrite 的熔断器实例
# 失败率阈值：当失败率达到50%时，熔断器打开(跳闸)
resilience4j.circuitbreaker.instances.dbWrite.failure-rate-threshold=50
# 最小调用次数：在统计窗口内，至少调用10次后才开始计算失败率
resilience4j.circuitbreaker.instances.dbWrite.minimum-number-of-calls=10
# 滑动窗口类型：基于调用次数
resilience4j.circuitbreaker.instances.dbWrite.sliding-window-type=COUNT_BASED
# 滑动窗口大小：统计最近10次调用的结果
resilience4j.circuitbreaker.instances.dbWrite.sliding-window-size=10
# 熔断器打开后，保持打开状态60秒，然后进入半开状态
resilience4j.circuitbreaker.instances.dbWrite.wait-duration-in-open-state=60s
# 半开状态下，允许2次尝试调用来探测服务是否恢复
resilience4j.circuitbreaker.instances.dbWrite.permitted-number-of-calls-in-half-open-state=2
```
- **修改 `OrderConsumerService.java`**
``` Java
@Service
public class OrderConsumerService {
    
    // ... 其他注入的属性 ...

    @RabbitListener(queues = "seckill.order.queue")
    // 【核心改动】为这个消费者方法加上熔断器保护
    // name="dbWrite" 对应了在配置文件中定义的名字
    // fallbackMethod 指定了熔断发生时，要调用的降级方法
    @CircuitBreaker(name = "dbWrite", fallbackMethod = "fallbackForCreateOrder")
    @Transactional
    public void createOrderInDb(SeckillOrder order) {
        // 这个方法内部的数据库操作逻辑，完全保持不变
        log.info("从RabbitMQ接收到订单消息，准备创建订单: {}", order);
        orderRepository.save(order);
        int result = productRepository.deductStock(order.getProductId());
        if (result == 0) {
            throw new RuntimeException("MySQL库存扣减失败，订单回滚: " + order);
        }
        log.info("数据库订单创建成功");
    }

    /**
     * 【新增】降级方法 (Fallback Method)
     * 当 dbWrite 熔断器“跳闸”时，所有对 createOrderInDb 的调用都会被重定向到这个方法。
     * 注意：它的方法签名必须与原方法一致，并在最后增加一个 Throwable 类型的参数。
     * @param order 原始的订单对象
     * @param t 导致熔断的异常
     */
    public void fallbackForCreateOrder(SeckillOrder order, Throwable t) {
        log.error("数据库写入熔断器已打开！执行降级逻辑。 订单: {}, 异常: {}", order, t.getMessage());
        // 在真实的生产环境中，这里会有更复杂的降级逻辑，比如：
        // 1. 将这条处理失败的订单消息，发送到一个专门的“死信队列” (Dead Letter Queue)。
        // 2. 记录到专门的失败日志或数据库表中，供后续人工排查和补偿。
        // 3. 对于当前的学习项目，我们只打印错误日志，表示已经成功捕获并降级。
    }
}
```
#### 测试方案
1. JMeter 配置 ：配置一个持续运行的JMeter线程组，不断的向秒杀接口发送请求，让订单消息源源不断地进入RabbitMQ。
{% image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510161331236.png %}
2. 在应用启动压测正在进行时，手动停止MYSQL服务。
{% image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510161333315.png %}
3. 观察日志。
  - （预期）初期：OrderConsumerService 的日志会开始疯狂报错 Communications link failure (连接数据库失败)。
  - （预期）熔断发生：在连续失败几次（达到配置的10次调用，50%失败率的阈值）之后，这些数据库连接错误会突然停止。
  - （预期）降级执行：fallbackForCreateOrder 方法中的错误日志开始刷屏：“数据库写入熔断器已打开！执行降级逻辑。”
4. 重启MySQL服务并观察日志。
  - （预期）在熔断器等待时间结束后，createOrderInDb的正常日志再次出现。数据库恢复，熔断器自动恢复到“闭合”状态，系统恢复正常处理订单。RabbitMQ中堆积的消息也开始被快速消费。
### 测试结果分析与改进
#### 结果分析
- **结果：**只出现了几次 Communications link failure 的报错，但是没有出现 fallbackForCreateOrder 的刷屏日志。
- **分析：**@CircuitBreaker (熔断器) 没有机会工作，因为错误发生在它介入之前。
  - @RabbitListener 接收到消息，准备调用createOrderInDb方法。此时@Transaction的代理首先介入，它先去数据库连接池获取连接，准备开启事务。但此时MYSQL服务已经被手动停止，所以获取连接失败，立刻抛出了CannotCreateTransactionException异常。这个异常直接抛给了最外层的Spring AMQP容器，整个过程中，@CircuitBreaker 的代理根本没有机会开始它的工作。
  - 由于@Transactional 的优先级高于 @CircuitBreaker，事务开启失败是一个比业务执行失败更早的错误。
#### 改进
- 分离职责，明确AOP层次。采用外部熔断，内部事务的模式。
- 修改 OrderConsumerService.java
``` Java
@Service
public class OrderConsumerService {

    private static final Logger log = LoggerFactory.getLogger(OrderConsumerService.class);

    @Autowired
    private SeckillOrderRepository orderRepository;

    @Autowired
    private ProductRepository productRepository;

    // 注入自身代理，以解决 AOP 方法自调用的问题
    @Autowired
    @Lazy
    private OrderConsumerService self;

    /**
     * 【第一层：消费者入口 & 熔断层】
     * 这个方法是 RabbitMQ 消息的直接入口。
     * 它只负责一件事：提供熔断保护，然后将任务委托给内部的事务方法。
     * 它本身不带 @Transactional 注解。
     */
    @RabbitListener(queues = "seckill.order.queue")
    @CircuitBreaker(name = "dbWrite", fallbackMethod = "fallbackForCreateOrder")
    public void receiveOrderMessage(SeckillOrder order) {
        log.info("从RabbitMQ接收到订单消息，准备进行数据库操作: {}", order);
        // 【关键】通过 self 代理对象，调用带有 @Transactional 注解的内部方法
        // 这样可以确保 @Transactional 生效
        self.createOrderInDb(order);
    }

    /**
     * 【第二层：事务与业务逻辑层】
     * 这个方法现在是一个内部方法，只负责核心的数据库操作。
     * 它只关心一件事：保证这些操作在一个事务中完成。
     */
    @Transactional
    public void createOrderInDb(SeckillOrder order) {
        // 内部不再需要 try-catch，让异常自然抛出，以便 @CircuitBreaker 能够捕获
        log.info("进入事务方法，准备创建订单: {}", order);
        orderRepository.save(order);
        int result = productRepository.deductStock(order.getProductId());
        if (result == 0) {
            // 抛出异常，让事务回滚
            throw new RuntimeException("MySQL库存扣减失败，订单回滚: " + order);
        }
        log.info("数据库订单创建成功，事务即将提交。");
    }

    /**
     * 降级方法，保持不变。
     * 它的方法签名需要与【第一层】的 @CircuitBreaker 所在的方法匹配。
     */
    public void fallbackForCreateOrder(SeckillOrder order, Throwable t) {
        log.error("数据库写入熔断器已打开！执行降级逻辑。 订单: {}, 异常: {}", order, t.getMessage());
    }
}
```
- **AOP层次清晰：**
  - 当消息到来，首先进入receiveOrderMessage方法，@CircuitBreaker 的代理首先将其包裹，开始监控。
  - 在熔断器的范围内，调用self.createOrderInDb()，经过了Spring AOP 代理，@Transaction的代理其次介入，尝试开启事务。
- **正常的异常捕获：**
  - 当 createOrderInDb 因为无法获取数据库连接而抛出 CannotCreateTransactionException 时，这个异常正好被外层的 @CircuitBreaker 代理所捕获。
  - 熔断器得以正确地计数失败，并在达到阈值后“跳闸”。
#### 结果
- 前期（MYSQL服务手动停止后）：熔断降级日志和MYSQL报错交替出现
```
2025-10-16 13:01:43.010 ERROR 19792 --- [ntContainer#0-2] c.e.s.d.w.Service.OrderConsumerService   : 数据库写入熔断器已打开！执行降级逻辑。 订单: SeckillOrder(id=null, userId=516, productId=1, orderPrice=1.00, createTime=null), 异常: CircuitBreaker 'dbWrite' is OPEN and does not permit further calls
Caused by: com.mysql.cj.jdbc.exceptions.CommunicationsException: Communications link failure
```
- 后期（MYSQL服务重启后）：熔断降级日志和秒杀成功日志交替出现
```
2025-10-16 13:01:43.020  INFO 19792 --- [hread-587636925] c.e.s.demos.web.Service.SeckillService   : 用户 433 秒杀成功，商品ID: 1
2025-10-16 13:01:43.021 ERROR 19792 --- [ntContainer#0-6] c.e.s.d.w.Service.OrderConsumerService   : 数据库写入熔断器已打开！执行降级逻辑。 订单: SeckillOrder(id=null, userId=414, productId=1, orderPrice=1.00, createTime=null), 异常: CircuitBreaker 'dbWrite' is OPEN and does not permit further calls
```
- **过程分析**：
1. 故障与跳闸
  - 启动压测，手动停止MYSQL服务。
  - 日志：OrderConsumerService 开始疯狂报错 Communications link failure
  - 熔断器：此时熔断器处于 CLOSED 状态，放行每一个消息去调用createOrderInDb方法，当失败次数在统计窗口内达到了失败率阈值，熔断器从CLOSED切换到了OPEN。
2. 降级与保护
  - 熔断器切换状态后，还有新的消息从RabbitMQ涌来。
  - 日志：出现熔断降级日志。
  - 熔断器：此时熔断器处于 OPEN 状态，对于每一个新来的消息，不再放行去调用 createOrderInDb 方法。它直接短路了这个调用，并将请求重定向到指定的fallbackMethod。与此同时，熔断器内部启动了一个倒计时，时长为配置的 wait-duration-in-open-state (60秒)。
3. 探测与自愈
  - 手动重启MYSQL服务。
  - 日志：写入熔断器打开 类日志 和 秒杀成功日志 交替出现
  - 熔断器：倒计时结束后，熔断器进入了 HALF_OPEN 状态。在这个状态下，需要去探测下游服务是否已经恢复，根据配置，它会允许接下来的2个请求通过熔断器，真正调用createOrderInDb方法。在重启MYSQL前，还会有失败日志，在重启后，会有秒杀成功日志。熔断器收到2个成功信号后，判断下游服务已经恢复正常，所以状态由HALF_OPEN彻底恢复到CLOSED。
### 学学八股
#### Resilience4j
1. 核心组件
  - CircuitBreaker (熔断器): （我们的核心实践） 防止故障蔓延。当下游服务故障率超过阈值时，会“跳闸”，在一段时间内快速失败，并在服务恢复后自动“合闸”。
  - RateLimiter (限流器): 控制对某个服务的调用速率（QPS）。
  - Bulkhead (隔板): 限制对某个服务的并发调用数量。这和 Semaphore 的思想非常相似，但它是 Resilience4j 生态的一部分。
  - Retry (重试器): 对失败的操作进行自动重试。
  - TimeLimiter (超时限制器): 为异步操作设置一个最大执行时间。
  - Cache (缓存): 提供简单的缓存功能。

2. 熔断器的三态转换模型：
  - CLOSED (闭合): 默认状态，所有请求正常通过。熔断器默默地统计最近一段时间的调用成功率和失败率。
  - OPEN (打开): 当失败率达到阈值（如50%），熔断器“跳闸”，进入 OPEN 状态。在此状态下，所有后续请求都会被立即拒绝，并直接执行降级逻辑 (Fallback)，根本不会去调用下游服务。
  - HALF_OPEN (半开): 在 OPEN 状态持续一段时间后（wait-duration-in-open-state），熔断器进入 HALF_OPEN 状态。放行少量（permitted-number-of-calls-in-half-open-state）的“探测”请求去访问下游服务。
    - 探测成功： 如果这些请求成功了，熔断器认为下游服务已恢复，状态切换回 CLOSED。
    - 探测失败： 如果请求依然失败，熔断器立刻退回 OPEN 状态，开始新一轮的等待。

3. @CircuitBreaker 是如何工作的？（与 Spring AOP 的关系）
  - 核心原理： 和 @Transactional 一样，@CircuitBreaker 也是通过 Spring AOP 实现的。
  - 工作流程： Spring 会为 OrderConsumerService 创建一个代理对象。当外部调用 createOrderInDb 方法时：
    - 请求首先被 @CircuitBreaker 的代理拦截。
    - 代理检查熔断器的当前状态。
    - 如果状态是 OPEN，代理直接调用 fallbackMethod，方法结束。
    - 如果状态是 CLOSED 或 HALF_OPEN，代理会继续调用下一个切面（比如 @Transactional 的代理），并最终执行你的真实方法。
    - 如果你的真实方法抛出了异常，这个异常会被 @CircuitBreaker 的代理捕获。代理会根据异常类型更新熔断器的失败计数，然后根据情况决定是抛出异常，还是触发熔断并调用 fallbackMethod。