import { User, type UserRole } from '@smriti/domain';
import type { ListUsersQuery, PaginatedResult, UserRepository } from '@smriti/domain';
import type { PrismaClient, User as PrismaUser } from '@prisma/client';

function toDomain(record: PrismaUser): User {
  return User.reconstitute({
    id: record.id,
    email: record.email,
    passwordHash: record.passwordHash,
    role: record.role as UserRole,
    createdAt: record.createdAt,
  });
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(user: User): Promise<void> {
    const props = user.toProps();
    await this.prisma.user.create({
      data: {
        id: props.id,
        email: props.email,
        passwordHash: props.passwordHash,
        role: props.role,
        createdAt: props.createdAt,
      },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    return record ? toDomain(record) : null;
  }

  async findById(id: string): Promise<User | null> {
    const record = await this.prisma.user.findUnique({ where: { id } });
    return record ? toDomain(record) : null;
  }

  async findAll(query: ListUsersQuery): Promise<PaginatedResult<User>> {
    const take = query.limit + 1;
    const records = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });

    const hasMore = records.length > query.limit;
    const page = hasMore ? records.slice(0, query.limit) : records;

    return {
      items: page.map(toDomain),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }
}
