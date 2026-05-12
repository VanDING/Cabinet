import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createConnection, closeConnection, getConnection } from '../connection';
import { runMigration001 } from '../migrations/001_initial';
import { OrganizationRepository } from '../repositories/organization';
import { ProjectRepository } from '../repositories/project';
import { EventLogRepository } from '../repositories/event-log';
import { MessageType } from '@cabinet/types';
import type { MessageEnvelope } from '@cabinet/types';
import type { Organization, Project } from '@cabinet/types';
import { ProjectStatus } from '@cabinet/types';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

function setupDb(tmpDir: string) {
  createConnection(join(tmpDir, 'test.db'));
  runMigration001(getConnection());
}

describe('OrganizationRepository', () => {
  let repo: OrganizationRepository;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-org-'));
    setupDb(tmpDir);
    repo = new OrganizationRepository(getConnection());
  });

  afterAll(() => {
    closeConnection();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates and reads an organization', () => {
    const org: Organization = {
      id: 'org-1',
      name: 'Acme Corp',
      captainId: 'captain-1',
      createdAt: new Date(),
    };
    repo.create(org);
    const found = repo.findById('org-1');
    expect(found).not.toBeNull();
    expect(found!.name).toBe('Acme Corp');
  });

  it('returns null for nonexistent organization', () => {
    expect(repo.findById('nonexistent')).toBeNull();
  });

  it('lists all organizations', () => {
    repo.create({ id: 'org-2', name: 'Beta Inc', captainId: 'c2', createdAt: new Date() });
    const all = repo.listAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });
});

describe('ProjectRepository', () => {
  let orgRepo: OrganizationRepository;
  let projRepo: ProjectRepository;
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cabinet-proj-'));
    setupDb(tmpDir);
    orgRepo = new OrganizationRepository(getConnection());
    projRepo = new ProjectRepository(getConnection());
    orgRepo.create({ id: 'org-p', name: 'Test Org', captainId: 'c1', createdAt: new Date() });
  });

  afterAll(() => {
    closeConnection();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates and reads a project', () => {
    const project: Project = {
      id: 'proj-1',
      organizationId: 'org-p',
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

  it('lists projects by organization', () => {
    projRepo.create({
      id: 'proj-a', organizationId: 'org-p', name: 'A',
      description: '', status: ProjectStatus.Draft, createdAt: new Date(),
    });
    projRepo.create({
      id: 'proj-b', organizationId: 'org-p', name: 'B',
      description: '', status: ProjectStatus.Active, createdAt: new Date(),
    });
    const list = projRepo.listByOrganization('org-p');
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it('updates project status', () => {
    projRepo.create({
      id: 'proj-u', organizationId: 'org-p', name: 'Updatable',
      description: '', status: ProjectStatus.Draft, createdAt: new Date(),
    });
    projRepo.update('proj-u', { status: ProjectStatus.Archived });
    const updated = projRepo.findById('proj-u');
    expect(updated!.status).toBe('archived');
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
      messageId: 'msg-later', correlationId: 'corr-seq', causationId: null,
      timestamp: new Date('2026-01-01T10:00:02Z'), messageType: MessageType.TaskOrder, payload: {},
    });
    repo.append({
      messageId: 'msg-earlier', correlationId: 'corr-seq', causationId: null,
      timestamp: new Date('2026-01-01T10:00:01Z'), messageType: MessageType.TaskCompleted, payload: {},
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
