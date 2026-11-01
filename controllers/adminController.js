import * as adminService from '../services/adminService.js';
import * as auditLogModel from '../models/auditLog.js';
import { hashIp } from '../utils/hash.js';

export async function dashboard(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await adminService.getDashboard() });
}

export async function getSettings(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await adminService.getAdminSettings() });
}

export async function updateSettings(req, res) {
  const data = await adminService.saveSettings(req.body, req.admin.id);
  await auditLogModel.add({
    adminId: req.admin.id,
    action: 'settings_updated',
    entity: 'settings',
    metadata: { sections: Object.keys(req.body) },
    ipHash: hashIp(req.ip),
  });
  res.json({ data });
}

export async function usage(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await adminService.getUsage(req.validatedQuery.days) });
}

export async function systemHealth(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await adminService.getSystemHealth() });
}

export async function auditLogs(req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await adminService.getAuditLogs(req.validatedQuery) });
}
