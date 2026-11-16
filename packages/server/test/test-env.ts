/** The database the tests run against. It must be a throwaway database: tests wipe tables. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://cardgame:cardgame@localhost:5432/cardgame_test';
