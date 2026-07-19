import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import { HttpError } from './errors.js';
import projectsRouter from './routes/projects.js';
import tasksRouter from './routes/tasks.js';
import progressRouter from './routes/progress.js';
import filesRouter from './routes/files.js';
import experiencesRouter from './routes/experiences.js';
import workflowsRouter from './routes/workflows.js';
import taskSpecsRouter from './routes/taskSpecs.js';
import schedulerJobsRouter from './routes/schedulerJobs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  app.use('/api/workflows', workflowsRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api/tasks/:taskId/task-specs', taskSpecsRouter);
  app.use('/api/task-specs', taskSpecsRouter);
  app.use('/api/scheduler-jobs', schedulerJobsRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/experiences', experiencesRouter);
  app.use('/api/projects/:projectId/tasks', tasksRouter);
  app.use('/api/projects/:projectId/files', filesRouter);
  app.use('/api/tasks/:taskId/progress', progressRouter);

  app.delete('/api/step-files/:fileId', (req, res) => {
    const result = db.prepare('DELETE FROM step_files WHERE id = ?').run(req.params.fileId);
    if (result.changes === 0) return res.status(404).json({ error: 'File not found' });
    res.json({ success: true });
  });

  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }));

  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    },
  }));

  app.use((req, res, next) => {
    if (req.method === 'GET') {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.sendFile(path.join(distPath, 'index.html'));
    } else {
      next();
    }
  });

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message, details: error.details });
      return;
    }
    console.error('[API] Unhandled error:', error);
    res.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);

  return app;
}
