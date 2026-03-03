import { Router } from 'express';
import pool from '../db/client.js';
import { readTaskFiles, writeTaskFile } from '../services/taskFileService.js';
import { generateFile, GENERATION_ORDER } from '../services/aiService/index.js';
import { lintTask } from '../services/lintService.js';

const router = Router({ mergeParams: true });

// POST /api/tasks/:id/generate - Generate a specific file
router.post('/', async (req, res, next) => {
  try {
    const { filename, taskDescription } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'filename is required' });
    }

    const taskResult = await pool.query('SELECT * FROM tasks WHERE id::text = $1 OR slug = $1', [req.params.id]);
    const task = taskResult.rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const existingFiles = await readTaskFiles(task.slug);

    // Set up SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    sendEvent('start', { filename });

    let generated = '';
    try {
      generated = await generateFile(
        filename,
        taskDescription || task.description || task.title,
        existingFiles,
        (chunk) => {
          sendEvent('chunk', { text: chunk });
        }
      );
    } catch (err) {
      sendEvent('error', { message: err.message });
      res.end();
      return;
    }

    // Save the generated file
    await writeTaskFile(task.slug, filename, generated);

    // Run lint on all files
    const allFiles = { ...existingFiles, [filename]: generated };
    const lintResult = lintTask(allFiles);

    sendEvent('done', {
      filename,
      content: generated,
      lint: lintResult,
    });

    res.end();
  } catch (err) {
    next(err);
  }
});

// POST /api/tasks/:id/generate-all - Generate all files in sequence
router.post('/all', async (req, res, next) => {
  try {
    const { taskDescription } = req.body;

    const taskResult = await pool.query('SELECT * FROM tasks WHERE id::text = $1 OR slug = $1', [req.params.id]);
    const task = taskResult.rows[0];
    if (!task) return res.status(404).json({ error: 'Task not found' });

    // Set up SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const sendEvent = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const generatedFiles = await readTaskFiles(task.slug);

    for (const filename of GENERATION_ORDER) {
      sendEvent('file-start', { filename });

      let content = '';
      try {
        content = await generateFile(
          filename,
          taskDescription || task.description || task.title,
          generatedFiles,
          (chunk) => {
            sendEvent('chunk', { filename, text: chunk });
          }
        );
      } catch (err) {
        sendEvent('file-error', { filename, message: err.message });
        continue;
      }

      await writeTaskFile(task.slug, filename, content);
      generatedFiles[filename] = content;

      sendEvent('file-done', { filename, content });
    }

    // Final lint
    const lintResult = lintTask(generatedFiles);
    sendEvent('all-done', { lint: lintResult });
    res.end();
  } catch (err) {
    next(err);
  }
});

export default router;
