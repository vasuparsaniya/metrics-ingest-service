import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { readEnvironment } from '../src/config/environment';
import { DatabaseService } from '../src/database/database.service';

describe('health endpoints against real PostgreSQL', () => {
  let app: INestApplication;
  let server: Server;
  const token = 'integration-test-token';

  beforeAll(async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl)
      throw new Error('TEST_DATABASE_URL is required for real-Postgres tests');
    const environment = readEnvironment({
      ...process.env,
      DATABASE_URL: databaseUrl,
      API_TOKEN: token,
    });
    const module = await Test.createTestingModule({
      imports: [AppModule.register(environment)],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns 401 for a missing or incorrect token', async () => {
    await request(server).get('/healthz').expect(401);
    await request(server)
      .get('/healthz')
      .set('Authorization', 'Bearer incorrect')
      .expect(401);
  });

  it('reports readiness after querying the real test database', async () => {
    const database = app.get(DatabaseService);
    const result = await database.pool.query<{ database: string }>(
      'SELECT current_database() AS database',
    );
    expect(result.rows[0]?.database).toBe(
      new URL(process.env.TEST_DATABASE_URL ?? '').pathname.slice(1),
    );
    await request(server)
      .get('/readyz')
      .set('Authorization', `Bearer ${token}`)
      .expect(200, { status: 'ready' });
  });

  it('keeps liveness up and reports 503 when database connectivity fails', async () => {
    const environment = readEnvironment({
      ...process.env,
      DATABASE_URL: 'postgresql://localhost:1/unreachable',
      API_TOKEN: token,
      DB_CONNECT_TIMEOUT_MS: '100',
    });
    const module = await Test.createTestingModule({
      imports: [AppModule.register(environment)],
    }).compile();
    const unavailableApp = module.createNestApplication();
    try {
      await unavailableApp.init();
      const unavailableServer = unavailableApp.getHttpServer() as Server;
      await request(unavailableServer)
        .get('/healthz')
        .set('Authorization', `Bearer ${token}`)
        .expect(200, { status: 'ok' });
      await request(unavailableServer)
        .get('/readyz')
        .set('Authorization', `Bearer ${token}`)
        .expect(503);
    } finally {
      await unavailableApp.close();
    }
  });
});
