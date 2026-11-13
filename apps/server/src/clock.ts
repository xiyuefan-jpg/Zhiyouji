/**
 * The clock service (PRD part 2 §4.2): every "what time is it" in the server
 * comes from here, never from Date.now() directly.
 * - production: the real clock;
 * - simulation: a clock that can be set, advanced, or run faster than real
 *   time (e.g. 33 days in about an hour).
 */

export interface Clock {
  now(): Date;
}

export const realClock: Clock = { now: () => new Date() };

/** A clock you move by hand (tests) or that runs `speed` times faster than real time. */
export class SimClock implements Clock {
  private base: number;
  private realBase: number;
  private speed: number;

  constructor(start: Date | number, speed = 0, private readonly realNow: () => number = () => Date.now()) {
    this.base = +start;
    this.realBase = this.realNow();
    this.speed = speed;
  }

  now(): Date {
    return new Date(this.base + (this.realNow() - this.realBase) * this.speed);
  }

  set(t: Date | number): void {
    this.base = +t;
    this.realBase = this.realNow();
  }

  advance(ms: number): void {
    this.set(+this.now() + ms);
  }

  /** 0 = stopped (moves only by hand); 792 ≈ 33 days per hour. */
  setSpeed(speed: number): void {
    this.set(this.now());
    this.speed = speed;
  }
}
