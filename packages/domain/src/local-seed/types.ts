export interface LocalSeedConfig {
  baseEmail: string;
  weekStart: string;
  serveDate: string;
  dryRun: boolean;
  databaseUrl: string;
  target: {
    nodeEnv: 'development' | 'test';
    host: string;
    database: string;
    schema: string | null;
  };
}
