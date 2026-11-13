/** An error the API turns into `{ error, message, ...extra }` with an HTTP status. */

import { errorText } from "@zhiyouji/shared";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }

  body() {
    return { error: this.code, message: errorText(this.code), ...this.extra };
  }
}

export const fail = (status: number, code: string, extra?: Record<string, unknown>): never => {
  throw new HttpError(status, code, extra);
};
