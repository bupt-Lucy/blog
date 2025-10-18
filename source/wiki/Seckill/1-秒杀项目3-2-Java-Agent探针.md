---
wiki: Seckill # 这是项目id，对应 /data/wiki/hexo-stellar.yml
title: 1-秒杀项目3.2-Java_Agent探针
tags: [APM,Byte Buddy,JVM]
categories: [项目实战]
poster:
  topic: 标题上方的小字
  headline: 大标题
  caption: 标题下方的小字
  color: 标题颜色
date: 2025-10-18 17:27:06
description: 一心二用版
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

### 构建 Java Agent 探针
#### 执行方案
1. 创建全新的 mini-apm-agent Maven项目，配置 pom.xml，保存并让Maven重新加载依赖。
``` XML
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>

    <groupId>com.example</groupId>
    <artifactId>mini-apm-agent</artifactId>
    <version>1.0-SNAPSHOT</version>

    <properties>
        <maven.compiler.source>17</maven.compiler.source>
        <maven.compiler.target>17</maven.compiler.target>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>

    <dependencies>
        <dependency>
            <groupId>net.bytebuddy</groupId>
            <artifactId>byte-buddy</artifactId>
            <version>1.14.9</version> </dependency>
        <dependency>
            <groupId>net.bytebuddy</groupId>
            <artifactId>byte-buddy-agent</artifactId>
            <version>1.14.9</version>
        </dependency>
    </dependencies>

    <build>
        <plugins>
            <plugin>
                <groupId>org.apache.maven.plugins</groupId>
                <artifactId>maven-jar-plugin</artifactId>
                <version>3.2.0</version>
                <configuration>
                    <archive>
                        <manifestEntries>
                            <Premain-Class>com.example.agent.AgentMain</Premain-Class>
                            <Can-Redefine-Classes>true</Can-Redefine-Classes>
                            <Can-Retransform-Classes>true</Can-Retransform-Classes>
                        </manifestEntries>
                    </archive>
                </configuration>
            </plugin>
        </plugins>
    </build>
</project>
```
3. 编写Agent的入口，创建AgentMain.java文件
``` Java
package com.example.agent;

import net.bytebuddy.agent.builder.AgentBuilder;
import net.bytebuddy.implementation.MethodDelegation;
import net.bytebuddy.matcher.ElementMatchers;

import java.lang.instrument.Instrumentation;

public class AgentMain {

    /**
     * 这是 Java Agent 的入口方法
     * 它会在 seckill-app 的 main 方法【之前】被 JVM 调用
     *
     * @param agentArgs 代理参数，在 -javaagent:xxx=yyy 中传递
     * @param inst      JVM 提供的“插桩”工具
     */
    public static void premain(String agentArgs, Instrumentation inst) {
        System.out.println("========================================");
        System.out.println("  Mini-APM-Agent 正在启动... v1.0");
        System.out.println("========================================");

        new AgentBuilder.Default()
                .type(ElementMatchers.nameContains("OrderConsumerService"))
                .transform((builder, typeDescription, classLoader, module, protectionDomain) -> // 【核心改动】增加了第5个参数 'protectionDomain'
                        builder
                                .method(ElementMatchers.named("createOrderInDb"))
                                .intercept(MethodDelegation.to(MethodTimerInterceptor.class))
                )
                .installOn(inst);
    }
}
```

4. 编写拦截器的逻辑，创建 MethodTimerInterceptor.java 文件
``` Java
package com.example.agent;

import net.bytebuddy.implementation.bind.annotation.Origin;
import net.bytebuddy.implementation.bind.annotation.RuntimeType;
import net.bytebuddy.implementation.bind.annotation.SuperCall;

import java.lang.reflect.Method;
import java.util.concurrent.Callable;

public class MethodTimerInterceptor {

    @RuntimeType
    public static Object intercept(
            @Origin Method method, // 被拦截的原始方法
            @SuperCall Callable<?> callable // 用于调用原始方法的“回调”
    ) throws Exception {
        
        long start = System.nanoTime(); // 1. 在方法执行前，记录开始时间
        
        Object result;
        try {
            // 2. 调用原始的业务方法
            result = callable.call();
        } finally {
            // 3. 在方法执行后，计算并打印耗时
            long end = System.nanoTime();
            System.out.println(
                    "[Mini-APM] 方法 " + method.getName() + 
                    " 执行耗时: " + (end - start) / 1_000_000 + " 毫秒"
            );
        }
        return result;
    }
}
```
5. 打包、挂载，配置 seckill-system 的启动项
- 在 mini-apm-agent 项目的 Maven 工具窗口中，运行 clean，然后运行 package，得到mini-apm-agent-1.0-SNAPSHOT.jar 文件。
- 在seckill-system 项目的应用启动配置中，在 VM options 输入框中，写入真实的Jar包的绝对路径。
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510181755233.png %}
#### 结果
{%image https://xylumina.oss-cn-beijing.aliyuncs.com/img/202510181755204.png %}
- 可以观测到，一开始的时候耗时400-500毫秒，后期变成了30-40毫秒。
- 分析：刚开始的 400-500ms 是冷启动的成本，而 30-40ms 才是这个方法热身后的真正性能。
### 学学八股
#### mini-apm-agent
1. 核心作用：在不修改任何一行目标项目（seckill-system）的业务代码的前提下，为它动态地增加“监控方法执行耗时”的新功能。
  - 高内聚、低耦合。
  - 开闭原则（对扩展开放，对修改关闭）。
2. 如何插入到待计时的方法中的？--> premain与字节码增强
  - 时机： JVM 在启动时，通过 -javaagent 参数首先加载了mini-apm-agent.jar。
  - 入口： JVM 执行了在 pom.xml 中指定的 Premain-Class（即 AgentMain）里的 premain 方法。
  - 授权： premain 方法获得了 JVM 传给它的“万能钥匙”——Instrumentation 对象。
  - 拦截： 使用 Byte Buddy注册了一个“类转换器”。
  - 篡改： 当 JVM 准备加载 OrderConsumerService 类的字节码时，转换器会“拦住”它，并在内存中动态地修改 createOrderInDb 方法的字节码。它把原来的代码“包裹”了起来。
3. 如何计时？--> MethodTimerInterceptor 与方法委托
  - createOrderInDb 方法的执行权被转交给了 MethodTimerInterceptor.intercept 方法。
  - @SuperCall Callable<?> callable： 这是最关键的参数。Byte Buddy 将原始的、未被修改的 createOrderInDb 方法的逻辑，打包成了这个 callable 对象。
  - 实现计时
  ``` Java
  // 1. 在调用原始方法前，记下“开始时间”
  long start = System.nanoTime(); 
  try {
      // 2. 通过 callable.call()，去执行原始的数据库操作
      Object result = callable.call(); 
    } finally {
      // 3. 无论成功还是失败，都记下“结束时间”
      long end = System.nanoTime();
      // 4. 打印时间差
      System.out.println("耗时: " + (end - start) / 1_000_000 + " 毫秒");
  }
  ```
#### Byte Buddy
- byte-buddy 核心库：提供了一套优雅的 API，能够“拦截”一个方法、“修改”它的行为、甚至创建全新的 Java 类，而这一切都发生在代码的“字节码”层面。