---
title: 1-秒杀项目2.2-Redis集群和小结
tags: [Spring Boot,高并发,Redis]
categories: [项目实战]
poster:
  topic: 标题上方的小字
  headline: 大标题
  caption: 标题下方的小字
  color: 标题颜色
date: 2025-10-09 21:05:34
description: 越来越好版 
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

### 自动故障转移：高可用Redis集群
- 在V2.1中，通过引入RabbitMQ解决了“订单消息丢失”的可靠性问题。但单点故障问题依旧存在，当Redis服务器宕机，整个秒杀服务就会立刻瘫痪。
- 在V2.2方案中，引入Redis集群，即Redis Sentinel哨兵高可用方案
  - 主从复制
    - Master（主节点）：处理所有写命令，并将数据变更异步地同步给所有从节点。
    - Replica（从节点）：接受并执行来自Master的同步数据，保持与Master数据一致，可以分担读请求的压力。
  - 哨兵：是一个独立的进程，不存储数据，职责是监控和管理。
    - 监控：持续检查Master和Replica是否正常工作。
    - 自动故障转移：当Master宕机，多个Sentinel对进行投票，选举出一个Replica提升为新的Master。
    - 配置提供：客户端在连接时，会先询问Sentinel，“谁是现在的Master？”，Sentinel会告诉他当前Master的地址。
#### 搭建 Redis Sentinel 环境
> 使用 Docker Compose 可以一键启动整个一主二从三哨兵环境。
1. 在项目根目录下，创建一个`docker-composer.yml`文件，将以下内容添加到文件中：
```YAML
version: '3.8'
services:
  redis-master:
    image: redis:6.2
    container_name: redis-master
    ports:
      - "6379:6379"

  redis-replica-1:
    image: redis:6.2
    container_name: redis-replica-1
    command: redis-server --slaveof redis-master 6379

  redis-replica-2:
    image: redis:6.2
    container_name: redis-replica-2
    command: redis-server --slaveof redis-master 6379

  sentinel-1:
    image: redis:6.2
    container_name: sentinel-1
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    ports:
      - "26379:26379"

  sentinel-2:
    image: redis:6.2
    container_name: sentinel-2
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    ports:
      - "26380:26379"

  sentinel-3:
    image: redis:6.2
    container_name: sentinel-3
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    ports:
      - "26381:26379"
```
2. 在 `docker-compose.yml `旁边，创建 `sentinel.conf `配置文件：
```conf
# 监控名为 mymaster 的主节点，它的地址是 redis-master:6379
# 数字 2 表示至少需要 2 个哨兵同意，才能判断主节点失败
sentinel monitor mymaster redis-master 6379 2

# 主节点被判断为下线后，超过 5000 毫秒没有恢复，则启动故障转移
sentinel down-after-milliseconds mymaster 5000

# 在故障转移期间，最多只允许 1 个从节点同时进行数据同步
sentinel parallel-syncs mymaster 1

# 故障转移的超时时间
sentinel failover-timeout mymaster 15000
```

3. 一键启动集群，在`docker-compose.yml`所在的目录，打开终端，运行：
``` Bash
docker-compose up -d
```
#### 整合 Spring Boot
1. 无需修改Maven依赖，`spring-boot-startr-data-redis`默认的Lettuce客户端已经内置了对Sentinel的依赖。
2. 修改`application.properties`，删除旧的Redis单点配置，换成新的Sentinel配置
``` Properties
# ================= Redis Sentinel Configuration =================
# 告诉 Spring Redis，我们要连接的 Master 的名字叫 mymaster
spring.redis.sentinel.master=mymaster
# 告诉 Spring Redis，可以去哪里找到我们的哨兵（经纪人）
# 我们启动了三个哨兵，端口分别是 26379, 26380, 26381
spring.redis.sentinel.nodes=localhost:26379, localhost:26380, localhost:26381
```
#### 设计并进行容错测试
##### 设计测试
> 目标：在一个有持续、稳定流量的场景下，手动制造一次“杀死 Redis Master”，然后清晰地观测到系统是否能够自动完成故障转移并恢复正常。
1. 准备工作
  - 启动Redis 集群和Spring Boot应用。
  - 重置数据：确保Redis和MYSQL数据都处于初始状态。
  - 开启JMeter压测：启动一个持续时间比较长的压测，不断地向秒杀接口发送请求。
