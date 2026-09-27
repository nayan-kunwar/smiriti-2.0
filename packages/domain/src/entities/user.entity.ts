import { randomUUID } from 'node:crypto';
import { ValidationError } from '@smriti/shared';

export type UserRole = 'user' | 'admin';

export interface UserProps {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
}

export interface CreateUserParams {
  email: string;
  passwordHash: string;
  role?: UserRole;
}

export class User {
  private constructor(private readonly props: UserProps) {}

  static create(params: CreateUserParams): User {
    const email = params.email.trim().toLowerCase();
    if (!email.includes('@')) {
      throw new ValidationError('Invalid email address');
    }

    return new User({
      id: randomUUID(),
      email,
      passwordHash: params.passwordHash,
      role: params.role ?? 'user',
      createdAt: new Date(),
    });
  }

  static reconstitute(props: UserProps): User {
    return new User(props);
  }

  get id(): string {
    return this.props.id;
  }

  get email(): string {
    return this.props.email;
  }

  get passwordHash(): string {
    return this.props.passwordHash;
  }

  get role(): UserRole {
    return this.props.role;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  toProps(): UserProps {
    return { ...this.props };
  }
}
