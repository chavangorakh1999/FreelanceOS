import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' }, jsc: { target: 'es2022', parser: { syntax: 'typescript', decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } } })],
  test: {
    include: ['test/**/*.e2e.ts', 'src/**/*.spec.ts'],
    globalSetup: ['test/global-setup.ts'],
    fileParallelism: false, // tests share one database
    testTimeout: 30_000,
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://postgres@localhost:5433/freelanceos_test?schema=public',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123456',
      NODE_ENV: 'test',
      THROTTLE_DISABLED: 'true',
    },
  },
});
