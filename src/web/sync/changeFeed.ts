import { api } from '../api';
import type { ChangeMessage } from '../../shared/model';

// Live updates (Architecture §9): a notification-only WebSocket, reconciled against the
// authoritative change counter. Delivery may repeat, reorder or fail, so the feed compares counters
// instead of counting messages, re-reads the counter on every (re)connect, rechecks periodically
// while connected, and long-polls while the socket is unavailable.

const RECHECK_MS = 60_000;
const PING_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export class ChangeFeed {
  private seq: number | null = null;
  private socket: WebSocket | null = null;
  private backoff = 1000;
  private stopped = false;
  private polling = false;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private poll: AbortController | null = null;

  /** `onChange` runs whenever the counter differs from the last one seen. */
  constructor(private onChange: () => void) {}

  start() {
    this.connect();
    this.every(RECHECK_MS, () => void this.check());
    window.addEventListener('online', this.reconnectNow);
    document.addEventListener('visibilitychange', this.onVisible);
  }

  stop() {
    this.stopped = true;
    this.socket?.close();
    this.poll?.abort();
    this.timers.forEach(clearTimeout);
    window.removeEventListener('online', this.reconnectNow);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  private every(ms: number, run: () => void) {
    const tick = () => {
      if (this.stopped) return;
      run();
      this.timers.push(setTimeout(tick, ms));
    };
    this.timers.push(setTimeout(tick, ms));
  }

  private seen(seq: number) {
    if (this.seq === null) {
      this.seq = seq;
      return;
    }
    if (seq === this.seq) return;
    this.seq = Math.max(this.seq, seq);
    this.onChange();
  }

  private async check() {
    try {
      this.seen((await api.changes(null)).seq);
    } catch {
      // Offline: the socket or long poll reconnects.
    }
  }

  private connect() {
    if (this.stopped) return;
    const url = new URL('/api/changes/socket', location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
    let ping: ReturnType<typeof setInterval> | undefined;
    socket.onopen = () => {
      this.backoff = 1000;
      this.polling = false;
      this.poll?.abort();
      ping = setInterval(
        () => socket.readyState === WebSocket.OPEN && socket.send('ping'),
        PING_MS,
      );
      // Subscribe first, then read the counter, so nothing between the two is missed.
      void this.check();
    };
    socket.onmessage = (event) => {
      if (event.data === 'pong') return;
      try {
        const message = JSON.parse(event.data) as ChangeMessage;
        if (message.type === 'changed' && Number.isFinite(message.seq)) this.seen(message.seq);
      } catch {
        // Ignore anything that is not a change message.
      }
    };
    socket.onclose = () => {
      clearInterval(ping);
      if (this.socket !== socket || this.stopped) return;
      this.socket = null;
      void this.longPoll();
      this.timers.push(setTimeout(() => this.connect(), this.backoff));
      this.backoff = Math.min(MAX_BACKOFF_MS, this.backoff * 2);
    };
  }

  private reconnectNow = () => {
    if (this.socket?.readyState === WebSocket.OPEN) return void this.check();
    this.socket?.close();
    this.backoff = 1000;
    this.connect();
  };

  private onVisible = () => {
    if (document.visibilityState === 'visible') this.reconnectNow();
  };

  /** Bounded long polls while the socket is down. */
  private async longPoll() {
    if (this.polling) return;
    this.polling = true;
    while (this.polling && !this.stopped && this.socket?.readyState !== WebSocket.OPEN) {
      this.poll = new AbortController();
      try {
        const since = this.seq;
        const result = await api.changes(since, this.poll.signal);
        this.seen(result.seq);
        if (since === null) await new Promise((resolve) => setTimeout(resolve, this.backoff));
      } catch {
        await new Promise((resolve) => setTimeout(resolve, this.backoff));
      }
    }
    this.polling = false;
  }
}
