type EventListener = (event: Event) => void;

export class MockEventSource {
  static instances: MockEventSource[] = [];
  static onCreate: ((source: MockEventSource) => void) | null = null;

  readonly url: string;
  readonly withCredentials: boolean;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, Set<EventListener>>();

  constructor(url: string | URL, init?: EventSourceInit) {
    this.url = String(url);
    this.withCredentials = init?.withCredentials === true;
    MockEventSource.instances.push(this);
    MockEventSource.onCreate?.(this);
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  open(): void {
    this.onopen?.(new Event("open"));
  }

  fail(): void {
    this.onerror?.(new Event("error"));
  }

  emit(type: string, data?: unknown): void {
    const event = data === undefined
      ? new Event(type)
      : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }

  static reset(): void {
    MockEventSource.instances = [];
    MockEventSource.onCreate = null;
  }

  static find(urlPart: string): MockEventSource | undefined {
    return MockEventSource.instances.find((source) => source.url.includes(urlPart));
  }
}

export function completeAssistantStreamsOnCreate(): void {
  MockEventSource.onCreate = (source) => {
    if (!source.url.includes("/assistant/runs/")) return;
    queueMicrotask(() => source.emit("assistant.completed"));
  };
}
