import bcrypt from 'bcrypt';
import type { PasswordHasher } from '@smriti/domain';

const SALT_ROUNDS = 12;

export class BcryptPasswordHasher implements PasswordHasher {
  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }

  async verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
