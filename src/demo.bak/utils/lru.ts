/** 双向链表的辅助节点类 */
class ListNode<K, V> {
  key: K | null;
  value: V | null;
  prev: ListNode<K, V> | null = null;
  next: ListNode<K, V> | null = null;

  constructor(key: K | null, value: V | null) {
    this.key = key;
    this.value = value;
  }
}

/** 缓存项被移除时的回调函数类型 */
type EvictionCallback<K, V> = (key: K, value: V) => void;

/** LRU 缓存控制 */
export class LRUCache<K, V = unknown> {
  private capacity: number;
  private cache = new Map<K, ListNode<K, V>>();
  // 哨兵头尾节点，简化边界检查
  private head: ListNode<K, V>;
  private tail: ListNode<K, V>;
  private onEviction?: EvictionCallback<K, V>;

  constructor(capacity: number, onEviction?: EvictionCallback<K, V>) {
    if (capacity <= 0) {
      throw new Error('LRU缓存容量必须为正数');
    }
    this.capacity = capacity;
    this.onEviction = onEviction;
    // 初始化哨兵头尾节点
    this.head = new ListNode<K, V>(null, null); // 虚拟键/值
    this.tail = new ListNode<K, V>(null, null); // 虚拟键/值
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /** 从链表中移除一个节点 (O(1)) */
  private removeNode(node: ListNode<K, V>) {
    if (!node.prev || !node.next) return;
    const prevNode = node.prev;
    const nextNode = node.next;
    prevNode.next = nextNode;
    nextNode.prev = prevNode;
  }

  /** 将一个节点添加到链表头部 (最近使用) (O(1)) */
  private addToHead(node: ListNode<K, V>) {
    node.prev = this.head;
    node.next = this.head.next;
    if (this.head.next) {
      this.head.next.prev = node;
    }
    this.head.next = node;
  }

  /** 将一个现有节点移动到链表头部 (O(1)) */
  private moveToHead(node: ListNode<K, V>) {
    this.removeNode(node);
    this.addToHead(node);
  }

  /** 移除链表尾部的节点 (最久未使用) (O(1)) */
  private removeTail() {
    const tailNode = this.tail.prev;
    if (tailNode && tailNode !== this.head) {
      // 检查链表是否为空
      this.removeNode(tailNode);
      // 触发淘汰回调
      if (this.onEviction && tailNode.key !== null && tailNode.value !== null) {
        this.onEviction(tailNode.key, tailNode.value);
      }
      return tailNode;
    }
    return null;
  }

  get(key: K) {
    const node = this.cache.get(key);
    if (!node) {
      return undefined;
    }
    // 将访问的节点移动到头部
    this.moveToHead(node);
    return node.value;
  }

  set(key: K, value: V) {
    let node = this.cache.get(key);

    if (node) {
      // 更新现有节点的值并移动到头部
      node.value = value;
      this.moveToHead(node);
    } else {
      // 创建新节点
      node = new ListNode(key, value);
      this.cache.set(key, node);
      this.addToHead(node);

      // 检查缓存是否超出容量
      if (this.cache.size > this.capacity) {
        // 移除最近最少使用的元素 (尾部节点)
        const tailNode = this.removeTail();
        if (tailNode && tailNode.key !== null) {
          this.cache.delete(tailNode.key);
        }
      }
    }
  }

  delete(key: K) {
    const node = this.cache.get(key);
    if (!node) {
      return false;
    }
    // 从缓存和链表中移除
    this.cache.delete(key);
    this.removeNode(node);
    return true;
  }

  has(key: K) {
    return this.cache.has(key);
  }

  size(): number {
    // 实际项目数量 (不包括哨兵节点)
    return this.cache.size;
  }

  keys(): IterableIterator<K> {
    // 返回插入顺序的键 (Map 的行为), 而不是 LRU 顺序。
    return this.cache.keys();
  }

  /** 按 LRU 顺序获取键 (最近使用的在前) - O(N) 操作 */
  getLruKeys() {
    const keys: K[] = [];
    let current = this.head.next;
    while (current && current !== this.tail) {
      if (current.key !== null) {
        keys.push(current.key);
      }
      current = current.next;
    }
    return keys;
  }

  clear() {
    this.cache.clear();
    // 重置链表
    this.head.next = this.tail;
    this.tail.prev = this.head;
  }

  /** 获取值但不更新位置 */
  peek(key: K): V | null | undefined {
    const node = this.cache.get(key);
    return node?.value;
  }

  /** 获取值，如果不存在则设置新值 */
  getOrSet(key: K, valueProvider: () => V): V {
    const existingValue = this.get(key);
    if (existingValue != null) {
      return existingValue;
    }

    const newValue = valueProvider();
    this.set(key, newValue);
    return newValue;
  }

  /** 序列化缓存内容 */
  toJSON() {
    const entries: [K, V][] = [];
    let current = this.head.next;
    while (current && current !== this.tail) {
      if (current.key !== null && current.value !== null) {
        entries.push([current.key, current.value]);
      }
      current = current.next;
    }
    return entries;
  }

  /** 遍历缓存项 */
  forEach(callback: (value: V, key: K) => void): void {
    let current = this.head.next;
    while (current && current !== this.tail) {
      if (current.key !== null && current.value !== null) {
        callback(current.value, current.key);
      }
      current = current.next;
    }
  }
}