2. 制造测试环境
  - 在压测正在进行时，打开一个新的终端。
  - 手动“杀死”Redis Master 节点：
  ``` Bash
  docker stop redis-master
  ```
3. 观察JMeter、应用日志和哨兵日志。
##### 开始测试
开始测试后，因为bug 出现太多，所以具体报错、解析和修复过程请看下一章“排bug”。

### 排bug
#### Bug 1
1. 错误：第一次在终端执行该命令时:`docker-compose up -d`，Docker出现如下报错：
```
Error response from daemon: driver failed programming external connectivity on endpoint redis-master (79517c202b1cdd79b12a285499734cff2184dccce51bf35551dc389cd6ed086d): Bind for 0.0.0.0:6379 failed: port is already allocated
```
2. 解析：Docker尝试为 redis-master 这个容器绑定电脑的6379端口时，失败了，因为这个端口已经被其他程序占用了。很明显，我之前在V2.0、V2.1版本中启动的旧的、单个的Redis容器还在后台运行，并且正霸占着6379端口，需要停掉这个端口。
3. 解决：
  - 在终端中执行 `docker ps`，查看当前有哪些容器正在运行。
  - 找到的那个冲突的容器名字，停止并移除它
  ``` Bash
  # 1. 停止容器
  docker stop seckill-redis

  # 2. 移除容器 (可选，但推荐，以保持环境干净)
  docker rm seckill-redis
  ```
  - 重新启动 Docker Compose 环境。执行`docker-compose up -d`，问题解决。
#### Bug 2
1. **错误**：Spring Boot应用启动失败-无法连接到Redis Sentinel（节选重要错误日志）：
```
Error starting ApplicationContext. To display the conditions report re-run your application with 'debug' enabled.
2025-10-09 15:25:03.433 ERROR 6180 --- [ main] o.s.boot.SpringApplication: Application run failed
org.springframework.data.redis.RedisConnectionFailureException: Unable to connect to Redis; nested exception is io.lettuce.core.RedisConnectionException: Cannot connect to a Redis Sentinel: [redis://localhost:26379, redis://localhost:26380, redis://localhost:26381]
Caused by: io.lettuce.core.RedisConnectionException: Cannot connect Redis Sentinel at redis://localhost:26381
Caused by: java.net.ConnectException: Connection refused
```
2. **解析**：Redis连接异常：无法连接到任何一个Redis Sentinel节点。当你的Spring Boot应用尝试去连接localhost：26381(以及其他两个哨兵端口)时，操作系统直接拒绝了这次连接。最大可能是Docker Compose环境没有成功启动或已经停止。
3. **排查**：
  - 检查Docker Compose启动的所有容器是否都在正常运行，执行`docker-compose ps`，结果显示如下，很显然，我的Redis主从节点都成功启动了，但是哨兵容器一个也没有运行起来。
  ```
  time="2025-10-09T15:29:27+08:00" level=warning msg="D:\\Javaproject\\seckill-system\\docker-compose.yml: the attribute `version` is obsolete, it will be ignored, please remove it to avoid potential confusion"
  NAME              IMAGE       COMMAND                   SERVICE           CREATED          STATUS          PORTS                
  redis-master      redis:6.2   "docker-entrypoint.s…"   redis-master      19 minutes ago   Up 16 minutes   0.0.0.0:6379->6379/tcp
  redis-replica-1   redis:6.2   "docker-entrypoint.s…"   redis-replica-1   19 minutes ago   Up 19 minutes   6379/tcp
  redis-replica-2   redis:6.2   "docker-entrypoint.s…"   redis-replica-2   19 minutes ago   Up 19 minutes   6379/tcp
  ```
  - 继续检查为什么哨兵容器没有成功运行起来：清理当前环境，运行`docker-compose up`，查看尝试启动的所有日志信息（节选重要错误日志）：
  ```
  sentinel-2        | Can't resolve instance hostname.
  sentinel-1        | 1:X 09 Oct 2025 07:32:14.739 # Failed to resolve hostname 'redis-master'
  sentinel-1        | Can't resolve instance hostname.
  ```
  - **解析**：日志显示，Sentinel 无法通过名字找到主节点服务器，这可能是一个Docker Compose中的启动顺序竞态问题。`docker-compose up`会尝试同时启动所有的服务，从全部的日志信息中能看出，我的Sentinel-1/Sentinel-2/Sentinel-3 容器可能启动的太快，在读自己的配置文件时，redis-master可能还没有完全启动并把自己注册到Docker的内部网络中。所以当Sentinel尝试通过host name去寻找主节点时，Docker的内部DNS“查无此人”，于是Sentinel因为找不到监控目标而启动失败并退出了。与此同时，主从节点的链接是成功的，因为它们之间存在重试机制，最终连接成功。
  - **解决**：在 docke-compose.yml 文件中，明确告诉Docker Compose，必须先等redis-master启动之后，再去启动其他的从节点和哨兵。为所有 `redis-replica-*` 和 `sentinel-*` 服务都增加了 `depends_on: - redis-master`。这会确保 Docker Compose 在启动这些服务之前，会先启动 redis-master 服务，从而解决了“找不到主机名”的问题。
  - **结果**：通过命令`docker-compose ps`后显示的内容：只有 Redis 主从节点启动了，三个 Sentinel（哨兵）容器依然启动失败。
