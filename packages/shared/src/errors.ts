export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class ConflictError extends DomainError {
  constructor(
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message: string = 'Unauthorized') {
    super(message, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

/**
 * The turn was durably marked failed. The client can inspect it with
 * `GET /v1/chat/turns/:id` or retry it with `POST /v1/chat/turns/:id/retry`.
 */
export class ChatTurnFailedError extends DomainError {
  constructor(
    public readonly turnId: string,
    public readonly conversationId: string,
  ) {
    super('Chat turn failed', 'CHAT_TURN_FAILED');
    this.name = 'ChatTurnFailedError';
  }
}
