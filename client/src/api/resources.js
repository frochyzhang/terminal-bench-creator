import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export const getResources = () => api.get('/resources').then(r => r.data);
export const refreshResources = () => api.post('/resources/refresh').then(r => r.data);
export const cleanLogs = () => api.post('/resources/clean').then(r => r.data);
export const updateLimits = (limits) => api.patch('/resources/limits', limits).then(r => r.data);
