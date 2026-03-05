import api from './client.js';

export const getSettings = () => api.get('/settings').then(r => r.data);
export const updateSettings = (data) => api.put('/settings', data).then(r => r.data);
export const testConnection = () => api.post('/settings/test-connection').then(r => r.data);
