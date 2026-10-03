export class RetryableError extends Error {
  readonly retryable = true;

  constructor(message: string) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class TerminalError extends Error {
  readonly terminal = true;

  constructor(message: string) {
    super(message);
    this.name = 'TerminalError';
  }
}

export class RunAbortedError extends Error {
  constructor(readonly reason: 'aborted' | 'timeout') {
    super(reason);
    this.name = 'RunAbortedError';
  }
}
