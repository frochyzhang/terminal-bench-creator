import api from './client.js';

export const startScrape  = (config) => api.post('/scrape/start', config).then(r => r.data);
export const stopScrape   = ()       => api.post('/scrape/stop').then(r => r.data);
export const pauseScrape  = ()       => api.post('/scrape/pause').then(r => r.data);
export const resumeScrape = ()       => api.post('/scrape/resume').then(r => r.data);
export const getScrapeStatus = ()    => api.get('/scrape/status').then(r => r.data);
export const previewSO    = (params) => api.get('/scrape/preview', { params }).then(r => r.data);
