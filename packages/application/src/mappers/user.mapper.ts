import type { User, UserRole } from '@smriti/domain';

export interface UserDto {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
}

export function toUserDto(user: User): UserDto {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt.toISOString(),
  };
}