##### 解决方案1 共享主机网络
- 修改docker-compose.yml，让所有容器都不再使用Docker内部隔离的网络，而是直接共享电脑主机的网络。这可以消除网络障碍，所有容器可以通过localhost互相访问，绕过Docker内部复杂的DNS解析问题。为每一个服务都添加`network_mode:"host"`，并修改从节点的启动命令为`command: redis-server --slaveof 127.0.0.1 6379`。
- 修改 sentinel.conf为：
```
# 监控 mymaster, 它的地址现在是 127.0.0.1
sentinel monitor mymaster 127.0.0.1 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel parallel-syncs mymaster 1
sentinel failover-timeout mymaster 15000
```
- 在host网络模式下，不再需要ports映射，容器直接使用了电脑的端口。
- **结果**：该方案失败，关键错误日志如下：
```
sentinel-2       | 1:X 09 Oct 2025 08:51:34.015 # Warning: Could not create server TCP listening socket *:26379: bind: Address already in use
sentinel-1       | 1:X 09 Oct 2025 08:51:34.033 # Warning: Could not create server TCP listening socket *:26379: bind: Address already in use
redis-master     | 1:M 09 Oct 2025 08:51:33.990 # Warning: Could not create server TCP listening socket *:6379: bind: Address already in use
redis-master     | 1:M 09 Oct 2025 08:51:33.990 # Failed listening on port 6379 (TCP), aborting.
```
- **解析**：当使用`network_mode:"host"`时，即所有的容器都直接使用我电脑主机的网络，但是由于docker-compose会同时启动所有容器，他们之间发生了争抢端口的混乱。
  - redis-master, redis-replica-1, redis-replica-2 这三个容器，都想占用电脑上唯一的 6379 端口。第一个抢到的容器（可能是 redis-master）成功了，后面两个都因为端口已被占用而启动失败。
  - sentinel-1, sentinel-2, sentinel-3 这三个容器，都想占用电脑上唯一的 26379 端口（因为在 docker-compose.yml 中没有为它们分别指定不同的主机端口）。第一个抢到的成功了，后面两个也因为端口冲突而失败。
