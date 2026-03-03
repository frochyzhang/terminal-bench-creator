import axios from 'axios';

const api = axios.create({ baseURL: '/api/scrape' });

export const startScrape  = (config) => api.post('/start', config).then(r => r.data);
export const stopScrape   = ()       => api.post('/stop').then(r => r.data);
export const pauseScrape  = ()       => api.post('/pause').then(r => r.data);
export const resumeScrape = ()       => api.post('/resume').then(r => r.data);
export const getScrapeStatus = ()    => api.get('/status').then(r => r.data);
export const previewSO    = (params) => api.get('/preview', { params }).then(r => r.data);
