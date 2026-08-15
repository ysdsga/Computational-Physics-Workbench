import { Router } from 'express';
import fs from 'fs';
import db from '../db.js';
import {
  AgentCoreError,
  contractPath,
  hashJson,
  initializeContract,
  parseContract,
  sha256,
  writeContract,
} from '../services/agentCore.js';
import { resolveWithinRoot } from '../services/pathSafety.js';

const router = Router();

router.get('/:id/contract', (req, res) => {
  const row = db.prepare(`SELECT rp.file_name, p.working_dir FROM research_plans rp JOIN projects p ON p.id = rp.project_id WHERE rp.id = ?`).get(req.params.id) as any;
  if (!row) throw new AgentCoreError(404, 'RESEARCH_PLAN_NOT_FOUND', 'Research plan not found');
  const planPath = resolveWithinRoot(row.working_dir, row.file_name, { mustExist: true, label: 'research plan' });
  const planSha256 = sha256(fs.readFileSync(planPath, 'utf8'));
  const target = contractPath(row.working_dir, req.params.id);
  if (!fs.existsSync(target)) return res.status(404).json({ error: 'Research contract does not exist', code: 'CONTRACT_MISSING', details: { planSha256 } });
  const content = fs.readFileSync(target, 'utf8');
  const contract = parseContract(content);
  res.json({ content, contract, sha256: hashJson(contract), planSha256, drift: contract.approvedPlan.sha256 !== planSha256 });
});

router.post('/:id/contract/initialize', (req, res) => res.status(201).json(initializeContract(req.params.id, req.body?.overwrite === true)));

router.put('/:id/contract', (req, res) => {
  if (typeof req.body?.content !== 'string') return res.status(400).json({ error: 'content is required', code: 'INPUT_REQUIRED' });
  res.json(writeContract(req.params.id, req.body.content, req.body.expectedPlanSha256));
});

export default router;