##### 解决方案2 回归Docker默认网络并精调配置
- 修改 sentinel.conf，保持不变，依然使用redis-master。
- 修改 docker-compose.yml ，为master新增一个网络别名，增强网络的稳定性。优化depends_on，让哨兵不仅等待master，也让replica就绪。明确定义使用了自定义网络seckill-net：不再依赖Docker Compose默认创建的网络，而是自己创建了一个名为seckill-net的桥接网络，并让所有的容器都加入这个网络中，以提供更稳定可靠的容器间DNS解析。
-结果：回归到第一次的错误结果，错误日志为：
```
sentinel-3       | Can't resolve instance hostname.
sentinel-3       | 1:X 09 Oct 2025 08:56:25.019 # Failed to resolve hostname 'redis-master'
sentinel-1       | Can't resolve instance hostname.
sentinel-1       | 1:X 09 Oct 2025 08:56:25.138 # Failed to resolve hostname 'redis-master'
sentinel-2       | Can't resolve instance hostname.
sentinel-2       | 1:X 09 Oct 2025 08:56:25.162 # Failed to resolve hostname 'redis-master'
```
- **解析**：即使使用了depends_on来规定启动顺序，但是Sentinel在启动时，仍然没有在网络上找到redis-master。这有可能是因为，depends_on只保证它会先启动redis-master容器，然后再启动sentinel容器，但它不能保证，当sentinel容器启动时，redis-master容器内的Redis服务已经完全准备好，并开始监听网络端口了。
##### 解决方案3 使用healthcheck
- 在docker-compose.yml中为redis-master服务定义一个healthcheck命令，然后让其他所有服务都等待redis-master的状态变为healthy之后再启动。
``` YAML
services:
  redis-master:
    image: redis:6.2
    container_name: redis-master
    ports:
      - "6379:6379"
    networks:
      - seckill-net
    # 【新增】为 master 添加健康检查
    healthcheck:
      test: ["CMD", "redis-cli", "ping"] # 检查命令：用 redis-cli 发送 PING
      interval: 1s                      # 每隔 1 秒检查一次
      timeout: 3s                       # 每次检查的超时时间
      retries: 30                       # 最多重试 30 次

  redis-replica-*:
    image: redis:6.2
    container_name: redis-replica-1
    command: redis-server --slaveof redis-master 6379
    networks:
      - seckill-net
    # 【改动】让依赖等待 master 变为“健康”状态
    depends_on:
      redis-master:
        condition: service_healthy

    sentinel-*:
    image: redis:6.2
    container_name: sentinel-1
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    ports:
      - "26379:26379"
    networks:
      - seckill-net
    # 【改动】
    depends_on:
      redis-master:
        condition: service_healthy
```
- **结果**：依旧错误，关键日志信息如下所示：
```
redis-replica-2  | 1:S 09 Oct 2025 08:59:19.479 * MASTER <-> REPLICA sync: Finished with success
redis-replica-1  | 1:S 09 Oct 2025 08:59:19.680 * MASTER <-> REPLICA sync: Finished with success
sentinel-1       | 1:X 09 Oct 2025 08:59:19.796 # Failed to resolve hostname 'redis-master'
sentinel-1       | *** FATAL CONFIG FILE ERROR (Redis 6.2.20) ***
sentinel-3       | 1:X 09 Oct 2025 08:59:19.802 # Failed to resolve hostname 'redis-master'
sentinel-3       | *** FATAL CONFIG FILE ERROR (Redis 6.2.20) ***
sentinel-2       | 1:X 09 Oct 2025 08:59:19.816 # Failed to resolve hostname 'redis-master'
sentinel-2       | *** FATAL CONFIG FILE ERROR (Redis 6.2.20) ***
```
- **解析**：从日志信息中可以看出，redis-replica-1和redis-replica-2这两个从节点是可以通过redis-master这个名字找到主节点的，但是哨兵节点出于某种原因无法通过同样的名字找到主节点。这有可能是Docker内部DNS机制导致的。
##### 解决方案4 使用静态IP
- 通过名字来寻找redis-master不稳定，那么就给redis-master分配一个固定的静态IP地址，让所有其他容器通过这个确切的地址来找到他，绕开Docker的DNS解析机制。
- 修改docker-compose.yml文件：
```YAML
services:
  redis-master:
    image: redis:6.2
    container_name: redis-master
    ports:
      - "6379:6379"
    networks:
      seckill-net:
        # 【关键改动】为 master 分配一个固定的内部 IP 地址
        ipv4_address: 172.28.1.1 

  redis-replica-1:
    image: redis:6.2
    container_name: redis-replica-1
    # 【关键改动】命令从节点连接到 master 的固定 IP
    command: redis-server --slaveof 172.28.1.1 6379
    networks:
      - seckill-net
    depends_on:
      - redis-master

  sentinel-1:
    image: redis:6.2
    container_name: sentinel-1
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    ports:
      - "26379:26379"
    networks:
      - seckill-net
    depends_on:
      - redis-master
      
  # ... Sentinel 2 和 3 的配置与 Sentinel 1 类似 ...

# 【关键改动】定义网络并为其指定一个子网，以便我们可以分配静态IP
networks:
  seckill-net:
    driver: bridge
    ipam:
      config:
        - subnet: 172.28.0.0/16
```
- 修改sentinel.conf文件
```
sentinel monitor mymaster 172.28.1.1 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel parallel-syncs mymaster 1
sentinel failover-timeout mymaster 15000
```
- **结果**：日志信息如下所示，可以看出，Redis Sentinel集群的监控、主从关系、哨兵网络已经全部建立成功。下一步会进行Spring Boot的启动。
```
sentinel-2       | 1:X 09 Oct 2025 09:02:54.609 # +monitor master mymaster 172.28.1.1 6379 quorum 2
sentinel-2       | 1:X 09 Oct 2025 09:02:54.611 * +slave slave 172.28.0.2:6379 172.28.0.2 6379 @ mymaster 172.28.1.1 6379
sentinel-1       | 1:X 09 Oct 2025 09:02:54.600 # +monitor master mymaster 172.28.1.1 6379 quorum 2
sentinel-1       | 1:X 09 Oct 2025 09:02:54.617 * +slave slave 172.28.0.3:6379 172.28.0.3 6379 @ mymaster 172.28.1.1 6379
sentinel-3       | 1:X 09 Oct 2025 09:02:54.670 # +monitor master mymaster 172.28.1.1 6379 quorum 2
sentinel-3       | 1:X 09 Oct 2025 09:02:54.671 * +slave slave 172.28.0.2:6379 172.28.0.2 6379 @ mymaster 172.28.1.1 6379
sentinel-2       | 1:X 09 Oct 2025 09:02:56.685 * +sentinel sentinel
sentinel-1       | 1:X 09 Oct 2025 09:02:56.685 * +sentinel sentinel
sentinel-3       | 1:X 09 Oct 2025 09:02:56.653 * +sentinel sentinel
```
#### Bug 3
1. **错误**：启动失败，报错关键信息如下：
```
io.lettuce.core.RedisConnectionException: Unable to connect to 172.28.1.1/<unresolved>:6379
...
Caused by: io.netty.channel.ConnectTimeoutException: connection timed out: /172.28.1.1:6379
```
2. **解析**：应用无法连接到172.28.1.1:6379 这个地址，原因是连接超时。在我们之前的配置中，为Docker内部创建了一个名为seckill-net的私有网络。172.28.1.1 是 redis-master 在这个私有网络里的IP地址。我的Spring Boot应用是直接运行在主机上的，但我的redis集群运行在Docker容器内部的隔离网络中。应用在墙外，不知道这个墙内的地址是什么，也无法访问它，所以连接请求最终因超时而失败。
##### 解决方案1 使用 host 网络模式并显式指定不同端口
- **修改：**host模式能够让所有容器都直接使用我电脑主机的网络，这样我的Spring Boot应用和所有的redis容器就处于同一个网络世界中，可以互相找到对方。
- 修改`docker-compose.yml`文件：
```YAML
services:
  redis-master:
    image: redis:6.2
    container_name: redis-master
    network_mode: "host"
    # 主节点默认使用 Redis 的 6379 端口

  redis-replica-1:
    image: redis:6.2
    container_name: redis-replica-1
    # 【关键改动】让这个从节点在主机的 6380 端口上运行
    command: redis-server --port 6380 --slaveof 127.0.0.1 6379
    network_mode: "host"

  redis-replica-2:
    image: redis:6.2
    container_name: redis-replica-2
    # 【关键改动】让这个从节点在主机的 6381 端口上运行
    command: redis-server --port 6381 --slaveof 127.0.0.1 6379
    network_mode: "host"

  sentinel-1:
    image: redis:6.2
    container_name: sentinel-1
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    network_mode: "host"
    # 第一个哨兵默认使用 26379 端口

  sentinel-2:
    image: redis:6.2
    container_name: sentinel-2
    # 【关键改动】让这个哨兵在主机的 26380 端口上运行
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf --port 26380
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    network_mode: "host"

  sentinel-3:
    image: redis:6.2
    container_name: sentinel-3
    # 【关键改动】让这个哨兵在主机的 26381 端口上运行
    command: redis-sentinel /usr/local/etc/redis/sentinel.conf --port 26381
    volumes:
      - ./sentinel.conf:/usr/local/etc/redis/sentinel.conf
    network_mode: "host"
```
- 哨兵的配置文件也需要更新，告诉它去监控 127.0.0.1。
- 这次为每一个服务都添加了 network_mode: "host"。移除了所有 ports 映射，因为在 host 模式下不需要它。通过 command 指令，为 redis-replica-* 和 sentinel-* 指定了不同的、唯一的端口，从而完美地解决了端口冲突问题。从节点和哨兵现在都通过 127.0.0.1 (即 localhost) 来寻找主节点。
- **结果**：关键错误日志如下所示：
```
RedisConnectionFailureException: Unable to connect to Redis
Caused by: ... Connection refused: getsockopt: localhost/127.0.0.1:26381
Caused by: io.lettuce.core.RedisConnectionException: Cannot connect to a Redis Sentinel: [redis://localhost:26379, redis://localhost:26380, redis://localhost:26381]
...
at org.springframework.data.redis.connection.lettuce.StandaloneConnectionProvider.lambda$getConnection$1(StandaloneConnectionProvider.java:115)
```
- **解析**:Spring Boot 应用（在 localhost 上）还是找不到redis集群，并且从日志中可以看出，Spring Boot应用处于某种原因，没有把我的配置识别为一个sentinel配置，而是把他当成了三个独立的、普通的redis实例来尝试连接。它挨个去试这几个为哨兵匹配的端口，但这几个端口上运行的是sentinel服务，而不是Redis主服务，所以连接协议不匹配，最终导致失败。
##### 解决方案2 绕过自动配置，手动创建连接工厂
- **修改**：手动设置，告知Spring Boot应用务必使用sentinel模式来创建redis连接。
- 创建一RedisConnectionFactory 的 Bean来实现这一点。
``` Java
@Configuration
public class RedisConfig {

    /**
     * 【新增】手动配置 Redis Sentinel 连接工厂
     */
    @Bean
    public LettuceConnectionFactory redisConnectionFactory() {
        RedisSentinelConfiguration sentinelConfig = new RedisSentinelConfiguration()
                .master("mymaster") // 设置 master 的名字
                .sentinel("localhost", 26379)
                .sentinel("localhost", 26380)
                .sentinel("localhost", 26381);
        
        // 如果你的 Redis 有密码，在这里添加
        // sentinelConfig.setPassword("yourpassword");

        return new LettuceConnectionFactory(sentinelConfig);
    }
```
- 新增了一个名为 redisConnectionFactory() 的方法，并用 @Bean 标注。在这个方法内部，创建了一个 RedisSentinelConfiguration 对象，并明确地告诉它 master 的名字和所有哨兵的地址。用这个配置创建了一个 LettuceConnectionFactory 并返回。修改了 redisTemplate 这个 Bean 的方法签名，让它接收一个 RedisConnectionFactory 参数。Spring 会自动将上面创建的那个 Sentinel 连接工厂注入进来。
- **结果**：还是经典的Connection refused。
- **解析**： 没招了。
##### 解决方案3 全部打包塞进Docker
- **修改**：把Spring Boot应用也打包成一个Docker容器，让它和redis集群放在一起。当所有服务都作为容器，并连接到同一个Docker自定义网络时，它们之间可以通过服务名进行稳定、可靠的通信，彻底绕开主机网络的所有复杂问题。
1. 为Spring Boot应用编写Dockerfile
``` Dockerfile
# 使用一个包含 Java 17 的基础镜像
FROM openjdk:17-jdk-slim

# 设置工作目录
WORKDIR /app

# 将打包好的 jar 文件复制到容器中
# 注意：路径需要根据你 target 目录下的实际文件名进行调整
COPY target/seckill-system-0.0.1-SNAPSHOT.jar app.jar

# 暴露应用的 8080 端口
EXPOSE 8080

# 容器启动时执行的命令
ENTRYPOINT ["java","-jar","/app/app.jar"]
```
2. 修改docker-compose.yml，把应用和MYSQL加入
``` YAML
services:
  # 1. 你的 Spring Boot 应用
  seckill-app:
    build: .
    container_name: seckill-app
    ports:
      - "8080:8080" # 将应用的8080端口暴露给主机，以便浏览器和JMeter访问
    networks:
      - seckill-net
    depends_on:
      - sentinel-1
      - mysql-db # 【新增】让应用等待 MySQL 启动

  # 2. 【新增】MySQL 数据库服务
  mysql-db:
    image: mysql:8.0
    container_name: mysql-db
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: your_password # 【注意】请替换成你自己的密码
      MYSQL_DATABASE: seckill_db
    ports:
      - "3306:3306" # 将数据库的3306端口暴露给主机，方便你用数据库工具连接
    volumes:
      - mysql-data:/var/lib/mysql # 将数据持久化，防止容器删除后数据丢失
    networks:
      - seckill-net

  # --- Redis 集群配置 (回归到最稳定的桥接网络模式) ---
  redis-master:
    image: redis:6.2
    container_name: redis-master
    networks:
      - seckill-net
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 1s
      timeout: 3s
      retries: 30

  # ... redis-replica 和 sentinel 的配置与之前版本一致，无需改动 ...
  # ... (为简洁，此处省略，请保留你文件中已有的 redis-replica-* 和 sentinel-* 配置) ...

networks:
  seckill-net:
    driver: bridge

# 【新增】定义一个数据卷，用于持久化MySQL数据
volumes:
  mysql-data:
```
3. 修改application.properties，打包SpringBoot应用，一键启动所有服务。
- **结果**：关键错误信息节选
- 启动时的竞态问题，后面通过健康检查解决。
```
com.mysql.cj.jdbc.exceptions.CommunicationsException: Communications link failure
...
Caused by: java.net.ConnectException: Connection refused
```
- MYSQL拒绝用户 'root' 从 IP 地址 '172.18.0.9' 登录，即使他使用了密码。后面通过为root开通远程访问权限还是出现一样的错误，最后放弃root，创建新用户解决。
```
o.h.engine.jdbc.spi.SqlExceptionHelper : Access denied for user 'root'@'172.18.0.9' (using password: YES)
```
- **解析**：创建新用户后，从Docker上看，8个服务都正常运行，但是使用JMeter压测时，出现大量报错。
#### finally
- 排bug排到现在，我已经超级无敌心累了，因为是属于“干中学”，我对于Docker，对于环境的配置是依赖于AI工具的，所以整个排bug的过程我都依赖于AI提供的建议，并且跟着他给的步骤往后走，非常之被动。总的来说学习体验很不好，所以我决定放弃继续纠缠这个bug，独立验证Redis Sentinel的高可用集群，让Spring Boot在本机活下去。
##### 独立验证Redis Sentinel高可用集群
1. 彻底清理环境 `docker-compose down -v`
2. 一键启动所有基础设施 `docker-compose up -d`
3. 耐心等待约20-30秒，让主从同步和哨兵选举稳定下来,运行 ps 命令，确认所有6个 Redis 相关容器都处于 'Up' 状态。
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510121807018.png %}
4. 验证初始状态（灾难前），打开一个新的终端，使用 redis-cli 连接到任意一个哨兵，询问谁是现在的主人。`redis-cli -p 26379 sentinel get-master-addr-by-name mymaster`
5. 模拟主节点宕机，`docker stop redis-master`，这条命令执行后，redis-master 就已经停止了。
6. 观察哨兵日志，`docker-compose logs -f sentinel-1`，如下图所示。
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510121822871.png%}
- 从哨兵日志中可以看到+sdown, +odown, +vote-for-leader, +switch-master 等一系列日志，记录了哨兵们发现Master驾崩、紧急开会、投票选举新Master的全过程。
##### 回归Spring Boot本身
### 小结
- 总的来说，我愿意评价这次调试为“兜兜转转”、“糊里糊涂”、“非常上火”。这警示我不要太依赖AI的提示，要有自己的思考和调试步骤。
- 下面是在梳理了几次调试后的总结：
#### 时序问题
- **背景**：当`docker-compose up`启动后，sentinel容器总是报错 `Can't resolve instance hostname 'redis-master'`，然后闪退，但是redis-replica容器却能正常连接。
- **分析**：由于replica能够连上，说明他们内部的网络是通的，这个问题，有可能是因为sentinel启动的太快，那时redis-master还没来得及在Docker内部网络中注册好自己的名字。
- **解决方案**：
  - **depends_on**：首先尝试了depends_on，规定了启动顺序。但问题依旧，这让我感受到了其局限性，它只能等待容器启动，而不能等待服务就绪，
  - **healthcheck**：为redis-master服务增加了健康检查（redis-cli ping），并让其他服务都depends_on这个健康检查的结果，确保所有依赖方在redis-master真正可用之后才启动。
