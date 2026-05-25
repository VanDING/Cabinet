import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, closeConnection, getConnection } from '../connection';
import { runMigration001 } from '../migrations/001_initial';
import { runMigration002 } from '../migrations/002_projects';
import { runMigration019 } from '../migrations/019_project_name_unique';
import { ProjectRepository } from '../repositories/project';
import { EventLogRepository } from '../repositories/event-log';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';
import type { Project } from '@cabinet/types';
import { ProjectStatus } from '@cabinet/types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

function setupDb(tmpDir: string) {
  createConnection(join(tmpDir, 'test.db'));
  runMigration001(getConnection());
  runMigration002(getConnection());
  runMigration019(getConnection());
}

describe('ProjectRepository', () => {
  let projRepo: ProjectRepository;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-proj-'));
    setupDb(tmpDir);
    projRepo = new ProjectRepository(getConnection());
  });

  afterAll(() => {
    closeConnection();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates and reads a project', () => {
    const project: Project = {
      id: 'proj-1',
      name: 'Launch',
      description: 'Product launch',
      status: ProjectStatus.Active,
      createdAt: new Date(),
    };
    projRepo.create(project);
    const found = projRepo.findById('proj-1');
    expect(found).not.toBeNull();
    expect(found!.status).toBe('active');
  });

  it('lists all projects', () => {
    projRepo.create({
      id: 'proj-a',
      name: 'A',
      description: '',
      status: ProjectStatus.Draft,
      createdAt: new Date(),
    });
    projRepo.create({
      id: 'proj-b',
      name: 'B',
      description: '',
      status: ProjectStatus.Active,
      createdAt: new Date(),
    });
    const list = projRepo.listAll();
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('updates project status', () => {
    projRepo.create({
      id: 'proj-u',
      name: 'Updatable',
      description: '',
      status: ProjectStatus.Draft,
      createdAt: new Date(),
    });
    projRepo.update('proj-u', { status: ProjectStatus.Archived });
    const updated = projRepo.findById('proj-u');
    expect(updated!.status).toBe('archived');
  });

  it('finds project by name', () => {
    projRepo.create({
      id: 'proj-n',
      name: 'NamedProject',
      description: '',
      status: ProjectStatus.Active,
      createdAt: new Date(),
    });
    const found = projRepo.findByName('NamedProject');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('NamedProject');
  });

  it('returns null when project name not found', () => {
    const found = projRepo.findByName('NonExistent');
    expect(found).toBeNull();
  });

  it('enforces unique name constraint', () => {
    projRepo.create({
      id: 'proj-x1',
      name: 'UniqueName',
      description: '',
      status: ProjectStatus.Active,
      createdAt: new Date(),
    });
    expect(() =>
      projRepo.create({
        id: 'proj-x2',
        name: 'UniqueName',
        description: '',
        status: ProjectStatus.Active,
        createdAt: new Date(),
      })
    ).toThrow();
  });
});

describe('EventLogRepository', () => {
  let repo: EventLogRepository;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-event-'));
    setupDb(tmpDir);
    repo = new EventLogRepository(getConnection());
  });

  afterAll(() => {
    closeConnection();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends an event and reads it back', () => {
    const envelope: MessageEnvelope = {
      messageId: 'msg-1',
      correlationId: 'corr-1',
      causationId: null,
      timestamp: new Date(),
      messageType: MessageType.TaskOrder,
      payload: { orderId: 'o1', action: 'start' },
    };
    repo.append(envelope);

    const events = repo.findByCorrelationId('corr-1');
    expect(events).toHaveLength(1);
    expect(events[0]!.messageId).toBe('msg-1');
  });

  it('returns events sorted by timestamp', () => {
    repo.append({
      messageId: 'msg-later',
      correlationId: 'corr-seq',
      causationId: null,
      timestamp: new Date('2026-01-01T10:00:02Z'),
      messageType: MessageType.TaskOrder,
      payload: { orderId: 'o1', action: 'start' },
    });
    repo.append({
      messageId: 'msg-earlier',
      correlationId: 'corr-seq',
      causationId: null,
      timestamp: new Date('2026-01-01T10:00:01Z'),
      messageType: MessageType.TaskCompleted,
      payload: { orderId: 'o1', result: {} },
    });

    const events = repo.findByCorrelationId('corr-seq');
    expect(events[0]!.timestamp.getTime()).toBeLessThanOrEqual(events[1]!.timestamp.getTime());
  });

  it('findAll returns all events sorted', () => {
    const all = repo.findAll();
    expect(all.length).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < all.length; i++) {
      expect(all[i - 1]!.timestamp.getTime()).toBeLessThanOrEqual(all[i]!.timestamp.getTime());
    }
  });
});
