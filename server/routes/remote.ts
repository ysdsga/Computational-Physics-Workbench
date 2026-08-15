import { Router } from 'express';
import { cancelJob, download, inspectRemote, jobLogs, jobStatus, reconcileJob, submitSmoke, upload } from '../services/remote.js';

const router = Router();
router.post('/tasks/:taskId/inspect', async (req, res) => res.json(await inspectRemote(req.params.taskId, req.body?.host, req.body?.remoteRoot)));
router.post('/tasks/:taskId/upload', async (req, res) => res.status(201).json(await upload(req.params.taskId, req.body ?? {})));
router.post('/tasks/:taskId/download', async (req, res) => res.status(201).json(await download(req.params.taskId, req.body ?? {})));
router.post('/tasks/:taskId/submit-smoke', async (req, res) => res.status(201).json(await submitSmoke(req.params.taskId, req.body ?? {})));
router.post('/jobs/:jobId/status', async (req, res) => res.json(await jobStatus(req.params.jobId)));
router.post('/jobs/:jobId/logs', async (req, res) => res.json(await jobLogs(req.params.jobId)));
router.post('/jobs/:jobId/cancel', async (req, res) => res.json(await cancelJob(req.params.jobId)));
router.post('/jobs/:jobId/reconcile', async (req, res) => res.json(await reconcileJob(req.params.jobId)));
export default router;
