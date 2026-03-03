import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

export const getSettings = () => api.get('/settings').then(r => r.data);
export const updateSettings = (data) => api.put('/settings', data).then(r => r.data);
export const testConnection = () => api.post('/settings/test-connection').then(r => r.data);
