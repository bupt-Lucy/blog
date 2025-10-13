---
title: Java集合框架-栈与队列实现选择
tags: [Java,栈与队列]
categories: [刷题心得]
poster:
  topic: 标题上方的小字
  headline: 大标题
  caption: 标题下方的小字
  color: 标题颜色
date: 2025-10-13 10:40:40
description:
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
> 这段时间在刷栈与队列的算法题的时候，非常疑惑于栈与队列的具体实现，Java中有Stack类，还有LinkedList、ArrayDeque也能实现栈与队列，到底该用哪一个？它们之间有什么区别？刷题时，我一直纠结于这个问题，效率很低，所以今天打算捋一下这几个概念。通过调研，结论如下：

| 数据结构 | 推荐接口 | **首选实现** | 备选实现 | **禁忌使用** | 关键特性 |
| :--- | :--- | :--- | :--- |:--- |:--- |
| **栈 (Stack)** | `Deque<E>` | `ArrayDeque<E>` | `LinkedList<E>` | `Stack<E>` | LIFO (后进先出) |
| **队列 (Queue)** | `Queue<E>` | `ArrayDeque<E>` | `LinkedList<E>` | - | FIFO (先进先出) |
| **优先队列** | `Queue<E>` | `PriorityQueue<E>` | - | - | 堆排序，非FIFO |

### 栈：LIFO 后进先出
1. 接口选择：`Deque<E>`
  - 双端队列是一个功能强大的接口，既可以当队列用，也可以当栈用。当用作栈时，只在一端进行添加和删除操作。
  - 核心方法：
    | 栈操作 | `Deque` 方法 | 描述 |
    | :--- | :--- |:--- |
    | 入栈 (Push) | `push(e)` 或 `addFirst(e)` | 将元素添加到栈顶 |
    | 出栈 (Pop) | `pop()` 或 `removeFirst()` | 移除并返回栈顶元素（栈空时抛异常） |
    | 查看栈顶 | `peek()` 或 `peekFirst()` | 返回栈顶元素，但不移除（栈空时返回`null`） |
    | 判空 | `isEmpty()` | 检查栈是否为空 |
2. 实现类的选择：`ArrayDeque` VS `LinkedList` VS `Stack`
  **首选：`ArrayDeque<E>`**
  - 底层结构：一个可以动态调整大小的循环数组
  - 性能优势：
    - 增删操作的摊还时间复杂度为O（1）。
    - 由于是数组实现，所以拥有更好的缓存局部性，CPU能更好的访问其数据，实际运行速度通常比LinkedList要快一些。
    - 内存占用通常也更少。
  - 缺点：非线程安全。
  ---
  **备选：`LinkedList<E>`**
  - 底层结构：双向链表
  - 性能优势：
    - 在链表头部进行增删操作的时间复杂度也是O（1）。但由于链表节点的内存地址不连续，缓存的命中率较低，实际性能通常劣于ArrayDeque。
  - 可用，但是没有理由来选择它代替ArrayDeque实现一个纯粹的栈。
  ---
  **不用：`Stack<E>类`**
  - 继承自Vector：Vector的所有方法都是Synchronized同步的。
  - 在单线程环境中，同步会带来不必要的性能开销。
3. 结论：直接用 `Deque<E> stack = new ArrayDeque<>();` 
### 队列：FIFO 先进先出
1. 接口选择：`Queue<E>`
  - Queue接口的方法分为两组，一组在操作失败时会抛出异常，另一组则会返回特殊值。在容量受限的队列中，后者通常是更好 的选择。
  - 核心方法（通常选择offer(),poll(),peek()）：
  | 队列操作 | 失败时抛异常 | 失败时返回特殊值 | 描述 |
  | :--- | :--- | :--- | :--- |
  | 入队 (Enqueue) | `add(e)` | `offer(e)` | 将元素添加到队尾 |
  | 出队 (Dequeue) | `remove()` | `poll()` | 移除并返回队头元素 |
  | 查看队头 | `element()` | `peek()` | 返回队头元素，但不移除 |
  | 判空 | `isEmpty()` | `isEmpty()` | 检查队列是否为空 |
2. 实现类的选择：`ArrayDeque` VS `LinkedList`
  **首选：`ArrayDeque<E>`**
  - 当作为队列使用时，在数组的头尾两端进行增删操作，摊还时间复杂度同样是O（1）。其优秀的缓存局部性使其在性能上超越了LinkedList。
  - 不能存null。
  ---
  **备选：`LinkedList<E>`**
  - 是一个非常经典的队列实现，性能稳定。在某些需要频繁在队列中进行增删的复杂场景下，可能更具优势，但是在标准的FIFO队列场景下，ArrayDeque通常更快。
  - 能存null
3. 结论：优先考虑 `Queue<E> queue = new ArrayDeque<>();`，如果需要存储null，再用` LinkedList`。
### 特殊的队列：PriorityQueue
- 当需要根据元素的优先级来处理时，PriorityQueue就要发挥作用了。
- 底层结构：是一个二叉堆
- 核心特性：
  - 每次调用poll()方法，返回的都是队列中优先级最高（默认值最小）的元素。
  - 入队offer()的时间复杂度为O(logn)，出队poll()的时间复杂度也为O(logn)。