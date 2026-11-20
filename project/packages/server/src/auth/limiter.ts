/**
 * Ограничение подбора пароля: неудачные попытки входа по ключу (IP + логин)
 * в скользящем окне. Держится в памяти процесса — после перезапуска счёт обнуляется.
 */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60_000,
  ) {}

  /** Сколько миллисекунд ждать до следующей попытки; 0 — можно пробовать. */
  retryAfterMs(key: string, now = Date.now()): number {
    const recent = this.recent(key, now);
    if (recent.length < this.maxFailures) return 0;
    return (recent[0] as number) + this.windowMs - now;
  }

  fail(key: string, now = Date.now()): void {
    // Подчищаем забытые ключи, чтобы перебор логинов не раздувал карту.
    if (this.failures.size > 10_000) {
      for (const stale of [...this.failures.keys()]) this.recent(stale, now);
    }
    const recent = this.recent(key, now);
    recent.push(now);
    this.failures.set(key, recent.slice(-this.maxFailures));
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((time) => time > now - this.windowMs);
    if (list.length > 0) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }
}
