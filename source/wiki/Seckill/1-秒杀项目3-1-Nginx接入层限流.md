---
wiki: Seckill # 这是项目id，对应 /data/wiki/hexo-stellar.yml
title: 1-秒杀项目3.1-Nginx接入层限流
tags: [Nginx]
categories: [项目实战]
poster:
  topic: 标题上方的小字
  headline: 大标题
  caption: 标题下方的小字
  color: 标题颜色
date: 2025-10-17 20:04:38
description: 夹缝生存版
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

### 建立前置防线：Nginx接入层限流
- 在V3.0中，引入Resilience4j，为系统注入高弹性，但是它只能在请求已经进入Tomcat后才能发挥作用。如果瞬时流量过大，Tomcat线程池就会被挤爆，导致整个应用服务瘫痪。之前的内部保护措施根本无法发挥作用。
- 在V3.1，希望建立一道前置防线，在流量到达应用之前，用一个轻量、高效的哨兵进行第一轮拦截和削减，于是，引入Nginx接入层限流。
#### 配置
1. 创建`nginx.conf`文件： 
```Nginx
# /nginx.conf
user  nginx;
worker_processes  auto;

error_log  /var/log/nginx/error.log warn;
pid        /var/run/nginx.pid;

events {
    worker_connections  1024;
}

http {
    # 【核心配置】定义限流区域
    # zone=perip:10m: 创建一个名为 perip 的10MB内存区域
    # rate=5r/s:      允许来自同一个IP的平均请求速率为每秒5个
    limit_req_zone $binary_remote_addr zone=perip:10m rate=5r/s;

    server {
        listen 80;
        server_name localhost;

        location / {
            # 【核心配置】应用限流规则
            # burst=10:  允许的突发请求数（“令牌桶”的容量）
            # nodelay:   超出限制的请求立即返回 503，不排队
            limit_req zone=perip burst=10 nodelay;

            # 【核心配置】将请求反向代理到你的主机
            # 使用 host.docker.internal 来指向你的电脑
            proxy_pass http://host.docker.internal:8080;

            # ------ 以下是标准的代理头信息设置 ------
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
```
2. 更新`docker-compose.yml`，添加Nginx
```YAML
services:
  # ... 已有的 redis, rabbitmq, prometheus, grafana 服务 ...
  
  # 【新增】Nginx 接入层服务
  nginx:
    image: nginx:latest
    container_name: nginx-gateway
    ports:
      - "80:80" # 【关键】将主机的80端口映射到Nginx容器，这是新的流量入口
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro # 挂载我们的配置文件
    networks:
      - monitor-net # 加入到我们现有的网络中
    # 【关键】和 Prometheus 一样，为 Nginx 手动“指路”
    extra_hosts:
      - "host.docker.internal:host-gateway"

# ... 已有的 networks 定义保持不变 ...
```
#### 测试
1. JMeter配置
  1. 修改JMeter的目标地址：从localhost:8080修改为localhost:80。
  2. 极限压测：配置一个瞬时的高并发线程组（500个线程、Ramp-up为1）

2. 启动并观测
  - Nginx 日志：
  {%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510172019759.png %} 
  - 应用日志：
  {%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510172020621.png %}
  {%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510172021124.png %}
  - 数据库信息：商品库存减少了17个，新订单增加了17个。
3. 分析-Nginx的限流规则
  1. Nginx的配置是rate=5r/s (每秒5个请求) 和 burst=10 (允许10个突发请求)。
  2. 当瞬间发起500个请求时，由于它们都来自同一个IP，所以Nginx会对这整个请求群应用限流规则：
  - 前10个请求会因为burst = 10这个令牌桶容量而被立即放行。
  - 在接下来的1秒内，令牌桶会以每秒5个的速度，再额外放行大概5个请求。
  - 总计放行约15个请求，剩下的大约485个请求在最外层就被拒绝了。
### 学学八股
#### Nginx
##### 核心用法
1. 反向代理：客户端发送请求给Nginx，Nginx再根据配置，将请求转发给内部网络中一个或多个真正的业务服务器，然后将业务服务器的响应返回给客户端。
  - 与正向代理的区别：
    - 正向代理：代理的是客户端，为客户端服务。客户端知道自己要访问哪一个目标服务器，但是通过代理去访问。
    - 反向代理：代理的事服务器，为服务器服务。客户端只知道Nginx的地址，不知道背后真正提供服务的是哪台服务器。
  - 在 V3.1 中，Nginx 正是扮演了反向代理的角色。JMeter (客户端) 访问 localhost:80 (Nginx)，Nginx 再通过 proxy_pass http://host.docker.internal:8080; 将请求转发给你在主机上运行的 Spring Boot 应用。
2. 流量网关：在反向代理的基础上，Nginx还可以对流量进行检查和控制。
  - 流量控制：限制来自客户端的请求速率，防止恶意攻击或流量洪峰冲垮后端服务。
  - 负载均衡：如果有多个Spring Boot应用实例，Nginx可以将请求均匀的分发，避免单个实例过载，并实现系统的高可用。
  - SSL卸载：HTTPS的加解密过程非常消耗CPU资源。可以让Nginx专门负责处理HTTPS，然后Nginx与后端应用之间使用普通的HTTP通信。
  - 动静分离：Nginx处理静态资源的性能极高。可以直接处理静态文件的请求，而只将动态的API请求转发给后端应用，从而大大减轻应用服务器的负担。
##### 需要掌握
1. Nginx为什么性能这么高？它的核心工作模型是什么？
- 采用了基于事件驱动的异步非阻塞I/O模型。
  - I/O多路复用：Nginx 在底层使用了操作系统的 epoll (在 Linux 上) 这种高效的 I/O 模型。它允许单个线程同时监视成千上万个网络连接的状态。只有当某个连接上真正有数据可读或可写时，操作系统才会通知 Nginx 去处理它。这避免了为每个连接都创建一个线程，也避免了大量线程因为等待 I/O 而被阻塞和频繁地进行上下文切换，极大地节省了CPU和内存资源。
  - Master-Worker进程模型：Nginx 采用多进程架构。它有一个 Master 进程，负责读取配置、管理和监控 Worker 进程。而真正处理网络请求的，是多个 Worker 进程。Worker 的数量通常设置为与服务器的 CPU 核心数相同，这可以充分利用多核 CPU 的并行计算能力，并且 Worker 进程之间互相不影响，如果有一个 Worker 意外崩溃，Master 进程会立刻拉起一个新的来替代它，保证了服务的高稳定性和可靠性。”