import archiver from 'archiver';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { config } from '../config.js';

/**
 * Pack a task directory into a ZIP file.
 * Structure inside zip:
 *   instruction.md
 *   task.toml
 *   solution/solve.sh
 *   tests/test.sh
 *   environment/Dockerfile
 */
export async function packTask(slug) {
  const taskDir = join(config.tasksDir, slug);
  const zipPath = join(config.tasksDir, slug, `${slug}.zip`);

  return new Promise((resolve, reject) => {
    const output = createWriteStream(zipPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => resolve(zipPath));
    archive.on('error', reject);

    archive.pipe(output);

    // Add each file maintaining directory structure
    const files = [
      'instruction.md',
      'task.toml',
      'solution/solve.sh',
      'tests/test.sh',
      'environment/Dockerfile',
    ];

    // TB platform requires: <slug>/instruction.md, <slug>/solution/solve.sh, etc.
    for (const file of files) {
      archive.file(join(taskDir, file), { name: `${slug}/${file}` });
    }

    archive.finalize();
  });
}
