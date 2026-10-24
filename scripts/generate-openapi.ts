import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  extendZodWithOpenApi,
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
import {
  ChatRequestSchema,
  CreateConversationSchema,
  CreateMemorySchema,
  LoginSchema,
  RefreshTokenSchema,
  RegisterSchema,
  CreateApiKeySchema,
} from '@smriti/shared';

extendZodWithOpenApi(z);

const outputPath = join(process.cwd(), 'docs', 'api', 'openapi.json');

const registry = new OpenAPIRegistry();

const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  role: z.enum(['user', 'admin']),
  createdAt: z.string().datetime(),
});

const AuthResponseSchema = z.object({
  user: UserSchema,
  accessToken: z.string(),
  refreshToken: z.string(),
});

const ApiKeyResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  key: z.string(),
});

const MemorySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  type: z.enum(['long_term', 'semantic']),
  content: z.string(),
  category: z.string().nullable(),
  tags: z.array(z.string()),
  importance: z.number(),
  confidence: z.number(),
  isPinned: z.boolean(),
  isArchived: z.boolean(),
  conversationId: z.string().uuid().nullable(),
  indexingStatus: z.enum(['pending', 'indexed', 'failed', 'not_applicable']),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const ScoredMemorySchema = MemorySchema.extend({ score: z.number() });

const ListMemoriesResponseSchema = z.object({
  items: z.array(MemorySchema),
  cursor: z.string().nullable(),
});

const SearchMemoriesResponseSchema = z.object({
  items: z.array(ScoredMemorySchema),
  cursor: z.string().nullable(),
});

const UpdateMemoryRequestSchema = z.object({
  type: z.enum(['long_term', 'semantic']).optional(),
  content: z.string().min(1).max(100_000).optional(),
  category: z.string().max(128).nullable().optional(),
  tags: z.array(z.string().max(64)).max(50).optional(),
  importance: z.number().min(0).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  isPinned: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  conversationId: z.string().uuid().nullable().optional(),
});

const SearchMemoriesRequestSchema = z.object({
  query: z.string().min(1).max(2000),
  category: z.string().optional(),
  tags: z.array(z.string()).optional(),
  includeArchived: z.boolean().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.number().int().min(1).max(50).optional(),
  cursor: z.string().optional(),
});

const ChatResponseSchema = z.object({
  conversationId: z.string().uuid(),
  message: z.string(),
  memoriesCreated: z.array(z.string().uuid()),
  memoriesRetrieved: z.array(z.string().uuid()),
  duplicateWarnings: z.array(
    z.object({
      existingMemoryId: z.string().uuid(),
      similarity: z.number(),
    }),
  ),
});

const ConversationSchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const ConversationMessageSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  createdAt: z.string().datetime(),
});

const ConversationMessagesResponseSchema = z.object({
  conversationId: z.string().uuid(),
  items: z.array(ConversationMessageSchema),
});

const AuditLogSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  payloadSnapshot: z.record(z.string(), z.unknown()),
  correlationId: z.string(),
  createdAt: z.string().datetime(),
});

const JobFailureSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string(),
  jobName: z.string(),
  queue: z.string(),
  payload: z.record(z.string(), z.unknown()),
  attempts: z.number().int(),
  error: z.string(),
  correlationId: z.string(),
  status: z.enum(['open', 'retried']),
  retriedAt: z.string().datetime().nullable(),
  retriedBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

const CursorResponseSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), cursor: z.string().nullable() });

const ErrorResponseSchema = z.object({
  statusCode: z.number().int(),
  error: z.string(),
  message: z.string(),
  correlationId: z.string(),
  reason: z.string().optional(),
  retryAfterSeconds: z.number().int().optional(),
  existingMemoryId: z.string().uuid().optional(),
  similarity: z.number().optional(),
  details: z.unknown().optional(),
});

