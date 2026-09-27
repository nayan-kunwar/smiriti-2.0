import type { User } from '../entities/user.entity.js';
import type { PaginatedResult } from './memory-repository.port.js';

export interface ListUsersQuery {
  cursor?: string;
  limit: number;
}

export interface UserRepository {
  save(user: User): Promise<void>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  findAll(query: ListUsersQuery): Promise<PaginatedResult<User>>;
}
