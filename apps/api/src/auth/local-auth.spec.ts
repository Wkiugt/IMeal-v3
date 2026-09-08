import { describe, expect, it } from 'vitest';
import { parseLocalCredentials, readLocalAuthAccounts } from './local-auth.js';

const accounts = [
  ...Array.from({ length: 5 }, (_, index) => ({
    username: `staff0${index + 1}`,
    password: `Staff0${index + 1}!2026`,
    email: `staff0${index + 1}@imeal.local`,
    name: `Staff 0${index + 1}`,
    role: 'staff',
  })),
  {
    username: 'kitchen01',
    password: 'Kitchen01!2026',
    email: 'kitchen01@imeal.local',
    name: 'Kitchen 01',
    role: 'kitchen',
  },
  {
    username: 'kitchen02',
    password: 'Kitchen02!2026',
    email: 'kitchen02@imeal.local',
    name: 'Kitchen 02',
    role: 'kitchen',
  },
  {
    username: 'admin01',
    password: 'Admin01!2026',
    email: 'admin01@imeal.local',
    name: 'Admin 01',
    role: 'admin',
  },
];

describe('local auth configuration', () => {
  it('loads the configured staff, kitchen, and admin accounts', () => {
    const result = readLocalAuthAccounts({
      LOCAL_AUTH_USERS: JSON.stringify(accounts),
    });

    expect(result).toHaveLength(8);
    expect(result.filter((account) => account.role === 'staff')).toHaveLength(5);
    expect(result.filter((account) => account.role === 'kitchen')).toHaveLength(2);
    expect(result.filter((account) => account.role === 'admin')).toHaveLength(1);
  });

  it('validates local login payload fields', () => {
    expect(parseLocalCredentials({ username: 'staff01', password: 'secret' })).toEqual({
      username: 'staff01',
      password: 'secret',
    });
    expect(() => parseLocalCredentials({ username: 'staff01' })).toThrow(
      'Username and password are required',
    );
  });
});