- 总结：这两个方法都没有解决sentinel的报错，但是我也学到了如何诊断和解决Docker Compose中的服务启动依赖和竞态问题。
#### 网络问题
- **背景**：反复报错`Connection Refused`
- **分析**：
- **解决方案**：
  - **host 模式 + 独立端口**: Spring Boot 应用（在 localhost 上）还是找不到redis集群。
  - **bridge 模式 + 静态I**: 能解决Docker网络内部，Sentinel和master的连接问题，但是无法解决应用启动后，应用无法和Redis连接的问题。
#### 收获
- 搭建并验证了 Redis Sentinel 的高可用架构。 “自动故障转移”不再是一个抽象的概念，而是我亲眼所见的、稳定运行的机制。
- 短暂获得了“全栈”环境排错能力。 这次调试让我穿梭于应用配置 (.properties)、容器编排 (.yml)、网络模式 (bridge/host)、服务配置 (.conf) 和底层命令 (docker ps, logs) 之间，对复杂系统的联调和故障排查能力有了质的飞跃（存疑）。
- 学会了工程实践中的“务实决策”（其实是没招了）。 当面对无法逾越的环境障碍时，如何通过隔离问题、分步验证、采用务实“降级”（暂时让应用连单点Redis）等方式，来保证核心学习目标的达成和项目主线的推进。