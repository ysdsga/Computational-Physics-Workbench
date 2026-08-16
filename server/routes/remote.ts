import { Router } from 'express';
import { jobLogs, jobStatus, reconcileJob } from '../services/remote.js';

const router = Router();
router.post('/jobs/:jobId/status', async (req, res) => res.json(await jobStatus(req.params.jobId)));
router.post('/jobs/:jobId/logs', async (req, res) => res.json(await jobLogs(req.params.jobId)));
router.post('/jobs/:jobId/reconcile', async (req, res) => res.json(await reconcileJob(req.params.jobId)));
export default router;
