import { Router } from 'express';
import {
  describeRemoteSession,
  downloadForRemoteSession,
  executeRemoteSessionCommand,
  initializeRemoteTaskRoot,
  jobLogs,
  jobStatus,
  reconcileJob,
  uploadForRemoteSession,
} from '../services/remote.js';

const router = Router();
router.get('/tasks/:taskId/session', (req, res) => res.json(describeRemoteSession(req.params.taskId)));
router.post('/tasks/:taskId/init', async (req, res) => res.json(await initializeRemoteTaskRoot(req.params.taskId)));
router.post('/tasks/:taskId/exec', async (req, res) => res.json(await executeRemoteSessionCommand(req.params.taskId, req.body ?? {})));
router.post('/tasks/:taskId/upload', async (req, res) => res.json(await uploadForRemoteSession(req.params.taskId, req.body ?? {})));
router.post('/tasks/:taskId/download', async (req, res) => res.json(await downloadForRemoteSession(req.params.taskId, req.body ?? {})));
router.post('/jobs/:jobId/status', async (req, res) => res.json(await jobStatus(req.params.jobId)));
router.post('/jobs/:jobId/logs', async (req, res) => res.json(await jobLogs(req.params.jobId)));
router.post('/jobs/:jobId/reconcile', async (req, res) => res.json(await reconcileJob(req.params.jobId)));
export default router;
