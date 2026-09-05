import { describe, it, expect } from 'vitest';
import { prisma } from '../src/db.js';
import { randomUUID } from 'crypto';

describe('Database Connection', () => {
  it('should be able to write and read from the database', async () => {
    const testEmail = `test_${randomUUID()}@example.com`;

    // Write
    const createdUser = await prisma.user.create({
      data: {
        email: testEmail,
        name: 'Health Check User',
      },
    });

    expect(createdUser).toHaveProperty('id');
    expect(createdUser.email).toBe(testEmail);

    // Read
    const retrievedUser = await prisma.user.findUnique({
      where: { id: createdUser.id },
    });

    expect(retrievedUser).toBeDefined();
    expect(retrievedUser?.email).toBe(testEmail);
  });
});
