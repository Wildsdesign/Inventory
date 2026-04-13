/**
 * Audit log service. Non-blocking writes to [inventory].AuditLog.
 */

import { Request } from 'express';
import prisma from '../lib/prisma';
import { log } from '../utils/logger';

export type AuditTargetType =
  | 'Item'
  | 'Vendor'
  | 'StorageLocation'
  | 'Allergen'
  | 'ImportJob'
  | 'Receiving'
  | 'Transaction'
  | 'Auth'
  | 'System';

interface AuditEntry {
  action: string;
  targetType: AuditTargetType;
  targetId?: string | null;
  details?: unknown;
  userId?: string | null;
  facilityId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

const MAX_DETAILS_CHARS = 10_000;

function serializeDetails(details: unknown): string | null {
  if (details == null) return null;
  try {
    let json = JSON.stringify(details);
    if (json.length > MAX_DETAILS_CHARS) {
      json = json.slice(0, MAX_DETAILS_CHARS - 20) + '..."truncated"}';
    }
    return json;
  } catch {
    return null;
  }
}

export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId ?? null,
        details: serializeDetails(entry.details),
        userId: entry.userId ?? null,
        facilityId: entry.facilityId ?? null,
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch (err) {
    log.error(err, { operation: 'auditWrite', action: entry.action });
  }
}

export function auditFromRequest(
  req: Request,
  entry: Omit<AuditEntry, 'userId' | 'facilityId' | 'ipAddress' | 'userAgent'>,
): Promise<void> {
  return audit({
    ...entry,
    userId: req.user?.userId ?? null,
    facilityId: req.facilityId ?? null,
    ipAddress: req.ip ?? req.socket.remoteAddress ?? null,
    userAgent: req.headers['user-agent']?.toString() ?? null,
  });
}