const HealthSchema = z.object({ status: z.string(), timestamp: z.string().datetime() });
const LiveSchema = z.object({ status: z.string() });
const ReadySchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.record(z.string(), z.string()),
});

registry.register('User', UserSchema);
registry.register('AuthResponse', AuthResponseSchema);
registry.register('ApiKeyResponse', ApiKeyResponseSchema);
registry.register('Memory', MemorySchema);
registry.register('ScoredMemory', ScoredMemorySchema);
registry.register('ListMemoriesResponse', ListMemoriesResponseSchema);
registry.register('SearchMemoriesResponse', SearchMemoriesResponseSchema);
registry.register('ChatResponse', ChatResponseSchema);
registry.register('Conversation', ConversationSchema);
registry.register('ConversationMessage', ConversationMessageSchema);
registry.register('ConversationMessagesResponse', ConversationMessagesResponseSchema);
registry.register('AuditLog', AuditLogSchema);
registry.register('JobFailure', JobFailureSchema);
registry.register('ErrorResponse', ErrorResponseSchema);
registry.register('HealthResponse', HealthSchema);
registry.register('LiveResponse', LiveSchema);
registry.register('ReadyResponse', ReadySchema);
registry.register('UserListResponse', CursorResponseSchema(UserSchema));
registry.register('AuditLogListResponse', CursorResponseSchema(AuditLogSchema));
registry.register('JobFailureListResponse', CursorResponseSchema(JobFailureSchema));

registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});
registry.registerComponent('securitySchemes', 'apiKeyAuth', {
  type: 'apiKey',
  in: 'header',
  name: 'X-API-Key',
});

const auth = [{ bearerAuth: [] }, { apiKeyAuth: [] }];

const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe(
    'Optional request key. Repeating the same key with the same payload replays the original response.',
  );

const idempotencyReplayedHeader = {
  'Idempotency-Replayed': {
    description: 'Present and set to true when the stored response was replayed.',
    schema: { type: 'string' as const, enum: ['true'] },
  },
};

function json(schema: z.ZodTypeAny, description: string) {
  return {
    description,
    content: { 'application/json': { schema } },
  };
}

function error(description: string) {
  return json(ErrorResponseSchema, description);
}

function cursorQuery() {
  return z.object({
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  });
}

registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Ops'],
  summary: 'Basic health check',
  responses: { 200: json(HealthSchema, 'Service is up') },
});

