import { z } from 'zod';

export const RegisterSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128),
});

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const RefreshTokenSchema = z.object({
  refreshToken: z.string().min(1),
});

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});

export const CreateApiKeySchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.string().max(64)).max(20).optional(),
  expiresAt: z.string().datetime().optional(),
});

export const ListAdminQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  userId: z.string().uuid().optional(),
});

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type RefreshTokenInput = z.infer<typeof RefreshTokenSchema>;
export type LogoutInput = z.infer<typeof LogoutSchema>;
export type CreateApiKeyInput = z.infer<typeof CreateApiKeySchema>;
export type ListAdminQueryInput = z.infer<typeof ListAdminQuerySchema>;
