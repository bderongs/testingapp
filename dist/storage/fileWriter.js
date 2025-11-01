// This file handles persistence of crawl and user story artifacts onto the local filesystem.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../utils/logger';
const OUTPUT_DIR = 'output';
export const persistArtifacts = async (artifacts) => {
    await mkdir(OUTPUT_DIR, { recursive: true });
    const crawlPayload = JSON.stringify({
        baseUrl: artifacts.crawl.baseUrl,
        pages: Array.from(artifacts.crawl.pages.values()),
        edges: Array.from(artifacts.crawl.edges.entries()).map(([source, targets]) => ({ source, targets })),
    }, null, 2);
    const storiesPayload = JSON.stringify(artifacts.userStories, null, 2);
    await Promise.all([
        writeFile(join(OUTPUT_DIR, 'site-map.json'), `${crawlPayload}\n`),
        writeFile(join(OUTPUT_DIR, 'user-stories.json'), `${storiesPayload}\n`),
    ]);
    logger.info(`Artifacts saved to ${OUTPUT_DIR}/site-map.json and ${OUTPUT_DIR}/user-stories.json`);
};