registry.registerPath({
  method: 'get',
  path: '/metrics',
  tags: ['Ops'],
  summary: 'Prometheus metrics',
  description:
    'Process metrics plus HTTP request counters/histograms. The worker exposes its own metrics on WORKER_METRICS_PORT.',
  responses: {
    200: {
      description: 'Prometheus text exposition format',
      content: { 'text/plain': { schema: { type: 'string' as const } } },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/live',
  tags: ['Ops'],
  summary: 'Liveness check',
  responses: { 200: json(LiveSchema, 'Process is alive') },
});

registry.registerPath({
  method: 'get',
  path: '/ready',
  tags: ['Ops'],
  summary: 'Readiness check',
  responses: { 200: json(ReadySchema, 'Dependency checks') },
});

registry.registerPath({
  method: 'post',
  path: '/v1/auth/register',
  tags: ['Auth'],
  summary: 'Register a user',
  request: { body: { content: { 'application/json': { schema: RegisterSchema } } } },
  responses: {
    201: json(AuthResponseSchema, 'Registered'),
    409: error('Email already registered'),
    400: error('Validation failed'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/auth/login',
  tags: ['Auth'],
  summary: 'Log in',
  request: { body: { content: { 'application/json': { schema: LoginSchema } } } },
  responses: {
    200: json(AuthResponseSchema, 'Authenticated'),
    401: error('Invalid credentials'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/auth/refresh',
  tags: ['Auth'],
  summary: 'Rotate a refresh token',
  request: { body: { content: { 'application/json': { schema: RefreshTokenSchema } } } },
  responses: {
    200: json(AuthResponseSchema, 'Rotated'),
    401: error('Invalid or expired refresh token'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/auth/logout',
  tags: ['Auth'],
  summary: 'Log out',
  request: { body: { content: { 'application/json': { schema: RefreshTokenSchema } } } },
  responses: { 204: { description: 'Revoked' }, 401: error('Unauthorized') },
});

registry.registerPath({
  method: 'post',
  path: '/v1/api-keys',
  tags: ['API keys'],
  summary: 'Issue an API key',
  security: auth,
  request: { body: { content: { 'application/json': { schema: CreateApiKeySchema } } } },
  responses: {
    201: json(ApiKeyResponseSchema, 'Created; plaintext key is shown once'),
    401: error('Unauthorized'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/v1/api-keys/{id}',
  tags: ['API keys'],
  summary: 'Revoke an API key',
  security: auth,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: 'Revoked' },
    404: error('Not found'),
    401: error('Unauthorized'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/memories',
  tags: ['Memories'],
  summary: 'Create a memory',
  security: auth,
  request: {
    query: z.object({ force: z.boolean().optional() }),
    headers: z.object({ 'Idempotency-Key': IdempotencyKeySchema }),
    body: { content: { 'application/json': { schema: CreateMemorySchema } } },
  },
  responses: {
    201: { ...json(MemorySchema, 'Created'), headers: idempotencyReplayedHeader },
    400: error('Validation failed'),
    401: error('Unauthorized'),
    409: error(
      'Duplicate memory or idempotency conflict. Idempotency reasons: IDEMPOTENCY_KEY_REUSE or IDEMPOTENCY_IN_PROGRESS.',
    ),
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/memories',
  tags: ['Memories'],
  summary: 'List memories',
  security: auth,
  request: {
    query: cursorQuery().extend({
      category: z.string().optional(),
      tags: z.array(z.string()).optional(),
      includeArchived: z.boolean().optional(),
      isPinned: z.boolean().optional(),
    }),
  },
  responses: { 200: json(ListMemoriesResponseSchema, 'Memories'), 401: error('Unauthorized') },
});

registry.registerPath({
  method: 'post',
  path: '/v1/memories/search',
  tags: ['Memories'],
  summary: 'Semantic memory search',
  security: auth,
  request: { body: { content: { 'application/json': { schema: SearchMemoriesRequestSchema } } } },
  responses: {
    200: json(SearchMemoriesResponseSchema, 'Ranked memories'),
    400: error('Validation failed'),
    401: error('Unauthorized'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/memories/{id}',
  tags: ['Memories'],
  summary: 'Get a memory',
  security: auth,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    200: json(MemorySchema, 'Memory'),
    404: error('Not found'),
    401: error('Unauthorized'),
  },
});

registry.registerPath({
  method: 'patch',
  path: '/v1/memories/{id}',
  tags: ['Memories'],
  summary: 'Update a memory',
  security: auth,
  request: {
    params: z.object({ id: z.string().uuid() }),
    body: { content: { 'application/json': { schema: UpdateMemoryRequestSchema } } },
  },
  responses: {
    200: json(MemorySchema, 'Updated'),
    400: error('Validation failed'),
    404: error('Not found'),
    401: error('Unauthorized'),
  },
});

registry.registerPath({
  method: 'delete',
  path: '/v1/memories/{id}',
  tags: ['Memories'],
  summary: 'Delete a memory',
  security: auth,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    204: { description: 'Deleted' },
    404: error('Not found'),
    401: error('Unauthorized'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/chat',
  tags: ['Chat'],
  summary: 'Run a synchronous chat turn',
  security: auth,
  request: {
    headers: z.object({ 'Idempotency-Key': IdempotencyKeySchema }),
    body: { content: { 'application/json': { schema: ChatRequestSchema } } },
  },
  responses: {
    200: {
      ...json(ChatResponseSchema, 'Assistant response and side-effect IDs'),
      headers: idempotencyReplayedHeader,
    },
    400: error('Validation failed'),
    401: error('Unauthorized'),
    409: error('Idempotency conflict. Reasons: IDEMPOTENCY_KEY_REUSE or IDEMPOTENCY_IN_PROGRESS.'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/conversations',
  tags: ['Chat'],
  summary: 'Create a conversation',
  security: auth,
  request: { body: { content: { 'application/json': { schema: CreateConversationSchema } } } },
  responses: { 201: json(ConversationSchema, 'Created'), 401: error('Unauthorized') },
});

registry.registerPath({
  method: 'get',
  path: '/v1/conversations/{id}/messages',
  tags: ['Chat'],
  summary: 'List messages in a conversation',
  security: auth,
  request: {
    params: z.object({ id: z.string().uuid() }),
    query: z.object({ limit: z.number().int().min(1).max(200).optional() }),
  },
  responses: {
    200: json(ConversationMessagesResponseSchema, 'Messages in chronological order'),
    404: error('Not found'),
    401: error('Unauthorized'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/admin/users',
  tags: ['Admin'],
  summary: 'List users',
  security: auth,
  request: { query: cursorQuery().extend({ userId: z.string().uuid().optional() }) },
  responses: {
    200: json(CursorResponseSchema(UserSchema), 'Users'),
    401: error('Unauthorized'),
    403: error('Forbidden'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/admin/audit-logs',
  tags: ['Admin'],
  summary: 'List audit logs',
  security: auth,
  request: { query: cursorQuery().extend({ userId: z.string().uuid().optional() }) },
  responses: {
    200: json(CursorResponseSchema(AuditLogSchema), 'Audit logs'),
    401: error('Unauthorized'),
    403: error('Forbidden'),
  },
});

registry.registerPath({
  method: 'get',
  path: '/v1/admin/job-failures',
  tags: ['Admin'],
  summary: 'List durable terminal job failures',
  security: auth,
  request: {
    query: cursorQuery().extend({
      status: z.enum(['open', 'retried']).optional(),
      jobName: z.string().optional(),
    }),
  },
  responses: {
    200: json(CursorResponseSchema(JobFailureSchema), 'Terminal job failures, newest first'),
    401: error('Unauthorized'),
    403: error('Forbidden'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/v1/admin/job-failures/{id}/retry',
  tags: ['Admin'],
  summary: 'Replay a durable terminal job failure',
  description:
    'Re-enqueues embed-and-index or delete-vectors with its original job ID and payload, writes a job.retry audit event, and marks the failure retried.',
  security: auth,
  request: { params: z.object({ id: z.string().uuid() }) },
  responses: {
    202: json(JobFailureSchema, 'Job re-enqueued and failure marked retried'),
    400: error('Malformed failure ID'),
    401: error('Unauthorized'),
    403: error('Forbidden'),
    404: error('Job failure not found'),
    409: error('Already retried or job is not replayable'),
  },
});

const generator = new OpenApiGeneratorV3(registry.definitions);
const document = generator.generateDocument({
  openapi: '3.0.3',
  info: {
    title: 'Smriti API',
    version: '0.1.0',
    description:
      'Agentic memory API with Postgres as the source of truth and asynchronous Qdrant indexing.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  tags: [
    { name: 'Auth', description: 'Registration, login, refresh, and logout' },
    { name: 'API keys', description: 'Bearer API key lifecycle' },
    { name: 'Memories', description: 'Memory CRUD and semantic search' },
    { name: 'Chat', description: 'Synchronous LangGraph chat and conversations' },
    { name: 'Admin', description: 'Admin-only user, audit log, and job failure recovery' },
    { name: 'Ops', description: 'Health, liveness, and readiness' },
  ],
});

const headerDefinitions = {
  RetryAfter: {
    description: 'Seconds until the default throttler allows the request again.',
    schema: { type: 'integer' as const, minimum: 1 },
  },
  RetryAfterExpensive: {
    description: 'Seconds until the expensive-route throttler allows the request again.',
    schema: { type: 'integer' as const, minimum: 1 },
  },
  RateLimitLimit: {
    description: 'Request limit for the default throttler.',
    schema: { type: 'integer' as const },
  },
  RateLimitRemaining: {
    description: 'Remaining requests in the default window.',
    schema: { type: 'integer' as const, minimum: 0 },
  },
  RateLimitReset: {
    description: 'Seconds until the default window resets.',
    schema: { type: 'integer' as const, minimum: 0 },
  },
  ExpensiveRateLimitLimit: {
    description: 'Request limit for the expensive-route throttler.',
    schema: { type: 'integer' as const },
  },
  ExpensiveRateLimitRemaining: {
    description: 'Remaining requests in the expensive-route window.',
    schema: { type: 'integer' as const, minimum: 0 },
  },
  ExpensiveRateLimitReset: {
    description: 'Seconds until the expensive-route window resets.',
    schema: { type: 'integer' as const, minimum: 0 },
  },
};

const components = document.components as { headers?: Record<string, unknown> };
components.headers = { ...components.headers, ...headerDefinitions };

const headerRef = (name: keyof typeof headerDefinitions) => ({
  $ref: `#/components/headers/${name}`,
});

const retryAfterHeaders = {
  'Retry-After': headerRef('RetryAfter'),
  'Retry-After-expensive': headerRef('RetryAfterExpensive'),
};

const rateLimitHeaders = {
  'X-RateLimit-Limit': headerRef('RateLimitLimit'),
  'X-RateLimit-Remaining': headerRef('RateLimitRemaining'),
  'X-RateLimit-Reset': headerRef('RateLimitReset'),
};

const expensiveRateLimitHeaders = {
  'X-RateLimit-Limit-expensive': headerRef('ExpensiveRateLimitLimit'),
  'X-RateLimit-Remaining-expensive': headerRef('ExpensiveRateLimitRemaining'),
  'X-RateLimit-Reset-expensive': headerRef('ExpensiveRateLimitReset'),
};

const rateLimitResponse = {
  description:
    'Rate limit exceeded for the authenticated user, API key, or client IP. Expensive routes use the -expensive header suffix.',
  headers: retryAfterHeaders,
  content: {
    'application/json': {
      schema: { $ref: '#/components/schemas/ErrorResponse' },
    },
  },
};

type GeneratedResponse = { headers?: Record<string, unknown> };
type GeneratedOperation = { responses?: Record<string, GeneratedResponse | undefined> };
for (const [path, pathItem] of Object.entries(document.paths)) {
  if (path === '/metrics') continue;
  const expensive = path === '/v1/chat' || path === '/v1/memories/search';
  const operations = pathItem as Record<string, GeneratedOperation | undefined>;
  for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
    const operation = operations[method];
    if (!operation?.responses) continue;

    operation.responses['429'] = rateLimitResponse;
    for (const [status, response] of Object.entries(operation.responses)) {
      if (!response || !/^2\d\d$/.test(status)) continue;
      response.headers = {
        ...rateLimitHeaders,
        ...(expensive ? expensiveRateLimitHeaders : {}),
        ...response.headers,
      };
    }
  }
}

const serialized = `${JSON.stringify(document, null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(outputPath, 'utf8');
  } catch {
    process.stderr.write(`Missing OpenAPI contract: ${outputPath}\n`);
    process.exit(1);
  }
  if (current !== serialized) {
    process.stderr.write('OpenAPI contract is out of date. Run pnpm openapi:generate.\n');
    process.exit(1);
  }
  process.stdout.write('OpenAPI contract is current.\n');
} else {
  mkdirSync(join(process.cwd(), 'docs', 'api'), { recursive: true });
  writeFileSync(outputPath, serialized);
  process.stdout.write(`Wrote ${outputPath}\n`);
}
